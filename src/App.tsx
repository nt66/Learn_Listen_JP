import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen, Check, ChevronLeft, ChevronRight, Download, Eye, FileUp, Gauge, Languages,
  ListMusic, Pause, Play, Plus, RotateCcw, Settings as SettingsIcon, Shuffle, Sparkles,
  Trash2, UploadCloud, Volume2, X,
} from 'lucide-react';
import { parseVocabularyCsv } from './lib/csv';
import { toHiragana, toRomaji } from './lib/japanese';
import type { Settings, Vocabulary } from './types';

const starterWords: Vocabulary[] = [
  { id:'1', japanese:'先生', kana:'せんせい', romaji:'sensei', chinese:'老师；先生' },
  { id:'2', japanese:'給与', kana:'きゅうよ', romaji:'kyuuyo', chinese:'工资；薪金；供给' },
  { id:'3', japanese:'借りる', kana:'かりる', romaji:'kariru', chinese:'借入；租借' },
  { id:'4', japanese:'締め切り', kana:'しめきり', romaji:'shimekiri', chinese:'截止日期；期限' },
  { id:'5', japanese:'間に合う', kana:'まにあう', romaji:'maniau', chinese:'赶得上；来得及' },
  { id:'6', japanese:'見積もり', kana:'みつもり', romaji:'mitsumori', chinese:'估价；报价' },
];

const defaultSettings: Settings = { interval: 3, rate: 1, mode: 'ja', shuffle: false, ttsEngine: 'system' };
const rates: Settings['rate'][] = [0.5, 1, 1.5, 2, 3];
const intervals: Settings['interval'][] = [1, 3, 5];

function loadWords() {
  try { return JSON.parse(localStorage.getItem('kotoba-words') || '') as Vocabulary[]; }
  catch { return starterWords; }
}

