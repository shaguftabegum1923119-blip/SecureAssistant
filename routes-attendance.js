'use strict';
// Staff attendance by selfie check-in (Beta).
// How it works:
//  1. A person who was added with consent (Face Matching) takes a selfie in the app and taps "Check in" or "Check out".
//  2. The photo is turned into a 128-number template by the Python service and compared with the people the customer added.
//  3. Only the name, "in" or "out", and the time are saved. The selfie itself is never saved.
//  4. Records are removed automatically after ATTENDANCE_KEEP_DAYS days (default 90) and when the account is deleted.
// It is a helper, not proof of identity. A photo of a photo can fool it (there is no live-person check yet),
// so a person should confirm anything important. Only the account owner can read the reports.
const FormData = require('form-data');

module.exports = function register(app, core) {
  const {
    DAY_MS, PYTHON_AI_URL, PYTHON_SECRET, auth, db, decryptBuffer, envInt, fetch, httpError, localParts,
    recentDocs, requirePro, upload, userLimiter, wrap
  } = core;

  const MATCH_MIN = parseFloat(process.env.FACE_MATCH_MIN) || 0.363;
  const CONFIRM_BELOW = parseFloat(process.env.FACE_CONFIRM_BELOW) || 0.5;
  const KEEP_DAYS = Math.max(7, Math.min(730, envInt('ATTENDANCE_KEEP_DAYS', 90)));
  const MIN_GAP_MS = envInt('ATTENDANCE_MIN_GAP_MIN', 10) * 60 * 1000;
  const MAX_RANGE_DAYS = 31;
  const NOTE = 'This is a helper, not proof of identity. A person should confirm anything important.';

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
  const round3 = n => Math.round(n * 1000) / 1000;
  const cleanTz = tz => { const t = String(tz || 'UTC').slice(0, 60); try { new Intl.DateTimeFormat('en-GB', { timeZone: t }); return t; } catch (e) { return 'UTC'; } };
  const clockText = (ms, tz) => { try { return new Date(ms).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }); } catch (e) { return new Date(ms).toISOString().slice(11, 16) + ' UTC'; } };

  // People added with consent, with their decrypted templates (kept only in memory for this request).
  async function loadPeople(uid, withTemplates) {
    const snap = await db.collection('faces').where('uid', '==', uid).limit(200).get();
    const people = [];
    snap.docs.forEach(d => {
      const x = d.data();
      if (!x.embEnc || x.consent !== true) return;
      const p = { id: d.id, name: x.name, role: x.role, lastInAt: x.lastInAt || 0, lastOutAt: x.lastOutAt || 0 };
      if (withTemplates) {
        try {
          const vec = JSON.parse(decryptBuffer(Buffer.from(x.embEnc, 'base64'), uid).toString('utf8'));
          if (!validVector(vec)) return;
          p.vec = vec;
        } catch (e) { return; /* skip an unreadable template */ }
      }
      people.push(p);
    });
    return people;
  }

  // One line per person per day: first "in", last "out", and the minutes between them.
  function summarize(records, tz) {
    const map = new Map();
    for (const r of records) {
      const key = r.date + '|' + r.personId;
      let e = map.get(key);
      if (!e) { e = { date: r.date, personId: r.personId, name: r.name, firstInMs: null, lastOutMs: null, punches: 0 }; map.set(key, e); }
      e.punches++;
      if (r.type === 'in') { if (e.firstInMs === null || r.ts < e.firstInMs) e.firstInMs = r.ts; }
      else if (e.lastOutMs === null || r.ts > e.lastOutMs) e.lastOutMs = r.ts;
    }
    return [...map.values()].map(e => {
      const both = e.firstInMs !== null && e.lastOutMs !== null && e.lastOutMs > e.firstInMs;
      return {
        date: e.date, personId: e.personId, name: e.name, punches: e.punches,
        firstIn: e.firstInMs === null ? null : clockText(e.firstInMs, tz),
        lastOut: e.lastOutMs === null ? null : clockText(e.lastOutMs, tz),
        minutesPresent: both ? Math.round((e.lastOutMs - e.firstInMs) / 60000) : null,
        status: e.firstInMs === null ? 'out_only' : (e.lastOutMs === null ? 'checked_in' : 'complete')
      };
    }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.name).localeCompare(String(b.name))));
  }

  // Check in or out with a selfie.
  app.post('/api/attendance/checkin', auth, requirePro, userLimiter(envInt('ATTENDANCE_MAX_PER_HOUR', 200)), upload.single('face'), wrap(async (req, res) => {
    if (!req.file) throw httpError(400, 'NO_FACE');
    const type = String(req.body.type || 'in').toLowerCase();
    if (type !== 'in' && type !== 'out') throw httpError(400, 'type must be "in" or "out"');
    const uid = req.user.uid;
    const known = await loadPeople(uid, true);
    if (!known.length) throw httpError(400, 'No people added yet. Add a person with their consent first.');

    const out = await embedPhoto(req.file);
    if (!out.count) return res.json({ recorded: false, matched: false, message: 'No clear face found. Use a bright, front-facing photo.' });
    if (out.count > 1) return res.json({ recorded: false, matched: false, message: 'Only one person at a time, please.' });
    const face = out.faces[0];
    if (!face || !validVector(face.embedding)) throw httpError(502, 'Face service returned an unexpected answer');

    let best = null, bestScore = -1;
    for (const k of known) {
      const s = cosine(face.embedding, k.vec);
      if (s > bestScore) { bestScore = s; best = k; }
    }
    if (!best || bestScore < MATCH_MIN) {
      return res.json({ recorded: false, matched: false, message: 'This face is not in the list of added people.', note: NOTE });
    }
    const needsConfirm = bestScore < CONFIRM_BELOW;
    if (needsConfirm && String(req.body.confirmPersonId || '') !== best.id) {
      return res.json({
        recorded: false, matched: true, needsConfirm: true, person: { id: best.id, name: best.name },
        message: 'Not fully sure. Ask the person to confirm, then send the photo again with confirmPersonId.', note: NOTE
      });
    }

    const ts = Date.now();
    const lastTs = type === 'in' ? best.lastInAt : best.lastOutAt;
    if (lastTs && ts - lastTs < MIN_GAP_MS) {
      return res.json({ recorded: false, matched: true, duplicate: true, person: { id: best.id, name: best.name }, message: `Already marked ${type} a moment ago.` });
    }

    const tz = cleanTz(req.body.timezone || (req.userDoc && req.userDoc.timezone));
    const lp = localParts(ts, tz);
    const ref = await db.collection('attendance').add({
      uid, personId: best.id, name: best.name, type, ts, created: ts, date: lp.date, hour: lp.hour,
      score: round3(bestScore), confirmed: needsConfirm, expiresAt: new Date(ts + KEEP_DAYS * DAY_MS)
    });
    await db.collection('faces').doc(best.id).set(type === 'in' ? { lastInAt: ts } : { lastOutAt: ts }, { merge: true });
    res.json({
      recorded: true, id: ref.id, matched: true, person: { id: best.id, name: best.name }, type,
      date: lp.date, time: clockText(ts, tz), score: round3(bestScore), note: NOTE
    });
  }));

  // Today's check-ins, and who has not checked in yet.
  app.get('/api/attendance/today', auth, wrap(async (req, res) => {
    const uid = req.user.uid;
    const now = Date.now();
    const tz = cleanTz(req.query.timezone);
    const today = localParts(now, tz).date;
    const records = (await recentDocs('attendance', 'uid', uid, now - 2 * DAY_MS, 3000)).filter(r => r.date === today);
    const people = await loadPeople(uid, false);
    const rows = summarize(records, tz);
    const seen = new Set(records.filter(r => r.type === 'in').map(r => r.personId));
    res.json({
      date: today, timezone: tz, people: rows,
      notCheckedIn: people.filter(p => !seen.has(p.id)).map(p => ({ id: p.id, name: p.name }))
    });
  }));

  // Report for a date range (up to 31 days). Dates are YYYY-MM-DD in the given timezone.
  app.get('/api/attendance/report', auth, wrap(async (req, res) => {
    const uid = req.user.uid;
    const from = String(req.query.from || ''), to = String(req.query.to || '');
    const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
    if (!okDate(from) || !okDate(to)) throw httpError(400, 'from and to are required as YYYY-MM-DD');
    const fromMs = Date.parse(from + 'T00:00:00Z'), toMs = Date.parse(to + 'T00:00:00Z');
    if (toMs < fromMs) throw httpError(400, 'to must not be before from');
    if ((toMs - fromMs) / DAY_MS + 1 > MAX_RANGE_DAYS) throw httpError(400, `Choose at most ${MAX_RANGE_DAYS} days`);
    const tz = cleanTz(req.query.timezone);
    const personId = req.query.personId ? String(req.query.personId) : '';
    const records = (await recentDocs('attendance', 'uid', uid, fromMs - 2 * DAY_MS, 5000))
      .filter(r => r.date >= from && r.date <= to && (!personId || r.personId === personId));
    const days = summarize(records, tz);
    const totals = {};
    for (const d of days) {
      const t = totals[d.personId] || (totals[d.personId] = { personId: d.personId, name: d.name, daysPresent: 0, minutesPresent: 0 });
      t.daysPresent++;
      t.minutesPresent += d.minutesPresent || 0;
    }
    res.json({ from, to, timezone: tz, days, totals: Object.values(totals), note: NOTE });
  }));

  // Remove one record.
  app.delete('/api/attendance/record/:id', auth, wrap(async (req, res) => {
    const ref = db.collection('attendance').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== req.user.uid) throw httpError(404, 'Not found');
    await ref.delete();
    res.json({ success: true });
  }));

  // Remove every record of one person (for example when that person withdraws consent).
  app.delete('/api/attendance/person/:personId', auth, wrap(async (req, res) => {
    const uid = req.user.uid;
    let total = 0;
    for (let round = 0; round < 50; round++) {
      const snap = await db.collection('attendance').where('uid', '==', uid).where('personId', '==', req.params.personId).limit(300).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      total += snap.size;
    }
    res.json({ success: true, deleted: total });
  }));
};