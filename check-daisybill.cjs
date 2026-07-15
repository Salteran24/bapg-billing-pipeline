'use strict';

const API_KEY = 'THnuRQHZk2CJEDJSL2nELZ64dcyJCz77PpVX';
const BASE    = 'https://go.daisybill.com/api/v1';
const H       = { 'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json' };

async function get(path) {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: H, signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    console.log(`[${res.status}] ${path}`);
    if (res.ok || res.status !== 404) console.log(' ', text.slice(0, 400));
  } catch (e) {
    console.log(`[ERR] ${path} → ${e.message}`);
  }
}

const BP_ID = 4204;

async function main() {
  // Check page 1 vs page 2 to understand pagination
  for (const url of [
    `${BASE}/billing_providers/${BP_ID}/bills?page=1`,
    `${BASE}/billing_providers/${BP_ID}/bills?page=2`,
    `${BASE}/billing_providers/${BP_ID}/bills?page=1&per_page=100`,
    `${BASE}/billing_providers/${BP_ID}/bills?page=1&per_page=50`,
  ]) {
    const res = await fetch(url, { headers: H, signal: AbortSignal.timeout(10000) });
    const d = await res.json();
    const count = d.bills?.length ?? '?';
    const keys = Object.keys(d).filter(k => k !== 'bills');
    console.log(`[${res.status}] ${url.replace(BASE, '')}`);
    console.log(`  bills: ${count}  |  other keys: ${JSON.stringify(keys)}`);
    if (d.meta || d.pagination || d.page_info || d.total_count !== undefined) {
      console.log('  pagination:', JSON.stringify(d.meta ?? d.pagination ?? d.page_info ?? { total_count: d.total_count }));
    }
  }
}

main();