function loadSettings() {
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem('kotoba-settings') || '') } as Settings; }
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
  const [showImport, setShowImport] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [message, setMessage] = useState('');
  const [gemini, setGemini] = useState(false);
  const [model, setModel] = useState('');
  const [ttsModel, setTtsModel] = useState('');
  const [importing, setImporting] = useState(false);
  const timerRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const indexRef = useRef(0);
  const settingsRef = useRef(settings);
  const wordsRef = useRef(words);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef('');
  const audioAbortRef = useRef<AbortController | null>(null);
  const playTokenRef = useRef(0);

  const current = words[index];
  const progress = words.length ? ((index + 1) / words.length) * 100 : 0;

  useEffect(() => { localStorage.setItem('kotoba-words', JSON.stringify(words)); wordsRef.current = words; }, [words]);
  useEffect(() => { localStorage.setItem('kotoba-settings', JSON.stringify(settings)); settingsRef.current = settings; }, [settings]);
  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(data => {
      setGemini(Boolean(data.gemini)); setModel(data.model || ''); setTtsModel(data.ttsModel || '');
    }).catch(() => setGemini(false));
    return () => {
      speechSynthesis.cancel(); audioAbortRef.current?.abort(); audioRef.current?.pause();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const stop = useCallback(() => {
    playTokenRef.current += 1;
    playingRef.current = false;
    setPlaying(false);
    speechSynthesis.cancel();
    audioAbortRef.current?.abort();
    audioAbortRef.current = null;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; audioRef.current = null; }
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

    if (settingsRef.current.ttsEngine !== 'gemini' || !gemini) return speakWithSystem();
    const controller = new AbortController();
    audioAbortRef.current = controller;
    try {
      const response = await fetch('/api/tts', {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang: mode }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || '自然语音生成失败');
      }
      const blob = await response.blob();
      if (token !== playTokenRef.current || (requirePlaying && !playingRef.current)) return;
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.playbackRate = settingsRef.current.rate;
      audio.onended = () => {
        if (audioUrlRef.current === url) { URL.revokeObjectURL(url); audioUrlRef.current = ''; }
        audioRef.current = null;
        if (token === playTokenRef.current) onEnd?.();
      };
      audio.onerror = () => { if (token === playTokenRef.current) stop(); };
      await audio.play();
    } catch (error) {
      if (controller.signal.aborted || token !== playTokenRef.current) return;
      setMessage(`${error instanceof Error ? error.message : '自然语音不可用'}，已回退到系统语音`);
      speakWithSystem();
    }
  }, [gemini, stop]);

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
    playingRef.current = true;
    setPlaying(true);
    speakAt(indexRef.current);
  };

  const previewCurrent = () => {
    stop();
    const item = wordsRef.current[indexRef.current];
    if (!item) return;
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

  const importCsv = async (file: File, autoEnrich: boolean, replace: boolean) => {
    setImporting(true);
    try {
      const parsed = parseVocabularyCsv(await file.text());
      if (!parsed.length) throw new Error('CSV 中没有找到可导入的单词');
      let finalWords = parsed;
      const incomplete = parsed.some(word => !word.kana || !word.romaji || !word.chinese);
      if (autoEnrich && incomplete) {
        if (!gemini) throw new Error('Gemini 尚未配置；请导入包含 kana、romaji、chinese 列的 CSV');
        const response = await fetch('/api/enrich', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ words: parsed }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Gemini 补全失败');
        finalWords = parsed.map((word, i) => {
          const enriched = payload.words.find((entry: { index: number }) => entry.index === i) || {};
          const kana = toHiragana(enriched.kana || word.kana);
          return { ...word, ...enriched, id: word.id, japanese: word.japanese, kana, romaji: enriched.romaji || word.romaji || toRomaji(kana) };
        });
      }
      setWords(existing => replace ? finalWords : [...existing, ...finalWords]);
      setIndex(0);
      setShowImport(false);
      setMessage(`已导入 ${finalWords.length} 个单词${autoEnrich && incomplete ? '，并由 Gemini 完成注音与翻译' : ''}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败');
    } finally { setImporting(false); }
  };

  const updateWord = (id: string, key: keyof Omit<Vocabulary, 'id'>, value: string) => {
    setWords(list => list.map(word => word.id === id ? { ...word, [key]: value } : word));
  };

  const downloadTemplate = () => {
    const content = '\uFEFFjapanese,kana,romaji,chinese\n先生,せんせい,sensei,老师\n給与,,,\n';
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'kotoba-template.csv'; link.click();
    URL.revokeObjectURL(url);
  };

  const empty = !words.length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">こ</span><span>KOTOBA <b>FLOW</b></span></div>
        <div className="header-actions">
          <button className="ghost-button" onClick={() => setShowLibrary(true)}><ListMusic size={18}/><span>词库</span><em>{words.length}</em></button>
          <button className="primary-button compact" onClick={() => setShowImport(true)}><FileUp size={18}/><span>导入 CSV</span></button>
        </div>
      </header>

      <main className="study-layout">
        <section className="study-area">
          <div className="session-line">
            <div><span className="overline">LISTENING SESSION</span><h1>声音与意义，直接连接。</h1></div>
            <div className="counter"><strong>{empty ? 0 : index + 1}</strong><span>/ {words.length}</span></div>
          </div>

          <article className={`word-card ${empty ? 'empty-card' : ''}`}>
            {empty ? (
              <div className="empty-state"><BookOpen size={42}/><h2>词库还是空的</h2><p>导入 CSV，开始建立你的听辨循环。</p><button className="primary-button" onClick={() => setShowImport(true)}><Plus size={18}/>导入单词</button></div>
            ) : (
              <>
                <div className="card-top"><span className="card-label"><Volume2 size={15}/> NOW PLAYING</span><button className="sound-button" onClick={previewCurrent} aria-label="仅播放当前单词"><Volume2 size={22}/></button></div>
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
            <button className="rate-button" onClick={() => setShowSettings(true)}><strong>{settings.rate.toFixed(1)}×</strong><span>{settings.interval}s 间隔</span></button>
          </div>
        </section>

        <aside className="side-panel">
          <div className="mode-visual"><div className="pulse"><Volume2 size={24}/></div><span>当前播报 · {settings.ttsEngine === 'gemini' ? 'AI 自然语音' : '系统语音'}</span><strong>{settings.mode === 'ja' ? '日本語' : '中文'}</strong><small>{settings.mode === 'ja' ? '训练声音 → 意义通路' : '训练提示 → 日语提取'}</small></div>
          <div className="quick-settings">
            <h3>快速设置</h3>
            <button onClick={() => updateSettings('mode', settings.mode === 'ja' ? 'zh' : 'ja')}><Languages size={18}/><span>播报语言</span><b>{settings.mode === 'ja' ? '日文' : '中文'}</b></button>
            <button onClick={() => setShowSettings(true)}><Sparkles size={18}/><span>语音引擎</span><b className={settings.ttsEngine === 'gemini' ? 'on' : ''}>{settings.ttsEngine === 'gemini' ? '自然' : '系统'}</b></button>
            <button onClick={() => setShowSettings(true)}><Gauge size={18}/><span>播放速度</span><b>{settings.rate}×</b></button>
            <button onClick={() => updateSettings('shuffle', !settings.shuffle)}><Shuffle size={18}/><span>随机顺序</span><b className={settings.shuffle ? 'on' : ''}>{settings.shuffle ? '开启' : '关闭'}</b></button>
          </div>
          <div className="tip"><span>学习提示</span><p>先听声音再看卡片。能在 2–4 秒内说出答案，才算真正完成一次提取。</p></div>
        </aside>
      </main>

      {showSettings && <SettingsModal settings={settings} gemini={gemini} ttsModel={ttsModel} onChange={updateSettings} onClose={() => setShowSettings(false)} />}
      {showImport && <ImportModal gemini={gemini} model={model} importing={importing} onImport={importCsv} onTemplate={downloadTemplate} onClose={() => setShowImport(false)} />}
      {showLibrary && <LibraryModal words={words} onUpdate={updateWord} onDelete={id => { stop(); setWords(list => list.filter(word => word.id !== id)); setIndex(0); }} onReset={() => { stop(); setWords(starterWords); setIndex(0); }} onClose={() => setShowLibrary(false)} />}
      {message && <div className="toast" role="status"><Check size={17}/><span>{message}</span><button onClick={() => setMessage('')}><X size={15}/></button></div>}
    </div>
  );
}

function ModalFrame({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className={`modal ${wide ? 'wide' : ''}`}><div className="modal-head"><div><h2>{title}</h2><p>{subtitle}</p></div><button onClick={onClose}><X size={22}/></button></div>{children}</section></div>;
}

function SettingsModal({ settings, gemini, ttsModel, onChange, onClose }: { settings: Settings; gemini: boolean; ttsModel: string; onChange: <K extends keyof Settings>(key: K, value: Settings[K]) => void; onClose: () => void }) {
  return <ModalFrame title="播放设置" subtitle="每次更改会停止当前播放，避免队列错位。" onClose={onClose}>
    <div className="setting-group"><label>语音引擎</label><div className="segmented"><button className={settings.ttsEngine === 'system' ? 'active' : ''} onClick={() => onChange('ttsEngine','system')}>系统语音<small>免费、即时、可离线</small></button><button disabled={!gemini} className={settings.ttsEngine === 'gemini' ? 'active natural-option' : 'natural-option'} onClick={() => onChange('ttsEngine','gemini')}>AI 自然语音<small>{gemini ? ttsModel : '需要配置 Gemini API'}</small></button></div></div>
    <div className="setting-group"><label>播报模式</label><div className="segmented"><button className={settings.mode === 'ja' ? 'active' : ''} onClick={() => onChange('mode','ja')}>日文播报<small>听音辨义</small></button><button className={settings.mode === 'zh' ? 'active' : ''} onClick={() => onChange('mode','zh')}>中文播报<small>主动说日文</small></button></div></div>
    <div className="setting-group"><label>单词间隔</label><div className="choice-row">{intervals.map(value => <button className={settings.interval === value ? 'active' : ''} onClick={() => onChange('interval', value)} key={value}>{value} 秒</button>)}</div></div>
    <div className="setting-group"><label>语速</label><div className="choice-row five">{rates.map(value => <button className={settings.rate === value ? 'active' : ''} onClick={() => onChange('rate', value)} key={value}>{value}×</button>)}</div></div>
    <label className="switch-row"><span><Shuffle size={18}/>随机播放顺序</span><input type="checkbox" checked={settings.shuffle} onChange={event => onChange('shuffle', event.target.checked)}/><i/></label>
  </ModalFrame>;
}

function ImportModal({ gemini, model, importing, onImport, onTemplate, onClose }: { gemini: boolean; model: string; importing: boolean; onImport: (file: File, enrich: boolean, replace: boolean) => void; onTemplate: () => void; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [enrich, setEnrich] = useState(gemini);
  const [replace, setReplace] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return <ModalFrame title="导入 CSV 词库" subtitle="最少只需 japanese 一列；配置 Gemini 后可自动补全其余字段。" onClose={onClose}>
    <input ref={inputRef} hidden type="file" accept=".csv,text/csv" onChange={event => setFile(event.target.files?.[0] || null)}/>
    <button className={`dropzone ${file ? 'has-file' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); setFile(event.dataTransfer.files[0] || null); }}>
      {file ? <><Check size={30}/><strong>{file.name}</strong><span>{(file.size / 1024).toFixed(1)} KB · 点击重新选择</span></> : <><UploadCloud size={34}/><strong>拖入 CSV，或点击选择</strong><span>支持 UTF-8 与带 BOM 的 CSV</span></>}
    </button>
    <div className="csv-columns"><code>japanese</code><code>kana</code><code>romaji</code><code>chinese</code></div>
    <label className={`check-row ${!gemini ? 'disabled' : ''}`}><input type="checkbox" checked={enrich} disabled={!gemini} onChange={event => setEnrich(event.target.checked)}/><span><b><Sparkles size={16}/> Gemini 自动补全</b><small>{gemini ? `已连接 ${model}` : '未配置 GEMINI_API_KEY，将保留空白字段'}</small></span></label>
    <label className="check-row"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)}/><span><b><RotateCcw size={16}/>替换当前词库</b><small>关闭时会追加到现有词库末尾</small></span></label>
    <div className="modal-actions"><button className="secondary-button" onClick={onTemplate}><Download size={17}/>下载模板</button><button className="primary-button" disabled={!file || importing} onClick={() => file && onImport(file, enrich, replace)}>{importing ? '正在处理…' : '开始导入'}</button></div>
  </ModalFrame>;
}

