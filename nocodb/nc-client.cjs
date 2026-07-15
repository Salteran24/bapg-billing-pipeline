'use strict';
/**
 * nc-client.cjs — shared NocoDB API helpers used by all pipeline scripts.
 * Reads nocodb-config.json from the project root.
 * Uses NocoDB v2 API (compatible with v2026+).
 */

const fs   = require('fs');
const path = require('path');

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'nocodb-config.json'), 'utf8'));
} catch {
  console.error('nocodb-config.json not found. Run: node nocodb/nocodb-setup.cjs --token YOUR_TOKEN');
  process.exit(1);
}

const H = { 'xc-token': cfg.token, 'Content-Type': 'application/json' };

function url(tableId, suffix = '') {
  return `${cfg.baseUrl}/api/v2/tables/${tableId}/records${suffix}`;
}

/** Fetch all rows from a NocoDB table. */
async function fetchAll(tableId, where = '') {
  const rows = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const q = new URLSearchParams({ limit, offset });
    if (where) q.set('where', where);
    const res = await fetch(`${url(tableId)}?${q}`, { headers: H });
    if (!res.ok) throw new Error(`NocoDB GET ${tableId}: ${res.status} ${await res.text()}`);
    const d = await res.json();
    const list = d.list || [];
    rows.push(...list);
    if (list.length < limit) break;
    offset += limit;
  }
  return rows;
}

/** Create a single row. Returns the created row. */
async function create(tableId, fields) {
  const res = await fetch(url(tableId), {
    method: 'POST',
    headers: H,
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`NocoDB POST ${tableId}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Create multiple rows in batches of 25. */
async function createBatch(tableId, records) {
  for (let i = 0; i < records.length; i += 25) {
    const batch = records.slice(i, i + 25);
    const res = await fetch(url(tableId), {
      method: 'POST',
      headers: H,
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`NocoDB bulk POST ${tableId}: ${res.status} ${await res.text()}`);
  }
}

/** Update a row by its NocoDB row ID. */
async function update(tableId, rowId, fields) {
  const res = await fetch(url(tableId), {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify([{ Id: rowId, ...fields }]),
  });
  if (!res.ok) throw new Error(`NocoDB PATCH ${tableId}/${rowId}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Update multiple rows in batches of 25. Rows must include their Id field. */
async function updateBatch(tableId, rows) {
  for (let i = 0; i < rows.length; i += 25) {
    const batch = rows.slice(i, i + 25);
    const res = await fetch(url(tableId), {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`NocoDB bulk PATCH ${tableId}: ${res.status} ${await res.text()}`);
  }
}

module.exports = {
  cfg,
  fetchAll,
  create,
  createBatch,
  update,
  updateBatch,
  CLAIMS: cfg.claimsTableId,
  AR:     cfg.arTableId,
};
