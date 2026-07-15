'use strict';
/**
 * sync-ar-tracker.cjs
 *
 * Watches Claims Tracker for records with Submission Status = "Billed"
 * and creates a matching AR Tracker record with 3 follow-up dates
 * (each 7 business days apart from the previous).
 *
 * Usage:
 *   node nocodb/sync-ar-tracker.cjs           → dry run
 *   node nocodb/sync-ar-tracker.cjs --apply   → write to AR Tracker
 */

const DRY_RUN = !process.argv.includes('--apply');

const fs   = require('fs');
const path = require('path');
const nc   = require('./nc-client.cjs');
const cfg  = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'nocodb-config.json'), 'utf8'));

const H = { 'xc-token': cfg.token, 'Content-Type': 'application/json' };

function addBusinessDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().split('T')[0];
}

async function fetchAll(tableId) {
  const rows = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const r = await fetch(
      `${cfg.baseUrl}/api/v2/tables/${tableId}/records?limit=${limit}&offset=${offset}`,
      { headers: H }
    );
    const d = await r.json();
    const list = d.list || [];
    rows.push(...list);
    if (list.length < limit) break;
    offset += limit;
  }
  return rows;
}

async function main() {
  console.log(DRY_RUN ? '[DRY RUN]\n' : '[APPLY]\n');

  console.log('Fetching Claims Tracker (Billed)...');
  const claims = await fetchAll(cfg.claimsTableId);
  const billed = claims.filter(r => r['Submission Status'] === 'Billed');
  console.log(`  ${billed.length} billed claims found\n`);

  console.log('Fetching AR Tracker (existing)...');
  const arRows = await fetchAll(cfg.arTableId);
  const existing = new Set(arRows.map(r => r['Claim']).filter(Boolean));
  console.log(`  ${arRows.length} existing AR records\n`);

  const toCreate = [];

  for (const claim of billed) {
    const claimNum = claim['Claim Number'];
    if (!claimNum) continue;
    if (existing.has(claimNum)) {
      console.log(`  skip (exists): ${claimNum}`);
      continue;
    }

    const submissionDate = claim['Submission Date'] || claim['Date of Service'];
    if (!submissionDate) {
      console.log(`  skip (no date): ${claimNum}`);
      continue;
    }

    const fu1 = addBusinessDays(submissionDate, 7);
    const fu2 = addBusinessDays(fu1, 7);
    const fu3 = addBusinessDays(fu2, 7);

    const record = {
      'Claim':           claimNum,
      'Patient Name':    claim['Patient Name'] || '',
      'Date of Service': claim['Date of Service'] || '',
      'Insurer':         claim['Insurer'] || '',
      'Submission Date': submissionDate,
      'F/U Date 1':      fu1,
      'F/U Date 2':      fu2,
      'F/U Date 3':      fu3,
      'AR Status':       'Open',
    };

    toCreate.push(record);
    console.log(`  + ${claimNum} | ${claim['Patient Name']} | F/U: ${fu1} / ${fu2} / ${fu3}`);
  }

  if (!toCreate.length) {
    console.log('\nNo new AR records to create.');
    return;
  }

  console.log(`\n${toCreate.length} new AR records to create.`);

  if (DRY_RUN) {
    console.log('\n→ Run with --apply to write.');
    return;
  }

  for (let i = 0; i < toCreate.length; i += 25) {
    const batch = toCreate.slice(i, i + 25);
    const r = await fetch(`${cfg.baseUrl}/api/v2/tables/${cfg.arTableId}/records`, {
      method: 'POST', headers: H, body: JSON.stringify(batch),
    });
    if (!r.ok) throw new Error(`POST AR records: ${r.status} ${await r.text()}`);
  }

  console.log(`✅ ${toCreate.length} AR records created.`);
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
