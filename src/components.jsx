// Общие элементы интерфейса страниц

// Даты показываются по московскому времени независимо от часового пояса телефона
const DATE_FORMAT = { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Moscow' };
const DATE_TIME_FORMAT = { ...DATE_FORMAT, hour: '2-digit', minute: '2-digit' };

export const formatDate = (date) => (date ? date.toLocaleDateString('ru-RU', DATE_FORMAT) : '—');

export const formatDateTime = (date) => (date ? `${date.toLocaleString('ru-RU', DATE_TIME_FORMAT)} МСК` : '—');

export const formatRange = (start, end) => {
  if (!start) return '—';
  if (!end || formatDate(start) === formatDate(end)) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
};

// Подтверждение в стиле Telegram, вне Telegram — обычный confirm
export const confirmAction = (text) =>
  new Promise((resolve) => {
    const tg = window.Telegram?.WebApp;
    if (tg?.initData && tg.isVersionAtLeast?.('6.2')) tg.showConfirm(text, resolve);
    else resolve(window.confirm(text));
  });

// Поиск без учёта регистра по нескольким полям
export const matches = (query, ...fields) => {
  const q = query.trim().toLowerCase();
  return !q || fields.some((f) => String(f ?? '').toLowerCase().includes(q));
};

export function SearchInput({ value, onChange, placeholder = 'Поиск' }) {
  return (
    <input
      className="sheet-search"
      type="search"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// tone: neutral | success | warning | accent | muted
export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Chips({ options, value, onChange }) {
  return (
    <div className="sheet-tabs">
      {options.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? 'sheet-tab active' : 'sheet-tab'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className="sheet-count"> {o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {children && <div className="empty-text">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </div>
  );
}

// Строка о состоянии загрузки таблицы с кнопкой обновления
export function DataStatus({ sheets }) {
  const { savedAt, loading, error, refresh } = sheets;
  let text = 'Нет данных';
  if (loading) text = 'Загрузка таблицы…';
  else if (savedAt) {
    text = `Данные от ${new Date(savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  }

  return (
    <>
      <div className="sheet-toolbar">
        <span className="sheet-meta">{text}</span>
        <button className="secondary-button" onClick={refresh} disabled={loading}>
          🔄 Обновить
        </button>
      </div>
      {error && <p className="sheet-error">Не удалось загрузить таблицу: {error}</p>}
    </>
  );
}
