'use strict';
// Watch test: checks Loitering and Unattended Baggage on the real server with real photos. Needs Node 18 or newer.
// Run from the SecureAssistant folder:  node watch-test.js
//
// What it does:
//  1. Signs in (a temporary test account, or an account of yours that has an ACTIVE plan).
//  2. Sends the same "person" photo again and again, a few seconds apart, like a camera that sees someone standing still.
//     The server should send exactly ONE Loitering alert.
//  3. Sends the "bag" photo the same way. The server should send exactly ONE Unattended Baggage alert.
//  4. Sends the "person lying on the floor" photo the same way. The server should send exactly ONE Person Down alert.
//  5. Cleans up what it created (and deletes the temporary account, if it made one).
//
// Photos needed:  one clear photo of a person standing (people.jpg will do), and optionally one photo with a bag
// (backpack, handbag or suitcase) and NOBODY near it, and optionally one photo of a person lying on the floor
// (the whole body visible, lying sideways in the picture, so the person looks wider than tall).
// Note: the watch routes need an active plan. A brand new temporary account has none, so if the first frame is refused,
// run this again and type the email of an account that has an active plan (the one you used for the payment test).
// That account will get two test alerts. It is never deleted by this script.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const BASE = (process.env.BACKEND_URL || 'https://secureassistant.onrender.com').replace(/\/+$/, '');
const IDENTITY = (process.env.IDENTITY_URL || 'https://identitytoolkit.googleapis.com').replace(/\/+$/, '');   // only changed for offline tests
const GAP_MS = parseInt(process.env.WATCH_TEST_INTERVAL_MS, 10) || 5000;    // time between frames
const TEST_SECONDS = 30;     // the shortest time the server accepts for "alone" and "staying"
const DOWN_TEST_SECONDS = 20; // time used for the person-down test (the server accepts 15 or more)
const MAX_FRAMES = 24;       // give up after this many frames

const sleep = ms => new Promise(r => setTimeout(r, ms));

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

