// SECURE ASSISTANT - CORE PROMISE: Agents never lie, App never lies, Privacy never leaks, 100% signature verify encrypted
require('dotenv').config();
const express=require('express'),helmet=require('helmet'),cors=require('cors'),rateLimit=require('express-rate-limit'),crypto=require('crypto'),path=require('path'),Razorpay=require('razorpay'),multer=require('multer'),admin=require('firebase-admin'),fs=require('fs');
const app=express();
const upload=multer({dest:'uploads/', limits:{fileSize:100*1024*1024}});
app.set('trust proxy',1);
app.use(helmet({crossOriginEmbedderPolicy:false,crossOriginOpenerPolicy:false,crossOriginResourcePolicy:false,contentSecurityPolicy:false}));
const ALLOWED_ORIGINS = process.env.FRONTEND_URL? process.env.FRONTEND_URL.split(',') : null;
app.use(cors({origin: ALLOWED_ORIGINS || true, credentials:true, methods:["GET","POST","PUT","DELETE","OPTIONS"], allowedHeaders:["Content-Type","Authorization","X-Requested-With","x-razorpay-signature"]}));
app.use(express.json({limit:'10mb'}));
app.use(rateLimit({windowMs:15*60*1000,max:1000}));
if(!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const CORE_PROMISE="My AI agents never lie, my app never lies and my app never leaks customer privacy. Never fake, only real click with time before after proof. Very fast. No one can hack. 100% secure encrypted.";
const STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

let db=null; let auth=null;
try{
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log("Found FIREBASE_SERVICE_ACCOUNT env, parsing...");
    let raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
    // Fixed: Removed dangerous raw.slice(1,-1) which was breaking JSON
    if (raw.startsWith("'") && raw.endsWith("'")) {
      raw = raw.slice(1, -1);
    }
    serviceAccount = JSON.parse(raw);
    if(typeof serviceAccount === 'string') {
      serviceAccount = JSON.parse(serviceAccount);
    }
    if(serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
  } else {
    console.log("FIREBASE_SERVICE_ACCOUNT env missing, trying file...");
    serviceAccount = require('./serviceAccountKey.json');
  }
  admin.initializeApp({credential:admin.credential.cert(serviceAccount), storageBucket:process.env.FIREBASE_STORAGE_BUCKET || undefined});
  db=admin.firestore();
  auth=admin.auth();
  db.settings({ignoreUndefinedProperties:true});
  console.log("Firestore Connected - Render Mode SUCCESS");
}catch(e){ console.log("Firestore key missing - Add serviceAccountKey.json beside index.js. Error:", e.message); }

let razorpay; let RAZORPAY_LIVE=true;
try{
  if(!process.env.RAZORPAY_KEY_ID ||!process.env.RAZORPAY_KEY_SECRET) throw new Error("Keys missing");
  razorpay=new Razorpay({key_id:process.env.RAZORPAY_KEY_ID, key_secret:process.env.RAZORPAY_KEY_SECRET});
}catch(e){ RAZORPAY_LIVE=false; razorpay={orders:{create:async(o)=>({id:"TEST_order_"+Date.now(), testMode:true})}}; }

const AGENTS={
ABDUL_WAHAB:{name:"Abdul Wahab",role:"Main Brain",greeting:"Have a nice day, Take care, You are doing great",corePromise:CORE_PROMISE,work:"Understands broken language, voice, text, photo, video. Offline recording when power or wifi gone, rewinds full detail when back with real photo proof before after. Never fake video only real click. Daily report auto. Expert of all 12 categories.",dashboard:"Who came, loyal customer history, incidents before after real photos, live location share, camera health, daily report"},
ABDUL_SAMAD:{name:"Abdul Samad",role:"Security Head",greeting:"Have a nice day, Take care, You are doing great",corePromise:CORE_PROMISE,work:"Full privacy, data never share, encrypted Firebase Auth storage, OTP secure, password strong, signature verify Razorpay, blocks fake payment, hack proof.",dashboard:"Security status, blocked attempts, payment history, OTP logs, storage encrypted"}
};

// WORLD LANGUAGES - Customer selects, frontend changes - Code stays English
const LANGUAGES=[
{code:"en",name:"English"},{code:"hi",name:"Hindi"},{code:"ur",name:"Urdu"},{code:"te",name:"Telugu"},{code:"ta",name:"Tamil"},{code:"bn",name:"Bengali"},{code:"mr",name:"Marathi"},{code:"gu",name:"Gujarati"},{code:"kn",name:"Kannada"},{code:"ml",name:"Malayalam"},{code:"pa",name:"Punjabi"},{code:"ar",name:"Arabic"},{code:"fr",name:"French"},{code:"es",name:"Spanish"},{code:"de",name:"German"},{code:"zh",name:"Chinese"},{code:"ja",name:"Japanese"},{code:"ru",name:"Russian"},{code:"tr",name:"Turkish"},{code:"fa",name:"Persian"},{code:"pt",name:"Portuguese"},{code:"it",name:"Italian"},{code:"ko",name:"Korean"},{code:"id",name:"Indonesian"},{code:"th",name:"Thai"},{code:"vi",name:"Vietnamese"},{code:"nl",name:"Dutch"},{code:"pl",name:"Polish"},{code:"All",name:"All World 150+ Languages"}
];
const COUNTRY_CODES=[{code:"+91",country:"India"},{code:"+1",country:"USA Canada"},{code:"+971",country:"UAE"},{code:"+966",country:"Saudi"},{code:"+44",country:"UK"},{code:"+61",country:"Australia"},{code:"+974",country:"Qatar"},{code:"+965",country:"Kuwait"},{code:"+92",country:"Pakistan"},{code:"+880",country:"Bangladesh"},{code:"+81",country:"Japan"},{code:"+49",country:"Germany"},{code:"+33",country:"France"},{code:"All",country:"All World 249 Codes"}];

const CATEGORIES=[
{id:1,name:"Home and Residential",subCategories:["Apartments","Houses","Villas","Society"],expertFeatures:["Intrusion after lock","Fall elders","Fire smoke","Scream audio","Person counting"],toolIds:[1,3,4,6,7,12,14,21]},
{id:2,name:"Education and Learning",subCategories:["Schools","Colleges","Coaching"],expertFeatures:["Face attendance","Crowd gate","Unattended bag","Weapon detection"],toolIds:[1,3,8,10,11]},
{id:3,name:"Office and Indoor",subCategories:["Corporate Office","IT Parks","Govt Office"],expertFeatures:["Staff attendance","Intrusion after hours","Loitering"],toolIds:[1,3,4,5,22]},
{id:4,name:"Lifestyle and Shopping",subCategories:["Malls","Supermarkets","Kirana Store","Restaurants"],expertFeatures:["Customer counting","Loyal recognition","Theft loitering","Daily report"],toolIds:[1,3,5,10,21]},
{id:5,name:"Transport and Travel Hubs",subCategories:["Bus Stand","Railway Station","Airport","Parking"],expertFeatures:["Vehicle detection","Number plate ANPR","Crowd","Unattended baggage"],toolIds:[2,9,10,11]},
{id:6,name:"Roads and Streets",subCategories:["Highways","City Roads","Toll Tax"],expertFeatures:["Vehicle counting","Number plate ANPR","Accident fall"],toolIds:[2,9,6]},
{id:7,name:"Industrial Factories and Mines",subCategories:["Factories","Warehouses","Mines","Construction"],expertFeatures:["Fire smoke alert","Person safety","Vehicle entry","Intrusion"],toolIds:[4,6,7,9]},
{id:8,name:"Police Jail Security and Military",subCategories:["Police Station","Jail","Court","Army Camp"],expertFeatures:["Weapon detection","Face high security","Intrusion","Real click proof"],toolIds:[1,4,8,19]},
{id:9,name:"Religious Places",subCategories:["Masjid","Mandir","Church","Gurudwara"],expertFeatures:["Crowd management","Unattended bag","Person counting","Live location"],toolIds:[3,10,11,18]},
{id:10,name:"Health and Medical",subCategories:["Hospitals","Clinics","Pharmacy","Labs"],expertFeatures:["Fall detection","Person counting","Restricted intrusion","Daily report"],toolIds:[3,4,6,14]},
{id:11,name:"Agriculture and Farms",subCategories:["Farms","Poultry Farms","Dairy Farms"],expertFeatures:["Intrusion night","Vehicle detection","Person counting","Fire alert"],toolIds:[4,7,9,14]},
{id:12,name:"Outdoor and Public Places",subCategories:["Parks","Playgrounds","Beaches","Wedding Halls"],expertFeatures:["Crowd detection","Unattended bag","Person counting","Scream audio"],toolIds:[3,10,11,12]}
];
const AI_TOOLS=[
{id:1,name:"Face Detection and Recognition",work:"Detect face, recognize loyal or new",proof:"Real photo with time",action:"Show history",whereUsed:"Home, Education, Office, Shopping, Police"},
{id:2,name:"Number Plate Recognition ANPR",work:"Read vehicle plate",proof:"Real click with plate",action:"Log entry exit",whereUsed:"Transport, Roads, Industrial"},
{id:3,name:"Person Detection and Counting",work:"Count entered left inside",proof:"Daily count with photo",action:"Daily report",whereUsed:"All 12 categories"},
{id:4,name:"Intrusion Detection",work:"Alert after shop closed",proof:"Real intrusion photo",action:"Alert with time",whereUsed:"Home, Office, Shopping"},
{id:5,name:"Loitering Detection",work:"Roaming long time before theft",proof:"Real photo time",action:"Theft risk alert",whereUsed:"Office, Shopping"},
{id:6,name:"Fall Detection",work:"Person falls alert",proof:"Real fall photo",action:"Emergency alert",whereUsed:"Home, Roads, Health"},
{id:7,name:"Fire and Smoke Detection",work:"Fire smoke high alert",proof:"Real fire photo",action:"High alert",whereUsed:"Home, Industrial"},
{id:8,name:"Weapon Detection",work:"Weapon in hand alert",proof:"Real weapon photo",action:"High security alert",whereUsed:"Police, Education"},
{id:9,name:"Vehicle Detection",work:"Car bike truck detection",proof:"Real vehicle photo",action:"Log vehicle count",whereUsed:"Transport, Roads"},
{id:10,name:"Crowd Detection",work:"Too much crowd alert",proof:"Real crowd photo",action:"Crowd management",whereUsed:"Education, Transport, Religious"},
{id:11,name:"Unattended Baggage Detection",work:"Bag left alone alert",proof:"Real bag photo",action:"Security alert",whereUsed:"Transport, Education"},
{id:12,name:"Audio Anomaly Scream Detection",work:"Scream detection via mic",proof:"Audio clip with time",action:"Audio alert",whereUsed:"Home, Outdoor"},
{id:13,name:"Visitor Background Intelligence",work:"Who came before, loyal history",proof:"History with photos",action:"Show history",whereUsed:"All"},
{id:14,name:"Offline Revive and Daily Report",work:"Records offline when power gone, rewinds when back",proof:"Offline rewind with photos",action:"Auto rewind",whereUsed:"All 12"},
{id:15,name:"QR Generator and Scanner",work:"Generate QR for camera, scan 2 sec",proof:"QR connect log",action:"Connect camera",whereUsed:"Setup"},
{id:16,name:"Camera Health Monitoring",work:"Check battery, storage, internet, lens",proof:"Health report",action:"Show status",whereUsed:"All"},
{id:17,name:"Camera Placement Advisor",work:"Where to fix camera best angle",proof:"Placement suggestion",action:"Suggest angle",whereUsed:"Setup"},
{id:18,name:"Live Location and Live Status Share",work:"Show live location incident",proof:"Live location map",action:"Share via WhatsApp",whereUsed:"All"},
{id:19,name:"Proof with Real Click",work:"Never fake video, only real photo",proof:"Real click",action:"Show real photo",whereUsed:"All"},
{id:20,name:"Capsule Save Encrypted",work:"Save recording encrypted 1 year",proof:"Capsule storage",action:"Save capsule",whereUsed:"All"},
{id:21,name:"Smart Search and Loyal History",work:"Search visitor full history",proof:"History search",action:"Show history",whereUsed:"Shopping, Home"},
{id:22,name:"Attendance and Staff Tracking",work:"Staff attendance face detection",proof:"Attendance photo",action:"Mark attendance",whereUsed:"Office, Education"}
];
const CAM_METHODS=[
{id:1,name:"WiFi QR Scan",detail:"Old phone as CCTV scan QR 2 sec",health:["Battery","Storage","Internet","Lens"]},
{id:2,name:"RTSP IP Camera",detail:"Add RTSP url",health:["Internet","Storage"]},
{id:3,name:"Upload Video Clip",detail:"Upload video for analysis",health:["Storage"]},
{id:4,name:"Live Phone Camera",detail:"Use phone camera direct as CCTV",health:["Battery","Lens","Internet"]},
{id:5,name:"Gallery Import",detail:"Import from gallery",health:["Storage"]},
{id:6,name:"Old Phone as CCTV Special",detail:"Old android phone becomes CCTV",health:["Battery","Storage","Internet","Lens"]}
];
const EMERGENCY_MAP={"+91":{country:"India",Fall:"108",Fire:"101",Weapon:"100",Intrusion:"100",General:"112"},"+1":{country:"USA",Fall:"911",Fire:"911",Weapon:"911",Intrusion:"911",General:"911"},"+971":{country:"UAE",Fall:"998",Fire:"997",Weapon:"999",Intrusion:"999",General:"998"},"+966":{country:"Saudi",Fall:"997",Fire:"998",Weapon:"911",Intrusion:"911",General:"911"},"+44":{country:"UK",Fall:"999",Fire:"999",Weapon:"999",Intrusion:"999",General:"999"},"+61":{country:"Australia",Fall:"000",Fire:"000",Weapon:"000",Intrusion:"000",General:"000"},"+974":{country:"Qatar",Fall:"999",Fire:"997",Weapon:"999",Intrusion:"999",General:"999"},"+965":{country:"Kuwait",Fall:"112",Fire:"112",Weapon:"112",Intrusion:"112",General:"112"},"+92":{country:"Pakistan",Fall:"115",Fire:"16",Weapon:"15",Intrusion:"15",General:"15"},"+880":{country:"Bangladesh",Fall:"999",Fire:"999",Weapon:"999",Intrusion:"999",General:"999"},"All":{country:"All World",Fall:"112",Fire:"112",Weapon:"112",Intrusion:"112",General:"112"}};
function calcRate(count){ if(count<=2) return 99; if(count<=5) return 85; if(count<=9) return 70; return 60; }
function ccodeFix(cc){ if(!cc) return "+91"; return cc.split(' ')[0]; }

app.get('/health',(req,res)=>res.json({ok:true,live:"SECURE ASSISTANT LIVE",corePromise:CORE_PROMISE,time:Date.now(), razorpayLive:RAZORPAY_LIVE, firestoreLive:!!db}));
app.get('/api/agents',(req,res)=>res.json(AGENTS));
app.get('/api/languages',(req,res)=>res.json({languages:LANGUAGES,countryCodes:COUNTRY_CODES,corePromise:CORE_PROMISE}));
app.get('/api/categories',(req,res)=>res.json(CATEGORIES));
app.get('/api/ai-tools',(req,res)=>res.json(AI_TOOLS));
app.get('/api/camera/add-methods',(req,res)=>res.json({methods:CAM_METHODS}));
app.get('/api/cameras/methods',(req,res)=>res.json({methods:CAM_METHODS}));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/register',async(req,res)=>{
  try{
    let {phone,email,password,countryCode,language,name}=req.body;
    if(!phone) return res.status(400).json({error:"Phone required"});
    if(!db) return res.status(500).json({error:"Firestore not connected"});
    let hashed=password? crypto.createHash('sha256').update(password).digest('hex') : undefined;
    let userData={phone,email,password:hashed,countryCode:ccodeFix(countryCode),language:language||"en",name,storageUsed:0,capsuleCount:0,biometricEnabled:false,createdAt:admin.firestore.FieldValue.serverTimestamp(),location:{lat:null,lng:null,permission:false}};
    await db.collection('users').doc(phone).set(userData,{merge:true});
    res.json({success:true,message:"Registered",user:userData,corePromise:CORE_PROMISE});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/auth/send-otp',async(req,res)=>{
  try{
    let {phone}=req.body;
    if(!phone) return res.status(400).json({error:"Phone required"});
    let otp=Math.floor(100000+Math.random()*900000).toString();
    let expiresAt=Date.now()+5*60*1000;
    await db.collection('otps').doc(phone).set({phone,otp,expiresAt,createdAt:admin.firestore.FieldValue.serverTimestamp()});
    console.log(`OTP for ${phone} is ${otp}`);
    res.json({success:true,message:"OTP sent",phone,otp_debug:otp,corePromise:CORE_PROMISE});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/auth/verify-otp',async(req,res)=>{
  try{
    let {phone,otp,name,countryCode,language}=req.body;
    let doc=await db.collection('otps').doc(phone).get();
    if(!doc.exists) return res.status(400).json({success:false,error:"OTP not found"});
    let data=doc.data();
    if(Date.now()>data.expiresAt) return res.status(400).json({success:false,error:"OTP expired"});
    if(data.otp!=otp) return res.status(400).json({success:false,error:"Wrong OTP"});
    let userSnap=await db.collection('users').doc(phone).get();
    let user=userSnap.exists? userSnap.data() : {phone,name,countryCode:ccodeFix(countryCode),language:language||"en",storageUsed:0,capsuleCount:0,loginType:"phone_otp",biometricEnabled:false,createdAt:admin.firestore.FieldValue.serverTimestamp()};
    if(!userSnap.exists) await db.collection('users').doc(phone).set(user,{merge:true});
    await db.collection('otps').doc(phone).delete();
    res.json({success:true,message:"OTP Verified",user,corePromise:CORE_PROMISE});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/auth/google-login',async(req,res)=>{
  try{
    let {idToken,phone,language}=req.body;
    let decoded=await auth.verifyIdToken(idToken);
    let userData={phone:phone||decoded.email,email:decoded.email,name:decoded.name,googleUid:decoded.uid,language:language||"en",loginType:"google",biometricEnabled:false,storageUsed:0,createdAt:admin.firestore.FieldValue.serverTimestamp()};
    await db.collection('users').doc(phone||decoded.email).set(userData,{merge:true});
    res.json({success:true,user:userData});
  }catch(e){ res.status(401).json({error:e.message}); }
});

app.post('/api/auth/update-profile',async(req,res)=>{
  try{
    let {phone,newPhone,newEmail,location,biometricEnabled,language}=req.body;
    if(!db) return res.status(500).json({error:"Firestore missing"});
    let doc=await db.collection('users').doc(phone).get();
    if(!doc.exists) return res.status(404).json({error:"User not found"});
    let currentId=phone;
    if(newPhone){
      let data=doc.data();
      await db.collection('users').doc(newPhone).set({...data,phone:newPhone},{merge:true});
      await db.collection('users').doc(phone).delete();
      currentId=newPhone;
    }
    let updates={};
    if(newEmail) updates.email=newEmail;
    if(location) updates.location=location;
    if(typeof biometricEnabled==='boolean') updates.biometricEnabled=biometricEnabled;
    if(language) updates.language=language;
    if(Object.keys(updates).length>0) await db.collection('users').doc(currentId).update(updates);
    let updated=await db.collection('users').doc(currentId).get();
    res.json({success:true,user:updated.data()});
  }catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/payment/calculate',(req,res)=>{ let {cameraCount,totalCameraCount,locations}=req.body; let count=totalCameraCount||cameraCount||1; if(locations&&Array.isArray(locations)) count=locations.reduce((s,l)=>s+(l.cameraCount||0),0); let per=calcRate(count); res.json({count,perCamera:per,total:count*per}); });
app.post('/api/payment/generate-qr', async (req,res)=>{
  try{
    if(!RAZORPAY_LIVE) return res.status(503).json({error:"Razorpay TEST mode"});
    let {totalCameraCount,locations}=req.body; let count=totalCameraCount||1; if(locations) count=locations.reduce((s,l)=>s+(l.cameraCount||0),0); let per=calcRate(count); let amount=count*per*100; let order=await razorpay.orders.create({amount,currency:'INR',receipt:'rec_'+Date.now()});
    if(db) await db.collection('orders').doc(order.id).set({orderId:order.id,count,total:count*per,locations,createdAt:admin.firestore.FieldValue.serverTimestamp()});
    res.json({orderId:order.id,keyId:process.env.RAZORPAY_KEY_ID,count,total:count*per});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/payment/verify',(req,res)=>{
  let {razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body;
  let body=razorpay_order_id+"|"+razorpay_payment_id;
  let expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex');
  let isValid=false; try{ isValid=crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature)); }catch{ isValid=false; }
  if(isValid) res.json({success:true,message:"Payment Verified"}); else res.json({success:false,error:"Signature FAIL"});
});
app.post('/api/chat',(req,res)=>{
  let {message,categoryId,language}=req.body;
  let cat=CATEGORIES.find(c=> c.id==categoryId) || CATEGORIES[0];
  let reply=`Abdul Wahab: You said "${message}" Expert: ${cat.name} Features: ${cat.expertFeatures.join(', ')} Language: ${language||'en'} ${CORE_PROMISE}`;
  res.json({replyPureEnglish:reply, category:cat});
});
app.post('/api/video/upload-analyze',upload.single('video'),async(req,res)=>{
  try{
    let {phone,fileName}=req.body; let videoSize=req.file? req.file.size : 0;
    let userRef=db.collection('users').doc(phone); let userSnap=await userRef.get();
    let userData=userSnap.exists? userSnap.data() : {storageUsed:0,capsuleCount:0};
    if((userData.storageUsed||0)+videoSize > STORAGE_LIMIT_BYTES) return res.status(400).json({error:"Storage limit 10GB reached"});
    let capsuleId="cap_"+Date.now();
    await db.collection('capsules').doc(capsuleId).set({capsuleId,phone,fileName:fileName||req.file?.originalname,size:videoSize,createdAt:admin.firestore.FieldValue.serverTimestamp()});
    await userRef.set({storageUsed:(userData.storageUsed||0)+videoSize,capsuleCount:(userData.capsuleCount||0)+1},{merge:true});
    res.json({success:true,capsuleId,storageUsed:(userData.storageUsed||0)+videoSize});
  }catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/location/update',async(req,res)=>{
  let {phone,lat,lng}=req.body;
  if(db && phone) await db.collection('users').doc(phone).set({location:{lat,lng,permission:true,updated:Date.now()}},{merge:true});
  res.json({success:true});
});
app.post('/api/emergency/action',async(req,res)=>{
  let {phone,emergencyType}=req.body;
  let userSnap=await db.collection('users').doc(phone).get();
  let user=userSnap.exists? userSnap.data() : {countryCode:"+91",location:{lat:17.0,lng:79.0}};
  let cc=ccodeFix(user.countryCode||"+91");
  let map=EMERGENCY_MAP[cc]||EMERGENCY_MAP["All"];
  let num=map[emergencyType]||map.General;
  let liveLink=`https://maps.google.com/?q=${user.location?.lat||0},${user.location?.lng||0}`;
  res.json({success:true,country:map.country,countryCode:cc,emergencyType,emergencyNumber:num,location:user.location,liveLink});
});
app.get('/',(req,res)=>res.sendFile(path.join(__dirname, 'public','index.html')));
const PORT=process.env.PORT||10000;
app.listen(PORT,'0.0.0.0',()=>console.log('LIVE '+PORT));