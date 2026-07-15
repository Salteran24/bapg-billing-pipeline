'use strict';
/**
 * renumber-claims.cjs — assigns new claim numbers to every NocoDB record.
 *
 * Format:
 *   {YYYYMMDD}-{MRN}              when MRN is present
 *   {YYYYMMDD}-{LAST4}{FIRST4}    when MRN is missing but patient name exists
 *   {YYYYMMDD}-UNKN               when only DOS is available
 *   NODOSDATA-{rowId}             when no DOS at all
 *
 * Duplicates (same base key) get suffixes: -1, -2, -3 ...
 *
 * Usage:
 *   node nocodb/renumber-claims.cjs          → dry run (print changes)
 *   node nocodb/renumber-claims.cjs --apply  → write to NocoDB
 */

const DRY_RUN = !process.argv.includes('--apply');
const nc = require('./nc-client.cjs');

// ── helpers ──────────────────────────────────────────────────────────────────

function dosToYMD(dos) {
  if (!dos) return null;
  // dos arrives as "YYYY-MM-DD" or "YYYY-MM-DDThh:mm:ss"
  return dos.slice(0, 10).replace(/-/g, '');
}

function pseudoMRN(patientName) {
  if (!patientName || !patientName.trim()) return 'UNKN';
  const parts = patientName.trim().toUpperCase().split(/\s+/);
  const last  = parts[parts.length - 1].slice(0, 4).padEnd(4, 'X');
  const first = parts[0].slice(0, 4).padEnd(4, 'X');
  return last + first;
}

function baseKey(row) {
  const ymd = dosToYMD(row['Date of Service']);
  if (!ymd) return null;
  const mrn = row['MRN'] && row['MRN'].trim() ? row['MRN'].trim() : pseudoMRN(row['Patient Name']);
  return `${ymd}-${mrn}`;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching all NocoDB claims...');
  const rows = await nc.fetchAll(nc.CLAIMS);
  console.log(`  ${rows.length} records`);

  // Build base key → [row] map
  const keyMap = new Map();
  for (const row of rows) {
    const key = baseKey(row) || `NODOS-${row.Id}`;
    if (!keyMap.has(key)) keyMap.set(key, []);
    keyMap.get(key).push(row);
  }

  // Assign final claim numbers
  const assignments = []; // { row, newCN }
  for (const [key, group] of keyMap) {
    if (group.length === 1) {
      assignments.push({ row: group[0], newCN: key });
    } else {
      group.forEach((row, i) => {
        assignments.push({ row, newCN: `${key}-${i + 1}` });
      });
    }
  }

  // Stats
  const changed = assignments.filter(a => a.newCN !== a.row['Claim Number']);
  console.log(`  ${changed.length} claim numbers will change`);
  console.log(`  ${assignments.length - changed.length} already correct`);

  // Preview first 20 changes
  console.log('\nSample changes:');
  changed.slice(0, 20).forEach(a =>
    console.log(`  [${a.row['Claim Number'] || '(empty)'}] → ${a.newCN}  (${a.row['Patient Name'] || 'no name'})`)
  );
  if (changed.length > 20) console.log(`  ... and ${changed.length - 20} more`);

  if (DRY_RUN) {
    console.log('\nDry run — pass --apply to write changes.');
    return;
  }

  // Apply in batches of 25
  console.log('\nApplying...');
  let done = 0;
  for (let i = 0; i < changed.length; i += 25) {
    const batch = changed.slice(i, i + 25).map(a => ({
      Id: a.row.Id,
      'Claim Number': a.newCN,
    }));
    await nc.updateBatch(nc.CLAIMS, batch);
    done += batch.length;
    process.stdout.write(`\r  Updated ${done}/${changed.length}...`);
  }
  console.log(`\n\n✅ Done — ${done} claim numbers updated.`);
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
