'use strict';
/**
 * explore-drchrono.cjs
 * Dumps available fields from DrChrono: patient, appointment, line_items, and billing endpoints.
 */

const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

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

let TOKEN = '';
async function get(endpoint, params = {}) {
  const q = Object.keys(params).length ? '?' + new URLSearchParams(params) : '';
  const res = await fetch(`https://drchrono.com${endpoint}${q}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${endpoint}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  let tokens = loadTokens();
  tokens = await refreshIfNeeded(tokens);
  TOKEN = tokens.access_token;

  // ── 1. Patient fields ──────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('PATIENT FIELDS (first result)');
  console.log('══════════════════════════════════════');
  const patients = await get('/api/patients', { doctor: 245533, page_size: 1 });
  const patient = (patients.results || [])[0];
  if (patient) {
    Object.entries(patient).forEach(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v ?? '').slice(0, 80);
      console.log(`  ${k.padEnd(35)} = ${val}`);
    });
  }

  // ── 2. Appointment fields ──────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('APPOINTMENT FIELDS (most recent)');
  console.log('══════════════════════════════════════');
  const today = new Date();
  const from  = new Date(today); from.setDate(from.getDate() - 30);
  const fmt   = d => d.toISOString().split('T')[0];
  const appts = await get('/api/appointments', { doctor: 245533, date_range: `${fmt(from)}/${fmt(today)}`, page_size: 1 });
  const appt  = (appts.results || [])[0];
  if (appt) {
    Object.entries(appt).forEach(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v ?? '').slice(0, 80);
      console.log(`  ${k.padEnd(35)} = ${val}`);
    });
  }

  // ── 3. Line item fields ────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('LINE ITEM FIELDS (first result)');
  console.log('══════════════════════════════════════');
  const lineItems = await get('/api/line_items', { doctor: 245533, page_size: 1 });
  const li = (lineItems.results || [])[0];
  if (li) {
    Object.entries(li).forEach(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v ?? '').slice(0, 80);
      console.log(`  ${k.padEnd(35)} = ${val}`);
    });
  }

  // ── 4. Billing endpoints probe ─────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('BILLING / CLAIM ENDPOINTS PROBE');
  console.log('══════════════════════════════════════');
  const endpoints = [
    '/api/billing_notes',
    '/api/claim_billings',
    '/api/claims',
    '/api/insurance_claims',
    '/api/patient_insurance',
  ];
  for (const ep of endpoints) {
    try {
      const d = await get(ep, { doctor: 245533, page_size: 1 });
      const first = (d.results || [])[0];
      console.log(`\n  ✅ ${ep} — ${d.count ?? '?'} total`);
      if (first) Object.keys(first).forEach(k => console.log(`      ${k}`));
    } catch (e) {
      console.log(`  ❌ ${ep} — ${e.message.split('\n')[0]}`);
    }
  }

  // ── 5. Insurance per patient ───────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('INSURANCE FIELDS (first patient)');
  console.log('══════════════════════════════════════');
  if (patient) {
    try {
      const ins = await get('/api/insurances', { patient: patient.id, page_size: 1 });
      const i = (ins.results || [])[0];
      if (i) Object.entries(i).forEach(([k, v]) => {
        const val = typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v ?? '').slice(0, 80);
        console.log(`  ${k.padEnd(35)} = ${val}`);
      });
    } catch (e) {
      console.log(`  ❌ ${e.message}`);
    }
  }
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
