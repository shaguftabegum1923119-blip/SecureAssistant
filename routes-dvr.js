'use strict';
// DVR bridge (backend side only). The owner creates a bridge in the app and gets a token ONCE.
// A small program on the shop's old phone/PC then calls /api/dvr/heartbeat with header X-Bridge-Token.
// Only a hash of the token is stored, so a leaked database does not leak working tokens.
module.exports = function register(app, core) {
  const { auth, clientIp, crypto, db, envInt, httpError, planActive, rateLimit, requirePro, wrap } = core;

  const hashToken = t => (t ? crypto.createHash('sha256').update(String(t)).digest('hex') : '');
  const TOKEN_RE = /^dvr_[a-f0-9]{48}$/;
  const ONLINE_MS = 5 * 60 * 1000;

  const publicBridge = d => {
    const { tokenHash, ...rest } = d.data();
    const seen = rest.lastSeen || 0;
    return { id: d.id, ...rest, status: !seen ? 'never_connected' : (Date.now() - seen < ONLINE_MS ? 'online' : 'offline') };
  };

  const heartbeatLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: envInt('DVR_HEARTBEATS_PER_HOUR', 120), standardHeaders: true, legacyHeaders: false,
    keyGenerator: req => hashToken(req.headers['x-bridge-token']) || clientIp(req),
    message: { error: 'Too many heartbeats - slow down' }
  });

  // Owner creates a bridge. The token is shown only in this response.
  app.post('/api/dvr/register', auth, requirePro, wrap(async (req, res) => {
    const uid = req.user.uid, b = req.body || {};
    const existing = await db.collection('dvr_bridges').where('uid', '==', uid).limit(20).get();
    const max = envInt('DVR_MAX_BRIDGES', 5);
    if (existing.size >= max) throw httpError(403, `Maximum ${max} bridges reached`);
    const name = String(b.name || `Bridge ${existing.size + 1}`).trim().slice(0, 80);
    let cameraIds = [];
    if (Array.isArray(b.cameraIds) && b.cameraIds.length) {
      const ids = [...new Set(b.cameraIds.map(String))].slice(0, 64);
      const snaps = await db.getAll(...ids.map(id => db.collection('cameras').doc(id)));
      cameraIds = snaps.filter(s => s.exists && s.data().uid === uid).map(s => s.id);
    }
    const token = 'dvr_' + crypto.randomBytes(24).toString('hex');
    const ref = await db.collection('dvr_bridges').add({ uid, name, tokenHash: hashToken(token), cameraIds, created: Date.now(), lastSeen: null, health: null });
    res.json({ success: true, id: ref.id, name, token, note: 'Save this token now. It will not be shown again.' });
  }));

  // Called by the bridge program. No login: the token is the key.
  // Body: { version, cameras: [{ cameraId, online }] }. Cameras that are online get fresh health, so the
  // camera-health cron raises "Camera Offline" for channels that stop reporting.
  app.post('/api/dvr/heartbeat', heartbeatLimiter, wrap(async (req, res) => {
    const token = String(req.headers['x-bridge-token'] || '');
    if (!TOKEN_RE.test(token)) throw httpError(401, 'Unauthorized');
    const found = await db.collection('dvr_bridges').where('tokenHash', '==', hashToken(token)).limit(1).get();
    if (found.empty) throw httpError(401, 'Unauthorized');
    const bridgeRef = found.docs[0].ref, bridge = found.docs[0].data(), uid = bridge.uid;
    const u = (await db.collection('users').doc(uid).get()).data();
    if (!u || u.deleteRequestedAt) throw httpError(403, 'Account is not active');
    if (!planActive(u)) throw httpError(403, 'Active subscription required');

    const b = req.body || {}, now = Date.now();
    const list = (Array.isArray(b.cameras) ? b.cameras : []).filter(c => c && c.cameraId).slice(0, 64);
    let updated = 0;
    if (list.length) {
      const snaps = await db.getAll(...list.map(c => db.collection('cameras').doc(String(c.cameraId))));
      const batch = db.batch();
      snaps.forEach((s, i) => {
        if (!s.exists || s.data().uid !== uid) return;
        if (list[i].online === true || list[i].online === 'true') {
          batch.update(s.ref, { health: { battery: null, charging: false, storageFreeMb: null, network: 'wifi', updatedAt: now } });
          updated++;
        }
      });
      if (updated) await batch.commit();
    }
    await bridgeRef.update({ lastSeen: now, version: String(b.version || '').slice(0, 20), health: { reported: list.length, online: updated } });
    res.json({ success: true, serverTime: now, camerasUpdated: updated });
  }));

  app.get('/api/dvr/list', auth, wrap(async (req, res) => {
    const snap = await db.collection('dvr_bridges').where('uid', '==', req.user.uid).limit(20).get();
    res.json({ count: snap.size, bridges: snap.docs.map(publicBridge) });
  }));

  app.delete('/api/dvr/:id', auth, wrap(async (req, res) => {
    const ref = db.collection('dvr_bridges').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== req.user.uid) throw httpError(404, 'Bridge not found');
    await ref.delete();
    res.json({ success: true });
  }));
};