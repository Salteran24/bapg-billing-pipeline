/**
 * Superbill Watcher — watch.cjs
 * Usage: node watch.cjs
 *
 * Watches the "Superbill Inbox" folder on the Desktop.
 * When a .pdf is dropped there it auto-processes and moves it to /processed.
 * After each successful process, sends a notification to the Matrix billing room.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { notifyMatrix } = require('./matrix-notify.cjs');

const INBOX_DIR     = path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop', 'Superbill Inbox');
const PROCESSED_DIR = path.join(INBOX_DIR, 'processed');
const PROCESS_SCRIPT  = path.join(__dirname, 'process.cjs');
const BACKFILL_SCRIPT = path.join(__dirname, 'backfill-insurer.cjs');

if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });

console.log(`\n👁  Watching: ${INBOX_DIR}`);
console.log('   Drop a superbill PDF here and it will be auto-imported into Airtable.');
console.log('   Matrix billing room will be notified on each successful import.\n');

const seen = new Set();

// Poll every 5 seconds (fs.watch on Windows can miss events with OneDrive sync)
setInterval(() => {
  let files;
  try { files = fs.readdirSync(INBOX_DIR); } catch { return; }

  for (const f of files) {
    if (!f.toLowerCase().endsWith('.pdf')) continue;
    const fullPath = path.join(INBOX_DIR, f);
    if (seen.has(fullPath)) continue;

    // Wait a moment to ensure the file is fully written
    const stat = fs.statSync(fullPath);
    if (Date.now() - stat.mtimeMs < 3000) continue;  // file is too fresh, wait

    seen.add(fullPath);
    console.log(`\n📄 New PDF detected: ${f}`);
    processPdf(fullPath);
  }
}, 5000);

async function processPdf(filePath) {
  const fileName = path.basename(filePath);
  try {
    // Backfill insurer on existing DrChrono claims
    console.log('   🔗 Backfilling insurer from PDF...');
    execSync(`node "${BACKFILL_SCRIPT}" "${filePath}"`, { stdio: 'inherit' });

    // Create records for any claims NOT already in Airtable — capture output for Matrix summary
    console.log('   📋 Processing claims...');
    const processOutput = execSync(`node "${PROCESS_SCRIPT}" "${filePath}"`, {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'inherit'],
    });
    process.stdout.write(processOutput);

    // Parse output to build notification summary
    const summary = buildSummary(fileName, processOutput);

    // Move to processed/
    const dest = path.join(PROCESSED_DIR, fileName);
    fs.renameSync(filePath, dest);
    console.log(`   📁 Moved to processed/\n`);

    // Notify Matrix — fire-and-forget with graceful error handling
    notifyMatrix(summary)
      .then(() => console.log('   📨 Matrix notified\n'))
      .catch(e => console.warn(`   ⚠  Matrix notify failed (non-fatal): ${e.message}\n`));

  } catch (e) {
    console.error(`   ❌ Processing failed: ${e.message}`);
    seen.delete(filePath);  // allow retry on next poll
  }
}

/**
 * Parses the stdout of process.cjs and builds a human-readable Matrix message.
 * Example output lines parsed:
 *   "   Patient: John Doe"
 *   "   DOS:     2026-07-04"
 *   "   Insurer: State Fund"
 *   "✅ Done — 2 records created, 0 skipped"
 */
function buildSummary(fileName, output) {
  // Extract per-claim details — each block starts with "Patient:"
  const lines = output.split('\n');
  const claims = [];
  let current = null;

  for (const line of lines) {
    const patient = line.match(/Patient:\s+(.+)/);
    const dos     = line.match(/DOS:\s+(.+)/);
    const insurer = line.match(/Insurer:\s+(.+)/);

    if (patient) {
      current = { patient: patient[1].trim(), dos: null, insurer: null };
      claims.push(current);
    } else if (current && dos) {
      current.dos = dos[1].trim();
    } else if (current && insurer) {
      current.insurer = insurer[1].trim();
    }
  }

  // "✅ Done — 2 records created, 0 skipped"
  const doneMatch = output.match(/(\d+) records? created,\s*(\d+) skipped/);
  const created = doneMatch ? parseInt(doneMatch[1]) : claims.length;
  const skipped = doneMatch ? parseInt(doneMatch[2]) : 0;

  const now = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'America/Los_Angeles',
  });

  const claimLines = claims
    .map(c => `  • ${c.patient}${c.dos ? ` — DOS: ${c.dos}` : ''}${c.insurer ? ` | ${c.insurer}` : ''}`)
    .join('\n');

  const statusLine = skipped > 0
    ? `${created} nuevos + ${skipped} ya existían`
    : `${created} claim${created !== 1 ? 's' : ''} procesado${created !== 1 ? 's' : ''}`;

  return [
    `📋 Nuevo superbill procesado`,
    ``,
    `📄 Archivo: ${fileName}`,
    `📊 ${statusLine}`,
    claims.length > 0 ? `👤 Pacientes:\n${claimLines}` : null,
    ``,
    `⏰ ${now} PT`,
  ].filter(l => l !== null).join('\n');
}
