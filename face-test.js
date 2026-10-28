'use strict';
// FACE MATCH TEST (face-test.js)
// Checks the live face routes end to end: add a person, list, recognise, reject a different person, delete.
// It makes a temporary test account, turns on a one-hour test plan for it, and removes everything it created.
// Run it from the SecureAssistant folder (the one that has .env):  node face-test.js
// Use a photo of yourself, or of someone who agrees. The photo is never saved; only a 128-number template is kept during the test.
const fs = require('fs');
const readline = require('readline');

const BACKEND = process.env.BACKEND_URL || 'https://secureassistant.onrender.com';

let failed = 0;
function pass(name, extra) { console.log('PASS  ' + name + (extra ? ' - ' + extra : '')); }
function fail(name, err) { failed++; console.log('FAIL  ' + name + ' - ' + (err && err.message ? err.message : err)); }
async function step(name, fn) {
  try { const extra = await fn(); pass(name, extra); return true; } catch (e) { fail(name, e); return false; }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(resolve => rl.question(q, a => resolve(a.trim().replace(/^"|"$/g, ''))));

async function firebase(endpoint, key, payload) {
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:' + endpoint + '?key=' + encodeURIComponent(key), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) throw new Error('Firebase ' + endpoint + ' failed: ' + ((data.error && data.error.message) || res.status));
  return data;
}

async function call(method, path, token, body) {
  const res = await fetch(BACKEND + path, { method, headers: { Authorization: 'Bearer ' + token }, body });
  let data = {};
  try { data = await res.json(); } catch (e) { /* not JSON */ }
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (data.error || ''));
  return data;
}

const mimeOf = file => (/\.png$/i.test(file) ? 'image/png' : 'image/jpeg');
function photoForm(buffer, mime, extra) {
  const form = new FormData();
  form.append('face', new Blob([buffer], { type: mime }), 'face.jpg');
  Object.keys(extra || {}).forEach(k => form.append(k, extra[k]));
  return form;
}

async function main() {
  const key = await ask('Firebase Web API key: ');
  const photoFile = await ask('File name of a photo with ONE clear face (example: me.jpg): ');
  const otherFile = await ask('File name of a photo of a DIFFERENT person (press Enter to skip): ');
  rl.close();

  if (!key || !photoFile || !fs.existsSync(photoFile)) {
    console.log('Missing API key, or the photo file was not found in this folder. Nothing was created.');
    return;
  }
  if (otherFile && !fs.existsSync(otherFile)) {
    console.log('The second photo file was not found in this folder. Nothing was created.');
    return;
  }

  let db = null;
  try { db = require('./core').db; } catch (e) { db = null; }

  const photo = fs.readFileSync(photoFile);
  const photoMime = mimeOf(photoFile);
  const email = 'facetest' + Date.now() + '@example.com';
  const password = 'Ft!' + Math.random().toString(36).slice(2, 10) + '9Z'; // 13 characters: Firebase allows at most 20
  let idToken = null;
  let uid = null;
  let personId = null;
  let deleted = false;

  try {
    if (!await step('Create test account', async () => {
      const d = await firebase('signUp', key, { email, password, returnSecureToken: true });
      idToken = d.idToken;
      uid = d.localId;
    })) return;

    if (!await step('Turn on a one-hour test plan', async () => {
      if (!db) throw new Error('Could not load core.js. Run this from the SecureAssistant folder that has .env.');
      await db.collection('users').doc(uid).set({ isPro: true, planExpiry: Date.now() + 3600000, cameraCount: 1 }, { merge: true });
    })) return;

    if (!await step('Add person with consent', async () => {
      const d = await call('POST', '/api/facematch/enroll', idToken,
        photoForm(photo, photoMime, { name: 'Test Person', role: 'staff', purpose: 'Test', consent: 'true' }));
      if (!d.success || !d.id) throw new Error('No person id returned');
      personId = d.id;
      return 'person added';
    })) return;

    await step('Person appears in list (and no face template is shown)', async () => {
      const d = await call('GET', '/api/facematch/list', idToken);
      const found = (d.people || []).some(p => p.id === personId && p.name === 'Test Person');
      if (!found) throw new Error('Person not found in the list');
      const text = JSON.stringify(d);
      if (text.includes('embEnc') || text.includes('embedding')) throw new Error('Face template is visible in the list');
    });

    await step('Same photo is recognised', async () => {
      const d = await call('POST', '/api/facematch/identify', idToken, photoForm(photo, photoMime));
      const r = (d.results || [])[0];
      if (!r) throw new Error('No face found in the photo');
      if (!r.matched || !r.person || r.person.id !== personId) throw new Error('Not matched (score ' + r.score + ')');
      return 'score ' + r.score;
    });

    if (otherFile) {
      const other = fs.readFileSync(otherFile);
      await step('Different person is NOT matched', async () => {
        const d = await call('POST', '/api/facematch/identify', idToken, photoForm(other, mimeOf(otherFile)));
        if (!d.facesFound) throw new Error('No face found in the second photo');
        const scores = d.results.map(r => r.score).join(', ');
        if (d.results.some(r => r.matched)) throw new Error('A face was wrongly matched (scores ' + scores + ')');
        return d.facesFound + ' face(s), none matched (scores ' + scores + ')';
      });
    }

    await step('Delete person (face data erased)', async () => {
      const d = await call('DELETE', '/api/facematch/' + personId, idToken);
      if (!d.success) throw new Error('Delete did not report success');
      deleted = true;
    });

    await step('List is empty after delete', async () => {
      const d = await call('GET', '/api/facematch/list', idToken);
      if (d.count !== 0) throw new Error('List still has ' + d.count + ' person(s)');
    });
  } finally {
    if (uid) {
      if (personId && !deleted) {
        try { await call('DELETE', '/api/facematch/' + personId, idToken); } catch (e) { /* best effort */ }
      }
      try { if (db) await db.collection('users').doc(uid).delete(); } catch (e) { /* best effort */ }
      await step('Test account cleanup', async () => { await firebase('delete', key, { idToken }); });
    }
  }
}

main().then(() => {
  console.log(failed ? '\n' + failed + ' step(s) FAILED. Send a photo of this screen.' : '\nAll face steps passed.');
  process.exit(failed ? 1 : 0);
}).catch(e => {
  console.log('Unexpected error: ' + (e && e.message ? e.message : e));
  process.exit(1);
});