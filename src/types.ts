export type Vocabulary = {
  id: string;
  japanese: string;
  kana: string;
  romaji: string;
  chinese: string;
  bookId?: string;
  order?: number;
};

export type SpeechMode = 'ja' | 'zh';
export type TtsEngine = 'system' | 'gemini' | 'cloud';

export type Settings = {
  interval: 1 | 3 | 5;
  rate: 0.5 | 1 | 1.5 | 2 | 3;
  mode: SpeechMode;
  shuffle: boolean;
  ttsEngine: TtsEngine;
};
