'use strict';
const DB_KEY = 'THnuRQHZk2CJEDJSL2nELZ64dcyJCz77PpVX';
const DB_BASE = 'https://go.daisybill.com/api/v1';
const DB_H   = { Authorization: `Bearer ${DB_KEY}`, Accept: 'application/json' };
const BP_ID  = 4204;

async function get(path) {
  const res = await fetch(`${DB_BASE}${path}`, { headers: DB_H, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function main() {
  // Fetch all processed bills
  let page = 1, all = [];
  while (true) {
    const data = await get(`/billing_providers/${BP_ID}/bills?page=${page}`);
    const bills = data.bills || [];
    if (!bills.length) break;
    all.push(...bills.filter(b => b.status === 'processed'));
    if (bills.length < 25) break;
    page++;
  }
  console.log(`Total processed bills: ${all.length}`);

  // Bucket by allowed_cents
  const fullDenial  = all.filter(b => b.allowed_cents === 0);
  const partPaid    = all.filter(b => b.allowed_cents > 0 && b.balance_due_cents > 0);
  const fullPaid    = all.filter(b => b.allowed_cents > 0 && b.balance_due_cents === 0);

  console.log(`\n  allowed=0 (likely full denial):    ${fullDenial.length}`);
  console.log(`  allowed>0, balance>0 (partial pay): ${partPaid.length}`);
  console.log(`  allowed>0, balance=0 (full pay):    ${fullPaid.length}`);

  // Show sample denial bills with DOS
  const cutoff = '2026-06-01';
  const recentDenials = fullDenial.filter(b => b.date_of_service >= cutoff);
  console.log(`\nFull-denial bills with DOS >= ${cutoff}: ${recentDenials.length}`);
  recentDenials.slice(0, 10).forEach(b =>
    console.log(`  DOS:${b.date_of_service} | charge:$${(b.charge_cents/100).toFixed(2)} | id:${b.id}`)
  );

  // Also show all full-denial bills in 2026
  const denial2026 = fullDenial.filter(b => b.date_of_service >= '2026-01-01');
  console.log(`\nAll full-denial bills with DOS in 2026: ${denial2026.length}`);
  denial2026.forEach(b =>
    console.log(`  DOS:${b.date_of_service} | charge:$${(b.charge_cents/100).toFixed(2)} | updated:${b.updated_at?.slice(0,10)} | id:${b.id}`)
  );
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
