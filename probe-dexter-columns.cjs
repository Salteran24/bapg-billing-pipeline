'use strict';
/**
 * probe-dexter-columns.cjs — prints the first 5 data rows of the Dexter Index
 * sheet with column indices, so you can confirm the DEXTER_COL_* values in
 * denial-notifier.cjs are correct.
 *
 * Prerequisites:
 *   - google-service-account.json present (see GOOGLE SETUP in denial-notifier.cjs)
 *   - Run: npm install googleapis
 *
 * Usage:
 *   node probe-dexter-columns.cjs
 */

const DEXTER_SHEET_ID  = '1x-Uck1oaG95r6DZjCOPUbBjRm-MWJf79lQRz4NUUxCE';
const DEXTER_SHEET_TAB = 'Index';
const DEXTER_CSV_URL   = `https://docs.google.com/spreadsheets/d/${DEXTER_SHEET_ID}/export?format=csv&sheet=${encodeURIComponent(DEXTER_SHEET_TAB)}`;
const PREVIEW_ROWS     = 5;

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"')            { inQuotes = false; }
      else                            { field += ch; }
    } else {
      if      (ch === '"')  { inQuotes = true; }
      else if (ch === ',')  { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip */ }
      else                  { field += ch; }
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function getSheetNames() {
  // The gviz endpoint returns JSON with sheet metadata
  const url = `https://docs.google.com/spreadsheets/d/${DEXTER_SHEET_ID}/gviz/tq?tqx=out:json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  // Response is wrapped: google.visualization.Query.setResponse({...})
  // Extract sheet names from the raw text
  const matches = [...text.matchAll(/"label":"([^"]+)"/g)];
  return matches.map(m => m[1]);
}

async function fetchTabAsRows(tabName) {
  const url = `https://docs.google.com/spreadsheets/d/${DEXTER_SHEET_ID}/export?format=csv&sheet=${encodeURIComponent(tabName)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) return null;
  return parseCSV(await res.text());
}

async function main() {
  // Step 0: discover available tabs
  console.log('Discovering sheet tabs...');
  try {
    const names = await getSheetNames();
    if (names.length) {
      console.log('Available tabs:', names.join(', '));
    }
  } catch { /* non-fatal */ }

  // Step 1: fetch default (first) sheet to show structure
  console.log(`\nFetching default (first) sheet...`);
  const defaultUrl = `https://docs.google.com/spreadsheets/d/${DEXTER_SHEET_ID}/export?format=csv`;
  const res = await fetch(defaultUrl, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) { console.error(`HTTP ${res.status} — is the sheet set to "Anyone with the link"?`); process.exit(1); }
  const rows = parseCSV(await res.text());
  if (!rows.length) {
    console.log('Sheet appears to be empty.');
    return;
  }

  // Print header row
  const header = rows[0];
  console.log('\n── HEADER ROW ──');
  header.forEach((col, i) => {
    const letter = String.fromCharCode(65 + i); // A, B, C...
    console.log(`  Col ${i} (${letter}): ${col}`);
  });

  // Print first few data rows
  const dataRows = rows.slice(1, 1 + PREVIEW_ROWS);
  console.log(`\n── FIRST ${dataRows.length} DATA ROWS ──`);
  dataRows.forEach((row, ri) => {
    console.log(`\n  Row ${ri + 2}:`);
    header.forEach((_, i) => {
      const val = row[i] || '(empty)';
      const letter = String.fromCharCode(65 + i);
      console.log(`    [${i}] ${letter}: ${val}`);
    });
  });

  console.log('\n── WHAT TO CHECK ──');
  console.log('  Look above and confirm these column indices for denial-notifier.cjs:');
  console.log('    DEXTER_COL_PATIENT = index of the Patient Name column');
  console.log('    DEXTER_COL_DOS     = index of the Date of Service column');
  console.log('    DEXTER_COL_STATUS  = index of the column that shows "Denied" (should be 9 = J)');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
