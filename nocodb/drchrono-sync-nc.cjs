'use strict';
/**
 * drchrono-sync-nc.cjs — pulls completed DrChrono appointments into NocoDB.
 *
 * Usage:
 *   node nocodb/drchrono-sync-nc.cjs                        → last 7 days
 *   node nocodb/drchrono-sync-nc.cjs 2026-01-01 2026-06-30  → date range
 */

const fs   = require('fs');
const path = require('path');
const nc   = require('./nc-client.cjs');
const { notifyMatrix } = require('../matrix-notify.cjs');

const CONFIG_FILE = path.join(__dirname, '..', 'drchrono-config.json');
const TOKENS_FILE = path.join(__dirname, '..', 'drchrono-tokens.json');

function loadConfig() { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
function loadTokens() { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); }
function saveTokens(t) { fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2)); }

async function refreshIfNeeded(tokens, config) {
  const expiresAt = tokens.obtained_at + (tokens.expires_in - 600) * 1000;
  if (Date.now() < expiresAt) return tokens;
  console.log('   Refreshing DrChrono token...');
  const res = await fetch('https://drchrono.com/o/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: tokens.refresh_token,
      client_id: config.client_id, client_secret: config.client_secret,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const fresh = { ...await res.json(), obtained_at: Date.now() };
  saveTokens(fresh);
  return fresh;
}

async function dcFetch(p, tokens) {
  const res = await fetch(`https://drchrono.com${p}`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`DrChrono ${p}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function dcFetchAll(endpoint, params, tokens) {
  const out = [];
  let url = `${endpoint}?${new URLSearchParams(params)}`;
  while (url) {
    const data = await dcFetch(url.replace('https://drchrono.com', ''), tokens);
    out.push(...(data.results || []));
    url = data.next || null;
  }
  return out;
}

async function main() {
  const config = loadConfig();
  let tokens = await refreshIfNeeded(loadTokens(), config);

  const today = new Date();
  const fromDate = process.argv[2] || new Date(today - 7 * 86400000).toISOString().slice(0, 10);
  const toDate   = process.argv[3] || today.toISOString().slice(0, 10);

  console.log(`Syncing DrChrono appointments ${fromDate} → ${toDate}`);

  const appointments = await dcFetchAll('/api/appointments', {
    date_range: `${fromDate}/${toDate}`, status: 'Complete', verbose: 1,
  }, tokens);
  console.log(`  ${appointments.length} completed appointments`);

  // Load existing to deduplicate
  const existing = await nc.fetchAll(nc.CLAIMS);
  const existingApptIds = new Set(
    existing.map(r => r['DrChrono Appt ID']).filter(Boolean).map(String)
  );
  console.log(`  ${existingApptIds.size} already in NocoDB`);

  const apptData = [];
  for (let i = 0; i < appointments.length; i++) {
    const appt = appointments[i];
    const apptId = String(appt.id);
    process.stdout.write(`\r  Processing ${i + 1}/${appointments.length}...`);
    if (existingApptIds.has(apptId)) continue;

    let patient = {};
    try { patient = await dcFetch(`/api/patients/${appt.patient}`, tokens); }
    catch {
      // retry once — a silent failure here leaves the claim without MRN/DOB
      try { patient = await dcFetch(`/api/patients/${appt.patient}`, tokens); }
      catch (e) { console.warn(`\n  ⚠ patient fetch failed for appt ${apptId}: ${e.message}`); }
    }

    let lineItems = [];
    try { lineItems = await dcFetchAll('/api/line_items', { appointment: appt.id }, tokens); } catch {}

    const patientName = [patient.first_name, patient.last_name].filter(Boolean).join(' ') || `Patient #${appt.patient}`;
    const mrn  = patient.chart_id ? String(patient.chart_id) : null;
    const dob  = patient.date_of_birth || null;
    const dos  = appt.date || appt.scheduled_time?.slice(0, 10) || null;
    const cpts = [...new Set(lineItems.map(li => li.code).filter(Boolean))];
    const icds = [...new Set(appt.icd10_codes || [])];
    const totalCharge = lineItems.reduce((s, li) => s + parseFloat(li.charge || 0), 0);
    const dosCompact  = dos ? dos.replace(/-/g, '') : null;

    apptData.push({ apptId, patientName, mrn, dob, dos, dosCompact, cpts, icds, totalCharge });
  }
  console.log('');

  if (!apptData.length) { console.log('Nothing new to create.'); return; }

  // Assign claim numbers with -1/-2 suffix for same-day dupes
  const keyCount = {}, keyUsed = {};
  for (const d of apptData) {
    const base = d.dosCompact && d.mrn ? `${d.dosCompact}-${d.mrn}` : d.dosCompact || d.mrn || d.apptId;
    keyCount[base] = (keyCount[base] || 0) + 1;
  }

  const claimsToCreate = [], arToCreate = [];
  for (const d of apptData) {
    const base = d.dosCompact && d.mrn ? `${d.dosCompact}-${d.mrn}` : d.dosCompact || d.mrn || d.apptId;
    keyUsed[base] = (keyUsed[base] || 0) + 1;
    const claimNum = keyCount[base] > 1 ? `${base}-${keyUsed[base]}` : base;

    const notes = [
      `PATIENT: ${d.patientName}`,
      `DrChrono: ${d.apptId}`,
      d.mrn               ? `MRN: ${d.mrn}`                         : null,
      `Insurer: Self-Pay`,
      d.cpts.length       ? `CPT: ${d.cpts.join(', ')}`             : null,
      d.icds.length       ? `ICD-10: ${d.icds.join(', ')}`          : null,
      d.totalCharge > 0   ? `Charges: $${d.totalCharge.toFixed(2)}` : null,
    ].filter(Boolean).join('\n');

    console.log(`  + ${claimNum} | ${d.patientName} | CPT: ${d.cpts.join(', ') || '—'}`);

    claimsToCreate.push({
      'Claim Number':     claimNum,
      'Patient Name':     d.patientName,
      'Date of Birth':    d.dob || null,
      'Date of Service':  d.dos || null,
      'MRN':              d.mrn || '',
      'Insurer':          'Self-Pay',
      'CPT Codes':        d.cpts.join(', '),
      'ICD-10 Codes':     d.icds.join(', '),
      'Charges':          d.totalCharge > 0 ? d.totalCharge : null,
      'Action Notes':     notes,
      'DrChrono Appt ID': d.apptId,
      'Submission Status':'Not Started',
      'Owner':            'Unclaimed',
    });

    arToCreate.push({
      'Claim':           claimNum,
      'Insurer':         'Self-Pay',
      'Date of Service': d.dos || null,
      'A/R Status':      'Open',
    });
  }

  console.log(`\nCreating ${claimsToCreate.length} claims in NocoDB...`);
  await nc.createBatch(nc.CLAIMS, claimsToCreate);

  console.log(`Creating ${arToCreate.length} A/R rows...`);
  await nc.createBatch(nc.AR, arToCreate);

  console.log(`\n✅ Done — ${claimsToCreate.length} claims imported from DrChrono`);

  // Notify Matrix billing room
  const patientLines = apptData
    .slice(0, 15)
    .map(d => `  • ${d.patientName}${d.cpts.length ? ` — CPT: ${d.cpts.slice(0,3).join(', ')}` : ''}`)
    .join('\n');
  const more = apptData.length > 15 ? `\n  ...y ${apptData.length - 15} más` : '';
  const now  = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles',
  });

  notifyMatrix([
    `🗓️ DrChrono sync completado`,
    ``,
    `📊 ${claimsToCreate.length} nuevos claims — ${fromDate}${fromDate !== toDate ? ` → ${toDate}` : ''}`,
    `👤 Pacientes:\n${patientLines}${more}`,
    ``,
    `⏰ ${now} PT`,
  ].join('\n')).catch(e => console.warn(`⚠  Matrix notify failed: ${e.message}`));
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
