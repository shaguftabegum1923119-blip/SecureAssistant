# Secure Assistant - Master Status (updated 2026-10-29)

Give this whole file to any new chat/AI/helper FIRST. If they also need to edit a specific file, paste that file's actual code too - this document explains the system, it does not replace the code.

**Rules for any helper (from the owner):** reply in Hindi (Devanagari), ONE language per reply, short (one line when she asks for one). All code, page text and in-code messages must be pure English (she speaks Roman Hindi, but nothing in Hindi/Hinglish goes inside code or app pages). Free tasks first, paid tasks later. She works around housework and uses only the VS Code terminal (no GitHub web UI), so keep steps small. When a file must change, give the FULL new file, not a "find this line and edit" instruction. Give ONE file or ONE tool at a time; she collects the files and tests them all together when she is at the laptop. Never ask her to paste secrets (.env, service account JSON, keys, tokens, passwords). She wants almost no explanation: the file first, a very short reply, never repeat a file she already has, no long lectures. She puts all the files in and tests everything together at the end, one by one.

**Honesty rule:** only mark something DONE if the owner saw it work. Code a helper wrote but nobody ran on the real system is NOT TESTED (a helper's own simulated test does not count as DONE).

---

## 1. What the app is and does
Secure Assistant is a CCTV/camera monitoring app for shops, supermarkets, factories, offices, religious places, farms and roads. Customers connect cameras (old phone as CCTV, IP camera, DVR, or their own phone) and get: person/vehicle counting, intrusion and crowd alerts, camera health monitoring, encrypted video storage, consent-based face matching, and an AI advisor (Abdul Wahab) that gives business and security advice in the customer's own language, based only on their real camera data.
Owner income: monthly/yearly subscription per camera, extra storage packs.
Target platforms: Android, iPhone and desktop, all from one FlutterFlow project (in-app purchases work only on Android/iOS, not web/desktop).

## 2. Services and URLs
- Backend (Node.js/Express): https://secureassistant.onrender.com (Render, FREE plan). cron-job.org pings it every 5 minutes, which keeps it awake.
- Python AI (Flask + YOLOv8n + OpenCV face models): https://secureassistant-1.onrender.com (Render **Standard plan, $25/month, 2 GB RAM**). WORKING since 2026-10-27; /health on 2026-10-28 showed modelLoaded:true, faceModels:"ready", faceError:null.
- Firebase project: assistant-74894 (Auth + Firestore, Admin-SDK-only; the app never talks to Firestore directly). Firestore rules published (deny all client access). Firebase Storage is not used.
- Payments: Razorpay (website, TEST mode) + Google Play Billing inside the Android app (see section 12).
- Live video: Agora.
- File storage: Backblaze B2 (S3-compatible, us-west-004), private bucket `secure-assistant-files`. Files are encrypted per customer on the SERVER before upload (not on the phone - never claim device-side encryption).
- Owner notices: Telegram bot (/health shows ownerNoticesReady:true).
- Cron: cron-job.org (5 jobs plus the keep-awake ping).
- Code: GitHub -> auto-deploys to Render on push. Pushes are done from the VS Code terminal.
- Frontend: FlutterFlow (build not started).
- Claude Project "Secure Assistant" holds the code files. Never upload secrets into it.
- Google Play Console: $25 registration already paid.

## 3. App page flow (8 pages)
1. Language (179) 2. Login/Signup (email+password, phone OTP, Google) 3. Categories (13, incl. "Other - My Own Business") 4. Camera setup + payment (8 camera methods, price by camera count) 5. Live cameras (opens after payment) 6. Abdul Wahab chat (text, voice, photo) 7. Storage (5 GB free + extra packs) 8. Team and profile (max 3 app holders, unlimited staff).
Privacy, Terms, Refund and Delete-account pages are NOT app pages: the backend serves them at /privacy, /terms, /refund, /delete-account, so the app only needs buttons that open those links.

## 4. Files
**Node backend folder (SecureAssistant):** index.js, core.js, b2Storage.js, routes-account.js, routes-cameras.js, routes-money.js, routes-play.js, routes-facematch.js, routes-watch.js (NEW, not pushed yet), routes-wahab.js, routes-help.js, routes-agent.js, routes-dvr.js, routes-owner.js, routes-pdf.js, cron.js, staticData.js, package.json, check-backend.js, run-login-checks.js, vault-test.js, face-test.js and watch-test.js (test scripts only), folder legal/.
- package.json (new version delivered 2026-10-29, NOT pushed yet) lists `form-data`, `pdfkit` and `sharp` among its dependencies (no new package was added). Its `npm run check` now also covers routes-play.js, routes-facematch.js and routes-watch.js. `npm run check` passed on 2026-10-27 and was run again before the 2026-10-28 push.
- index.js (updated version delivered 2026-10-29, NOT pushed yet) loads: routes-account, routes-cameras, routes-money, routes-play, routes-facematch, routes-watch, routes-wahab, routes-help, routes-agent, routes-dvr, routes-owner, routes-pdf, cron. **index.js and routes-watch.js must be pushed together**, otherwise the server cannot start (missing module).

**Python AI folder (secure-assistant-ai):** app.py, requirements.txt, yolov8n.pt, the two face model files (face_detection_yunet_2023mar.onnx, face_recognition_sface_2021dec.onnx), a test photo people.jpg (listed in .gitignore).
- requirements.txt uses the CPU-only torch build (torch 2.4.1+cpu) to save memory.
- app.py: the YOLO model is loaded in a background thread; a fork fix (`os.register_at_fork`) restarts the loader inside the gunicorn worker. /health shows modelLoaded, modelState (loading / loaded / failed), faceModels and faceError; logs print lines starting with `[ai]`.
- New app.py delivered 2026-10-29 (NOT pushed yet): adds POST /detect/boxes (people, backpacks, handbags and suitcases with positions as fractions of the picture). Everything else is unchanged.
- Render settings for the Python service: PYTHON_VERSION=3.11.9, Start Command `gunicorn app:app --workers 1 --threads 2 --timeout 120 --bind 0.0.0.0:$PORT`.

**Privacy rule for owner:** the owner sees only `{id, planActive, planExpiry}` for customers - never name, email or phone. Owner identity is set with OWNER_UID.

**Security notes:** routes-dvr.js stores only the SHA-256 hash of the bridge token. Refund / plan change / delete account / update info are never auto-run by the agent - only logged in `pending_approvals` for the owner.

## 5. API routes
- Help: GET /api/help/pages, /api/help/page/:id, /api/help/categories, /api/help/category/:id (public); GET /api/home/data (login).
- Support: POST /api/support/chat, /api/support/ticket, /api/support/request-approval; GET /api/support/tickets, /api/support/approvals.
- DVR: POST /api/dvr/register, POST /api/dvr/heartbeat (header X-Bridge-Token), GET /api/dvr/list, DELETE /api/dvr/:id.
- Payment webhook (Razorpay): POST /api/payment/webhook.
- Play webhook (RevenueCat): POST /api/play/webhook (NOT TESTED).
- PDF report: GET /api/report/pdf?days=1 (NOT TESTED; login + active plan needed).
- Face matching (login + active plan; tested by face-test.js): POST /api/facematch/enroll (photo + name + consent), POST /api/facematch/identify, GET /api/facematch/list, DELETE /api/facematch/:id.
- Watch tools (NOT pushed, NOT tested on a real camera): POST /api/watch/frame (form fields: frame, cameraId, optional tools = any of bag, loiter, down separated by commas - default is bag,loiter, down must be asked for; aloneSeconds 30-1800, loiterSeconds 30-3600, downSeconds 15-1800, zone = "x1,y1,x2,y2" as fractions 0-1 for loitering and person down), GET and DELETE /api/watch/state/:cameraId.
- Photo/video analysis from the app: POST /api/analytics/frame (counts only, image not stored) and POST /api/video/upload-analyze. These call the Python service. There is NO route called /api/detect/person.
- Python service: POST /detect, POST /detect/boxes (new), POST /face/embed (all with header X-CORE-SECRET), GET /health.
- Optional Render env (Node): ANTHROPIC_API_KEY (needed for chat/agent, currently NOT set, so /health shows wahabReady:false), ANTHROPIC_MODEL, ANTHROPIC_MODEL_FAST, SUPPORT_DAILY_LIMIT, DVR_MAX_BRIDGES, DVR_HEARTBEATS_PER_HOUR, OWNER_TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_CHAT_ID, AGORA_DAILY_SESSIONS, REVENUECAT_WEBHOOK_AUTH (for Play Billing, not set yet), FACE_MATCH_MIN (default 0.363), FACE_CONFIRM_BELOW (default 0.5), FACE_MAX_PER_USER (default 50).
- Optional env for the watch tools (all have defaults): BAG_ALONE_SECONDS 180, BAG_MIN_FRAMES 3, BAG_KEEP_MISSING_SEC 90, BAG_MATCH_DIST 0.08, LOITER_SECONDS 300, LOITER_MIN_FRAMES 3, LOITER_RADIUS 0.08, PERSON_MATCH_DIST 0.15, PERSON_KEEP_MISSING_SEC 60, DOWN_SECONDS 60, DOWN_MIN_FRAMES 3, DOWN_RATIO 1.3, DOWN_MIN_WIDTH 0.10, DOWN_RADIUS 0.10, DOWN_KEEP_MISSING_SEC 45, WATCH_MIN_GAP_SEC 3, WATCH_MAX_PER_MIN 30, WATCH_MAX_ALERTS_PER_HOUR 10. Python env: YOLO_BOX_IMG_SIZE (default 640).

## 6. Cron jobs (cron-job.org, header X-CRON-SECRET) - ALL DONE
camera-health (every 10 min), daily-report (hourly), process-deletions (hourly), storage-cleanup (daily), owner-digest (daily).

## 7. Final pricing and product decisions (do not re-ask)
- Camera subscription per month: Rs 99/camera (1-2 cams), Rs 85 (3-5), Rs 70 (6-9), Rs 60 (10+). Total = camera count x slab rate. Yearly = 11 months' price.
- Free storage 5 GB/customer. Extra packs (30 days): 10 GB Rs 39, 50 GB Rs 189, 100 GB Rs 379, 500 GB Rs 1899.
- No free trial. Live video 20 min/customer/day (5 min x 4 sessions) - see cost note in section 10.
- Billing: Google Play Billing inside the Android app (required by Play for digital subscriptions); Razorpay/UPI only on the website. PayPal is NOT used. Google takes about 15 to 30 percent of Play payments.
- AI agent: ONE agent (Abdul Wahab, also support). Anthropic only: Sonnet for expert/legal/medical/photo questions, Haiku for routine ones. Gemini/Google not used.
- Security wording: only "Encrypted" and "Privacy-first". Never "100 percent" or "cannot be hacked".
- Category 8 (Police/Jail/Courts) kept; Army Camps, Border Posts and any "Military" category removed. Bank account routes removed.
- Refund policy (refund.html): double charge or no activation = refund; low usage within 7 days = case by case; otherwise no refund; refund window 5-7 days.
- Legal pages dated 25 Oct 2026. Contact email in pages: secureassistant2319@gmail.com.
- Tools NOT used (decided 2026-10-27): Chromium/puppeteer (PDF reports use pdfkit instead), Docker, Notion API, Tesseract OCR, FFmpeg. Sharp is installed but no image.js has been written yet.
- Decided 2026-10-28: NO phone-calling voice agent (the reels the owner showed were only examples), and no marketing work for now - keep the app as it is and finish building it first.
- Build order for new AI tools (decided 2026-10-27): consent-based Face Matching (done, Live), then Unattended Baggage, Loitering and Person Down (code written, Beta, waiting for a real test), then Attendance by consented selfie check-in (blocked until core.js and cron.js are reviewed). Fire/Smoke, Weapon, Number Plate and Scream are postponed (need separate models, give many wrong alerts, or need more memory).

## 8. AI tools - what's real
22 tools in staticData.js (new version delivered 2026-10-29, NOT pushed yet; the 2026-10-28 version with Face Matching Live was pushed with commit c7174e8 most likely):
- LIVE (7): Face Matching (Consent Based), Person Detection and Counting, Vehicle Detection, Crowd Detection, QR Generator and Scanner, Camera Health Monitoring, Encrypted Capsule Save.
- BETA (8): Intrusion Detection, Loitering Detection, Person Down Detection (Possible Fall), Unattended Baggage Detection, Offline Revive and Rewind, Camera Placement Advisor, Live Location and Status Share, Proof Capsule with Time Window. "Beta" = built but not fully tested on real cameras; do not rely on it. Loitering, Person Down and Unattended Baggage have so far passed only the helper's simulated tests.
- COMING_SOON (7, never sell as working): Number Plate ANPR, Fire/Smoke, Weapon, Audio Scream, Visitor Background Intelligence, Smart Search/Loyal Customer History, Attendance/Staff Tracking.
- Categories get their Live/Beta/Coming-soon lists automatically from these statuses. Rule: a tool becomes Live only after the owner has seen it work on a real camera; if a real test fails, set it back to coming_soon.

**Face Matching details:** works on photos the customer sends, it does NOT watch cameras by itself. OpenCV YuNet (detector) + SFace (recognizer), run by the Python service. A face photo becomes a 128-number template; only the template is stored (encrypted per customer, Firestore collection `faces`), the photo is never saved. Only people added with consent can be matched. Limit 50 people per customer. Score thresholds: 0.363 = published SFace "same person" value, 0.5 = confirm-below value (the helper's own estimate - needs real-world tuning). It is a helper, not proof of identity. Faces that are far away, from the side, small or at night often fail.

**PRIVACY GAP (fix before any real customer uses Face Matching):** it is NOT confirmed that deleting an account erases the face templates in `faces` (routes-facematch.js has no erase hook, and core.js and cron.js were not reviewed for this). The `faces` and `watch_state` collections must be added to the delete-account and clean-up code. Needs core.js and cron.js from the owner.

**Watch tools (routes-watch.js, Beta, NOT tested on a real camera):** the camera phone sends a frame every few seconds to POST /api/watch/frame. Only positions and times are stored (Firestore `watch_state`, auto-expiring field `expiresAt`, 2 days). No photo, no face, nobody is identified. At most 10 alerts per camera per hour. Alerts go through createAlert with the types "Unattended Baggage", "Loitering" and "Person Down".
- Unattended Baggage: a bag with nobody near it for about 3 minutes (and at least 3 frames) gives ONE alert.
- Loitering: a person staying in the same small area for about 5 minutes gives ONE alert. Staff who always stand in one place give false alerts, so the app should send a `zone`. Follows positions, not faces.
- Person Down (must be asked for with tools=down; the default tools are bag,loiter): a person whose box is at least 1.3 times wider than tall (and at least 10 percent of the picture wide) and who does not move for about 60 seconds gives ONE alert. It cannot tell a fall from lying down on purpose, can miss a fall the camera did not see, and is NOT a medical device. Use a zone that avoids beds, sofas and play areas.
- Checked only with the helper's simulated data (all three tools, zone, getting up, alert failure retried, hourly cap, bad input). watch-test.js (delivered, not run yet) checks all three on the real server with photos. Not verified: that `createAlert` in core.js accepts the new alert types and shows them in the app.

**Planned, not built:** Attendance first, as a consented selfie check-in (staff takes a photo, the app matches a consented person and writes name + time). "Last seen" (which camera and when) and Visitor history only later, after a lawyer check (movement tracking of staff; the helper is not a lawyer). All of them need: core.js and cron.js reviewed first (erase on delete-account, clean up after about 30 days), written consent of every person, notice, and access only for senior holders. Never promise "what was he doing" - the app cannot know that. Do not show any of these as a feature until built and tested.

## 9. Python AI service
- Fixed 2026-10-27: the old 502 was not enough RAM on the free plan plus a heavy torch build. Fixed with the Standard plan, the CPU-only torch build and the app.py fork fix.
- Proof: /health shows modelLoaded:true, modelState:loaded; a test photo with 3 people returned 3 "person" detections (0.94, 0.92, 0.89). Face models: /health shows faceModels:"ready" (2026-10-28).
- Not tested: whether the cheaper Starter plan ($7, 512 MB) would be enough now (keep Standard); video analysis; the new /detect/boxes at 640 px on the real server (watch memory use).

## 10. Costs (approx, INR at ~Rs 90/USD)
- Fixed per month now: Render Standard for the Python AI ~Rs 2,250. Node backend stays on the free plan (cron keeps it awake). Firebase, Telegram, cron-job.org free.
- Later: FlutterFlow Basic ~Rs 1,300 (buy for ONE month only when ready to build all 8 pages in one go); Anthropic API prepaid credit (amount chosen by the owner; credits last one year, are not refundable, keep auto-reload off; Abdul Wahab costs about Rs 3-30 per customer per month); Render Starter ~Rs 630 for Node only if the free plan ever causes problems.
- Per customer: B2 ~Rs 3 if the 5 GB is full; Agora live video is the biggest cost (~Rs 0.36 per HD minute after 10,000 free minutes/month).
- Open decision: AGORA_DAILY_SESSIONS=2 (10 min/day, safer margin) or 4 (20 min/day).
- RevenueCat (for Play Billing): free until about $2,500 monthly tracked revenue, then about 1 percent. Not verified: whether webhooks are available on the free level - check the RevenueCat dashboard (Integrations > Webhooks).

## 11. Razorpay and testing status
- Test-mode webhook created: https://secureassistant.onrender.com/api/payment/webhook (payment.captured, subscription.charged / cancelled / halted / completed).
- TEST payment and the /paytest page: PASS (owner confirmed 2026-10-27).
- Razorpay TEST mode accepts only UPI ID success@razorpay or test cards. Real QR / UPI only work in LIVE mode. Real Live-mode test still to do at the very end.
- 2-step verification: done on Google, GitHub and Backblaze. Razorpay 2-step skipped for now by the owner.

## 12. Play Billing (Android) - design, NOT TESTED
- routes-money.js has only Razorpay. routes-play.js is a separate file that receives RevenueCat webhooks and activates or ends the customer's plan (billingSource "play").
- Play Console product naming: subscription id `cameras_<count>` with base plan ids `monthly` and `yearly` (example `cameras_3:monthly`). One product per camera count the owner wants to sell. Prices in Play must match the slab formula.
- Render env needed: REVENUECAT_WEBHOOK_AUTH (owner's own long secret). Same value goes in RevenueCat > Integrations > Webhooks > Authorization header. Webhook URL: https://secureassistant.onrender.com/api/play/webhook
- The app must log in to RevenueCat with the Firebase user id (otherwise the backend cannot find the customer). The exact FlutterFlow action name is not verified.
- The app must be published to Play (internal testing is enough) before real purchase tests can run.

## 13. FlutterFlow status
9 Postman-collection JSON files in flutterflow/pages: P1 Language, P2 Login-Signup, P3 Categories, P4 Camera-Payment, P5 Live-Cameras, P6 Abdul-Wahab, P7 Storage, P8 Team-Profile and P9-Owner (optional - /owner already works in any browser). Frontend build not started.
Plan: import the JSON API calls, build pages one by one starting with P1 and P2, keep the login token and user id in App State and send "Authorization: Bearer <token>" on every call. Buy FlutterFlow for one month only when ready to build all pages together (the owner lost money before by paying while the backend was unfinished).
The new watch routes (/api/watch/frame) need the camera phone to send frames; that part of the app is not designed yet.

## 14. What is DONE (owner saw it work)
- Node backend live (/health ok:true, seen again 2026-10-28), all cron jobs, Telegram notices, Firestore rules, OWNER_UID.
- Backblaze B2: self-test 6/6 passed; lifecycle setting done; 2-step on.
- vault-test.js: all vault steps passed (2026-10-28).
- /paytest PASS; Razorpay test webhook.
- Python AI on Render Standard: modelLoaded true, a 3-person photo detected correctly; face models ready (/health, 2026-10-28).
- face-test.js: all face steps passed (owner report, 2026-10-28; this file was not reviewed by the helper that wrote this status). Face Matching marked Live in staticData.js.
- No "index missing" line in the Node logs (owner checked 2026-10-28).
- Commit c7174e8 "Face matching live" pushed on 2026-10-28 (4 files: face-test.js, vault-test.js, me.jpg and one changed file, most likely staticData.js). Confirm in Render > Deploys that this commit is Live.
- Legal pages served by the backend.

## 15. What is LEFT
**Files ready (delivered 2026-10-29, put in together on the laptop):** Python folder: app.py. SecureAssistant folder: routes-watch.js (3 tools), index.js, staticData.js, package.json (replaces the old one), watch-test.js, STATUS.md. routes-watch.js and index.js must be pushed together. Then `npm run check`, push both services, check both /health, then run `node watch-test.js`.

**Free, now (the owner's laptop mouse/touchpad was not working on 2026-10-28, so these are waiting):**
1. Remove the personal test photo me.jpg from GitHub: `git rm --cached me.jpg`, add `me.jpg` to .gitignore, commit, push. Also confirm the GitHub repo is Private. NOT confirmed done.
2. Put in the ready files above, push, check both /health.
3. Run `node watch-test.js` with real photos (person standing, bag alone, person lying). Only after it passes: tell the helper so the statuses stay Beta (or become Live later); if it fails, send the message shown.
4. Send core.js and cron.js to the helper: fixes the PRIVACY GAP (erase `faces` and `watch_state` on delete-account, automatic clean-up) and unlocks Attendance.
5. Check that PYTHON_SECRET and PYTHON_AI_URL on the Node service match the Python service.
6. Decide AGORA_DAILY_SESSIONS (2 or 4).
7. DVR bridge real-world test stays on hold (no DVR; do not buy one for this).

**Paid / later:**
1. FlutterFlow Basic for one month - build the 8 pages.
2. Anthropic API credit - then set ANTHROPIC_API_KEY on the Node service (no code change; /health should then show wahabReady:true).
3. RevenueCat + Play products + REVENUECAT_WEBHOOK_AUTH, then a real purchase test from an internal-testing build.
4. Razorpay Live-mode test and Razorpay 2-step verification.
5. Optional: image.js (Sharp) for screenshot compression.

**Rough count of what is still to build (helper's estimate):** about 6 to 8 backend files (core.js and cron.js fixes, routes-attendance.js, index.js, staticData.js, tests, final STATUS.md); 8 FlutterFlow pages (step-by-step guides, API calls, settings); 2 to 3 small custom actions for the camera phone that sends frames; Play Store listing and setup steps. About 20 items, most of them small.

---

## हिंदी सारांश (Hindi summary)
**हो चुका:** Node बैकएंड चालू है; B2 स्टोरेज और vault के टेस्ट पास; /paytest पास; Python AI चल रहा है और चेहरे वाले मॉडल भी तैयार हैं; face-test पास, इसलिए Face Matching "Live" है; Node के logs में "index missing" नहीं है।

**बना है पर असली कैमरे पर चला कर देखा नहीं:** नई `app.py` (`/detect/boxes`), `routes-watch.js` (Unattended Baggage, Loitering, Person Down), नई `index.js`, `staticData.js`, `package.json` और `watch-test.js`। इन्हें एक साथ डालना है। `routes-watch.js` और `index.js` हमेशा साथ में push करनी हैं।

**ज़रूरी चेतावनी:** पक्का नहीं है कि खाता delete करने पर चेहरे की जानकारी (`faces`) मिटती है। असली ग्राहकों के चेहरे इस्तेमाल करने से पहले इसे ठीक करना है, और इसके लिए `core.js` और `cron.js` चाहिए।

**अब करना है (फ़्री):** `me.jpg` को GitHub से हटाना और repo को Private रखना; ऊपर की फ़ाइलें डालकर push करना; `node watch-test.js` चलाना; `core.js` और `cron.js` भेजना; दोनों सर्विस के secret मिलाना; AGORA_DAILY_SESSIONS तय करना।

**बाद में:** हाज़िरी (सहमति से सेल्फ़ी वाली), फिर "Last seen" (पहले वकील की जाँच); पैसे वाले काम: FlutterFlow एक महीना, Anthropic क्रेडिट, RevenueCat से Play Billing, और आख़िर में Razorpay का Live टेस्ट।

**फ़ैसले:** कॉलिंग वाला एजेंट नहीं बनेगा; मार्केटिंग अभी नहीं; पहले ऐप पूरा बनेगा।