/**
 * gen-test-superbill.cjs — generates a minimal DrChrono-format superbill PDF
 * Usage: node gen-test-superbill.cjs [output-path]
 *
 * Creates a single-patient superbill in the DrChrono Patient Receipt format
 * that process.cjs can parse correctly.
 */

'use strict';

const PDFDocument = require('pdfkit');
const fs          = require('fs');
const path        = require('path');

const outPath = process.argv[2]
  || path.join(
      process.env.USERPROFILE,
      'OneDrive', 'Desktop', 'Superbill Inbox',
      `test-superbill-${new Date().toISOString().slice(0,10)}.pdf`
    );

const doc = new PDFDocument({ margin: 50 });
const stream = fs.createWriteStream(outPath);
doc.pipe(stream);

// ── Header ────────────────────────────────────────────────────────────────────
doc.fontSize(16).font('Helvetica-Bold').text('Bay Area Podiatry Group', { align: 'center' });
doc.fontSize(11).font('Helvetica').text('2000 Market St, Suite 300, San Francisco, CA 94114', { align: 'center' });
doc.moveDown(1);

// ── Superbill title (process.cjs looks for "Patient Receipt") ─────────────────
doc.fontSize(14).font('Helvetica-Bold').text('Patient Receipt', { align: 'center' });
doc.moveDown(1);

// ── Patient info block ────────────────────────────────────────────────────────
doc.fontSize(11).font('Helvetica-Bold').text('Patient Information');
doc.font('Helvetica').moveDown(0.3);
doc.text('Patient Name: John Test Patient');
doc.text('Date of Birth: Jan. 15, 1985');
doc.text('Appointment Date: 07/04/2026');
doc.text('Rendering Provider: Dr. Test Provider, DPM');
doc.text('Insurer: State Compensation Insurance Fund');
doc.text('Case #: TEST-2026-0704');
doc.moveDown(1);

// ── Diagnosis section (ICD-10) ────────────────────────────────────────────────
doc.font('Helvetica-Bold').text('Diagnosis:');
doc.font('Helvetica').moveDown(0.3);
doc.text('07/04/2026  M79.671: Pain in right foot');
doc.text('07/04/2026  L60.0: Ingrowing nail');
doc.moveDown(1);

// ── Treatment section (CPT codes) ────────────────────────────────────────────
doc.font('Helvetica-Bold').text('Treatment:');
doc.font('Helvetica').moveDown(0.3);
doc.text('07/04/2026  99213: Office visit, est. patient, moderate complexity — $120.00');
doc.text('07/04/2026  11730: Avulsion of nail plate, partial — $95.00');
doc.moveDown(1);

// ── Totals ────────────────────────────────────────────────────────────────────
doc.font('Helvetica-Bold').text('Total Charges: $215.00');
doc.font('Helvetica').text('Amount Paid: $0.00');
doc.text('Balance Due: $215.00');

doc.end();

stream.on('finish', () => {
  console.log(`✅ Test superbill generated:\n   ${outPath}`);
  console.log('\nDrop it in the Superbill Inbox (or it was saved there directly).');
  console.log('Make sure watch.cjs is running to process it automatically.\n');
});
stream.on('error', e => { console.error('❌ PDF write error:', e.message); process.exit(1); });
