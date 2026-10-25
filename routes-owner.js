'use strict';
// Owner-only routes: read support tickets and approval requests, answer them, and record your decision.
// Only the account whose Firebase uid is in the OWNER_UID variable (Render + .env) can use these; everyone else gets "Not found".
// IMPORTANT: "approved" only RECORDS your decision and tells the customer. It never refunds, changes a plan, deletes an
// account or edits details by itself. You do the real action yourself (for example the refund in the Razorpay dashboard).
module.exports = function register(app, core) {
  const { auth, createAlert, db, httpError, planActive, userLimiter, wrap } = core;
  const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

  const requireOwner = (req, res, next) => {
    const owner = process.env.OWNER_UID;
    if (!owner || !req.user || req.user.uid !== owner) return next(httpError(404, 'Not found'));
    next();
  };
  const guard = [auth, requireOwner, userLimiter(300)];

  // Items of one collection with a given status (newest first). The owner sees only the customer's id and plan status,
  // never their name, email, phone or files, so you can fix the problem without holding the customer's personal data.
  async function listWithCustomer(col, status) {
    const snap = await db.collection(col).where('status', '==', status).limit(100).get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created || 0) - (a.created || 0));
    const uids = [...new Set(items.map(i => i.uid).filter(Boolean))];
    const people = {};
    if (uids.length) {
      for (const s of await db.getAll(...uids.map(u => db.collection('users').doc(u)))) {
        if (!s.exists) continue;
        const u = s.data();
        people[s.id] = { id: s.id, planActive: planActive(u), planExpiry: u.planExpiry || null };
      }
    }
    return items.map(i => ({ ...i, customer: people[i.uid] || null }));
  }

  // Tells the customer inside the app (alert + push). Never blocks or breaks the owner's action.
  async function tellCustomer(uid, message) {
    try {
      const u = (await db.collection('users').doc(uid).get()).data();
      if (u) await createAlert(uid, u, { alertType: 'Support', message: clip(message, 300) });
    } catch (e) { console.warn('owner notify customer failed:', e.message); }
  }

  app.get('/api/owner/tickets', ...guard, wrap(async (req, res) => {
    const status = req.query.status === 'closed' ? 'closed' : 'open';
    const tickets = await listWithCustomer('support_tickets', status);
    res.json({ status, count: tickets.length, tickets });
  }));

  // body: { reply: "text", close: true | false }
  app.post('/api/owner/tickets/:id/reply', ...guard, wrap(async (req, res) => {
    const reply = clip((req.body || {}).reply, 1000);
    if (!reply) throw httpError(400, 'reply required');
    const ref = db.collection('support_tickets').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) throw httpError(404, 'Ticket not found');
    const status = (req.body || {}).close === false ? 'open' : 'closed';
    await ref.update({ ownerReply: reply, status, repliedAt: Date.now() });
    await tellCustomer(snap.data().uid, 'Support replied to your ticket. Open Support to read it.');
    res.json({ success: true, status });
  }));

  app.get('/api/owner/approvals', ...guard, wrap(async (req, res) => {
    const allowed = ['pending', 'approved', 'rejected'];
    const status = allowed.includes(req.query.status) ? req.query.status : 'pending';
    const requests = await listWithCustomer('pending_approvals', status);
    res.json({ status, count: requests.length, requests });
  }));

  // body: { decision: "approved" | "rejected", note: "optional text for the customer" }
  app.post('/api/owner/approvals/:id/decide', ...guard, wrap(async (req, res) => {
    const decision = (req.body || {}).decision;
    if (!['approved', 'rejected'].includes(decision)) throw httpError(400, 'decision must be approved or rejected');
    const note = clip((req.body || {}).note, 500);
    const ref = db.collection('pending_approvals').doc(req.params.id);
    const a = await db.runTransaction(async t => {
      const s = await t.get(ref);
      if (!s.exists) throw httpError(404, 'Request not found');
      if (s.data().status !== 'pending') throw httpError(409, 'Already decided');
      t.update(ref, { status: decision, ownerNote: note, decidedAt: Date.now() });
      return s.data();
    });
    const what = String(a.type || 'request').replace(/_/g, ' ');
    await tellCustomer(a.uid, `Your ${what} request was ${decision}.${note ? ' ' + note : ''}`);
    res.json({ success: true, status: decision, type: a.type, reminder: 'Nothing was changed automatically. Do the real action yourself.' });
  }));

  // ---------- OWNER PAGE ----------
  // Open https://secureassistant.onrender.com/owner in a browser and log in with your owner email and password.
  // The page itself holds no data. Every list and action goes through the owner-only routes above.
  const OWNER_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Secure Assistant - Owner</title>
