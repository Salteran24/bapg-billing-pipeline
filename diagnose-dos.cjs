'use strict';
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
      else if(ch==='\r'){/* skip */}
      else{field+=ch;}
    }
  }
  if(field||row.length){row.push(field);rows.push(row);}
  return rows;
}

function normDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  return null;
}

async function main() {
  const res = await fetch(DEXTER_CSV_URL);
  const rows = parseCSV(await res.text()).slice(1);

  const all = rows.filter(r =>
    (r[0]||'').toLowerCase() === 'eob' &&
    (r[20]||'').toLowerCase() === 'denied'
  );
  console.log(`Total EOB Denied rows: ${all.length}`);

  const withDOS = all.filter(r => normDate(r[12]));
  const noDOS   = all.filter(r => !normDate(r[12]));
  console.log(`  Has DOS (col 12): ${withDOS.length}`);
  console.log(`  No DOS:           ${noDOS.length}`);

  const validDOS = withDOS.filter(r => {
    const d = normDate(r[12]);
    return d >= '2020-01-01' && d <= '2030-01-01';
  });
  const june1Plus = validDOS.filter(r => normDate(r[12]) >= CUTOFF);
  console.log(`  Valid DOS (not typo): ${validDOS.length}`);
  console.log(`  DOS >= June 1, 2026:  ${june1Plus.length}`);

  console.log('\nAll rows with DOS >= June 1:');
  june1Plus.forEach((r, i) => {
    const dos = normDate(r[12]);
    const docDate = normDate(r[16]);
    const norm = s => (s||'').replace(/\s+/g,' ').trim().toLowerCase();
    const rowNum = rows.indexOf(r) + 2; // +1 header, +1 for 1-index
    console.log(`  [${i+1}] row~${rowNum} | Patient="${r[3]}" | DOS=${dos} | DocDate=${docDate} | Reason="${r[13]}"`);
  });
}

main().catch(e=>{console.error('Fatal:',e.message);process.exit(1);});
