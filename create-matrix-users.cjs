'use strict';
const MATRIX_URL   = 'https://chat.procare-solutions.net';
const ADMIN_TOKEN  = 'syt_YWRtaW4_fuWfryWTFkAuhhUfLnYL_0NuKcy';
const DEFAULT_PASS = 'ProCare2026!';

const USERS = [
  { username: 'alex',      displayName: 'Alex Narvaez' },
  { username: 'bianka',    displayName: 'Bianka Lara' },
  { username: 'brandon',   displayName: 'Brandon Mendoza' },
  { username: 'bryan',     displayName: 'Bryan Cuadra' },
  { username: 'carlo',     displayName: 'Carlo Lumbi' },
  { username: 'carmen',    displayName: 'Carmen Castillo' },
  { username: 'christiam', displayName: 'Christiam Garcia' },
  { username: 'diana',     displayName: 'Diana Obando' },
  { username: 'elisa',     displayName: 'Elisa Escobar' },
  { username: 'eveling',   displayName: 'Eveling Lampson' },
  { username: 'franco',    displayName: 'Franco Molina' },
  { username: 'gabriela',  displayName: 'Gabriela Cordero' },
  { username: 'greydi',    displayName: 'Greydi Zamora' },
  { username: 'guillermo', displayName: 'Guillermo Manzanares' },
  { username: 'hilda',     displayName: 'Hilda Sanchez' },
  { username: 'jennifer',  displayName: 'Jennifer Fernandez' },
  { username: 'joseling',  displayName: 'Joseling Araica' },
  { username: 'juan',      displayName: 'Juan De La Llana' },
  { username: 'keyla',     displayName: 'Keyla Meza' },
  { username: 'liz',       displayName: 'Liz Arauz' },
  { username: 'nelson',    displayName: 'Nelson Araica' },
  { username: 'mariag',    displayName: 'Maria Bone' },
  { username: 'mariak',    displayName: 'Maria Latino' },
  { username: 'margine',   displayName: 'Margine Garcia' },
  { username: 'nicole',    displayName: 'Nicole Vanegas' },
  { username: 'paola',     displayName: 'Paola Castellon' },
  { username: 'rossalba',  displayName: 'Rossalba Hueck' },
  { username: 'roxana',    displayName: 'Roxana Chavarria' },
  { username: 'steven',    displayName: 'Steven Gutierrez' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function createUser({ username, displayName }) {
  const userId = `@${username}:chat.procare-solutions.net`;
  const url = `${MATRIX_URL}/_synapse/admin/v2/users/${encodeURIComponent(userId)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: DEFAULT_PASS, displayname: displayName, admin: false }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (res.ok) {
    console.log(`  ✓ ${userId} (${displayName})`);
  } else {
    console.error(`  ✗ ${userId}: ${data.error || res.status}`);
  }
}

async function main() {
  console.log(`Creating ${USERS.length} users on ${MATRIX_URL}...\n`);
  console.log(`Default password: ${DEFAULT_PASS}\n`);
  for (const user of USERS) {
    await createUser(user);
    await sleep(300);
  }
  console.log('\nDone! Users can log in to Element with:');
  console.log(`  Server: ${MATRIX_URL}`);
  console.log(`  Password: ${DEFAULT_PASS} (they should change it after first login)`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
