'use strict';
// Shared setup and helpers: environment check, Firebase, security helpers, limits,
// price rules and storage rules.
// Every route file receives these through require('./core').
// SECURE ASSISTANT BACKEND - V15 (needs staticData.js and b2Storage.js in the same folder)
// Files are stored in Backblaze B2 through b2Storage.js. `bucket` below has the same calls the old Firebase bucket had.
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const multer = require('multer');
const Razorpay = require('razorpay');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const { LANGUAGES, COUNTRY_CODES, AGENTS, CATEGORIES, AI_TOOLS, LIVE_TOOL_NAMES, BETA_TOOL_NAMES, COMING_SOON_NAMES, CAMERA_METHODS, emergencyFor, STORAGE_PLANS } = require('./staticData');
const b2 = require('./b2Storage');

let RtcTokenBuilder, RtcRole;
try { ({ RtcTokenBuilder, RtcRole } = require('agora-token')); } catch (e) { /* checked at use */ }

// ---------- ENV CHECK ----------
const REQUIRED_ENV = [
  'B2_KEY_ID', 'B2_BUCKET', 'B2_ENDPOINT', 'B2_REGION', 'VAULT_MASTER_SECRET', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET', 'CRON_SECRET', 'PYTHON_SECRET', 'PYTHON_AI_URL', 'AGORA_APP_ID', 'AGORA_APP_CERT'
]; // ANTHROPIC_API_KEY is optional: without it only Abdul Wahab chat is off, everything else runs
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (!process.env.B2_KEY && !process.env.B2_APP_KEY) missing.push('B2_KEY');
if (!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 && !process.env.FIREBASE_SERVICE_ACCOUNT) missing.push('FIREBASE_SERVICE_ACCOUNT_BASE64');
if (missing.length) {
  console.error('MISSING ENV - cannot start:', missing.join(', '));
  process.exit(1);
}

