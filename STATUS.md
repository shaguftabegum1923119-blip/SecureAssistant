# Secure Assistant - Master Status (updated 2026-10-22)

Give this whole file to any new chat/AI/helper FIRST. If they also need to edit a specific file, paste that file's actual code too - this document explains the system, it does not replace the code.

**Rules for any helper (from the owner):** reply in Hindi, short (one line when she asks for one). Free tasks first, paid tasks later. She works around housework, so keep steps small. When a file must change, give the FULL new file, not a "find this line and edit" instruction (she cannot do small edits). Never ask her to paste secrets (.env, service account JSON, keys).

---

## 1. What the app is and does
Secure Assistant is a CCTV/camera monitoring app for shops, supermarkets, factories, offices, religious places, farms and roads. Customers connect cameras (old phone as CCTV, IP camera, DVR, or their own phone) and get: person/vehicle counting, intrusion and crowd alerts, camera health monitoring, encrypted video storage, and an AI advisor (Abdul Wahab) that gives business and security advice in the customer's own language, based only on their real camera data.
Owner benefit: monthly/yearly subscription per camera, extra storage sales.

## 2. Services and URLs
- Backend (Node.js/Express): https://secureassistant.onrender.com (Render region: Oregon / US West)
- Python AI (Flask/YOLO): https://secureassistant-1.onrender.com
- Firebase project: assistant-74894 (Auth + Firestore; Admin-SDK-only - the app never talks to Firestore directly). Firebase Storage is no longer used once the new core.js is live.
- Payments: Razorpay (website) + Play Billing (inside the Android app)
- Live video: Agora
- File storage: Backblaze B2 (S3-compatible), US West region (us-west-004), private bucket `secure-assistant-files` (object lock off), bucket-limited read/write key. Files are always encrypted per customer BEFORE upload.
- Cron: cron-job.org (5 jobs, all set up - see section 6)
- Code: GitHub -> auto-deploys to Render on push
- Frontend: FlutterFlow (not started yet)
- Claude Project named "Secure Assistant" created (Projects page) - holds the files below so new chats can read them. Never upload secrets into it.

## 3. App page flow (8 pages)
1. Language (179 languages) 2. Login/Signup (email+password or phone OTP) 3. Categories (13, incl. "Other - My Own Business") 4. Camera setup + payment (8 camera methods, price by camera count) 5. Live cameras (20 min/day limit) 6. Abdul Wahab chat (text, voice, photo) 7. Storage (5 GB free + extra packs) 8. Team and profile (max 3 app holders, unlimited staff)

## 4. Backend files (project folder in VS Code)
**V15 core set (live on Render since 2026-10-17):** index.js, core.js, routes-account.js, routes-cameras.js, routes-money.js, routes-wahab.js, cron.js, staticData.js, package.json, check-backend.js, run-login-checks.js.

**V16 add-ons (in VS Code, listed in index.js, deploy NOT yet confirmed):**
- routes-help.js - "i" help text per page, help list per category, home-screen data per category.
- routes-agent.js - support chat by Abdul Wahab (works even for non-paid / payment-failed customers), tickets, approval requests. Refund / plan change / delete account / update info are NEVER auto-run: they are only logged in `pending_approvals` for the owner.
- routes-dvr.js - DVR bridge backend. Token is shown once and only its SHA-256 hash is stored; heartbeat needs header `X-Bridge-Token`. (An older version that stored the token in plain text must NOT be used.)
- core.js erase list also deletes `support_chats`, `support_tickets`, `pending_approvals`, `dvr_bridges`.
- index.js must be the NEW V15 one (loads core.js + route files + cron.js). The old V13 index.js (everything in one file) must NOT be used.

