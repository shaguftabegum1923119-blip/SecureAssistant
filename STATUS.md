# Secure Assistant - STATUS.md (V15 plan, final decisions)
Updated: 2026-10-16. Give this file to any helper or AI so nothing has to be explained again.

## Running now
V14 is live. V15 files are being rewritten here, one at a time, and will only be pasted into VS Code and pushed together once all are confirmed.

## Files: order, status, approx lines
1. core.js — DONE (given). ~330 lines.
2. routes-account.js — NEXT. Remove bank routes (/api/bank/*).
3. routes-cameras.js — pending.
4. routes-money.js — pending. Price = cameras x rate (no more "never drops").
5. cron.js — pending.
6. routes-wahab.js — pending. Add cache for repeated/FAQ answers; keep single agent (Abdul Wahab only, Abdul Samad dropped).
7. staticData.js — pending. Fix zh -> zh-Hant tag; recheck libphonenumber-js require.
8. index.js — DONE (given). ~60 lines. Removed .web.app/.firebaseapp.com from CORS; clientIp now trusts only cf-connecting-ip.
9. package.json — DONE (given). Same version 15.0.0, no new packages yet.
10. check-backend.js — pending, add a price-math test (6 cams = Rs 420, not Rs 425).

## New files to add after the 10 above (V16, each one small, self-contained)
- storage-b2.js — Backblaze B2 upload/download, used instead of/alongside Firebase Storage. Needs new package @aws-sdk/client-s3.
- routes-help.js + helpData.js — "i" help buttons per page, category-based home screen data.
- routes-agent.js — single agent (Abdul Wahab) with tools, support tickets, owner approvals.
- routes-dvr.js — DVR bridge: register/token route for a small program running on the shop's old phone/PC; reuses /api/analytics/frame and /api/camera/heartbeat.
- firestore.rules, storage.rules — lock down direct access; only the backend should read/write.
- Web pages: Privacy Policy, Terms, Refund and Cancellation, Delete-account.

## Final decisions (do not re-ask)
- Camera price = camera count x the rate for its slab (1-2 Rs 99, 3-5 Rs 85, 6-9 Rs 70, 10+ Rs 60). Yearly = 11 months (1 month free).
- Free storage: 5 GB per customer (final). Extra storage via Backblaze B2 (cheapest found: ~$6.95/TB).
- No free trial (stays off). Will do a sample-data demo instead later.
- Live video: 20 minutes/day (5 min x 4 sessions), to cut Agora cost. New plan: collect short clips -> extract photos -> write report/document from photo data (replaces always-on live viewing as the main feature).
- In-app billing: Play Billing only inside the app (digital subscription + storage). Razorpay/UPI allowed only on the website, not inside the app.
- Bank routes (/api/bank/*) removed entirely; no direct bank transfer route.
- AI agent: ONE agent only (Abdul Wahab). Abdul Samad as a separate pre-payment agent was dropped. Payment-failed customers can still use support chat; support questions are not counted in the daily question limit.
- AI model: use Anthropic only (Sonnet for complex/expert questions, Haiku for routine ones). Do NOT add Gemini/Google as a model provider (keeps customer photos out of a second AI company; Google is already present via Firebase for storage/auth only).
- Army/Border/Military and similarly classified customers: not a target market for this app version; no claim of being hack-proof is ever made, only "Encrypted" and "Privacy-first". A separate "outside/non-sensitive security only" mode may be added later for light use, but not a classified-data product.
- Security principle: even if the app/server were breached, stored files should stay unreadable (per-customer encryption key); no absolute "cannot be hacked" claim anywhere in the app or marketing.
- Categories 8 (Police/Jail/Military): keep Police/Jail/Court, consider dropping Army Camps/Border Posts to avoid scrutiny with no real benefit yet.

## App page flow (8 pages, for FlutterFlow)
1. Language (179) -> 2. Login/Signup -> 3. Categories (13, incl. own business) -> 4. Camera setup + payment (5 methods + camera count + Razorpay/Play) -> 5. Live cameras (opens after payment; live search is coming_soon) -> 6. Abdul Wahab chat (text, photo now; voice/video planned) -> 7. Storage (recordings, 5 GB free, 80%/full alerts, extra packs) -> 8. Team and profile (max 3 app holders, unlimited staff).

## Known bugs/gaps already found (not yet fixed in code)
- Agora daily limit and per-session minutes need updating to the new 20 min/day plan.
- staticData.js: "zhHant" should be "zh-Hant"; libphonenumber-js require spelling needs a one-time check in the real file.
- eraseUserData() does not yet clear 'subscriptions' and 'storage_orders' collections (kept for accounting, but confirm with an accountant/Privacy Policy wording).
- Abdul Wahab route re-reads ~14 days of footfall/billing/alerts on every question; needs a short cache (per the hybrid-model plan above).
- Python AI service 502s on first real photo test; cause not yet found (need Render logs + confirm requirements.txt in use).

## Env vars (names only, values are secret, never share)
Required: FIREBASE_SERVICE_ACCOUNT_BASE64, FIREBASE_STORAGE_BUCKET, VAULT_MASTER_SECRET, CRON_SECRET, PYTHON_SECRET, PYTHON_AI_URL, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, AGORA_APP_ID, AGORA_APP_CERT.
Optional: ANTHROPIC_API_KEY, OWNER_TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_CHAT_ID, PYTHON_TIMEOUT_SEC, STORAGE_PACK_DAYS, WAHAB_DAILY_LIMIT, AGORA_TOKEN_MINUTES, AGORA_DAILY_VIEWS, AGORA_DAILY_PUBLISH.
B2 (to add): B2_KEY_ID, B2_APP_KEY, B2_BUCKET.

## Next action right now
Continue with routes-account.js (remove bank routes), then routes-cameras.js, routes-money.js, cron.js, routes-wahab.js, staticData.js, check-backend.js, in that order.