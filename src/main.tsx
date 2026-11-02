import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/Toast';
import { ensureSeeded } from './db/ingest';
import { runSrsMaintenance } from './db/maintenance';
import './index.css';

async function boot() {
  try {
    await ensureSeeded();
  } catch (error) {
    console.error('[CET-Lab] 種子資料載入失敗', error);
  }

  try {
    await runSrsMaintenance();
  } catch (error) {
    console.error('[CET-Lab] SRS 維護失敗', error);
  }

  const container = document.getElementById('root');
  if (!container) throw new Error('找不到 #root');

  createRoot(container).render(
    <StrictMode>
      <HashRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </HashRouter>
    </StrictMode>,
  );
}

void boot();
