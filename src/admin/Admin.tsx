import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, AudioLines, Check, FileUp, Library, Loader2, LogOut, RefreshCw, UploadCloud, X } from 'lucide-react';
import { parseVocabularyCsv } from '../lib/csv';
import type { Book, Vocabulary } from '../types';
import './admin.css';

// 账号密码只在服务端（.env.local 的 ADMIN_USER / ADMIN_PASSWORD）校验，这里只保存登录后拿到的令牌。
const SESSION_KEY = 'kotoba-admin';
type Session = { token: string; username: string };
const BOOK_ID_PATTERN = /^[\w\-぀-ヿ一-鿿]{1,60}$/;

type Route = '/admin/login' | '/admin/upload';
type AudioJob = { bookId: string; status: 'running' | 'done' | 'error' | 'idle'; total: number; done: number; failed: number; errors: string[] };

function readSession(): Session | null {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return session?.token ? session : null;
  } catch { return null; }
}

function isAuthed() {
  return readSession() !== null;
}

function resolveRoute(): Route {
  return isAuthed() ? '/admin/upload' : '/admin/login';
}

export default function Admin() {
  const [route, setRoute] = useState<Route>(resolveRoute);

  const navigate = useCallback((to: Route) => {
    if (window.location.pathname !== to) window.history.pushState(null, '', to);
    setRoute(to);
  }, []);

  useEffect(() => {
    // 未登录访问 /admin/upload 或直接访问 /admin 时，地址栏同步到实际页面
    const target = resolveRoute();
    if (window.location.pathname !== target) window.history.replaceState(null, '', target);
    const onPop = () => {
      const next = resolveRoute();
      if (window.location.pathname !== next) window.history.replaceState(null, '', next);
      setRoute(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const login = (session: Session) => { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); navigate('/admin/upload'); };
  const logout = useCallback(() => { sessionStorage.removeItem(SESSION_KEY); navigate('/admin/login'); }, [navigate]);
  const session = readSession();

  return route === '/admin/login' || !session ? <LoginPage onLogin={login}/> : <UploadPage session={session} onLogout={logout}/>;
}

function LoginPage({ onLogin }: { onLogin: (session: Session) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `登录失败 (${response.status})`);
      onLogin({ token: payload.token, username: payload.username });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally { setSubmitting(false); }
  };

  return <div className="admin-login">
    <form className="login-card" onSubmit={submit}>
      <div className="admin-brand"><span className="brand-mark">こ</span><span>KOTOBA <b>ADMIN</b></span></div>
      <h1>管理员登录</h1>
      <label className="admin-field"><span>用户名</span><input className="text-input" autoComplete="username" autoFocus value={username} onChange={e => { setUsername(e.target.value); setError(''); }}/></label>
      <label className="admin-field"><span>密码</span><input className="text-input" type="password" autoComplete="current-password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }}/></label>
      {error && <p className="admin-error">{error}</p>}
      <button className="primary-button login-submit" type="submit" disabled={!username || !password || submitting}>{submitting ? <><Loader2 size={17} className="spin"/>登录中…</> : '登录'}</button>
      <a className="admin-back" href="/"><ArrowLeft size={15}/>返回学习页</a>
    </form>
  </div>;
}

function UploadPage({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<Vocabulary[]>([]);
  const [bookId, setBookId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [books, setBooks] = useState<Book[] | null>(null);
  const [booksError, setBooksError] = useState('');
  const [audioJob, setAudioJob] = useState<AudioJob | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const generating = audioJob?.status === 'running';

  const fileBookId = file ? file.name.replace(/\.[^.]+$/, '') : '';
  const effectiveBookId = bookId.trim() || fileBookId;
  const validId = BOOK_ID_PATTERN.test(effectiveBookId);

  const loadBooks = useCallback(() => {
    setBooks(null); setBooksError('');
    fetch('/api/books').then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `读取失败 (${response.status})`);
      setBooks(payload.books);
    }).catch(err => setBooksError(err instanceof Error ? err.message : '读取单词书失败'));
  }, []);

  useEffect(loadBooks, [loadBooks]);

  // 上传成功后服务端在后台合成语音，这里轮询进度直到结束
  const jobBookId = audioJob?.bookId;
  useEffect(() => {
    if (!jobBookId || !generating) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/books/${encodeURIComponent(jobBookId)}/audio-status`);
        if (!response.ok) return;
        const job = await response.json();
        setAudioJob({ bookId: jobBookId, ...job });
      } catch { /* 网络抖动时下一轮再试 */ }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [jobBookId, generating]);

  const pickFile = async (next: File | null) => {
    setFile(next); setNotice(null); setParsed([]);
    if (!next) return;
    const words = parseVocabularyCsv(await next.text());
    setParsed(words);
    if (!words.length) setNotice({ ok: false, text: 'CSV 中没有找到可导入的单词' });
  };

  const upload = async () => {
    if (!parsed.length || !validId) return;
    setUploading(true); setNotice(null);
    try {
      const response = await fetch(`/api/books/${encodeURIComponent(effectiveBookId)}/words`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ title: effectiveBookId, words: parsed }),
      });
      if (response.status === 401) return onLogout();
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `上传失败 (${response.status})`);
      setNotice({ ok: true, text: `已上传 ${payload.count} 个单词到「${effectiveBookId}」，正在生成语音…` });
      setAudioJob({ bookId: effectiveBookId, status: 'running', total: 0, done: 0, failed: 0, errors: [] });
      setFile(null); setParsed([]); setBookId('');
      if (inputRef.current) inputRef.current.value = '';
      loadBooks();
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : '上传失败' });
    } finally { setUploading(false); }
  };

  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <div className="admin-brand"><span className="brand-mark">こ</span><span>KOTOBA <b>ADMIN</b></span></div>
      <nav>
        <span className="admin-nav active"><FileUp size={18}/>单词书上传</span>
        <a className="admin-nav" href="/"><ArrowLeft size={18}/>返回学习页</a>
      </nav>
    </aside>

    <div className="admin-main">
      <header className="admin-topbar">
        <div className="admin-crumb">管理后台 <span>/</span> <b>单词书上传</b></div>
        <div className="admin-user"><span className="admin-avatar">A</span><span>{session.username}</span><button className="admin-icon-button" onClick={onLogout} aria-label="退出登录" title="退出登录"><LogOut size={17}/></button></div>
      </header>

      <main className="admin-content">
        <section className="admin-card">
          <div className="admin-card-head"><h2>上传 CSV 单词书</h2><p>上传后会整本覆盖 Firebase 中同名的单词书。</p></div>
          <input ref={inputRef} hidden type="file" accept=".csv,text/csv" onChange={event => pickFile(event.target.files?.[0] || null)}/>
          <button className={`dropzone ${file ? 'has-file' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void pickFile(event.dataTransfer.files[0] || null); }}>
            {file
              ? <><Check size={30}/><strong>{file.name}</strong><span>{(file.size / 1024).toFixed(1)} KB · 解析到 {parsed.length} 个单词 · 点击重新选择</span></>
              : <><UploadCloud size={34}/><strong>拖入 CSV，或点击选择</strong><span>支持 UTF-8 与带 BOM 的 CSV</span></>}
          </button>
          <div className="setting-group"><label>Firebase 词库名（Books 下的文档 ID）</label><input className="text-input" value={bookId} placeholder={fileBookId || '默认使用 CSV 文件名'} onChange={event => setBookId(event.target.value)}/></div>
          {effectiveBookId && !validId && <p className="admin-error">词库名只能包含字母、数字、下划线、连字符和中日文字符（最多 60 个）</p>}
          <div className="csv-columns"><code>japanese</code><code>kana</code><code>romaji</code><code>chinese</code></div>
          {notice && <div className={`admin-notice ${notice.ok ? 'ok' : 'fail'}`}>{notice.ok ? <Check size={16}/> : <X size={16}/>}{notice.text}</div>}
          {audioJob && <AudioProgress job={audioJob}/>}
          <div className="admin-actions"><button className="primary-button" disabled={!parsed.length || !validId || uploading || generating} onClick={upload}>{uploading ? <><Loader2 size={17} className="spin"/>正在上传…</> : generating ? <><Loader2 size={17} className="spin"/>正在生成语音…</> : '上传到 Firebase'}</button></div>
        </section>

        <section className="admin-card">
          <div className="admin-card-head row"><div><h2>已有单词书</h2><p>只显示有单词数据的书。</p></div><button className="admin-icon-button" onClick={loadBooks} aria-label="刷新" title="刷新"><RefreshCw size={16}/></button></div>
          <table className="admin-table">
            <thead><tr><th>名称</th><th>单词数</th></tr></thead>
            <tbody>
              {!books && !booksError && <tr><td colSpan={2} className="admin-empty"><Loader2 size={18} className="spin"/> 正在读取…</td></tr>}
              {booksError && <tr><td colSpan={2} className="admin-empty fail">{booksError}</td></tr>}
              {books && !books.length && <tr><td colSpan={2} className="admin-empty">还没有单词书</td></tr>}
              {books?.map(book => <tr key={book.id}><td><Library size={16}/>{book.title}</td><td>{book.count}</td></tr>)}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  </div>;
}

function AudioProgress({ job }: { job: AudioJob }) {
  const handled = job.done + job.failed;
  const percent = job.total ? Math.round((handled / job.total) * 100) : job.status === 'running' ? 0 : 100;
  const label = job.status === 'running'
    ? (job.total ? `正在生成语音 ${handled} / ${job.total}` : '正在检查需要生成的语音…')
    : job.status === 'error' ? '语音生成中断'
    : job.total ? `语音生成完成：成功 ${job.done}${job.failed ? `，失败 ${job.failed}` : ''}` : '语音已是最新，无需重新生成';
  const failed = job.status === 'error' || job.failed > 0;
  return <div className={`audio-progress ${failed ? 'fail' : job.status === 'running' ? '' : 'ok'}`}>
    <div className="audio-progress-head"><span><AudioLines size={16}/>{label}</span><b>「{job.bookId}」</b></div>
    <div className="audio-progress-track"><span style={{ width: `${percent}%` }}/></div>
    {failed && job.errors.length > 0 && <ul className="audio-errors">{job.errors.slice(0, 5).map(line => <li key={line}>{line}</li>)}<li>可稍后运行 npm run audio -- {job.bookId} 补跑失败项</li></ul>}
  </div>;
}
