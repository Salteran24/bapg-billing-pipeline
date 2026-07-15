'use strict';
// Shows the date fields (DOS col12, DocDate col16) for denied rows
// to understand what date to filter on.

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
  const sheetRes = await fetch(DEXTER_CSV_URL);
  const rows = parseCSV(await sheetRes.text());
  const data = rows.slice(1);

  const denied = data.filter(r =>
    (r[0]||'').toLowerCase()==='eob' &&
    (r[20]||'').toLowerCase()==='denied'
  );

  console.log(`Total EOB Denied rows: ${denied.length}`);

  // Count which rows have DOS vs DocDate
  let hasDOS = 0, hasDocDate = 0, hasNeither = 0;
  const docDateCounts = {};

  denied.forEach(r => {
    const dos     = normalizeDOS(r[12]);
    const docDate = normalizeDOS(r[16]);
    if (dos) hasDOS++;
    if (docDate) hasDocDate++;
    if (!dos && !docDate) hasNeither++;

    // Count docDate by month
    if (docDate && docDate >= '2025-01-01' && docDate <= '2030-01-01') {
      const month = docDate.substring(0, 7);
      docDateCounts[month] = (docDateCounts[month]||0)+1;
    }
  });

  console.log(`\nDate field coverage:`);
  console.log(`  Has DOS (col 12): ${hasDOS}`);
  console.log(`  Has Doc Date (col 16): ${hasDocDate}`);
  console.log(`  Has neither: ${hasNeither}`);

  console.log(`\nDenied rows by Doc Date month (col 16):`);
  Object.entries(docDateCounts).sort().forEach(([m,c])=>console.log(`  ${m}: ${c}`));

  // Show denied rows with DocDate >= cutoff
  const recent = denied.filter(r => {
    const d = normalizeDOS(r[16]) || normalizeDOS(r[12]);
    return d && d >= CUTOFF && d <= '2027-01-01';
  });
  console.log(`\nDenied EOB rows with date >= ${CUTOFF}: ${recent.length}`);
  recent.slice(0,10).forEach((r,i)=>{
    const dos = normalizeDOS(r[12]);
    const docDate = normalizeDOS(r[16]);
    console.log(`  [${i+1}] Patient="${r[3]}" | DOS="${r[12]}"→${dos} | DocDate="${r[16]}"→${docDate}`);
  });
}

main().catch(e=>{console.error('Fatal:',e.message);process.exit(1);});
