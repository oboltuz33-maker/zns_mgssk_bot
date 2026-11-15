// Общие элементы интерфейса страниц
import { useState } from 'react';
import { TABLE_ROW_HEIGHT, formatDateTime, formatRange, usePaged } from './helpers.js';
import { APPLICATION_STATUS } from './data/model.js';

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
  else if (savedAt) text = `Данные от ${formatDateTime(new Date(savedAt))}`;

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

const STATUS_TONE = {
  [APPLICATION_STATUS.new]: 'accent',
  [APPLICATION_STATUS.inProgress]: 'warning',
  [APPLICATION_STATUS.done]: 'success',
  [APPLICATION_STATUS.rejected]: 'danger',
  [APPLICATION_STATUS.archived]: 'muted',
};

export const StatusBadge = ({ status }) => (status ? <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{status}</Badge> : null);

// Содержимое карточки заявки: соревнование, сроки, участники и оружие, транспорт, причина отклонения.
// showAuthor — показать ФИО перевозчика (администратору); children — кнопки действий внизу карточки
export function ApplicationCard({ application: a, showAuthor = false, children }) {
  return (
    <div className="card item-card">
      <div className="item-head">
        <div className="item-title">
          {a.number && `№ ${a.number} · `}
          {a.competitionTitle}
        </div>
        <StatusBadge status={a.status} />
      </div>
      {showAuthor && a.fullName && <div className="item-row">👤 {a.fullName}</div>}
      {a.ekpStart && <div className="item-row">📅 По ЕКП: {formatRange(a.ekpStart, a.ekpEnd)}</div>}
      {a.address && <div className="item-row">📍 {a.address}</div>}
      {a.weaponLines.length > 0 && (
        <ul className="sub-list">
          {a.weaponLines.map((l) => (
            <li key={l}>🎯 {l}</li>
          ))}
        </ul>
      )}
      <div className="item-row">
        🚚 {formatRange(a.transportStart, a.transportEnd)}
        {a.transportList.length > 0 && ` · ${a.transportList.join(', ')}`}
      </div>
      <div className="item-tags">
        {a.competitionKind && <Badge>{a.competitionKind}</Badge>}
        {a.ekpNumber && <Badge>ЕКП № {a.ekpNumber}</Badge>}
      </div>
      {a.status === APPLICATION_STATUS.rejected && a.rejectReason && (
        <div className="item-row reject-reason">⛔ Причина отклонения: {a.rejectReason}</div>
      )}
      {a.createdAt && <div className="item-hint">Создана {formatDateTime(a.createdAt)}</div>}
      {children}
    </div>
  );
}

// Нижняя панель формы (прилипает к низу экрана): ошибка сервера, чего не хватает, «Отмена» и «Сохранить»
export function FormFooter({ error, problem, attempted, busy, onCancel, onSave, saveLabel = 'Сохранить' }) {
  return (
    <div className="wizard-footer">
      {error && <p className="wizard-message error">{error}</p>}
      {problem && <p className={attempted ? 'wizard-message error' : 'wizard-message'}>{problem}</p>}
      <div className="wizard-buttons">
        <button className="secondary-button" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
        <button className={problem ? 'primary-button incomplete' : 'primary-button'} onClick={onSave} disabled={busy}>
          {busy ? 'Сохраняем…' : saveLabel}
        </button>
      </div>
    </div>
  );
}

// Строка над списком: поиск (children) и переключатель «лента / таблица» (listView — из useListView)
export function ListToolbar({ listView, children }) {
  const table = listView.view === 'table';
  return (
    <div className="list-toolbar">
      <div className="list-toolbar-main">{children}</div>
      <button
        className="view-toggle"
        onClick={listView.toggleView}
        aria-label={table ? 'Показать карточками' : 'Показать таблицей'}
        title={table ? 'Карточки' : 'Таблица'}
      >
        {table ? '☰' : '▦'}
      </button>
    </div>
  );
}

// Таблица списка: заголовки с сортировкой (нажатие — по возрастанию, по убыванию, исходный порядок), строки порциями
// по экрану, нажатие на строку — onOpen(item). items — уже в нужном порядке (listView.apply)
export function DataTable({ listView, items, rowKey, onOpen, resetKey = '' }) {
  const { columns, sort } = listView;
  const paged = usePaged(items, TABLE_ROW_HEIGHT, `${resetKey}|${sort?.key}|${sort?.dir}`);
  return (
    <>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                <button className="th-button" onClick={() => listView.cycleSort(c.key)}>
                  {c.label}
                  {sort?.key === c.key && <span className="sort-mark">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paged.visible.map((item) => (
            <tr key={rowKey(item)} onClick={() => onOpen(item)}>
              {columns.map((c) => (
                <td key={c.key}>{c.render ? c.render(item) : c.value(item) || '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ShowMore paged={paged} />
    </>
  );
}

// Карточка поверх экрана (нажатие на строку таблицы): те же карточка и кнопки, что в ленте
export function CardModal({ onClose, children }) {
  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker card-modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-modal-close">
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Список лентой карточек или таблицей (listView — из useListView). items — отобранные и найденные элементы;
// renderCard(item, close) — карточка с кнопками: в ленте и в окне поверх таблицы (close закрывает окно).
// Окно показывает элемент из source (по умолчанию items): после действия элемент может выпасть из отбора
// (например, сменили статус), а окно должно показать его новое состояние. Элемент пропал (удалён) — окно закрывается
export function CardsOrTable({ listView, items, source = items, rowKey, renderCard, cardHeight, resetKey = '' }) {
  const [openKey, setOpenKey] = useState(null);
  const paged = usePaged(items, cardHeight, resetKey);
  const close = () => setOpenKey(null);
  const opened = openKey === null ? null : source.find((item) => rowKey(item) === openKey);

  if (listView.view !== 'table') {
    return (
      <>
        {paged.visible.map((item) => renderCard(item, close))}
        <ShowMore paged={paged} />
      </>
    );
  }
  return (
    <>
      {items.length > 0 && (
        <DataTable listView={listView} items={listView.apply(items)} rowKey={rowKey} onOpen={(item) => setOpenKey(rowKey(item))} resetKey={resetKey} />
      )}
      {opened && <CardModal onClose={close}>{renderCard(opened, close)}</CardModal>}
    </>
  );
}
