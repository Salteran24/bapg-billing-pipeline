'use strict';
// One-time script: force-joins all team members to all rooms on the Matrix server.

const MATRIX_URL  = 'https://chat.procare-solutions.net';
const HOMESERVER  = 'chat.procare-solutions.net';
const ADMIN_USER  = 'admin';
const ADMIN_PASS  = 'Matrix2026!JA';

const USERS = ['salvador','joseling','nelson','jorge','franco','cesar','eduardo'];

async function post(token, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${MATRIX_URL}${path}`, {
    method: 'POST', headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return res.json().catch(() => ({}));
}

async function get(token, path) {
  const res = await fetch(`${MATRIX_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  return res.json().catch(() => ({}));
}

async function main() {
  // Login as admin
  const login = await post(null, '/_matrix/client/v3/login', {
    type: 'm.login.password', user: ADMIN_USER, password: ADMIN_PASS,
  });
  const token = login.access_token;
  if (!token) { console.error('Login failed:', login); process.exit(1); }
  console.log('Logged in as admin\n');

  // Get all rooms
  const roomsData = await get(token, '/_synapse/admin/v1/rooms?limit=100');
  const rooms = (roomsData.rooms || []).filter(r => r.room_id);
  console.log(`Found ${rooms.length} rooms:\n`);
  rooms.forEach(r => console.log(`  ${r.name || '(no name)'} — ${r.room_id}`));
  console.log('');

  for (const room of rooms) {
    const roomId = room.room_id;
    const roomName = room.name || roomId;
    console.log(`\n=== ${roomName} ===`);

    // Make admin a room admin (works even if not in the room)
    const makeAdmin = await post(token,
      `/_synapse/admin/v1/rooms/${roomId}/make_room_admin`,
      { user_id: `@${ADMIN_USER}:${HOMESERVER}` }
    );
    if (makeAdmin.errcode) console.log(`  make_room_admin: ${makeAdmin.error}`);

    // Join admin to the room
    await post(token, `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {});

    // Force-join every user
    for (const user of USERS) {
      const result = await post(token,
        `/_synapse/admin/v1/join/${roomId}`,
        { user_id: `@${user}:${HOMESERVER}` }
      );
      if (result.room_id) {
        console.log(`  ✓ ${user}`);
      } else {
        const msg = result.error || JSON.stringify(result);
        console.log(`  ${msg.includes('already') ? '–' : '✗'} ${user}: ${msg}`);
      }
    }
  }

  console.log('\n✅ Done.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
