'use strict';
/**
 * encounter-sync.cjs
 *
 * 1. Pulls all Complete/Arrived appointments from DrChrono for Dr. Yu, Dr. Dean, Dr. Zhang
 *    from FROM_DATE to today.
 * 2. Fetches patient info (MRN, name, DOB) and line items (CPT codes) per appointment.
 * 3. Builds a DaisyBill index: MRN+DOS → submitted bill (using practice_internal_id).
 * 4. Compares against NocoDB claims (by claim number).
 * 5. Adds missing encounters to NocoDB.
 *    - Submission Status = "Sent" if found in DaisyBill, "Not Started" if not.
 *
 * Usage:
 *   node nocodb/encounter-sync.cjs              → dry run
 *   node nocodb/encounter-sync.cjs --apply      → write to NocoDB
 *   node nocodb/encounter-sync.cjs --from 2026-06-10   → override start date
 */

const DRY_RUN  = !process.argv.includes('--apply');
const fromArg  = (() => { const i = process.argv.indexOf('--from'); return i > -1 ? process.argv[i+1] : null; })();
const FROM_DATE = fromArg || '2026-06-10';
const TO_DATE   = new Date().toISOString().split('T')[0];

const DOCTORS = [
  { id: 245533, name: 'Dr. Jenny Yu'    },
  { id: 520661, name: 'Dr. Hafsah Dean' },
  { id: 526122, name: 'Dr. Angela Zhang'},
];
const BILLABLE_STATUSES = new Set(['Complete', 'Arrived']);

const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const nc   = require('./nc-client.cjs');

// ── DrChrono auth ─────────────────────────────────────────────────────────────
function loadTokens() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'drchrono-tokens.json'), 'utf8'));
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
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`DrChrono ${endpoint}: ${res.status}`);
  return res.json();
}

async function dcFetchAll(endpoint, params) {
  const out = [];
  let nextUrl = null;
  const first = await dcGet(endpoint, params);
  out.push(...(first.results || []));
  nextUrl = first.next;
  while (nextUrl) {
    const path = nextUrl.replace('https://drchrono.com', '');
    const data = await dcGet(path);
    out.push(...(data.results || []));
    nextUrl = data.next;
  }
  return out;
}

// ── DaisyBill ─────────────────────────────────────────────────────────────────
const DB_KEY  = 'Eew9UBykTwEqVD9qhBKPccRScrRF9L1zo9Lx';
const DB_BASE = 'https://go.daisybill.com/api/v1';
const DB_H    = { Authorization: `Bearer ${DB_KEY}`, Accept: 'application/json' };
const BP_ID   = 4204;
const SENT_STATUSES = new Set(['processed','submitted','denied','paid','appealed','forwarded']);

