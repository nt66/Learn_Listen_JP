import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createSynthesizer, generateBookAudio } from './tts.mjs';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const credentialPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const projectId = process.env.FIREBASE_PROJECT_ID || 'william-japanese-learn';

const credentials = credentialPath ? JSON.parse(readFileSync(credentialPath, 'utf8')) : undefined;
initializeApp({ projectId, credential: credentials ? cert(credentials) : applicationDefault() });
const db = getFirestore();
const synthesize = createSynthesizer(credentials);

// 上传后后台生成音频的进度，按 bookId 记在内存里供 admin 页轮询（服务重启后丢失，可用 npm run audio 补跑）。
const audioJobs = new Map();

function startAudioJob(bookId, words) {
  const job = { status: 'running', total: 0, done: 0, failed: 0, errors: [], startedAt: Date.now() };
  audioJobs.set(bookId, job);
  generateBookAudio(db, db.collection('Books').doc(bookId), words, {
    synthesize,
    onProgress: p => Object.assign(job, { total: p.total, done: p.done, failed: p.failed, errors: p.errors.slice(0, 20) }),
  }).then(() => { job.status = 'done'; })
    .catch(error => { job.status = 'error'; job.errors = [error instanceof Error ? error.message : String(error)]; console.error(`audio ${bookId}:`, error); });
}
// 管理员账号来自 .env.local（ADMIN_USER / ADMIN_PASSWORD），不进前端代码。
// 登录后发一个带过期时间的 HMAC 签名令牌，无状态，服务重启后仍有效；改密码会让旧令牌全部失效。
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const sign = payload => createHmac('sha256', `${ADMIN_USER}:${ADMIN_PASSWORD}`).update(payload).digest('base64url');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

function issueToken() {
  const expires = String(Date.now() + TOKEN_TTL_MS);
  return `${expires}.${sign(expires)}`;
}

function isAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const [expires, signature] = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').split('.');
  return Boolean(signature) && Number(expires) > Date.now() && safeEqual(signature, sign(expires));
}

const MAX_WORDS = 10000;
const BATCH_SIZE = 400;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw Object.assign(new Error('请求体过大'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }); }
}

const text = (value, max) => String(value ?? '').trim().slice(0, max);

// Books/{bookId}/words/{0001..}：以顺序号作文档 ID，重复上传同一本书是幂等覆盖。
async function replaceBook(bookId, title, words) {
  const bookRef = db.collection('Books').doc(bookId);
  const wordsRef = bookRef.collection('words');

  const stale = await wordsRef.select().get();
  for (let i = 0; i < stale.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    stale.docs.slice(i, i + BATCH_SIZE).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }

  const pad = String(words.length).length;
  const ordered = [];
  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    const batch = db.batch();
    words.slice(i, i + BATCH_SIZE).forEach((word, offset) => {
      const order = i + offset + 1;
      ordered.push({ order, ...word });
      batch.set(wordsRef.doc(String(order).padStart(pad, '0')), { order, ...word });
    });
    await batch.commit();
  }

  await bookRef.set({ title, count: words.length, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return ordered;
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const match = url.pathname.match(/^\/api\/books\/([^/]+)\/words$/);
  try {
    if (url.pathname === '/api/books/status' && req.method === 'GET') return send(res, 200, { ok: true, projectId });

    if (url.pathname === '/api/admin/login' && req.method === 'POST') {
      if (!ADMIN_PASSWORD) return send(res, 503, { error: '服务器尚未配置 ADMIN_PASSWORD' });
      const body = await readJson(req);
      const ok = safeEqual(text(body.username, 100), ADMIN_USER) & safeEqual(String(body.password ?? ''), ADMIN_PASSWORD);
      if (!ok) return send(res, 401, { error: '用户名或密码错误' });
      return send(res, 200, { token: issueToken(), username: ADMIN_USER });
    }

    // 只列出 words 子集合里确实有数据的单词书（空壳文档如 N1–N4 不展示）。
    if (url.pathname === '/api/books' && req.method === 'GET') {
      const books = await db.collection('Books').get();
      const list = await Promise.all(books.docs.map(async doc => {
        const count = (await doc.ref.collection('words').count().get()).data().count;
        return { id: doc.id, title: text(doc.get('title'), 100) || doc.id, count };
      }));
      return send(res, 200, { books: list.filter(book => book.count > 0) });
    }

    if (match && req.method === 'GET') {
      const bookRef = db.collection('Books').doc(decodeURIComponent(match[1]));
      const [book, snap] = await Promise.all([bookRef.get(), bookRef.collection('words').orderBy('order').limit(MAX_WORDS).get()]);
      if (!book.exists || snap.empty) return send(res, 404, { error: '这本单词书没有数据' });
      const words = snap.docs.map(doc => {
        const w = doc.data();
        return { order: w.order, japanese: text(w.japanese ?? w.word, 120), kana: text(w.kana, 120), romaji: text(w.romaji, 120), chinese: text(w.chinese ?? w.meaning, 240) };
      }).filter(w => w.japanese);
      return send(res, 200, { bookId: book.id, title: text(book.get('title'), 100) || book.id, words });
    }

    const audio = url.pathname.match(/^\/api\/books\/([^/]+)\/audio\/(\d{1,5})$/);
    if (audio && req.method === 'GET') {
      const snap = await db.collection('Books').doc(decodeURIComponent(audio[1])).collection('audio').doc(audio[2]).get();
      if (!snap.exists) return send(res, 404, { error: '这个单词还没有生成语音，请运行 npm run audio' });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.end(snap.get('data'));
    }

    if (match && req.method === 'PUT') {
      if (!isAdmin(req)) return send(res, 401, { error: '登录已失效，请重新登录' });
      const bookId = decodeURIComponent(match[1]);
      if (!/^[\w\-぀-ヿ一-鿿]{1,60}$/.test(bookId)) return send(res, 400, { error: '词库 ID 只能包含字母、数字、下划线、连字符和中日文字符' });
      const body = await readJson(req);
      const words = (Array.isArray(body.words) ? body.words : [])
        .map(w => ({ japanese: text(w.japanese, 120), kana: text(w.kana, 120), romaji: text(w.romaji, 120), chinese: text(w.chinese, 240) }))
        .filter(w => w.japanese);
      if (!words.length) return send(res, 400, { error: '没有可上传的单词' });
      if (words.length > MAX_WORDS) return send(res, 400, { error: `单个词库最多 ${MAX_WORDS} 个单词` });
      if (audioJobs.get(bookId)?.status === 'running') return send(res, 409, { error: '这本书的语音还在生成中，请等完成后再上传' });
      const ordered = await replaceBook(bookId, text(body.title, 100) || bookId, words);
      startAudioJob(bookId, ordered);
      return send(res, 200, { bookId, count: words.length });
    }

    const audioStatus = url.pathname.match(/^\/api\/books\/([^/]+)\/audio-status$/);
    if (audioStatus && req.method === 'GET') {
      const job = audioJobs.get(decodeURIComponent(audioStatus[1]));
      return send(res, 200, job || { status: 'idle' });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return send(res, error.status || 500, { error: error instanceof Error ? error.message : '服务器错误' });
  }
}).listen(PORT, HOST, () => console.log(`Firestore API  http://${HOST}:${PORT}  (project: ${projectId})`));
