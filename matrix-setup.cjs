/**
 * matrix-setup.cjs — one-time setup script
 * Usage: node matrix-setup.cjs
 *
 * Logs in as admin to the Matrix homeserver, creates the "Billing Notifications"
 * room, invites all billers, and saves matrix-config.json for use by watch.cjs.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const MATRIX_URL   = 'https://chat.procare-solutions.net';
const ADMIN_USER   = 'admin';
const ADMIN_PASS   = 'Matrix2026!JA';
const CONFIG_FILE  = path.join(__dirname, 'matrix-config.json');

// All billers to invite to the room
const BILLERS = [
  '@joseling:chat.procare-solutions.net',
  '@nelson:chat.procare-solutions.net',
  '@jorge:chat.procare-solutions.net',
  '@franco:chat.procare-solutions.net',
  '@cesar:chat.procare-solutions.net',
  '@eduardo:chat.procare-solutions.net',
  '@salvador:chat.procare-solutions.net',
];

async function matrixPost(path, body, token) {
  const res = await fetch(`${MATRIX_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  console.log('🔐 Logging in as admin...');
  const loginResp = await matrixPost('/_matrix/client/v3/login', {
    type: 'm.login.password',
    user: ADMIN_USER,
    password: ADMIN_PASS,
  });
  const token = loginResp.access_token;
  console.log('   ✅ Got access token');

  console.log('\n🏠 Creating "Billing Notifications" room...');
  const roomResp = await matrixPost(
    '/_matrix/client/v3/createRoom',
    {
      name: 'Billing Notifications',
      topic: 'Notificaciones automáticas de superbills procesados',
      preset: 'private_chat',
      invite: BILLERS,
    },
    token
  );
  const roomId = roomResp.room_id;
  console.log(`   ✅ Room ID: ${roomId}`);

  // Send a welcome message
  const txnId = Date.now();
  await fetch(
    `${MATRIX_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        msgtype: 'm.text',
        body:
          '🤖 Superbill Bot activado.\n\n' +
          'Recibirán una notificación aquí cada vez que se procese un nuevo superbill PDF.',
      }),
    }
  );
  console.log('   ✅ Welcome message sent');

  const config = { matrixUrl: MATRIX_URL, accessToken: token, roomId };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log(`\n💾 Config saved to ${CONFIG_FILE}`);
  console.log('\n✅ Setup complete. You can now run: node watch.cjs\n');
}

main().catch(e => { console.error('❌ Setup failed:', e.message); process.exit(1); });
