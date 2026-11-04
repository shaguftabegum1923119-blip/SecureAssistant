# Secure Assistant - Master Status (updated 2026-11-04)

## शुरू में पढ़िए (हिंदी में, मालिक के लिए)

**इस फ़ाइल का इस्तेमाल कैसे करें:**
1. कोई नई चैट या नया मददगार शुरू करें तो सबसे पहले यही पूरी फ़ाइल उसे दीजिए, फिर अपना सवाल लिखिए।
2. किसी फ़ाइल को बदलवाना हो तो उस फ़ाइल का असली कोड भी साथ में दीजिए। यह फ़ाइल सिस्टम समझाती है, कोड की जगह नहीं लेती।
3. पासवर्ड, `.env`, `serviceAccount.json` या कोई चाबी कभी किसी चैट में मत भेजिए। टर्मिनल के स्क्रीनशॉट में भी पासवर्ड दिखे तो टेस्ट के बाद उसे बदल दीजिए (1 नवंबर के स्क्रीनशॉट में पासवर्ड दिखा था, उसे बदलना बाक़ी है)।

**अभी का हाल (4 नवंबर 2026):**
- **चालू और परखा हुआ (मालिक ने ख़ुद देखा):** Node बैकएंड, स्टोरेज (B2), तिजोरी (vault), भुगतान का टेस्ट (/paytest), Python AI और चेहरे वाले मॉडल, Face Matching (face-test पास)। 4 नवंबर को असली सर्वर पर `watch-test.js` पास हुआ (Loitering, Person Down, Unattended Baggage) और `attendance-test.js` भी पास हुआ (Staff Attendance)। इसलिए ये चारों अब "Live" हैं।
- **GitHub:** रिपो अब Private है। `serviceAccount.json` और `.env` GitHub पर नहीं गए (मालिक ने जाँचा)। `me.jpg` और `person.jpg` हटा दी गई हैं।
- **Node के cron बंद हैं:** फ़्री Render सो जाता है और तब cron को 503 मिलता है, इसलिए cron-job.org में Node वाले सारे job अभी disabled हैं। जगाने वाला हर-5-मिनट का cron नहीं लगाया, क्योंकि उससे Render के महीने के फ़्री घंटे ख़त्म हो जाते। यह लॉन्च से पहले ठीक करना है (नीचे देखिए)।
- **बाक़ी है:** `staticData.js` की नई फ़ाइल (चारों टूल "Live") डालकर GitHub पर भेजनी है; ऐप का फ़्रंटएंड (FlutterFlow) अभी शुरू नहीं हुआ।

**बैकएंड का बाक़ी काम (फ़्रंटएंड से पहले, क्रम से):**
1. नई `staticData.js` डालिए, `npm run check` चलाइए, फिर GitHub पर भेजिए।
2. पासवर्ड बदलिए (स्क्रीनशॉट में दिख गया था)।
3. Render में Node और Python दोनों "Live" हों और दोनों के `/health` ठीक हों, यह देखिए। `PYTHON_SECRET` और `PYTHON_AI_URL` दोनों सर्विस में एक-से हों।
4. `AGORA_DAILY_SESSIONS` तय कीजिए (2 या 4)।
5. Privacy पेज में `/face-data` का लिंक जोड़िए।
6. **असली ग्राहकों से पहले (पैसे लगेंगे):** Node को पेड प्लान पर ले जाइए (Render Starter, क़रीब ₹630 महीना), फिर cron-job.org के सारे Node वाले job दोबारा चालू कीजिए। इनके बंद रहने तक ये काम नहीं चलते: कैमरा-हेल्थ अलर्ट, रोज़ की रिपोर्ट, मालिक का डाइजेस्ट, पुराना स्टोरेज साफ़ करना, पुराना वॉच/हाज़िरी डेटा हटाना, और **ग्राहक के खाता-हटाने के अनुरोध पूरे करना**।
7. पैसे वाले टेस्ट, बाद में: Razorpay Live-mode, RevenueCat और Play Billing का असली ख़रीद-टेस्ट, Anthropic क्रेडिट (तब अब्दुल वहाब चालू होगा)।
8. वकील से सारे क़ानूनी पेज दिखवाइए।

इन सबके बाद FlutterFlow के पेज बनाइए: `ALL-PAGES-designer-prompts.md` में 14 पेज के प्रॉम्प्ट हैं (गोल्डन-सफ़ेद शैली, "i" मदद बटन, आवाज़/टाइप/ब्राउज़ खोज)। पुराने पेज की शैली से मिलाने के लिए पुराना पेज भेजिए।

**फ़ैसले जो हो चुके (दोबारा मत पूछिए):** कुछ भी मुफ़्त नहीं और कोई फ़्री ट्रायल नहीं; कॉलिंग वाला एजेंट नहीं बनेगा; अभी मार्केटिंग नहीं; अभी पैसे वाले नए टूल (जैसे Claude Code) नहीं लेने; पहले ऐप पूरा बनाना है।

---

## English section (for any helper or AI - read fully)

