import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen, Check, CheckCircle2, ChevronLeft, ChevronRight, Eye, Languages, Library, ListMusic, Loader2,
  Pause, Play, Settings as SettingsIcon, Shuffle, Sparkles, Volume2, X,
} from 'lucide-react';
import type { Book, Settings, Vocabulary } from './types';

const LOADED_TOAST_MS = 3000;
// iOS 只允许在用户手势里首次 play()，之后复用同一个 audio 元素才能自动连播
const SILENT_WAV = 'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

const starterWords: Vocabulary[] = [
  { id:'1', japanese:'先生', kana:'せんせい', romaji:'sensei', chinese:'老师；先生' },
  { id:'2', japanese:'給与', kana:'きゅうよ', romaji:'kyuuyo', chinese:'工资；薪金；供给' },
  { id:'3', japanese:'借りる', kana:'かりる', romaji:'kariru', chinese:'借入；租借' },
  { id:'4', japanese:'締め切り', kana:'しめきり', romaji:'shimekiri', chinese:'截止日期；期限' },
  { id:'5', japanese:'間に合う', kana:'まにあう', romaji:'maniau', chinese:'赶得上；来得及' },
  { id:'6', japanese:'見積もり', kana:'みつもり', romaji:'mitsumori', chinese:'估价；报价' },
];

const defaultSettings: Settings = { interval: 3, rate: 1, mode: 'ja', shuffle: false, ttsEngine: 'cloud' };
const rates: Settings['rate'][] = [0.5, 1, 1.5, 2, 3];
const intervals: Settings['interval'][] = [1, 3, 5];

function loadWords() {
  try { return JSON.parse(localStorage.getItem('kotoba-words') || '') as Vocabulary[]; }
  catch { return starterWords; }
}

// 中文播报只能用系统语音；偏好保留，切回日文播报后自动恢复。
const effectiveEngine = (settings: Settings): Settings['ttsEngine'] => settings.mode === 'zh' ? 'system' : settings.ttsEngine;

function loadSettings() {
  try {
    const saved = { ...defaultSettings, ...JSON.parse(localStorage.getItem('kotoba-settings') || '') } as Settings;
    return (saved.ttsEngine as string) === 'gemini' ? { ...saved, ttsEngine: 'cloud' as const } : saved;
  }
  catch { return defaultSettings; }
}

function bestSystemVoice(mode: Settings['mode']) {
  const prefix = mode === 'ja' ? 'ja' : 'zh';
  const preferred = mode === 'ja' ? /kyoko|otoya|nanami|haruka|google.*日本語/i : /tingting|meijia|sinji|google.*中文/i;
  const voices = speechSynthesis.getVoices().filter(voice => voice.lang.toLowerCase().startsWith(prefix));
  return voices.find(voice => preferred.test(voice.name)) || voices.find(voice => !voice.localService) || voices[0] || null;
}

