'use strict';
/**
 * nocodb-setup.cjs — one-time script that creates the BAPG Claims Tracker
 * tables and fields in NocoDB.
 *
 * Usage:
 *   node nocodb-setup.cjs --token YOUR_API_TOKEN
 *
 * Get the token from NocoDB → Team & Settings → API Tokens → Add Token
 */

const token = (() => {
  const i = process.argv.indexOf('--token');
  if (i === -1 || !process.argv[i + 1]) {
    console.error('Usage: node nocodb-setup.cjs --token YOUR_API_TOKEN');
    process.exit(1);
  }
  return process.argv[i + 1];
})();

const BASE_URL = 'http://137.184.211.133:3030';
const H = {
  'xc-token': token,
  'Content-Type': 'application/json',
};

async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

async function main() {
  // ── 1. Use existing project (already created) ───────────────────────────
  const projectId = 'p6dyfnvms4wa5ua';
  const claimsTableId = 'mq54ly1tsuxof5q';
  console.log(`Using existing project: ${projectId}`);
  console.log(`Using existing Claims Tracker: ${claimsTableId}`);

  // ── 2. Skip Claims Tracker (already created) — jump to AR table ─────────
  const claimsTable = { id: claimsTableId };
  if (false) await api('POST', `/db/meta/projects/${projectId}/tables`, {
    title: 'Claims Tracker',
    columns: [
      { title: 'Claim Number',       uidt: 'SingleLineText' },
      { title: 'Patient Name',       uidt: 'SingleLineText' },
      { title: 'Date of Service',    uidt: 'Date' },
      { title: 'Insurer',            uidt: 'SingleLineText' },
      { title: 'CPT Codes',          uidt: 'SingleLineText' },
      { title: 'ICD-10 Codes',       uidt: 'SingleLineText' },
      { title: 'Charges',            uidt: 'Currency' },
      { title: 'Action Notes',       uidt: 'LongText' },
      { title: 'DrChrono Appt ID',   uidt: 'SingleLineText' },
      { title: 'MRN',                uidt: 'SingleLineText' },
      {
        title: 'Submission Status',
        uidt: 'SingleSelect',
        colOptions: {
          options: [
            { title: 'Not Started', color: '#gray'   },
            { title: 'Sent',        color: '#0070f3' },
            { title: 'Done',        color: '#0e9f6e' },
          ],
        },
      },
      { title: 'Submission Date',    uidt: 'Date' },
      {
        title: 'Owner',
        uidt: 'SingleSelect',
        colOptions: {
          options: [
            { title: 'Unclaimed', color: '#e3e3e3' },
          ],
        },
      },
    ],
  });
  const claimsTableId = claimsTable.id;
  console.log(`  Claims Tracker ID: ${claimsTableId}`);

  // ── 3. Create A/R Tracker table ─────────────────────────────────────────
  console.log('Creating AR Tracker table...');
  const arTable = await api('POST', `/db/meta/projects/${projectId}/tables`, {
    title: 'AR Tracker',
    columns: [
      { title: 'Claim',          uidt: 'SingleLineText' },
      { title: 'Insurer',        uidt: 'SingleLineText' },
      { title: 'Date of Service',uidt: 'Date' },
      { title: 'Balance Due',    uidt: 'Currency' },
      {
        title: 'A/R Status',
        uidt: 'SingleSelect',
        colOptions: {
          options: [
            { title: 'Open',       color: '#e3e3e3' },
            { title: 'Partial',    color: '#f6c90e' },
            { title: 'Paid',       color: '#0e9f6e' },
            { title: 'Denied',     color: '#e53e3e' },
            { title: 'Write-Off',  color: '#718096' },
          ],
        },
      },
      { title: 'Notes',          uidt: 'LongText' },
    ],
  });
  const arTableId = arTable.id;
  console.log(`  A/R Tracker ID: ${arTableId}`);

  // ── 4. Output config for scripts ────────────────────────────────────────
  const config = {
    baseUrl:      BASE_URL,
    token,
    projectId,
    claimsTableId,
    arTableId,
  };

  const fs = require('fs');
  const configPath = require('path').join(__dirname, '..', 'nocodb-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  console.log(`
====================================
Setup complete!

nocodb-config.json written to:
  ${configPath}

NocoDB URL: ${BASE_URL}

Project ID:       ${projectId}
Claims Table ID:  ${claimsTableId}
A/R Table ID:     ${arTableId}
====================================

Next step: run the Airtable migration to copy existing claims:
  node nocodb/migrate-from-airtable.cjs
`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