Give this whole file to any new chat/AI/helper FIRST. If they also need to edit a specific file, paste that file's actual code too - this document explains the system, it does not replace the code.

**Rules for any helper (from the owner):**
- Reply in Hindi (Devanagari), ONE language per reply, short. When she asks for "one line" or "within 10 words", do exactly that.
- All code, page text and in-code messages must be pure English (she speaks Roman Hindi, but nothing in Hindi/Hinglish goes inside code or app pages).
- She works around housework and uses only the VS Code terminal (no GitHub web UI), so keep steps small.
- When a file must change, give the FULL new file, never a "find this line and edit" instruction.
- She now prefers to receive ALL files of a batch together, put them in, push, and then test one by one with the helper looking at screenshots. When she asks for "the file", give just the file and at most one short line. Never repeat a file she already has.
- Never ask her to paste secrets (.env, service account JSON, keys, tokens, passwords).
- Free tasks first, paid tasks later. Her budget and time are limited (up to about 5 hours a day): never suggest a new paid tool unless she asks.
- No free trial, nothing free in the app. Everything is behind payment.

**Honesty rule:** only mark something DONE if the owner saw it work. Code a helper wrote but nobody ran on the real system is NOT TESTED (a helper's own simulated test does not count as DONE).

---

## 1. What the app is and does
Secure Assistant is a CCTV/camera monitoring app for shops, supermarkets, factories, offices, religious places, farms and roads. Customers connect cameras (old phone as CCTV, IP camera, DVR, or their own phone) and get: person/vehicle counting, intrusion and crowd alerts, camera health monitoring, encrypted video storage, consent-based face matching, watch tools (baggage, loitering, person down), selfie attendance, and an AI advisor (Abdul Wahab) that gives business and security advice in the customer's own language (needs the Anthropic key, currently OFF).
Owner income: monthly/yearly subscription per camera, extra storage packs.
Target platforms: Android, iPhone and desktop, all from one FlutterFlow project (in-app purchases work only on Android/iOS, not web/desktop).

**What the app can NOT do yet (never promise these):**
- Find a person in old DVR/NVR recordings ("who came when, from where", "where is this missing person"). The DVR bridge only registers and sends heartbeats; it cannot read recordings. A real version needs: pulling recordings from the DVR (each brand differs; usually a small program on the customer's PC), face search over hours of video (heavy server), written consent and a lawyer's approval. Estimated at months, not weeks.
- Show where one person is across cameras ("Last Seen", e.g. where is officer X). Not built. Needs a lawyer's check (tracking staff), consent and notice.
- Toll collection, wheel tax or running government road CCTV. Needs number plate reading (not built) and payment/government systems.
- Replace a person watching the cameras completely. The app gives alerts, counts, reports and attendance; do not advertise "no operator needed".
- Fire/smoke, weapon, number plate, scream sound detection (no models yet).
- What a person was doing, or answers about things the camera data does not contain.

## 2. Services and URLs
- Backend (Node.js/Express): https://secureassistant.onrender.com (Render, FREE plan, so it goes to sleep). The cron-job.org jobs that call it are DISABLED since 2026-11-04 (a sleeping service answers 503). A keep-awake ping was NOT set up, because it would use up Render's monthly free hours. Before real customers: move Node to a paid plan and re-enable the cron jobs (section 6). After a long sleep the first request can take a minute.
- Python AI (Flask + YOLOv8n + OpenCV face models): https://secureassistant-1.onrender.com (Render **Standard plan, $25/month, 2 GB RAM**). Working since 2026-10-27. On 2026-10-31 the root page showed modelLoaded:true, faceModels:"ready", faceError:null. The new app.py (with /detect/boxes) is on GitHub (checked with `git show origin/main:...` on 2026-10-31); confirm in Render that the Python service finished deploying it.
- Firebase project: assistant-74894 (Auth + Firestore, Admin-SDK-only; the app never talks to Firestore directly). Firestore rules published (deny all client access). Firebase Storage is not used. Firestore location asia-south1.
- Payments: Razorpay (website, TEST mode) + Google Play Billing inside the Android app (see section 12).
- Live video: Agora.
- File storage: Backblaze B2 (S3-compatible, us-west-004), private bucket `secure-assistant-files`. Files are encrypted per customer on the SERVER before upload (not on the phone - never claim device-side encryption).
- Owner notices: Telegram bot (/health shows ownerNoticesReady:true).
- Cron: cron-job.org (6 jobs that call the Node service; all DISABLED since 2026-11-04, see section 6).
- Code: GitHub (https://github.com/shaguftabegum1923119-blip/SecureAssistant, PRIVATE since 2026-11-04, confirmed by the owner; serviceAccount.json and .env are not on GitHub, checked by the owner) -> auto-deploys to Render on push. Pushes are done from the VS Code terminal.
- Frontend: FlutterFlow (build not started).
- Google Play Console: $25 registration already paid.

## 3. App page flow (8 pages + new AI tool pages)
1. Language (179) 2. Login/Signup (email+password, phone OTP, Google) 3. Categories (13, incl. "Other - My Own Business") 4. Camera setup + payment (8 camera methods, price by camera count) 5. Live cameras (opens after payment) 6. Abdul Wahab chat (text, voice, photo) 7. Storage (5 GB free + extra packs) 8. Team and profile (max 3 app holders, unlimited staff).
New (P10, not built): Face Matching, Add a Person, Staff Attendance, Watch Tools.
Privacy, Terms, Refund, Delete-account and Face Data pages are NOT app pages: the backend serves them at /privacy, /terms, /refund, /delete-account, /face-data, so the app only needs buttons that open those links.

## 4. Files
**Node backend folder (SecureAssistant):** index.js, core.js, b2Storage.js, routes-account.js, routes-cameras.js, routes-money.js, routes-play.js, routes-facematch.js, routes-watch.js, routes-attendance.js, routes-wahab.js, routes-help.js, routes-agent.js, routes-dvr.js, routes-owner.js, routes-pdf.js, cron.js, staticData.js, package.json, check-backend.js, run-login-checks.js, test scripts (vault-test.js, face-test.js, watch-test.js, attendance-test.js), dvr-files/, folder legal/ (privacy, terms, refund, delete-account, face-data.html).
- `npm run check` (syntax check of all files) passed on 2026-10-31 before the last pushes.
- index.js loads: routes-account, routes-cameras, routes-money, routes-play, routes-facematch, routes-watch, routes-attendance, routes-wahab, routes-help, routes-agent, routes-dvr, routes-owner, routes-pdf, cron. index.js, routes-watch.js and routes-attendance.js must always be pushed together.
- core.js: shared setup. eraseUserData now also erases `watch_state` and `attendance` (face templates in `faces` and the `faces/` storage files were already erased).
- cron.js: includes POST /api/cron/watch-cleanup (removes expired `watch_state` and `attendance` records).
- .gitignore (clean UTF-8 version, 2026-10-31): node_modules/, .env, .env.*, *.log, me.jpg, person.jpg, bag.jpg, down.jpg, people.jpg, other.jpg, serviceAccount.json, .DS_Store, __pycache__/, *.pyc. Note: never edit .gitignore with PowerShell `echo >>` (it saves the wrong text encoding).
- Git history: c7174e8 "Face matching live" (2026-10-28); 76d5787 "Remove test photo" (routes-watch.js and watch-test.js pushed; first attempt to stop tracking me.jpg); 6df82a0 "Attendance and face data page" (core, cron, index, staticData, package.json, routes-attendance, attendance-test, face-data.html; person.jpg went up by mistake); deb7cc3 "Add app.py, move face data page" (face-data.html moved to legal/; me.jpg and person.jpg no longer tracked by GitHub).
- Test photos on the laptop (not in git): person.jpg, bag.jpg, down.jpg in the SecureAssistant folder (AI-made CCTV-style pictures); me.jpg and people.jpg in secure-assistant-ai/. Photos should be cropped (no black bars or screenshot notices) before testing.

**Python AI folder (secure-assistant-ai):** app.py, requirements.txt, yolov8n.pt, face_detection_yunet_2023mar.onnx, face_recognition_sface_2021dec.onnx, test photos.
- requirements.txt uses the CPU-only torch build (torch 2.4.1+cpu) to save memory; ultralytics 8.3.0.
- app.py: the YOLO model is loaded in a background thread; a fork fix (`os.register_at_fork`) restarts the loader inside the gunicorn worker. /health shows modelLoaded, modelState (loading / loaded / failed), faceModels and faceError; logs print lines starting with `[ai]`. POST /detect/boxes returns people, backpacks, handbags and suitcases with positions as fractions of the picture.
- Render settings for the Python service: PYTHON_VERSION=3.11.9, Start Command `gunicorn app:app --workers 1 --threads 2 --timeout 120 --bind 0.0.0.0:$PORT`.

**Privacy rule for owner:** the owner sees only `{id, planActive, planExpiry}` for customers - never name, email or phone. Owner identity is set with OWNER_UID.

**Security notes:** routes-dvr.js stores only the SHA-256 hash of the bridge token. Refund / plan change / delete account / update info are never auto-run by the agent - only logged in `pending_approvals` for the owner.

**Licence warning:** the Ultralytics YOLO code is under AGPL-3.0 (commercial use may need their paid licence). Ask a lawyer or check Ultralytics' licence terms before charging customers. Every model added later also needs its licence checked (Apache-2.0 / MIT are fine; AGPL, GPL and non-commercial are not).

## 5. API routes
- Help: GET /api/help/pages, /api/help/page/:id, /api/help/categories, /api/help/category/:id (public); GET /api/home/data (login).
- Support: POST /api/support/chat, /api/support/ticket, /api/support/request-approval; GET /api/support/tickets, /api/support/approvals.
- DVR: POST /api/dvr/register, POST /api/dvr/heartbeat (header X-Bridge-Token), GET /api/dvr/list, DELETE /api/dvr/:id.
- Payment webhook (Razorpay): POST /api/payment/webhook.
- Play webhook (RevenueCat): POST /api/play/webhook (NOT TESTED).
- PDF report: GET /api/report/pdf?days=1 (NOT TESTED; login + active plan needed).
- Face matching (login + active plan; tested by face-test.js): POST /api/facematch/enroll (form: face, name, role, purpose, consent=true, timezone), POST /api/facematch/identify (form: face), GET /api/facematch/list, DELETE /api/facematch/:id.
- Watch tools (real-server test watch-test.js PASSED, owner report 2026-11-04): POST /api/watch/frame (form: frame, cameraId, optional tools = any of bag, loiter, down separated by commas - default bag,loiter, down must be asked for; aloneSeconds 30-1800, loiterSeconds 30-3600, downSeconds 15-1800, zone = "x1,y1,x2,y2" as fractions 0-1), GET and DELETE /api/watch/state/:cameraId.
- Attendance (real-server test attendance-test.js PASSED, owner report 2026-11-04): POST /api/attendance/checkin (form: face, type in/out, timezone, optional confirmPersonId), GET /api/attendance/today?timezone=, GET /api/attendance/report?from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=&personId=, DELETE /api/attendance/record/:id, DELETE /api/attendance/person/:personId.
- Cron (header X-CRON-SECRET): /api/cron/camera-health, daily-report, owner-digest, storage-cleanup, process-deletions, watch-cleanup. All six cron-job.org jobs are disabled for now (section 6).
- Photo/video analysis from the app: POST /api/analytics/frame (counts only, image not stored) and POST /api/video/upload-analyze. There is NO route called /api/detect/person.
- Python service: POST /detect, POST /detect/boxes, POST /face/embed (all with header X-CORE-SECRET), GET /health.
- Auth rule: the server reads the customer record from Firestore `users/<Firebase Auth UID>`. The document name must equal the UID. After a customer deletes and recreates an account the UID changes and the old document is useless.
- Optional Render env (Node): ANTHROPIC_API_KEY (needed for chat/agent, currently NOT set, so /health shows wahabReady:false), ANTHROPIC_MODEL, ANTHROPIC_MODEL_FAST, SUPPORT_DAILY_LIMIT, DVR_MAX_BRIDGES, DVR_HEARTBEATS_PER_HOUR, OWNER_TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_CHAT_ID, AGORA_DAILY_SESSIONS, REVENUECAT_WEBHOOK_AUTH (for Play Billing, not set yet), FACE_MATCH_MIN (default 0.363), FACE_CONFIRM_BELOW (default 0.5), FACE_MAX_PER_USER (default 50), ATTENDANCE_KEEP_DAYS (90), ATTENDANCE_MIN_GAP_MIN (10), ATTENDANCE_MAX_PER_HOUR (200), PYTHON_TIMEOUT_SEC (60).
- Optional env for the watch tools (all have defaults): BAG_ALONE_SECONDS 180, BAG_MIN_FRAMES 3, BAG_KEEP_MISSING_SEC 90, BAG_MATCH_DIST 0.08, LOITER_SECONDS 300, LOITER_MIN_FRAMES 3, LOITER_RADIUS 0.08, PERSON_MATCH_DIST 0.15, PERSON_KEEP_MISSING_SEC 60, DOWN_SECONDS 60, DOWN_MIN_FRAMES 3, DOWN_RATIO 1.3, DOWN_MIN_WIDTH 0.10, DOWN_RADIUS 0.10, DOWN_KEEP_MISSING_SEC 45, WATCH_MIN_GAP_SEC 3, WATCH_MAX_PER_MIN 30, WATCH_MAX_ALERTS_PER_HOUR 10. Python env: YOLO_BOX_IMG_SIZE (default 640).

## 6. Cron jobs (cron-job.org, header X-CRON-SECRET)
**STATUS 2026-11-04: all six jobs are DISABLED.** The Node service is on the free Render plan and sleeps, so the jobs got 503. A keep-awake ping every 5 minutes was not added because it would use up Render's monthly free hours. Re-enable them after Node moves to a paid plan (Render Starter, about Rs 630/month).
Jobs: camera-health (every 10 min), daily-report (hourly), process-deletions (hourly), storage-cleanup (daily), owner-digest (daily), watch-cleanup (daily, e.g. 03:00; URL https://secureassistant.onrender.com/api/cron/watch-cleanup, method POST, header X-CRON-SECRET).
While they are off: no offline-camera alerts, no daily reports or owner digest, old storage and expired `watch_state`/`attendance` records are not removed, and customers' account-deletion requests are NOT processed. This is acceptable with no customers; it is NOT acceptable with real customers.
Form tip for cron-job.org: choose "Every day at" (not "Custom" with an empty crontab box - that gives "malformed job"); "Import from cURL" fills URL, method and header automatically. After re-enabling, press "Test run" on each job; {"ok":true} is the expected answer.

## 7. Final pricing and product decisions (do not re-ask)
- Camera subscription per month: Rs 99/camera (1-2 cams), Rs 85 (3-5), Rs 70 (6-9), Rs 60 (10+). Total = camera count x slab rate. Yearly = 11 months' price. Example: 100 customers x 3 cameras x Rs 85 = Rs 25,500 a month before Razorpay/Google fees, GST and server cost.
- Free storage 5 GB/customer. Extra packs (30 days): 10 GB Rs 39, 50 GB Rs 189, 100 GB Rs 379, 500 GB Rs 1899.
- No free trial and nothing free (reconfirmed 2026-10-31: people would open many accounts and use up the server). Live video 20 min/customer/day (5 min x 4 sessions) - see cost note in section 10.
- Billing: Google Play Billing inside the Android app (required by Play for digital subscriptions); Razorpay/UPI only on the website. PayPal is NOT used. Google takes about 15 to 30 percent of Play payments.
- AI agent: ONE agent (Abdul Wahab, also support). Anthropic only: Sonnet for expert/legal/medical/photo questions, Haiku for routine ones. Gemini/Google not used. The owner wants it to give expert-style guidance per category (school, supermarket sales and marketing, etc.) from the customer's own camera/sales numbers and photos. routes-wahab.js was NOT reviewed in the latest sessions: check that it uses the customer's category in its prompt and add that if it does not.
- Security wording: only "Encrypted" and "Privacy-first". Never "100 percent" or "cannot be hacked".
- Category 8 (Police/Jail/Courts) kept; Army Camps, Border Posts and any "Military" category removed. Bank account routes removed.
- Refund policy (refund.html): double charge or no activation = refund; low usage within 7 days = case by case; otherwise no refund; refund window 5-7 days.
- Legal pages dated 25 Oct 2026 (face-data.html added 30 Oct 2026). Contact email in pages: secureassistant2319@gmail.com.
- Tools NOT used: Chromium/puppeteer (PDF reports use pdfkit), Docker, Notion API, Tesseract OCR, FFmpeg, Claude Code (declined 2026-11-01 because of cost). Sharp is installed but no image.js has been written yet.
- Decided 2026-10-28: NO phone-calling voice agent, and no marketing work for now - finish building first.
- Launch plan: the owner wants to launch only when the app is complete. The helper advised a first version (all Live + Beta tools, pages, payments, Play Store) and a later second version (DVR search, model-based tools); the owner has not decided. Do not remove this open question.
- Build order done so far: Face Matching (Live) -> Unattended Baggage, Loitering, Person Down (Live after watch-test.js passed 2026-11-04) -> Staff Attendance (Live after attendance-test.js passed 2026-11-04). Next candidates: model-based tools, see section 8b.

## 8. AI tools - what's real
22 tools in staticData.js. The version that makes the 4 tools below Live was prepared on 2026-11-04 (the copy on GitHub from 2026-10-31 still shows them as Beta until the owner pushes the new file).
- LIVE (11): Face Matching (Consent Based), Person Detection and Counting, Loitering Detection, Person Down Detection (Possible Fall), Vehicle Detection, Crowd Detection, Unattended Baggage Detection, QR Generator and Scanner, Camera Health Monitoring, Encrypted Capsule Save, Staff Attendance (Selfie Check-in).
- BETA (5): Intrusion Detection, Offline Revive and Rewind, Camera Placement Advisor, Live Location and Status Share, Proof Capsule with Time Window. "Beta" = built but not fully tested on real cameras; do not rely on it. Loitering, Person Down, Unattended Baggage and Staff Attendance moved from Beta to Live on 2026-11-04 after the owner's real-server tests passed.
- COMING_SOON (6, never sell as working): Number Plate ANPR, Fire/Smoke, Weapon, Audio Scream, Visitor Background Intelligence, Smart Search/Loyal Customer History.
- Coverage: 13 categories, 54 tool slots; 44 slots (about 81 percent) are Live or Beta (31 Live + 13 Beta) and 10 slots belong to the 6 coming-soon tools. Every category has at least one Live tool: 11 categories show status "live" (2 or more Live tools) and 2 show "limited" (Police Jail Security and Agriculture and Farms, 1 Live tool each). A category no longer always has a Beta tool. The app can launch without the 6 coming-soon tools.
- Rule: a tool becomes Live only after the owner has seen it work (real-server test with photos or a real camera); if a real test fails, set it back to beta or coming_soon. Watch tools and attendance passed photo-based real-server tests; a long run on a real moving camera feed has not been done yet.

**Face Matching details:** works on photos the customer sends, it does NOT watch cameras by itself. OpenCV YuNet (detector) + SFace (recognizer), run by the Python service. A face photo becomes a 128-number template; only the template is stored (encrypted per customer, Firestore collection `faces`), the photo is never saved. Only people added with consent can be matched. Limit 50 people per customer. Score thresholds: 0.363 = published SFace "same person" value, 0.5 = confirm-below value (the helper's own estimate - needs real-world tuning). It is a helper, not proof of identity. Faces that are far away, from the side, small or at night often fail.

**Privacy check (done 2026-10-30):** deleting an account erases face templates (`faces` and the `faces/` storage files), `watch_state` and `attendance`. Expired `watch_state` (2 days) and `attendance` (ATTENDANCE_KEEP_DAYS, default 90) records are removed by the daily watch-cleanup job. The page legal/face-data.html (opens at /face-data) explains face codes, attendance and the watch tools. Still needed before real customers: a link to /face-data from the main Privacy page and from the app, and a lawyer's check of all legal pages. A claim in face-data.html ("customer photos are not used to train models") is true for the current code but is the owner's promise: confirm she is happy with it.

**Watch tools (routes-watch.js, Live):** the camera phone sends a frame every few seconds to POST /api/watch/frame. Only positions and times are stored (Firestore `watch_state`, auto-expiring field `expiresAt`, 2 days). No photo, no face, nobody is identified. At most 10 alerts per camera per hour. Alerts go through createAlert with the types "Unattended Baggage", "Loitering" and "Person Down".
- Unattended Baggage: a bag with nobody near it for about 3 minutes (and at least 3 frames) gives ONE alert.
- Loitering: a person staying in the same small area for about 5 minutes gives ONE alert. Staff who always stand in one place give false alerts, so the app should send a `zone`. Follows positions, not faces.
- Person Down (must be asked for with tools=down): a person whose box is at least 1.3 times wider than tall (and at least 10 percent of the picture wide) and who does not move for about 60 seconds gives ONE alert. It cannot tell a fall from lying down on purpose, can miss a fall the camera did not see, and is NOT a medical device.
- Not verified: that `createAlert` shows the new alert types in the app; real-camera behaviour; the new /detect/boxes memory use on the Python server.

**Attendance (routes-attendance.js, Live):** a person who was added with consent takes a selfie; the server matches it and saves only name, in/out, time and match score (never the photo). Weak matches (score under 0.5) need a human confirm (confirmPersonId). Same person and same type within 10 minutes is ignored. Only the account owner reads reports. Weak points: no live-person check (a photo of a photo can fool it); Firestore may ask for an index (attendance: uid + created) - the log shows a link, the code works without it meanwhile.

**Real test status (updated 2026-11-04):**
- watch-test.js: PASSED on the real server (owner report 2026-11-04), including Person Down. Earlier failures were setup only: a photo path typed into the password step; an empty email created a temporary account without a plan; no internet once; and finally the Firestore `users/<current UID>` document was missing (the old document belonged to a deleted account). The owner created `users/<UID>` with isPro true, planExpiry (number), email and timezone, and the 403 "Active subscription required" went away.
- attendance-test.js: PASSED on the real server (owner report 2026-11-04).
- A test payment record exists (2026-10-25): Rs 99, 1 camera, monthly, 30 days, verified:true, plan end 2026-11-24 (user id lqYESc..., a deleted/other account).

## 8b. The 6 coming-soon tools - honest plan
- Why they are off: they need extra AI models that are not on the server and that the helper cannot download or test; false alarms are dangerous for weapon and fire; two of them (Visitor Background Intelligence, Smart Search/Loyal Customer History) are visitor/person-history features that need a lawyer first.
- Number plate (ANPR): the `fast-alpr` pip package (MIT licence, ONNX, models download themselves). Needs real Indian plate photos for testing; plates are personal data (update the privacy text).
- Scream / glass-break sound: YAMNet audio model (Apache 2.0, ONNX version on Hugging Face "audiomagic/yamnet-onnx") plus its class-map csv. The camera phone would have to send short audio clips (new FlutterFlow custom action); recording sound has legal rules (lawyer); never store the audio.
- Fire/smoke: look for a small ONNX model on Hugging Face with a permissive licence (some exist; check licence and class names); expect false alarms from lamps, sunsets, steam; confirm over several frames; keep Beta.
- Weapon: NOT recommended now (false alarms cause panic/police calls; missed weapons give false safety). Needs the owner's own checked data and a lawyer.
- How to add a model: open the model page, check the licence tag, download the .onnx file, put it in secure-assistant-ai/, send the helper the file name, class names and 3-4 test photos (some with the object, some without). The helper writes the endpoint and a test; the owner tests; only then Live/Beta.
- The Python Standard plan has 2 GB RAM; several models together may need a bigger plan - check Render > Python service > Metrics.

## 9. Python AI service
- Fixed 2026-10-27: the old 502 was not enough RAM on the free plan plus a heavy torch build. Fixed with the Standard plan, the CPU-only torch build and the app.py fork fix.
- Proof: /health shows modelLoaded:true, modelState:loaded; a test photo with 3 people returned 3 "person" detections. Face models: faceModels:"ready".
- Not tested: whether the cheaper Starter plan ($7, 512 MB) would be enough now (keep Standard); video analysis; the new /detect/boxes at 640 px on the real server.

## 10. Costs (approx, INR at ~Rs 90/USD)
- Fixed per month now: Render Standard for the Python AI ~Rs 2,250. Node backend is on the free plan for now (it sleeps, so the cron jobs are off; see section 6). Firebase, Telegram, cron-job.org free.
- Later: FlutterFlow Basic ~Rs 1,300 (buy for ONE month only when ready to build all pages in one go); Anthropic API prepaid credit (amount chosen by the owner; credits last one year, are not refundable, keep auto-reload off; Abdul Wahab costs about Rs 3-30 per customer per month); Render Starter ~Rs 630/month for Node, needed before real customers so the cron jobs can run.
- Per customer: B2 ~Rs 3 if the 5 GB is full; Agora live video is the biggest cost (~Rs 0.36 per HD minute after 10,000 free minutes/month).
- Open decision: AGORA_DAILY_SESSIONS=2 (10 min/day, safer margin) or 4 (20 min/day).
- RevenueCat (for Play Billing): free until about $2,500 monthly tracked revenue, then about 1 percent. Not verified: whether webhooks are available on the free level - check the RevenueCat dashboard (Integrations > Webhooks).
- Claude Code / Claude Pro were discussed and declined for now (needs a paid Claude plan; Pro is about $20 a month).

## 11. Razorpay and testing status
- Test-mode webhook created: https://secureassistant.onrender.com/api/payment/webhook (payment.captured, subscription.charged / cancelled / halted / completed).
- TEST payment and the /paytest page: PASS (owner confirmed 2026-10-27); a verified test payment record exists in Firestore `payments` (2026-10-25).
- Razorpay TEST mode accepts only UPI ID success@razorpay or test cards. Real QR / UPI only work in LIVE mode (needs KYC). Real Live-mode test still to do at the very end.
- 2-step verification: done on Google, GitHub and Backblaze. Razorpay 2-step skipped for now by the owner.

## 12. Play Billing (Android) - design, NOT TESTED
- routes-money.js has only Razorpay. routes-play.js is a separate file that receives RevenueCat webhooks and activates or ends the customer's plan (billingSource "play").
- Play Console product naming: subscription id `cameras_<count>` with base plan ids `monthly` and `yearly` (example `cameras_3:monthly`). One product per camera count the owner wants to sell. Prices in Play must match the slab formula.
- Render env needed: REVENUECAT_WEBHOOK_AUTH (owner's own long secret). Same value goes in RevenueCat > Integrations > Webhooks > Authorization header. Webhook URL: https://secureassistant.onrender.com/api/play/webhook
- The app must log in to RevenueCat with the Firebase user id (otherwise the backend cannot find the customer). The exact FlutterFlow action name is not verified.
- The app must be published to Play (internal testing is enough) before real purchase tests can run. New Play accounts may be asked for a closed test with testers before production - check in Play Console.

## 13. FlutterFlow status
Postman-collection JSON files in flutterflow/pages: P1 Language, P2 Login-Signup, P3 Categories, P4 Camera-Payment, P5 Live-Cameras, P6 Abdul-Wahab, P7 Storage, P8 Team-Profile, P9-Owner (optional), and **P10-AI-Tools.json** (13 calls: Face Matching 4, Watch tools 3, Attendance 6). Page design prompts: **ALL-PAGES-designer-prompts.md** (14 pages: the 8 core pages plus AI Tools hub, Face Matching, Add a Person, Staff Attendance, Watch tools, Camera phone mode; "white and shining gold" look; every page has an "i" help button and Voice/Type/Browse search for long lists). It replaces the older P10-designer-prompts.md. A Page 1 (Language) mockup in that style was approved by the owner: https://claude.ai/artifact/74jbLNCCoKDZntFLdP649X. Frontend build not started.
- The owner wants the new pages to match her older pages: she will send an older page prompt/JSON as a reference and the helper will adjust the prompts to match.
- Plan: import the JSON API calls, build pages one by one starting with P1 and P2, keep the login token and user id in App State and send "Authorization: Bearer <token>" on every call. Buy FlutterFlow for one month only when ready to build all pages together (the owner lost money before by paying while the backend was unfinished).
- The camera phone must send frames to /api/watch/frame; that custom action is not designed yet.

## 14. What is DONE (owner saw it work)
- Node backend live (/health ok:true), all older cron jobs, Telegram notices, Firestore rules, OWNER_UID.
- Backblaze B2: self-test 6/6 passed; lifecycle setting done; 2-step on.
- vault-test.js: all vault steps passed (2026-10-28).
- /paytest PASS; Razorpay test webhook; test payment record verified.
- Python AI on Render Standard: modelLoaded true, a 3-person photo detected correctly; face models ready.
- face-test.js: all face steps passed (owner report, 2026-10-28). Face Matching marked Live in staticData.js.
- watch-test.js PASSED (Loitering, Person Down, Unattended Baggage) and attendance-test.js PASSED on the real server (owner report 2026-11-04); the Firestore `users/<UID>` fix made them work.
- GitHub repo made PRIVATE (2026-11-04); serviceAccount.json and .env checked: not on GitHub.
- GitHub pushes of watch tools, attendance, core, cron, index, staticData, package.json, app.py and face-data page (2026-10-30 and 2026-10-31); `npm run check` passed; the backend started locally on port 3000 (2026-10-30).
- me.jpg and person.jpg removed from GitHub; serviceAccount.json added to .gitignore.
- Legal pages served by the backend.

## 15. What is LEFT
**Backend, free, now (in this order):**
1. Put the new staticData.js (4 tools Live) in the folder, run `npm run check`, push to GitHub.
2. Change the account password that appeared in screenshots.
3. Render: both services Live; both /health fine. Check PYTHON_SECRET and PYTHON_AI_URL on the Node service match the Python service.
4. Decide AGORA_DAILY_SESSIONS (2 or 4).
5. Add a link to /face-data on the main Privacy page.
6. Not verified yet: that createAlert shows the new alert types (Unattended Baggage, Loitering, Person Down) in the app; the PDF report route; the Play webhook.
7. DVR bridge real-world test stays on hold (no DVR; do not buy one for this).

**Before real customers (paid):**
1. Move the Node service to a paid Render plan (Starter, about Rs 630/month), then re-enable all six cron-job.org jobs and "Test run" each one (section 6). Without this, account-deletion requests are not processed.
2. A lawyer checks all legal pages.

**Paid / later:**
1. FlutterFlow Basic for one month - build the pages (send older page prompts first so the new ones match).
2. Anthropic API credit - then set ANTHROPIC_API_KEY on the Node service (no code change; /health should then show wahabReady:true). Also review routes-wahab.js for category-aware advice.
3. RevenueCat + Play products + REVENUECAT_WEBHOOK_AUTH, then a real purchase test from an internal-testing build.
4. Razorpay Live-mode test and Razorpay 2-step verification.
5. Model-based tools one by one (section 8b), and the Python plan size.
6. DVR recording search / Last Seen: only after launch, with a lawyer and a real DVR (big project).
7. Optional: image.js (Sharp) for screenshot compression.

**Rough time (helper's guess, not a promise):** first launch version (all Live + Beta tools tested, FlutterFlow pages, camera-phone frame sender, payments, Play Store) about 5 to 7 weeks at 2-3 hours a day, or about 3 to 4 weeks at 5 hours a day. Model-based tools: roughly 3 to 4 more weeks. DVR search: months.

## 16. Terminal cheat-sheet (VS Code terminal, folder SecureAssistant)
- Check all files: `npm run check`
- Send to GitHub: `git add .` then `git commit -m "short message"` then `git push` then `git status` ("nothing to commit" and "up to date with origin/main" = done). If push says "Could not resolve host", the internet is down: fix it and run `git push` again.
- Stop git tracking a file but keep it on the laptop: `git rm --cached filename`
- List photos in the folder: `dir *.jpg`
- Check a file reached GitHub: `git show origin/main:secure-assistant-ai/app.py | Select-String "detect/boxes"`
- Real-server tests: `node watch-test.js`, `node attendance-test.js` (answer each question on its own line; type photo names only, like person.jpg; put the email in the email line - an empty line makes a temporary account without a plan).
- A pending line "Web API key": Firebase console > Project settings > General.

---

## हिंदी सारांश (बाक़ी बातें)
**हो चुका:** Node बैकएंड चालू; B2 स्टोरेज और vault के टेस्ट पास; /paytest पास; Python AI चल रहा है और चेहरे वाले मॉडल तैयार हैं; face-test, watch-test और attendance-test असली सर्वर पर पास हुए; GitHub रिपो Private है।

**22 टूल:** 11 चालू, 5 बीटा (असली टेस्ट बाक़ी), 6 बनने बाक़ी (नंबर प्लेट, आग-धुआँ, हथियार, चीख़ की आवाज़, आगंतुक का इतिहास, स्मार्ट सर्च)। 13 श्रेणियों की 54 टूल-जगहों में से 44 चालू या बीटा हैं (31 चालू, 13 बीटा), इसलिए पहला लॉन्च इन 6 के बिना हो सकता है।

**अभी ऐप क्या नहीं करता (ग्राहक से वादा मत कीजिए):** पुरानी DVR रिकॉर्डिंग में किसी को ढूँढना; "वह आदमी अभी कहाँ है"; टोल या सरकारी सड़क के कैमरे; कैमरे के पास बैठने वाले आदमी की पूरी जगह लेना।

**कमाई:** हर कैमरे का महीने का पैसा (₹99, ₹85, ₹70, ₹60) और एक्स्ट्रा स्टोरेज के पैक। कुछ भी मुफ़्त नहीं।

**अब क्या:** ऊपर "बैकएंड का बाक़ी काम" की सूची क्रम से। Node के cron अभी बंद हैं; असली ग्राहकों से पहले Node को पेड प्लान पर ले जाकर इन्हें चालू करना ज़रूरी है।

**बाद में (पैसे वाले):** FlutterFlow एक महीना, Anthropic क्रेडिट, RevenueCat से Play Billing, Razorpay का Live टेस्ट। बड़ा काम: DVR में खोज और "Last Seen", जो लॉन्च के बाद, वकील की जाँच के साथ।

**समय का अंदाज़ा:** पहला लॉन्च लगभग 5 से 7 हफ़्ते (रोज़ 2-3 घंटे), या 3 से 4 हफ़्ते (रोज़ 5 घंटे)। यह सिर्फ़ अंदाज़ा है।

**फ़ैसले:** कॉलिंग वाला एजेंट नहीं; अभी मार्केटिंग नहीं; कोई फ़्री ट्रायल नहीं; पहले ऐप पूरा बनेगा। "पूरा लॉन्च बनाम पहला वर्शन" अभी आपको तय करना है।