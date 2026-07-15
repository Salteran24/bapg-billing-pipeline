/**
 * matrix-notify.cjs — Matrix notification helper
 *
 * Sends a message to the "Billing Notifications" room.
 * Reads matrix-config.json for credentials (created by matrix-setup.cjs).
 *
 * Usage (from other scripts):
 *   const { notifyMatrix } = require('./matrix-notify.cjs');
 *   await notifyMatrix('Hello from superbill bot!');
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'matrix-config.json');

let _config = null;

function loadConfig() {
  if (_config) return _config;
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(
      'matrix-config.json not found. Run `node matrix-setup.cjs` first.'
    );
  }
  _config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  return _config;
}

async function notifyMatrix(text) {
  const { matrixUrl, accessToken, roomId } = loadConfig();
  const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const url =
    `${matrixUrl}/_matrix/client/v3/rooms/` +
    `${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ msgtype: 'm.text', body: text }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Matrix API ${res.status}: ${err}`);
  }

  return res.json();
}

module.exports = { notifyMatrix };
