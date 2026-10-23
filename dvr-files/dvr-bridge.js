'use strict';
// Secure Assistant DVR bridge (version 1).
// Runs on a PC or old phone INSIDE the shop network. Every few minutes it asks the DVR whether each camera
// channel is alive and tells the server through POST /api/dvr/heartbeat (header X-Bridge-Token).
// It does NOT send any video. Needs Node.js 18 or newer. Nothing to install.
//
// Run:        node dvr-bridge.js            (keeps running)
// Test once:  node dvr-bridge.js --once     (one check, then stops)
// Settings are read from bridge-config.json in the same folder (copy bridge-config.example.json and fill it).
// bridge-config.json holds the token and the DVR password: keep it private, never upload it anywhere.

const fs = require('fs');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const VERSION = '1.0';
const args = process.argv.slice(2);
const once = args.includes('--once');
const cfgFile = path.resolve(args.find(a => !a.startsWith('--')) || path.join(__dirname, 'bridge-config.json'));

const log = (...a) => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19), ...a);
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
function fail(msg) { console.error('ERROR:', msg); process.exit(1); }

// ---------- settings ----------
function loadConfig() {
  let c;
  try { c = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); }
  catch (e) { return fail('Cannot read settings file ' + cfgFile + ' - ' + e.message); }
  const server = String(c.server || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//.test(server) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(server)) fail('"server" must start with https://');
  if (!/^dvr_[a-f0-9]{48}$/.test(String(c.token || ''))) fail('"token" is missing or wrong. Paste the token the app showed when you created the bridge.');
  if (!c.dvrHost) fail('"dvrHost" is missing (the DVR address, for example 192.168.1.10)');
  if (!Array.isArray(c.cameras) || !c.cameras.length || c.cameras.length > 64) fail('"cameras" must have 1 to 64 entries');
  const cameras = c.cameras.map((cam, i) => {
    if (!cam || !cam.cameraId) fail('camera ' + (i + 1) + ': "cameraId" is missing');
    if (!String(cam.rtspPath || '').startsWith('/')) fail('camera ' + (i + 1) + ': "rtspPath" must start with /');
    return {
      cameraId: String(cam.cameraId), rtspPath: String(cam.rtspPath),
      port: parseInt(cam.port || c.rtspPort, 10) || 554,
      username: cam.username !== undefined ? cam.username : c.username, password: cam.password !== undefined ? cam.password : c.password
    };
  });
  return { server, token: c.token, dvrHost: String(c.dvrHost), cameras, intervalSeconds: Math.max(60, parseInt(c.intervalSeconds, 10) || 120) };
}
const cfg = loadConfig();

// ---------- talk to the DVR (RTSP DESCRIBE) ----------
function rtspRequest(host, port, uri, authHeader, timeoutMs) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
    let buf = '', timer = null;
    const done = (fn, v) => { clearTimeout(timer); sock.destroy(); fn(v); };
    timer = setTimeout(() => done(reject, new Error('timeout')), timeoutMs);
    sock.on('error', e => done(reject, e));
    sock.on('close', () => done(reject, new Error('closed')));
    sock.on('connect', () => {
      let req = `DESCRIBE ${uri} RTSP/1.0\r\nCSeq: 1\r\nAccept: application/sdp\r\nUser-Agent: SecureAssistantBridge/${VERSION}\r\n`;
      if (authHeader) req += `Authorization: ${authHeader}\r\n`;
      sock.write(req + '\r\n');
    });
    sock.on('data', d => {
      buf += d.toString('latin1');
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) { if (buf.length > 65536) done(reject, new Error('bad response')); return; }
      const lines = buf.slice(0, end).split('\r\n');
      const m = /^RTSP\/\d\.\d\s+(\d{3})/.exec(lines[0]);
      if (!m) return done(reject, new Error('not an RTSP server'));
      const headers = {};
      for (const l of lines.slice(1)) {
        const i = l.indexOf(':');
        if (i > 0) (headers[l.slice(0, i).trim().toLowerCase()] ||= []).push(l.slice(i + 1).trim());
      }
      done(resolve, { status: Number(m[1]), headers });
    });
  });
}

function authHeaderFor(wwwAuth, method, uri, user, pass) {
  const digest = wwwAuth.find(h => /^digest/i.test(h));
  if (digest) {
    const p = {};
    for (const m of digest.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) p[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
    const ha1 = md5(`${user}:${p.realm}:${pass}`), ha2 = md5(`${method}:${uri}`);
    let resp, extra = '';
    if (p.qop && /auth/.test(p.qop)) {
      const nc = '00000001', cn = crypto.randomBytes(8).toString('hex');
      resp = md5(`${ha1}:${p.nonce}:${nc}:${cn}:auth:${ha2}`);
      extra = `, qop=auth, nc=${nc}, cnonce="${cn}"`;
    } else resp = md5(`${ha1}:${p.nonce}:${ha2}`);
    return `Digest username="${user}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${resp}"${extra}`;
  }
  if (wwwAuth.some(h => /^basic/i.test(h))) return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  return null;
}

// true = the DVR answered "200 OK" for this channel, so the camera is alive
async function channelOnline(cam) {
  const uri = `rtsp://${cfg.dvrHost}:${cam.port}${cam.rtspPath}`;
  const first = await rtspRequest(cfg.dvrHost, cam.port, uri, null, 8000);
  if (first.status === 200) return true;
  if (first.status !== 401 || !cam.username) return false;
  const h = authHeaderFor(first.headers['www-authenticate'] || [], 'DESCRIBE', uri, cam.username, cam.password || '');
  if (!h) return false;
  return (await rtspRequest(cfg.dvrHost, cam.port, uri, h, 8000)).status === 200;
}

// ---------- talk to the server ----------
async function sendHeartbeat(cameras) {
  const res = await fetch(cfg.server + '/api/dvr/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bridge-token': cfg.token },
    body: JSON.stringify({ version: VERSION, cameras }),
    signal: AbortSignal.timeout(60000) // the free Render server can take up to a minute to wake up
  });
  let body = {};
  try { body = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, body };
}

async function cycle() {
  try {
    const results = await Promise.all(cfg.cameras.map(async c => ({ cameraId: c.cameraId, online: await channelOnline(c).catch(() => false) })));
    log(`DVR check: ${results.filter(r => r.online).length} of ${results.length} cameras online`);
    results.filter(r => !r.online).forEach(r => log('  offline:', r.cameraId));
    const r = await sendHeartbeat(results);
    if (r.status === 200) log(`Server OK (${r.body.camerasUpdated} cameras updated)`);
    else if (r.status === 401) log('Server says: token is wrong or this bridge was deleted. Create a new bridge in the app.');
    else if (r.status === 403) log('Server says: ' + (r.body.error || 'not allowed') + ' (the plan must be active).');
    else if (r.status === 429) log('Server says: too many heartbeats. Increase intervalSeconds.');
    else log('Server answered with status ' + r.status);
  } catch (e) {
    log('Could not reach the server:', e.name === 'TimeoutError' ? 'timeout (the server may be waking up, will retry)' : e.message);
  }
}

(async function main() {
  log(`Secure Assistant DVR bridge v${VERSION} started. Cameras: ${cfg.cameras.length}. Check every ${cfg.intervalSeconds}s.`);
  if (once) { await cycle(); return; }
  for (;;) {
    await cycle();
    await new Promise(r => setTimeout(r, cfg.intervalSeconds * 1000));
  }
})();
process.on('SIGINT', () => { log('Stopped.'); process.exit(0); });