async function dbGet(url) {
  const fullUrl = url.startsWith('http') ? url : DB_BASE + url;
  const res = await fetch(fullUrl, { headers: DB_H, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`DaisyBill ${url}: ${res.status}`);
  return res.json();
}

async function buildDaisyBillIndex() {
  console.log('  Fetching DaisyBill bills...');
  const index = new Map(); // `${mrn}_${dos}` or `${nameLower}_${dos}` → { status, claimNumber }

  let page = 1;
  let total = 0;
  while (true) {
    const data = await dbGet(`/billing_providers/${BP_ID}/bills?page=${page}&page_size=25`);
    const bills = data.bills || [];
    if (!bills.length) break;
    total += bills.length;
    process.stdout.write(`\r    fetched ${total} bills...`);

    for (const bill of bills) {
      if (!SENT_STATUSES.has(bill.status)) continue;
      try {
        const injLink = (bill.links || []).find(l => l.rel === 'injury');
        if (!injLink) continue;
        const injury = await dbGet(injLink.href);
        const dos = injury.date_of_service || '';
        const claimNumber = injury.claim_number || '';
        const patLink = (injury.links || []).find(l => l.rel === 'patient');
        if (!patLink) continue;
        const patient = await dbGet(patLink.href);
        const mrn  = (patient.practice_internal_id || '').trim();
        const name = `${patient.first_name || ''} ${patient.last_name || ''}`.toLowerCase().trim();
        const val  = { status: bill.status, claimNumber };
        if (mrn && dos)  index.set(`${mrn}_${dos}`, val);
        if (name && dos) index.set(`${name}_${dos}`, val);
      } catch (_) {}
    }
    if (bills.length < 25) break;
    page++;
  }
  console.log(`\r    DaisyBill index built: ${index.size} entries from ${total} bills`);
  return index;
}

// ── helpers ───────────────────────────────────────────────────────────────────
function dosToYMD(dos) {
  if (!dos) return null;
  const d = new Date(dos);
  if (isNaN(d)) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}

function makeClaimNumber(dos, mrn, name, usedKeys) {
  let base;
  if (mrn && mrn.trim()) {
    base = `${dos.replace(/-/g,'')}-${mrn.trim()}`;
  } else if (name && name.trim()) {
    const parts = name.trim().toUpperCase().split(/\s+/);
    const last  = (parts[parts.length-1] || '').slice(0,4).padEnd(4,'X');
    const first = (parts[0] || '').slice(0,4).padEnd(4,'X');
    base = `${dos.replace(/-/g,'')}-${last}${first}`;
  } else {
    base = `${dos.replace(/-/g,'')}-UNKN`;
  }

  if (!usedKeys.has(base)) { usedKeys.add(base); return base; }
  for (let n = 1; n <= 99; n++) {
    const key = `${base}-${n}`;
    if (!usedKeys.has(key)) { usedKeys.add(key); return key; }
  }
  return base + '-X';
}

// ── patient cache ─────────────────────────────────────────────────────────────
const patientCache = new Map();
async function getPatient(id) {
  if (patientCache.has(id)) return patientCache.get(id);
  const p = await dcGet(`/api/patients/${id}`);
  patientCache.set(id, p);
  return p;
}

// ── line item cache ───────────────────────────────────────────────────────────
async function getCPTs(apptId) {
  try {
    const data = await dcGet('/api/line_items', { appointment: apptId });
    return (data.results || []).map(l => l.code).filter(Boolean);
  } catch (_) { return []; }
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  let tokens = loadTokens();
  tokens = await refreshIfNeeded(tokens);
  DC_TOKEN = tokens.access_token;

  console.log(DRY_RUN ? '\n[DRY RUN]\n' : '\n[APPLY]\n');
  console.log(`Date range: ${FROM_DATE} → ${TO_DATE}`);
  console.log(`Doctors: ${DOCTORS.map(d => d.name).join(', ')}\n`);

  // ── Step 1: existing NocoDB claims ─────────────────────────────────────────
  console.log('Loading NocoDB claims...');
  const existingRows = await nc.fetchAll(nc.CLAIMS);
  const existingKeys  = new Set(existingRows.map(r => r['Claim Number']).filter(Boolean));
  // Also build MRN+DOS index for dedup
  const existingMrnDos = new Set(
    existingRows
      .filter(r => r['MRN'] && r['Date of Service'])
      .map(r => `${r['MRN'].trim()}_${r['Date of Service']}`)
  );
  const usedKeys = new Set(existingKeys);
  console.log(`  ${existingRows.length} existing claims in NocoDB\n`);

  // ── Step 2: DaisyBill index ────────────────────────────────────────────────
  console.log('Building DaisyBill submission index...');
  const dbIndex = await buildDaisyBillIndex();
  console.log();

  // ── Step 3: DrChrono appointments ─────────────────────────────────────────
  console.log('Fetching DrChrono appointments...');
  const allAppts = [];
  for (const doc of DOCTORS) {
    process.stdout.write(`  ${doc.name}...`);
    const appts = await dcFetchAll('/api/appointments', {
      doctor:     doc.id,
      date_range: `${FROM_DATE}/${TO_DATE}`,
      page_size:  100,
    });
    const billable = appts.filter(a => BILLABLE_STATUSES.has(a.status));
    console.log(` ${billable.length} billable (of ${appts.length} total)`);
    billable.forEach(a => { a._doctor = doc.name; });
    allAppts.push(...billable);
  }
  console.log(`  Total billable appointments: ${allAppts.length}\n`);

  // ── Step 4: process each appointment ──────────────────────────────────────
  console.log('Processing appointments...');
  const toAdd = [];
  let alreadyInNC = 0, missingCount = 0, errors = 0;

  for (let i = 0; i < allAppts.length; i++) {
    const appt = allAppts[i];
    process.stdout.write(`\r  [${i+1}/${allAppts.length}] appt ${appt.id}...             `);

    const dos = dosToYMD(appt.scheduled_time);
    if (!dos) { errors++; continue; }

    let patient;
    try { patient = await getPatient(appt.patient); }
    catch (_) { errors++; continue; }

    const mrn  = (patient.chart_id || '').trim();
    const name = `${patient.first_name || ''} ${patient.last_name || ''}`.trim();
    const dob  = patient.date_of_birth || null;

    // Check if already in NocoDB by MRN+DOS
    if (mrn && existingMrnDos.has(`${mrn}_${dos}`)) { alreadyInNC++; continue; }

    // Check by patient name+DOS as fallback
    const nameDosKey = `${name.toLowerCase()}_${dos}`;
    const alreadyByName = existingRows.some(r =>
      (r['Patient Name'] || '').toLowerCase().trim() === name.toLowerCase() &&
      r['Date of Service'] === dos
    );
    if (alreadyByName) { alreadyInNC++; continue; }

    missingCount++;

    // Get CPT codes
    const cpts = await getCPTs(appt.id);
    const icds = (appt.icd10_codes || []).filter(Boolean);

    // Check DaisyBill
    const dbKey1 = mrn  ? `${mrn}_${dos}`              : null;
    const dbKey2 = name ? `${name.toLowerCase()}_${dos}` : null;
    const dbEntry = (dbKey1 && dbIndex.get(dbKey1)) || (dbKey2 && dbIndex.get(dbKey2)) || null;
    const submissionStatus = dbEntry ? 'Sent' : 'Not Started';

    const claimNumber = makeClaimNumber(dos, mrn, name, usedKeys);

    toAdd.push({
      'Claim Number':       claimNumber,
      'Patient Name':       name,
      'MRN':                mrn || null,
      'Date of Birth':      dob,
      'Date of Service':    dos,
      'CPT Codes':          cpts.join(', ') || null,
      'ICD-10 Codes':       icds.join(', ') || null,
      'Submission Status':  submissionStatus,
      'Owner':              'Unclaimed',
      'DrChrono Appt ID':   String(appt.id),
      'Action Notes':       `Synced from DrChrono (${appt._doctor}) — status: ${appt.status}`,
    });
  }

  console.log(`\n\n══════════════════════════════════════`);
  console.log(`Already in NocoDB:   ${alreadyInNC}`);
  console.log(`Missing (to add):    ${missingCount}`);
  console.log(`Errors:              ${errors}`);

  if (!toAdd.length) { console.log('\nNothing to add.'); return; }

  if (DRY_RUN) {
    console.log(`\nSample of what would be added (first 10):`);
    toAdd.slice(0,10).forEach(r => console.log(
      `  ${r['Claim Number'].padEnd(28)} | ${r['Patient Name'].padEnd(25)} | ${r['Date of Service']} | CPT: ${r['CPT Codes']||'none'} | ${r['Submission Status']}`
    ));
    console.log('\n→ Run with --apply to write to NocoDB.');
    return;
  }

  console.log(`\nAdding ${toAdd.length} claims to NocoDB...`);
  await nc.createBatch(nc.CLAIMS, toAdd);
  console.log(`✅ Done — ${toAdd.length} claims added.`);
  console.log('\nRun daisybill-sync-nc.cjs --apply to update any remaining Sent statuses.');
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
