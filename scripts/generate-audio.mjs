// 用法: node --env-file=.env.local scripts/generate-audio.mjs <bookId> [--voice ja-JP-Chirp3-HD-Kore] [--source kana|japanese] [--force]
// 为 Books/{bookId}/words 里的每个单词用 Cloud TTS 合成日语 MP3，存入 Books/{bookId}/audio/{order}。
// admin 页上传时会自动生成音频；这个脚本用于补跑失败项或换声线重新生成。
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { DEFAULT_VOICE, createSynthesizer, generateBookAudio } from '../server/tts.mjs';

const args = process.argv.slice(2);
const bookId = args.find(arg => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--voice' && args[args.indexOf(arg) - 1] !== '--source');
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const voice = option('--voice', DEFAULT_VOICE);
const source = option('--source', 'auto');
const force = args.includes('--force');
if (!bookId) { console.error('请提供 bookId，例如: npm run audio -- BJT_HIGHT'); process.exit(1); }

const credentials = JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
initializeApp({ credential: cert(credentials) });
const db = getFirestore();

const bookRef = db.collection('Books').doc(bookId);
const words = (await bookRef.collection('words').orderBy('order').get()).docs.map(doc => doc.data());
console.log(`${bookId}: ${words.length} 个单词，声线 ${voice}`);

let announced = false;
const result = await generateBookAudio(db, bookRef, words, {
  synthesize: createSynthesizer(credentials), voice, source, force,
  onProgress: p => {
    if (!announced) { console.log(`需合成 ${p.total} 个`); announced = true; }
    const handled = p.done + p.failed;
    if (handled && handled % 50 === 0) console.log(`  ${handled}/${p.total}`);
  },
});
result.errors.forEach(line => console.error(line));
console.log(`完成：成功 ${result.done}，失败 ${result.failed}`);
process.exit(result.failed ? 1 : 0);
