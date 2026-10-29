'use strict';
// routes-watch.js - Secure Assistant "watch" tools that follow things from one camera frame to the next.
// Tools in this file:
//   1. Unattended Baggage - a bag with nobody near it for a while.
//   2. Loitering Detection - a person staying in one small area for a long time.
//   3. Person Down (possible fall) - a person lying on the floor, not moving, for a while. Must be asked for with tools=down.
//
// How it works:
//  1. The camera phone sends one frame every few seconds to POST /api/watch/frame.
//  2. The Python service (YOLO) says where the people and bags are in that frame.
//  3. For every bag and person we keep a small note in Firestore (collection watch_state): position and times only.
//     No photo is saved and no face is looked at, so nobody is identified.
//  4. When a bag or a person fits the rule for long enough, ONE alert is sent through the normal alert system.
//
// Limits to remember:
//  - It is a helper, not a guarantee. A person the camera could not see, or someone standing at a counter, can give a wrong alert.
//  - Loitering follows positions, not faces. If one person leaves and another stands in the same spot within about a minute,
//    they are counted as the same person.
//  - Staff who always stand in one place will trigger Loitering. Send a "zone" that covers only the area you care about.
//  - Person Down looks at the SHAPE of the person (wider than tall) and whether they stay still. It cannot tell a fall from someone
//    sleeping, stretching or sitting sideways, and it can miss a fall that the camera could not see. It is NOT a medical device.
//    Use a zone that covers floor areas where nobody should be lying down (not beds, sofas or play areas).
const FormData = require('form-data');

