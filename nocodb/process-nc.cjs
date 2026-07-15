/**
 * process-nc.cjs — reads a DrChrono superbill PDF and creates records in NocoDB.
 * Usage: node nocodb/process-nc.cjs "path/to/superbills.pdf"
 *
 * NocoDB version of process.cjs (no Airtable).
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const nc   = require('./nc-client.cjs');

// pdf-parse v2 API
let pdfParse;
try {
  pdfParse = require('pdf-parse');
} catch {
  // older api shim
  const { PDFParse } = require('pdf-parse');
  pdfParse = { PDFParse };
}

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.error('Usage: node nocodb/process-nc.cjs "path/to/superbills.pdf"');
    process.exit(1);
  }

  console.log(`\n📄 Reading PDF: ${path.basename(pdfPath)}`);
  const buf  = fs.readFileSync(pdfPath);

  let pages = [];
  try {
    // pdf-parse v2
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    await parser.load();
    const result = await parser.getText({ pageNumber: 1 });
    pages = result.pages || [];
  } catch {
    // pdf-parse v1 fallback
    const data = await require('pdf-parse')(buf);
    pages = [{ text: data.text, num: 1 }];
  }

  console.log(`   ${pages.length} page(s) loaded`);

  const superbills = groupSuperbills(pages);
  console.log(`   ${superbills.length} superbill(s) found\n`);

  let created = 0, skipped = 0;

  for (let i = 0; i < superbills.length; i++) {
    const sb = superbills[i];
    console.log(`[${i + 1}/${superbills.length}] Extracting claim...`);

    const fields = extractWithRegex(sb.text);

    if (!fields.patient) {
      console.log('   ⟶ Skipped (no patient name found)');
      skipped++;
      continue;
    }

    console.log(`   Patient: ${fields.patient}`);
    console.log(`   DOS:     ${fields.date_of_service || '—'}`);
    console.log(`   Insurer: ${fields.insurer}`);

    try {
      await createNcRecord(fields);
      console.log('   ✅ Created in NocoDB\n');
      created++;
    } catch (e) {
      console.error(`   ❌ NocoDB error: ${e.message}\n`);
      skipped++;
    }
  }

  console.log(`\n✅ Done — ${created} records created, ${skipped} skipped`);
}

// ── GROUP PAGES INTO SUPERBILLS ──────────────────────────────────────────────

function groupSuperbills(pages) {
  const superbills = [];
  let current = null;
  for (const page of pages) {
    const text = page.text || '';
    if (text.includes('Patient Receipt')) {
      if (current) superbills.push(current);
      current = { text, pages: [page.num] };
    } else if (current) {
      current.text += '\n' + text;
      current.pages.push(page.num);
    }
  }
  if (current) superbills.push(current);
  return superbills;
}

// ── REGEX EXTRACTION ─────────────────────────────────────────────────────────

function extractWithRegex(text) {
  const get = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };

  const patient  = get(/Patient Name:\s*(.+)/);
  const dob_raw  = get(/Date of Birth:\s*(.+)/);
  const provider = get(/Rendering Provider:\s*(.+)/);
  const insurer  = get(/Insurer:\s*(.+)/) || 'Self-Pay';
  const caseNum  = get(/Case #:\s*(.+)/);
  const apptDate = get(/Appointment Date:\s*(.+)/);
  const charges  = get(/Total Charges:\s*(\$[\d.,]+)/) || '$0.00';

  let icdCodes = [];
  const diagSection = text.match(/Diagnosis:([\s\S]*?)(?:Treatment:|$)/);
  if (diagSection) {
    icdCodes = [...diagSection[1].matchAll(/(\d{2}\/\d{2}\/\d{4})\s+([A-Z]\d[\w.]+):/g)].map(m => m[2]);
  }

  let cptCodes = [], date_of_service = null;
  const treatSection = text.match(/Treatment:([\s\S]*?)(?:Total Charges:|$)/);
  if (treatSection) {
    const t = treatSection[1];
    cptCodes = [...t.matchAll(/(\d{2}\/\d{2}\/\d{4})\s+(\w{5}):/g)].map(m => m[2]);
    const dosMatch = t.match(/(\d{2})\/(\d{2})\/(\d{4})\s+\w{5}:/);
    if (dosMatch) date_of_service = `${dosMatch[3]}-${dosMatch[1]}-${dosMatch[2]}`;
  }

  return {
    patient,
    date_of_birth: parseDateFlex(dob_raw),
    date_of_service,
    provider,
    insurer,
    case_number: caseNum,
    cpt_codes: [...new Set(cptCodes)],
    icd10_codes: [...new Set(icdCodes)],
    total_charges: charges,
    appointment_date: apptDate,
  };
}

function parseDateFlex(raw) {
  if (!raw) return null;
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const m = raw.match(/(\w+)\.?\s+(\d+),\s+(\d{4})/);
  if (!m) return null;
  const mo = months[m[1].toLowerCase().slice(0, 3)];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
}

// ── NOCODB CREATE ─────────────────────────────────────────────────────────────

async function createNcRecord(fields) {
  const noteLines = [
    `PATIENT: ${fields.patient || '—'}`,
    fields.provider         ? `Provider: ${fields.provider}`              : null,
    fields.insurer          ? `Insurer: ${fields.insurer}`                : null,
    fields.case_number      ? `Case #: ${fields.case_number}`             : null,
    fields.cpt_codes?.length  ? `CPT: ${fields.cpt_codes.join(', ')}`    : null,
    fields.icd10_codes?.length ? `ICD-10: ${fields.icd10_codes.join(', ')}` : null,
    fields.total_charges    ? `Charges: ${fields.total_charges}`          : null,
    fields.appointment_date ? `Appt: ${fields.appointment_date}`          : null,
  ].filter(Boolean).join('\n');

  const row = {
    'Claim Number':      fields.patient || '',
    'Patient Name':      fields.patient || '',
    'Insurer':           fields.insurer || 'Self-Pay',
    'CPT Codes':         (fields.cpt_codes || []).join(', '),
    'ICD-10 Codes':      (fields.icd10_codes || []).join(', '),
    'Action Notes':      noteLines,
    'Submission Status': 'Not Started',
    'Owner':             'Unclaimed',
  };

  if (fields.date_of_service) row['Date of Service'] = fields.date_of_service;
  if (fields.case_number)     row['Tacking Number (CH)'] = fields.case_number;

  await nc.create(nc.CLAIMS, row);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
