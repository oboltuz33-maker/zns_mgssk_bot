import React, { useEffect, useState } from 'react';

// 🔴 ЗАМЕНИТЕ ЭТУ ССЫЛКУ НА ВАШУ ИЗ ЭТАПА 1 (ИЗ БЛОКНОТА)
const GOOGLE_SCRIPT_URL = 'https://google.com';

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand(); // Разворачиваем приложение на весь экран телефона
      
      if (tg.initDataUnsafe?.user) {
        setUser(tg.initDataUnsafe.user);
      }
    }
  }, []);

  const sendDataToGoogleSheets = async () => {
    if (!user) {
      alert("Откройте приложение внутри Telegram!");
      return;
    }

    const dataToSend = {
      userId: user.id,
      firstName: user.first_name || 'Без имени',
      username: user.username || 'Нет юзернейма',
      payload: 'Пользователь кликнул по кнопке в Mini App'
    };

    try {
      const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'cors', // Используем CORS-режим
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataToSend),
      });

      const result = await response.json();

      if (result.status === 'success') {
        window.Telegram?.WebApp?.showAlert('🎉 Данные успешно отправлены в Google Таблицу!');
      } else {
        window.Telegram?.WebApp?.showAlert('❌ Ошибка скрипта: ' + result.message);
      }
    } catch (error) {
      console.error(error);
      window.Telegram?.WebApp?.showAlert('🌐 Ошибка сети при отправке данных.');
    }
  };

  return (
    <div style={{ textAlign: 'center', padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>ZNS Mini App</h1>
      {user ? (
        <div style={{ border: '1px solid #ccc', padding: '15px', borderRadius: '10px', background: '#f9f9f9' }}>
          <p>Привет, <b>{user.first_name}</b>!</p>
          <p>Твой Telegram ID: <code>{user.id}</code></p>
          <button 
            onClick={sendDataToGoogleSheets} 
            style={{ padding: '12px 24px', fontSize: '16px', background: '#0088cc', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', marginTop: '10px' }}
          >
            Отправить данные в таблицу
          </button>
        </div>
      ) : (
        <p style={{ color: 'red' }}>Пожалуйста, запустите приложение внутри Telegram.</p>
      )}
    </div>
  );
}

export default App;
