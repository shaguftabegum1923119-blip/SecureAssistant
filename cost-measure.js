'use strict';
// Cost measure: times face recognition on the real server and estimates the cost per camera. Needs Node 18 or newer.
// Run from the SecureAssistant folder:  node cost-measure.js
//
// What it does:
//  1. Signs in with your test account (it must have an active plan).
//  2. Adds one test person (with consent) from a clear one-face photo.
//  3. Sends the same photo to /api/facematch/identify 14 times, one after another, and times each call.
//  4. Prints the typical time and a rough cost per camera for different photo intervals.
//  5. Removes the test person. Your account is never deleted.
//
// The numbers are a rough guide: they include the trip through the Node server and Firestore, so the true
// Python-only time is a little lower. The first 2 calls are ignored (server warm-up).
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const BASE = (process.env.BACKEND_URL || 'https://secureassistant.onrender.com').replace(/\/+$/, '');
const IDENTITY = 'https://identitytoolkit.googleapis.com';
const TZ = 'Asia/Kolkata';
const SERVER_COST_RS = Number(process.env.SERVER_COST_RS || 2250);   // Python server cost per month in rupees
const CALLS = 14;
const WARMUP = 2;
const BUSY_SHARE = 0.6;   // only use 60 percent of the server so alerts and other work never wait

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function photoForm(photo, fields) {
  const form = new FormData();
  form.append('face', new Blob([fs.readFileSync(photo)], { type: mimeOf(photo) }), 'face' + path.extname(photo));
  for (const [k, v] of Object.entries(fields || {})) form.append(k, String(v));
  return form;
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

function median(list) {
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  console.log('Cost measure - ' + BASE + '\n');
  const apiKey = await ask('Firebase Web API key: ');
  const email = await ask('Email of your test account (with an active plan): ');
  const password = await ask('Password: ');
  let photo = (await ask('Path of a clear photo with ONE face (for example me.jpg): ')).replace(/^["']|["']$/g, '');
  photo = path.resolve(photo);
  if (!fs.existsSync(photo)) throw new Error('File not found: ' + photo);

  const login = await fetch(`${IDENTITY}/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const lj = await login.json().catch(() => ({}));
  if (!lj.idToken) throw new Error('Sign in failed. Check the Web API key, email and password.');
  const token = lj.idToken;
  console.log('Signed in.');

  let personId = null;
  try {
    const enroll = await call('POST', '/api/facematch/enroll', token,
      photoForm(photo, { name: 'Cost Test', role: 'test', purpose: 'Cost measure', consent: 'true', timezone: TZ }), true);
    if (!enroll.ok || !enroll.json || !enroll.json.id) {
      throw new Error('Could not add the test person: ' + (enroll.json && enroll.json.error || 'HTTP ' + enroll.status));
    }
    personId = enroll.json.id;
    console.log('Test person added. Timing ' + CALLS + ' calls...\n');

    const times = [];
    for (let i = 1; i <= CALLS; i++) {
      const t0 = Date.now();
      const r = await call('POST', '/api/facematch/identify', token, photoForm(photo, { timezone: TZ }), true);
      const ms = Date.now() - t0;
      if (!r.ok) throw new Error('identify failed: HTTP ' + r.status + ' ' + r.text.slice(0, 150));
      console.log('call ' + String(i).padStart(2) + ': ' + ms + ' ms' + (i <= WARMUP ? '  (warm-up, ignored)' : ''));
      if (i > WARMUP) times.push(ms);
    }

    const med = median(times);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const perSec = (1000 / med) * BUSY_SHARE;
    console.log('\nTypical time (median): ' + Math.round(med) + ' ms   average: ' + Math.round(avg) + ' ms');
    console.log('Server cost used: Rs ' + SERVER_COST_RS + ' per month, using ' + (BUSY_SHARE * 100) + ' percent of it.\n');
    console.log('One photo every...   cameras one server can follow   server cost per camera per month');
    for (const every of [10, 30, 60, 120]) {
      const cams = Math.max(1, Math.floor(perSec * every));
      console.log(String(every).padStart(10) + ' seconds   ' + String(cams).padStart(14) + ' cameras   Rs ' + String(Math.round(SERVER_COST_RS / cams)).padStart(6));
    }
    console.log('\nThese are rough numbers. Add a small margin for your price. Send me this screen.');
  } finally {
    if (personId) {
      const gone = await call('DELETE', '/api/facematch/' + personId, token).catch(() => null);
      console.log('\nTest person removed: ' + (gone && gone.ok ? 'yes' : 'NO - remove "Cost Test" from the app'));
    }
  }
}

main().catch(err => { console.error('\nSTOPPED: ' + err.message); process.exit(1); });