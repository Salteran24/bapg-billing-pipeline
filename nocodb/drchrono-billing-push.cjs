'use strict';
/**
 * drchrono-billing-push.cjs
 *
 * Reads every NocoDB claim that has CPT codes and pushes the billing data
 * into DrChrono (line items + ICD-10 on appointment).
 *
 * Match logic:
 *   1. If MRN is set → look up patient by chart_id
 *   2. Else → search patient by first+last name
 *   3. Find appointment for that patient on the Date of Service
 *   4. For each CPT code in NocoDB not already in DrChrono → POST line item
 *   5. If ICD-10 codes in NocoDB differ from appointment → PATCH appointment
 *
 * Usage:
 *   node nocodb/drchrono-billing-push.cjs           → dry run
 *   node nocodb/drchrono-billing-push.cjs --apply   → write to DrChrono
 *   node nocodb/drchrono-billing-push.cjs --apply --from 2026-06-01 --to 2026-06-30
 */

const DRY_RUN = !process.argv.includes('--apply');

const fs   = require('fs');
const path = require('path');

const ROOT         = path.join(__dirname, '..');
const CONFIG_FILE  = path.join(ROOT, 'drchrono-config.json');
const TOKENS_FILE  = path.join(ROOT, 'drchrono-tokens.json');

// ─── DrChrono auth ──────────────────────────────────────────────────────────

function loadTokens() {
  if (!fs.existsSync(TOKENS_FILE)) throw new Error('drchrono-tokens.json not found. Run drchrono-auth.cjs first.');
  return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
}
function saveTokens(t) { fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2)); }

