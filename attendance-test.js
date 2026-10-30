'use strict';
// Attendance test: checks the selfie check-in on the real server with real photos. Needs Node 18 or newer.
// Run from the SecureAssistant folder:  node attendance-test.js
//
// What it does:
//  1. Signs in (an account of yours that has an ACTIVE plan; a brand new temporary account has no plan).
//  2. Adds one test person with consent, using a clear photo of one face.
//  3. Checks in with the same photo: the server must record it. A second check-in right away must be ignored (duplicate).
//  4. Checks out: must be recorded. Then "today" and the report must show the person.
//  5. Optional: a photo of a DIFFERENT person must NOT be recorded.
//  6. Removes the test person and the test records. Your account is never deleted (a temporary account is).
//
// Photos needed:  one clear front-facing photo with ONE face (me.jpg will do), and optionally one photo of a different person
// with ONE face (not people.jpg, it has three faces).
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const BASE = (process.env.BACKEND_URL || 'https://secureassistant.onrender.com').replace(/\/+$/, '');
const IDENTITY = (process.env.IDENTITY_URL || 'https://identitytoolkit.googleapis.com').replace(/\/+$/, '');   // only changed for offline tests
const TZ = 'Asia/Kolkata';

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

function photoForm(photo, fields) {
  const form = new FormData();
  form.append('face', new Blob([fs.readFileSync(photo)], { type: mimeOf(photo) }), 'face' + path.extname(photo));
  for (const [k, v] of Object.entries(fields || {})) form.append(k, String(v));
  return form;
}

const checkin = (token, photo, type) => call('POST', '/api/attendance/checkin', token, photoForm(photo, { type, timezone: TZ }), true);

(async () => {
  const apiKey = process.env.FIREBASE_WEB_API_KEY || await ask('Firebase Web API key (Firebase console > Project settings > General): ');
  if (!apiKey) throw new Error('Web API key is required');

  const existingEmail = process.env.ATT_TEST_EMAIL !== undefined
    ? process.env.ATT_TEST_EMAIL.trim()
    : await ask('Email of an account that has an ACTIVE plan (press Enter to use a temporary test account): ');
  let existingPassword = '';
  if (existingEmail) existingPassword = process.env.ATT_TEST_PASSWORD || await ask('Password for that account (typed only here, it is sent to Google to sign in): ');

  const mainPhoto = await askPhoto('Path of a clear photo with ONE face (for example me.jpg): ', true, 'ATT_PHOTO');
  const otherPhoto = await askPhoto('Path of a photo of a DIFFERENT person with one face (press Enter to skip): ', false, 'ATT_OTHER_PHOTO');

  const stamp = Date.now();
  const isTemp = !existingEmail;
  let idToken = null, personId = null;

  try {
    if (isTemp) {
      const email = 'atttest' + stamp + '@example.com';
      const password = 'At!' + crypto.randomBytes(6).toString('hex') + 'Aa1';
      const reg = await call('POST', '/api/auth/register', null, { email, password, name: 'Attendance Test' });
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

    // 1. add the test person with consent
    const name = 'Attendance Test ' + stamp;
    const enroll = await call('POST', '/api/facematch/enroll', idToken, photoForm(mainPhoto, { name, role: 'test', purpose: 'Attendance test', consent: 'true', timezone: TZ }), true);
    if (enroll.status === 403 && /subscription/i.test(enroll.text)) {
      throw new Error('This account has no active plan. Run this again and type the email of an account that has an active plan (the one from the payment test).');
    }
    step('Add test person with consent', enroll.ok && enroll.json && enroll.json.id, enroll.ok ? '' : (enroll.json && enroll.json.error) || 'HTTP ' + enroll.status);
    personId = enroll.json.id;

    // 2. check in
    const first = await checkin(idToken, mainPhoto, 'in');
    step('Check in is recorded', first.ok && first.json && first.json.recorded === true && first.json.person && first.json.person.id === personId,
      first.ok ? ((first.json && first.json.message) || '') : (first.json && first.json.error) || 'HTTP ' + first.status);
    const today = first.json.date;

    // 3. a second check-in right away is ignored
    const again = await checkin(idToken, mainPhoto, 'in');
    step('Second check-in right away is ignored (duplicate)', again.ok && again.json && again.json.recorded === false && again.json.duplicate === true);

    // 4. check out
    const out = await checkin(idToken, mainPhoto, 'out');
    step('Check out is recorded', out.ok && out.json && out.json.recorded === true, out.ok ? '' : (out.json && out.json.error) || 'HTTP ' + out.status);

    // 5. today and report
    const t = await call('GET', '/api/attendance/today?timezone=' + encodeURIComponent(TZ), idToken);
    const row = t.ok && t.json && (t.json.people || []).find(x => x.personId === personId);
    step('Today shows the person with check-in and check-out', !!row && row.status === 'complete', row ? 'first in ' + row.firstIn + ', last out ' + row.lastOut : 'person not found');
    step('Today does not list the person as "not checked in"', !(t.json.notCheckedIn || []).some(x => x.id === personId));

    const rep = await call('GET', `/api/attendance/report?from=${today}&to=${today}&timezone=${encodeURIComponent(TZ)}&personId=${personId}`, idToken);
    step('Report shows one day for the person', rep.ok && rep.json && (rep.json.days || []).length === 1 && (rep.json.totals || []).some(x => x.personId === personId && x.daysPresent === 1));

    // 6. a different person must not be recorded
    if (otherPhoto) {
      const other = await checkin(idToken, otherPhoto, 'in');
      step('A different person is NOT recorded', other.ok && other.json && other.json.recorded === false && other.json.matched !== true,
        other.json && other.json.message ? other.json.message : 'use a clear photo with ONE face of a different person');
    } else {
      console.log('\nDifferent-person test skipped (no photo given).');
    }

    console.log('\nAll attendance steps passed.');
  } finally {
    if (idToken) {
      if (personId) {
        const r1 = await call('DELETE', '/api/attendance/person/' + personId, idToken).catch(() => null);
        const r2 = await call('DELETE', '/api/facematch/' + personId, idToken).catch(() => null);
        console.log((r1 && r1.ok && r2 && r2.ok ? 'PASS  ' : 'WARN  ') + 'Test person and test records removed');
      }
      if (isTemp) {
        const gone = await call('POST', '/api/user/delete', idToken, { confirm: 'DELETE' });
        console.log((gone.status === 202 ? 'PASS  ' : 'WARN  ') + 'Test account cleanup - HTTP ' + gone.status);
      } else {
        console.log('PASS  Your account was not deleted.');
      }
    }
  }
})().catch(e => { console.error('\n' + e.message); process.exit(1); });