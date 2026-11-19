// Столбцы табличного вида списков (DataTable, useListView). wide — только на широком экране: на телефоне скрыт
import { Badge, StatusBadge } from './components.jsx';
import { formatCompetitionDates, formatRange } from './helpers.js';

// «Иванов Иван Иванович» → «Иванов И.И.» — в узком столбце
const shortName = (fullName) => {
  const [lastName, ...rest] = String(fullName).split(/\s+/).filter(Boolean);
  return [lastName, rest.map((n) => n.charAt(0).toUpperCase() + '.').join('')].filter(Boolean).join(' ');
};

const number = { key: 'number', label: '№', type: 'number', value: (a) => a.number };
const competition = { key: 'competition', label: 'Соревнование', value: (a) => a.competitionTitle };
const ekp = {
  key: 'ekp',
  label: 'Сроки ЕКП',
  type: 'date',
  value: (a) => a.ekpStart,
  render: (a) => (a.ekpStart ? formatRange(a.ekpStart, a.ekpEnd) : '—'),
};
const status = { key: 'status', label: 'Статус', value: (a) => a.status, render: (a) => <StatusBadge status={a.status} /> };

// «Мои заявки»
export const MY_APPLICATION_COLUMNS = [number, competition, { ...ekp, wide: true }, status];

// Все заявки в «Админ»
export const ADMIN_APPLICATION_COLUMNS = [
  number,
  { key: 'author', label: 'Перевозчик', value: (a) => a.fullName, render: (a) => shortName(a.fullName) || '—' },
  { ...competition, wide: true },
  { ...ekp, wide: true },
  status,
];

// Соревнования — в разделе и в «Админ»
export const COMPETITION_COLUMNS = [
  { key: 'start', label: 'Даты', type: 'date', value: (c) => c.start, render: formatCompetitionDates },
  { key: 'title', label: 'Название', value: (c) => c.title },
  { key: 'kind', label: 'Вид', value: (c) => c.kind, wide: true },
  {
    key: 'oneDay',
    label: 'Одним днём',
    value: (c) => (c.oneDay ? 'Да' : 'Нет'),
    render: (c) => (c.oneDay ? <Badge tone="accent">Да</Badge> : 'Нет'),
    wide: true,
  },
  { key: 'address', label: 'Адрес', value: (c) => c.address, wide: true },
];

// Спортсмены в «Админ»
export const ATHLETE_COLUMNS = [
  { key: 'name', label: 'ФИО', value: (a) => a.fullName },
  { key: 'status', label: 'Статус', value: (a) => a.status },
  {
    key: 'carrier',
    label: 'Перевозчик',
    value: (a) => (a.isCarrier ? 'Да' : 'Нет'),
    render: (a) => (a.isCarrier ? <Badge tone="accent">🚚 Да</Badge> : 'Нет'),
    wide: true,
  },
  { key: 'weapons', label: 'Оружие', type: 'number', value: (a) => a.weapons.length, render: (a) => a.weapons.length, wide: true },
];
