// Runs the login-protected checks of check-backend.js with a real Firebase test user.
// Usage (Windows PowerShell), all values come from environment variables, nothing is stored in this file:
//
//   $env:BASE_URL="https://your-backend.onrender.com"
//   $env:FIREBASE_WEB_API_KEY="..."      Firebase console > Project settings > General > Web API Key
//   $env:TEST_EMAIL="test@example.com"   a user you added in Firebase console > Authentication > Users
//   $env:TEST_PASSWORD="..."
//   $env:CRON_SECRET="..."               optional, same value as on Render
//   $env:TEST_IMAGE=".\people.jpg"       optional, a real photo with people in it
//   node run-login-checks.js
//
// Needs Node 18+. The login token is passed to check-backend.js internally, so you never copy it.

const path = require('path');
const { spawnSync } = require('child_process');

const BASE = (process.env.BASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.FIREBASE_WEB_API_KEY || '';
const EMAIL = process.env.TEST_EMAIL || '';
const PASSWORD = process.env.TEST_PASSWORD || '';

function stop(msg) { console.error(msg); process.exit(1); }

if (!BASE) stop('Set BASE_URL first (your backend address).');
if (!KEY) stop('Set FIREBASE_WEB_API_KEY first (Firebase console > Project settings > General > Web API Key).');
if (!EMAIL || !PASSWORD) stop('Set TEST_EMAIL and TEST_PASSWORD first (a user added in Firebase console > Authentication).');

(async () => {
  // 1. Sign in with email and password (Firebase REST API)
  let res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true })
  });
  let data = await res.json().catch(() => ({}));
  if (!res.ok || !data.idToken) {
    const why = data.error && data.error.message ? data.error.message : 'status ' + res.status;
    stop('Sign-in failed: ' + why + '\n' +
      '- EMAIL_NOT_FOUND / INVALID_PASSWORD / INVALID_LOGIN_CREDENTIALS: check the test user in Firebase console > Authentication > Users.\n' +
      '- OPERATION_NOT_ALLOWED: enable "Email/Password" in Authentication > Sign-in method.\n' +
      '- API key not valid: copy the Web API Key again from Project settings.');
  }
  console.log('Signed in as the test user.');

  // 2. Create the profile document if it does not exist yet (safe to repeat)
  let tz = 'UTC';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* keep UTC */ }
  res = await fetch(BASE + '/api/auth/init-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.idToken },
    body: JSON.stringify({ name: 'Test User', language: 'en', timezone: tz })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    stop('Profile creation failed (status ' + res.status + '): ' + (body.error || body.message || 'see Render logs'));
  }
  console.log('Profile is ready.\n');

  // 3. Run the normal checks with the token handed over privately
  const out = spawnSync(process.execPath, [path.join(__dirname, 'check-backend.js')], {
    stdio: 'inherit',
    env: { ...process.env, ID_TOKEN: data.idToken }
  });
  process.exit(out.status === null ? 1 : out.status);
})().catch(e => stop('Unexpected error: ' + e.message));