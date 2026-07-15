'use strict';
const MATRIX_URL  = 'https://chat.procare-solutions.net';
const ADMIN_TOKEN = 'syt_YWRtaW4_fuWfryWTFkAuhhUfLnYL_0NuKcy';
const TARGET_USER = '@carmen:chat.procare-solutions.net';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path) {
  const res = await fetch(`${MATRIX_URL}${path}`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

async function forceJoin(roomId) {
  const res = await fetch(`${MATRIX_URL}/_synapse/admin/v1/join/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: TARGET_USER }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (res.ok) console.log(`  ✓ Joined: ${roomId}`);
  else console.error(`  ✗ Failed ${roomId}: ${data.error || res.status}`);
}

async function main() {
  // Get all rooms on the server
  const data = await get('/_synapse/admin/v1/rooms?limit=100');
  const rooms = data.rooms || [];
  console.log(`Found ${rooms.length} rooms on the server:\n`);
  rooms.forEach(r => console.log(`  ${r.room_id}  "${r.name || '(no name)'}"`));

  console.log(`\nAdding ${TARGET_USER} to all rooms...\n`);
  for (const room of rooms) {
    await forceJoin(room.room_id);
    await sleep(400);
  }
  console.log('\nDone!');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
