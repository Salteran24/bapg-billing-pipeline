'use strict';
const DB_KEY  = 'THnuRQHZk2CJEDJSL2nELZ64dcyJCz77PpVX';
const DB_BASE = 'https://go.daisybill.com/api/v1';
const DB_H    = { Authorization: `Bearer ${DB_KEY}`, Accept: 'application/json' };
const BP_ID   = 4204;

const DEXTER_CSV_URL = 'https://docs.google.com/spreadsheets/d/1x-Uck1oaG95r6DZjCOPUbBjRm-MWJf79lQRz4NUUxCE/gviz/tq?tqx=out:csv&sheet=Index';

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

async function main() {
  // ── DAISYBILL: check ALL statuses across all pages ─────────────────────────
  console.log('=== DAISYBILL: Status breakdown across ALL bills ===');
  const statusMap = {};
  let page = 1, total = 0;
  while (true) {
    const res = await fetch(`${DB_BASE}/billing_providers/${BP_ID}/bills?page=${page}`, { headers: DB_H });
    const data = await res.json();
    const bills = data.bills || [];
    if (!bills.length) break;
    bills.forEach(b => {
      statusMap[b.status] = (statusMap[b.status]||0)+1;
    });
    total += bills.length;
    if (bills.length < 25) break;
    page++;
  }
  console.log(`Total bills: ${total}`);
  Object.entries(statusMap).sort((a,b)=>b[1]-a[1]).forEach(([s,c])=>console.log(`  ${s}: ${c}`));

  console.log('\nMost recent bill dates by status:');
  // Fetch first page again to show date range
  const firstPage = await fetch(`${DB_BASE}/billing_providers/${BP_ID}/bills?page=1`, { headers: DB_H }).then(r=>r.json());
  const lastPage  = await fetch(`${DB_BASE}/billing_providers/${BP_ID}/bills?page=${page}`, { headers: DB_H }).then(r=>r.json());
  console.log('  Newest:', firstPage.bills?.[0]?.date_of_service, firstPage.bills?.[0]?.status);
  console.log('  Oldest:', lastPage.bills?.slice(-1)[0]?.date_of_service, lastPage.bills?.slice(-1)[0]?.status);

  // ── DEXTER: find "Denied" in ANY column ────────────────────────────────────
  console.log('\n=== DEXTER: Searching ALL columns for "Denied" ===');
  const sheetRes = await fetch(DEXTER_CSV_URL);
  const rows = parseCSV(await sheetRes.text());
  const header = rows[0];
  const data = rows.slice(1);

  console.log(`Total rows (including header): ${rows.length}`);
  console.log(`Data rows: ${data.length}`);

  // Find which columns ever contain "denied"
  const colsWithDenied = {};
  data.forEach((row, ri) => {
    row.forEach((cell, ci) => {
      if ((cell||'').toLowerCase().includes('denied')) {
        colsWithDenied[ci] = (colsWithDenied[ci]||0)+1;
      }
    });
  });

  if (Object.keys(colsWithDenied).length === 0) {
    console.log('  "Denied" not found in ANY column!');
    // Check if the word exists at all in the raw text
    const raw = await fetch(DEXTER_CSV_URL).then(r=>r.text());
    const occurrences = (raw.match(/denied/gi)||[]).length;
    console.log(`  Raw text occurrences of "denied" (case-insensitive): ${occurrences}`);
    if (occurrences > 0) {
      // Show context around first occurrence
      const idx = raw.toLowerCase().indexOf('denied');
      console.log('  Context around first occurrence:');
      console.log('  ', raw.substring(Math.max(0,idx-100), idx+100).replace(/\n/g,'↵'));
    }
  } else {
    console.log('  Columns containing "Denied":');
    Object.entries(colsWithDenied).sort((a,b)=>b[1]-a[1]).forEach(([ci, count]) => {
      console.log(`    Col ${ci} ("${header[ci]||'?'}"): ${count} rows`);
    });

    // Show sample rows with Denied
    const deniedRows = data.filter(r => r.some(c=>(c||'').toLowerCase().includes('denied')));
    console.log(`\n  Sample denied rows (up to 5):`);
    deniedRows.slice(0,5).forEach((row,i) => {
      const deniedCols = row.map((c,ci)=>(c||'').toLowerCase().includes('denied')?ci:-1).filter(c=>c>=0);
      console.log(`  [${i+1}] DocType="${row[0]}" | Patient="${row[3]}" | DOS="${row[12]}" | Denied in cols: ${deniedCols.join(',')}`);
      deniedCols.forEach(ci => console.log(`       Col ${ci} ("${header[ci]||'?'}"): "${row[ci]}"`));
    });
  }
}

main().catch(e=>{console.error('Fatal:',e.message);process.exit(1);});
