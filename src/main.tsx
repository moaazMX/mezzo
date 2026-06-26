import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
if (supabaseUrl) {
  try {
    const origin = new URL(supabaseUrl).origin;
    for (const rel of ['preconnect', 'dns-prefetch'] as const) {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = origin;
      if (rel === 'preconnect') link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }
  } catch {
    /* ignore invalid env URL */
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