async function refreshIfNeeded(tokens) {
  const config   = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const expiresAt = tokens.obtained_at + (tokens.expires_in - 600) * 1000;
  if (Date.now() < expiresAt) return tokens;
  const res = await fetch('https://drchrono.com/o/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, ...config }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const fresh = { ...await res.json(), obtained_at: Date.now() };
  saveTokens(fresh);
  return fresh;
}

let DC_TOKEN = '';
async function dcGet(path, params = {}) {
  const q = Object.keys(params).length ? '?' + new URLSearchParams(params) : '';
  const res = await fetch(`https://drchrono.com${path}${q}`, {
    headers: { Authorization: `Bearer ${DC_TOKEN}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`DrChrono GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function dcPost(path, body) {
  if (DRY_RUN) { console.log(`    [DRY] POST ${path}`, JSON.stringify(body)); return {}; }
  const res = await fetch(`https://drchrono.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DC_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`DrChrono POST ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function dcPatch(path, body) {
  if (DRY_RUN) { console.log(`    [DRY] PATCH ${path}`, JSON.stringify(body)); return {}; }
  const res = await fetch(`https://drchrono.com${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${DC_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`DrChrono PATCH ${path}: ${res.status} ${await res.text()}`);
}

async function dcFetchAll(endpoint, params) {
  const out = [];
  let url = endpoint + '?' + new URLSearchParams(params);
  while (url) {
    const data = await dcGet(url.includes('?') ? url.replace('https://drchrono.com', '') : url);
    out.push(...(data.results || []));
    url = data.next ? data.next.replace('https://drchrono.com', '') : null;
  }
  return out;
}

// ─── NocoDB ─────────────────────────────────────────────────────────────────

const nc = require('./nc-client.cjs');

// ─── helpers ────────────────────────────────────────────────────────────────

function parseCPT(str) {
  return (str || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}
function parseICD(str) {
  return (str || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}
function norm(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Cache: chart_id → patient_id
const patientCache = new Map();

async function findPatientByMRN(mrn) {
  if (patientCache.has(mrn)) return patientCache.get(mrn);
  const data = await dcGet('/api/patients', { chart_id: mrn, doctor: 245533 });
  const pat  = (data.results || [])[0] || null;
  patientCache.set(mrn, pat);
  return pat;
}

async function findPatientByName(fullName) {
  const key = norm(fullName);
  if (patientCache.has(key)) return patientCache.get(key);
  const parts     = fullName.trim().split(/\s+/);
  const lastName  = parts[parts.length - 1];
  const firstName = parts[0];
  const data = await dcGet('/api/patients', { last_name: lastName, first_name: firstName, doctor: 245533 });
  // Try exact match first, then last-name-only
  let pat = (data.results || []).find(p =>
    norm(p.first_name) === norm(firstName) && norm(p.last_name) === norm(lastName)
  ) || null;
  if (!pat && data.results?.length === 1) pat = data.results[0];
  patientCache.set(key, pat);
  return pat;
}

async function findAppointment(patientId, dos) {
  const data = await dcGet('/api/appointments', { patient: patientId, date: dos });
  return (data.results || [])[0] || null;
}

async function getLineItems(appointmentId) {
  const data = await dcGet('/api/line_items', { appointment: appointmentId });
  return data.results || [];
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  // Auth
  let tokens = loadTokens();
  tokens     = await refreshIfNeeded(tokens);
  DC_TOKEN   = tokens.access_token;

  // Date filter from args
  const fromArg = (() => { const i = process.argv.indexOf('--from'); return i > -1 ? process.argv[i+1] : null; })();
  const toArg   = (() => { const i = process.argv.indexOf('--to');   return i > -1 ? process.argv[i+1] : null; })();

  console.log(DRY_RUN ? '\n[DRY RUN] No changes will be written.\n' : '\n[APPLY MODE] Writing to DrChrono.\n');

  // Fetch all NocoDB claims with CPT codes
  console.log('Fetching NocoDB claims...');
  const allClaims = await nc.fetchAll(nc.CLAIMS);
  let claims = allClaims.filter(r => r['CPT Codes'] && r['CPT Codes'].trim());
  if (fromArg) claims = claims.filter(r => r['Date of Service'] >= fromArg);
  if (toArg)   claims = claims.filter(r => r['Date of Service'] <= toArg);
  console.log(`  ${claims.length} claims with CPT codes${fromArg ? ` (${fromArg} → ${toArg || 'today'})` : ''}\n`);

  let found = 0, notFound = 0, liAdded = 0, icdUpdated = 0, skipped = 0;
  const notFoundList = [];

  for (let i = 0; i < claims.length; i++) {
    const row = claims[i];
    const mrn       = row['MRN']?.trim();
    const name      = row['Patient Name']?.trim();
    const dos       = row['Date of Service'];
    const cptList   = parseCPT(row['CPT Codes']);
    const icdList   = parseICD(row['ICD-10 Codes']);
    const claimNum  = row['Claim Number'];

    process.stdout.write(`\r  [${i+1}/${claims.length}] ${claimNum}...                    `);

    if (!dos || !cptList.length) { skipped++; continue; }

    // Find patient
    let patient = null;
    if (mrn) {
      patient = await findPatientByMRN(mrn);
    } else if (name) {
      patient = await findPatientByName(name);
    }

    if (!patient) {
      notFound++;
      notFoundList.push(`${claimNum} (${name || mrn || 'no id'})`);
      continue;
    }
    found++;

    // Find appointment
    const appt = await findAppointment(patient.id, dos);
    if (!appt) {
      notFound++;
      notFoundList.push(`${claimNum} — patient found (${patient.first_name} ${patient.last_name}) but no appt on ${dos}`);
      continue;
    }

    // ── ICD-10: update if NocoDB has codes and DrChrono doesn't (or differs) ──
    const dcICD = new Set((appt.icd10_codes || []).map(c => c.trim()));
    const ncICD = icdList.filter(Boolean);
    const missingICD = ncICD.filter(c => !dcICD.has(c));

    if (missingICD.length > 0) {
      const merged = [...new Set([...dcICD, ...ncICD])];
      await dcPatch(`/api/appointments/${appt.id}`, { icd10_codes: merged });
      icdUpdated++;
      if (DRY_RUN) console.log(`\n    ICD-10 would update appt ${appt.id}: add ${missingICD.join(', ')}`);
    }

    // ── Line items: add CPT codes not already present ────────────────────────
    const existingLI = await getLineItems(appt.id);
    const existingCPT = new Set(existingLI.map(l => l.code));
    const missingCPT  = cptList.filter(c => !existingCPT.has(c));

    for (const code of missingCPT) {
      await dcPost('/api/line_items', {
        appointment:      appt.id,
        patient:          patient.id,
        doctor:           245533,
        code,
        procedure_type:   'C',
        service_date:     dos,
        quantity:         '1.00',
        units:            'UN',
        diagnosis_pointers: [1, 0, 0, 0],
      });
      liAdded++;
      if (DRY_RUN) console.log(`\n    Line item would add CPT ${code} to appt ${appt.id} (${patient.first_name} ${patient.last_name} on ${dos})`);
    }
  }

  console.log('\n');
  console.log('══════════════════════════════════════');
  console.log(`Patients found in DrChrono:  ${found}`);
  console.log(`Patients/appts not found:    ${notFound}`);
  console.log(`Skipped (no DOS or CPT):     ${skipped}`);
  console.log(`ICD-10 updates:              ${icdUpdated}`);
  console.log(`Line items added:            ${liAdded}`);
  if (DRY_RUN) console.log('\n→ Run with --apply to write these changes.');
  if (notFoundList.length) {
    console.log('\nNot matched:');
    notFoundList.slice(0, 20).forEach(s => console.log('  -', s));
    if (notFoundList.length > 20) console.log(`  ... and ${notFoundList.length - 20} more`);
  }
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