const PORT = process.env.PORT || 10000;
const PYTHON_AI_URL = process.env.PYTHON_AI_URL;
const PYTHON_SECRET = process.env.PYTHON_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;
const VAULT_MASTER_SECRET = process.env.VAULT_MASTER_SECRET;
const BASE_BYTES = 5 * 1024 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- HELPERS ----------
const httpError = (status, message) => { const e = new Error(message); e.status = status; return e; };
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sanitizeFilename = n => (n || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
const num = (v, def = null) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
function safeCompare(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8'), bb = Buffer.from(String(b || ''), 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Price rule: total = number of cameras x the per-camera rate of their slab. Yearly = 11 months (1 month free).
function calcRate(c) { if (c <= 2) return 99; if (c <= 5) return 85; if (c <= 9) return 70; return 60; }
function getPrice(count, billingType) {
  count = Math.max(1, Math.min(1000, parseInt(count) || 1));
  const perCamera = calcRate(count);
  const monthly = count * perCamera;
  const yearly = monthly * 11;
  const type = String(billingType || 'monthly').toLowerCase() === 'yearly' ? 'yearly' : 'monthly';
  return { count, perCamera, effectivePerCamera: perCamera, monthly, yearly, billingType: type, payable: type === 'yearly' ? yearly : monthly, days: type === 'yearly' ? 365 : 30 };
}

function getTime(tz) {
  const now = new Date();
  let local;
  try { local = now.toLocaleString('en-GB', { timeZone: tz || 'UTC' }); } catch (e) { local = now.toLocaleString('en-GB', { timeZone: 'UTC' }); }
  return {
    ts: now.getTime(), utcExact: now.toISOString(), local,
    beforeExact: new Date(now.getTime() - 3 * 60 * 1000).toISOString(), // 3 min before
    afterExact: new Date(now.getTime() + 2 * 60 * 1000).toISOString()   // 2 min after
  };
}

// Same key derivation as before, so files already stored stay readable
const vaultKey = uid => crypto.createHash('sha256').update(VAULT_MASTER_SECRET + ':' + uid).digest();
function encryptBuffer(buf, uid) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', vaultKey(uid), iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}
function decryptBuffer(buf, uid) {
  const d = crypto.createDecipheriv('aes-256-gcm', vaultKey(uid), buf.slice(0, 12));
  d.setAuthTag(buf.slice(12, 28));
  return Buffer.concat([d.update(buf.slice(28)), d.final()]);
}
const encryptText = (text, uid) => encryptBuffer(Buffer.from(String(text), 'utf8'), uid).toString('base64');

// ---------- FIREBASE + RAZORPAY ----------
let db, bucket, authAdmin;
{
  let raw = (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || process.env.FIREBASE_SERVICE_ACCOUNT || '').trim().replace(/^["']|["']$/g, '').trim();
  if (raw.endsWith('.json')) raw = fs.readFileSync(path.resolve(raw), 'utf8');
  else if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf8');
  let sa = JSON.parse(raw.trim());
  if (typeof sa === 'string') sa = JSON.parse(sa);
  sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
  db = admin.firestore(); bucket = b2.bucket; authAdmin = admin.auth();
}
const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
const FV = admin.firestore.FieldValue;

const addUsage = async (uid, bytes) => {
  await db.collection('users').doc(uid).set({ storageUsed: FV.increment(bytes) }, { merge: true });
  checkStorageAlerts(uid); // runs in the background, never blocks or breaks the upload
};

// Tells the customer once when storage reaches 80% and once when it is full. The flags reset when usage drops below 80%.
async function checkStorageAlerts(uid) {
  try {
    const ref = db.collection('users').doc(uid);
    const u = (await ref.get()).data();
    if (!u) return;
    const limit = u.storageLimit || BASE_BYTES, used = u.storageUsed || 0;
    const pct = limit > 0 ? (used / limit) * 100 : 0;
    const flags = u.storageNotified || {};
    if (pct < 80) {
      if (flags.w80 || flags.full) await ref.set({ storageNotified: { w80: false, full: false } }, { merge: true });
      return;
    }
    const next = { w80: !!flags.w80, full: !!flags.full };
    if (pct >= 100 && !next.full) {
      await createAlert(uid, u, { alertType: 'Storage', message: 'Your storage is full. Buy extra storage or delete old files.' });
      next.full = true; next.w80 = true;
    } else if (pct < 100 && !next.w80) {
      await createAlert(uid, u, { alertType: 'Storage', message: 'Your storage is 80% full. Buy extra storage or delete old files.' });
      next.w80 = true;
    }
    if (next.w80 !== !!flags.w80 || next.full !== !!flags.full) await ref.set({ storageNotified: next }, { merge: true });
  } catch (e) { console.warn('storage alert check failed:', e.message); }
}

// Client address for rate limits. Render sits behind Cloudflare, which sets "cf-connecting-ip" itself
// (a customer cannot fake it). The old "true-client-ip" header is NOT trusted because a client can send it.
const clientIp = req => String(req.headers['cf-connecting-ip'] || req.ip || 'unknown');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Per-user rate limiter (use after auth)
const userLimiter = (max, windowMs = 60 * 60 * 1000) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => req.user.uid,
  message: { error: 'Too many requests - try again later' }
});

// Per-user daily counter that resets at midnight in the customer's own timezone
function dayKey(tz) {
  try { return new Date().toLocaleDateString('en-CA', { timeZone: tz || 'UTC' }); }
  catch (e) { return new Date().toISOString().slice(0, 10); }
}
async function takeDaily(uid, kind, limit, tz) {
  const ref = db.collection('usage_daily').doc(`${uid}_${kind}_${dayKey(tz)}`);
  return db.runTransaction(async t => {
    const snap = await t.get(ref);
    const used = snap.exists ? (snap.data().count || 0) : 0;
    if (used >= limit) return { allowed: false, used };
    t.set(ref, { uid, kind, count: used + 1, updated: Date.now() }, { merge: true });
    return { allowed: true, used: used + 1 };
  });
}
const envInt = (name, fallback) => { const n = parseInt(process.env[name], 10); return Number.isFinite(n) && n > 0 ? n : fallback; };

// Deleted, disabled or logged-out-everywhere accounts are refused immediately (one extra Firebase lookup).
// The two routes the camera phone calls every few minutes skip it to stay fast; they check the account themselves.
const NO_REVOKE_CHECK = ['/api/analytics/frame', '/api/camera/heartbeat'];
const auth = wrap(async (req, res, next) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) throw httpError(401, 'Login required');
  try {
    const checkRevoked = !NO_REVOKE_CHECK.some(p => req.originalUrl.startsWith(p));
    const dec = await authAdmin.verifyIdToken(h.slice(7), checkRevoked);
    req.user = { uid: dec.uid, email: dec.email || '', phone: dec.phone_number || '' };
  } catch (e) { throw httpError(401, 'Session expired'); }
  next();
});

const requirePro = wrap(async (req, res, next) => {
  const u = (await db.collection('users').doc(req.user.uid).get()).data() || {};
  if (!u.isPro || (u.planExpiry && u.planExpiry < Date.now())) throw httpError(403, 'Active subscription required');
  req.userDoc = u;
  next();
});

async function assertStorage(uid, size) {
  const u = (await db.collection('users').doc(uid).get()).data() || {};
  if ((u.storageUsed || 0) + size > (u.storageLimit || BASE_BYTES)) {
    checkStorageAlerts(uid); // sends the "storage is full" alert once
    throw httpError(403, 'Storage full - buy extra storage');
  }
}

