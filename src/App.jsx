import React, { useEffect, useMemo, useState } from 'react';
import { GOOGLE_SCRIPT_URL } from './config.js';
import { useSheets } from './data/useSheets.js';
import { buildModel } from './data/model.js';
import { HomePage } from './pages/HomePage.jsx';
import { CompetitionsPage } from './pages/CompetitionsPage.jsx';
import { AthletesPage } from './pages/AthletesPage.jsx';
import { WeaponsPage } from './pages/WeaponsPage.jsx';
import { ApplicationsPage } from './pages/ApplicationsPage.jsx';
import './App.css';

// Разделы нижнего меню
const PAGES = [
  { id: 'home', icon: '🏠', label: 'Главная', component: HomePage },
  { id: 'competitions', icon: '🏆', label: 'Соревнования', component: CompetitionsPage },
  { id: 'athletes', icon: '👤', label: 'Спортсмены', component: AthletesPage },
  { id: 'weapons', icon: '🎯', label: 'Оружие', component: WeaponsPage },
  { id: 'applications', icon: '📝', label: 'Заявки', component: ApplicationsPage },
];

// Начальный раздел можно задать в адресе: ?page=weapons
const initialPage = () => {
  const fromUrl = new URLSearchParams(location.search).get('page');
  return PAGES.some((p) => p.id === fromUrl) ? fromUrl : 'home';
};

function App() {
  const [user, setUser] = useState(null);
  const [debugMessage, setDebugMessage] = useState("Ожидание Telegram...");
  const [page, setPage] = useState(initialPage);
  // Листы таблицы загружаются один раз на всё приложение и доступны всем страницам
  const sheets = useSheets();
  const model = useMemo(() => buildModel(sheets.data), [sheets.data]);

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

  // Кнопка «Назад» Telegram: на любой странице, кроме главной, возвращает на главную
  useEffect(() => {
    const backButton = window.Telegram?.WebApp?.BackButton;
    if (!backButton || !window.Telegram.WebApp.isVersionAtLeast('6.1')) return;

    const goHome = () => setPage('home');
    if (page === 'home') backButton.hide();
    else backButton.show();
    backButton.onClick(goHome);
    return () => backButton.offClick(goHome);
  }, [page]);

  const openPage = (next) => {
    setPage(next);
    window.scrollTo(0, 0);
  };


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

  const Page = PAGES.find((p) => p.id === page).component;

  return (
    <div className="app">
      <main className="page">
        {page !== 'home' && sheets.loading && !sheets.data && <p className="sheet-meta">Загрузка таблицы…</p>}
        {page !== 'home' && sheets.error && <p className="sheet-error">Не удалось загрузить таблицу: {sheets.error}</p>}

        <Page
          model={model}
          sheets={sheets}
          user={user}
          telegramStatus={debugMessage}
          onOpenPage={openPage}
          onRecheckTelegram={checkTelegramEnv}
          onSendTest={sendDataToGoogleSheets}
        />

        <p className="build-info">Версия от {__BUILD_TIME__}</p>
      </main>

      <nav className="bottom-nav">
        <div className="bottom-nav-inner">
          {PAGES.map((item) => (
            <button
              key={item.id}
              className={item.id === page ? 'nav-item active' : 'nav-item'}
              onClick={() => openPage(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

export default App;
