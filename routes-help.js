'use strict';
// Help texts ("i" button on every page), help list per category, and one-call home screen data per category.
// Plain text in English: the app (or Abdul Wahab) shows it in the customer's language.
module.exports = function register(app, core) {
  const { AI_TOOLS, CATEGORIES, auth, buildContext, calcRate, db, httpError, planActive, wrap } = core;

  const slab = `Rs ${calcRate(1)} per camera for 1-2 cameras, Rs ${calcRate(3)} for 3-5, Rs ${calcRate(6)} for 6-9, Rs ${calcRate(10)} for 10 or more. Yearly plans give 1 month free.`;

  const PAGES = [
    { id: 1, key: 'language', title: 'Language', short: 'Choose the language you are comfortable in.',
      steps: ['Pick your language from the list or search for it.', 'You can change it later from Profile.', 'Abdul Wahab replies in the language you write in.'] },
    { id: 2, key: 'login', title: 'Login and Signup', short: 'Create your account with email or phone OTP.',
      steps: ['Sign up with email and a strong password (8+ characters with upper, lower, number and symbol), or use your phone number with an OTP.', 'Use the same method each time you log in.', 'Keep your password private. Nobody from this app will ask for it.'] },
    { id: 3, key: 'categories', title: 'Categories', short: 'Tell us what kind of place you want to watch.',
      steps: ['Pick one or more categories that match your place.', 'Pick the sub-types that fit you. If nothing fits, use "Other - My Own Business" and type your business.', 'Abdul Wahab gives advice for the categories you choose.'] },
    { id: 4, key: 'camera_setup', title: 'Camera setup and payment', short: 'Connect cameras and choose your plan.',
      steps: ['Choose how to connect each camera: QR code, same WiFi, IP/RTSP link, serial number and password, TV link, old phone, this phone, or an uploaded clip.', `Price depends on how many cameras you add: ${slab}`, 'Pay monthly or yearly. Inside the Android app, payment goes through Google Play.'] },
    { id: 5, key: 'live', title: 'Live cameras', short: 'Watch your cameras live for a short time each day.',
      steps: ['Tap a camera to start a live view.', 'Live video has a daily limit of about 20 minutes (4 sessions of 5 minutes) to keep the service affordable. It resets at midnight in your timezone.', 'If a camera shows offline, check its power and internet.'] },
    { id: 6, key: 'wahab', title: 'Abdul Wahab chat', short: 'Ask questions about your business and security.',
      steps: ['Type or speak your question in your own language. You can also send a photo.', 'Abdul Wahab uses only your real camera data. If there is little data, he will say so.', 'There is a daily question limit. For emergencies use the Emergency button and call your local emergency number.'] },
    { id: 7, key: 'storage', title: 'Storage', short: 'Your files are encrypted. Free space plus extra packs.',
      steps: ['Every customer gets 5 GB free.', 'Extra space is sold in 30-day packs. Buy again to keep it.', 'Files are encrypted before they are stored. When storage is full, the oldest clips may be cleared after a grace period, so buy extra space or delete old files.'] },
    { id: 8, key: 'team', title: 'Team and profile', short: 'Add people who can use the app and manage your profile.',
      steps: ['You can add up to 3 app holders (they can log in).', 'You can add any number of staff for records.', 'From Profile you can change your details, export your data, or delete your account.'] }
  ];

  const statusGroups = ids => {
    const tools = AI_TOOLS.filter(t => ids.includes(t.id));
    const pick = s => tools.filter(t => t.status === s).map(t => ({ id: t.id, name: t.name, work: t.work }));
    return { live: pick('live'), beta: pick('beta'), comingSoon: pick('coming_soon') };
  };
  const categoryHelp = c => ({ id: c.id, name: c.name, subCategories: c.subCategories, expertFeatures: c.expertFeatures, tools: statusGroups(c.toolIds || []),
    note: 'Tools marked comingSoon are not available yet.' });

  app.get('/api/help/pages', (req, res) => res.json({ count: PAGES.length, pages: PAGES.map(({ id, key, title, short }) => ({ id, key, title, short })) }));

  app.get('/api/help/page/:id', (req, res) => {
    const p = PAGES.find(x => String(x.id) === req.params.id || x.key === req.params.id);
    if (!p) throw httpError(404, 'Help page not found');
    res.json(p);
  });

  app.get('/api/help/categories', (req, res) => res.json({ count: CATEGORIES.length, categories: CATEGORIES.map(categoryHelp) }));

  app.get('/api/help/category/:id', (req, res) => {
    const c = CATEGORIES.find(x => x.id === Number(req.params.id));
    if (!c) throw httpError(404, 'Category not found');
    res.json(categoryHelp(c));
  });

  // Home screen: the customer's categories with their tools, plus a short summary of today's numbers.
  app.get('/api/home/data', auth, wrap(async (req, res) => {
    const uid = req.user.uid;
    const u = (await db.collection('users').doc(uid).get()).data() || {};
    const ids = req.query.categoryId ? [Number(req.query.categoryId)] : (u.selectedCategories || []);
    const cats = CATEGORIES.filter(c => ids.includes(c.id));
    let today = null;
    if (planActive(u)) {
      try {
        const d = await buildContext(uid, u.timezone, 1);
        const sum = o => Object.values(o).reduce((a, n) => a + n, 0);
        today = { footfallSamples: d.footfallSamples, peopleCounted: sum(d.people.byDay), vehiclesCounted: sum(d.vehicles.byDay), bills: d.billsCount, sales: Math.round(sum(d.sales.byDay)), alerts: sum(d.alertsByType) };
      } catch (e) { console.warn('home data failed:', e.message); }
    }
    res.json({
      needsCategory: cats.length === 0,
      categories: cats.map(c => ({ ...categoryHelp(c), subCategories: c.subCategories })),
      selectedSubCategories: u.selectedSubCategories || [], customCategory: u.customCategory || '',
      subscription: { active: planActive(u), planExpiry: u.planExpiry || null }, today
    });
  }));
};