<style>
:root{--bg:#f4f5f7;--card:#ffffff;--text:#1b1f24;--muted:#5d6670;--line:#dde1e6;--accent:#1f6feb;--ok:#1a7f37;--bad:#cf222e;--warn:#9a6700;--chip:#eef1f4}
@media (prefers-color-scheme:dark){:root{--bg:#0f1317;--card:#171c22;--text:#e8ecf0;--muted:#9aa5b1;--line:#2a323b;--accent:#58a6ff;--ok:#3fb950;--bad:#f85149;--warn:#d29922;--chip:#222a33}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:14px}
h1{font-size:20px;margin:6px 0 2px}
.sub{color:var(--muted);font-size:13px;margin:0 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:0 0 12px}
label{display:block;font-size:13px;color:var(--muted);margin:10px 0 4px}
input,textarea,select{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--text);font:inherit}
textarea{min-height:76px;resize:vertical}
button{font:inherit;border:0;border-radius:10px;padding:11px 14px;background:var(--accent);color:#fff;cursor:pointer}
button.ghost{background:var(--chip);color:var(--text)}
button.ok{background:var(--ok)}
button.bad{background:var(--bad)}
button:disabled{opacity:.55;cursor:default}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.row>*{flex:1 1 auto}
.row>button{flex:0 0 auto}
.tabs{display:flex;gap:8px;margin:0 0 10px}
.tabs button{flex:1;background:var(--chip);color:var(--text)}
.tabs button.on{background:var(--accent);color:#fff}
.msg{min-height:20px;font-size:14px;margin:8px 0;color:var(--muted)}
.msg.bad{color:var(--bad)}
.msg.ok{color:var(--ok)}
.badge{display:inline-block;font-size:12px;padding:2px 8px;border-radius:99px;background:var(--chip);color:var(--muted);margin-left:6px}
.title{font-weight:600}
.body{white-space:pre-wrap;word-wrap:break-word;margin:8px 0}
.meta{font-size:13px;color:var(--muted);margin:6px 0}
.reply{border-left:3px solid var(--ok);padding-left:10px;margin:8px 0;white-space:pre-wrap}
.note{font-size:13px;color:var(--warn);margin:6px 0}
.empty{text-align:center;color:var(--muted);padding:22px 0}
.hide{display:none}
</style>
</head>
<body>
<div class="wrap">
  <h1>Secure Assistant - Owner</h1>
  <p class="sub">For the owner only. Customer name, email and phone are never shown here.</p>

  <div id="loginBox" class="card">
    <label for="email">Owner email</label>
    <input id="email" type="email" autocomplete="username" inputmode="email">
    <label for="pass">Password</label>
    <input id="pass" type="password" autocomplete="current-password">
    <div class="msg" id="loginMsg"></div>
    <button id="loginBtn">Login</button>
  </div>

  <div id="app" class="hide">
    <div class="tabs">
      <button id="tabTickets" class="on">Tickets</button>
      <button id="tabReq">Requests</button>
    </div>
    <div class="row">
      <select id="status"></select>
      <button class="ghost" id="refreshBtn">Refresh</button>
      <button class="ghost" id="logoutBtn">Logout</button>
    </div>
    <div class="msg" id="msg"></div>
    <div id="list"></div>
  </div>
</div>

<script>
var API_KEY = __KEY__;
var idToken = '';
var refreshToken = '';
var tab = 'tickets';

function $(id) { return document.getElementById(id); }
function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function say(id, text, kind) { var m = $(id); m.textContent = text || ''; m.className = 'msg' + (kind ? ' ' + kind : ''); }
function fmt(ms) { return ms ? new Date(ms).toLocaleString('en-IN') : ''; }
function nice(s) { return String(s || '').split('_').join(' '); }

async function signIn(email, password) {
  if (!API_KEY) throw new Error('FIREBASE_API_KEY is not set in the Render environment.');
  var r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(API_KEY), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
  });
  var d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || 'Login failed');
  idToken = d.idToken; refreshToken = d.refreshToken;
}

async function refresh() {
  var r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(API_KEY), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken)
  });
  var d = await r.json();
  if (!r.ok) throw new Error('Your session has ended. Please log in again.');
  idToken = d.id_token; refreshToken = d.refresh_token;
}

