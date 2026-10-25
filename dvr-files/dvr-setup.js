'use strict';
// One-time setup helper for the DVR bridge. Run it on the PC that sits in the shop network:   node dvr-setup.js
// It logs in with your email and password, makes one camera per DVR channel, creates the bridge on the server
// and writes bridge-config.json for you. Nothing to install (Node.js 18 or newer).
// The DVR address, username and password are written ONLY into bridge-config.json on this PC. They are never sent to the server.

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const SERVER = (process.env.SA_SERVER || 'https://secureassistant.onrender.com').replace(/\/+$/, '');
const AUTH_URL = process.env.SA_AUTH_URL || 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const scripted = process.env.SA_ANSWERS ? JSON.parse(process.env.SA_ANSWERS) : null; // only used for automatic tests

function ask(question, hidden) {
  if (scripted) return Promise.resolve(String(scripted.shift() || ''));
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
    if (hidden) rl._writeToOutput = s => { rl.output.write(s.includes('\n') || s.includes('\r') ? s : '*'); };
  });
}
const stop = msg => { console.error('\nSTOP: ' + msg); process.exit(1); };

function readKeyFromEnvFile() {
  for (const f of [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')]) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/^\s*FIREBASE_API_KEY\s*=\s*(.+?)\s*$/m);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    } catch (e) { /* file not there, try the next one */ }
  }
  return '';
}

async function call(method, urlPath, token, body) {
  let r;
  try {
    r = await fetch(SERVER + urlPath, {
      method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90000)
    });
  } catch (e) { stop('Could not reach the server (' + e.message + '). Render may be asleep, try again in 1 minute.'); }
  const text = await r.text();
  let data = {}; try { data = JSON.parse(text); } catch (e) { data = {}; }
  return { ok: r.ok, status: r.status, data, text };
}

const BRANDS = {
  '1': { name: 'Hikvision style', path: ch => '/Streaming/Channels/' + ch + '01' },
  '2': { name: 'CP Plus or Dahua style', path: ch => '/cam/realmonitor?channel=' + ch + '&subtype=0' }
};

(async () => {
  console.log('\n=== Secure Assistant DVR setup ===\n');
  const email = await ask('Your app email: ');
  const password = await ask('Your password (hidden while typing): ', true);
  console.log('');
  let apiKey = readKeyFromEnvFile();
  if (!apiKey) apiKey = await ask('Firebase Web API key (Firebase > Project settings > General > Web API Key): ');
  if (!email || !password || !apiKey) stop('Email, password and API key are all required.');

  console.log('\nDVR details (these stay only in bridge-config.json on this PC):');
  const dvrHost = await ask('DVR IP address (for example 192.168.1.10): ');
  const rtspPort = parseInt(await ask('RTSP port [554]: '), 10) || 554;
  const dvrUser = await ask('DVR username: ');
  const dvrPass = await ask('DVR password (hidden while typing): ', true);
  console.log('');
  const brandKey = await ask('DVR type? 1 = Hikvision style, 2 = CP Plus or Dahua style [2]: ');
  const brand = BRANDS[brandKey] || BRANDS['2'];
  const channels = Math.max(1, Math.min(64, parseInt(await ask('How many camera channels to connect [1]: '), 10) || 1));
  if (!dvrHost || !dvrUser || !dvrPass) stop('DVR IP, username and password are required.');

  console.log('\nLogging in...');
  let login;
  try {
    const r = await fetch(AUTH_URL + '?key=' + encodeURIComponent(apiKey), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }), signal: AbortSignal.timeout(30000)
    });
    login = { ok: r.ok, data: await r.json() };
  } catch (e) { stop('Could not reach the login server: ' + e.message); }
  if (!login.ok) stop('Login failed: ' + ((login.data.error && login.data.error.message) || 'wrong email, password or API key'));
  const token = login.data.idToken;

  console.log('Checking your cameras...');
  const list = await call('GET', '/api/cameras/list', token);
  if (!list.ok) stop('Could not get the camera list: ' + (list.data.error || list.status));
  const existing = {};
  for (const c of list.data.cameras || []) existing[c.name] = c.id;

  const cameraIds = [], cameraRows = [];
  for (let ch = 1; ch <= channels; ch++) {
    const name = 'DVR Channel ' + ch;
    let id = existing[name];
    if (id) console.log('  ' + name + ': already exists, reusing it');
    else {
      const rtspUrl = 'rtsp://' + dvrHost + ':' + rtspPort + brand.path(ch); // no username or password in it on purpose
      const r = await call('POST', '/api/cameras/add', token, { type: 'ip_rtsp', name, rtspUrl, locationLabel: 'DVR' });
      if (!r.ok) stop(name + ' could not be created: ' + (r.data.error || r.status) + (r.status === 403 ? '\nYour plan does not allow this many cameras. Choose fewer channels or upgrade the plan.' : ''));
      id = r.data.id;
      console.log('  ' + name + ': created');
    }
    cameraIds.push(id);
    cameraRows.push({ cameraId: id, rtspPath: brand.path(ch) });
  }

  console.log('\nCreating the bridge on the server...');
  const reg = await call('POST', '/api/dvr/register', token, { name: 'Shop DVR', cameraIds });
  if (!reg.ok) stop('Could not create the bridge: ' + (reg.data.error || reg.status) + (reg.status === 403 ? '\nThis works only on a paid plan.' : ''));
  const found = reg.text.match(/dvr_[a-f0-9]{48}/);
  if (!found) stop('The server created the bridge but did not show a token. Send this line (without the token): ' + reg.text.replace(/dvr_[a-f0-9]+/g, 'dvr_...').slice(0, 300));

  const cfgFile = path.join(__dirname, 'bridge-config.json');
  if (fs.existsSync(cfgFile)) {
    const ans = (await ask('\nbridge-config.json already exists. Replace it with the new one? (y = yes, n = no): ')).toLowerCase();
    if (ans !== 'y') stop('Nothing was changed. The token is shown only once, so run this again to create a new bridge.');
  }
  const cfg = {
    server: SERVER, token: found[0], dvrHost, rtspPort, username: dvrUser, password: dvrPass,
    intervalSeconds: 120, cameras: cameraRows
  };
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  console.log('\nDONE. bridge-config.json has been created (do not share it and never put it on GitHub).');
  console.log('Now test it:   node dvr-bridge.js --once');
})();