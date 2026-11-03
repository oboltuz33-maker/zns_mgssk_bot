// Общие элементы интерфейса страниц

// Кнопка «Показать ещё» для списка порциями (usePaged в helpers.js)
export function ShowMore({ paged }) {
  if (!paged.rest) return null;
  return (
    <button className="secondary-button show-more" onClick={paged.more}>
      Показать ещё ({paged.rest})
    </button>
  );
}

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
    text = `Данные от ${new Date(savedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
  }

  return (
    <>
      <div className="sheet-toolbar">
        <span className="sheet-meta">{text}</span>
        <button className="secondary-button" onClick={() => refresh({ fresh: true })} disabled={loading}>
          🔄 Обновить
        </button>
      </div>
      {error && <p className="sheet-error">Не удалось загрузить таблицу: {error}</p>}
    </>
  );
}
