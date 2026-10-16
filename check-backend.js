// Run after deploying:  node check-backend.js
// Needs Node 18+ (built-in fetch). Nothing is hard-coded: everything comes from environment variables.
//
//   BASE_URL     your backend address, e.g. https://your-backend.onrender.com   (required)
//   ID_TOKEN     a Firebase login token of a real test user                      (optional, enables login-protected checks)
//   CRON_SECRET  same value as on Render                                         (optional, checks the cron routes)
//   TEST_IMAGE   path to a real photo with people in it, e.g. ./people.jpg       (optional, checks the AI counting)

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

  let r = await call('GET', '/health', { timeoutMs: 120000 });
  record('Server is up (/health)', r.status === 200 && r.data && r.data.ok === true,
    r.data ? `categories=${r.data.categories} languages=${r.data.languages} countries=${r.data.countries}` : 'no response');

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

  r = await call('GET', '/api/cameras/list');
  record('Protected route refuses without login', r.status === 401, `status ${r.status}`);
  r = await call('POST', '/api/payment/webhook', { body: { x: 1 }, headers: { 'x-razorpay-signature': 'wrong' } });
  record('Payment webhook rejects a wrong signature', r.status === 400 || r.status === 401, `status ${r.status}`);
  r = await call('POST', '/api/cron/camera-health', { headers: { 'x-cron-secret': 'wrong-secret' } });
  record('Cron route rejects a wrong secret', r.status === 401, `status ${r.status}`);

  // Bank routes must be gone in V15
  r = await call('POST', '/api/bank/add', { auth: false, body: {} });
  record('Bank routes are removed', r.status === 404, `status ${r.status}`);

  if (CRON) {
    for (const route of ['/api/cron/camera-health', '/api/cron/process-deletions', '/api/cron/daily-report', '/api/cron/storage-cleanup', '/api/cron/owner-digest']) {
      r = await call('POST', route, { headers: { 'x-cron-secret': CRON }, timeoutMs: 120000 });
      record(`Cron ${route}`, r.status === 200, r.status === 200 ? JSON.stringify(r.data).slice(0, 80) : `status ${r.status} ${(r.data && r.data.error) || ''}`);
    }
  } else skip('Cron routes with real secret', 'set CRON_SECRET to test');

  if (!TOKEN) {
    skip('All login-protected checks', 'set ID_TOKEN to test');
  } else {
    r = await call('GET', '/api/user/full-box', { auth: true });
    record('Login works and profile loads (/api/user/full-box)', r.status === 200, `status ${r.status} ${(r.data && r.data.error) || ''}`);

    // Price must equal camera count x the rate for its slab (no more "never drops" logic)
    const p1 = await call('POST', '/api/payment/calculate', { auth: true, body: { cameraCount: 1, billingType: 'monthly' } });
    record('1 camera = Rs 99', p1.data && p1.data.payable === 99, p1.data ? `got Rs ${p1.data.payable}` : '');
    const p6 = await call('POST', '/api/payment/calculate', { auth: true, body: { cameraCount: 6, billingType: 'monthly' } });
    record('6 cameras = Rs 420 (6 x Rs 70)', p6.data && p6.data.payable === 420, p6.data ? `got Rs ${p6.data.payable}` : '');
    const p10 = await call('POST', '/api/payment/calculate', { auth: true, body: { cameraCount: 10, billingType: 'monthly' } });
    record('10 cameras = Rs 600 (10 x Rs 60)', p10.data && p10.data.payable === 600, p10.data ? `got Rs ${p10.data.payable}` : '');
    const pY = await call('POST', '/api/payment/calculate', { auth: true, body: { cameraCount: 6, billingType: 'yearly' } });
    record('Yearly price = 11 months of monthly', pY.data && p6.data && pY.data.payable === p6.data.payable * 11, pY.data ? `yearly = Rs ${pY.data.payable}` : '');

    r = await call('GET', '/api/cameras/list', { auth: true });
    record('Camera list', r.status === 200, `status ${r.status} ${(r.data && r.data.error) || ''}`);
    r = await call('GET', '/api/settings/alerts', { auth: true });
    record('Alert settings', r.status === 200 && r.data && r.data.settings, `status ${r.status}`);
    r = await call('GET', '/api/storage/status', { auth: true });
    record('Storage status: 5 GB free', r.status === 200 && r.data && r.data.limit === 5 * 1024 * 1024 * 1024, r.data ? `limit=${r.data.limit}` : `status ${r.status}`);
    r = await call('GET', '/api/alert/list', { auth: true });
    record('Alert list', r.status === 200, `status ${r.status} ${(r.data && r.data.error) || ''}`);

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