module.exports = function register(app, core) {
  const { PYTHON_AI_URL, PYTHON_SECRET, auth, createAlert, db, envInt, fetch, httpError, requirePro, upload, wrap } = core;

  // Unattended baggage settings
  const BAG_ALONE_SECONDS = envInt('BAG_ALONE_SECONDS', 180);                 // bag with nobody near it for this long -> alert
  const BAG_MIN_FRAMES = envInt('BAG_MIN_FRAMES', 3);                         // and it must be seen alone in at least this many frames
  const BAG_KEEP_MISSING_SEC = envInt('BAG_KEEP_MISSING_SEC', 90);            // keep a bag note this long after the bag was last seen
  const BAG_MATCH_DIST = parseFloat(process.env.BAG_MATCH_DIST) || 0.08;      // same bag if it moved less than this (fraction of the picture)

  // Loitering settings
  const LOITER_SECONDS = envInt('LOITER_SECONDS', 300);                       // person in the same small area for this long -> alert
  const LOITER_MIN_FRAMES = envInt('LOITER_MIN_FRAMES', 3);                   // and seen there in at least this many frames
  const LOITER_RADIUS = parseFloat(process.env.LOITER_RADIUS) || 0.08;       // "same place" = moved less than this (fraction of the picture)
  const PERSON_MATCH_DIST = parseFloat(process.env.PERSON_MATCH_DIST) || 0.15; // same person if the foot point moved less than this between frames
  const PERSON_KEEP_MISSING_SEC = envInt('PERSON_KEEP_MISSING_SEC', 60);      // keep a person note this long after the person was last seen

  // Person down (possible fall) settings
  const DOWN_SECONDS = envInt('DOWN_SECONDS', 60);                            // person lying still for this long -> alert
  const DOWN_MIN_FRAMES = envInt('DOWN_MIN_FRAMES', 3);                       // and seen lying in at least this many frames
  const DOWN_RATIO = parseFloat(process.env.DOWN_RATIO) || 1.3;              // lying = person box at least this much wider than tall
  const DOWN_MIN_WIDTH = parseFloat(process.env.DOWN_MIN_WIDTH) || 0.10;     // ignore very small (far away) people: box width as a fraction of the picture
  const DOWN_RADIUS = parseFloat(process.env.DOWN_RADIUS) || 0.10;           // "same place" = centre moved less than this
  const DOWN_KEEP_MISSING_SEC = envInt('DOWN_KEEP_MISSING_SEC', 45);          // keep a note this long after the person was last seen lying

  // General settings
  const WATCH_MIN_GAP_SEC = envInt('WATCH_MIN_GAP_SEC', 3);                   // frames from one camera must be at least this far apart
  const WATCH_MAX_PER_MIN = envInt('WATCH_MAX_PER_MIN', 30);                  // frames per minute for one customer
  const MAX_ALERTS_PER_HOUR = envInt('WATCH_MAX_ALERTS_PER_HOUR', 10);        // alerts per camera per hour, so the owner is not flooded
  const MAX_BAG_TRACKS = 20;
  const MAX_PERSON_TRACKS = 30;
  const MAX_DOWN_TRACKS = 10;

  const CAMERA_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const BAG_LABELS = new Set(['backpack', 'handbag', 'suitcase']);
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  // Simple per-customer speed limit (kept in memory; it resets if the server restarts).
  const recent = new Map();
  function checkSpeed(uid, now) {
    let r = recent.get(uid);
    if (!r || now - r.start > 60000) { r = { start: now, count: 0 }; recent.set(uid, r); }
    r.count += 1;
    if (r.count > WATCH_MAX_PER_MIN) throw httpError(429, 'Too many frames. Send fewer frames per minute.');
    if (recent.size > 5000) { for (const [k, v] of recent) { if (now - v.start > 60000) recent.delete(k); } }
  }

  async function detectBoxes(file) {
    const form = new FormData();
    form.append('file', file.buffer, { filename: 'frame.jpg', contentType: file.mimetype || 'image/jpeg' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), envInt('PYTHON_TIMEOUT_SEC', 60) * 1000);
    try {
      const r = await fetch(`${PYTHON_AI_URL}/detect/boxes`, {
        method: 'POST', body: form, headers: { 'X-CORE-SECRET': PYTHON_SECRET, ...form.getHeaders() }, signal: controller.signal
      });
      let data = {};
      try { data = await r.json(); } catch (e) { /* not JSON */ }
      if (r.status === 503) throw httpError(502, 'AI service is not ready, try again in a minute');
      if (r.status === 400) throw httpError(400, data.error || 'Could not read the frame');
      if (!r.ok) throw httpError(502, 'AI service error');
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw httpError(502, 'AI service timeout - it may be waking up, retry in a minute');
      if (!e.status) throw httpError(502, 'AI service unreachable');
      throw e;
    } finally { clearTimeout(timer); }
  }

  function parseTools(value) {
    const list = String(value || 'bag,loiter').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!list.length || list.some(t => t !== 'bag' && t !== 'loiter' && t !== 'down')) throw httpError(400, 'tools must be bag, loiter, down or a mix such as bag,loiter (default is bag,loiter)');
    return { bag: list.includes('bag'), loiter: list.includes('loiter'), down: list.includes('down') };
  }

  // zone = "x1,y1,x2,y2" as fractions of the picture (0 to 1). Loitering and Person Down are only checked inside it.
  function parseZone(value) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const p = String(value).split(',').map(s => Number(s.trim()));
    const bad = p.length !== 4 || p.some(n => !Number.isFinite(n)) || p[0] < 0 || p[1] < 0 || p[2] > 1 || p[3] > 1 || p[0] >= p[2] || p[1] >= p[3];
    if (bad) throw httpError(400, 'zone must be four numbers between 0 and 1 as x1,y1,x2,y2 (left, top, right, bottom)');
    return p;
  }

  const validBox = b => Array.isArray(b) && b.length === 4 && b.every(x => typeof x === 'number' && Number.isFinite(x));
  const centerOf = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

  // A bag counts as "with someone" when its centre is inside, or just beside, a person's box.
  function isAttended(bagBox, personBoxes) {
    const [cx, cy] = centerOf(bagBox);
    for (const p of personBoxes) {
      const w = p[2] - p[0], h = p[3] - p[1];
      const mx = Math.max(0.05, w * 0.5), my = Math.max(0.05, h * 0.15);
      if (cx >= p[0] - mx && cx <= p[2] + mx && cy >= p[1] - my && cy <= p[3] + my) return true;
    }
    return false;
  }

  // Match the items in this frame with the notes made before (nearest first). Every note and item has x and y.
  function matchTracks(tracks, items, maxDist) {
    const pairs = [];
    tracks.forEach((t, ti) => items.forEach((b, bi) => {
      const d = Math.hypot(t.x - b.x, t.y - b.y);
      if (d <= maxDist) pairs.push({ ti, bi, d });
    }));
    pairs.sort((a, b) => a.d - b.d);
    const usedT = new Set(), usedB = new Set(), matched = [];
    for (const p of pairs) {
      if (usedT.has(p.ti) || usedB.has(p.bi)) continue;
      usedT.add(p.ti); usedB.add(p.bi); matched.push(p);
    }
    return { matched, usedT, usedB };
  }

  // Send one frame from a camera.
  // Form fields: frame (the picture), cameraId, optional tools (any of bag, loiter, down, separated by commas; default "bag,loiter"),
  // aloneSeconds (30 to 1800), loiterSeconds (30 to 3600), downSeconds (15 to 1800), zone ("x1,y1,x2,y2" for loitering and person down).
  app.post('/api/watch/frame', auth, requirePro, upload.single('frame'), wrap(async (req, res) => {
    if (!req.file) throw httpError(400, 'NO_FRAME');
    const cameraId = String(req.body.cameraId || '').trim();
    if (!CAMERA_RE.test(cameraId)) throw httpError(400, 'cameraId is required (letters, numbers, - and _ only)');
    const tools = parseTools(req.body.tools);
    const zone = parseZone(req.body.zone);
    const aloneSec = clamp(parseInt(req.body.aloneSeconds, 10) || BAG_ALONE_SECONDS, 30, 1800);
    const loiterSec = clamp(parseInt(req.body.loiterSeconds, 10) || LOITER_SECONDS, 30, 3600);
    const downSec = clamp(parseInt(req.body.downSeconds, 10) || DOWN_SECONDS, 15, 1800);
    const uid = req.user.uid;
    const now = Date.now();
    checkSpeed(uid, now);

    const ref = db.collection('watch_state').doc(`${uid}__${cameraId}`);
    const snap = await ref.get();
    const state = snap.exists ? (snap.data() || {}) : {};
    if (state.lastFrameMs && now - state.lastFrameMs < WATCH_MIN_GAP_SEC * 1000) throw httpError(429, 'Frames are coming too fast for this camera');

    const out = await detectBoxes(req.file);
    const objects = Array.isArray(out.objects) ? out.objects.filter(o => o && validBox(o.box)) : [];
    const byConfidence = (a, b) => (b.confidence || 0) - (a.confidence || 0);

    const personObjs = objects.filter(o => o.label === 'person').sort(byConfidence).slice(0, MAX_PERSON_TRACKS);
    const personBoxes = personObjs.map(o => o.box);

    const alertLog = (Array.isArray(state.alertLog) ? state.alertLog : []).filter(ms => now - ms < 3600000);
    let suppressed = 0;
    // Sends one alert for a group of notes. It is marked as sent only if the alert system accepted it, so a failure is tried again on the next frame.
    async function raise(alertType, message, group) {
      if (!group.length) return false;
      if (alertLog.length >= MAX_ALERTS_PER_HOUR) { group.forEach(t => { t.alerted = true; }); suppressed += group.length; return false; }
      try {
        if (typeof createAlert !== 'function') throw new Error('createAlert is not available');
        await createAlert(uid, req.userDoc || {}, { alertType, message });
        alertLog.push(now);
        group.forEach(t => { t.alerted = true; t.alertedMs = now; });
        return true;
      } catch (e) {
        console.error(`[watch] ${alertType} alert failed:`, e.message);
        return false;
      }
    }

    // ---------- Unattended baggage ----------
    let bagTracks = Array.isArray(state.bagTracks) ? state.bagTracks : [];
    let bagsSeen = 0, bagAlertSent = false;
    if (tools.bag) {
      const bags = objects.filter(o => BAG_LABELS.has(o.label)).sort(byConfidence).slice(0, MAX_BAG_TRACKS).map(o => {
        const [x, y] = centerOf(o.box);
        return { label: o.label, x, y, attended: isAttended(o.box, personBoxes) };
      });
      bagsSeen = bags.length;
      const { matched, usedT, usedB } = matchTracks(bagTracks, bags, BAG_MATCH_DIST);
      const next = [], toAlert = [];
      const updateBag = (t, b) => {
        const track = { ...t, label: b.label, x: b.x, y: b.y, lastSeenMs: now };
        if (b.attended) {
          track.aloneSinceMs = null; track.aloneFrames = 0; track.alerted = false;
        } else {
          if (!track.aloneSinceMs) track.aloneSinceMs = now;
          track.aloneFrames = (track.aloneFrames || 0) + 1;
          if (!track.alerted && track.aloneFrames >= BAG_MIN_FRAMES && now - track.aloneSinceMs >= aloneSec * 1000) toAlert.push(track);
        }
        return track;
      };
      for (const m of matched) next.push(updateBag(bagTracks[m.ti], bags[m.bi]));
      bags.forEach((b, bi) => {
        if (!usedB.has(bi)) next.push(updateBag({ firstSeenMs: now, aloneSinceMs: null, aloneFrames: 0, alerted: false }, b));
      });
      bagTracks.forEach((t, ti) => {
        if (!usedT.has(ti) && now - (t.lastSeenMs || 0) <= BAG_KEEP_MISSING_SEC * 1000) next.push(t); // not seen this time, keep the note for a while
      });
      bagTracks = next.slice(0, MAX_BAG_TRACKS);
      const mins = Math.max(1, Math.round(aloneSec / 60));
      const what = toAlert.length > 1 ? `${toAlert.length} bags have` : 'A bag has';
      bagAlertSent = await raise('Unattended Baggage', `${what} been left alone for about ${mins} minute(s) on camera ${cameraId}. Please check.`, toAlert);
    }

    // ---------- Loitering ----------
    let personTracks = Array.isArray(state.personTracks) ? state.personTracks : [];
    let loiterAlertSent = false;
    if (tools.loiter) {
      // The foot point (bottom middle of the person) is steadier than the centre of the box.
      const people = personObjs.map(o => ({ x: (o.box[0] + o.box[2]) / 2, y: o.box[3] }))
        .filter(p => !zone || (p.x >= zone[0] && p.x <= zone[2] && p.y >= zone[1] && p.y <= zone[3]));
      const { matched, usedT, usedB } = matchTracks(personTracks, people, PERSON_MATCH_DIST);
      const next = [], toAlert = [];
      const updatePerson = (t, p) => {
        const track = { ...t, x: p.x, y: p.y, lastSeenMs: now };
        if (Math.hypot(p.x - t.ax, p.y - t.ay) > LOITER_RADIUS) {   // moved away: start counting again from here
          track.ax = p.x; track.ay = p.y; track.staySinceMs = now; track.stayFrames = 1; track.alerted = false;
        } else {
          track.stayFrames = (t.stayFrames || 0) + 1;
          if (!track.alerted && track.stayFrames >= LOITER_MIN_FRAMES && now - track.staySinceMs >= loiterSec * 1000) toAlert.push(track);
        }
        return track;
      };
      for (const m of matched) next.push(updatePerson(personTracks[m.ti], people[m.bi]));
      people.forEach((p, pi) => {
        if (!usedB.has(pi)) next.push({ x: p.x, y: p.y, ax: p.x, ay: p.y, firstSeenMs: now, lastSeenMs: now, staySinceMs: now, stayFrames: 1, alerted: false });
      });
      personTracks.forEach((t, ti) => {
        if (!usedT.has(ti) && now - (t.lastSeenMs || 0) <= PERSON_KEEP_MISSING_SEC * 1000) next.push(t);
      });
      personTracks = next.slice(0, MAX_PERSON_TRACKS);
      const mins = Math.max(1, Math.round(loiterSec / 60));
      const who = toAlert.length > 1 ? `${toAlert.length} people have` : 'A person has';
      loiterAlertSent = await raise('Loitering', `${who} stayed in the same place for about ${mins} minute(s) on camera ${cameraId}. Please check.`, toAlert);
    }

    // ---------- Person down (possible fall) ----------
    let downTracks = Array.isArray(state.downTracks) ? state.downTracks : [];
    let downAlertSent = false, peopleLying = 0;
    if (tools.down) {
      const shape = o => { const w = o.box[2] - o.box[0], h = o.box[3] - o.box[1]; return { w, h, lying: h > 0 && w >= DOWN_MIN_WIDTH && w / h >= DOWN_RATIO }; };
      const lying = personObjs.filter(o => {
        if (!shape(o).lying) return false;
        const [cx, cy] = centerOf(o.box);
        return !zone || (cx >= zone[0] && cx <= zone[2] && cy >= zone[1] && cy <= zone[3]);
      }).map(o => { const [x, y] = centerOf(o.box); return { x, y }; });
      const upright = personObjs.filter(o => { const sh = shape(o); return sh.h > 0 && sh.w / sh.h < DOWN_RATIO; }).map(o => centerOf(o.box));
      peopleLying = lying.length;
      const { matched, usedT, usedB } = matchTracks(downTracks, lying, PERSON_MATCH_DIST);
      const next = [], toAlert = [];
      const updateDown = (t, p) => {
        const track = { ...t, x: p.x, y: p.y, lastSeenMs: now };
        if (Math.hypot(p.x - t.ax, p.y - t.ay) > DOWN_RADIUS) {   // moved: start counting again from here
          track.ax = p.x; track.ay = p.y; track.downSinceMs = now; track.downFrames = 1; track.alerted = false;
        } else {
          track.downFrames = (t.downFrames || 0) + 1;
          if (!track.alerted && track.downFrames >= DOWN_MIN_FRAMES && now - track.downSinceMs >= downSec * 1000) toAlert.push(track);
        }
        return track;
      };
      for (const m of matched) next.push(updateDown(downTracks[m.ti], lying[m.bi]));
      lying.forEach((p, pi) => {
        if (!usedB.has(pi)) next.push({ x: p.x, y: p.y, ax: p.x, ay: p.y, firstSeenMs: now, lastSeenMs: now, downSinceMs: now, downFrames: 1, alerted: false });
      });
      downTracks.forEach((t, ti) => {
        if (usedT.has(ti)) return;
        const gotUp = upright.some(c => Math.hypot(c[0] - t.x, c[1] - t.y) <= PERSON_MATCH_DIST);   // someone standing there now: they got up
        if (!gotUp && now - (t.lastSeenMs || 0) <= DOWN_KEEP_MISSING_SEC * 1000) next.push(t);
      });
      downTracks = next.slice(0, MAX_DOWN_TRACKS);
      const howLong = downSec < 90 ? `${downSec} seconds` : `${Math.round(downSec / 60)} minute(s)`;
      const who = toAlert.length > 1 ? `${toAlert.length} people have` : 'A person has';
      downAlertSent = await raise('Person Down', `${who} been lying on the floor without moving for about ${howLong} on camera ${cameraId}. This may be a fall. Please check at once.`, toAlert);
    }

    await ref.set({ uid, cameraId, bagTracks, personTracks, downTracks, alertLog, lastFrameMs: now, updated: now, expiresAt: new Date(now + 2 * 86400000) });

    res.json({
      tools: Object.keys(tools).filter(k => tools[k]),
      peopleSeen: personObjs.length,
      bagsSeen,
      bagsAlone: bagTracks.filter(t => t.aloneSinceMs).length,
      peopleLying,
      alertSent: bagAlertSent || loiterAlertSent || downAlertSent,
      alerts: { bag: bagAlertSent, loiter: loiterAlertSent, down: downAlertSent },
      alertsHeldBack: suppressed,
      note: 'This is a helper, not a guarantee. Please check the camera yourself.'
    });
  }));

  // What the app is following on one camera right now (no picture is needed).
  app.get('/api/watch/state/:cameraId', auth, wrap(async (req, res) => {
    const cameraId = String(req.params.cameraId || '');
    if (!CAMERA_RE.test(cameraId)) throw httpError(400, 'Invalid cameraId');
    const snap = await db.collection('watch_state').doc(`${req.user.uid}__${cameraId}`).get();
    if (!snap.exists) return res.json({ cameraId, bags: [], people: [], down: [] });
    const d = snap.data() || {};
    const now = Date.now();
    const secs = ms => Math.max(0, Math.round((now - ms) / 1000));
    res.json({
      cameraId,
      bags: (d.bagTracks || []).map(t => ({ label: t.label, seenSeconds: secs(t.firstSeenMs || now), aloneSeconds: t.aloneSinceMs ? secs(t.aloneSinceMs) : 0, alerted: !!t.alerted })),
      people: (d.personTracks || []).map(t => ({ seenSeconds: secs(t.firstSeenMs || now), stayingSeconds: secs(t.staySinceMs || now), alerted: !!t.alerted })),
      down: (d.downTracks || []).map(t => ({ seenSeconds: secs(t.firstSeenMs || now), lyingSeconds: secs(t.downSinceMs || now), alerted: !!t.alerted }))
    });
  }));

  // Forget everything noted about one camera.
  app.delete('/api/watch/state/:cameraId', auth, wrap(async (req, res) => {
    const cameraId = String(req.params.cameraId || '');
    if (!CAMERA_RE.test(cameraId)) throw httpError(400, 'Invalid cameraId');
    await db.collection('watch_state').doc(`${req.user.uid}__${cameraId}`).delete();
    res.json({ success: true });
  }));
};