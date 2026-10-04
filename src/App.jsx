import React, { useEffect, useState } from 'react';

const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxLCEk-qSvy3ZDf6A15TOT7rIQOrtfRfVbRQvh3X907Trjh6PojNBA7HryTZEXu60cxxw/exec';

function App() {
  const [user, setUser] = useState(null);
  const [debugMessage, setDebugMessage] = useState("Ожидание Telegram...");

  const checkTelegramEnv = () => {
    // Проверяем наличие глобального объекта Telegram
    if (window.Telegram?.WebApp?.initDataUnsafe) {
      const tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand();

      // На компьютере expand() не влияет на размер окна — просим полноэкранный режим (Bot API 8.0+).
      // На телефоне не включаем, там достаточно expand().
      const isDesktop = ['tdesktop', 'macos', 'web', 'weba', 'webk'].includes(tg.platform);
      if (isDesktop && tg.isVersionAtLeast('8.0') && !tg.isFullscreen) {
        tg.requestFullscreen();
      }

      if (tg.initDataUnsafe.user) {
        setUser(tg.initDataUnsafe.user);
        setDebugMessage("Подключено! Игрок: " + tg.initDataUnsafe.user.first_name);
      } else {
        setDebugMessage("Окружение TG найдено, но данные пользователя (initData) пусты.");
      }
      return true; // Успешно определили Telegram
    }
    return false; // Пока не нашли Telegram
  };

  useEffect(() => {
    // Проверяем сразу
    if (checkTelegramEnv()) return;
    
    // Если не нашли, проверяем КАЖДУЮ секунду в течение 10 секунд
    let secondsPassed = 0;
    const interval = setInterval(() => {
      secondsPassed++;
      const found = checkTelegramEnv();
      
      if (found) {
        clearInterval(interval);
      } else if (secondsPassed >= 10) { // Даем смартфону целых 10 секунд на прогрузку скрипта Telegram
        clearInterval(interval);
        setDebugMessage("Приложение запущено вне Telegram (или скрипт заблокирован в вашей сети).");
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);


  const sendDataToGoogleSheets = async () => {
    if (!user) {
      alert("Ошибка: нет данных пользователя.");
      return;
    }

    const dataToSend = {
      userId: user.id,
      firstName: user.first_name || 'Без имени',
      username: user.username || 'Нет юзернейма',
      payload: 'Клик по кнопке в Mini App'
    };

    try {
      const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        // Без заголовка Content-Type тело уходит как text/plain — это «простой» запрос без CORS preflight,
        // который Google Apps Script не поддерживает. В doPost разбирать через JSON.parse(e.postData.contents).
        body: JSON.stringify(dataToSend),
      });

      const result = await response.json();
      if (result.status === 'success') {
        window.Telegram?.WebApp?.showAlert('🎉 Данные успешно отправлены в Google Таблицу!');
      } else {
        window.Telegram?.WebApp?.showAlert('❌ Ошибка: ' + result.message);
      }
    } catch (error) {
      console.error(error);
      window.Telegram?.WebApp?.showAlert('🌐 Ошибка сети.');
    }
  };

  return (
    <div style={{ textAlign: 'center', padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>ZNS Mini App</h1>
      
      <p style={{ color: 'var(--hint)', background: 'var(--secondary-bg)', padding: '8px', borderRadius: '5px', fontSize: '14px' }}>
        <b>Статус:</b> {debugMessage}
      </p>

      {user ? (
        <div style={{ border: '1px solid var(--secondary-bg)', padding: '15px', borderRadius: '10px', background: 'var(--secondary-bg)', marginTop: '15px' }}>
          <p>Привет, <b>{user.first_name}</b>!</p>
          <p>Твой Telegram ID: <code>{user.id}</code></p>
          <button 
            onClick={sendDataToGoogleSheets} 
            style={{ padding: '12px 24px', fontSize: '16px', background: 'var(--tg-theme-button-color, #0088cc)', color: 'var(--tg-theme-button-text-color, #fff)', border: 'none', borderRadius: '5px', cursor: 'pointer', marginTop: '10px' }}
          >
            Отправить данные в таблицу
          </button>
        </div>
      ) : (
        <div style={{ marginTop: '20px' }}>
          <button onClick={checkTelegramEnv} style={{ padding: '8px 16px', fontSize: '12px', background: 'var(--secondary-bg)', color: 'var(--text)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            🔄 Перепроверить окружение
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
