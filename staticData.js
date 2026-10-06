// staticData.js - Secure Assistant static lists (keep next to index.js)
// Country list comes from libphonenumber-js (every country / territory with a calling code).
// Language and country NAMES come from Node's built-in Intl, so nothing is typed by hand.
'use strict';

let libphone = null;
try { libphone = require('libphonenumber-js'); } catch (e) { console.warn('libphonenumber-js not installed - using a short fallback country list. Run: npm install'); }

// ---------- LANGUAGES ----------
const LANGUAGE_CODES = [
  'en','hi','bn','te','mr','ta','ur','gu','kn','ml','pa','or','as','ne','si','sa','mai','bho','doi','kok','brx','sat','mni','ks','sd',
  'ar','fa','he','tr','ps','ku','ug','yi','az','kk','ky','tg','tk','uz','mn','hy','ka',
  'zh','zh-Hant','ja','ko','vi','th','lo','km','my','id','ms','fil','jv','su','mg','sm','mi',
  'fr','es','pt','it','de','nl','ru','uk','pl','cs','sk','sl','hr','bs','sr','bg','mk','ro','hu','el','sq','be','lt','lv','et','fi','sv','no','da','is','ga','gd','cy','mt','lb','ca','gl','eu',
  'sw','am','so','ha','yo','ig','zu','xh','af','sn','st','rw','ti',
  'tt','eo','la'
];
const LANGUAGE_NAME_OVERRIDE = { bho: 'Bhojpuri', doi: 'Dogri', kok: 'Konkani', mai: 'Maithili', brx: 'Bodo', sat: 'Santali', mni: 'Manipuri', ks: 'Kashmiri', sa: 'Sanskrit' };
const RTL = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi']);
function buildLanguages() {
  const en = new Intl.DisplayNames(['en'], { type: 'language' });
  const out = [];
  for (const code of LANGUAGE_CODES) {
    let name, native;
    try { name = LANGUAGE_NAME_OVERRIDE[code] || en.of(code); } catch (e) { name = LANGUAGE_NAME_OVERRIDE[code]; }
    if (!name || name === code) continue; // unsupported on this Node build
    try { native = new Intl.DisplayNames([code], { type: 'language' }).of(code); } catch (e) { native = name; }
    out.push({ code, name, nativeName: native || name, rtl: RTL.has(code) });
  }
  return out;
}
const LANGUAGES = buildLanguages();

// ---------- COUNTRIES (ISO code, name, calling code) ----------
const FALLBACK_CODES = {
  IN: '+91', US: '+1', CA: '+1', AE: '+971', SA: '+966', GB: '+44', AU: '+61', QA: '+974', KW: '+965', PK: '+92', BD: '+880',
  CN: '+86', JP: '+81', KR: '+82', FR: '+33', DE: '+49', RU: '+7', TR: '+90', IR: '+98', ZA: '+27', NG: '+234', KE: '+254',
  BR: '+55', MX: '+52', IT: '+39', ES: '+34', NL: '+31', PL: '+48', ID: '+62', MY: '+60', TH: '+66', VN: '+84', LK: '+94',
  NP: '+977', EG: '+20', SG: '+65', NZ: '+64'
};
function buildCountries() {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  let isoList = [];
  if (libphone) { try { isoList = libphone.getCountries(); } catch (e) { isoList = []; } }
  if (!isoList.length) isoList = Object.keys(FALLBACK_CODES);
  const out = [];
  for (const iso of isoList) {
    let code = null;
    if (libphone) { try { code = '+' + libphone.getCountryCallingCode(iso); } catch (e) { code = null; } }
    code = code || FALLBACK_CODES[iso];
    if (!code) continue;
    let country;
    try { country = names.of(iso); } catch (e) { country = iso; }
    out.push({ iso, country, code });
  }
  return out.sort((a, b) => a.country.localeCompare(b.country));
}
const COUNTRY_CODES = buildCountries();

