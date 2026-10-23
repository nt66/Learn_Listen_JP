import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// /admin/* 是管理后台（单词书上传），单独分包，学习页不加载它
const Admin = lazy(() => import('./admin/Admin'));
const isAdmin = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isAdmin ? <Suspense fallback={null}><Admin /></Suspense> : <App />}</StrictMode>,
);

// 只在生产构建里注册；iOS 要求 HTTPS 才会启用 Service Worker，http 下自动跳过
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
