'use strict';
/**
 * Diagnoses why denials aren't being detected.
 * Checks both DaisyBill statuses and Dexter column values.
 */

const DB_KEY  = 'THnuRQHZk2CJEDJSL2nELZ64dcyJCz77PpVX';
const DB_BASE = 'https://go.daisybill.com/api/v1';
const DB_H    = { Authorization: `Bearer ${DB_KEY}`, Accept: 'application/json' };
const BP_ID   = 4204;

const DEXTER_CSV_URL = 'https://docs.google.com/spreadsheets/d/1x-Uck1oaG95r6DZjCOPUbBjRm-MWJf79lQRz4NUUxCE/gviz/tq?tqx=out:csv&sheet=Index';
const CUTOFF = '2026-06-01';

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i+1];
    if (inQuotes) {
      if (ch==='"'&&next==='"'){field+='"';i++;}
      else if(ch==='"'){inQuotes=false;}
      else{field+=ch;}
    } else {
      if(ch==='"'){inQuotes=true;}
      else if(ch===','){row.push(field);field='';}
      else if(ch==='\n'){row.push(field);rows.push(row);row=[];field='';}
      else if(ch==='\r'){/*skip*/}
      else{field+=ch;}
    }
  }
  if(field||row.length){row.push(field);rows.push(row);}
  return rows;
}

function normalizeDOS(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
  return null;
}

async function main() {
  // ── DAISYBILL ──────────────────────────────────────────────────────────────
  console.log('=== DAISYBILL ===');
  const res = await fetch(`${DB_BASE}/billing_providers/${BP_ID}/bills?page=1`, { headers: DB_H });
  const data = await res.json();
  const bills = data.bills || [];

  // Show status breakdown
  const statusMap = {};
  bills.forEach(b => { statusMap[b.status] = (statusMap[b.status]||0)+1; });
  console.log('Status breakdown (first page of 25):');
  Object.entries(statusMap).sort((a,b)=>b[1]-a[1]).forEach(([s,c]) => console.log(`  ${s}: ${c}`));

  // Show the 5 most recent bills
  console.log('\nMost recent 5 bills (first page):');
  bills.slice(0,5).forEach(b => console.log(`  ${b.date_of_service} | ${b.status} | id:${b.id}`));

  // ── DEXTER ─────────────────────────────────────────────────────────────────
  console.log('\n=== DEXTER ===');
  const sheetRes = await fetch(DEXTER_CSV_URL);
  const allRows = parseCSV(await sheetRes.text()).slice(1); // skip header

  // Show header to confirm column mapping
  const headerRes = await fetch(DEXTER_CSV_URL);
  const headerRows = parseCSV(await headerRes.text());
  console.log('Columns confirmed:');
  console.log('  Col 0 (DocType):', headerRows[0][0]);
  console.log('  Col 3 (Patient):', headerRows[0][3]);
  console.log('  Col 12 (DOS):   ', headerRows[0][12]);
  console.log('  Col 22 (Status):', headerRows[0][22]);

  // Count unique values in col 22 (EOB Status)
  const statusCounts = {};
  allRows.forEach(r => {
    const v = (r[22]||'').trim();
    if (v) statusCounts[v] = (statusCounts[v]||0)+1;
  });
  console.log('\nAll EOB Status values (col 22):');
  Object.entries(statusCounts).sort((a,b)=>b[1]-a[1]).forEach(([s,c]) => console.log(`  "${s}": ${c} rows`));

  // Find EOB rows with "Denied" in col 22, show their dates
  const denied = allRows.filter(r => (r[22]||'').trim().toLowerCase()==='denied' && (r[0]||'').trim().toLowerCase()==='eob');
  console.log(`\nTotal EOB rows with status "Denied": ${denied.length}`);

  if (denied.length) {
    console.log('Sample (up to 10):');
    denied.slice(0, 10).forEach((r, i) => {
      const dos = normalizeDOS(r[12]);
      console.log(`  [${i+1}] Patient: "${r[3]}" | DOS: "${r[12]}" → normalized: ${dos} | cutoff ok: ${dos >= CUTOFF}`);
    });
  }

  // Also: any row with "denied" anywhere in col 22 (case insensitive, partial match)
  const partialDenied = allRows.filter(r => (r[22]||'').toLowerCase().includes('denied'));
  if (partialDenied.length !== denied.length) {
    console.log(`\nNote: ${partialDenied.length} rows have "denied" anywhere in col 22 (vs exact match: ${denied.length})`);
    partialDenied.slice(0,5).forEach(r => console.log(`  Col22="${r[22]}" | DocType="${r[0]}"`));
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