**B2 storage (2026-10-22):**
- b2Storage.js (new full file) has helper functions AND a `bucket` adapter with the same calls the old Firebase bucket had: file(path).save / download / delete / getSignedUrl, and deleteFiles({prefix}). An empty prefix is refused so the whole bucket cannot be wiped by mistake.
- core.js (new full file) now does `bucket = require('./b2Storage').bucket`, no longer sets the Firebase storage bucket, and requires B2_KEY_ID, B2_KEY (or B2_APP_KEY), B2_BUCKET, B2_ENDPOINT, B2_REGION instead of FIREBASE_STORAGE_BUCKET.
- Because every file call goes through `bucket`, routes-money.js (vault), routes-cameras.js (capsules, offline clips, faces, reports), cron.js (cleanup) and eraseUserData work WITHOUT edits. routes-account.js, routes-wahab.js, routes-agent.js, routes-help.js, routes-dvr.js and index.js contain no storage code.
- Status: both files syntax-checked and the export list verified in Claude's sandbox only. NOT yet tested on her laptop or on Render.
- Earlier b2Storage.js self-test (before the adapter) PASSED on her laptop: bucket, upload, signed download, delete.
- Files saved in Firebase Storage during testing will not open any more (fine while there are no real customers).

## 5. New API routes (for FlutterFlow JSON files, still to be made)
- Help: GET /api/help/pages, GET /api/help/page/:id, GET /api/help/categories, GET /api/help/category/:id (public); GET /api/home/data (login; optional ?categoryId=)
- Support: POST /api/support/chat, POST /api/support/ticket, GET /api/support/tickets, POST /api/support/request-approval (type: refund | plan_change | delete_account | update_info), GET /api/support/approvals (all need login)
- DVR: POST /api/dvr/register (login + paid plan; returns token once), POST /api/dvr/heartbeat (header X-Bridge-Token, body `{version, cameras:[{cameraId, online}]}`), GET /api/dvr/list, DELETE /api/dvr/:id
- Optional Render env: ANTHROPIC_API_KEY (needed for chat), ANTHROPIC_MODEL (default claude-sonnet-5-5), ANTHROPIC_MODEL_FAST (default claude-haiku-5-5), SUPPORT_DAILY_LIMIT (20), DVR_MAX_BRIDGES (5), DVR_HEARTBEATS_PER_HOUR (120), OWNER_TELEGRAM_BOT_TOKEN + OWNER_TELEGRAM_CHAT_ID (owner messages)
- Not built yet: an owner screen to approve/reject `pending_approvals` and answer tickets (for now read them in the Firebase console).

## 6. Cron jobs (cron-job.org, header X-CRON-SECRET) - ALL 5 DONE
camera-health (every 10 min), daily-report (hourly), process-deletions (hourly), storage-cleanup (daily), owner-digest (daily). All routes exist in cron.js.

## 7. Final pricing and product decisions (do not re-ask)
- Camera subscription per month: Rs 99/camera (1-2 cams), Rs 85 (3-5), Rs 70 (6-9), Rs 60 (10+). Total = camera count x its slab rate. Yearly = 11 months' price.
- Free storage 5 GB/customer. Extra storage in 30-day packs: 10 GB Rs 39, 50 GB Rs 189, 100 GB Rs 379, 500 GB Rs 1899. Backend = Backblaze B2.
- No free trial (kept off).
- Live video: 20 min/customer/day (5 min x 4 sessions).
- Billing: Play Billing inside the Android app; Razorpay/UPI only on the website.
- AI agent: ONE agent only (Abdul Wahab, also support). Anthropic only: Sonnet for expert/legal/medical/photo questions, Haiku for routine ones. Gemini/Google deliberately not used.
- Security principle: every file is encrypted with a per-customer key (VAULT_MASTER_SECRET + uid) before upload. No "100 percent" or "cannot be hacked" claims - only "Encrypted" and "Privacy-first".
- Category 8 (Police/Jail/Courts) kept; Army Camps and Border Posts removed.
- Bank account routes removed (auto-renew via Razorpay Subscriptions).
- Free tasks first, paid tasks later.

## 8. AI tools - what's real
22 tools in staticData.js:
- LIVE (6): Person Detection and Counting, Vehicle Detection, Crowd Detection, QR Generator and Scanner, Camera Health Monitoring, Encrypted Capsule Save.
- BETA (5): Intrusion Detection, Offline Revive and Rewind, Camera Placement Advisor, Live Location and Status Share, Proof Capsule with Time Window.
- COMING_SOON (11, NOT built, never sell as working): Face Recognition, Number Plate ANPR, Loitering, Fall, Fire/Smoke, Weapon, Unattended Baggage, Audio Scream, Visitor Background Intelligence, Smart Search/Loyal Customer History, Attendance/Staff Tracking.
Abdul Wahab only reports what is in the data; it never invents results.

