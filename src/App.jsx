import React, { useEffect, useMemo, useState } from 'react';
import { useSheets } from './data/useSheets.js';
import { buildModel, findMyAthlete } from './data/model.js';
import { requestWriteAccess } from './data/auth.js';
import { ENV_LABEL, storageKey } from './config.js';
import { EmptyState } from './components.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { CompetitionsPage } from './pages/CompetitionsPage.jsx';
import { AthletesPage } from './pages/AthletesPage.jsx';
import { WeaponsPage } from './pages/WeaponsPage.jsx';
import { ApplicationsPage } from './pages/ApplicationsPage.jsx';
import { AuthScreen } from './pages/AuthScreen.jsx';
import { ApplicationWizard } from './pages/ApplicationWizard.jsx';
import { HelpPage } from './pages/HelpPage.jsx';
import './App.css';

// Метка тестового окружения поверх всех экранов — чтобы не перепутать с рабочим
const EnvLabel = () => (ENV_LABEL ? <div className="env-label">{ENV_LABEL}</div> : null);

// Разделы приложения. menu — показывать в нижнем меню (в порядке списка),
// primary — главная кнопка меню: выделена и открывается при запуске.
// focused — страница без нижнего меню (мастер заявки: чтобы случайно не уйти с несохранённым вводом).
// Разделы вне меню доступны по адресу ?page=<id>
const PAGES = [
  { id: 'competitions', icon: '🏆', label: 'Соревнования', component: CompetitionsPage, menu: true },
  { id: 'applications', icon: '📝', label: 'Заявки', component: ApplicationsPage, menu: true, primary: true },
  { id: 'weapons', icon: '🎯', label: 'Оружие', component: WeaponsPage, menu: true },
  // «Помощь» — не в меню, а значком «?» в правом верхнем углу страниц
  { id: 'help', icon: '❓', label: 'Помощь', component: HelpPage },
  { id: 'home', icon: '🏠', label: 'Главная', component: HomePage },
  { id: 'athletes', icon: '👤', label: 'Спортсмены', component: AthletesPage },
  { id: 'application-form', icon: '📝', label: 'Заявка', component: ApplicationWizard, focused: true },
];
const START_PAGE = PAGES.find((p) => p.primary).id;
const MENU = PAGES.filter((p) => p.menu);

// Начальный раздел можно задать в адресе: ?page=weapons
// Сообщение пользователю: в Telegram — его окном, вне Telegram — обычным alert
const showMessage = (text) => {
  const tg = window.Telegram?.WebApp;
  if (tg?.initData) tg.showAlert(text);
  else alert(text);
};

const initialPage = () => {
  const fromUrl = new URLSearchParams(location.search).get('page');
  return PAGES.some((p) => p.id === fromUrl) ? fromUrl : START_PAGE;
};

function App() {
  const [user, setUser] = useState(null);
  const [debugMessage, setDebugMessage] = useState("Ожидание Telegram...");
  const [page, setPage] = useState(initialPage);
  // Параметры страницы, например { competitionId } или { number } для мастера заявки
  const [pageParams, setPageParams] = useState({});
  // Листы таблицы загружаются один раз на всё приложение и доступны всем страницам
  const sheets = useSheets();
  const model = useMemo(() => buildModel(sheets.data), [sheets.data]);
  const me = findMyAthlete(model, user);

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
        setDebugMessage("Подключено, Telegram ID " + tg.initDataUnsafe.user.id);
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

  // Спортсменам, вошедшим до появления уведомлений, один раз на устройстве предлагаем разрешить боту писать
  const hasData = Boolean(sheets.data);
  useEffect(() => {
    if (!hasData) return;
    const KEY = storageKey('zns-write-access-asked');
    try {
      if (localStorage.getItem(KEY)) return;
      localStorage.setItem(KEY, '1');
    } catch {
      return; // без localStorage не спрашиваем, чтобы не надоедать при каждом запуске
    }
    requestWriteAccess();
  }, [hasData]);

  // Кнопка «Назад» Telegram: на любой странице, кроме стартовой, возвращает на стартовую.
  // На страницах focused (мастер заявки) кнопкой управляет сама страница — там «Назад» ведёт на предыдущий шаг
  useEffect(() => {
    const backButton = window.Telegram?.WebApp?.BackButton;
    if (!backButton || !window.Telegram.WebApp.isVersionAtLeast('6.1')) return;
    if (PAGES.find((p) => p.id === page)?.focused) return;

    const goHome = () => setPage(START_PAGE);
    if (page === START_PAGE) backButton.hide();
    else backButton.show();
    backButton.onClick(goHome);
    return () => backButton.offClick(goHome);
  }, [page]);

  const openPage = (next, params = {}) => {
    setPage(next);
    setPageParams(params);
    window.scrollTo(0, 0);
  };

  const current = PAGES.find((p) => p.id === page);
  const Page = current.component;

  // Пока Apps Script не подтвердил спортсмена, разделы не показываем — только вход или загрузку
  if (!sheets.data) {
    let screen;
    if (sheets.accessDenied) {
      screen = (
        // key — при смене причины (например, заявка ушла на подтверждение) экран начинается заново
        <AuthScreen
          key={sheets.accessDenied.reason + sheets.accessDenied.message}
          access={sheets.accessDenied}
          user={user}
          onAccessGranted={() => sheets.refresh({ fresh: true })}
        />
      );
    } else if (sheets.error) {
      screen = (
        <>
          <EmptyState icon="⚠️" title="Не удалось загрузить данные">{sheets.error}</EmptyState>
          <div className="auth-actions">
            <button className="primary-button" onClick={() => sheets.refresh({ fresh: true })} disabled={sheets.loading}>
              🔄 Повторить
            </button>
          </div>
        </>
      );
    } else {
      screen = <EmptyState icon="⏳" title="Загрузка…" />;
    }

    return (
      <main className="page">
        <EnvLabel />
        {screen}
        {sheets.loading && sheets.accessDenied && <p className="sheet-meta auth-center">Проверяем доступ…</p>}
      </main>
    );
  }

  return (
    <div className="app">
      <EnvLabel />
      <main className="page">
        {page !== 'help' && !current.focused && (
          <button className="help-button" onClick={() => openPage('help')} aria-label="Помощь">
            ?
          </button>
        )}
        {page !== 'home' && sheets.loading && !sheets.data && <p className="sheet-meta">Загрузка таблицы…</p>}
        {page !== 'home' && sheets.error && <p className="sheet-error">Не удалось загрузить таблицу: {sheets.error}</p>}

        <Page
          // key — мастер начинается заново при открытии с другими параметрами
          key={page + JSON.stringify(pageParams)}
          model={model}
          sheets={sheets}
          user={user}
          me={me}
          params={pageParams}
          telegramStatus={debugMessage}
          onOpenPage={openPage}
          onRecheckTelegram={checkTelegramEnv}
          onMessage={showMessage}
          onCancel={() => openPage('applications')}
        />


      </main>

      {!current.focused && (
        <nav className="bottom-nav">
          <div className="bottom-nav-inner">
            {MENU.map((item) => (
              <button
                key={item.id}
                className={['nav-item', item.primary && 'primary', item.id === page && 'active'].filter(Boolean).join(' ')}
                onClick={() => openPage(item.id)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </button>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

export default App;
