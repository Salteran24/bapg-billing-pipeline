'use strict';
const DB_KEY = 'THnuRQHZk2CJEDJSL2nELZ64dcyJCz77PpVX';
const DB_BASE = 'https://go.daisybill.com/api/v1';
const DB_H   = { Authorization: `Bearer ${DB_KEY}`, Accept: 'application/json' };
const BP_ID  = 4204;

async function main() {
  const statusMap = {};
  let page = 1, total = 0;
  while (true) {
    const res  = await fetch(`${DB_BASE}/billing_providers/${BP_ID}/bills?page=${page}`, { headers: DB_H });
    const data = await res.json();
    const bills = data.bills || [];
    if (!bills.length) break;
    bills.forEach(b => { statusMap[b.status] = (statusMap[b.status]||0)+1; });
    total += bills.length;
    if (bills.length < 25) break;
    page++;
  }
  console.log(`Total bills: ${total}`);
  console.log('Status breakdown:');
  Object.entries(statusMap).sort((a,b)=>b[1]-a[1]).forEach(([s,c]) => console.log(`  ${s}: ${c}`));

  // Show most recent bills
  const res = await fetch(`${DB_BASE}/billing_providers/${BP_ID}/bills?page=1`, { headers: DB_H });
  const data = await res.json();
  console.log('\nMost recent 5 bills:');
  (data.bills||[]).slice(0,5).forEach(b =>
    console.log(`  ${b.date_of_service} | ${b.status} | id:${b.id}`)
  );
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
