'use strict';
const DB_KEY = 'THnuRQHZk2CJEDJSL2nELZ64dcyJCz77PpVX';
const DB_BASE = 'https://go.daisybill.com/api/v1';
const DB_H   = { Authorization: `Bearer ${DB_KEY}`, Accept: 'application/json' };
const BP_ID  = 4204;

async function get(path) {
  const url = path.startsWith('http') ? path : `${DB_BASE}${path}`;
  const res = await fetch(url, { headers: DB_H, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  // Fetch first page of processed bills
  const data = await get(`/billing_providers/${BP_ID}/bills?page=1`);
  const bills = (data.bills || []).filter(b => b.status === 'processed');
  console.log(`Processed bills on page 1: ${bills.length}`);

  if (!bills.length) { console.log('No processed bills on page 1'); return; }

  // Inspect the first processed bill fully
  const sample = bills[0];
  console.log('\n--- Sample bill (top-level fields) ---');
  console.log(JSON.stringify(sample, null, 2));

  // Follow any links to see EOR data
  if (sample.links && sample.links.length) {
    console.log('\n--- Links on this bill ---');
    sample.links.forEach(l => console.log(`  rel="${l.rel}" href="${l.href}"`));

    // Try to fetch an "eor" or "remittance" link if present
    const eorLink = sample.links.find(l => l.rel.includes('eor') || l.rel.includes('remit') || l.rel.includes('payment'));
    if (eorLink) {
      console.log(`\nFetching ${eorLink.rel}: ${eorLink.href}`);
      const eorData = await get(eorLink.href);
      console.log(JSON.stringify(eorData, null, 2));
    }
  }

  // Also try fetching the bill directly by ID to see if there are more fields
  console.log(`\n--- Fetching bill ${sample.id} directly ---`);
  const full = await get(`/billing_providers/${BP_ID}/bills/${sample.id}`);
  console.log(JSON.stringify(full, null, 2));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
