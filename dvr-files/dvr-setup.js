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
const stop = msg => { console.error('\nRUKO: ' + msg); process.exit(1); };

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
  } catch (e) { stop('Server tak nahi pahunch paya (' + e.message + '). Render soya ho sakta hai, 1 minute baad dobara chalaiye.'); }
  const text = await r.text();
  let data = {}; try { data = JSON.parse(text); } catch (e) { data = {}; }
  return { ok: r.ok, status: r.status, data, text };
}

const BRANDS = {
  '1': { name: 'Hikvision jaisa', path: ch => '/Streaming/Channels/' + ch + '01' },
  '2': { name: 'CP Plus ya Dahua jaisa', path: ch => '/cam/realmonitor?channel=' + ch + '&subtype=0' }
};

(async () => {
  console.log('\n=== Secure Assistant DVR setup ===\n');
  const email = await ask('Aapka app wala email: ');
  const password = await ask('Aapka password (screen par nahi dikhega): ', true);
  console.log('');
  let apiKey = readKeyFromEnvFile();
  if (!apiKey) apiKey = await ask('Firebase Web API key (Firebase > Project settings > General > Web API Key): ');
  if (!email || !password || !apiKey) stop('Email, password aur API key teeno chahiye.');

  console.log('\nDVR ki jaankari (ye sirf is PC par bridge-config.json mein rahegi):');
  const dvrHost = await ask('DVR ka IP address (jaise 192.168.1.10): ');
  const rtspPort = parseInt(await ask('RTSP port [554]: '), 10) || 554;
  const dvrUser = await ask('DVR ka username: ');
  const dvrPass = await ask('DVR ka password (screen par nahi dikhega): ', true);
  console.log('');
  const brandKey = await ask('DVR kis tarah ka hai? 1 = Hikvision jaisa, 2 = CP Plus ya Dahua jaisa [2]: ');
  const brand = BRANDS[brandKey] || BRANDS['2'];
  const channels = Math.max(1, Math.min(64, parseInt(await ask('Kitne camera channel jodne hain [1]: '), 10) || 1));
  if (!dvrHost || !dvrUser || !dvrPass) stop('DVR ka IP, username aur password chahiye.');

  console.log('\nLogin ho raha hai...');
  let login;
  try {
    const r = await fetch(AUTH_URL + '?key=' + encodeURIComponent(apiKey), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }), signal: AbortSignal.timeout(30000)
    });
    login = { ok: r.ok, data: await r.json() };
  } catch (e) { stop('Login server tak nahi pahunch paya: ' + e.message); }
  if (!login.ok) stop('Login nahi hua: ' + ((login.data.error && login.data.error.message) || 'galat email, password ya API key'));
  const token = login.data.idToken;

  console.log('Aapke cameras dekh raha hoon...');
  const list = await call('GET', '/api/cameras/list', token);
  if (!list.ok) stop('Camera list nahi mili: ' + (list.data.error || list.status));
  const existing = {};
  for (const c of list.data.cameras || []) existing[c.name] = c.id;

  const cameraIds = [], cameraRows = [];
  for (let ch = 1; ch <= channels; ch++) {
    const name = 'DVR Channel ' + ch;
    let id = existing[name];
    if (id) console.log('  ' + name + ': pehle se hai, wahi use kar raha hoon');
    else {
      const rtspUrl = 'rtsp://' + dvrHost + ':' + rtspPort + brand.path(ch); // no username or password in it on purpose
      const r = await call('POST', '/api/cameras/add', token, { type: 'ip_rtsp', name, rtspUrl, locationLabel: 'DVR' });
      if (!r.ok) stop(name + ' nahi ban paya: ' + (r.data.error || r.status) + (r.status === 403 ? '\nAapke plan mein itne cameras ki ijazat nahi hai. Kam channel chuniye ya plan badhaiye.' : ''));
      id = r.data.id;
      console.log('  ' + name + ': ban gaya');
    }
    cameraIds.push(id);
    cameraRows.push({ cameraId: id, rtspPath: brand.path(ch) });
  }

  console.log('\nBridge server par bana raha hoon...');
  const reg = await call('POST', '/api/dvr/register', token, { name: 'Shop DVR', cameraIds });
  if (!reg.ok) stop('Bridge nahi bana: ' + (reg.data.error || reg.status) + (reg.status === 403 ? '\nYe sirf paid plan par chalta hai.' : ''));
  const found = reg.text.match(/dvr_[a-f0-9]{48}/);
  if (!found) stop('Server ne bridge bana diya par token nahi dikhaya. Mujhe ye line bhejiye (token ke bina): ' + reg.text.replace(/dvr_[a-f0-9]+/g, 'dvr_...').slice(0, 300));

  const cfgFile = path.join(__dirname, 'bridge-config.json');
  if (fs.existsSync(cfgFile)) {
    const ans = (await ask('\nbridge-config.json pehle se hai. Naye se badal dun? (y = haan, n = nahi): ')).toLowerCase();
    if (ans !== 'y') stop('Maine kuch nahi badla. Token sirf ek baar dikhta hai, isliye dobara chalakar naya bridge banaiye.');
  }
  const cfg = {
    server: SERVER, token: found[0], dvrHost, rtspPort, username: dvrUser, password: dvrPass,
    intervalSeconds: 120, cameras: cameraRows
  };
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  console.log('\nHO GAYA. bridge-config.json ban gayi (ye file kisi ko mat dijiye, GitHub par mat daaliye).');
  console.log('Ab test kijiye:   node dvr-bridge.js --once');
})();