function cleanPath(p) { return String(p || '').trim().replace(/^["']|["']$/g, ''); }

async function askPhoto(question, required, envName) {
  let p = cleanPath(process.env[envName]);
  if (!p) p = cleanPath(await ask(question));
  if (!p) {
    if (required) throw new Error('A photo is required');
    return null;
  }
  const full = path.resolve(p);
  if (!fs.existsSync(full)) throw new Error('File not found: ' + full);
  return full;
}

async function call(method, urlPath, token, body, isForm) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (body && isForm) payload = body;
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + urlPath, { method, headers, body: payload, signal: AbortSignal.timeout(90000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}

function step(name, ok, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? ' - ' + extra : ''));
  if (!ok) throw new Error('Stopped at: ' + name);
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function sendFrame(token, cameraId, photo, tool) {
  const form = new FormData();
  form.append('frame', new Blob([fs.readFileSync(photo)], { type: mimeOf(photo) }), 'frame' + path.extname(photo));
  form.append('cameraId', cameraId);
  form.append('tools', tool);
  form.append('aloneSeconds', String(TEST_SECONDS));
  form.append('loiterSeconds', String(TEST_SECONDS));
  form.append('downSeconds', String(DOWN_TEST_SECONDS));
  return call('POST', '/api/watch/frame', token, form, true);
}

// Sends the same photo repeatedly and checks that exactly one alert comes, and that it does not repeat.
async function scenario(token, cameraId, photo, tool, label, noun, hint) {
  let alerts = 0, frames = 0;
  for (let i = 1; i <= MAX_FRAMES; i++) {
    let r = await sendFrame(token, cameraId, photo, tool);
    if (i === 1 && r.status === 502) {            // the AI service may be waking up
      console.log('      The AI service looks asleep, waiting 20 seconds and trying once more...');
      await sleep(20000);
      r = await sendFrame(token, cameraId, photo, tool);
    }
    if (!r.ok) {
      const planHint = (r.status === 402 || r.status === 403) ? ' This account may have no active plan. Run again with an account that has one.' : '';
      step(`${label}: send frame ${i}`, false, `HTTP ${r.status} ${r.text.slice(0, 200)}${planHint}`);
    }
    frames = i;
    if (i === 1) {
      const seen = tool === 'loiter' ? r.json.peopleSeen : tool === 'down' ? r.json.peopleLying : r.json.bagsSeen;
      step(`${label}: ${noun} found in the photo`, seen >= 1, seen >= 1 ? '' : hint);
    }
    if (r.json.alerts && r.json.alerts[tool]) { alerts = 1; break; }
    await sleep(GAP_MS);
  }
  step(`${label}: one alert was sent`, alerts === 1, alerts === 1 ? `after ${frames} frames` : `none after ${frames} frames. ${hint}`);

  let repeats = 0;
  for (let k = 0; k < 3; k++) {
    await sleep(GAP_MS);
    const r = await sendFrame(token, cameraId, photo, tool);
    if (r.ok && r.json.alerts && r.json.alerts[tool]) repeats++;
  }
  step(`${label}: no second alert for the same thing`, repeats === 0);

  const st = await call('GET', '/api/watch/state/' + cameraId, token);
  const key = tool === 'loiter' ? 'people' : tool === 'down' ? 'down' : 'bags';
  const list = (st.json && st.json[key]) || [];
  step(`${label}: state shows the alert was recorded`, st.ok && list.some(x => x.alerted));
}

(async () => {
  const apiKey = process.env.FIREBASE_WEB_API_KEY || await ask('Firebase Web API key (Firebase console > Project settings > General): ');
  if (!apiKey) throw new Error('Web API key is required');

  const existingEmail = process.env.WATCH_TEST_EMAIL !== undefined
    ? process.env.WATCH_TEST_EMAIL.trim()
    : await ask('Email of an account that has an ACTIVE plan (press Enter to use a temporary test account): ');
  let existingPassword = '';
  if (existingEmail) existingPassword = process.env.WATCH_TEST_PASSWORD || await ask('Password for that account (typed only here, it is sent to Google to sign in): ');

  const personPhoto = await askPhoto('Path of a photo with one clear person standing (for example people.jpg): ', true, 'WATCH_PERSON_PHOTO');
  const bagPhoto = await askPhoto('Path of a photo with a bag and NOBODY near it (press Enter to skip the bag test): ', false, 'WATCH_BAG_PHOTO');
  const downPhoto = await askPhoto('Path of a photo of a person LYING on the floor, whole body visible (press Enter to skip): ', false, 'WATCH_DOWN_PHOTO');

  const stamp = Date.now();
  const cameras = ['watchtest_loiter_' + stamp, 'watchtest_bag_' + stamp, 'watchtest_down_' + stamp];
  let idToken = null;
  const isTemp = !existingEmail;

  try {
    if (isTemp) {
      const email = 'watchtest' + stamp + '@example.com';
      const password = 'Wt!' + crypto.randomBytes(6).toString('hex') + 'Aa1';
      const reg = await call('POST', '/api/auth/register', null, { email, password, name: 'Watch Test' });
      step('Create temporary test account', reg.ok && reg.json && reg.json.token, 'HTTP ' + reg.status);
      const res = await fetch(`${IDENTITY}/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: reg.json.token, returnSecureToken: true })
      });
      const j = await res.json();
      idToken = j.idToken;
      step('Sign in', !!idToken, res.ok ? '' : 'check the Web API key');
    } else {
      const res = await fetch(`${IDENTITY}/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: existingEmail, password: existingPassword, returnSecureToken: true })
      });
      const j = await res.json();
      idToken = j.idToken;
      step('Sign in with your account', !!idToken, res.ok ? '' : 'wrong email or password, or the Web API key is wrong');
    }

    console.log(`\nLoitering test: sending the person photo every ${Math.round(GAP_MS / 1000)} seconds (about ${Math.round(TEST_SECONDS + 3 * GAP_MS / 1000)}+ seconds in all)...`);
    await scenario(idToken, cameras[0], personPhoto, 'loiter', 'Loitering', 'person', 'Use a clear photo of one person standing, whole body visible.');

    if (bagPhoto) {
      console.log('\nUnattended baggage test: sending the bag photo the same way...');
      await scenario(idToken, cameras[1], bagPhoto, 'bag', 'Unattended bag', 'bag', 'Use a photo with a backpack, handbag or suitcase and NOBODY standing near it.');
    } else {
      console.log('\nBag test skipped (no bag photo given).');
    }

    if (downPhoto) {
      console.log('\nPerson down test: sending the lying-person photo the same way...');
      await scenario(idToken, cameras[2], downPhoto, 'down', 'Person down', 'lying person', 'Use a photo where one person lies on the floor with the whole body visible, looking at least 1.3 times wider than tall, and not very small in the picture.');
    } else {
      console.log('\nPerson down test skipped (no photo given).');
    }

    console.log('\nAll watch steps passed.');
    const made = ['Loitering'];
    if (bagPhoto) made.push('Unattended Baggage');
    if (downPhoto) made.push('Person Down');
    console.log('Test alerts were created (' + made.join(', ') + '). Check that they show in the app alert list or owner page.');
  } finally {
    if (idToken) {
      for (const id of cameras) await call('DELETE', '/api/watch/state/' + id, idToken).catch(() => {});
      if (isTemp) {
        const gone = await call('POST', '/api/user/delete', idToken, { confirm: 'DELETE' });
        console.log((gone.status === 202 ? 'PASS  ' : 'WARN  ') + 'Test account cleanup - HTTP ' + gone.status);
      } else {
        console.log('PASS  Test camera notes removed (your account was not deleted).');
      }
    }
  }
})().catch(e => { console.error('\n' + e.message); process.exit(1); });