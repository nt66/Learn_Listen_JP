// Cloud TTS 合成日语 MP3，存入 Books/{bookId}/audio/{order}。供 scripts/generate-audio.mjs 与上传接口共用。
import { GoogleAuth } from 'google-auth-library';

export const DEFAULT_VOICE = 'ja-JP-Chirp3-HD-Kore';
const CONCURRENCY = 2;
const BATCH_SIZE = 400;

const kanaOnly = /^[぀-ヿー]+$/;
// 默认：纯假名/片假名词直接读原文；含汉字的词读假名，避免「上期」之类被读错。
export const textFor = (word, source = 'auto') => source === 'japanese' ? word.japanese
  : source === 'kana' ? (word.kana || word.japanese)
  : kanaOnly.test(word.japanese) ? word.japanese : (word.kana || word.japanese);

export function createSynthesizer(credentials) {
  const auth = new GoogleAuth({ ...(credentials ? { credentials } : {}), scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return async function synthesize(text, voice = DEFAULT_VOICE) {
    const client = await auth.getClient();
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
  };
}

// words 需带 order。已有音频且声线、朗读文本都相同的跳过（重新上传同一本书不重复计费）；
// 序号超出新词表的旧音频会被删除，避免播放到上一版单词的声音。
export async function generateBookAudio(db, bookRef, words, { synthesize, voice = DEFAULT_VOICE, source = 'auto', force = false, onProgress = () => {} }) {
  const audioRef = bookRef.collection('audio');
  const existing = await audioRef.select('voice', 'text').get();
  const orders = new Set(words.map(word => String(word.order)));

  const stale = existing.docs.filter(doc => !orders.has(doc.id));
  for (let i = 0; i < stale.length; i += BATCH_SIZE) {
    const batch = db.batch();
    stale.slice(i, i + BATCH_SIZE).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }

  const current = new Map(existing.docs.map(doc => [doc.id, doc.data()]));
  const todo = words.filter(word => {
    if (force) return true;
    const saved = current.get(String(word.order));
    return !saved || saved.voice !== voice || saved.text !== textFor(word, source);
  });

  const progress = { total: todo.length, done: 0, failed: 0, errors: [] };
  onProgress(progress);
  const queue = [...todo];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const word = queue.shift();
      const text = textFor(word, source);
      try {
        const data = await synthesize(text, voice);
        await audioRef.doc(String(word.order)).set({ data, voice, text });
        progress.done += 1;
      } catch (error) {
        progress.failed += 1;
        progress.errors.push(`#${word.order} ${text}: ${error instanceof Error ? error.message : error}`);
      }
      onProgress(progress);
    }
  }));
  return progress;
}
