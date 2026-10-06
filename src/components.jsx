// Общие элементы интерфейса страниц
import { useState } from 'react';

// ---------- Списки порциями ----------
// Длинные списки показываются частями: сначала столько элементов, сколько помещается на экран,
// дальше — кнопкой «Показать ещё».

const MIN_PAGE_SIZE = 3;

// Сколько элементов примерно высотой itemHeight (в пикселях) помещается на экран устройства
const pageSizeFor = (itemHeight) => Math.max(MIN_PAGE_SIZE, Math.ceil(window.innerHeight / itemHeight));

// Видимая часть списка. resetKey — например, поисковый запрос или фильтр: когда он меняется,
// список снова показывается с первой порции
export function usePaged(items, itemHeight, resetKey = '') {
  const pageSize = pageSizeFor(itemHeight);
  const [state, setState] = useState({ key: resetKey, count: pageSize });
  const count = state.key === resetKey ? state.count : pageSize;
  return {
    visible: items.slice(0, count),
    rest: Math.max(0, items.length - count),
    more: () => setState({ key: resetKey, count: count + pageSize }),
  };
}

export function ShowMore({ paged }) {
  if (!paged.rest) return null;
  return (
    <button className="secondary-button show-more" onClick={paged.more}>
      Показать ещё ({paged.rest})
    </button>
  );
}

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

// Даты соревнования; если дата начала не указана или записана неверно — так и пишем
export const formatCompetitionDates = (competition) =>
  competition?.start ? formatRange(competition.start, competition.end) : 'Дата не указана';

// Подтверждение в стиле Telegram, вне Telegram — обычный confirm
export const confirmAction = (text) =>
  new Promise((resolve) => {
    const tg = window.Telegram?.WebApp;
    if (tg?.initData && tg.isVersionAtLeast?.('6.2')) tg.showConfirm(text, resolve);
    else resolve(window.confirm(text));
  });

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
