import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { GoogleAuth } from 'google-auth-library';

const outDir = process.argv[2];
mkdirSync(outDir, { recursive: true });
const auth = new GoogleAuth({
  keyFile: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});
const client = await auth.getClient();
const call = async (path, init) => {
  const { token } = await client.getAccessToken();
  const res = await fetch(`https://texttospeech.googleapis.com/v1/${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || res.status);
  return body;
};

const { voices = [] } = await call('voices?languageCode=ja-JP');
const names = voices.map(v => `${v.name} (${v.ssmlGender})`);
console.log(names.join('\n'));

const pick = process.argv.slice(3);
const words = [['一旦', 'いったん'], ['給与', 'きゅうよ'], ['上期', 'かみき'], ['ご確認', 'ごかくにん'], ['先生', 'せんせい']];
for (const voice of pick) {
  for (const [kanji, kana] of words) {
    for (const [kind, text] of [['kanji', kanji], ['kana', kana]]) {
      const { audioContent } = await call('text:synthesize', { method: 'POST', body: JSON.stringify({
        input: { text }, voice: { languageCode: 'ja-JP', name: voice }, audioConfig: { audioEncoding: 'MP3' },
      }) });
      writeFileSync(`${outDir}/${voice.replace('ja-JP-', '')}_${kanji}_${kind}.mp3`, Buffer.from(audioContent, 'base64'));
    }
  }
}
