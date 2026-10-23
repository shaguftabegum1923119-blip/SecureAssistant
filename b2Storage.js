'use strict';
// Backblaze B2 storage (S3-compatible API). The bucket is PRIVATE, so files are only readable
// through short-lived signed links made here. Nothing in this file is ever sent to the customer's app
// except those links.
//
// .env / Render variables used:
//   B2_KEY_ID    = keyID of the application key
//   B2_KEY       = applicationKey (the secret; B2_APP_KEY also works)
//   B2_BUCKET    = secure-assistant-files
//   B2_ENDPOINT  = https://s3.us-west-004.backblazeb2.com
//   B2_REGION    = us-west-004
//
// `bucket` at the bottom has the same calls the old Firebase Storage bucket had
// (file(path).save / download / delete / getSignedUrl and deleteFiles({ prefix })),
// so core.js can use it and the route files need no change.
//
// Self test (run on your computer):  node b2Storage.js --test

const {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, HeadBucketCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let client = null;

function config() {
  const c = {
    keyId: process.env.B2_KEY_ID,
    key: process.env.B2_KEY || process.env.B2_APP_KEY,
    bucket: process.env.B2_BUCKET,
    endpoint: process.env.B2_ENDPOINT,
    region: process.env.B2_REGION
  };
  const missing = [['B2_KEY_ID', c.keyId], ['B2_KEY', c.key], ['B2_BUCKET', c.bucket], ['B2_ENDPOINT', c.endpoint], ['B2_REGION', c.region]]
    .filter(x => !x[1]).map(x => x[0]);
  if (missing.length) throw new Error('B2 not configured. Missing: ' + missing.join(', '));
  if (!/^https:\/\//.test(c.endpoint)) throw new Error('B2_ENDPOINT must start with https://');
  return c;
}

function getClient() {
  if (!client) {
    const c = config();
    client = new S3Client({
      region: c.region,
      endpoint: c.endpoint,
      credentials: { accessKeyId: c.keyId, secretAccessKey: c.key },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED'
    });
  }
  return client;
}

// Safe storage path: users/<uid>/<kind>/<time>-<name>. Blocks ".." and odd characters.
function makeKey(uid, kind, name) {
  const clean = s => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_').slice(0, 120);
  if (!uid) throw new Error('uid required');
  return `users/${clean(uid)}/${clean(kind || 'files')}/${Date.now()}-${clean(name || 'file')}`;
}

async function uploadBuffer(key, buffer, contentType) {
  await getClient().send(new PutObjectCommand({
    Bucket: config().bucket, Key: key, Body: buffer, ContentType: contentType || 'application/octet-stream'
  }));
  return { key, size: buffer.length };
}

async function downloadBuffer(key) {
  const out = await getClient().send(new GetObjectCommand({ Bucket: config().bucket, Key: key }));
  const chunks = [];
  for await (const c of out.Body) chunks.push(c);
  return Buffer.concat(chunks);
}

// Short-lived download link (default 10 minutes, at most maxSeconds, which defaults to 1 hour).
async function signedDownloadUrl(key, seconds, maxSeconds) {
  const max = Math.min(Number(maxSeconds) || 3600, 7 * 24 * 3600);
  const exp = Math.min(Math.max(Number(seconds) || 600, 30), max);
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: config().bucket, Key: key }), { expiresIn: exp });
}

async function deleteObject(key) {
  await getClient().send(new DeleteObjectCommand({ Bucket: config().bucket, Key: key }));
  return { success: true };
}

async function listObjects(prefix, max) {
  const out = await getClient().send(new ListObjectsV2Command({
    Bucket: config().bucket, Prefix: prefix || '', MaxKeys: Math.min(Number(max) || 100, 1000)
  }));
  return (out.Contents || []).map(o => ({ key: o.Key, size: o.Size, modified: o.LastModified }));
}

// Deletes every file whose path starts with prefix. An empty prefix is refused so the whole bucket can never be wiped by mistake.
async function deleteByPrefix(prefix) {
  if (!prefix || String(prefix).length < 3) throw new Error('deleteByPrefix needs a real prefix');
  const c = config();
  let total = 0, token;
  do {
    const page = await getClient().send(new ListObjectsV2Command({ Bucket: c.bucket, Prefix: prefix, MaxKeys: 1000, ContinuationToken: token }));
    const objs = (page.Contents || []).map(o => ({ Key: o.Key }));
    if (objs.length) {
      const r = await getClient().send(new DeleteObjectsCommand({ Bucket: c.bucket, Delete: { Objects: objs, Quiet: true } }));
      if (r.Errors && r.Errors.length) console.warn('B2 delete errors:', r.Errors.slice(0, 3).map(e => e.Key + ': ' + e.Message).join('; '));
      total += objs.length - (r.Errors ? r.Errors.length : 0);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return total;
}

// Quick check that keys, bucket and endpoint all work together.
async function healthCheck() {
  await getClient().send(new HeadBucketCommand({ Bucket: config().bucket }));
  return true;
}

// Same calls as the old Firebase Storage bucket, so existing code keeps working unchanged.
const bucket = {
  file(path) {
    return {
      async save(data, opts) {
        const ct = opts && ((opts.metadata && opts.metadata.contentType) || opts.contentType);
        await uploadBuffer(path, Buffer.isBuffer(data) ? data : Buffer.from(data), ct);
      },
      async download() { return [await downloadBuffer(path)]; },
      async delete() { await deleteObject(path); },
      async getSignedUrl(opts) {
        const secs = Math.ceil((Number(opts && opts.expires) - Date.now()) / 1000);
        return [await signedDownloadUrl(path, secs, 7 * 24 * 3600)];
      }
    };
  },
  async deleteFiles(opts) { return deleteByPrefix(opts && opts.prefix); }
};

module.exports = { bucket, makeKey, uploadBuffer, downloadBuffer, signedDownloadUrl, deleteObject, deleteByPrefix, listObjects, healthCheck };

// ---- self test: node b2Storage.js --test ----
if (require.main === module && process.argv.includes('--test')) {
  require('dotenv').config();
  (async () => {
    try {
      await healthCheck();
      console.log('1. Bucket reachable: OK');
      const key = makeKey('selftest', 'tmp', 'hello.txt');
      await bucket.file(key).save(Buffer.from('b2 test ok'), { metadata: { contentType: 'text/plain' } });
      console.log('2. Upload: OK ->', key);
      const [url] = await bucket.file(key).getSignedUrl({ action: 'read', expires: Date.now() + 60 * 1000 });
      const text = await (await fetch(url)).text();
      console.log('3. Signed download link: ' + (text === 'b2 test ok' ? 'OK' : 'WRONG CONTENT'));
      const [buf] = await bucket.file(key).download();
      console.log('4. Direct download: ' + (buf.toString() === 'b2 test ok' ? 'OK' : 'WRONG CONTENT'));
      await bucket.file(key).delete();
      console.log('5. Delete one file: OK');
      await bucket.file(makeKey('selftest', 'tmp', 'a.txt')).save(Buffer.from('a'));
      await bucket.file(makeKey('selftest', 'tmp', 'b.txt')).save(Buffer.from('b'));
      await bucket.deleteFiles({ prefix: 'users/selftest/', force: true });
      const left = await listObjects('users/selftest/', 10);
      console.log('6. Delete by prefix: ' + (left.length === 0 ? 'OK' : 'FILES LEFT: ' + left.length));
      console.log('\nAll good. B2 is ready.');
    } catch (e) {
      console.error('\nTEST FAILED:', e.name, '-', e.message);
      process.exit(1);
    }
  })();
}