async function api(method, path, body, retried) {
  var opt = { method: method, headers: { 'Authorization': 'Bearer ' + idToken } };
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  var r = await fetch(path, opt);
  if (r.status === 401 && !retried && refreshToken) { await refresh(); return api(method, path, body, true); }
  var d = {};
  try { d = await r.json(); } catch (e) { d = {}; }
  if (!r.ok) {
    var err = new Error(r.status === 404 ? 'This account is not the owner. Check OWNER_UID in Render.' : (d.error || d.message || ('Error ' + r.status)));
    err.status = r.status; throw err;
  }
  return d;
}

function customerLine(c) {
  var box = el('div', 'meta');
  if (!c) { box.textContent = 'Customer not found (the account may have been deleted)'; return box; }
  var plan = c.planActive ? 'Plan active' + (c.planExpiry ? ' (until ' + fmt(c.planExpiry) + ')' : '') : 'Plan not active';
  box.appendChild(el('span', null, 'Customer ID: ' + c.id + '  |  ' + plan + '  '));
  var b = el('button', 'ghost', 'Copy ID');
  b.style.padding = '3px 9px'; b.style.fontSize = '12px';
  b.onclick = function () {
    if (navigator.clipboard) navigator.clipboard.writeText(c.id).then(function () { b.textContent = 'Copied'; });
  };
  box.appendChild(b);
  return box;
}

