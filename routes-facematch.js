'use strict';
// Consent-based face matching (OpenCV YuNet + SFace, run by the Python service).
// A face photo becomes a 128-number template. Only the template is stored, encrypted per customer; the photo is never saved.
// It can only match people who were added with their consent. It is a helper, not proof of identity.
const FormData = require('form-data');

module.exports = function register(app, core) {
  const {
    PYTHON_AI_URL, PYTHON_SECRET, auth, db, decryptBuffer, encryptText, envInt, fetch, getTime,
    httpError, requirePro, upload, userLimiter, wrap
  } = core;

  const MATCH_MIN = parseFloat(process.env.FACE_MATCH_MIN) || 0.363;      // cosine score published for SFace as "same person"
  const CONFIRM_BELOW = parseFloat(process.env.FACE_CONFIRM_BELOW) || 0.5; // below this, a human must confirm
  const MAX_PEOPLE = envInt('FACE_MAX_PER_USER', 50);

  async function embedPhoto(file) {
    const form = new FormData();
    form.append('file', file.buffer, { filename: 'face.jpg', contentType: file.mimetype || 'image/jpeg' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), envInt('PYTHON_TIMEOUT_SEC', 60) * 1000);
    try {
      const r = await fetch(`${PYTHON_AI_URL}/face/embed`, {
        method: 'POST', body: form, headers: { 'X-CORE-SECRET': PYTHON_SECRET, ...form.getHeaders() }, signal: controller.signal
      });
      let data = {};
      try { data = await r.json(); } catch (e) { /* not JSON */ }
      if (r.status === 503) throw httpError(502, 'Face service is not ready, try again in a minute');
      if (r.status === 400) throw httpError(400, data.error || 'Could not read the photo');
      if (!r.ok) throw httpError(502, 'Face service error');
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw httpError(502, 'Face service timeout - it may be waking up, retry in a minute');
      if (!e.status) throw httpError(502, 'Face service unreachable');
      throw e;
    } finally { clearTimeout(timer); }
  }

  const validVector = v => Array.isArray(v) && v.length === 128 && v.every(x => typeof x === 'number' && Number.isFinite(x));
  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
  }

  // Add a person with their consent (one clear face in the photo).
  app.post('/api/facematch/enroll', auth, requirePro, userLimiter(30), upload.single('face'), wrap(async (req, res) => {
    if (!req.file) throw httpError(400, 'NO_FACE');
    if (req.body.consent !== 'true' && req.body.consent !== true) throw httpError(400, 'Consent of the person is required');
    const name = String(req.body.name || '').trim().slice(0, 80);
    if (!name) throw httpError(400, 'name required');
    const uid = req.user.uid;
    const existing = await db.collection('faces').where('uid', '==', uid).limit(MAX_PEOPLE + 1).get();
    if (existing.size >= MAX_PEOPLE) throw httpError(403, `Limit of ${MAX_PEOPLE} people reached`);
    const out = await embedPhoto(req.file);
    if (!out.count) throw httpError(400, 'No clear face found. Use a bright, front-facing photo.');
    if (out.count > 1) throw httpError(400, 'Please use a photo with only one face.');
    const vec = out.faces[0].embedding;
    if (!validVector(vec)) throw httpError(502, 'Face service returned an unexpected answer');
    const wt = getTime(req.body.timezone);
    const ref = await db.collection('faces').add({
      uid, name, nameLower: name.toLowerCase(), role: String(req.body.role || 'staff').slice(0, 40),
      purpose: String(req.body.purpose || 'Staff attendance').slice(0, 100), consent: true, consentTimestamp: wt.utcExact,
      embEnc: encryptText(JSON.stringify(vec), uid), embModel: 'sface-2021dec', path: null, size: 0, created: wt.ts
    });
    res.json({ success: true, id: ref.id });
  }));

  // Compare a photo with the people added by this customer.
  app.post('/api/facematch/identify', auth, requirePro, userLimiter(60), upload.single('face'), wrap(async (req, res) => {
    if (!req.file) throw httpError(400, 'NO_FACE');
    const uid = req.user.uid;
    const snap = await db.collection('faces').where('uid', '==', uid).limit(200).get();
    const known = [];
    snap.docs.forEach(d => {
      const x = d.data();
      if (!x.embEnc) return;
      try {
        const vec = JSON.parse(decryptBuffer(Buffer.from(x.embEnc, 'base64'), uid).toString('utf8'));
        if (validVector(vec)) known.push({ id: d.id, name: x.name, role: x.role, vec });
      } catch (e) { /* skip an unreadable template */ }
    });
    if (!known.length) throw httpError(400, 'No people added yet. Add a person with their consent first.');
    const out = await embedPhoto(req.file);
    if (!out.count) return res.json({ facesFound: 0, results: [], message: 'No clear face found in this photo' });
    const results = out.faces.map(f => {
      let best = null, bestScore = -1;
      for (const k of known) {
        const s = cosine(f.embedding, k.vec);
        if (s > bestScore) { bestScore = s; best = k; }
      }
      const matched = !!best && bestScore >= MATCH_MIN;
      return {
        box: f.box, matched, score: Math.round(bestScore * 1000) / 1000,
        askConfirm: matched && bestScore < CONFIRM_BELOW,
        person: matched ? { id: best.id, name: best.name, role: best.role } : null
      };
    });
    res.json({
      facesFound: results.length, results,
      note: 'This is a helper, not proof of identity. A person should confirm before any action is taken.'
    });
  }));

  app.get('/api/facematch/list', auth, wrap(async (req, res) => {
    const snap = await db.collection('faces').where('uid', '==', req.user.uid).limit(200).get();
    const people = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.embEnc)
      .map(x => ({ id: x.id, name: x.name, role: x.role, purpose: x.purpose, created: x.created }));
    res.json({ count: people.length, people });
  }));

  app.delete('/api/facematch/:id', auth, wrap(async (req, res) => {
    const ref = db.collection('faces').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== req.user.uid) throw httpError(404, 'Not found');
    await ref.delete();
    res.json({ success: true, message: 'Face data erased' });
  }));
};