'use strict';
/**
 * backfill-dob.cjs — fills AND verifies "Date of Birth" + "MRN" in NocoDB
 * Claims Tracker using the exact patient linked to each DrChrono appointment.
 *
 * Lookup order (most accurate first):
 *   1. DrChrono Appt ID → appointment → patient ID → patient record (exact, no guessing)
 *   2. By chart_id (MRN) if no appt ID
 *   3. NEVER matches by name alone — that caused wrong-patient DOBs
 *      (e.g. two patients named Maria Alvarez).
 *
 * Rows WITH an appt ID are also re-verified: if the stored DOB or MRN
 * disagrees with the patient actually linked to the appointment, it is corrected.
 *
 * Usage:
 *   node nocodb/backfill-dob.cjs           → dry run
 *   node nocodb/backfill-dob.cjs --apply   → write to NocoDB
 */

const DRY_RUN = !process.argv.includes('--apply');

const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const nc   = require('./nc-client.cjs');

// ── DrChrono auth ────────────────────────────────────────────────────────────
function loadTokens() {
  const f = path.join(ROOT, 'drchrono-tokens.json');
  if (!fs.existsSync(f)) throw new Error('drchrono-tokens.json not found. Run drchrono-auth.cjs first.');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function saveTokens(t) { fs.writeFileSync(path.join(ROOT, 'drchrono-tokens.json'), JSON.stringify(t, null, 2)); }

async function refreshIfNeeded(tokens) {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'drchrono-config.json'), 'utf8'));
  if (Date.now() < tokens.obtained_at + (tokens.expires_in - 600) * 1000) return tokens;
  const res = await fetch('https://drchrono.com/o/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, ...cfg }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const fresh = { ...await res.json(), obtained_at: Date.now() };
  saveTokens(fresh);
  return fresh;
}

let DC_TOKEN = '';
async function dcGet(endpoint, params = {}) {
  const q = Object.keys(params).length ? '?' + new URLSearchParams(params) : '';
  const res = await fetch(`https://drchrono.com${endpoint}${q}`, {
    headers: { Authorization: `Bearer ${DC_TOKEN}` },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`DrChrono ${endpoint}: ${res.status}`);
  return res.json();
}

// ── caches ───────────────────────────────────────────────────────────────────
const patientCache = new Map(); // patientId → { dob, mrn, name } | null
const apptCache    = new Map(); // apptId → patientId | null

async function getPatientById(patientId) {
  const key = String(patientId);
  if (patientCache.has(key)) return patientCache.get(key);
  let val = null;
  try {
    const p = await dcGet(`/api/patients/${patientId}`);
    val = {
      dob:  p.date_of_birth || null,
      mrn:  p.chart_id ? String(p.chart_id) : null,
      name: `${p.first_name} ${p.last_name}`,
    };
  } catch {}
  patientCache.set(key, val);
  return val;
}

async function lookupByApptId(apptId) {
  const key = String(apptId);
  let patientId = apptCache.get(key);
  if (patientId === undefined) {
    try {
      const appt = await dcGet(`/api/appointments/${apptId}`);
      patientId = appt.patient || null;
    } catch { patientId = null; }
    apptCache.set(key, patientId);
  }
  return patientId ? getPatientById(patientId) : null;
}

async function lookupByMRN(mrn) {
  const key = 'mrn:' + mrn;
  if (patientCache.has(key)) return patientCache.get(key);
  let val = null;
  try {
    const d = await dcGet('/api/patients', { chart_id: mrn, doctor: 245533 });
    const p = (d.results || [])[0] || null;
    if (p) val = { dob: p.date_of_birth || null, mrn: p.chart_id ? String(p.chart_id) : null, name: `${p.first_name} ${p.last_name}` };
  } catch {}
  patientCache.set(key, val);
  return val;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  let tokens = loadTokens();
  tokens = await refreshIfNeeded(tokens);
  DC_TOKEN = tokens.access_token;

  console.log(DRY_RUN ? '[DRY RUN]\n' : '[APPLY]\n');

  console.log('Fetching NocoDB claims...');
  const rows = await nc.fetchAll(nc.CLAIMS);

  // Rows with an appt ID get verified (even if DOB/MRN present).
  // Rows without appt ID only get looked up if DOB or MRN is missing.
  const targets = rows.filter(r =>
    r['DrChrono Appt ID'] ||
    ((!r['Date of Birth'] || !r.MRN?.trim()) && r.MRN?.trim())
  );
  console.log(`  ${rows.length} total, ${targets.length} to verify/backfill\n`);

  let filled = 0, corrected = 0, ok = 0, notFound = 0, errors = 0;
  const updates = [];
  const corrections = [];

  for (let i = 0; i < targets.length; i++) {
    const row = targets[i];
    process.stdout.write(`\r  [${i + 1}/${targets.length}] ${row['Claim Number']}...           `);

    let result = null;
    try {
      result = row['DrChrono Appt ID']
        ? await lookupByApptId(row['DrChrono Appt ID'])
        : await lookupByMRN(row.MRN.trim());
    } catch { errors++; continue; }

    if (!result) { notFound++; continue; }

    const curDob = (row['Date of Birth'] || '').slice(0, 10) || null;
    const curMrn = row.MRN?.trim() || null;
    const patch  = {};

    if (result.dob && result.dob !== curDob) patch['Date of Birth'] = result.dob;
    if (result.mrn && result.mrn !== curMrn) patch['MRN'] = result.mrn;

    if (!Object.keys(patch).length) { ok++; continue; }

    if (curDob || curMrn) {
      corrected++;
      corrections.push(
        `  FIX ${row['Claim Number']} | ${row['Patient Name']} → ${result.name}` +
        (patch['Date of Birth'] ? ` | DOB ${curDob || '—'} → ${patch['Date of Birth']}` : '') +
        (patch['MRN'] ? ` | MRN ${curMrn || '—'} → ${patch['MRN']}` : '')
      );
    } else {
      filled++;
    }
    updates.push({ Id: row.Id, ...patch });
  }

  console.log(`\n\n  OK (already correct): ${ok}`);
  console.log(`  Filled (was empty):   ${filled}`);
  console.log(`  Corrected (was wrong): ${corrected}`);
  console.log(`  Not found in DrChrono: ${notFound} | Errors: ${errors}`);

  if (corrections.length) {
    console.log('\nCorrections:');
    corrections.forEach(c => console.log(c));
  }

  if (!updates.length) { console.log('\nNothing to update.'); return; }

  if (DRY_RUN) {
    console.log(`\n${updates.length} updates pending. → Run with --apply to write.`);
    return;
  }

  console.log(`\nWriting ${updates.length} updates to NocoDB...`);
  await nc.updateBatch(nc.CLAIMS, updates);
  console.log(`✅ Done — ${updates.length} records updated.`);
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
