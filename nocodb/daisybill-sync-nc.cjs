'use strict';
/**
 * daisybill-sync-nc.cjs — marks NocoDB claims as "Sent" if a matching
 * bill exists in DaisyBill with a submitted/processed status.
 *
 * Usage:
 *   node nocodb/daisybill-sync-nc.cjs           → dry run
 *   node nocodb/daisybill-sync-nc.cjs --apply   → apply changes
 */

const DRY_RUN = !process.argv.includes('--apply');
const nc = require('./nc-client.cjs');

const DB_KEY  = 'Eew9UBykTwEqVD9qhBKPccRScrRF9L1zo9Lx';
const DB_BASE = 'https://go.daisybill.com/api/v1';
const DB_H    = { Authorization: `Bearer ${DB_KEY}`, Accept: 'application/json' };
const BP_ID   = 4204;
const PAGE_SIZE = 25;

const SENT_STATUSES = new Set(['processed', 'submitted', 'denied', 'paid', 'appealed', 'forwarded']);
const norm = (n) => (n || '').replace(/\s+/g, ' ').trim().toLowerCase();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function dbGet(path) {
  const res = await fetch(`${DB_BASE}${path}`, { headers: DB_H, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`DaisyBill ${path}: ${res.status}`);
  return res.json();
}

async function dbFetchAll(path, arrayKey) {
  const results = [];
  let page = 1;
  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await dbGet(`${path}${sep}page=${page}`);
    const items = data[arrayKey] || [];
    if (!items.length) break;
    results.push(...items);
    if (items.length < PAGE_SIZE) break;
    page++;
    process.stdout.write(`\r  Fetched ${results.length} bills (page ${page - 1})...`);
  }
  return results;
}

async function main() {
  if (DRY_RUN) console.log('DRY RUN — pass --apply to write\n');

  console.log('Fetching DaisyBill bills...');
  const bills = await dbFetchAll(`/billing_providers/${BP_ID}/bills`, 'bills');
  console.log(`\n  ${bills.length} total, ${bills.filter(b => SENT_STATUSES.has(b.status)).length} sent\n`);

  const sentBills = bills.filter(b => SENT_STATUSES.has(b.status));
  const patientCache = {};

  async function getPatientName(patientId) {
    if (patientCache[patientId]) return patientCache[patientId];
    const p = await dbGet(`/patients/${patientId}`);
    const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    patientCache[patientId] = name;
    return name;
  }

  console.log('Resolving patient names...');
  const dbLookup = new Map();
  let resolved = 0, failed = 0;

  for (let i = 0; i < sentBills.length; i++) {
    const bill = sentBills[i];
    process.stdout.write(`\r  ${i + 1}/${sentBills.length} (${resolved} ok)...`);
    const injuryHref = bill.links?.find(l => l.rel === 'injury')?.href;
    if (!injuryHref) { failed++; continue; }
    try {
      const injury = await dbGet(injuryHref.replace('/api/v1', ''));
      const patientHref = injury.links?.find(l => l.rel === 'patient')?.href;
      if (!patientHref) { failed++; continue; }
      const patientId = patientHref.split('/').pop();
      const name = await getPatientName(patientId);
      const key = `${norm(name)}|${bill.date_of_service}`;
      if (!dbLookup.has(key)) {
        dbLookup.set(key, { name, dos: bill.date_of_service, status: bill.status, statusUpdated: bill.status_updated_at });
      }
      resolved++;
    } catch { failed++; await sleep(200); }
    if ((i + 1) % 10 === 0) await sleep(100);
  }
  console.log(`\n  Resolved ${resolved} (${failed} skipped)\n`);

  console.log('Fetching NocoDB claims...');
  const claims = await nc.fetchAll(nc.CLAIMS);
  console.log(`  ${claims.length} claims\n`);

  const updates = [];
  for (const row of claims) {
    const sub = (row['Submission Status'] || '').toLowerCase();
    if (sub === 'sent' || sub === 'done') continue;
    const name = row['Patient Name'];
    const dos  = row['Date of Service'];
    if (!name || !dos) continue;
    const key = `${norm(name)}|${dos}`;
    const match = dbLookup.get(key);
    if (match) {
      console.log(`  ✓ ${row['Claim Number']} | ${name} | ${dos}`);
      updates.push({
        Id: row.Id,
        'Submission Status': 'Sent',
        ...(match.statusUpdated ? { 'Submission Date': match.statusUpdated.slice(0, 10) } : {}),
      });
    }
  }

  console.log(`\n${updates.length} claims to mark as "Sent"`);
  if (!updates.length || DRY_RUN) {
    console.log(DRY_RUN ? 'Dry run done — re-run with --apply to write.' : 'Nothing to update.');
    return;
  }

  await nc.updateBatch(nc.CLAIMS, updates);
  console.log(`✅ Done — ${updates.length} claims marked as "Sent"`);
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
