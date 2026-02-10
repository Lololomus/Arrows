/**
 * Arrow Puzzle - Main Entry Point
 * 
 * Инициализация React приложения и Telegram Mini App SDK.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Инициализация Telegram Mini App
const initTelegramApp = () => {
  const tg = (window as any).Telegram?.WebApp;
  
  if (tg) {
    // Сообщаем Telegram что приложение готово
    tg.ready();
    
    // === НАСТОЯЩИЙ FULLSCREEN (новая фича Telegram 7.7+) ===
    // requestFullscreen() - включает полноэкранный режим с нативными кнопками Telegram
    if (tg.requestFullscreen) {
      tg.requestFullscreen();
      console.log('[Arrow Puzzle] ✅ Fullscreen mode enabled (native)');
    } else {
      // Fallback для старых версий Telegram
      tg.expand();
      console.log('[Arrow Puzzle] ⚠️ Fullscreen not supported, using expand()');
    }
    
    // Устанавливаем цвета
    tg.setHeaderColor('#1e3a52'); // Цвет под game-bg
    tg.setBackgroundColor('#1e3a52');
    
    // Отключаем вертикальные свайпы (для лучшего UX игры)
    if (tg.disableVerticalSwipes) {
      tg.disableVerticalSwipes();
    }
    
    // Подтверждение при закрытии (опционально)
    if (tg.enableClosingConfirmation) {
      tg.enableClosingConfirmation();
    }
    
    // Логируем информацию
    console.log('[Arrow Puzzle] Telegram Mini App initialized', {
      version: tg.version,
      platform: tg.platform,
      isExpanded: tg.isExpanded,
      fullscreenSupported: !!tg.requestFullscreen,
    });
  } else {
    console.log('[Arrow Puzzle] Running outside Telegram');
  }
};

// Инициализируем Telegram
initTelegramApp();

// Рендерим React приложение
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);