'use strict';
/**
 * setup-matrix-room.cjs — ONE-TIME setup for the denial alert system.
 *
 * Run this once to:
 *   1. Create the denial-bot Matrix user
 *   2. Create the #denial-alert-BAPG room
 *   3. Invite all billing team members
 *   4. Print the BOT_TOKEN and ROOM_ID you need for denial-notifier.cjs
 *
 * Usage:
 *   node setup-matrix-room.cjs
 *
 * Then copy the printed MATRIX_BOT_TOKEN and MATRIX_ROOM_ID into
 * run-denial-notifier.bat.
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const MATRIX_URL  = 'https://chat.procare-solutions.net';
const ADMIN_USER  = 'admin';
const ADMIN_PASS  = 'Matrix2026!JA';

const BOT_USERNAME    = 'denial-bot';
const BOT_PASSWORD    = 'DenialBot2026!bapg';
const BOT_DISPLAYNAME = 'Denial Alert Bot';

const ROOM_ALIAS  = 'denial-alert-BAPG';
const ROOM_NAME   = 'BAPG Denial Alerts';
const ROOM_TOPIC  = 'Automated alerts for denied claims — DaisyBill (WC) + Dexter EOB (commercial)';
const HOMESERVER  = 'chat.procare-solutions.net';

// All billing team members to invite to the room
const TEAM_MEMBERS = [
  `@salvador:${HOMESERVER}`,
  `@joseling:${HOMESERVER}`,
  `@nelson:${HOMESERVER}`,
  `@jorge:${HOMESERVER}`,
  `@franco:${HOMESERVER}`,
  `@cesar:${HOMESERVER}`,
  `@eduardo:${HOMESERVER}`,
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function mxPost(token, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${MATRIX_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${data.error || JSON.stringify(data)}`);
  return data;
}

async function mxPut(token, path, body) {
  const res = await fetch(`${MATRIX_URL}${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}: ${data.error || JSON.stringify(data)}`);
  return data;
}

async function mxGet(token, path) {
  const res = await fetch(`${MATRIX_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${data.error || JSON.stringify(data)}`);
  return data;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. Login as admin ────────────────────────────────────────────────────
  console.log('Step 1: Logging in as admin...');
  const { access_token: adminToken } = await mxPost(null, '/_matrix/client/v3/login', {
    type: 'm.login.password',
    user: ADMIN_USER,
    password: ADMIN_PASS,
  });
  console.log('  ✓ Admin authenticated\n');

  // ── 2. Create bot user via Synapse Admin API ──────────────────────────────
  console.log(`Step 2: Creating bot user @${BOT_USERNAME}:${HOMESERVER}...`);
  try {
    await mxPut(adminToken,
      `/_synapse/admin/v2/users/@${BOT_USERNAME}:${HOMESERVER}`,
      { password: BOT_PASSWORD, displayname: BOT_DISPLAYNAME, admin: false }
    );
    console.log('  ✓ Bot user created\n');
  } catch (e) {
    if (e.message.includes('already')) {
      console.log('  ℹ  Bot user already exists — continuing\n');
    } else {
      throw e;
    }
  }

  // ── 3. Login as bot ───────────────────────────────────────────────────────
  console.log('Step 3: Logging in as bot...');
  const { access_token: botToken, user_id: botUserId } = await mxPost(null, '/_matrix/client/v3/login', {
    type: 'm.login.password',
    user: BOT_USERNAME,
    password: BOT_PASSWORD,
  });
  console.log(`  ✓ Bot logged in as ${botUserId}\n`);

  // ── 4. Create or find the room ────────────────────────────────────────────
  console.log(`Step 4: Creating room #${ROOM_ALIAS}:${HOMESERVER}...`);
  let roomId;

  try {
    const roomRes = await mxPost(botToken, '/_matrix/client/v3/createRoom', {
      room_alias_name: ROOM_ALIAS,
      name: ROOM_NAME,
      topic: ROOM_TOPIC,
      visibility: 'private',
      preset: 'private_chat',
      invite: TEAM_MEMBERS,
    });
    roomId = roomRes.room_id;
    console.log(`  ✓ Room created: ${roomId}\n`);
  } catch (e) {
    if (e.message.includes('M_ROOM_IN_USE') || e.message.includes('in use')) {
      console.log('  ℹ  Room already exists — fetching its ID...');
      const aliasEncoded = encodeURIComponent(`#${ROOM_ALIAS}:${HOMESERVER}`);
      const d = await mxGet(botToken, `/_matrix/client/v3/directory/room/${aliasEncoded}`);
      roomId = d.room_id;
      console.log(`  Room ID: ${roomId}`);

      // Make sure all team members are invited
      console.log('  Re-inviting team members in case any were missed...');
      for (const userId of TEAM_MEMBERS) {
        try {
          await mxPost(botToken, `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
            user_id: userId,
          });
          console.log(`    Invited ${userId}`);
        } catch (inviteErr) {
          // "already in room" is fine
          console.log(`    ${userId}: ${inviteErr.message.includes('already') ? 'already in room' : inviteErr.message}`);
        }
      }
      console.log();
    } else {
      throw e;
    }
  }

  // ── 5. Send welcome message ───────────────────────────────────────────────
  console.log('Step 5: Sending welcome message to room...');
  await mxPut(botToken,
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/setup-${Date.now()}`,
    {
      msgtype: 'm.text',
      body: [
        '🤖 Denial Alert Bot is now active.',
        '',
        'This channel will receive an automatic alert whenever:',
        '  • DaisyBill (WC billing) records a DENIED claim',
        '  • Dexter Index sheet shows a new DENIED EOB',
        '',
        'Scope: claims with Date of Service on or after June 1, 2026.',
        '',
        'Each alert includes: patient name, DOS, and source.',
        'The bot checks every 30 minutes.',
      ].join('\n'),
    }
  );
  console.log('  ✓ Welcome message sent\n');

  // ── 6. Print output ───────────────────────────────────────────────────────
  const line = '='.repeat(62);
  console.log(line);
  console.log('  SETUP COMPLETE — copy these two lines into run-denial-notifier.bat');
  console.log(line);
  console.log(`  MATRIX_BOT_TOKEN=${botToken}`);
  console.log(`  MATRIX_ROOM_ID=${roomId}`);
  console.log(line);
  console.log('\nDone. Team members will see a room invite in Element X.');
}

main().catch(e => {
  console.error('\n❌ Fatal:', e.message);
  process.exit(1);
});
