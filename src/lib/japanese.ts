const digraphs: Record<string, string> = {
  きゃ:'kya',きゅ:'kyu',きょ:'kyo',ぎゃ:'gya',ぎゅ:'gyu',ぎょ:'gyo',しゃ:'sha',しゅ:'shu',しょ:'sho',
  じゃ:'ja',じゅ:'ju',じょ:'jo',ちゃ:'cha',ちゅ:'chu',ちょ:'cho',にゃ:'nya',にゅ:'nyu',にょ:'nyo',
  ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',びゃ:'bya',びゅ:'byu',びょ:'byo',ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo',
  みゃ:'mya',みゅ:'myu',みょ:'myo',りゃ:'rya',りゅ:'ryu',りょ:'ryo',てぃ:'ti',でぃ:'di',ふぁ:'fa',ふぃ:'fi',ふぇ:'fe',ふぉ:'fo',
};
const mono: Record<string, string> = {
  あ:'a',い:'i',う:'u',え:'e',お:'o',か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',
  さ:'sa',し:'shi',す:'su',せ:'se',そ:'so',ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to',
  だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',
  ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',
  や:'ya',ゆ:'yu',よ:'yo',ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',わ:'wa',を:'o',ん:'n',ゔ:'vu',ー:'-',
};

export function toHiragana(value: string) {
  return [...value].map(char => {
    const code = char.charCodeAt(0);
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : char;
  }).join('');
}

export function toRomaji(value: string) {
  const text = toHiragana(value).replace(/[・\s]/g, ' ');
  let result = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === 'っ') {
      const next = digraphs[text.slice(i + 1, i + 3)] || mono[text[i + 1]] || '';
      result += next[0] || '';
      continue;
    }
    const pair = text.slice(i, i + 2);
    if (digraphs[pair]) { result += digraphs[pair]; i += 1; continue; }
    if (text[i] === 'ー') {
      const vowel = result.match(/[aeiou](?!.*[aeiou])/g)?.at(-1);
      result += vowel || '';
      continue;
    }
    result += mono[text[i]] ?? text[i];
  }
  return result.replace(/n(?=[bmp])/g, 'm').trim();
}
