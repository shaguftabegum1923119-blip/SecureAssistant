'use strict';
// Google Play purchases through RevenueCat.
// RevenueCat checks the purchase with Google Play and then calls this webhook.
// Only calls that carry the secret Authorization value are trusted.
// Render variable needed: REVENUECAT_WEBHOOK_AUTH (the exact value typed in the RevenueCat webhook "Authorization header" field).
// Play product naming: subscription id "cameras_<count>" with base plan ids "monthly" and "yearly" (example: cameras_3:monthly).
module.exports = function register(app, core) {
  const { createAlert, db, httpError, notifyOwner, safeCompare, wrap } = core;

  const GRANT_EVENTS = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'SUBSCRIPTION_EXTENDED'];
  const PRODUCT_RE = /cameras_(\d+)[:_](monthly|yearly)/i;
  const UID_RE = /^[A-Za-z0-9_-]{6,128}$/;

  function parseProduct(productId) {
    const m = PRODUCT_RE.exec(String(productId || ''));
    if (!m) return null;
    const count = parseInt(m[1], 10);
    if (!(count >= 1 && count <= 1000)) return null;
    return { count, billingType: m[2].toLowerCase() };
  }

  async function findUser(event) {
    const ids = [event.app_user_id, event.original_app_user_id].concat(Array.isArray(event.aliases) ? event.aliases : [])
      .filter(x => typeof x === 'string' && UID_RE.test(x));
    for (const id of [...new Set(ids)]) {
      const snap = await db.collection('users').doc(id).get();
      if (snap.exists) return id;
    }
    return null;
  }

  app.post('/api/play/webhook', wrap(async (req, res) => {
    const secret = process.env.REVENUECAT_WEBHOOK_AUTH;
    if (!secret) throw httpError(503, 'Play webhook is not configured');
    if (!safeCompare(req.headers.authorization, secret)) throw httpError(401, 'Unauthorized');

    const event = req.body && req.body.event;
    if (!event || !event.type) return res.json({ ok: true, ignored: 'no event' });
    if (event.type === 'TEST') return res.json({ ok: true, test: true });

    const eventId = String(event.id || [event.type, event.transaction_id, event.event_timestamp_ms].join('_'))
      .replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 200);
    const uid = await findUser(event);
    if (!uid) {
      notifyOwner('play-unknown-user', 'A Play purchase event arrived for a user that was not found. In FlutterFlow, log in to RevenueCat with the Firebase user id.');
      return res.json({ ok: true, ignored: 'unknown user' });
    }

    const when = Number(event.event_timestamp_ms) || Date.now();
    const result = await db.runTransaction(async t => {
      const evRef = db.collection('play_events').doc(eventId);
      const userRef = db.collection('users').doc(uid);
      const [evSnap, userSnap] = await Promise.all([t.get(evRef), t.get(userRef)]);
      if (evSnap.exists) return { ignored: 'duplicate' };
      const u = userSnap.data() || {};
      const log = {
        uid, type: String(event.type), product: String(event.product_id || '').slice(0, 80),
        environment: String(event.environment || '').slice(0, 20), eventMs: when, created: Date.now()
      };
      t.set(evRef, log);

      if (u.playLastEventMs && when < u.playLastEventMs && event.type !== 'BILLING_ISSUE') return { ignored: 'older event' };

      if (GRANT_EVENTS.includes(event.type)) {
        const expiry = Number(event.expiration_at_ms);
        const productId = event.type === 'PRODUCT_CHANGE' && event.new_product_id ? event.new_product_id : event.product_id;
        const prod = parseProduct(productId);
        if (!prod || !Number.isFinite(expiry) || expiry <= Date.now()) return { ignored: 'not a usable purchase' };
        const otherExpiry = u.billingSource === 'play' ? 0 : (u.planExpiry || 0);
        const planExpiry = Math.max(expiry, otherExpiry);
        t.set(userRef, {
          isPro: true, planExpiry, cameraCount: prod.count, billingType: prod.billingType,
          billingSource: 'play', playProductId: String(productId).slice(0, 80), playAutoRenew: true, playLastEventMs: when
        }, { merge: true });
        t.set(db.collection('play_subscriptions').doc(uid), {
          uid, lastEventType: String(event.type), productId: String(productId).slice(0, 80), expiry,
          environment: log.environment, updated: Date.now()
        }, { merge: true });
        return { granted: true, expiry: planExpiry };
      }

      if (event.type === 'EXPIRATION') {
        const exp = Number(event.expiration_at_ms) || Date.now();
        if (u.billingSource === 'play' && (u.planExpiry || 0) <= exp + 60000) {
          t.set(userRef, { isPro: false, planExpiry: Math.min(exp, Date.now()), playAutoRenew: false, playLastEventMs: when }, { merge: true });
          return { revoked: true };
        }
        return { ignored: 'plan is not from Play or was already extended' };
      }

      if (event.type === 'CANCELLATION') {
        if (u.billingSource === 'play') t.set(userRef, { playAutoRenew: false, playLastEventMs: when }, { merge: true });
        return { noted: 'cancelled, access stays until the end of the paid period' };
      }

      if (event.type === 'BILLING_ISSUE') return { billingIssue: true };
      return { ignored: 'event type not used' };
    });

    if (result.billingIssue) {
      const u = (await db.collection('users').doc(uid).get()).data() || {};
      await createAlert(uid, u, { alertType: 'Payment', message: 'Your Google Play payment could not be collected. Please update your payment method in Google Play.' });
    }
    res.json({ ok: true, ...result });
  }));
};