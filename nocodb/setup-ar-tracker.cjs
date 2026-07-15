'use strict';
/**
 * setup-ar-tracker.cjs
 * Adds missing columns to the AR Tracker table.
 * Safe to re-run — skips columns that already exist.
 */

const fs  = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'nocodb-config.json'), 'utf8'));

const TABLE_ID = cfg.arTableId;
const H = { 'xc-token': cfg.token, 'Content-Type': 'application/json' };

async function getExistingCols() {
  const r = await fetch(`${cfg.baseUrl}/api/v2/meta/tables/${TABLE_ID}`, { headers: H });
  const d = await r.json();
  return new Set((d.columns || []).map(c => c.title));
}

async function addCol(body) {
  const r = await fetch(`${cfg.baseUrl}/api/v1/db/meta/tables/${TABLE_ID}/columns`, {
    method: 'POST', headers: H, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`addCol "${body.title}": ${r.status} ${await r.text()}`);
  return r.json();
}

async function main() {
  const existing = await getExistingCols();
  console.log('Existing columns:', [...existing].filter(t => !t.startsWith('nc_') && !['Id','CreatedAt','UpdatedAt','__nc_deleted','nc_row_meta'].includes(t)).join(', '));

  const toAdd = [
    { title: 'Patient Name',   uidt: 'SingleLineText' },
    { title: 'Submission Date', uidt: 'Date', meta: { date_format: 'YYYY-MM-DD' } },
    { title: 'F/U Date 1',     uidt: 'Date', meta: { date_format: 'YYYY-MM-DD' } },
    { title: 'F/U No. 1',      uidt: 'LongText' },
    { title: 'F/U Date 2',     uidt: 'Date', meta: { date_format: 'YYYY-MM-DD' } },
    { title: 'F/U No. 2',      uidt: 'LongText' },
    { title: 'F/U Date 3',     uidt: 'Date', meta: { date_format: 'YYYY-MM-DD' } },
    { title: 'F/U No. 3',      uidt: 'LongText' },
  ];

  for (const col of toAdd) {
    if (existing.has(col.title)) {
      console.log(`  skip (exists): ${col.title}`);
      continue;
    }
    process.stdout.write(`  adding: ${col.title}...`);
    await addCol(col);
    console.log(' done');
  }
  console.log('\nAR Tracker columns ready.');
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