function setStatusOptions() {
  var s = $('status'); s.innerHTML = '';
  var opts = tab === 'tickets' ? [['open', 'Open tickets'], ['closed', 'Closed tickets']] : [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']];
  for (var i = 0; i < opts.length; i++) { var o = el('option', null, opts[i][1]); o.value = opts[i][0]; s.appendChild(o); }
}

function ticketCard(t) {
  var c = el('div', 'card');
  var h = el('div', 'title', t.subject || '(no subject)');
  if (t.category) h.appendChild(el('span', 'badge', t.category));
  c.appendChild(h);
  c.appendChild(el('div', 'body', t.message || ''));
  c.appendChild(customerLine(t.customer));
  c.appendChild(el('div', 'meta', fmt(t.created)));
  if (t.ownerReply) c.appendChild(el('div', 'reply', 'Your reply: ' + t.ownerReply));
  if (t.status === 'open') {
    var ta = el('textarea'); ta.placeholder = 'Write a reply to the customer...';
    var keep = el('input'); keep.type = 'checkbox'; keep.style.width = 'auto';
    var kl = el('label', null, ' Keep the ticket open (do not close it)'); kl.insertBefore(keep, kl.firstChild);
    var send = el('button', null, 'Send reply');
    send.onclick = async function () {
      if (!ta.value.trim()) { say('msg', 'Please write a reply first.', 'bad'); return; }
      send.disabled = true;
      try {
        await api('POST', '/api/owner/tickets/' + encodeURIComponent(t.id) + '/reply', { reply: ta.value.trim(), close: !keep.checked });
        say('msg', 'Reply sent. The customer has been notified in the app.', 'ok'); load(true);
      } catch (e) { say('msg', e.message, 'bad'); send.disabled = false; }
    };
    c.appendChild(ta); c.appendChild(kl); c.appendChild(send);
  }
  return c;
}

function requestCard(r) {
  var c = el('div', 'card');
  var h = el('div', 'title', nice(r.type) || 'request');
  h.appendChild(el('span', 'badge', r.status));
  c.appendChild(h);
  if (r.reason) c.appendChild(el('div', 'body', r.reason));
  if (r.details) c.appendChild(el('div', 'body', r.details));
  c.appendChild(customerLine(r.customer));
  c.appendChild(el('div', 'meta', fmt(r.created)));
  if (r.ownerNote) c.appendChild(el('div', 'reply', 'Your note: ' + r.ownerNote));
  if (r.status === 'pending') {
    var note = el('input'); note.placeholder = 'Short note for the customer (optional)';
    c.appendChild(note);
    c.appendChild(el('div', 'note', 'Approve only records your decision. Do the real work (for example the Razorpay refund) yourself.'));
    var row = el('div', 'row');
    var yes = el('button', 'ok', 'Approve'); var no = el('button', 'bad', 'Reject');
    var decide = async function (d) {
      if (!confirm((d === 'approved' ? 'Approve' : 'Reject') + ' this request?')) return;
      yes.disabled = true; no.disabled = true;
      try {
        await api('POST', '/api/owner/approvals/' + encodeURIComponent(r.id) + '/decide', { decision: d, note: note.value.trim() });
        say('msg', 'Decision saved (' + d + '). The customer has been notified.', 'ok'); load(true);
      } catch (e) { say('msg', e.message, 'bad'); yes.disabled = false; no.disabled = false; }
    };
    yes.onclick = function () { decide('approved'); };
    no.onclick = function () { decide('rejected'); };
    row.appendChild(yes); row.appendChild(no); c.appendChild(row);
  }
  return c;
}

async function load(keepMsg) {
  var list = $('list'); list.innerHTML = '';
  if (!keepMsg) say('msg', 'Loading...');
  var status = $('status').value;
  try {
    var d = tab === 'tickets' ? await api('GET', '/api/owner/tickets?status=' + status) : await api('GET', '/api/owner/approvals?status=' + status);
    var items = (tab === 'tickets' ? d.tickets : d.requests) || [];
    if (!keepMsg) say('msg', items.length + ' found');
    if (!items.length) list.appendChild(el('div', 'empty', 'Nothing here.'));
    for (var i = 0; i < items.length; i++) list.appendChild(tab === 'tickets' ? ticketCard(items[i]) : requestCard(items[i]));
  } catch (e) { say('msg', e.message, 'bad'); }
}

function showTab(name) {
  tab = name;
  $('tabTickets').className = name === 'tickets' ? 'on' : '';
  $('tabReq').className = name === 'requests' ? 'on' : '';
  setStatusOptions(); load();
}

$('loginBtn').onclick = async function () {
  var email = $('email').value.trim(), pass = $('pass').value;
  if (!email || !pass) { say('loginMsg', 'Please enter both email and password.', 'bad'); return; }
  $('loginBtn').disabled = true; say('loginMsg', 'Logging in...');
  try {
    await signIn(email, pass);
    $('pass').value = '';
    await api('GET', '/api/owner/tickets?status=open');
    $('loginBox').className = 'card hide'; $('app').className = '';
    showTab('tickets');
  } catch (e) { idToken = ''; refreshToken = ''; say('loginMsg', e.message, 'bad'); }
  $('loginBtn').disabled = false;
};
$('pass').onkeydown = function (ev) { if (ev.key === 'Enter') $('loginBtn').click(); };
$('tabTickets').onclick = function () { showTab('tickets'); };
$('tabReq').onclick = function () { showTab('requests'); };
$('status').onchange = function () { load(); };
$('refreshBtn').onclick = function () { load(); };
$('logoutBtn').onclick = function () { idToken = ''; refreshToken = ''; location.reload(); };
</script>
</body>
</html>
`;
  app.get('/owner', (req, res) => {
    const key = JSON.stringify(process.env.FIREBASE_API_KEY || '').replace(/</g, '\\u003c');
    res.set('Cache-Control', 'no-store');
    res.type('html').send(OWNER_PAGE.replace('__KEY__', () => key));
  });

  // ---------- PAYMENT TEST PAGE ----------
  // Open https://secureassistant.onrender.com/paytest while Render has Razorpay TEST keys (rzp_test_...).
  // It makes a test order, opens Razorpay's test checkout, then waits to see the plan switch on by itself (webhook).
  // It refuses to continue if the keys are live keys.
  const PAY_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Secure Assistant - Payment test</title>
<style>
:root{--bg:#f4f5f7;--card:#ffffff;--text:#1b1f24;--muted:#5d6670;--line:#dde1e6;--accent:#1f6feb;--ok:#1a7f37;--bad:#cf222e;--warn:#9a6700}
@media (prefers-color-scheme:dark){:root{--bg:#0f1317;--card:#171c22;--text:#e8ecf0;--muted:#9aa5b1;--line:#2a323b;--accent:#58a6ff;--ok:#3fb950;--bad:#f85149;--warn:#d29922}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:560px;margin:0 auto;padding:14px}
h1{font-size:20px;margin:6px 0 2px}
.sub{color:var(--muted);font-size:13px;margin:0 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin:0 0 12px}
label{display:block;font-size:13px;color:var(--muted);margin:10px 0 4px}
input,select{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--text);font:inherit}
button{font:inherit;border:0;border-radius:10px;padding:11px 14px;background:var(--accent);color:#fff;cursor:pointer;margin-top:12px}
button:disabled{opacity:.55}
.msg{min-height:22px;font-size:15px;margin:10px 0;color:var(--muted);white-space:pre-wrap}
.msg.bad{color:var(--bad)}
.msg.ok{color:var(--ok);font-weight:600}
.hint{font-size:13px;color:var(--warn);margin-top:10px}
.hide{display:none}
</style>
</head>
<body>
<div class="wrap">
  <h1>Payment test (TEST mode only)</h1>
  <p class="sub">Use this page to make a Razorpay test payment and check that your plan switches on by itself through the webhook.</p>

  <div class="card" id="step1">
    <label for="email">Email (the account that should get the plan)</label>
    <input id="email" type="email" autocomplete="username">
    <label for="pass">Password</label>
    <input id="pass" type="password" autocomplete="current-password">
    <button id="loginBtn">1. Login</button>
  </div>

  <div class="card hide" id="step2">
    <label for="cams">Cameras</label>
    <input id="cams" type="number" min="1" value="1">
    <label for="bt">Plan</label>
    <select id="bt"><option value="monthly">monthly</option><option value="yearly">yearly</option></select>
    <button id="payBtn">2. Create order and pay (test)</button>
    <div class="hint">Test card: 4111 1111 1111 1111, any future expiry, CVV 123. On the bank page choose Success. For UPI use success@razorpay.</div>
  </div>

  <div class="msg" id="msg"></div>
</div>

<script>
var API_KEY = __KEY__;
var POLL_MS = 3000;
var idToken = '';
var refreshToken = '';

function $(id) { return document.getElementById(id); }
function say(t, kind) { var m = $('msg'); m.textContent = t || ''; m.className = 'msg' + (kind ? ' ' + kind : ''); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function fmt(ms) { return ms ? new Date(ms).toLocaleString('en-IN') : '-'; }

async function signIn(email, password) {
  if (!API_KEY) throw new Error('FIREBASE_API_KEY is not set in the Render environment.');
  var r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(API_KEY), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
  });
  var d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || 'Login failed');
  idToken = d.idToken; refreshToken = d.refreshToken;
}

async function refresh() {
  var r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(API_KEY), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken)
  });
  var d = await r.json();
  if (!r.ok) throw new Error('Session ended, please log in again.');
  idToken = d.id_token; refreshToken = d.refresh_token;
}

async function api(method, path, body, retried) {
  var opt = { method: method, headers: { 'Authorization': 'Bearer ' + idToken } };
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  var r = await fetch(path, opt);
  if (r.status === 401 && !retried && refreshToken) { await refresh(); return api(method, path, body, true); }
  var d = {};
  try { d = await r.json(); } catch (e) { d = {}; }
  if (!r.ok) throw new Error(d.error || d.message || ('Error ' + r.status));
  return d;
}

function loadCheckout() {
  return new Promise(function (resolve, reject) {
    if (window.Razorpay) { resolve(); return; }
    var s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve;
    s.onerror = function () { reject(new Error('Could not load Razorpay checkout. Check your internet.')); };
    document.head.appendChild(s);
  });
}

async function waitForPlan(before) {
  for (var i = 0; i < 20; i++) {
    await sleep(POLL_MS);
    var d = await api('GET', '/api/user/full-box');
    var sub = d.subscription || {};
    if (sub.isPro && (sub.planExpiry || 0) > before) {
      say('PASS: the plan was switched on by the webhook.\\nPlan ends: ' + fmt(sub.planExpiry), 'ok');
      return;
    }
    say('Payment done. Waiting for the webhook... (' + (i + 1) + '/20)');
  }
  say('The plan did not switch on within 60 seconds.\\nCheck recent deliveries under Razorpay > Webhooks and the Render logs.\\nPayment Capture must be set to Automatic.', 'bad');
}

$('loginBtn').onclick = async function () {
  var email = $('email').value.trim(), pass = $('pass').value;
  if (!email || !pass) { say('Please enter both email and password.', 'bad'); return; }
  $('loginBtn').disabled = true; say('Logging in...');
  try {
    await signIn(email, pass);
    $('pass').value = '';
    $('step1').className = 'card hide'; $('step2').className = 'card';
    say('Logged in. Now press the button below.', 'ok');
  } catch (e) { say(e.message, 'bad'); }
  $('loginBtn').disabled = false;
};

$('payBtn').onclick = async function () {
  $('payBtn').disabled = true;
  try {
    var box = await api('GET', '/api/user/full-box');
    var before = (box.subscription && box.subscription.planExpiry) || 0;
    say('Creating the order...');
    var o = await api('POST', '/api/payment/generate-qr', { cameraCount: Number($('cams').value) || 1, billingType: $('bt').value, timezone: 'Asia/Kolkata' });
    if (String(o.keyId).indexOf('rzp_test_') !== 0) {
      say('STOP: Render has LIVE Razorpay keys, so this would charge real money.\\nPut the test keys (starting with rzp_test_) in Render first.', 'bad');
      $('payBtn').disabled = false; return;
    }
    await loadCheckout();
    var rzp = new window.Razorpay({
      key: o.keyId, order_id: o.orderId, amount: o.total * 100, currency: 'INR',
      name: 'Secure Assistant (TEST)', description: 'Test payment',
      handler: function () { say('Payment done. Waiting for the webhook...'); waitForPlan(before).then(function () { $('payBtn').disabled = false; }); }
    });
    rzp.on('payment.failed', function () { say('Payment failed. Please try again.', 'bad'); $('payBtn').disabled = false; });
    say('Opening the Razorpay test checkout...');
    rzp.open();
  } catch (e) { say(e.message, 'bad'); $('payBtn').disabled = false; }
};
</script>
</body>
</html>
`;
  app.get('/paytest', (req, res) => {
    const key = JSON.stringify(process.env.FIREBASE_API_KEY || '').replace(/</g, '\\u003c');
    res.set('Cache-Control', 'no-store');
    res.type('html').send(PAY_PAGE.replace('__KEY__', () => key));
  });
};