## 9. Known problem: Python AI service (YOLO) not working yet
- /detect returns 502: gunicorn worker is killed ~5 s after the YOLO model starts loading - RAM shortage on Render FREE plan (512 MB), not a code bug.
- Tried: `--timeout 120`, and a "lightweight mode" (no torch pins, imgsz=320) - still failed.
- Original (non-lightweight) app.py + requirements.txt (torch 2.2.2, torchvision 0.17.2, ultralytics 8.3.0, etc.) are kept aside by the owner.
- REAL FIX: Render paid plan (~$7/month). She stays on free until the rest is done, then upgrades and switches back to the original files, then checks `/health` shows modelLoaded:true.
- Until then photo/video analysis, counting from real footage and face search fail. Everything else (accounts, payments, cameras list, text chat, alerts, cron) works independently.

## 10. FlutterFlow status
8 Postman-collection JSON files exist (one per app page, V15 route names). Frontend build not started. JSON entries for the new help / support / dvr routes (section 5) still have to be added. App State variable list was given earlier.

## 11. What is DONE
- V15 backend deployed and healthy on Render (2026-10-17); all 5 cron jobs created.
- V16 files (help, agent, dvr) written and placed in VS Code; core.js erase list updated; new index.js ready.
- Backblaze B2 account, private bucket, restricted key, `.env` and Render variables, first self-test passed on her laptop.
- New b2Storage.js (with adapter) and new core.js written and syntax-checked (2026-10-22), waiting for her laptop test.
- Claude Project "Secure Assistant" created with the code files.

## 12. What is LEFT (free first, in order)
1. Laptop: replace b2Storage.js and core.js with the new full files; `node b2Storage.js --test` (must show 6 lines of OK); `npm start` (must show "live on port").
2. B2 bucket -> Lifecycle Settings -> choose "Keep only the last version of the file" (otherwise deleted files keep costing money).
3. `node --check` on index.js, routes-help.js, routes-agent.js, routes-dvr.js; then `git add .`, `git commit -m "V16 + B2"`, `git push`; check Render log "live on port" and `/health`. Make sure .env is in .gitignore and never pushed. Render's Node version should be 20 or newer. FIREBASE_STORAGE_BUCKET is no longer needed on Render.
4. Test one real upload and download through the vault route (needs a paid test account), then check the file in the B2 bucket.
5. Firebase Console: paste firestore.rules and storage.rules (deny all direct client access) and Publish.
6. Render logs: if "index missing" appears, click the link to create the Firestore index.
7. Privacy Policy, Terms, Refund and Cancellation, Delete-account pages (static HTML on Firebase Hosting, "Open URL" button in the app).
8. DVR bridge program (small script for the shop's old phone/PC; calls /api/dvr/heartbeat). Each DVR brand has a different RTSP link format - test on one real DVR first.
9. Owner screen for tickets and `pending_approvals`; optional Telegram channel for help.
10. PAID, later: Play Console developer fee; Render paid plan -> original Python files -> test photo/video analysis end to end; Razorpay real payment test; FlutterFlow frontend build.

---

## हिंदी सारांश (Hindi summary)
**हो चुका:** V15 बैकएंड Render पर चालू है। 5 के 5 cron जॉब बन गए। V16 की फ़ाइलें (help, agent, dvr) बन गईं और VS Code में हैं। B2 अकाउंट, प्राइवेट bucket, चाबी, `.env` और Render के वैरिएबल तैयार हैं। B2 के लिए नई `b2Storage.js` और `core.js` बन गई हैं (सिर्फ़ यही दो फ़ाइलें बदलनी थीं, बाकी सब वैसी ही)।

**अब करना है (फ्री):** (1) दोनों नई फ़ाइलें रखकर `node b2Storage.js --test` और `npm start` चलाना। (2) B2 बकेट में Lifecycle: "Keep only the last version"। (3) `git push` और Render में "live on port" देखना। (4) Firebase में rules पेस्ट करके Publish। (5) Privacy/Terms/Refund/Delete पेज। (6) DVR bridge प्रोग्राम।

**पैसे वाले (बाद में):** Play Console फीस, Render पेड प्लान (तब Python AI ठीक होगा), Razorpay का असली टेस्ट।

**अभी Python AI क्यों बंद है:** Render के फ्री प्लान में RAM कम है। बाकी पूरा ऐप उससे अलग चलता है।