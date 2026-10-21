// 用法: node --env-file=.env.local scripts/generate-audio.mjs <bookId> [--voice ja-JP-Chirp3-HD-Kore] [--source kana|japanese] [--force]
// 为 Books/{bookId}/words 里的每个单词用 Cloud TTS 合成日语 MP3，存入 Books/{bookId}/audio/{order}。
import { readFileSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const bookId = args.find(arg => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--voice' && args[args.indexOf(arg) - 1] !== '--source');
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const voice = option('--voice', 'ja-JP-Chirp3-HD-Kore');
const source = option('--source', 'auto');
const force = args.includes('--force');
if (!bookId) { console.error('请提供 bookId，例如: npm run audio -- BJT_HIGHT'); process.exit(1); }

const credentials = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
initializeApp({ credential: cert(credentials) });
const db = getFirestore();
const client = await new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();

const kanaOnly = /^[぀-ヿー]+$/;
// 默认：纯假名/片假名词直接读原文；含汉字的词读假名，避免「上期」之类被读错。
const textFor = word => source === 'japanese' ? word.japanese
  : source === 'kana' ? (word.kana || word.japanese)
  : kanaOnly.test(word.japanese) ? word.japanese : (word.kana || word.japanese);

async function synthesize(text) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { token } = await client.getAccessToken();
    const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text }, voice: { languageCode: 'ja-JP', name: voice }, audioConfig: { audioEncoding: 'MP3' } }),
    });
    const body = await res.json();
    if (res.ok) return Buffer.from(body.audioContent, 'base64');
    if (res.status !== 429 && res.status < 500) throw new Error(body.error?.message || res.status);
    await new Promise(resolve => setTimeout(resolve, 2000 * 2 ** attempt));
  }
  throw new Error('重试多次仍失败');
}

const bookRef = db.collection('Books').doc(bookId);
const words = (await bookRef.collection('words').orderBy('order').get()).docs.map(doc => doc.data());
const audioRef = bookRef.collection('audio');
const existing = new Set(force ? [] : (await audioRef.select('voice').get()).docs.filter(doc => doc.data().voice === voice).map(doc => doc.id));
const todo = words.filter(word => !existing.has(String(word.order)));
console.log(`${bookId}: ${words.length} 个单词，需合成 ${todo.length} 个，声线 ${voice}`);

let done = 0, failed = 0;
const queue = [...todo];
await Promise.all(Array.from({ length: 2 }, async () => {
  while (queue.length) {
    const word = queue.shift();
    const text = textFor(word);
    try {
      const data = await synthesize(text);
      await audioRef.doc(String(word.order)).set({ data, voice, text });
      done += 1;
    } catch (error) {
      failed += 1;
      console.error(`#${word.order} ${text}: ${error.message}`);
    }
    if ((done + failed) % 50 === 0) console.log(`  ${done + failed}/${todo.length}`);
  }
}));
console.log(`完成：成功 ${done}，失败 ${failed}`);
process.exit(failed ? 1 : 0);