// ---------- EMERGENCY NUMBERS ----------
// Only numbers I am confident about are "verified". Every other country falls back to 112 with verified:false.
// 112 is the standard emergency number on GSM mobile networks in most countries, but the app must tell the user to check the local number.
const EMERGENCY_BY_ISO = {};
[
  ['IN', '108', '101', '100', '112'], ['US', '911', '911', '911', '911'], ['CA', '911', '911', '911', '911'], ['AE', '998', '997', '999', '999'],
  ['SA', '997', '998', '999', '911'], ['GB', '999', '999', '999', '999'], ['AU', '000', '000', '000', '000'], ['QA', '999', '999', '999', '999'],
  ['KW', '112', '112', '112', '112'], ['PK', '115', '16', '15', '15'], ['BD', '999', '999', '999', '999'], ['CN', '120', '119', '110', '110'],
  ['JP', '119', '119', '110', '110'], ['KR', '119', '119', '112', '112'], ['FR', '15', '18', '17', '112'], ['DE', '112', '112', '110', '112'],
  ['RU', '103', '101', '102', '112'], ['TR', '112', '110', '155', '112'], ['IR', '115', '125', '110', '115'], ['ZA', '10177', '10177', '10111', '112'],
  ['NG', '112', '112', '112', '112'], ['KE', '999', '999', '999', '999'], ['BR', '192', '193', '190', '190'], ['MX', '911', '911', '911', '911'],
  ['IT', '118', '115', '112', '112'], ['ES', '112', '112', '112', '112'], ['NL', '112', '112', '112', '112'], ['PL', '999', '998', '997', '112'],
  ['ID', '118', '113', '110', '112'], ['MY', '999', '994', '999', '999'], ['TH', '1669', '199', '191', '191'], ['VN', '115', '114', '113', '113'],
  ['LK', '1990', '110', '119', '119'], ['NP', '102', '101', '100', '112'], ['EG', '123', '180', '122', '122'], ['SG', '995', '995', '999', '999'],
  ['NZ', '111', '111', '111', '111']
].forEach(([iso, medical, fire, police, general]) => { EMERGENCY_BY_ISO[iso] = { medical, fire, police, general }; });
['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'GR', 'HU', 'IE', 'LV', 'LT', 'LU', 'MT', 'PT', 'RO', 'SK', 'SI', 'SE']
  .forEach(iso => { EMERGENCY_BY_ISO[iso] = { medical: '112', fire: '112', police: '112', general: '112' }; }); // EU-wide 112

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
// Calling codes that belong to exactly one verified country (used when the app did not send the ISO code)
const CODE_TO_ISO = {};
COUNTRY_CODES.forEach(c => { if (EMERGENCY_BY_ISO[c.iso] && !['+1', '+7', '+44'].includes(c.code) && !CODE_TO_ISO[c.code]) CODE_TO_ISO[c.code] = c.iso; });
function emergencyFor(iso, callingCode) {
  let key = String(iso || '').toUpperCase();
  if (!EMERGENCY_BY_ISO[key] && callingCode && CODE_TO_ISO[callingCode]) key = CODE_TO_ISO[callingCode];
  let country = null;
  try { if (key) country = regionNames.of(key); } catch (e) { country = null; }
  if (EMERGENCY_BY_ISO[key]) return { country, ...EMERGENCY_BY_ISO[key], verified: true };
  return { country, medical: '112', fire: '112', police: '112', general: '112', verified: false };
}

// ---------- AGENTS ----------
const AGENTS = {
  ABDUL_WAHAB: { name: 'Abdul Wahab', role: 'AI business and security advisor', engine: 'Claude (Anthropic API)', work: 'Answers questions in the customer language, reads photos, explains footfall, sales and alert numbers' },
  ABDUL_SAMAD: { name: 'Abdul Samad', role: 'Security layer', engine: 'Server code (not a chatbot)', work: 'Encryption, login checks, payment signature checks, rate limits' }
};

// ---------- CATEGORIES (13th is for any business not listed) ----------
const CATEGORIES = [
  { id: 1, name: 'Home and Residential', subCategories: ['Apartments','Houses','Villas','Gated Society','Slums and Lanes','Farmhouse','Hostel and PG','Elderly Care at Home','Baby Room'], expertFeatures: ['Intrusion after lock','Fall elders','Fire smoke','Scream audio','Person counting'], toolIds: [3,4,6,7,12,14] },
  { id: 2, name: 'Education and Learning', subCategories: ['Schools','Colleges','Universities','Coaching Centres','Hostels','Labs','Libraries','Day Care'], expertFeatures: ['Attendance','Crowd gate','Unattended bag','Weapon detection'], toolIds: [3,8,10,11,22] },
  { id: 3, name: 'Office and Indoor', subCategories: ['Corporate Office','IT Parks','Government Office','Co-Working','Call Centre','Data Centre','Bank Branch','Reception'], expertFeatures: ['Staff attendance','Intrusion after hours','Loitering'], toolIds: [3,4,5,22] },
  { id: 4, name: 'Lifestyle and Shopping', subCategories: ['Malls','Supermarkets','Kirana and General Stores','Clothes Shops','Jewellery Shops','Medical Stores','Salons and Spas','Gyms','Restaurants and Cafes','Bakeries','Hotels','Garages and Workshops','Electronics Shops','ATMs'], expertFeatures: ['Customer counting','Peak hours','Theft loitering','Daily report'], toolIds: [3,5,10,21] },
  { id: 5, name: 'Transport and Travel Hubs', subCategories: ['Bus Stands','Railway and Metro Stations','Airports','Parking Lots','Petrol Pumps','EV Charging','Ports','Truck Terminals'], expertFeatures: ['Vehicle detection','Crowd','Unattended baggage'], toolIds: [2,9,10,11] },
  { id: 6, name: 'Roads and Streets', subCategories: ['National Highways','City Roads','Small Lanes','Toll Plazas','Traffic Signals','Bridges and Tunnels'], expertFeatures: ['Vehicle counting','Peak traffic hours','Accident fall'], toolIds: [2,6,9] },
  { id: 7, name: 'Industrial Factories and Mines', subCategories: ['Factories','Warehouses','Cold Storage','Mines','Construction Sites','Power Plants','Solar and Wind Farms','Oil and Gas Sites'], expertFeatures: ['Fire smoke alert','Worker safety','Vehicle entry','Intrusion'], toolIds: [4,6,7,9] },
  { id: 8, name: 'Police Jail Security and Military', subCategories: ['Police Stations','Jails','Courts','Army Camps','Control Rooms','Border Posts'], expertFeatures: ['Weapon detection','Intrusion','Real click proof'], toolIds: [1,4,8,19] },
  { id: 9, name: 'Religious Places', subCategories: ['Masjid','Mandir','Church','Gurudwara','Dargah','Monastery','Donation Counters'], expertFeatures: ['Crowd management','Unattended bag','Person counting','Live location'], toolIds: [3,10,11,18] },
  { id: 10, name: 'Health and Medical', subCategories: ['Hospitals','Clinics','Pharmacies','Diagnostic Labs','ICU and Wards','Blood Banks','Veterinary Clinics'], expertFeatures: ['Fall detection','Person counting','Restricted area intrusion','Daily report'], toolIds: [3,4,6,14] },
  { id: 11, name: 'Agriculture and Farms', subCategories: ['Farms','Poultry Farms','Dairy Farms','Fish Farms','Greenhouses','Mandi and Markets','Grain Storage'], expertFeatures: ['Night intrusion','Vehicle detection','Person counting','Fire alert'], toolIds: [4,7,9,14] },
  { id: 12, name: 'Outdoor and Public Places', subCategories: ['Parks','Playgrounds','Beaches','Wedding Halls','Stadiums','Zoos','Cinemas','Event Grounds','Tourist Spots'], expertFeatures: ['Crowd detection','Unattended bag','Person counting','Scream audio'], toolIds: [3,10,11,12] },
  { id: 13, name: 'Other - My Own Business', subCategories: ['Type your own business'], expertFeatures: ['Peak hours','Person counting','Daily report'], toolIds: [3,4,10,14] }
];

// ---------- AI TOOLS (status is the honest truth shown in the app) ----------
// live = works now | beta = partly works | coming_soon = not built yet, must not be sold as working
const TOOL_STATUS = {
  1: 'coming_soon', 2: 'coming_soon', 3: 'live', 4: 'beta', 5: 'coming_soon', 6: 'coming_soon', 7: 'coming_soon', 8: 'coming_soon',
  9: 'live', 10: 'live', 11: 'coming_soon', 12: 'coming_soon', 13: 'coming_soon', 14: 'beta', 15: 'live', 16: 'live', 17: 'beta',
  18: 'beta', 19: 'beta', 20: 'live', 21: 'coming_soon', 22: 'coming_soon'
};
const AI_TOOLS = [
  { id: 1, name: 'Face Detection and Recognition', work: 'Recognize known or new visitors', proof: 'Photo with time before and after', whereUsed: 'Home, Education, Office, Shopping, Police' },
  { id: 2, name: 'Number Plate Recognition ANPR', work: 'Read vehicle number plates', proof: 'Photo with plate number', whereUsed: 'Transport, Roads, Industrial' },
  { id: 3, name: 'Person Detection and Counting', work: 'Count people seen in camera frames', proof: 'Counts per hour and day', whereUsed: 'All categories' },
  { id: 4, name: 'Intrusion Detection', work: 'Alert when a person is counted on camera during the closed hours you set (no photo is stored)', proof: 'Alert with time', whereUsed: 'Home, Office, Shopping, Industrial, Health, Agriculture' },
  { id: 5, name: 'Loitering Detection', work: 'Person staying in one area for long', proof: 'Photo with time', whereUsed: 'Office, Shopping' },
  { id: 6, name: 'Fall Detection', work: 'Person falls alert', proof: 'Photo of the event', whereUsed: 'Home elders, Roads, Health' },
  { id: 7, name: 'Fire and Smoke Detection', work: 'Fire and smoke alert', proof: 'Photo of the event', whereUsed: 'Home kitchen, Industrial, Agriculture' },
  { id: 8, name: 'Weapon Detection', work: 'Weapon in hand alert', proof: 'Photo of the event', whereUsed: 'Police, Education, Malls' },
  { id: 9, name: 'Vehicle Detection', work: 'Count cars, bikes, buses and trucks in frames', proof: 'Counts per hour and day', whereUsed: 'Transport, Roads, Industrial, Agriculture' },
  { id: 10, name: 'Crowd Detection', work: 'Alert when people counted on camera cross the limit you set', proof: 'Alert with count and time', whereUsed: 'Education, Transport, Religious, Outdoor, Shopping' },
  { id: 11, name: 'Unattended Baggage Detection', work: 'Bag left alone alert', proof: 'Photo of the event', whereUsed: 'Transport, Education, Religious, Outdoor' },
  { id: 12, name: 'Audio Anomaly Scream Detection', work: 'Scream or breaking sound alert', proof: 'Audio clip with time', whereUsed: 'Home, Outdoor, Roads' },
  { id: 13, name: 'Visitor Background Intelligence', work: 'Visit history of known visitors', proof: 'History with photos', whereUsed: 'All categories' },
  { id: 14, name: 'Offline Revive and Rewind', work: 'Phone records while offline and uploads when internet returns', proof: 'Clip with upload time', whereUsed: 'All categories' },
  { id: 15, name: 'QR Generator and Scanner', work: 'Connect an old phone as a camera with a QR code', proof: 'Connect log', whereUsed: 'Setup' },
  { id: 16, name: 'Camera Health Monitoring', work: 'Battery, storage, internet and offline status reported by the camera phone, with an alert if it goes silent', proof: 'Health status with last-seen time', whereUsed: 'All' },
  { id: 17, name: 'Camera Placement Advisor', work: 'Send a photo of the spot to Abdul Wahab and ask for the best angle and height', proof: 'Written advice', whereUsed: 'Setup' },
  { id: 18, name: 'Live Location and Status Share', work: 'Share camera or incident location link', proof: 'Map link', whereUsed: 'Religious, All' },
  { id: 19, name: 'Proof Capsule with Time Window', work: 'Encrypted clip stored with the time window around an event', proof: 'Capsule with server time', whereUsed: 'All' },
  { id: 20, name: 'Encrypted Capsule Save', work: 'Save analysed video clips encrypted', proof: 'Capsule storage', whereUsed: 'All' },
  { id: 21, name: 'Smart Search and Loyal Customer History', work: 'Search visitor history', proof: 'History search', whereUsed: 'Shopping, Home, Office' },
  { id: 22, name: 'Attendance and Staff Tracking', work: 'Staff attendance report', proof: 'Attendance report', whereUsed: 'Office, Education' }
].map(t => ({ ...t, status: TOOL_STATUS[t.id] || 'coming_soon' }));
const LIVE_TOOL_NAMES = AI_TOOLS.filter(t => t.status === 'live').map(t => t.name);
const BETA_TOOL_NAMES = AI_TOOLS.filter(t => t.status === 'beta').map(t => t.name);
const COMING_SOON_NAMES = AI_TOOLS.filter(t => t.status === 'coming_soon').map(t => t.name);

const CAMERA_METHODS = [
  { id: 1, type: 'qr_scan',         name: 'QR Code Scan' },
  { id: 2, type: 'wifi_auto',       name: 'Same WiFi Auto Detect' },
  { id: 3, type: 'ip_rtsp',         name: 'IP Address / RTSP Link' },
  { id: 4, type: 'serial_password', name: 'Serial Number + Password' },
  { id: 5, type: 'tv_link',         name: 'TV Link' },
  { id: 6, type: 'old_phone',       name: 'Old Phone as CCTV + DVR' }
];

const STORAGE_PLANS = { 10: 32, 50: 120, 100: 230, 500: 1110 }; // GB -> INR

module.exports = { LANGUAGES, COUNTRY_CODES, AGENTS, CATEGORIES, AI_TOOLS, LIVE_TOOL_NAMES, BETA_TOOL_NAMES, COMING_SOON_NAMES, CAMERA_METHODS, emergencyFor, STORAGE_PLANS };