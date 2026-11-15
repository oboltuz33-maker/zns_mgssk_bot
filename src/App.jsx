import { useEffect, useMemo, useState } from 'react';
import { useSheets } from './data/useSheets.js';
import { buildModel, findMyAthlete } from './data/model.js';
import { requestWriteAccess } from './data/auth.js';
import { ENV_LABEL, storageKey } from './config.js';
import { EmptyState } from './components.jsx';
import { CompetitionsPage } from './pages/CompetitionsPage.jsx';
import { WeaponsPage } from './pages/WeaponsPage.jsx';
import { ApplicationsPage } from './pages/ApplicationsPage.jsx';
import { AuthScreen } from './pages/AuthScreen.jsx';
import { ApplicationWizard } from './pages/ApplicationWizard.jsx';
import { HelpPage } from './pages/HelpPage.jsx';
import { ProfilePage } from './pages/ProfilePage.jsx';
import { AdminPage } from './pages/AdminPage.jsx';
import { AdminApplicationForm } from './pages/AdminApplicationForm.jsx';
import { AdminAthleteForm, AdminAthleteWeapons } from './pages/AdminAthletes.jsx';
import { AdminCompetitionForm } from './pages/AdminCompetitions.jsx';
import './App.css';

// Метка тестового окружения поверх всех экранов — чтобы не перепутать с рабочим
const EnvLabel = () => (ENV_LABEL ? <div className="env-label">{ENV_LABEL}</div> : null);

// Разделы приложения. menu — показывать в нижнем меню (в порядке списка),
// primary — главная кнопка меню: выделена и открывается при запуске.
// focused — страница без нижнего меню (мастер заявки: чтобы случайно не уйти с несохранённым вводом).
// back — куда ведёт кнопка «Назад» Telegram (по умолчанию — на стартовую).
// admin — только администраторам: в меню виден только им, остальным вместо него открывается стартовая страница.
// Разделы вне меню доступны по адресу ?page=<id>
const PAGES = [
  { id: 'competitions', icon: '🏆', label: 'Соревнования', component: CompetitionsPage, menu: true },
  { id: 'applications', icon: '📝', label: 'Заявки', component: ApplicationsPage, menu: true, primary: true },
  { id: 'weapons', icon: '🎯', label: 'Оружие', component: WeaponsPage, menu: true },
  { id: 'admin', icon: '🛠', label: 'Админ', component: AdminPage, menu: true, admin: true },
  // «Профиль» — не в меню, а значком 👤 в правом верхнем углу страниц; «Помощь» открывается из профиля
  { id: 'profile', icon: '👤', label: 'Профиль', component: ProfilePage },
  { id: 'help', icon: '❓', label: 'Помощь', component: HelpPage, back: 'profile' },
  { id: 'application-form', icon: '📝', label: 'Заявка', component: ApplicationWizard, focused: true },
  // Формы администратора: кнопкой «Назад» Telegram управляют сами страницы
  { id: 'admin-application', icon: '📝', label: 'Заявка', component: AdminApplicationForm, focused: true, admin: true },
  { id: 'admin-athlete', icon: '👤', label: 'Спортсмен', component: AdminAthleteForm, focused: true, admin: true },
  { id: 'admin-athlete-weapons', icon: '🎯', label: 'Оружие', component: AdminAthleteWeapons, focused: true, admin: true },
  { id: 'admin-competition', icon: '🏆', label: 'Соревнование', component: AdminCompetitionForm, focused: true, admin: true },
];
const START_PAGE = PAGES.find((p) => p.primary).id;
const MENU = PAGES.filter((p) => p.menu);

// Сообщение пользователю: в Telegram — его окном (Bot API 6.2+), иначе — обычным alert
const showMessage = (text) => {
  const tg = window.Telegram?.WebApp;
  if (tg?.initData && tg.isVersionAtLeast?.('6.2')) tg.showAlert(text);
  else alert(text);
};

// Начальный раздел можно задать в адресе: ?page=weapons
const initialPage = () => {
  const fromUrl = new URLSearchParams(location.search).get('page');
  return PAGES.some((p) => p.id === fromUrl) ? fromUrl : START_PAGE;
};

// ?page=application-form&competition=<ID> — мастер заявки сразу на этом соревновании
// (кнопка «Подать заявку» в рассылке бота о новом соревновании)
const initialParams = () => {
  const competitionId = new URLSearchParams(location.search).get('competition');
  return competitionId && initialPage() === 'application-form' ? { competitionId } : {};
};

// Когда открыто приложение: данные, загруженные раньше (сохранённые на устройстве), могут не знать о новом соревновании
const APP_STARTED_AT = Date.now();

