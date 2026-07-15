/**
 * drchrono-auth.cjs — one-time OAuth2 setup
 * Usage: node drchrono-auth.cjs
 *
 * Opens your browser to DrChrono's auth page, catches the callback on
 * http://localhost:8000/oauth, exchanges the code for tokens, and saves
 * them to drchrono-tokens.json.  Run this once; drchrono-sync.cjs handles
 * refresh automatically after that.
 */
'use strict';

const http   = require('http');
const { exec } = require('child_process');
const fs     = require('fs');
const path   = require('path');

const CONFIG_FILE = path.join(__dirname, 'drchrono-config.json');
const TOKENS_FILE = path.join(__dirname, 'drchrono-tokens.json');

if (!fs.existsSync(CONFIG_FILE)) {
  console.error('drchrono-config.json not found. Create it first.');
  process.exit(1);
}

const { client_id, client_secret, redirect_uri } = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

if (client_id === 'PASTE_CLIENT_ID_HERE') {
  console.error('Fill in client_id and client_secret in drchrono-config.json first.');
  process.exit(1);
}

const authUrl =
  'https://drchrono.com/o/authorize/?' +
  new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri,
  });

console.log('\n🔐 Opening DrChrono authorization page...');
console.log('   If the browser does not open, visit:\n  ', authUrl, '\n');

// Open browser (Windows)
exec(`start "" "${authUrl}"`);

const server = http.createServer(async (req, res) => {
  const url  = new URL(req.url, 'http://localhost:8000');
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h2>❌ No authorization code received. Please try again.</h2>');
    return;
  }

  try {
    const tokenRes = await fetch('https://drchrono.com/o/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri,
        client_id,
        client_secret,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Token exchange failed (${tokenRes.status}): ${err}`);
    }

    const tokens = await tokenRes.json();
    tokens.obtained_at = Date.now();

    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <h2 style="font-family:sans-serif;color:green">
        ✅ Authentication successful!<br>
        <small style="color:#555">You can close this tab and return to the terminal.</small>
      </h2>
    `);

    console.log('✅ Tokens saved to drchrono-tokens.json');
    console.log('   You can now run: node drchrono-sync.cjs\n');
    server.close();
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Error: ${e.message}`);
    console.error('❌ Error:', e.message);
    server.close();
  }
});

server.listen(8000, () => {
  console.log('   Listening on http://localhost:8000/oauth ...\n');
});