// Health comes from heartbeats sent by the phone (battery, storage, network). No heartbeat = unknown, never faked.
function cameraHealthStatus(h) {
  if (!h || !h.updatedAt) return { state: 'unknown', issues: [] };
  if (Date.now() - h.updatedAt > 15 * 60 * 1000) return { state: 'offline', issues: ['no signal for 15 minutes'], lastSeen: h.updatedAt };
  const issues = [];
  if (h.battery != null && h.battery < 20 && !h.charging) issues.push('low battery');
  if (h.storageFreeMb != null && h.storageFreeMb < 500) issues.push('low storage');
  if (h.network === 'none') issues.push('no internet');
  return { state: issues.length ? 'warning' : 'ok', issues, lastSeen: h.updatedAt };
}
const publicCamera = d => {
  const { rtspEnc, passwordEnc, ...rest } = d.data();
  return { id: d.id, ...rest, hasCredentials: !!(rtspEnc || passwordEnc), healthStatus: cameraHealthStatus(rest.health) };
};

const GB_BYTES = 1024 * 1024 * 1024;
const STORAGE_PACK_DAYS = envInt('STORAGE_PACK_DAYS', 30);
// Extra storage is sold in packs that last STORAGE_PACK_DAYS days. Limit = free base + every pack that has not ended.
function storagePackState(packs, now) {
  const active = (Array.isArray(packs) ? packs : []).filter(p => p && p.expiresAt > now);
  const extraBytes = active.reduce((sum, p) => sum + (p.gb || 0) * GB_BYTES, 0);
  return { active, limitBytes: BASE_BYTES + extraBytes, nextExpiry: active.length ? Math.min(...active.map(p => p.expiresAt)) : null };
}

// ---------- ABDUL WAHAB (AI advisor) + ANALYTICS ----------
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

function localParts(ts, tz) {
  const make = zone => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });
  let f;
  try { f = make(tz || 'UTC'); } catch (e) { f = make('UTC'); }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: parseInt(p.hour, 10) % 24, weekday: p.weekday };
}
async function recentDocs(col, ownerField, uid, since, limit) {
  try {
    return (await db.collection(col).where(ownerField, '==', uid).where('created', '>=', since).limit(limit).get()).docs.map(d => d.data());
  } catch (e) {
    console.warn(col + ' index missing:', e.message);
    return (await db.collection(col).where(ownerField, '==', uid).limit(limit).get()).docs.map(d => d.data()).filter(x => (x.created || 0) >= since);
  }
}
const bump = (obj, key, n) => { obj[key] = (obj[key] || 0) + n; };

// Compact numbers the AI advisor (and the reports page) can use
async function buildContext(uid, tz, days) {
  const since = Date.now() - days * DAY_MS;
  const [ff, bills, alerts] = await Promise.all([
    recentDocs('footfall', 'uid', uid, since, 3000),
    recentDocs('billing_clips', 'uid', uid, since, 2000),
    recentDocs('alerts', 'userUid', uid, since, 1000)
  ]);
  const people = { byDay: {}, byHour: {}, byWeekday: {} }, vehicles = { byDay: {}, byHour: {} }, sales = { byDay: {}, byHour: {} }, alertsByType = {};
  ff.forEach(r => {
    const p = localParts(r.created, tz), pc = r.personCount || 0, vc = r.vehicleCount || 0;
    bump(people.byDay, p.date, pc); bump(people.byHour, p.hour, pc); bump(people.byWeekday, p.weekday, pc);
    bump(vehicles.byDay, p.date, vc); bump(vehicles.byHour, p.hour, vc);
  });
  bills.forEach(b => { const p = localParts(b.created, tz), a = b.amount || 0; bump(sales.byDay, p.date, a); bump(sales.byHour, p.hour, a); });
  alerts.forEach(a => bump(alertsByType, a.alertType || 'Unknown', 1));
  return { periodDays: days, timezone: tz || 'UTC', footfallSamples: ff.length, people, vehicles, billsCount: bills.length, sales, alertsByType };
}

// Messages for the owner only (problems and the daily summary). Free Telegram bot, optional:
// set OWNER_TELEGRAM_BOT_TOKEN and OWNER_TELEGRAM_CHAT_ID on Render. Without them the message is only written to the logs.
// The same problem is sent at most once per minGapMs. Customer data is never put in these messages.
const ownerNoticeTimes = new Map();
async function notifyOwner(key, text, minGapMs = 30 * 60 * 1000) {
  try {
    const now = Date.now();
    if ((ownerNoticeTimes.get(key) || 0) + minGapMs > now) return false;
    ownerNoticeTimes.set(key, now);
    const token = process.env.OWNER_TELEGRAM_BOT_TOKEN, chat = process.env.OWNER_TELEGRAM_CHAT_ID;
    if (!token || !chat) { console.warn('[owner notice]', String(text).slice(0, 300)); return false; }
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: String(text).slice(0, 3500) })
    });
    return r.ok;
  } catch (e) { console.warn('owner notice failed:', e.message); return false; }
}

