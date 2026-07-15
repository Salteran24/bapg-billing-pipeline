'use strict';
/**
 * create-views.cjs — crea vistas filtradas en NocoDB Claims Tracker
 *
 * Vistas que crea:
 *   - Salvador       → Owner = Salvador, Status != Done
 *   - Alejandro      → Owner = Alejandro, Status != Done
 *   - Unclaimed      → Owner = Unclaimed
 *   - Not Started    → Submission Status = Not Started
 *   - Sent           → Submission Status = Sent
 *
 * Usage: node nocodb/create-views.cjs
 */

const fs   = require('fs');
const path = require('path');
const cfg  = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'nocodb-config.json'), 'utf8'));

const TABLE_ID = cfg.claimsTableId;
const BASE_URL = cfg.baseUrl;
const TOKEN    = cfg.token;

const H = {
  'xc-auth': TOKEN,
  'xc-token': TOKEN,
  'Content-Type': 'application/json',
};

async function apiFetch(method, endpoint, body) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${endpoint} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function createView(title) {
  console.log(`  Creating view: "${title}"...`);
  const data = await apiFetch('POST', `/api/v1/db/meta/tables/${TABLE_ID}/views`, {
    title,
    type: 0, // Grid
  });
  const id = data.id || data?.list?.[0]?.id;
  if (!id) throw new Error(`No view ID returned: ${JSON.stringify(data)}`);
  console.log(`    → view ID: ${id}`);
  return id;
}

async function addFilter(viewId, field, op, value) {
  await apiFetch('POST', `/api/v1/db/meta/views/${viewId}/filters`, {
    fk_column_id: field,
    logical_op:   'and',
    comparison_op: op,
    value,
  });
}

async function getColumns() {
  const data = await apiFetch('GET', `/api/v2/meta/tables/${TABLE_ID}`);
  return data.columns || [];
}

async function main() {
  console.log('Fetching columns...');
  const cols = await getColumns();

  const col = (name) => {
    const c = cols.find(c => c.title === name);
    if (!c) throw new Error(`Column not found: "${name}"`);
    return c.id;
  };

  const ownerCol = col('Owner');
  const statusCol = col('Submission Status');

  const views = [
    {
      title: 'Salvador',
      filters: [
        { col: ownerCol,  op: 'eq',  val: 'Salvador' },
        { col: statusCol, op: 'neq', val: 'Done' },
      ],
    },
    {
      title: 'Alejandro',
      filters: [
        { col: ownerCol,  op: 'eq',  val: 'Alejandro' },
        { col: statusCol, op: 'neq', val: 'Done' },
      ],
    },
    {
      title: 'Unclaimed',
      filters: [
        { col: ownerCol, op: 'eq', val: 'Unclaimed' },
      ],
    },
    {
      title: 'Not Started',
      filters: [
        { col: statusCol, op: 'eq', val: 'Not Started' },
      ],
    },
    {
      title: 'Sent',
      filters: [
        { col: statusCol, op: 'eq', val: 'Sent' },
      ],
    },
  ];

  for (const v of views) {
    try {
      const viewId = await createView(v.title);
      for (const f of v.filters) {
        await addFilter(viewId, f.col, f.op, f.val);
        console.log(`    filter added: ${f.op} ${f.val}`);
      }
    } catch (e) {
      console.error(`  ERROR on "${v.title}": ${e.message}`);
    }
  }

  console.log('\nDone. Refresh NocoDB to see the new views in the sidebar.');
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
