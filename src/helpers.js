// Общие функции страниц: списки порциями, форматирование дат, подтверждение действия
import { useEffect, useRef, useState } from 'react';
import { storageKey } from './config.js';

// ---------- Списки порциями ----------
// Длинные списки показываются частями: сначала столько элементов, сколько помещается на экран,
// дальше — кнопкой «Показать ещё» (ShowMore в components.jsx).

const MIN_PAGE_SIZE = 3;

// Примерная высота элементов списков, пикселей, — по ней считается, сколько помещается на экран
export const ROW_HEIGHT = 64; // строка списка (спортсмен, оружие)
export const COMPETITION_CARD_HEIGHT = 170;
export const APPLICATION_CARD_HEIGHT = 280;
export const TABLE_ROW_HEIGHT = 44; // строка таблицы

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

// Даты показываются по московскому времени независимо от часового пояса телефона
const DATE_FORMAT = { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Moscow' };
const DATE_TIME_FORMAT = { ...DATE_FORMAT, hour: '2-digit', minute: '2-digit' };

const formatDate = (date) => (date ? date.toLocaleDateString('ru-RU', DATE_FORMAT) : '—');

export const formatDateTime = (date) => (date ? `${date.toLocaleString('ru-RU', DATE_TIME_FORMAT)} МСК` : '—');

export const formatRange = (start, end) => {
  if (!start) return '—';
  if (!end || formatDate(start) === formatDate(end)) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
};

// Даты соревнования; если дата начала не указана или записана неверно — так и пишем
export const formatCompetitionDates = (competition) =>
  competition?.start ? formatRange(competition.start, competition.end) : 'Дата не указана';

// Текст соревнования для поиска: название, вид, адрес, № ЕКП
export const competitionSearchText = (c) => [c.title, c.kind, c.address, c.ekpNumber].join(' ');

// Подтверждение в стиле Telegram, вне Telegram — обычный confirm
export const confirmAction = (text) =>
  new Promise((resolve) => {
    const tg = window.Telegram?.WebApp;
    if (tg?.initData && tg.isVersionAtLeast?.('6.2')) tg.showConfirm(text, resolve);
    else resolve(window.confirm(text));
  });

// Кнопка «Назад» Telegram на странице без нижнего меню (формы администратора): onBack — куда вернуться.
// Подписка одна на всё время жизни страницы, onBack берётся актуальный
export function useTelegramBackButton(onBack) {
  const handler = useRef(onBack);
  useEffect(() => {
    handler.current = onBack;
  });
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.BackButton || !tg.isVersionAtLeast?.('6.1')) return;
    const goBack = () => handler.current();
    tg.BackButton.show();
    tg.BackButton.onClick(goBack);
    return () => tg.BackButton.offClick(goBack);
  }, []);
}

// ---------- Табличный вид списков ----------
// Столбец таблицы: { key, label, type: 'text' | 'number' | 'date', value(item), render?(item), wide?: true —
// только на широком экране }. Вид (лента или таблица) и сортировка запоминаются на устройстве для каждого списка.

// Узкий экран (телефон в вертикальном положении): столбцы с wide скрываются
const NARROW_QUERY = '(max-width: 520px)';
const narrowMedia = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW_QUERY) : null);

export const visibleColumns = (columns, narrow) => columns.filter((c) => !(narrow && c.wide));

// Сортировка { key, dir: 'asc' | 'desc' } действует, только пока её столбец виден; иначе — null (сброс)
export const validSort = (sort, columns, narrow) =>
  sort && ['asc', 'desc'].includes(sort.dir) && visibleColumns(columns, narrow).some((c) => c.key === sort.key) ? sort : null;

// Сортировка по столбцу: даты — как даты, числа — как числа, текст — по алфавиту (с числами внутри: «2» < «10»).
// Пустые значения — всегда в конце; при равенстве — прежний порядок
export function sortItems(items, column, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  const sortKey = (item) => {
    const value = column.value(item);
    if (value === null || value === undefined || value === '') return null;
    if (column.type === 'date') return value instanceof Date ? value.getTime() : null;
    if (column.type === 'number') {
      const n = Number(value);
      return Number.isNaN(n) ? null : n;
    }
    return String(value);
  };
  return items
    .map((item, index) => ({ item, index, key: sortKey(item) }))
    .sort((a, b) => {
      if (a.key === null || b.key === null) return (a.key === null) - (b.key === null) || a.index - b.index;
      const order =
        typeof a.key === 'number' ? a.key - b.key : a.key.localeCompare(b.key, 'ru', { numeric: true, sensitivity: 'base' });
      return order * sign || a.index - b.index;
    })
    .map((x) => x.item);
}

const readSaved = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? {};
  } catch {
    return {};
  }
};

// Вид списка listId: { view: 'cards' | 'table', sort, columns — видимые сейчас столбцы, toggleView(), cycleSort(key),
// apply(items) — элементы в порядке сортировки (только в таблице) }.
// Нажатие на заголовок: по возрастанию → по убыванию → исходный порядок.
// Экран стал уже и столбец сортировки скрылся — сортировка сбрасывается (и в сохранённом)
export function useListView(listId, columns) {
  const key = storageKey(`zns-list-view:${listId}`);
  const columnsRef = useRef(columns);
  useEffect(() => {
    columnsRef.current = columns;
  });
  const [state, setState] = useState(() => {
    const narrow = Boolean(narrowMedia()?.matches);
    const saved = readSaved(key);
    return { narrow, view: saved.view === 'table' ? 'table' : 'cards', sort: validSort(saved.sort, columns, narrow) };
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify({ view: state.view, sort: state.sort }));
    } catch {
      // localStorage недоступен — выбор просто не запомнится
    }
  }, [key, state.view, state.sort]);

  useEffect(() => {
    const media = narrowMedia();
    if (!media) return;
    const onChange = () =>
      setState((s) => ({ ...s, narrow: media.matches, sort: validSort(s.sort, columnsRef.current, media.matches) }));
    // Старые WebView (Safari до 14) знают только addListener
    if (media.addEventListener) media.addEventListener('change', onChange);
    else media.addListener(onChange);
    return () => (media.removeEventListener ? media.removeEventListener('change', onChange) : media.removeListener(onChange));
  }, []);

  const shown = visibleColumns(columns, state.narrow);
  const sortColumn = state.sort && shown.find((c) => c.key === state.sort.key);
  return {
    view: state.view,
    sort: sortColumn ? state.sort : null,
    columns: shown,
    toggleView: () => setState((s) => ({ ...s, view: s.view === 'table' ? 'cards' : 'table' })),
    cycleSort: (column) =>
      setState((s) => {
        if (s.sort?.key !== column) return { ...s, sort: { key: column, dir: 'asc' } };
        return { ...s, sort: s.sort.dir === 'asc' ? { key: column, dir: 'desc' } : null };
      }),
    apply: (items) => (state.view === 'table' && sortColumn ? sortItems(items, sortColumn, state.sort.dir) : items),
  };
}
