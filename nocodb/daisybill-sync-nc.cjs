'use strict';
/**
 * daisybill-sync-nc.cjs — marks NocoDB claims as "Billed" if a matching
 * bill exists in DaisyBill with a submitted/processed status.
 *
 * Match key: normalized patient name + Date of Service.
 * Names are normalized to strip annotations like "(LEFT FOOT)" or
 * "- LEFT ANKLE" that billers add in NocoDB.
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
// strip biller annotations: "(LEFT FOOT)", "- LEFT ANKLE", "(WC)", middle initials
const norm = (n) => (n || '')
  .replace(/\(.*?\)/g, ' ')
  .replace(/\s+[-–]\s+.*$/, ' ')
  .replace(/\b[A-Z]\.\s*/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();
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
      const chargeCents = bill.charge_cents || 0;
      if (!dbLookup.has(key)) {
        dbLookup.set(key, { name, dos: bill.date_of_service, status: bill.status, statusUpdated: bill.status_updated_at, chargeCents });
      } else {
        // multiple bills for same patient+DOS (e.g. two body parts): sum charges
        dbLookup.get(key).chargeCents += chargeCents;
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
    if (sub === 'canceled') continue;
    const name = row['Patient Name'];
    const dos  = row['Date of Service'];
    if (!name || !dos) continue;
    const key = `${norm(name)}|${dos}`;
    const match = dbLookup.get(key);
    if (!match) continue;

    const dbCharge = match.chargeCents ? Math.round(match.chargeCents) / 100 : null;
    const patch = {};
    if (sub !== 'billed') {
      patch['Submission Status'] = 'Billed';
      if (match.statusUpdated) patch['Submission Date'] = match.statusUpdated.slice(0, 10);
    }
    if (dbCharge && Number(row['Charges'] || 0) !== dbCharge) {
      patch['Charges'] = dbCharge;
    }
    if (row['Billing Platform'] !== 'DaisyBill') {
      patch['Billing Platform'] = 'DaisyBill';
    }
    if (!Object.keys(patch).length) continue;

    console.log(`  ✓ ${row['Claim Number']} | ${name} | ${dos}${patch['Charges'] ? ` | $${dbCharge.toFixed(2)}` : ''}`);
    updates.push({ Id: row.Id, ...patch });
  }

  console.log(`\n${updates.length} claims to update (status and/or charges)`);
  if (!updates.length || DRY_RUN) {
    console.log(DRY_RUN ? 'Dry run done — re-run with --apply to write.' : 'Nothing to update.');
    return;
  }

  await nc.updateBatch(nc.CLAIMS, updates);
  console.log(`✅ Done — ${updates.length} claims updated`);
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
