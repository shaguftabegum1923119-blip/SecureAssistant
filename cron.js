'use strict';
// Scheduled jobs called by cron-job.org with the X-CRON-SECRET header.
module.exports = function register(app, core) {
  const {
    BASE_BYTES, CRON_SECRET, DAY_MS,
    addUsage, admin, bucket, buildContext, checkStorageAlerts, clientIp, createAlert, db,
    eraseUserData, httpError, localParts, notifyOwner, planActive, safeCompare, storagePackState, wrap
  } = core;
  const GRACE_MS = 8 * DAY_MS;

  function settleStoragePacks(u, now) {
    const packs = Array.isArray(u.storageExtraPacks) ? u.storageExtraPacks : [];
    const ended = packs.filter(p => p && p.expiresAt <= now);
    const st = storagePackState(packs, now);
    const reminders = [];
    const active = st.active.map(p => {
      if (p.expiresAt - now <= 3 * DAY_MS && !p.remindedAt) { reminders.push(p); return { ...p, remindedAt: now }; }
      return p;
    });
    return { ended, reminders, update: { storageExtraPacks: active, storageLimit: st.limitBytes, storageNextExpiry: st.nextExpiry } };
  }

  async function processStoragePacks() {
    const now = Date.now();
    const snap = await db.collection('users').where('storageNextExpiry', '<', now + 3 * DAY_MS).limit(500).get();
    let ended = 0, reminded = 0;
    for (const d of snap.docs) {
      try {
        const u = d.data();
        const r = settleStoragePacks(u, now);
        await d.ref.set(r.update, { merge: true });
        if (r.ended.length) {
          ended += r.ended.length;
          const gb = r.ended.reduce((sum, p) => sum + (p.gb || 0), 0);
          await createAlert(d.id, u, { alertType: 'Storage', message: `Your extra ${gb} GB storage has ended. Buy it again to keep the extra space.` });
          checkStorageAlerts(d.id);
        } else if (r.reminders.length) {
          reminded += r.reminders.length;
          await createAlert(d.id, u, { alertType: 'Storage', message: 'Your extra storage ends in 3 days. Buy it again to keep the extra space.' });
        }
      } catch (e) { console.error('storage pack check failed for', d.id, e.message); }
    }
    return { ended, reminded };
  }

  const cronFails = new Map();
  function requireCron(req, res, next) {
    const h = req.headers['x-cron-secret'];
    if (h && safeCompare(h, CRON_SECRET)) return next();
    const key = clientIp(req), now = Date.now();
    let f = cronFails.get(key);
    if (!f || f.resetAt < now) { f = { count: 0, resetAt: now + 15 * 60 * 1000 }; cronFails.set(key, f); }
    f.count++;
    if (cronFails.size > 5000) for (const [k, v] of cronFails) if (v.resetAt < now) cronFails.delete(k);
    return next(f.count > 30 ? httpError(429, 'Too many wrong attempts') : httpError(401, 'Unauthorized'));
  }

  app.post('/api/cron/camera-health', requireCron, wrap(async (req, res) => {
    const now = Date.now();
    const snap = await db.collection('cameras').where('health.updatedAt', '<', now - 15 * 60 * 1000).limit(500).get();
    let alerted = 0;
    for (const d of snap.docs) {
      try {
        const c = d.data();
        if (now - c.health.updatedAt > 7 * DAY_MS) continue;
        if (c.offlineAlertedAt && c.offlineAlertedAt >= c.health.updatedAt) continue;
        const u = (await db.collection('users').doc(c.uid).get()).data();
        if (!u || u.deleteRequestedAt || !u.isPro || (u.planExpiry && u.planExpiry < now)) continue;
        await createAlert(c.uid, u, { cameraId: d.id, alertType: 'Camera Offline', message: `${c.name || 'A camera'} has not reported for 15 minutes.` });
        await d.ref.update({ offlineAlertedAt: now });
        alerted++;
      } catch (e) { console.error('camera-health failed for', d.id, e.message); }
    }
    res.json({ ok: true, checked: snap.size, alerted });
  }));

  app.post('/api/cron/owner-digest', requireCron, wrap(async (req, res) => {
    const now = Date.now(), since = now - DAY_MS;
    const count = async q => { try { return (await q.count().get()).data().count; } catch (e) { console.warn('digest count failed:', e.message); return null; } };
    const newUsers = await count(db.collection('users').where('created', '>', since));
    const paidCustomers = await count(db.collection('users').where('isPro', '==', true));
    const alerts = await count(db.collection('alerts').where('created', '>', since));
    const appErrors = await count(db.collection('client_errors').where('created', '>', since));
    const pay = await db.collection('payments').where('created', '>', since).limit(500).get();
    const paid = pay.docs.map(d => d.data()).filter(x => x.verified);
    const revenue = paid.reduce((sum, x) => sum + (x.total || 0), 0);
    const fb = await db.collection('feedback').where('created', '>', since).limit(300).get();
    const wrongAlerts = fb.docs.filter(d => d.data().type === 'wrong_alert').length;
    const show = v => (v == null ? 'n/a' : v);
    const text = ['Secure Assistant - daily summary (last 24 hours)',
      `New customers: ${show(newUsers)}`, `Paid customers now: ${show(paidCustomers)}`,
      `Payments: ${paid.length} (Rs ${revenue})`, `Alerts sent to customers: ${show(alerts)}`,
      `App errors reported: ${show(appErrors)}`, `Feedback: ${fb.size} (wrong-alert reports: ${wrongAlerts})`].join('\n');
    await db.collection('owner_digests').doc(new Date(now).toISOString().slice(0, 10)).set({ created: now, newUsers, paidCustomers, payments: paid.length, revenue, alerts, appErrors, feedback: fb.size, wrongAlerts }, { merge: true });
    const sent = await notifyOwner('digest', text, 0);
    res.json({ ok: true, sent, newUsers, paidCustomers, payments: paid.length, revenue, alerts, appErrors, feedback: fb.size, wrongAlerts });
  }));

  app.post('/api/cron/storage-cleanup', requireCron, wrap(async (req, res) => {
    let cleaned = 0, freedBytes = 0;
    const packs = await processStoragePacks().catch(e => { console.error('storage packs failed:', e.message); return { ended: 0, reminded: 0, failed: true }; });
    const users = await db.collection('users').get();
    for (const ud of users.docs) {
      const u = ud.data();
      let used = u.storageUsed || 0;
      const limit = u.storageLimit || BASE_BYTES;
      if (used <= limit) continue;
      try {
        const snap = await db.collection('incidents').where('userUid', '==', ud.id).orderBy('created', 'asc').limit(25).get();
        for (const d of snap.docs) {
          if (used <= limit) break;
          const inc = d.data();
          if (Date.now() - (inc.created || Date.now()) < GRACE_MS) continue;
          if (inc.path) await bucket.file(inc.path).delete().catch(() => {});
          await d.ref.delete();
          const size = inc.size || 0;
          await addUsage(ud.id, -size);
          used -= size; freedBytes += size; cleaned++;
        }
      } catch (e) { console.error('cleanup failed for user', ud.id, e.message); }
    }
    res.json({ ok: true, cleaned, freedBytes, packs });
  }));

  app.post('/api/cron/process-deletions', requireCron, wrap(async (req, res) => {
    const snap = await db.collection('users').where('deletionStatus', '==', 'pending').limit(20).get();
    let done = 0;
    for (const d of snap.docs) {
      if (Date.now() - (d.data().deleteRequestedAt || 0) < 10 * 60 * 1000) continue;
      try { await eraseUserData(d.id); done++; } catch (e) { console.error('retry erase failed for', d.id, e.message); }
    }
    res.json({ ok: true, pending: snap.size, completed: done });
  }));

  function buildReportText(data) {
    const sum = o => Object.values(o).reduce((a, n) => a + n, 0);
    const people = sum(data.people.byDay), sale = sum(data.sales.byDay), alerts = sum(data.alertsByType);
    const peak = Object.entries(data.people.byHour).sort((a, b) => b[1] - a[1])[0];
    if (!data.footfallSamples && !data.billsCount && !alerts) return 'No data in the last 24 hours. Keep your camera and person counting on.';
    const parts = [];
    if (people > 0) parts.push(`cameras counted ${people} people (sampled)`);
    if (peak && people > 0) parts.push(`busiest hour ${peak[0]}:00`);
    if (data.billsCount > 0) parts.push(`total sales ${Math.round(sale)}`);
    if (alerts > 0) parts.push(`${alerts} alerts`);
    return 'Last 24 hours: ' + parts.join(', ') + '. Have a nice day.';
  }

  app.post('/api/cron/daily-report', requireCron, wrap(async (req, res) => {
    const now = Date.now();
    let sent = 0, skipped = 0;
    const snap = await db.collection('users').where('isPro', '==', true).limit(1000).get();
    for (const doc of snap.docs) {
      const u = doc.data();
      if (!planActive(u) || u.dailyReportEnabled === false) { skipped++; continue; }
      const lp = localParts(now, u.timezone);
      if (lp.hour !== 8 && lp.hour !== 20) { skipped++; continue; }
      const slot = `${lp.date}-${lp.hour}`;
      if (u.lastReportSlot === slot) { skipped++; continue; }
      try {
        const data = await buildContext(doc.id, u.timezone, 1);
        const summary = buildReportText(data);
        await db.collection('daily_reports').add({ uid: doc.id, slot, summary, data, created: now });
        await doc.ref.set({ lastReportSlot: slot }, { merge: true });
        const tokens = u.fcmTokens || [];
        if (tokens.length) await admin.messaging().sendEachForMulticast({ tokens, notification: { title: 'Secure Assistant report', body: summary } }).catch(e => console.warn('push failed:', e.message));
        sent++;
      } catch (e) { console.error('daily report failed for', doc.id, e.message); }
    }
    res.json({ ok: true, sent, skipped });
  }));
};