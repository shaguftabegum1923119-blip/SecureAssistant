'use strict';
// Payments, subscriptions, billing counters, extra storage and the encrypted vault.
module.exports = function register(app, core) {
  const {
    BASE_BYTES, DAY_MS, FV, Razorpay, STORAGE_PACK_DAYS, STORAGE_PLANS,
    addUsage, assertStorage, auth, bucket, checkStorageAlerts, crypto, db, decryptBuffer, encryptBuffer,
    getPrice, getTime, httpError, num, planActive, razorpay, safeCompare, sanitizeFilename, storagePackState, upload, wrap
  } = core;
  const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

  function countFromBody(b) {
    b = b || {};
    if (Array.isArray(b.locations)) {
      const sum = b.locations.reduce((t, l) => t + (parseInt(l && l.cameraCount) || 0), 0);
      if (sum > 0) return sum;
    }
    return b.totalCameraCount || b.cameraCount || b.count;
  }

  // ---------- PAYMENT ----------
  async function activatePayment(orderId, paymentId, paidAmount, ownerUid) {
    return db.runTransaction(async t => {
      const payRef = db.collection('payments').doc(orderId);
      const snap = await t.get(payRef);
      if (!snap.exists) throw httpError(404, 'ORDER_NOT_FOUND');
      const p = snap.data();
      if (ownerUid && p.userUid !== ownerUid) throw httpError(403, 'Order not yours');
      if (p.verified) return { already: true, expiry: p.expiryAfter || null };
      if (paidAmount != null && p.amount !== paidAmount) throw httpError(400, 'AMOUNT_MISMATCH');
      const userRef = db.collection('users').doc(p.userUid);
      const u = (await t.get(userRef)).data() || {};
      const base = (u.planExpiry || 0) > Date.now() ? u.planExpiry : Date.now();
      const expiry = base + p.days * DAY_MS;
      t.update(payRef, { verified: true, paymentId, verifiedAt: FV.serverTimestamp(), expiryAfter: expiry });
      t.set(userRef, { isPro: true, planExpiry: expiry, cameraCount: p.count, billingType: p.billingType }, { merge: true });
      return { already: false, expiry };
    });
  }

  async function activateStorage(orderId, paymentId, paidAmount, ownerUid) {
    return db.runTransaction(async t => {
      const ref = db.collection('storage_orders').doc(orderId);
      const snap = await t.get(ref);
      if (!snap.exists) throw httpError(404, 'ORDER_NOT_FOUND');
      const o = snap.data();
      if (ownerUid && o.uid !== ownerUid) throw httpError(403, 'Order not yours');
      if (o.verified) return { already: true };
      if (paidAmount != null && o.amount !== paidAmount) throw httpError(400, 'AMOUNT_MISMATCH');
      const userRef = db.collection('users').doc(o.uid);
      const ud = (await t.get(userRef)).data() || {};
      const now = Date.now();
      const packs = storagePackState(ud.storageExtraPacks, now).active;
      const expiresAt = now + (o.days || STORAGE_PACK_DAYS) * DAY_MS;
      packs.push({ gb: o.gb, orderId, boughtAt: now, expiresAt, remindedAt: null });
      const st = storagePackState(packs, now);
      t.update(ref, { verified: true, paymentId, verifiedAt: FV.serverTimestamp() });
      t.set(userRef, { storageExtraPacks: st.active, storageLimit: st.limitBytes, storageNextExpiry: st.nextExpiry }, { merge: true });
      return { already: false, addedGB: o.gb, expiresAt };
    });
  }

  const validSignature = (orderId, paymentId, sig) =>
    safeCompare(crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(orderId + '|' + paymentId).digest('hex'), sig);

  app.post('/api/payment/calculate', auth, (req, res) => res.json({ ...getPrice(countFromBody(req.body), req.body.billingType), baseGB: 5 }));

  app.post('/api/payment/generate-qr', auth, wrap(async (req, res) => {
    const price = getPrice(countFromBody(req.body), req.body.billingType);
    const order = await razorpay.orders.create({
      amount: price.payable * 100, currency: 'INR', receipt: 'rec_' + Date.now(),
      notes: { uid: req.user.uid, count: String(price.count), type: price.billingType }
    });
    const wt = getTime(req.body.timezone);
    await db.collection('payments').doc(order.id).set({
      userUid: req.user.uid, orderId: order.id, count: price.count, billingType: price.billingType, days: price.days,
      total: price.payable, amount: price.payable * 100, created: wt.ts, createdAtExact: wt.utcExact, verified: false
    });
    res.json({ orderId: order.id, keyId: process.env.RAZORPAY_KEY_ID, count: price.count, perCamera: price.perCamera, total: price.payable, billingType: price.billingType, days: price.days });
  }));

  app.post('/api/payment/verify', auth, wrap(async (req, res) => {
    const { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: s } = req.body || {};
    if (!o || !p || !s || !validSignature(o, p, s)) throw httpError(400, 'Signature check failed');
    const r = await activatePayment(o, p, null, req.user.uid);
    res.json({ success: true, expiry: r.expiry, already: r.already });
  }));

  // Razorpay webhook: the reliable path (works even if the app is closed after paying)
  app.post('/api/payment/webhook', wrap(async (req, res) => {
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(req.body).digest('hex');
    if (!safeCompare(expected, req.headers['x-razorpay-signature'])) throw httpError(400, 'SIG_FAIL');
    const event = JSON.parse(req.body.toString());
    const pay = event.payload && event.payload.payment && event.payload.payment.entity;
    const subEntity = event.payload && event.payload.subscription && event.payload.subscription.entity;
    if (subEntity && event.event === 'subscription.charged' && pay) {
      try { await activateSubscriptionCharge(subEntity.id, pay.id, pay.amount, null); }
      catch (e) { if (e.status === 404) return res.json({ ok: true, ignored: 'unknown subscription' }); throw e; }
      return res.json({ ok: true });
    }
    if (subEntity && ['subscription.cancelled', 'subscription.halted', 'subscription.completed'].includes(event.event)) {
      await markSubscriptionEnded(subEntity.id, event.event);
      return res.json({ ok: true });
    }
    if (pay && pay.status === 'captured' && pay.order_id) {
      try {
        const isPlan = (await db.collection('payments').doc(pay.order_id).get()).exists;
        if (isPlan) await activatePayment(pay.order_id, pay.id, pay.amount, null);
        else await activateStorage(pay.order_id, pay.id, pay.amount, null);
      } catch (e) {
        if (e.status === 404) return res.json({ ok: true, ignored: 'unknown order' });
        throw e;
      }
    }
    res.json({ ok: true });
  }));

  // ---------- STORAGE ----------
  app.get('/api/storage/status', auth, wrap(async (req, res) => {
    const u = (await db.collection('users').doc(req.user.uid).get()).data() || {};
    const used = u.storageUsed || 0, limit = u.storageLimit || BASE_BYTES, percent = Math.round((used / limit) * 100);
    checkStorageAlerts(req.user.uid);
    res.json({
      used, limit, percent, warning: percent >= 80 ? `Storage ${percent}% full - buy extra storage` : null, isPro: !!u.isPro, expiry: u.planExpiry || null, plans: STORAGE_PLANS, packDays: STORAGE_PACK_DAYS,
      extraPacks: storagePackState(u.storageExtraPacks, Date.now()).active.map(p => ({ gb: p.gb, expiresAt: p.expiresAt }))
    });
  }));

  app.post('/api/storage/buy-extra', auth, wrap(async (req, res) => {
    const gb = parseInt(req.body.gb);
    if (!STORAGE_PLANS[gb]) throw httpError(400, 'Valid GB: ' + Object.keys(STORAGE_PLANS).join(', '));
    const price = STORAGE_PLANS[gb];
    const order = await razorpay.orders.create({ amount: price * 100, currency: 'INR', receipt: 'stg_' + Date.now(), notes: { uid: req.user.uid, gb: String(gb), type: 'storage' } });
    await db.collection('storage_orders').doc(order.id).set({ uid: req.user.uid, gb, price, days: STORAGE_PACK_DAYS, amount: price * 100, orderId: order.id, created: Date.now(), verified: false });
    res.json({ orderId: order.id, keyId: process.env.RAZORPAY_KEY_ID, gb, price, days: STORAGE_PACK_DAYS, renewal: 'buy again when it ends' });
  }));

  app.post('/api/storage/verify-extra', auth, wrap(async (req, res) => {
    const { razorpay_order_id: o, razorpay_payment_id: p, razorpay_signature: s } = req.body || {};
    if (!o || !p || !s || !validSignature(o, p, s)) throw httpError(400, 'Signature check failed');
    const r = await activateStorage(o, p, null, req.user.uid);
    res.json({ success: true, ...r });
  }));

  // ---------- VAULT (encrypted files) ----------
  app.post('/api/vault/lock', auth, upload.single('file'), wrap(async (req, res) => {
    if (!req.file) throw httpError(400, 'NO_FILE');
    await assertStorage(req.user.uid, req.file.size);
    const dest = `vault/${req.user.uid}/${Date.now()}_${crypto.randomBytes(4).toString('hex')}.enc`;
    await bucket.file(dest).save(encryptBuffer(req.file.buffer, req.user.uid), { metadata: { contentType: 'application/octet-stream' } });
    const hash = crypto.randomBytes(16).toString('hex');
    const wt = getTime(req.body.timezone);
    await db.collection('vault').doc(hash).set({ uid: req.user.uid, path: dest, hash, originalName: sanitizeFilename(req.file.originalname), size: req.file.size, created: FV.serverTimestamp(), createdAtExact: wt.utcExact });
    await addUsage(req.user.uid, req.file.size);
    res.json({ success: true, hash });
  }));

  app.get('/api/vault/list', auth, wrap(async (req, res) => {
    let snap;
    try { snap = await db.collection('vault').where('uid', '==', req.user.uid).orderBy('created', 'desc').limit(100).get(); }
    catch (e) { console.warn('vault index missing:', e.message); snap = await db.collection('vault').where('uid', '==', req.user.uid).limit(100).get(); }
    res.json({ count: snap.size, vault: snap.docs.map(d => { const { path: _p, ...rest } = d.data(); return rest; }) });
  }));

  app.delete('/api/vault/:hash', auth, wrap(async (req, res) => {
    const ref = db.collection('vault').doc(req.params.hash);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== req.user.uid) throw httpError(404, 'Not found');
    await bucket.file(snap.data().path).delete().catch(() => {});
    await ref.delete();
    await addUsage(req.user.uid, -(snap.data().size || 0));
    res.json({ success: true });
  }));

  app.post('/api/vault/share', auth, wrap(async (req, res) => {
    const v = await db.collection('vault').doc(String(req.body.hash || '')).get();
    if (!v.exists || v.data().uid !== req.user.uid) throw httpError(403, 'Not yours');
    const token = crypto.randomBytes(24).toString('hex');
    const expireAt = Date.now() + DAY_MS;
    await db.collection('share_links').doc(token).set({ uid: req.user.uid, hash: v.id, expireAt });
    res.json({ link: `/share/${token}/download`, token, expireAt });
  }));

  app.post('/api/vault/share/:token/revoke', auth, wrap(async (req, res) => {
    const snap = await db.collection('share_links').doc(req.params.token).get();
    if (!snap.exists || snap.data().uid !== req.user.uid) throw httpError(404, 'Not found');
    await snap.ref.delete();
    res.json({ success: true });
  }));

  app.get('/share/:token/download', wrap(async (req, res) => {
    const ref = db.collection('share_links').doc(req.params.token);
    const snap = await ref.get();
    if (!snap.exists) throw httpError(404, 'Link expired');
    if (snap.data().expireAt < Date.now()) { await ref.delete().catch(() => {}); throw httpError(404, 'Link expired'); }
    const v = await db.collection('vault').doc(snap.data().hash).get();
    if (!v.exists) throw httpError(404, 'File not found');
    const [buf] = await bucket.file(v.data().path).download();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(v.data().originalName)}"`);
    res.send(decryptBuffer(buf, v.data().uid));
  }));

  // ---------- BILLING DATA (data only, no video) ----------
  app.post('/api/billing/clip-save', auth, wrap(async (req, res) => {
    const b = req.body || {};
    const amount = num(b.amount, 0);
    if (amount < 0) throw httpError(400, 'amount cannot be negative');
    const wt = getTime(b.timezone);
    const report = {
      uid: req.user.uid, cameraId: b.cameraId || null, amount, mode: b.mode || '', fromWhere: b.fromWhere || '', toWhere: b.toWhere || '',
      customerName: b.customerName || '', personCount: parseInt(b.personCount) || 1, counterNo: b.counterNo || 'C1',
      isBillingClip: true, neverDelete: true, created: wt.ts, createdAtExact: wt.utcExact, local: wt.local
    };
    report.sizeBytes = JSON.stringify(report).length;
    const ref = await db.collection('billing_clips').add(report);
    await addUsage(req.user.uid, report.sizeBytes);
    res.json({ success: true, id: ref.id, report });
  }));

  app.post('/api/calculatePrice', auth, (req, res) => { const p = getPrice(countFromBody(req.body), req.body.billingType); res.json({ ...p, total: p.payable }); });

  const SUB_TOTAL_COUNT = { monthly: 60, yearly: 10 };

  // ---------- AUTO-RENEW (Razorpay Subscriptions) ----------
  async function activateSubscriptionCharge(subId, paymentId, paidAmount, ownerUid) {
    return db.runTransaction(async t => {
      const subRef = db.collection('subscriptions').doc(subId);
      const chargeRef = db.collection('subscription_charges').doc(paymentId);
      const [subSnap, chargeSnap] = await Promise.all([t.get(subRef), t.get(chargeRef)]);
      if (!subSnap.exists) throw httpError(404, 'SUBSCRIPTION_NOT_FOUND');
      const sub = subSnap.data();
      if (ownerUid && sub.uid !== ownerUid) throw httpError(403, 'Subscription not yours');
      if (chargeSnap.exists) return { already: true, expiry: chargeSnap.data().expiryAfter };
      if (paidAmount != null && paidAmount !== sub.amount) throw httpError(400, 'AMOUNT_MISMATCH');
      const userRef = db.collection('users').doc(sub.uid);
      const u = (await t.get(userRef)).data() || {};
      const base = (u.planExpiry || 0) > Date.now() ? u.planExpiry : Date.now();
      const expiry = base + sub.days * DAY_MS;
      t.set(chargeRef, { subId, uid: sub.uid, paymentId, amount: sub.amount, expiryAfter: expiry, created: Date.now() });
      t.update(subRef, { status: 'active', lastChargedAt: Date.now() });
      t.set(userRef, { isPro: true, planExpiry: expiry, cameraCount: sub.count, billingType: sub.billingType, autoRenew: true, subscriptionId: subId }, { merge: true });
      return { already: false, expiry };
    });
  }

  async function markSubscriptionEnded(subId, eventName) {
    const ref = db.collection('subscriptions').doc(subId);
    const snap = await ref.get();
    if (!snap.exists) return;
    await ref.set({ status: eventName.replace('subscription.', ''), endedAt: Date.now() }, { merge: true });
    const uref = db.collection('users').doc(snap.data().uid);
    const u = (await uref.get()).data() || {};
    if (u.subscriptionId === subId) await uref.set({ autoRenew: false }, { merge: true });
  }

  const validSubSignature = (subId, paymentId, sig) =>
    safeCompare(crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(paymentId + '|' + subId).digest('hex'), sig);

  app.post('/api/payment/subscribe', auth, wrap(async (req, res) => {
    const cur = (await db.collection('users').doc(req.user.uid).get()).data() || {};
    if (cur.autoRenew && cur.subscriptionId) throw httpError(409, 'Auto-renew is already active. Cancel it first to change the plan.');
    const price = getPrice(countFromBody(req.body), req.body.billingType);
    const amount = price.payable * 100;
    const planKey = `${price.billingType}_${amount}`;
    const planRef = db.collection('razorpay_plans').doc(planKey);
    let planId = (await planRef.get()).exists ? (await planRef.get()).data().planId : null;
    if (!planId) {
      const plan = await razorpay.plans.create({ period: price.billingType === 'yearly' ? 'yearly' : 'monthly', interval: 1, item: { name: `Secure Assistant ${price.billingType} Rs ${price.payable}`, amount, currency: 'INR' } });
      planId = plan.id;
      await planRef.set({ planId, amount, billingType: price.billingType, created: Date.now() });
    }
    const sub = await razorpay.subscriptions.create({ plan_id: planId, total_count: SUB_TOTAL_COUNT[price.billingType], customer_notify: 1, notes: { uid: req.user.uid, count: String(price.count), type: price.billingType } });
    const wt = getTime(req.body.timezone);
    await db.collection('subscriptions').doc(sub.id).set({ uid: req.user.uid, planId, count: price.count, billingType: price.billingType, days: price.days, amount, status: 'created', created: wt.ts, createdAtExact: wt.utcExact });
    res.json({ subscriptionId: sub.id, keyId: process.env.RAZORPAY_KEY_ID, count: price.count, perCamera: price.perCamera, total: price.payable, billingType: price.billingType, days: price.days });
  }));

  app.post('/api/payment/subscribe/verify', auth, wrap(async (req, res) => {
    const { razorpay_payment_id: p, razorpay_subscription_id: s, razorpay_signature: sig } = req.body || {};
    if (!p || !s || !sig || !validSubSignature(s, p, sig)) throw httpError(400, 'Signature check failed');
    const r = await activateSubscriptionCharge(s, p, null, req.user.uid);
    res.json({ success: true, expiry: r.expiry, already: r.already });
  }));

  app.post('/api/payment/subscription/cancel', auth, wrap(async (req, res) => {
    const u = (await db.collection('users').doc(req.user.uid).get()).data() || {};
    if (!u.subscriptionId || !u.autoRenew) throw httpError(400, 'No active auto-renew found');
    try { await razorpay.subscriptions.cancel(u.subscriptionId, true); }
    catch (e) { console.error('subscription cancel failed:', (e && e.error && e.error.description) || e.message); throw httpError(502, 'Could not cancel auto-renew right now, try again'); }
    await db.collection('users').doc(req.user.uid).set({ autoRenew: false }, { merge: true });
    await db.collection('subscriptions').doc(u.subscriptionId).set({ status: 'cancel_at_cycle_end' }, { merge: true });
    res.json({ success: true, message: 'Auto-renew will stop after the current period', planExpiry: u.planExpiry || null });
  }));

  app.delete('/api/billing/:id', auth, wrap(async (req, res) => {
    const ref = db.collection('billing_clips').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== req.user.uid) throw httpError(404, 'Not found');
    const d = snap.data();
    await ref.delete();
    await addUsage(req.user.uid, -(d.sizeBytes || JSON.stringify(d).length));
    res.json({ success: true });
  }));
};