function App() {
  const [words, setWords] = useState<Vocabulary[]>(loadWords);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBooks, setShowBooks] = useState(false);
  const [currentBook, setCurrentBook] = useState(() => localStorage.getItem('kotoba-book') || '');
  const [message, setMessage] = useState('');
  const [loaded, setLoaded] = useState(0);
  const timerRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const indexRef = useRef(0);
  const settingsRef = useRef(settings);
  const wordsRef = useRef(words);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);
  const audioUrlRef = useRef('');
  const audioAbortRef = useRef<AbortController | null>(null);
  const playTokenRef = useRef(0);

  const current = words[index];
  const progress = words.length ? ((index + 1) / words.length) * 100 : 0;

  useEffect(() => { localStorage.setItem('kotoba-words', JSON.stringify(words)); wordsRef.current = words; }, [words]);
  useEffect(() => { localStorage.setItem('kotoba-settings', JSON.stringify(settings)); settingsRef.current = settings; }, [settings]);
  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => {
    if (!loaded) return;
    const t = window.setTimeout(() => setLoaded(0), LOADED_TOAST_MS);
    return () => window.clearTimeout(t);
  }, [loaded]);
  useEffect(() => { localStorage.setItem('kotoba-book', currentBook); }, [currentBook]);
  useEffect(() => {
    return () => {
      speechSynthesis.cancel(); audioAbortRef.current?.abort(); audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const getPlayer = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.setAttribute('playsinline', '');
    }
    return audioRef.current;
  }, []);

  // 必须在点击事件里同步调用
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    const player = getPlayer();
    player.src = SILENT_WAV;
    player.play().then(() => { audioUnlockedRef.current = true; }).catch(() => {});
  }, [getPlayer]);

  const stop = useCallback(() => {
    playTokenRef.current += 1;
    playingRef.current = false;
    setPlaying(false);
    speechSynthesis.cancel();
    audioAbortRef.current?.abort();
    audioAbortRef.current = null;
    const player = audioRef.current;
    if (player) { player.onended = null; player.onerror = null; player.pause(); player.removeAttribute('src'); player.load(); }
    if (audioUrlRef.current) { URL.revokeObjectURL(audioUrlRef.current); audioUrlRef.current = ''; }
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const playItem = useCallback(async (item: Vocabulary, onEnd?: () => void, requirePlaying = true, token = playTokenRef.current) => {
    const mode = settingsRef.current.mode;
    const text = mode === 'ja' ? item.japanese : item.chinese;
    const speakWithSystem = () => {
      if (token !== playTokenRef.current || (requirePlaying && !playingRef.current)) return;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = mode === 'ja' ? 'ja-JP' : 'zh-CN';
      utterance.rate = settingsRef.current.rate;
      utterance.voice = bestSystemVoice(mode);
      utterance.onend = () => token === playTokenRef.current && onEnd?.();
      utterance.onerror = () => stop();
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    };

    const cloud = effectiveEngine(settingsRef.current) === 'cloud' && mode === 'ja' && item.bookId && item.order;
    if (!cloud) return speakWithSystem();
    const controller = new AbortController();
    audioAbortRef.current = controller;
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(item.bookId!)}/audio/${item.order}`, { signal: controller.signal });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || '语音加载失败');
      }
      const blob = await response.blob();
      if (token !== playTokenRef.current || (requirePlaying && !playingRef.current)) return;
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = getPlayer();
      audio.src = url;
      audio.playbackRate = settingsRef.current.rate;
      audio.onended = () => {
        if (audioUrlRef.current === url) { URL.revokeObjectURL(url); audioUrlRef.current = ''; }
        if (token === playTokenRef.current) onEnd?.();
      };
      audio.onerror = () => { if (token === playTokenRef.current) stop(); };
      await audio.play();
    } catch (error) {
      if (controller.signal.aborted || token !== playTokenRef.current) return;
      setMessage(`${error instanceof Error ? error.message : '语音不可用'}，已回退到系统语音`);
      speakWithSystem();
    }
  }, [stop, getPlayer]);

  const speakAt = useCallback((at: number) => {
    const list = wordsRef.current;
    if (!list.length || !playingRef.current) return;
    const item = list[at];
    const token = playTokenRef.current;
    void playItem(item, () => {
      if (!playingRef.current) return;
      timerRef.current = window.setTimeout(() => {
        if (!playingRef.current || token !== playTokenRef.current) return;
        const length = wordsRef.current.length;
        const next = settingsRef.current.shuffle
          ? Math.floor(Math.random() * length)
          : (indexRef.current + 1) % length;
        indexRef.current = next;
        setIndex(next);
        speakAt(next);
      }, settingsRef.current.interval * 1000);
    }, true, token);
  }, [playItem]);

  const togglePlay = () => {
    if (playingRef.current) return stop();
    if (!words.length) return;
    unlockAudio();
    playingRef.current = true;
    setPlaying(true);
    speakAt(indexRef.current);
  };

  const previewCurrent = () => {
    stop();
    const item = wordsRef.current[indexRef.current];
    if (!item) return;
    unlockAudio();
    void playItem(item, undefined, false, playTokenRef.current);
  };

  const move = (direction: number) => {
    stop();
    if (!words.length) return;
    setIndex(value => (value + direction + words.length) % words.length);
  };

  const updateSettings = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    stop();
    setSettings(previous => ({ ...previous, [key]: value }));
  };

  const loadBook = async (book: Book) => {
    const response = await fetch(`/api/books/${encodeURIComponent(book.id)}/words`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `加载失败 (${response.status})`);
    const list: Vocabulary[] = payload.words.map((word: Omit<Vocabulary, 'id'>) => ({ ...word, id: `${book.id}-${word.order}`, bookId: book.id }));
    stop();
    setWords(list);
    setIndex(0);
    setCurrentBook(book.id);
    setShowBooks(false);
    setLoaded(Date.now());
  };

  const empty = !words.length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">こ</span><span>KOTOBA <b>FLOW</b></span></div>
        <div className="header-actions">
          <button className="ghost-button" onClick={() => setShowBooks(true)}><ListMusic size={18}/><span className="book-name">{currentBook || '选择单词书'}</span></button>
        </div>
      </header>

      <main className="study-layout">
        <section className="study-area">
          <article className={`word-card ${empty ? 'empty-card' : ''}`}>
            {empty ? (
              <div className="empty-state"><BookOpen size={42}/><h2>词库还是空的</h2><p>选择一本单词书，开始建立你的听辨循环。</p><button className="primary-button" onClick={() => setShowBooks(true)}><Library size={18}/>选择单词书</button></div>
            ) : (
              <>
                <div className="card-top"><span className="card-label"><Volume2 size={15}/> NOW PLAYING</span><div className="card-top-right"><div className="counter"><strong>{index + 1}</strong><span>/ {words.length}</span></div><button className="sound-button" onClick={previewCurrent} aria-label="仅播放当前单词"><Volume2 size={22}/></button></div></div>
                <div className="word-content">
                  <div className="japanese-word">{current.japanese}</div>
                  <div className="reading">［ {current.kana || '待补充假名'} ］</div>
                  <div className="romaji">{current.romaji || 'romaji pending'}</div>
                  <div className="divider"/>
                  <div className="meaning">{current.chinese || '待补充中文释义'}</div>
                </div>
                <div className="card-footer"><span><Eye size={16}/> 日文与中文模式显示相同卡片</span><span className="memory-tag"><Sparkles size={14}/> ACTIVE RECALL</span></div>
              </>
            )}
          </article>

          <div className="progress-track"><span style={{ width: `${progress}%` }}/></div>

          <div className="player">
            <button className="round-button" onClick={() => setShowSettings(true)} aria-label="设置"><SettingsIcon size={22}/></button>
            <div className="transport">
              <button className="step-button" onClick={() => move(-1)} aria-label="上一个"><ChevronLeft size={26}/></button>
              <button className="play-button" onClick={togglePlay} disabled={empty} aria-label={playing ? '暂停' : '播放'}>
                {playing ? <Pause size={30} fill="currentColor"/> : <Play size={31} fill="currentColor"/>}
              </button>
              <button className="step-button" onClick={() => move(1)} aria-label="下一个"><ChevronRight size={26}/></button>
            </div>
            <div className="player-right">
              <button className="lang-toggle" onClick={() => updateSettings('mode', settings.mode === 'ja' ? 'zh' : 'ja')} aria-label="切换播报语言"><Languages size={15}/>{settings.mode === 'ja' ? '日' : '中'}</button>
            </div>
          </div>
        </section>

      </main>

      {showSettings && <SettingsModal settings={settings} onChange={updateSettings} onClose={() => setShowSettings(false)} />}
      {showBooks && <BookPickerModal current={currentBook} onPick={loadBook} onClose={() => setShowBooks(false)} />}
      {!!loaded && <div className="loaded-toast" role="status" aria-label="加载成功" onClick={() => setLoaded(0)}><CheckCircle2 size={30} strokeWidth={2.2}/></div>}
      {message && <div className="toast" role="status"><Check size={17}/><span>{message}</span><button onClick={() => setMessage('')}><X size={15}/></button></div>}
    </div>
  );
}

function ModalFrame({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    // 弹窗打开时锁定背景滚动（iOS 需要 position: fixed）
    const { scrollY } = window;
    const { style } = document.body;
    const previous = { position: style.position, top: style.top, width: style.width };
    style.position = 'fixed'; style.top = `-${scrollY}px`; style.width = '100%';
    return () => {
      style.position = previous.position; style.top = previous.top; style.width = previous.width;
      window.scrollTo(0, scrollY);
    };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className={`modal ${wide ? 'wide' : ''}`}><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button onClick={onClose}><X size={22}/></button></div>{children}</section></div>;
}

function SettingsModal({ settings, onChange, onClose }: { settings: Settings; onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void; onClose: () => void }) {
  const engine = effectiveEngine(settings);
  return <ModalFrame title="播放设置" subtitle="每次更改会停止当前播放，避免队列错位。" onClose={onClose}>
    <div className="setting-group"><label>语音引擎</label><div className="segmented"><button className={engine === 'cloud' ? 'active' : ''} disabled={settings.mode === 'zh'} onClick={() => onChange('ttsEngine','cloud')}>Google 日语<small>{settings.mode === 'zh' ? '中文播报不可用' : '预生成，仅日文播报'}</small></button><button className={engine === 'system' ? 'active' : ''} onClick={() => onChange('ttsEngine','system')}>系统语音<small>免费、即时、可离线</small></button></div></div>
    <div className="setting-group"><label>播报模式</label><div className="segmented"><button className={settings.mode === 'ja' ? 'active' : ''} onClick={() => onChange('mode','ja')}>日文播报<small>听音辨义</small></button><button className={settings.mode === 'zh' ? 'active' : ''} onClick={() => onChange('mode','zh')}>中文播报<small>主动说日文</small></button></div></div>
    <div className="setting-group"><label>单词间隔</label><div className="choice-row">{intervals.map(value => <button className={settings.interval === value ? 'active' : ''} onClick={() => onChange('interval', value)} key={value}>{value} 秒</button>)}</div></div>
    <div className="setting-group"><label>语速</label><div className="choice-row five">{rates.map(value => <button className={settings.rate === value ? 'active' : ''} onClick={() => onChange('rate', value)} key={value}>{value}×</button>)}</div></div>
    <label className="switch-row"><span><Shuffle size={18}/>随机播放顺序</span><input type="checkbox" checked={settings.shuffle} onChange={event => onChange('shuffle', event.target.checked)}/><i/></label>
  </ModalFrame>;
}

function BookPickerModal({ current, onPick, onClose }: { current: string; onPick: (book: Book) => Promise<void>; onClose: () => void }) {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState('');
  const [loadingId, setLoadingId] = useState('');
  useEffect(() => {
    fetch('/api/books').then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `读取失败 (${response.status})`);
      setBooks(payload.books);
    }).catch(err => setError(err instanceof Error ? err.message : '读取单词书失败'));
  }, []);
  const pick = async (book: Book) => {
    setLoadingId(book.id); setError('');
    try { await onPick(book); } catch (err) { setError(err instanceof Error ? err.message : '加载失败'); setLoadingId(''); }
  };
  return <ModalFrame title="选择单词书" onClose={onClose}>
    <div className="book-list">
      {!books && !error && <div className="book-status"><Loader2 size={20} className="spin"/>正在读取单词书…</div>}
      {books && !books.length && <div className="book-status">还没有带单词的单词书，先导入 CSV 吧。</div>}
      {books?.map(book => <button key={book.id} className={`book-row ${book.id === current ? 'active' : ''}`} disabled={Boolean(loadingId)} onClick={() => pick(book)}>
        <span className="book-icon"><Library size={20}/></span>
        <span className="book-info"><strong>{book.title}</strong><small>{book.count} 个单词</small></span>
        {loadingId === book.id ? <Loader2 size={18} className="spin"/> : book.id === current && <Check size={18}/>}
      </button>)}
      {error && <div className="book-status error">{error}</div>}
    </div>
  </ModalFrame>;
}

export default App;
