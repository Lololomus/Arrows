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
    
    // Разворачиваем на весь экран
    tg.expand();
    
    // Устанавливаем цвета
    tg.setHeaderColor('#FFFFFF');
    tg.setBackgroundColor('#FFFFFF');
    
    // Отключаем вертикальные свайпы (для лучшего UX игры)
    if (tg.disableVerticalSwipes) {
      tg.disableVerticalSwipes();
    }
    
    console.log('[Arrow Puzzle] Telegram Mini App initialized');
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