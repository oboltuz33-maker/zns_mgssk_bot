// Общие функции страниц: списки порциями, форматирование дат, подтверждение действия
import { useState } from 'react';

// ---------- Списки порциями ----------
// Длинные списки показываются частями: сначала столько элементов, сколько помещается на экран,
// дальше — кнопкой «Показать ещё» (ShowMore в components.jsx).

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

// Подтверждение в стиле Telegram, вне Telegram — обычный confirm
export const confirmAction = (text) =>
  new Promise((resolve) => {
    const tg = window.Telegram?.WebApp;
    if (tg?.initData && tg.isVersionAtLeast?.('6.2')) tg.showConfirm(text, resolve);
    else resolve(window.confirm(text));
  });
