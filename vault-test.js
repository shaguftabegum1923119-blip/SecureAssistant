'use strict';
// Vault test: creates a temporary test account, locks a small file, lists it, shares it,
// reads it back, deletes it, then deletes the test account. Needs Node 18 or newer.
// Run:  node vault-test.js
const readline = require('readline');
const crypto = require('crypto');

const BASE = process.env.BACKEND_URL || 'https://secureassistant.onrender.com';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

async function call(method, path, token, body, isForm) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (body && isForm) payload = body;
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload, signal: AbortSignal.timeout(90000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}

function step(name, ok, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? ' - ' + extra : ''));
  if (!ok) throw new Error('Stopped at: ' + name);
}

(async () => {
  const apiKey = process.env.FIREBASE_WEB_API_KEY || await ask('Firebase Web API key (Firebase console > Project settings > General): ');
  if (!apiKey) throw new Error('Web API key is required');

  const stamp = Date.now();
  const email = 'vaulttest' + stamp + '@example.com';
  const password = 'Vt!' + crypto.randomBytes(6).toString('hex') + 'Aa1';
  let idToken = null;

  try {
    // 1. Create a temporary test account
    const reg = await call('POST', '/api/auth/register', null, { email, password, name: 'Vault Test' });
    step('Create test account', reg.ok && reg.json && reg.json.token, 'HTTP ' + reg.status);

    // 2. Sign in (exchange the custom token for an ID token)
    const signIn = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + encodeURIComponent(apiKey), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: reg.json.token, returnSecureToken: true })
    });
    const signJson = await signIn.json();
    idToken = signJson.idToken;
    step('Sign in', !!idToken, signIn.ok ? '' : 'check the Web API key');

    // 3. Lock a small file
    const content = 'vault test file ' + stamp;
    const form = new FormData();
    form.append('file', new Blob([content], { type: 'text/plain' }), 'vault-test.txt');
    const lock = await call('POST', '/api/vault/lock', idToken, form, true);
    step('Lock file in vault (upload to B2)', lock.ok && lock.json && lock.json.hash, 'HTTP ' + lock.status + (lock.ok ? '' : ' ' + lock.text.slice(0, 120)));
    const hash = lock.json.hash;

    // 4. List
    const list = await call('GET', '/api/vault/list', idToken);
    const found = list.ok && list.json && (list.json.vault || []).some(v => v.hash === hash);
    step('File appears in vault list', found);

    // 5. Share and read back
    const share = await call('POST', '/api/vault/share', idToken, { hash });
    step('Create share link', share.ok && share.json && share.json.link);
    const back = await call('GET', share.json.link);
    step('Download decrypts to the same content', back.ok && back.text === content);

    // 6. Delete the file
    const del = await call('DELETE', '/api/vault/' + hash, idToken);
    step('Delete file', del.ok);

    console.log('\nAll vault steps passed.');
  } finally {
    // 7. Remove the test account and everything stored for it
    if (idToken) {
      const gone = await call('POST', '/api/user/delete', idToken, { confirm: 'DELETE' });
      console.log((gone.status === 202 ? 'PASS  ' : 'WARN  ') + 'Test account cleanup - HTTP ' + gone.status);
    }
  }
})().catch(e => { console.error('\n' + e.message); process.exit(1); });