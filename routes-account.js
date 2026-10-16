'use strict';
// Account, profile, team, feedback, public lists and emergency numbers.
module.exports = function register(app, core) {
  const {
    AGENTS, AI_TOOLS, BASE_BYTES, CATEGORIES, COUNTRY_CODES, LANGUAGES,
    auth, authAdmin, clientIp, db, eraseUserData, getTime, httpError, notifyOwner,
    num, planActive, publicCamera, rateLimit, userLimiter, wrap
  } = core;

  const PHONE_RE = /^\+[1-9]\d{7,14}$/;
  const isEmail = v => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const isStrongPassword = p => typeof p === 'string' && p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
  const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyGenerator: clientIp });

  // ---------- PUBLIC DATA ----------
  app.get('/', (req, res) => res.json({ ok: true, app: 'Secure Assistant', version: 'V15' }));
  app.get('/health', (req, res) => res.json({
    ok: true, version: 'V15', categories: CATEGORIES.length, languages: LANGUAGES.length, countries: COUNTRY_CODES.length,
    wahabReady: !!process.env.ANTHROPIC_API_KEY,
    ownerNoticesReady: !!(process.env.OWNER_TELEGRAM_BOT_TOKEN && process.env.OWNER_TELEGRAM_CHAT_ID)
  }));
  app.get('/api/languages', (req, res) => res.json({ languages: LANGUAGES, countryCodes: COUNTRY_CODES, search: ['voice', 'text', 'manual'] }));
  app.get('/api/countries', (req, res) => res.json({ count: COUNTRY_CODES.length, countries: COUNTRY_CODES }));
  app.get('/api/categories', (req, res) => res.json(CATEGORIES));
  app.get('/api/categories/detailed', (req, res) => res.json({ count: CATEGORIES.length, categories: CATEGORIES }));
  app.get('/api/ai-tools', (req, res) => res.json(AI_TOOLS));

  // "Who came and where did they go" needs face recognition and recorder (DVR) access, which are not built yet.
  app.post('/api/live-search', auth, (req, res) => res.json({
    available: false, status: 'coming_soon',
    message: 'Live Search (who came, where did they go) is coming soon. It needs face recognition and recorder access, which are not available yet.'
  }));

  // ---------- AUTH / PROFILE ----------
  function buildUserDoc(uid, b, extra = {}) {
    return {
      uid, email: b.email || '', phone: '', name: b.name || '', photoUrl: b.photoUrl || '', address: b.address || '',
      countryCode: String(b.countryCode || '').split(' ')[0], countryIso: String(b.countryIso || '').toUpperCase().slice(0, 2),
      language: b.language || 'en', timezone: b.timezone || 'UTC',
      location: { lat: num(b.lat), lng: num(b.lng) },
      created: Date.now(), storageUsed: 0, storageLimit: BASE_BYTES, ...extra
    };
  }
  async function verifyPhoneToken(phone, token) {
    if (!PHONE_RE.test(phone || '')) throw httpError(400, 'Phone must be in +countrycode format');
    if (!token) throw httpError(400, 'Phone OTP verification token required');
    let dec;
    try { dec = await authAdmin.verifyIdToken(token); } catch (e) { throw httpError(400, 'Invalid phone verification token'); }
    if (dec.phone_number !== phone) throw httpError(400, 'Phone does not match the verified number');
  }

  app.post('/api/auth/register', registerLimiter, wrap(async (req, res) => {
    const b = req.body || {};
    if (!isEmail(b.email)) throw httpError(400, 'Valid email required');
    if (!isStrongPassword(b.password)) throw httpError(400, 'Password needs 8+ characters with upper, lower, number and symbol');
    const phoneOk = b.phone ? (await verifyPhoneToken(b.phone, b.phoneIdToken), true) : false;
    const user = await authAdmin.createUser({ email: b.email, password: b.password, displayName: b.name || undefined, photoURL: b.photoUrl || undefined });
    try {
      const doc = buildUserDoc(user.uid, b, { phone: phoneOk ? b.phone : '', phoneVerified: phoneOk });
      await db.collection('users').doc(user.uid).set(doc, { merge: true });
      res.json({ success: true, uid: user.uid, token: await authAdmin.createCustomToken(user.uid) });
    } catch (e) { await authAdmin.deleteUser(user.uid).catch(() => {}); throw e; }
  }));

  app.post('/api/auth/init-profile', auth, wrap(async (req, res) => {
    const ref = db.collection('users').doc(req.user.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set(buildUserDoc(req.user.uid, { ...req.body, email: req.user.email || (req.body || {}).email }, { phone: req.user.phone, phoneVerified: !!req.user.phone }));
    }
    res.json({ success: true, user: publicUser((await ref.get()).data()) });
  }));

  app.post('/api/auth/update-profile', auth, wrap(async (req, res) => {
    const b = req.body || {};
    const authUpdate = {}, updates = {};
    if (b.name !== undefined) { updates.name = b.name; authUpdate.displayName = b.name; }
    if (b.photoUrl !== undefined) { updates.photoUrl = b.photoUrl; authUpdate.photoURL = b.photoUrl; }
    if (b.newEmail !== undefined) {
      if (!isEmail(b.newEmail)) throw httpError(400, 'Valid email required');
      updates.email = b.newEmail; authUpdate.email = b.newEmail; authUpdate.emailVerified = false;
    }
    if (b.phone !== undefined) { await verifyPhoneToken(b.phone, b.phoneIdToken); updates.phone = b.phone; updates.phoneVerified = true; }
    if (b.address !== undefined) updates.address = b.address;
    if (b.language !== undefined) updates.language = b.language;
    if (b.timezone !== undefined) updates.timezone = b.timezone;
    if (b.biometricLock !== undefined) updates.biometricLock = b.biometricLock === true || b.biometricLock === 'true';
    if (b.countryCode !== undefined) updates.countryCode = String(b.countryCode).split(' ')[0];
    if (b.countryIso !== undefined) updates.countryIso = String(b.countryIso).toUpperCase().slice(0, 2);
    if (b.lat !== undefined || b.lng !== undefined) updates.location = { lat: num(b.lat), lng: num(b.lng) };
    if (!Object.keys(updates).length) throw httpError(400, 'No fields to update');
    if (Object.keys(authUpdate).length) {
      try { await authAdmin.updateUser(req.user.uid, authUpdate); } catch (e) { throw httpError(400, 'Auth update failed: ' + e.message); }
    }
    updates.updatedAt = Date.now();
    await db.collection('users').doc(req.user.uid).set(updates, { merge: true });
    res.json({ success: true, user: publicUser((await db.collection('users').doc(req.user.uid).get()).data()) });
  }));

  app.post('/api/feedback', auth, userLimiter(20), wrap(async (req, res) => {
    const b = req.body || {}, uid = req.user.uid;
    const type = ['wrong_alert', 'missed_alert', 'bug', 'idea', 'other'].includes(b.type) ? b.type : 'other';
    const message = String(b.message || '').trim().slice(0, 1000);
    const r = Number(b.rating), rating = Number.isInteger(r) && r >= 1 && r <= 5 ? r : null;
    const alertId = b.alertId ? String(b.alertId).slice(0, 80) : null;
    if (!message && !alertId && rating == null) throw httpError(400, 'Send a message, a rating or an alertId');
    await db.collection('feedback').add({
      uid, type, message, rating, alertId, cameraId: b.cameraId ? String(b.cameraId).slice(0, 80) : null,
      toolId: Number.isInteger(Number(b.toolId)) ? Number(b.toolId) : null, appVersion: String(b.appVersion || '').slice(0, 20), created: Date.now()
    });
    if (type === 'wrong_alert' && alertId) {
      const q = await db.collection('alerts').where('userUid', '==', uid).where('alertId', '==', alertId).limit(1).get();
      if (!q.empty) await q.docs[0].ref.update({ feedback: 'wrong', feedbackAt: Date.now() });
    }
    res.json({ success: true });
  }));

  const clientErrorLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, keyGenerator: clientIp });
  const clientErrorTimes = [];
  app.post('/api/client-error', clientErrorLimiter, wrap(async (req, res) => {
    const b = req.body || {};
    let uid = null;
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) { try { uid = (await authAdmin.verifyIdToken(h.slice(7))).uid; } catch (e) { uid = null; } }
    const now = Date.now();
    await db.collection('client_errors').add({
      uid, page: String(b.page || '').slice(0, 80), action: String(b.action || '').slice(0, 80), message: String(b.message || '').slice(0, 500),
      appVersion: String(b.appVersion || '').slice(0, 20), platform: String(b.platform || '').slice(0, 20), created: now
    });
    clientErrorTimes.push(now);
    while (clientErrorTimes.length && clientErrorTimes[0] < now - 10 * 60 * 1000) clientErrorTimes.shift();
    if (clientErrorTimes.length >= 10) notifyOwner('client-spike', `Many app errors: ${clientErrorTimes.length} in the last 10 minutes. Latest page: ${String(b.page || '?').slice(0, 40)}`, 60 * 60 * 1000);
    res.json({ success: true });
  }));

  app.get('/api/team/list', auth, wrap(async (req, res) => {
    const [h, s] = await Promise.all([
      db.collection('team_holders').where('ownerUid', '==', req.user.uid).get(),
      db.collection('team_staff').where('ownerUid', '==', req.user.uid).get()
    ]);
    res.json({ holders: h.docs.map(d => ({ id: d.id, ...d.data() })), holdersLimit: 3, staff: s.docs.map(d => ({ id: d.id, ...d.data() })) });
  }));
  app.post('/api/team/add-holder', auth, wrap(async (req, res) => {
    const snap = await db.collection('team_holders').where('ownerUid', '==', req.user.uid).get();
    if (snap.size >= 3) throw httpError(400, 'Maximum 3 holders');
    await db.collection('team_holders').add({ ownerUid: req.user.uid, name: req.body.name || '', phone: req.body.phone || '', email: req.body.email || '', role: 'App Holder', permissions: req.body.permissions || ['view'], created: Date.now() });
    res.json({ success: true });
  }));
  app.post('/api/team/add-staff', auth, wrap(async (req, res) => {
    await db.collection('team_staff').add({ ownerUid: req.user.uid, name: req.body.name || '', phone: req.body.phone || '', role: req.body.role || 'Staff', created: Date.now() });
    res.json({ success: true });
  }));
  app.delete('/api/team/:kind/:id', auth, wrap(async (req, res) => {
    const col = req.params.kind === 'holder' ? 'team_holders' : req.params.kind === 'staff' ? 'team_staff' : null;
    if (!col) throw httpError(400, 'kind must be holder or staff');
    const ref = db.collection(col).doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().ownerUid !== req.user.uid) throw httpError(404, 'Not found');
    await ref.delete();
    res.json({ success: true });
  }));

  app.post('/api/categories/select', auth, wrap(async (req, res) => {
    const ids = Array.isArray(req.body.categoryIds) ? [...new Set(req.body.categoryIds.map(Number))] : [];
    if (!ids.length || ids.some(id => !CATEGORIES.some(c => c.id === id))) throw httpError(400, 'categoryIds must be a list of valid category ids');
    const subs = Array.isArray(req.body.subCategories) ? req.body.subCategories.map(x => String(x).slice(0, 60)).slice(0, 30) : [];
    const customCategory = String(req.body.customCategory || '').trim().slice(0, 100);
    await db.collection('users').doc(req.user.uid).set({ selectedCategories: ids, selectedSubCategories: subs, customCategory }, { merge: true });
    res.json({ success: true, selectedCategories: ids, selectedSubCategories: subs, customCategory });
  }));

  app.get('/api/agents', (req, res) => res.json(AGENTS));
  app.post('/api/location/update', auth, wrap(async (req, res) => {
    const lat = num(req.body.lat), lng = num(req.body.lng);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw httpError(400, 'Valid lat and lng required');
    await db.collection('users').doc(req.user.uid).set({ location: { lat, lng, updated: Date.now() } }, { merge: true });
    res.json({ success: true });
  }));

  app.post('/api/emergency/action', auth, wrap(async (req, res) => {
    const type = String(req.body.emergencyType || 'General');
    const u = (await db.collection('users').doc(req.user.uid).get()).data() || {};
    const { emergencyFor } = core;
    const e = emergencyFor(req.body.countryIso || u.countryIso, u.countryCode);
    const key = { Fall: 'medical', Fire: 'fire', Weapon: 'police', Intrusion: 'police' }[type] || 'general';
    const loc = u.location || {};
    const hasLoc = loc.lat != null && loc.lng != null;
    const liveLink = hasLoc ? `https://maps.google.com/?q=${loc.lat},${loc.lng}` : null;
    const wt = getTime(req.body.timezone);
    await db.collection('emergencies').add({ uid: req.user.uid, type, number: e[key], location: hasLoc ? loc : null, created: wt.ts, createdAtExact: wt.utcExact });
    res.json({
      success: true, country: e.country, emergencyType: type, emergencyNumber: e[key], location: hasLoc ? loc : null, liveLink,
      smsText: `EMERGENCY: ${type}.${liveLink ? ' Location: ' + liveLink : ' Location not shared.'}`,
      verified: e.verified,
      note: [hasLoc ? null : 'Location not saved - ask the user to allow location', e.verified ? null : 'This number is a general default (112). Please check the local emergency number for this country.'].filter(Boolean).join(' ') || undefined
    });
  }));

  function publicUser(u) {
    const { fcmTokens, subscriptionId, ...rest } = u || {};
    return { ...rest };
  }

  app.get('/api/user/full-box', auth, wrap(async (req, res) => {
    const uid = req.user.uid;
    const [userSnap, camSnap, holdSnap, staffSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection('cameras').where('uid', '==', uid).limit(200).get(),
      db.collection('team_holders').where('ownerUid', '==', uid).get(),
      db.collection('team_staff').where('ownerUid', '==', uid).get()
    ]);
    const u = userSnap.data() || {};
    const used = u.storageUsed || 0, limit = u.storageLimit || BASE_BYTES;
    res.json({
      user: publicUser(u),
      cameras: { count: camSnap.size, list: camSnap.docs.map(publicCamera) },
      team: { holders: holdSnap.docs.map(d => ({ id: d.id, ...d.data() })), staff: staffSnap.docs.map(d => ({ id: d.id, ...d.data() })) },
      storage: { used, limit, percent: Math.round((used / limit) * 100) },
      subscription: { isPro: planActive(u), planExpiry: u.planExpiry || null, cameraCount: u.cameraCount || 0, billingType: u.billingType || null, autoRenew: !!u.autoRenew }
    });
  }));

  app.get('/api/user/export', auth, userLimiter(5), wrap(async (req, res) => {
    const uid = req.user.uid;
    const pull = async (col, field) => (await db.collection(col).where(field, '==', uid).limit(5000).get()).docs.map(d => {
      const { path: _p, rtspEnc, passwordEnc, ...rest } = d.data();
      return { id: d.id, ...rest };
    });
    const [userSnap, cameras, billing, chats, faces, alerts, offline, reports, payments] = await Promise.all([
      db.collection('users').doc(uid).get(), pull('cameras', 'uid'), pull('billing_clips', 'uid'), pull('chats', 'uid'), pull('faces', 'uid'),
      pull('alerts', 'userUid'), pull('offline_clips', 'uid'), pull('daily_reports', 'uid'), pull('payments', 'userUid')
    ]);
    res.setHeader('Content-Disposition', 'attachment; filename="secure-assistant-export.json"');
    res.json({ exportedAt: new Date().toISOString(), user: publicUser(userSnap.data()), cameras, billing_clips: billing, chats, faces_metadata: faces, alerts, offline_clips_metadata: offline, daily_reports: reports, payments });
  }));

  app.post('/api/user/delete', auth, userLimiter(3), wrap(async (req, res) => {
    if (req.body.confirm !== 'DELETE') throw httpError(400, 'Send {"confirm":"DELETE"} to confirm account deletion');
    const uid = req.user.uid;
    await db.collection('users').doc(uid).set({ deleteRequestedAt: Date.now(), deletionStatus: 'pending' }, { merge: true });
    res.status(202).json({ success: true, message: 'Account deletion started' });
    eraseUserData(uid).catch(e => console.error('account erase failed for', uid, e.message));
  }));
};