const { PDFParse } = require('pdf-parse');
const fs = require('fs');

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

function extractWithRegex(text) {
  const get = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const patient     = get(/Patient Name:\s*(.+)/);
  const provider    = get(/Rendering Provider:\s*(.+)/);
  const insurer     = get(/Insurer:\s*(.+)/) || 'Self-Pay';
  const case_number = get(/Case #:\s*(.+)/);
  const totalCharges = get(/Total Charges:\s*(\$[\d.,]+)/) || '$0.00';
  const dosMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})\s+\w{5}:/);
  const date_of_service = dosMatch ? `${dosMatch[3]}-${dosMatch[1]}-${dosMatch[2]}` : null;
  const cptCodes = [...text.matchAll(/(\d{2}\/\d{2}\/\d{4})\s+(\w{5}):/g)].map(m => m[2]);
  const icdCodes = [...text.matchAll(/\d+\s+\d{2}\/\d{2}\/\d{4}\s+([A-Z]\d[\w.]+):/g)].map(m => m[1]);
  return { patient, provider, insurer, case_number, date_of_service, totalCharges,
    cpt_codes: [...new Set(cptCodes)], icd10_codes: [...new Set(icdCodes)] };
}

async function main() {
  const buf = fs.readFileSync('C:/Users/Salte/OneDrive/Desktop/06-11-2026 superbills.pdf');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  await parser.load();
  const result = await parser.getText({ pageNumber: 1 });
  const superbills = groupSuperbills(result.pages || []);
  console.log(`Total superbills: ${superbills.length}\n`);
  // Show first 5
  superbills.slice(0, 5).forEach((sb, i) => {
    const f = extractWithRegex(sb.text);
    console.log(`[${i+1}] ${f.patient} | DOS: ${f.date_of_service} | Insurer: ${f.insurer}`);
    console.log(`     CPT: ${f.cpt_codes.join(', ')}`);
    console.log(`     ICD: ${f.icd10_codes.join(', ')}`);
    console.log('');
  });
}
main().catch(e => console.error(e.message));
