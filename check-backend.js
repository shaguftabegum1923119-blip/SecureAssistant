// Run after deploying:  node check-backend.js
// Needs Node 18+ (built-in fetch). Nothing is hard-coded: everything comes from environment variables.
//
//   BASE_URL     your backend address, e.g. https://your-backend.onrender.com   (required)
//   ID_TOKEN     a Firebase login token of a real test user                      (optional, enables login-protected checks)
//   CRON_SECRET  same value as on Render                                         (optional, checks the cron routes)
//   TEST_IMAGE   path to a real photo with people in it, e.g. ./people.jpg       (optional, checks the AI counting)
//
// Windows PowerShell example:
//   $env:BASE_URL="https://your-backend.onrender.com"; $env:ID_TOKEN="..."; node check-backend.js
//
// Getting ID_TOKEN: sign in with a test user in your FlutterFlow app (or the Firebase console REST sign-in)
// and copy the ID token. It expires after about one hour.

const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.ID_TOKEN || '';
const CRON = process.env.CRON_SECRET || '';
const IMAGE = process.env.TEST_IMAGE || '';

if (!BASE) { console.error('Set BASE_URL first (your backend address).'); process.exit(1); }

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ->  ' + detail : ''}`);
}
function skip(name, why) { console.log(`SKIP  ${name}  (${why})`); }

async function call(method, route, { body, form, headers = {}, auth = false, timeoutMs = 60000 } = {}) {
  const h = { ...headers };
  if (auth) h.Authorization = 'Bearer ' + TOKEN;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + route, { method, headers: h, body: payload, signal: ctl.signal });
    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    return { status: res.status, data };
  } catch (e) {
    return { status: 0, data: { error: e.name === 'AbortError' ? 'timeout' : e.message } };
  } finally { clearTimeout(timer); }
}

(async () => {
  console.log(`Checking ${BASE}\n(The first call can take up to a minute if the server was asleep.)\n`);

  // 1. Server alive and data loaded
  let r = await call('GET', '/health', { timeoutMs: 120000 });
  record('Server is up (/health)', r.status === 200 && r.data && r.data.ok === true,
    r.data ? `categories=${r.data.categories} languages=${r.data.languages} countries=${r.data.countries}` : 'no response');

  // 2. Public world data
  r = await call('GET', '/api/languages');
  record('Languages list', r.status === 200 && Array.isArray(r.data && r.data.languages) && r.data.languages.length > 50, r.data && r.data.languages ? `${r.data.languages.length} languages` : '');
  r = await call('GET', '/api/countries');
  record('Country codes list', r.status === 200 && r.data && r.data.count > 150, r.data ? `${r.data.count} countries` : '');
  r = await call('GET', '/api/categories');
  record('Categories list', r.status === 200 && JSON.stringify(r.data).length > 50);
  r = await call('GET', '/api/ai-tools');
  const tools = (r.data && (r.data.tools || r.data)) || [];
  record('AI tools list with honest status', r.status === 200 && Array.isArray(tools) && tools.every(t => ['live', 'beta', 'coming_soon'].includes(t.status)),
    Array.isArray(tools) ? `${tools.length} tools: ${['live', 'beta', 'coming_soon'].map(s => s + '=' + tools.filter(t => t.status === s).length).join(', ')}` : '');

  // 3. Security basics: protected routes must refuse without login
  r = await call('GET', '/api/cameras/list');
  record('Protected route refuses without login', r.status === 401, `status ${r.status}`);
  r = await call('POST', '/api/payment/webhook', { body: { x: 1 }, headers: { 'x-razorpay-signature': 'wrong' } });
  record('Payment webhook rejects a wrong signature', r.status === 400 || r.status === 401, `status ${r.status}`);
  r = await call('POST', '/api/cron/camera-health', { headers: { 'x-cron-secret': 'wrong-secret' } });
  record('Cron route rejects a wrong secret', r.status === 401, `status ${r.status}`);

  // 4. Cron routes with the real secret
  if (CRON) {
    for (const route of ['/api/cron/camera-health', '/api/cron/process-deletions', '/api/cron/daily-report', '/api/cron/storage-cleanup']) {
      r = await call('POST', route, { headers: { 'x-cron-secret': CRON }, timeoutMs: 120000 });
      record(`Cron ${route}`, r.status === 200, r.status === 200 ? JSON.stringify(r.data).slice(0, 80) : `status ${r.status} ${(r.data && r.data.error) || ''}`);
    }
  } else skip('Cron routes with real secret', 'set CRON_SECRET to test');

  // 5. Login-protected checks
  if (!TOKEN) {
    skip('All login-protected checks', 'set ID_TOKEN to test');
  } else {
    r = await call('GET', '/api/user/full-box', { auth: true });
    record('Login works and profile loads (/api/user/full-box)', r.status === 200, `status ${r.status} ${(r.data && r.data.error) || ''}`);

    r = await call('POST', '/api/payment/calculate', { auth: true, body: { cameraCount: 6, billingType: 'monthly' } });
    record('Price calculation', r.status === 200 && r.data && r.data.payable > 0, r.data ? `6 cameras monthly = Rs ${r.data.payable}` : '');
    const rY = await call('POST', '/api/payment/calculate', { auth: true, body: { cameraCount: 6, billingType: 'yearly' } });
    record('Yearly price = 11 months of monthly', rY.status === 200 && r.data && rY.data && rY.data.payable === r.data.payable * 11, rY.data ? `yearly = Rs ${rY.data.payable}` : '');

    let prev = 0, rising = true;
    for (let n = 1; n <= 15; n++) {
      const p = await call('POST', '/api/payment/calculate', { auth: true, body: { cameraCount: n, billingType: 'monthly' } });
      if (!p.data || p.data.payable < prev) rising = false;
      prev = p.data ? p.data.payable : prev;
    }
    record('Price never drops when cameras are added (1 to 15)', rising);

    r = await call('GET', '/api/cameras/list', { auth: true });
    record('Camera list', r.status === 200, `status ${r.status} ${(r.data && r.data.error) || ''}`);
    r = await call('GET', '/api/settings/alerts', { auth: true });
    record('Alert settings', r.status === 200 && r.data && r.data.settings, `status ${r.status}`);
    r = await call('GET', '/api/storage/status', { auth: true });
    record('Storage status', r.status === 200, `status ${r.status}`);
    r = await call('GET', '/api/alert/list', { auth: true });
    record('Alert list', r.status === 200, `status ${r.status} ${(r.data && r.data.error) || ''}`);

    // 6. Real AI counting on a real photo
    if (IMAGE && fs.existsSync(IMAGE)) {
      const form = new FormData();
      form.append('frame', new Blob([fs.readFileSync(IMAGE)]), path.basename(IMAGE));
      r = await call('POST', '/api/analytics/frame', { auth: true, form, timeoutMs: 120000 });
      record('AI counting on your photo', r.status === 200 && r.data && typeof r.data.personCount === 'number',
        r.status === 200 ? `people=${r.data.personCount} vehicles=${r.data.vehicleCount}  (compare with the photo yourself)` : `status ${r.status} ${(r.data && (r.data.error || r.data.message)) || ''}`);
    } else skip('AI counting', 'set TEST_IMAGE to a real photo path');
  }

  const failed = results.filter(x => !x.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed.`);
  if (failed) console.log('Open Render > your service > Logs to see the reason for each FAIL. If a log shows "index missing", open the link printed next to it.');
  process.exit(failed ? 1 : 0);
})();