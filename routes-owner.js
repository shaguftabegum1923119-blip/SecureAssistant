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
};