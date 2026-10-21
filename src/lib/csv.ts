import type { Vocabulary } from '../types';
import { toHiragana, toRomaji } from './japanese';

function parseRows(input: string) {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const text = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field.trim()); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field.trim()); field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const aliases: Record<string, string[]> = {
  japanese: ['japanese','日文','日语','単語','单词','word'],
  kana: ['kana','假名','かな','平假名','よみ','reading'],
  romaji: ['romaji','罗马音','羅馬字','romanization'],
  chinese: ['chinese','中文','意思','释义','翻译','meaning','translation'],
};

export function parseVocabularyCsv(text: string): Vocabulary[] {
  const rows = parseRows(text);
  if (!rows.length) return [];
  const normalized = rows[0].map(value => value.toLowerCase().replace(/\s/g, ''));
  const find = (name: keyof typeof aliases) => normalized.findIndex(value => aliases[name].includes(value));
  const indexes = { japanese: find('japanese'), kana: find('kana'), romaji: find('romaji'), chinese: find('chinese') };
  const hasHeader = indexes.japanese >= 0;
  if (!hasHeader) indexes.japanese = 0;
  return rows.slice(hasHeader ? 1 : 0).map((row, position) => {
    const japanese = row[indexes.japanese] || '';
    const rawKana = indexes.kana >= 0 ? row[indexes.kana] || '' : (/^[\u3040-\u30ffー\s]+$/.test(japanese) ? japanese : '');
    const kana = toHiragana(rawKana);
    return {
      id: `${Date.now()}-${position}-${Math.random().toString(36).slice(2, 7)}`,
      japanese,
      kana,
      romaji: indexes.romaji >= 0 ? row[indexes.romaji] || toRomaji(kana) : toRomaji(kana),
      chinese: indexes.chinese >= 0 ? row[indexes.chinese] || '' : '',
    };
  }).filter(word => word.japanese);
}
