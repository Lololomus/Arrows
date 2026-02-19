// ===== 📄 ФАЙЛ: frontend/src/main.tsx =====

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const initTelegramApp = () => {
  const tg = (window as any).Telegram?.WebApp;

  // ✅ Локальная разработка — просто запускаем без TG
  if (!tg) {
    console.log('[Arrow Puzzle] 🖥️ Local mode — running without Telegram WebApp');
    return;
  }

  tg.ready();

  // ✅ try-catch обязателен: метод EXISTS в объекте, но бросает при версии < 7.7
  if (tg.requestFullscreen) {
    try {
      tg.requestFullscreen();
      console.log('[Arrow Puzzle] ✅ Fullscreen mode enabled (native)');
    } catch (e) {
      console.warn('[Arrow Puzzle] ⚠️ requestFullscreen exists but unsupported:', e);
      tg.expand(); // Fallback
    }
  } else {
    tg.expand();
    console.log('[Arrow Puzzle] ⚠️ Fullscreen not supported, using expand()');
  }

  tg.setHeaderColor('#1e3a52');
  tg.setBackgroundColor('#1e3a52');

  if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
  if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();

  console.log('[Arrow Puzzle] ✅ Telegram Mini App initialized', {
    version: tg.version,
    platform: tg.platform,
    isExpanded: tg.isExpanded,
    fullscreenSupported: !!tg.requestFullscreen,
  });
};

initTelegramApp();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);