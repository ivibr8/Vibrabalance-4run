import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Clean up any legacy v1 service worker cache that could hold stale Vite dev modules
if (typeof window !== 'undefined' && 'caches' in window) {
  caches.delete('vibrabalance-v1').catch(() => {});
}

createRoot(document.getElementById('root')!).render(<App />);

// Register Service Worker for PWA installability and offline support
if ('serviceWorker' in navigator && import.meta.env.MODE !== 'test') {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.update().catch(() => {});
        console.log('VibraBalance SW registered with scope:', reg.scope);
      })
      .catch((err) => {
        console.warn('VibraBalance SW registration error:', err);
      });
  });
}