// Пользователь Telegram (SDK входит в сборку, поэтому данные есть сразу). Вне Telegram — null
const telegramUser = () => window.Telegram?.WebApp?.initDataUnsafe?.user ?? null;

function App() {
  const [user] = useState(telegramUser);
  const [page, setPage] = useState(initialPage);
  // Параметры страницы, например { competitionId } или { number } для мастера заявки
  const [pageParams, setPageParams] = useState(initialParams);
  // Листы таблицы загружаются один раз на всё приложение и доступны всем страницам
  const sheets = useSheets();
  const model = useMemo(() => buildModel(sheets.data), [sheets.data]);
  const me = findMyAthlete(model);
  // Мастер заявки — только для перевозчиков. По ссылке из бота его может открыть и не перевозчик (например, того,
  // кого перестали считать перевозчиком), — тогда открываются «Заявки», где объяснено, кто подаёт заявки
  let pageId = page === 'application-form' && sheets.data && !me?.isCarrier ? 'applications' : page;
  // Разделы администратора не администратору (например, признак сняли) — стартовая страница
  if (sheets.data && !me?.isAdmin && PAGES.find((p) => p.id === pageId)?.admin) pageId = START_PAGE;
  const menu = MENU.filter((p) => !p.admin || me?.isAdmin);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.initData) return;
    tg.ready();
    tg.expand();
    // На компьютере expand() не влияет на размер окна — просим полноэкранный режим (Bot API 8.0+).
    // На телефоне не включаем, там достаточно expand().
    const isDesktop = ['tdesktop', 'macos', 'web', 'weba', 'webk'].includes(tg.platform);
    if (isDesktop && tg.isVersionAtLeast('8.0') && !tg.isFullscreen) tg.requestFullscreen();
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

  // Кнопка «Назад» Telegram: на любой странице, кроме стартовой, возвращает на страницу из back или на стартовую.
  // На страницах focused (мастер заявки) кнопкой управляет сама страница — там «Назад» ведёт на предыдущий шаг
  useEffect(() => {
    const backButton = window.Telegram?.WebApp?.BackButton;
    if (!backButton || !window.Telegram.WebApp.isVersionAtLeast('6.1')) return;
    const target = PAGES.find((p) => p.id === pageId);
    if (target?.focused) return;

    const goBack = () => setPage(target?.back ?? START_PAGE);
    if (pageId === START_PAGE) backButton.hide();
    else backButton.show();
    backButton.onClick(goBack);
    return () => backButton.offClick(goBack);
  }, [pageId]);

  // Мастер открыт по ссылке на соревнование, которого нет в данных. Пока не пришли данные, загруженные после
  // открытия приложения, ждём их (соревнование могли добавить только что). Нет и в свежих — уже началось или
  // удалено: открываем мастер с выбором соревнования
  const linkedCompetitionMissing = pageId === 'application-form' && Boolean(pageParams.competitionId) && !pageParams.number &&
    !model.competitions.some((c) => c.id === pageParams.competitionId);
  const waitingForLinkedCompetition = linkedCompetitionMissing && !sheets.error && !(sheets.savedAt >= APP_STARTED_AT);
  useEffect(() => {
    if (!linkedCompetitionMissing || waitingForLinkedCompetition) return;
    setPageParams({});
    showMessage('Соревнование из сообщения не найдено — возможно, оно уже началось. Выберите соревнование из списка.');
  }, [linkedCompetitionMissing, waitingForLinkedCompetition]);

  const openPage = (next, params = {}) => {
    setPage(next);
    setPageParams(params);
    window.scrollTo(0, 0);
  };

  const current = PAGES.find((p) => p.id === pageId);
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
        {pageId !== 'profile' && !current.focused && (
          <button className="help-button" onClick={() => openPage('profile')} aria-label="Профиль">
            👤
          </button>
        )}
        {sheets.error && <p className="sheet-error">Не удалось загрузить таблицу: {sheets.error}</p>}

        {waitingForLinkedCompetition ? (
          <EmptyState icon="⏳" title="Загружаем соревнование…" />
        ) : (
          <Page
            // key — мастер начинается заново при открытии с другими параметрами
            key={pageId + JSON.stringify(pageParams)}
            model={model}
            sheets={sheets}
            user={user}
            me={me}
            params={pageParams}
            onOpenPage={openPage}
            onMessage={showMessage}
            onCancel={() => openPage('applications')}
          />
        )}
      </main>

      {!current.focused && (
        <nav className="bottom-nav">
          <div className="bottom-nav-inner">
            {menu.map((item) => (
              <button
                key={item.id}
                className={['nav-item', item.primary && 'primary', item.id === pageId && 'active'].filter(Boolean).join(' ')}
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
