'use strict';
// Extras: paid add-ons that a customer can buy one by one (Beta).
//  - GET  /api/extras/catalog   what can be bought, the price, and whether it is available or coming soon (no login needed)
//  - POST /api/extras/buy       { itemId }  makes a Razorpay order (needs an active plan)
//  - POST /api/extras/verify    { razorpay_order_id, razorpay_payment_id, razorpay_signature }  checks the payment and adds the extra
//  - GET  /api/extras/my        what the customer has bought and how much is left
// Only "extra_live" (extra live video minutes) can be bought today. The others show as "coming_soon".
// Extra storage keeps using /api/storage/buy-extra and /api/storage/verify-extra.
// Live minutes are used by the live-video token route through app.locals.extras.takeLiveMinutes(uid, minutes).
// Payment records (extras_orders) are kept for accounts. The purchased extras (extras) are erased with the account.
module.exports = function register(app, core) {
  const { DAY_MS, auth, crypto, db, envInt, httpError, razorpay, requirePro, safeCompare, userLimiter, wrap } = core;

  const LIVE_PRICE = envInt('EXTRA_LIVE_PRICE_INR', 149);
  const LIVE_MINUTES = envInt('EXTRA_LIVE_MINUTES', 300);
  const LIVE_DAYS = envInt('EXTRA_LIVE_DAYS', 30);

  const ITEMS = {
    extra_live: { name: 'Extra live time', unit: `${LIVE_MINUTES} minutes of live video, valid ${LIVE_DAYS} days`, priceInr: LIVE_PRICE, status: 'available', minutes: LIVE_MINUTES, days: LIVE_DAYS },
    smart_presence: { name: 'Smart Presence', unit: 'per camera per month', priceInr: 109, status: 'coming_soon' },
    offline_sms: { name: 'Offline alerts by SMS', unit: '500 SMS', priceInr: 149, status: 'coming_soon' },
    extra_storage: { name: 'Extra storage', unit: '10, 50, 100 or 500 GB for 30 days', priceInr: null, status: 'available', buyWith: '/api/storage/buy-extra' },
    advanced_tools: { name: 'Advanced detection tools', unit: 'price is set when each tool is ready', priceInr: null, status: 'coming_soon' }
  };

  const catalog = () => Object.entries(ITEMS).map(([id, i]) => ({
    id, name: i.name, unit: i.unit, priceInr: i.priceInr, status: i.status, buyWith: i.buyWith || '/api/extras/buy'
  }));

  // ---- live minutes helpers (also used by the live-video token route) ----
  async function activeLiveDocs(uid) {
    const snap = await db.collection('extras').where('uid', '==', uid).get();
    const now = Date.now();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(d => d.type === 'live_minutes' && (d.remaining || 0) > 0 && (d.expiresAt || 0) > now)
      .sort((a, b) => a.expiresAt - b.expiresAt);
  }
  async function liveMinutesLeft(uid) {
    return (await activeLiveDocs(uid)).reduce((s, d) => s + d.remaining, 0);
  }
  // Takes minutes from the pack that expires first. Returns true if all the minutes were available, otherwise takes nothing.
  async function takeLiveMinutes(uid, minutes) {
    const need = Math.ceil(Number(minutes));
    if (!Number.isFinite(need) || need <= 0) return false;
    const docs = await activeLiveDocs(uid);
    if (docs.reduce((s, d) => s + d.remaining, 0) < need) return false;
    return db.runTransaction(async t => {
      const refs = docs.slice(0, 10).map(d => db.collection('extras').doc(d.id));
      const snaps = [];
      for (const r of refs) snaps.push(await t.get(r));
      let left = need;
      const writes = [];
      for (const s of snaps) {
        if (!s.exists || left <= 0) continue;
        const rem = s.data().remaining || 0;
        const take = Math.min(rem, left);
        if (take > 0) { writes.push([s.ref || db.collection('extras').doc(s.id), rem - take]); left -= take; }
      }
      if (left > 0) return false; // someone else used them in the meantime
      for (const [ref, remaining] of writes) t.update(ref, { remaining });
      return true;
    });
  }
  app.locals.extras = { liveMinutesLeft, takeLiveMinutes };

  // ---- routes ----
  app.get('/api/extras/catalog', (req, res) => res.json({ ok: true, items: catalog() }));

  app.post('/api/extras/buy', auth, requirePro, userLimiter(20), wrap(async (req, res) => {
    const id = String((req.body && req.body.itemId) || '');
    const item = ITEMS[id];
    if (!item) throw httpError(400, 'Unknown item');
    if (item.status !== 'available') throw httpError(409, 'This add-on is coming soon');
    if (!item.minutes) throw httpError(409, 'Buy this one from the storage page');
    const uid = req.user.uid;
    let order;
    try {
      order = await razorpay.orders.create({
        amount: item.priceInr * 100, currency: 'INR',
        receipt: ('ex_' + uid.slice(0, 10) + '_' + Date.now()).slice(0, 40), notes: { uid, itemId: id }
      });
    } catch (e) { throw httpError(502, 'Payment service is not available, try again'); }
    await db.collection('extras_orders').doc(order.id).set({ uid, itemId: id, amountInr: item.priceInr, status: 'created', createdAt: Date.now() });
    res.json({ ok: true, orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID, item: { id, name: item.name } });
  }));

  app.post('/api/extras/verify', auth, userLimiter(30), wrap(async (req, res) => {
    const b = req.body || {};
    const orderId = String(b.razorpay_order_id || '');
    const paymentId = String(b.razorpay_payment_id || '');
    const signature = String(b.razorpay_signature || '');
    if (!orderId || !paymentId || !signature) throw httpError(400, 'Payment details are missing');
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(orderId + '|' + paymentId).digest('hex');
    if (!safeCompare(expected, signature)) throw httpError(400, 'Payment could not be verified');
    const uid = req.user.uid;
    const orderRef = db.collection('extras_orders').doc(orderId);
    const extraRef = db.collection('extras').doc(orderId);
    const result = await db.runTransaction(async t => {
      const o = await t.get(orderRef);
      if (!o.exists || o.data().uid !== uid) throw httpError(404, 'Order not found');
      if (o.data().status === 'paid') return { already: true };
      const item = ITEMS[o.data().itemId];
      if (!item || !item.minutes) throw httpError(409, 'This order cannot be added');
      const expiresAt = Date.now() + item.days * DAY_MS;
      t.update(orderRef, { status: 'paid', paymentId, paidAt: Date.now() });
      t.set(extraRef, { uid, type: 'live_minutes', itemId: o.data().itemId, minutes: item.minutes, remaining: item.minutes, expiresAt, createdAt: Date.now(), orderId });
      return { already: false, minutes: item.minutes, expiresAt };
    });
    res.json({ ok: true, ...result, liveMinutesLeft: await liveMinutesLeft(uid) });
  }));

  app.get('/api/extras/my', auth, wrap(async (req, res) => {
    const docs = await activeLiveDocs(req.user.uid);
    res.json({
      ok: true,
      liveMinutesLeft: docs.reduce((s, d) => s + d.remaining, 0),
      items: docs.map(d => ({ id: d.id, type: d.type, minutes: d.minutes, remaining: d.remaining, expiresAt: d.expiresAt }))
    });
  }));
};