'use strict';
const DB_KEY = 'THnuRQHZk2CJEDJSL2nELZ64dcyJCz77PpVX';
const DB_BASE = 'https://go.daisybill.com/api/v1';
const DB_H   = { Authorization: `Bearer ${DB_KEY}`, Accept: 'application/json' };
const BP_ID  = 4204;

async function get(path) {
  const url = path.startsWith('http') ? path : `${DB_BASE}${path}`;
  const res = await fetch(url, { headers: DB_H, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return { _error: res.status, _body: await res.text() };
  return res.json();
}

async function main() {
  // 1. Fetch injury 3472308 (from sample bill) and show all its links
  console.log('=== Injury 3472308 ===');
  const injury = await get('/injuries/3472308');
  console.log('Links:', JSON.stringify(injury.links || [], null, 2));
  console.log('Top keys:', Object.keys(injury).join(', '));

  // 2. Try known EOR endpoint patterns
  const candidates = [
    `/injuries/3472308/eors`,
    `/injuries/3472308/explanation_of_reviews`,
    `/injuries/3472308/remittances`,
    `/billing_providers/${BP_ID}/eors`,
    `/billing_providers/${BP_ID}/explanation_of_reviews`,
  ];
  for (const path of candidates) {
    console.log(`\nTrying ${path}...`);
    const r = await get(path);
    if (r._error) { console.log(`  -> ${r._error}: ${r._body}`); }
    else { console.log(`  -> OK: ${JSON.stringify(r).slice(0, 300)}`); }
  }

  // 3. Follow injury links to find EOR
  if (injury.links) {
    for (const link of injury.links) {
      if (link.rel.toLowerCase().includes('eor') || link.rel.toLowerCase().includes('remit')) {
        console.log(`\nFollowing link rel="${link.rel}": ${link.href}`);
        const r = await get(link.href);
        console.log(JSON.stringify(r).slice(0, 500));
      }
    }
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
