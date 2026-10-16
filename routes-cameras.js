'use strict';
// Cameras, live video, analytics, alerts, settings, faces, offline videos and reports.
module.exports = function register(app, core) {
  const {
    CAMERA_METHODS, DAY_MS, FV, PYTHON_AI_URL, PYTHON_SECRET, RtcRole, RtcTokenBuilder,
    addUsage, admin, assertStorage, auth, bucket, buildContext, cameraHealthStatus, createAlert, crypto, db,
    encryptBuffer, encryptText, envInt, fetch, getPrice, getTime, httpError, localParts, missing, notifyOwner,
    num, publicCamera, requirePro, sanitizeFilename, takeDaily, upload, userLimiter, wrap
  } = core;
  const FormData = require('form-data');
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  async function callPythonAI(fileBuffer, fileName, uid, categoryId) {
    const controller = new AbortController();
    const waitSec = envInt('PYTHON_TIMEOUT_SEC', 60);
    const timer = setTimeout(() => controller.abort(), waitSec * 1000);
    try {
      const form = new FormData();
      form.append('file', fileBuffer, { filename: sanitizeFilename(fileName) });
      form.append('categoryId', String(categoryId || 1));
      form.append('uid', uid);
      const r = await fetch(`${PYTHON_AI_URL}/detect`, { method: 'POST', body: form, headers: { 'X-CORE-SECRET': PYTHON_SECRET, 'X-UID': uid }, signal: controller.signal });
      if (!r.ok) { notifyOwner('python', `AI service answered with error ${r.status}. Check the Python service logs on Render.`); return { error: true, message: `AI service error ${r.status}`, detections: [], confidence: 0 }; }
      return await r.json();
    } catch (e) {
      const timedOut = e.name === 'AbortError';
      if (!timedOut) notifyOwner('python', 'AI service could not be reached. Check that the Python service is running on Render.');
      return { error: true, message: timedOut ? `AI timeout (${waitSec} sec) - the service may be waking up, retry in a minute` : 'AI service unreachable', detections: [], confidence: 0 };
    } finally { clearTimeout(timer); }
  }

  app.get('/api/cameras/methods', (req, res) => res.json(CAMERA_METHODS));

  // ---------- CAMERAS ----------
  const CAMERA_TYPES = CAMERA_METHODS.map(m => m.type);
  app.post('/api/cameras/set-count', auth, wrap(async (req, res) => {
    const count = parseInt(req.body.count);
    if (!count || count < 1 || count > 1000) throw httpError(400, 'Camera count must be 1 to 1000');
    await db.collection('users').doc(req.user.uid).set({ cameraCountDeclared: count }, { merge: true });
    res.json({ success: true, count, price: getPrice(count, 'monthly') });
  }));

  app.post('/api/cameras/add', auth, wrap(async (req, res) => {
    const b = req.body || {};
    const type = b.type || 'qr_scan';
    if (!CAMERA_TYPES.includes(type)) throw httpError(400, 'Invalid camera method');
    const u = (await db.collection('users').doc(req.user.uid).get()).data() || {};
    const limit = u.cameraCount || u.cameraCountDeclared || 1;
    const existing = await db.collection('cameras').where('uid', '==', req.user.uid).get();
    if (existing.size >= limit) throw httpError(403, `Camera limit ${limit} reached`);
    const wt = getTime(b.timezone);
    const cam = {
      uid: req.user.uid, name: b.name || `Camera ${existing.size + 1}`, type,
      channelName: `cctv_${req.user.uid}_${wt.ts}_${existing.size}`,
      location: { lat: num(b.lat), lng: num(b.lng), label: b.locationLabel || '' },
      created: wt.ts, createdAtExact: wt.utcExact
    };
    if (type === 'ip_rtsp') {
      if (!/^rtsp:\/\//i.test(b.rtspUrl || '')) throw httpError(400, 'rtspUrl must start with rtsp://');
      cam.rtspEnc = encryptText(b.rtspUrl, req.user.uid);
    }
    if (type === 'serial_password') {
      if (!b.serialNumber || !b.password) throw httpError(400, 'serialNumber and password required');
      cam.serialNumber = String(b.serialNumber); cam.passwordEnc = encryptText(b.password, req.user.uid);
    }
    if (type === 'tv_link') {
      if (!/^https?:\/\//i.test(b.tvLink || '')) throw httpError(400, 'tvLink must be an http(s) link');
      cam.tvLink = b.tvLink;
    }
    const ref = await db.collection('cameras').add(cam);
    res.json({ success: true, id: ref.id, channelName: cam.channelName });
  }));

  app.get('/api/cameras/list', auth, wrap(async (req, res) => {
    let snap;
    try { snap = await db.collection('cameras').where('uid', '==', req.user.uid).orderBy('created', 'desc').limit(100).get(); }
    catch (e) { console.warn('cameras index missing:', e.message); snap = await db.collection('cameras').where('uid', '==', req.user.uid).limit(100).get(); }
    res.json({ count: snap.size, cameras: snap.docs.map(publicCamera) });
  }));

  app.post('/api/cameras/update/:id', auth, wrap(async (req, res) => {
    const ref = db.collection('cameras').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== req.user.uid) throw httpError(404, 'Camera not found');
    const b = req.body || {}, up = {};
    if (b.name !== undefined) up.name = String(b.name).slice(0, 80);
    if (b.lat !== undefined || b.lng !== undefined || b.locationLabel !== undefined) up.location = { lat: num(b.lat), lng: num(b.lng), label: b.locationLabel || '' };
    if (!Object.keys(up).length) throw httpError(400, 'No fields to update');
    await ref.update(up);
    res.json({ success: true });
  }));

  app.delete('/api/cameras/:id', auth, wrap(async (req, res) => {
    const ref = db.collection('cameras').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== req.user.uid) throw httpError(404, 'Camera not found');
    await ref.delete();
    res.json({ success: true });
  }));

  // Old phone as CCTV: QR / secure code flow
  app.post('/api/camera/generate-secure-code', auth, wrap(async (req, res) => {
    const code = crypto.randomBytes(8).toString('hex').toUpperCase();
    const channel = `cctv_${req.user.uid}_${Date.now()}`;
    const expireAt = Date.now() + 2 * 60 * 1000;
    await db.collection('secure_codes').doc(code).set({ uid: req.user.uid, code, channelName: channel, expireAt, created: Date.now(), used: false });
    res.json({ secureCode: code, qrData: JSON.stringify({ code, channel }), expireAt, expireIn: '2 min', channelName: channel });
  }));

  app.post('/api/camera/verify-code', auth, wrap(async (req, res) => {
    const ref = db.collection('secure_codes').doc(String(req.body.code || ''));
    const snap = await ref.get();
    if (!snap.exists) throw httpError(404, 'Invalid code');
    const c = snap.data();
    if (c.uid !== req.user.uid) throw httpError(403, 'Code belongs to another account');
    if (c.expireAt < Date.now()) throw httpError(410, 'Code expired');
    if (c.used) throw httpError(400, 'Code already used');
    await ref.update({ used: true, verifiedAt: Date.now() });
    res.json({ success: true, channelName: c.channelName });
  }));

  // Agora token: role "publisher" (phone camera) or "viewer" (live page)
  // Live video budget: 20 minutes per customer per day, split as 5 min x 4 sessions (publish and view share the same daily minutes).
  app.post('/api/agora/token', auth, requirePro, wrap(async (req, res) => {
    if (!RtcTokenBuilder) throw httpError(500, 'agora-token package not installed');
    const { channelName, secureCode, role } = req.body || {};
    let channel, rtcRole = role === 'viewer' ? RtcRole.SUBSCRIBER : RtcRole.PUBLISHER;
    if (secureCode) {
      const c = (await db.collection('secure_codes').doc(String(secureCode)).get()).data();
      if (!c || c.uid !== req.user.uid) throw httpError(403, 'Invalid code');
      if (Date.now() > c.expireAt + 10 * 60 * 1000) throw httpError(410, 'Code expired');
      channel = c.channelName;
    } else if (channelName) {
      const cam = await db.collection('cameras').where('uid', '==', req.user.uid).where('channelName', '==', channelName).limit(1).get();
      if (cam.empty) throw httpError(403, 'Channel not found for your account');
      channel = channelName;
    } else throw httpError(400, 'channelName or secureCode required');
    const limit = envInt('AGORA_DAILY_SESSIONS', 4); // both viewer and publisher share this daily count
    const q = await takeDaily(req.user.uid, 'agora_session', limit, (req.userDoc || {}).timezone);
    if (!q.allowed) throw httpError(429, `Daily live-video limit reached (${limit} sessions, about 20 minutes). It resets at midnight in your timezone.`);
    const seconds = Math.min(600, Math.max(60, envInt('AGORA_TOKEN_MINUTES', 5) * 60));
    const token = RtcTokenBuilder.buildTokenWithUid(process.env.AGORA_APP_ID, process.env.AGORA_APP_CERT, channel, 0, rtcRole, seconds, seconds);
    res.json({ appId: process.env.AGORA_APP_ID, channelName: channel, token, role: rtcRole === RtcRole.SUBSCRIBER ? 'viewer' : 'publisher', expiresIn: seconds, sessionsUsedToday: q.used, sessionsPerDay: limit });
  }));

  // ---------- VIDEO / OFFLINE REVIVE ----------
  app.post('/api/video/upload-analyze', auth, requirePro, upload.single('video'), wrap(async (req, res) => {
    if (!req.file) throw httpError(400, 'NO_VIDEO');
    await assertStorage(req.user.uid, req.file.size);
    const result = await callPythonAI(req.file.buffer, req.file.originalname, req.user.uid, req.body.categoryId);
    if (result.error) throw httpError(502, result.message);
    const wt = getTime(req.body.timezone);
    const dest = `capsules/${req.user.uid}/${wt.ts}_${crypto.randomBytes(4).toString('hex')}.enc`;
    await bucket.file(dest).save(encryptBuffer(req.file.buffer, req.user.uid), { metadata: { contentType: 'application/octet-stream' } });
    await addUsage(req.user.uid, req.file.size);
    const inc = await db.collection('incidents').add({ userUid: req.user.uid, path: dest, size: req.file.size, created: wt.ts, createdAtExact: wt.utcExact, proofWindow: { before: wt.beforeExact, after: wt.afterExact }, detections: result.detections || [] });
    res.json({ success: true, incidentId: inc.id, detections: result.detections || [] });
  }));

  app.post('/api/offline/upload', auth, requirePro, upload.single('clip'), wrap(async (req, res) => {
    if (!req.file) throw httpError(400, 'NO_CLIP');
    await assertStorage(req.user.uid, req.file.size);
    const wt = getTime(req.body.timezone);
    const dest = `offline/${req.user.uid}/${wt.ts}_${crypto.randomBytes(4).toString('hex')}.enc`;
    await bucket.file(dest).save(encryptBuffer(req.file.buffer, req.user.uid), { metadata: { contentType: 'application/octet-stream' } });
    await addUsage(req.user.uid, req.file.size);
    const ref = await db.collection('offline_clips').add({
      uid: req.user.uid, cameraId: req.body.cameraId || null, path: dest, size: req.file.size,
      deviceStartMs: num(req.body.deviceStartMs), deviceEndMs: num(req.body.deviceEndMs), deviceTimeVerified: false,
      serverReceivedAt: wt.utcExact, created: wt.ts
    });
    res.json({ success: true, id: ref.id, serverReceivedAt: wt.utcExact, note: 'Recording times are from the phone clock and are not server-verified' });
  }));

  // ---------- FACES ----------
  app.post('/api/faces/add', auth, requirePro, upload.single('face'), wrap(async (req, res) => {
    if (!req.file) throw httpError(400, 'NO_FACE');
    if (req.body.consent !== 'true' && req.body.consent !== true) throw httpError(400, 'Consent of the person is required');
    if (!req.body.name) throw httpError(400, 'name required');
    await assertStorage(req.user.uid, req.file.size);
    const wt = getTime(req.body.timezone);
    const dest = `faces/${req.user.uid}/${wt.ts}_${crypto.randomBytes(4).toString('hex')}.enc`;
    await bucket.file(dest).save(encryptBuffer(req.file.buffer, req.user.uid), { metadata: { contentType: 'application/octet-stream' } });
    await addUsage(req.user.uid, req.file.size);
    const ref = await db.collection('faces').add({
      uid: req.user.uid, name: String(req.body.name).slice(0, 80), nameLower: String(req.body.name).trim().toLowerCase(), role: req.body.role || 'staff',
      path: dest, size: req.file.size, consent: true, consentTimestamp: wt.utcExact, purpose: req.body.purpose || 'Staff attendance', created: wt.ts
    });
    res.json({ success: true, id: ref.id });
  }));

  app.get('/api/faces/find-by-name', auth, requirePro, wrap(async (req, res) => {
    const name = String(req.query.name || '').trim().toLowerCase();
    if (!name) throw httpError(400, 'name required');
    const snap = await db.collection('faces').where('uid', '==', req.user.uid).where('nameLower', '==', name).limit(20).get();
    res.json({ count: snap.size, faces: snap.docs.map(d => ({ id: d.id, name: d.data().name, role: d.data().role, created: d.data().created })) });
  }));

  app.post('/api/faces/search', auth, requirePro, upload.single('face'), wrap(async (req, res) => {
    if (!req.file) throw httpError(400, 'NO_FACE');
    const r = await callPythonAI(req.file.buffer, req.file.originalname, req.user.uid, 1);
    if (r.error) throw httpError(502, r.message);
    if (r.confidence === undefined) throw httpError(501, 'Face recognition is not available on the AI service yet');
    const conf = Number(r.confidence) || 0;
    if (conf === 0) return res.json({ found: false, confidence: 0, message: 'Face not clear - please upload a clearer photo' });
    if (conf < 50) return res.json({ found: false, confidence: conf, message: 'No match above 50%' });
    res.json({ found: true, confidence: conf, match: (r.detections || [])[0] || null, askConfirm: conf < 85, message: conf < 85 ? `Possible match (${conf}%) - please confirm` : `Match confirmed (${conf}%)` });
  }));

  app.delete('/api/faces/:id', auth, wrap(async (req, res) => {
    const ref = db.collection('faces').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== req.user.uid) throw httpError(404, 'Not found');
    await bucket.file(snap.data().path).delete().catch(() => {});
    await ref.delete();
    await addUsage(req.user.uid, -(snap.data().size || 0));
    res.json({ success: true, message: 'Face data erased' });
  }));

  async function billsForDay(uid, date) {
    const start = new Date(date + 'T00:00:00Z').toISOString();
    const end = new Date(new Date(date + 'T00:00:00Z').getTime() + DAY_MS).toISOString();
    let snap;
    try { snap = await db.collection('billing_clips').where('uid', '==', uid).where('createdAtExact', '>=', start).where('createdAtExact', '<', end).orderBy('createdAtExact', 'desc').limit(500).get(); }
    catch (e) { console.warn('billing index missing:', e.message); snap = await db.collection('billing_clips').where('uid', '==', uid).limit(500).get(); }
    return { start, end, bills: snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => b.createdAtExact >= start && b.createdAtExact < end) };
  }

  app.get('/api/report/daily/:date', auth, wrap(async (req, res) => {
    if (!DATE_RE.test(req.params.date)) throw httpError(400, 'Date format must be YYYY-MM-DD');
    const { start, end, bills } = await billsForDay(req.user.uid, req.params.date);
    const byCounter = {};
    bills.forEach(b => { const c = b.counterNo || 'C1'; byCounter[c] = byCounter[c] || { sale: 0, count: 0 }; byCounter[c].sale += b.amount || 0; byCounter[c].count += 1; });
    res.json({ date: req.params.date, start, end, totalSale: bills.reduce((s, b) => s + (b.amount || 0), 0), totalBills: bills.length, totalCustomers: bills.reduce((s, b) => s + (b.personCount || 1), 0), byCounter, clips: bills });
  }));

  app.post('/api/report/export-zip', auth, wrap(async (req, res) => {
    const { date, timezone } = req.body || {};
    if (!date || !DATE_RE.test(date)) throw httpError(400, 'date (YYYY-MM-DD) required');
    const wt = getTime(timezone);
    const { bills } = await billsForDay(req.user.uid, date);
    const dest = `reports/${req.user.uid}/report_${date}_${wt.ts}.json`;
    await bucket.file(dest).save(Buffer.from(JSON.stringify({ exportedAt: wt.utcExact, date, count: bills.length, bills }, null, 2)), { metadata: { contentType: 'application/json' } });
    const [url] = await bucket.file(dest).getSignedUrl({ action: 'read', expires: Date.now() + 7 * DAY_MS });
    res.json({ success: true, downloadUrl: url, count: bills.length, expiresIn: '7 days' });
  }));

  // ---------- ALERTS / ANALYTICS ----------
  app.post('/api/alert/register-token', auth, wrap(async (req, res) => {
    if (!req.body.fcmToken) throw httpError(400, 'fcmToken required');
    await db.collection('users').doc(req.user.uid).set({ fcmTokens: FV.arrayUnion(String(req.body.fcmToken)) }, { merge: true });
    res.json({ success: true });
  }));

  app.post('/api/alert/send', auth, wrap(async (req, res) => {
    const b = req.body || {}, wt = getTime(b.timezone);
    const alertData = { alertId: 'alert_' + wt.ts, userUid: req.user.uid, cameraId: b.cameraId || null, alertType: b.alertType || 'Intrusion', message: b.message || 'Detected', created: wt.ts, createdAtExact: wt.utcExact, beforeExact: wt.beforeExact, afterExact: wt.afterExact };
    await db.collection('alerts').add(alertData);
    try {
      const tokens = ((await db.collection('users').doc(req.user.uid).get()).data() || {}).fcmTokens || [];
      if (tokens.length) await admin.messaging().sendEachForMulticast({ tokens, notification: { title: alertData.alertType, body: alertData.message } });
    } catch (e) { console.warn('push failed:', e.message); }
    res.json({ success: true, alert: alertData });
  }));

  app.get('/api/alert/list', auth, wrap(async (req, res) => {
    let snap;
    try { snap = await db.collection('alerts').where('userUid', '==', req.user.uid).orderBy('created', 'desc').limit(100).get(); }
    catch (e) { console.warn('alerts index missing:', e.message); snap = await db.collection('alerts').where('userUid', '==', req.user.uid).limit(100).get(); }
    res.json({ count: snap.size, alerts: snap.docs.map(d => d.data()) });
  }));

  const VEHICLE_LABELS = ['car', 'motorcycle', 'bus', 'truck', 'bicycle'];
  const inClosedHours = (hour, from, to) => from != null && to != null && from !== to && (from < to ? hour >= from && hour < to : hour >= from || hour < to);
  const camKeyOf = id => String(id || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);

  app.get('/api/settings/alerts', auth, wrap(async (req, res) => {
    const u = (await db.collection('users').doc(req.user.uid).get()).data() || {};
    res.json({ settings: { intrusionEnabled: false, closedFromHour: 22, closedToHour: 7, crowdEnabled: false, crowdLimit: 20, ...(u.alertSettings || {}) } });
  }));

  app.post('/api/settings/alerts', auth, wrap(async (req, res) => {
    const b = req.body || {}, st = {};
    const hour = v => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 23) throw httpError(400, 'Hours must be whole numbers from 0 to 23'); return n; };
    if (b.intrusionEnabled !== undefined) st.intrusionEnabled = b.intrusionEnabled === true || b.intrusionEnabled === 'true';
    if (b.closedFromHour !== undefined) st.closedFromHour = hour(b.closedFromHour);
    if (b.closedToHour !== undefined) st.closedToHour = hour(b.closedToHour);
    if (b.crowdEnabled !== undefined) st.crowdEnabled = b.crowdEnabled === true || b.crowdEnabled === 'true';
    if (b.crowdLimit !== undefined) { const n = Number(b.crowdLimit); if (!Number.isInteger(n) || n < 1 || n > 10000) throw httpError(400, 'crowdLimit must be 1 to 10000'); st.crowdLimit = n; }
    if (!Object.keys(st).length) throw httpError(400, 'No settings sent');
    await db.collection('users').doc(req.user.uid).set({ alertSettings: st }, { merge: true });
    res.json({ success: true, settings: st });
  }));

  app.post('/api/analytics/frame', auth, userLimiter(60), upload.single('frame'), wrap(async (req, res) => {
    if (!req.file) throw httpError(400, 'NO_FRAME');
    if (req.file.size > 3 * 1024 * 1024) throw httpError(400, 'Frame must be under 3 MB');
    const uid = req.user.uid;
    const u = (await db.collection('users').doc(uid).get()).data() || {};
    if (!u.uid || u.deleteRequestedAt) throw httpError(403, 'Account is not active');
    const r = await callPythonAI(req.file.buffer, req.file.originalname || 'frame.jpg', uid, 1);
    if (r.error) throw httpError(502, r.message);
    const dets = r.detections || [];
    const personCount = dets.filter(d => d.label === 'person').length;
    const vehicleCount = dets.filter(d => VEHICLE_LABELS.includes(d.label)).length;
    const now = Date.now();
    await db.collection('footfall').add({ uid, cameraId: req.body.cameraId || null, personCount, vehicleCount, created: now });
    const st = u.alertSettings || {}, last = u.alertLast || {}, key = camKeyOf(req.body.cameraId), camName = req.body.cameraId ? `camera ${req.body.cameraId}` : 'your camera';
    const triggered = [], stamps = {};
    if (st.intrusionEnabled && personCount > 0 && inClosedHours(localParts(now, u.timezone).hour, st.closedFromHour, st.closedToHour) && now - (last['intrusion_' + key] || 0) > 10 * 60 * 1000) {
      triggered.push(await createAlert(uid, u, { cameraId: req.body.cameraId, alertType: 'Intrusion', message: `A person was detected on ${camName} during closed hours.` }));
      stamps['intrusion_' + key] = now;
    }
    if (st.crowdEnabled && st.crowdLimit > 0 && personCount >= st.crowdLimit && now - (last['crowd_' + key] || 0) > 15 * 60 * 1000) {
      triggered.push(await createAlert(uid, u, { cameraId: req.body.cameraId, alertType: 'Crowd', message: `${personCount} people detected on ${camName} (limit ${st.crowdLimit}).` }));
      stamps['crowd_' + key] = now;
    }
    if (Object.keys(stamps).length) await db.collection('users').doc(uid).set({ alertLast: stamps }, { merge: true });
    res.json({ success: true, personCount, vehicleCount, alertsCreated: triggered.map(a => a.alertType), stored: 'counts only - image not saved' });
  }));

  app.post('/api/camera/heartbeat', auth, wrap(async (req, res) => {
    const b = req.body || {};
    const ref = db.collection('cameras').doc(String(b.cameraId || ''));
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== req.user.uid) throw httpError(404, 'Camera not found');
    const pct = num(b.battery);
    const health = {
      battery: pct == null ? null : Math.max(0, Math.min(100, pct)), charging: b.charging === true || b.charging === 'true',
      storageFreeMb: num(b.storageFreeMb), network: ['wifi', 'mobile', 'none'].includes(b.network) ? b.network : 'unknown', updatedAt: Date.now()
    };
    await ref.update({ health });
    res.json({ success: true, status: cameraHealthStatus(health) });
  }));

  app.get('/api/analytics/summary', auth, requirePro, wrap(async (req, res) => {
    const days = Math.max(1, Math.min(30, parseInt(req.query.days) || 14));
    res.json(await buildContext(req.user.uid, req.userDoc.timezone, days));
  }));

  app.get('/api/camera/add-methods', (req, res) => res.json({ methods: CAMERA_METHODS }));

  app.get('/api/offline/list', auth, wrap(async (req, res) => {
    const snap = await db.collection('offline_clips').where('uid', '==', req.user.uid).limit(200).get();
    const clips = snap.docs.map(d => { const { path: _p, ...rest } = d.data(); return { id: d.id, ...rest }; }).sort((a, b) => (b.created || 0) - (a.created || 0));
    res.json({ count: clips.length, clips });
  }));

  app.delete('/api/offline/:id', auth, wrap(async (req, res) => {
    const ref = db.collection('offline_clips').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== req.user.uid) throw httpError(404, 'Not found');
    if (snap.data().path) await bucket.file(snap.data().path).delete().catch(() => {});
    await ref.delete();
    await addUsage(req.user.uid, -(snap.data().size || 0));
    res.json({ success: true });
  }));

  app.post('/api/report/twice-daily-toggle', auth, wrap(async (req, res) => {
    const enabled = req.body.enabled === true || req.body.enabled === 'true';
    await db.collection('users').doc(req.user.uid).set({ dailyReportEnabled: enabled }, { merge: true });
    res.json({ success: true, enabled });
  }));

  app.get('/api/report/summaries', auth, wrap(async (req, res) => {
    let snap;
    try { snap = await db.collection('daily_reports').where('uid', '==', req.user.uid).orderBy('created', 'desc').limit(30).get(); }
    catch (e) { console.warn('daily_reports index missing:', e.message); snap = await db.collection('daily_reports').where('uid', '==', req.user.uid).limit(30).get(); }
    res.json({ count: snap.size, reports: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  }));
};