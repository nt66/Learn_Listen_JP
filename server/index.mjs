import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PORT = Number(process.env.PORT || 8787);
const credentialPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const projectId = process.env.FIREBASE_PROJECT_ID || 'william-japanese-learn';

initializeApp({
  projectId,
  credential: credentialPath ? cert(JSON.parse(readFileSync(credentialPath, 'utf8'))) : applicationDefault(),
});
const db = getFirestore();

const MAX_WORDS = 2000;
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
  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    const batch = db.batch();
    words.slice(i, i + BATCH_SIZE).forEach((word, offset) => {
      const order = i + offset + 1;
      batch.set(wordsRef.doc(String(order).padStart(pad, '0')), { order, ...word });
    });
    await batch.commit();
  }

  await bookRef.set({ title, count: words.length, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const match = url.pathname.match(/^\/api\/books\/([^/]+)\/words$/);
  try {
    if (url.pathname === '/api/books/status' && req.method === 'GET') return send(res, 200, { ok: true, projectId });

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
      const bookId = decodeURIComponent(match[1]);
      if (!/^[\w\-぀-ヿ一-鿿]{1,60}$/.test(bookId)) return send(res, 400, { error: '词库 ID 只能包含字母、数字、下划线、连字符和中日文字符' });
      const body = await readJson(req);
      const words = (Array.isArray(body.words) ? body.words : [])
        .map(w => ({ japanese: text(w.japanese, 120), kana: text(w.kana, 120), romaji: text(w.romaji, 120), chinese: text(w.chinese, 240) }))
        .filter(w => w.japanese);
      if (!words.length) return send(res, 400, { error: '没有可上传的单词' });
      if (words.length > MAX_WORDS) return send(res, 400, { error: `单个词库最多 ${MAX_WORDS} 个单词` });
      await replaceBook(bookId, text(body.title, 100) || bookId, words);
      return send(res, 200, { bookId, count: words.length });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return send(res, error.status || 500, { error: error instanceof Error ? error.message : '服务器错误' });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Firestore API  http://127.0.0.1:${PORT}  (project: ${projectId})`));