async function createAlert(uid, u, { cameraId, alertType, message }) {
  const wt = getTime(u.timezone);
  const alertData = { alertId: 'alert_' + wt.ts, userUid: uid, cameraId: cameraId || null, alertType, message, created: wt.ts, createdAtExact: wt.utcExact, beforeExact: wt.beforeExact, afterExact: wt.afterExact, auto: true };
  await db.collection('alerts').add(alertData);
  try {
    const tokens = u.fcmTokens || [];
    if (tokens.length) await admin.messaging().sendEachForMulticast({ tokens, notification: { title: alertType, body: message } });
  } catch (e) { console.warn('push failed:', e.message); }
  return alertData;
}

const planActive = u => !!(u && u.isPro && (!u.planExpiry || u.planExpiry > Date.now()));

// Delete every doc of a user in a collection (batches of 300). Optional onDoc(data) runs before each delete.
async function deleteWhere(col, field, uid, onDoc) {
  let total = 0;
  for (;;) {
    const snap = await db.collection(col).where(field, '==', uid).limit(300).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const d of snap.docs) { if (onDoc) await onDoc(d.data()); batch.delete(d.ref); }
    await batch.commit();
    total += snap.size;
  }
  return total;
}

// Erases everything of a user. Payment and subscription records are kept (tax/accounting records).
async function eraseUserData(uid) {
  const u = (await db.collection('users').doc(uid).get()).data() || {};
  if (u.subscriptionId) { // stop future charges first; if that fails, stay pending and retry
    try { await razorpay.subscriptions.cancel(u.subscriptionId, false); }
    catch (e) {
      const msg = String((e && e.error && e.error.description) || e.message || '');
      if (!/already|cancel|complet|expire/i.test(msg)) throw e;
    }
  }
  for (const prefix of ['vault', 'faces', 'capsules', 'offline', 'reports']) {
    await bucket.deleteFiles({ prefix: `${prefix}/${uid}/`, force: true }).catch(e => console.warn('bucket cleanup', prefix, e.message));
  }
  const targets = [['cameras', 'uid'], ['vault', 'uid'], ['faces', 'uid'], ['chats', 'uid'], ['billing_clips', 'uid'], ['offline_clips', 'uid'],
    ['footfall', 'uid'], ['alerts', 'userUid'], ['incidents', 'userUid'], ['team_holders', 'ownerUid'], ['team_staff', 'ownerUid'],
    ['secure_codes', 'uid'], ['share_links', 'uid'], ['daily_reports', 'uid'], ['emergencies', 'uid'], ['feedback', 'uid'],
    ['usage_daily', 'uid'], ['client_errors', 'uid'], ['watch_state', 'uid'],
    ['support_chats', 'uid'], ['support_tickets', 'uid'], ['pending_approvals', 'uid'], ['dvr_bridges', 'uid']];
  for (const [col, field] of targets) await deleteWhere(col, field, uid);
  try { await authAdmin.deleteUser(uid); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  await db.collection('users').doc(uid).delete(); // last, so a failed run stays 'pending' and the cron retries
}

module.exports = {
  AGENTS, AI_TOOLS, ANTHROPIC_API_KEY, BASE_BYTES, BETA_TOOL_NAMES, CAMERA_METHODS, CATEGORIES, COMING_SOON_NAMES,
  COUNTRY_CODES, CRON_SECRET, DAY_MS, FV, GB_BYTES, LANGUAGES, LIVE_TOOL_NAMES, NO_REVOKE_CHECK, PORT, PYTHON_AI_URL,
  PYTHON_SECRET, REQUIRED_ENV, Razorpay, RtcRole, RtcTokenBuilder, STORAGE_PACK_DAYS, STORAGE_PLANS, VAULT_MASTER_SECRET,
  addUsage, admin, assertStorage, auth, authAdmin, bucket, buildContext, bump, calcRate, cameraHealthStatus,
  checkStorageAlerts, clientIp, cors, createAlert, crypto, dayKey, db, decryptBuffer, deleteWhere, emergencyFor,
  encryptBuffer, encryptText, envInt, eraseUserData, express, fetch, fs, getPrice, getTime, helmet, httpError, localParts,
  missing, multer, notifyOwner, num, ownerNoticeTimes, path, planActive, publicCamera, rateLimit, razorpay, recentDocs,
  requirePro, safeCompare, sanitizeFilename, storagePackState, takeDaily, upload, userLimiter, vaultKey, wrap
};