function LibraryModal({ words, onUpdate, onDelete, onReset, onClose }: { words: Vocabulary[]; onUpdate: (id: string, key: keyof Omit<Vocabulary,'id'>, value: string) => void; onDelete: (id: string) => void; onReset: () => void; onClose: () => void }) {
  return <ModalFrame title={`词库 · ${words.length}`} subtitle="可以直接修正 Gemini 译文或假名；内容会自动保存在浏览器。" onClose={onClose} wide>
    <div className="library-list">{words.map((word, i) => <div className="library-row" key={word.id}><span className="row-number">{String(i + 1).padStart(2,'0')}</span><input value={word.japanese} aria-label="日文" onChange={e => onUpdate(word.id,'japanese',e.target.value)}/><input value={word.kana} aria-label="假名" placeholder="平假名" onChange={e => onUpdate(word.id,'kana',e.target.value)}/><input value={word.romaji} aria-label="罗马音" placeholder="romaji" onChange={e => onUpdate(word.id,'romaji',e.target.value)}/><input value={word.chinese} aria-label="中文" placeholder="中文释义" onChange={e => onUpdate(word.id,'chinese',e.target.value)}/><button className="delete-button" onClick={() => onDelete(word.id)} aria-label="删除"><Trash2 size={17}/></button></div>)}</div>
    <div className="library-legend"><span>日文</span><span>假名</span><span>罗马音</span><span>中文释义</span></div>
    <div className="modal-actions"><button className="secondary-button danger" onClick={onReset}><RotateCcw size={17}/>恢复示例词库</button><button className="primary-button" onClick={onClose}>完成</button></div>
  </ModalFrame>;
}

export default App;
