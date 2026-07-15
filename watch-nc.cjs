/**
 * watch-nc.cjs — Superbill Watcher (NocoDB version)
 * Usage: node watch-nc.cjs
 *
 * Watches the "Superbill Inbox" folder on the Desktop.
 * When a .pdf is dropped there it processes it into NocoDB and notifies Matrix.
 * Does NOT touch Airtable.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { notifyMatrix } = require('./matrix-notify.cjs');

const INBOX_DIR     = path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop', 'Superbill Inbox');
const PROCESSED_DIR = path.join(INBOX_DIR, 'processed');
const PROCESS_SCRIPT  = path.join(__dirname, 'nocodb', 'process-nc.cjs');

if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });

console.log(`\n👁  Watching: ${INBOX_DIR}`);
console.log('   Drop a superbill PDF to import it into NocoDB and notify Matrix.\n');

const seen = new Set();

setInterval(() => {
  let files;
  try { files = fs.readdirSync(INBOX_DIR); } catch { return; }

  for (const f of files) {
    if (!f.toLowerCase().endsWith('.pdf')) continue;
    const fullPath = path.join(INBOX_DIR, f);
    if (seen.has(fullPath)) continue;

    const stat = fs.statSync(fullPath);
    if (Date.now() - stat.mtimeMs < 3000) continue; // wait for file to settle

    seen.add(fullPath);
    console.log(`\n📄 New PDF detected: ${f}`);
    processPdf(fullPath);
  }
}, 5000);

async function processPdf(filePath) {
  const fileName = path.basename(filePath);
  try {
    console.log('   📋 Processing claims into NocoDB...');
    const output = execSync(`node "${PROCESS_SCRIPT}" "${filePath}"`, {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'inherit'],
    });
    process.stdout.write(output);

    const dest = path.join(PROCESSED_DIR, fileName);
    fs.renameSync(filePath, dest);
    console.log(`   📁 Moved to processed/`);

    notifyMatrix(buildSummary(fileName, output))
      .then(() => console.log('   📨 Matrix notified\n'))
      .catch(e => console.warn(`   ⚠  Matrix notify failed: ${e.message}\n`));

  } catch (e) {
    console.error(`   ❌ Processing failed: ${e.message}`);
    seen.delete(filePath); // allow retry
  }
}

function buildSummary(fileName, output) {
  const lines   = output.split('\n');
  const claims  = [];
  let current   = null;

  for (const line of lines) {
    const patient = line.match(/Patient:\s+(.+)/);
    const dos     = line.match(/DOS:\s+(.+)/);
    const insurer = line.match(/Insurer:\s+(.+)/);

    if (patient) {
      current = { patient: patient[1].trim(), dos: null, insurer: null };
      claims.push(current);
    } else if (current && dos)     { current.dos     = dos[1].trim(); }
      else if (current && insurer) { current.insurer = insurer[1].trim(); }
  }

  const doneMatch = output.match(/(\d+) records? created,\s*(\d+) skipped/);
  const created   = doneMatch ? parseInt(doneMatch[1]) : claims.length;
  const skipped   = doneMatch ? parseInt(doneMatch[2]) : 0;

  const now = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles',
  });

  const claimLines = claims
    .map(c => `  • ${c.patient}${c.dos ? ` — DOS: ${c.dos}` : ''}${c.insurer ? ` | ${c.insurer}` : ''}`)
    .join('\n');

  const status = skipped > 0
    ? `${created} nuevos + ${skipped} ya existían`
    : `${created} claim${created !== 1 ? 's' : ''} procesado${created !== 1 ? 's' : ''}`;

  return [
    `📋 Nuevo superbill procesado`,
    ``,
    `📄 Archivo: ${fileName}`,
    `📊 ${status}`,
    claims.length > 0 ? `👤 Pacientes:\n${claimLines}` : null,
    ``,
    `⏰ ${now} PT`,
  ].filter(l => l !== null).join('\n');
}
