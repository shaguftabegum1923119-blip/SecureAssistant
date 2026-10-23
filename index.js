'use strict';
// SECURE ASSISTANT BACKEND - V15 (main file).
// Files: index.js, core.js, b2Storage.js, routes-account.js, routes-cameras.js, routes-money.js, routes-wahab.js, routes-help.js, routes-agent.js, routes-dvr.js, routes-owner.js, cron.js, staticData.js
const core = require('./core');
const { PORT, clientIp, cors, express, helmet, multer, notifyOwner, rateLimit } = core;

// ---------- APP + MIDDLEWARE ----------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use('/api/payment/webhook', express.raw({ type: 'application/json' })); // MUST be before express.json
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // mobile apps send no Origin
    try {
      const allowed = (process.env.FRONTEND_URL || '').split(',').map(s => s.trim()).filter(Boolean);
      if (allowed.includes(origin)) return cb(null, true);
      const h = new URL(origin).hostname;
      if (['.flutterflow.app', '.flutterflow.io'].some(s => h.endsWith(s))) return cb(null, true);
      if (h === 'localhost' || h === '127.0.0.1') return cb(null, true);
    } catch (e) { /* fall through */ }
    return cb(new Error('CORS blocked'));
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// General limit per client. Health check and cron routes are not counted here (cron is protected by its secret).
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: clientIp,
  skip: req => req.path === '/health' || req.path.startsWith('/api/cron/')
}));

// Route files, loaded in this order
for (const file of ['./routes-account', './routes-cameras', './routes-money', './routes-wahab', './routes-help', './routes-agent', './routes-dvr', './routes-owner', './cron']) {
  require(file)(app, core);
}

// ---------- ERRORS ----------
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Upload error: ' + err.message });
  if (err.message === 'CORS blocked') return res.status(403).json({ error: 'CORS blocked' });
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
    const where = req.route && req.route.path ? req.route.path : 'unknown route'; // pattern only, never the real address
    notifyOwner('err:' + req.method + where, `Server error on ${req.method} ${where}: ${String(err.message).slice(0, 300)}`);
  }
  // 502 texts are written by this server (for example "AI timeout"), so they are safe to show
  res.status(status).json({ error: status >= 500 && status !== 502 ? 'Internal error' : err.message });
});

process.on('unhandledRejection', e => {
  console.error('unhandledRejection', e);
  notifyOwner('unhandled', 'Unhandled error: ' + String(e && e.message).slice(0, 300));
});

app.listen(PORT, '0.0.0.0', () => console.log('Secure Assistant V15 live on port ' + PORT));