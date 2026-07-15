'use strict';
/**
 * backfill-dob.cjs — fills the "Date of Birth" field in NocoDB Claims Tracker
 * by looking up each patient in DrChrono.
 *
 * Lookup order:
 *   1. By chart_id (MRN) if present
 *   2. By first+last name otherwise
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

// ── patient cache ─────────────────────────────────────────────────────────────
const cache = new Map(); // key → { dob, name } | null

async function lookupByMRN(mrn) {
  if (cache.has('mrn:' + mrn)) return cache.get('mrn:' + mrn);
  const d = await dcGet('/api/patients', { chart_id: mrn, doctor: 245533 });
  const p = (d.results || [])[0] || null;
  const val = p ? { dob: p.date_of_birth, name: `${p.first_name} ${p.last_name}` } : null;
  cache.set('mrn:' + mrn, val);
  return val;
}

async function lookupByName(fullName) {
  const key = 'name:' + fullName.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const parts = fullName.trim().split(/\s+/);
  const last  = parts[parts.length - 1];
  const first = parts[0];
  const d = await dcGet('/api/patients', { last_name: last, first_name: first, doctor: 245533 });
  const results = d.results || [];
  const norm = s => (s || '').toLowerCase().trim();
  const p = results.find(r => norm(r.first_name) === norm(first) && norm(r.last_name) === norm(last))
         || (results.length === 1 ? results[0] : null);
  const val = p ? { dob: p.date_of_birth, name: `${p.first_name} ${p.last_name}` } : null;
  cache.set(key, val);
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
  const needDOB = rows.filter(r => !r['Date of Birth'] && (r.MRN?.trim() || r['Patient Name']?.trim()));
  console.log(`  ${rows.length} total, ${needDOB.length} missing DOB and have a name/MRN\n`);

  let found = 0, notFound = 0, errors = 0;
  const updates = [];

  for (let i = 0; i < needDOB.length; i++) {
    const row  = needDOB[i];
    const mrn  = row.MRN?.trim();
    const name = row['Patient Name']?.trim();
    process.stdout.write(`\r  [${i+1}/${needDOB.length}] ${row['Claim Number']}...           `);

    let result = null;
    try {
      result = mrn ? await lookupByMRN(mrn) : await lookupByName(name);
    } catch (e) {
      errors++;
      continue;
    }

    if (result?.dob) {
      found++;
      updates.push({ Id: row.Id, 'Date of Birth': result.dob });
    } else {
      notFound++;
    }
  }

  console.log(`\n\n  Found DOB: ${found} | Not in DrChrono: ${notFound} | Errors: ${errors}`);

  if (!updates.length) { console.log('Nothing to update.'); return; }

  if (DRY_RUN) {
    console.log('\nSample updates:');
    updates.slice(0, 10).forEach(u => {
      const row = needDOB.find(r => r.Id === u.Id);
      console.log(`  ${row?.['Claim Number']} | ${row?.['Patient Name']} → DOB: ${u['Date of Birth']}`);
    });
    console.log('\n→ Run with --apply to write.');
    return;
  }

  console.log(`\nWriting ${updates.length} DOB values to NocoDB...`);
  await nc.updateBatch(nc.CLAIMS, updates);
  console.log(`✅ Done — ${updates.length} records updated.`);
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
