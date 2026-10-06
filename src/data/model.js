import { SHEET } from '../config.js';

// Превращает строки листов (объекты «заголовок → значение») в удобные для страниц сущности.
// Названия столбцов таблицы используются только здесь.

const str = (value) => String(value ?? '').trim();

// Все даты в таблице — московские. Ячейка с типом «дата» приходит от Apps Script ISO-строкой
// (точный момент времени); текст «дд.мм.гггг[ чч:мм[:сс]]» считаем московским временем (UTC+3).
const RU_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const MOSCOW_UTC_OFFSET_HOURS = 3;

const toDate = (value) => {
  if (!value) return null;
  const m = str(value).match(RU_DATE);
  const date = m
    ? new Date(Date.UTC(+m[3], m[2] - 1, +m[1], (+m[4] || 0) - MOSCOW_UTC_OFFSET_HOURS, +m[5] || 0, +m[6] || 0))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Календарный день по Москве в виде «гггг-мм-дд» — такие строки можно сравнивать между собой
// и подставлять в <input type="date">
export const moscowDay = (date) => date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });

// Значения столбца «Статус» заявки (как в Apps Script). Автор может менять и удалять только «Новую»
export const APPLICATION_STATUS = {
  new: 'Новая',
  inProgress: 'В работе',
  done: 'Выполнена',
  archived: 'Архив',
  deleted: 'Удалена',
};

// Виды транспорта в ячейке заявки — через «;» и перенос строки
const splitList = (value) => str(value).split(/;\s*/).map((s) => s.trim()).filter(Boolean);

// Строки ячейки «Оружие»: по строке на спортсмена
const textLines = (value) => str(value).split('\n').map((s) => s.trim()).filter(Boolean);

// «Название - Номер» → { title, number } (номер — после последнего « - »: в названии дефис бывает)
const splitTitleNumber = (text) => {
  const i = text.lastIndexOf(' - ');
  return i === -1 ? { title: text.trim(), number: '' } : { title: text.slice(0, i).trim(), number: text.slice(i + 3).trim() };
};

// Ячейка «Оружие» → [{ name: 'Фамилия И.О.', weapons: [{ title, number }] }].
// Формат: по строке на спортсмена «Фамилия И.О. : Название - Номер ; Название - Номер»
export const parseWeaponText = (value) =>
  textLines(value)
    .filter((line) => line.includes(' : '))
    .map((line) => {
      const colon = line.indexOf(' : ');
      return {
        name: line.slice(0, colon).trim(),
        weapons: line.slice(colon + 3).split(';').map((s) => s.trim()).filter(Boolean).map(splitTitleNumber),
      };
    });

// «Иванов», «Иван», «Петрович» → «Иванов И.П.» (так спортсмен записывается в заявке)
export const shortName = (lastName, firstName, middleName) => {
  const initials = [firstName, middleName].filter(Boolean).map((n) => n.charAt(0).toUpperCase() + '.').join('');
  return [lastName, initials].filter(Boolean).join(' ');
};

const rowsOf = (data, sheetName) => data?.sheets?.[sheetName]?.rows ?? [];

// Предстоящее соревнование — дата начала сегодня или позже (по Москве). То же правило, что в Apps Script:
// только на такие можно подать заявку. Без даты (или с неверной датой) — тоже предстоящее, чтобы не потерялось.
// Здесь — на случай данных, сохранённых на устройстве раньше
export const isUpcomingCompetition = (competition, now = new Date()) =>
  !competition.start || moscowDay(competition.start) >= moscowDay(now);

// Текущий спортсмен. Его определяет Apps Script по подписанным данным Telegram (athleteId);
// если athleteId в данных нет (старая версия скрипта) — по ChatId пользователя
export const findMyAthlete = (model, user) =>
  model.athletes.find((a) => a.id === model.athleteId) ||
  (user && model.athletes.find((a) => a.chatId === String(user.id))) ||
  null;

export function buildModel(data) {
  // Строки без идентификатора уже отброшены при загрузке (sheets.js) — здесь только их число по листам
  const skipped = Object.fromEntries(
    Object.entries(data?.sheets ?? {})
      .filter(([, sheet]) => sheet.skipped > 0)
      .map(([name, sheet]) => [name, sheet.skipped]),
  );

  const weapons = rowsOf(data, SHEET.weapons).map((r) => ({
    id: str(r['Ид']),
    title: str(r['Название']),
    number: str(r['Номер']),
    owners: [],
  }));

  const athletes = rowsOf(data, SHEET.athletes).map((r) => {
    const lastName = str(r['Фамилия']);
    const firstName = str(r['Имя']);
    const middleName = str(r['Отчество']);
    return {
      id: str(r['ID']),
      lastName,
      firstName,
      middleName,
      fullName: [lastName, firstName, middleName].filter(Boolean).join(' '),
      shortName: shortName(lastName, firstName, middleName),
      // Обращение к спортсмену: «Имя Отчество», без отчества — «Имя Фамилия»
      greetingName: (middleName ? [firstName, middleName] : [firstName, lastName]).filter(Boolean).join(' '),
      phone: str(r['Телефон']),
      chatId: str(r['ChatId']),
      status: str(r['Статус']),
      isCarrier: str(r['Перевозчик']).toLowerCase() === 'да',
      weapons: [],
    };
  });

  // Связи многие-ко-многим из листа «Спортсмен/Оружие»; ссылки на несуществующие строки пропускаем
  const weaponById = new Map(weapons.map((w) => [w.id, w]));
  const athleteById = new Map(athletes.map((a) => [a.id, a]));
  for (const r of rowsOf(data, SHEET.athleteWeapons)) {
    const athlete = athleteById.get(str(r['Спортсмен ид']));
    const weapon = weaponById.get(str(r['Оружие ид']));
    if (athlete && weapon) {
      athlete.weapons.push(weapon);
      weapon.owners.push(athlete);
    }
  }

  const competitions = rowsOf(data, SHEET.competitions)
    .map((r) => ({
      id: str(r['ID']),
      title: str(r['Название']),
      ekpNumber: str(r['Номер из ЕКП']),
      kind: str(r['Вид соревнования']),
      start: toDate(r['Дата начала']),
      end: toDate(r['Дата завершения']),
      address: str(r['Адрес']),
    }))
    .sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity));

  const applications = rowsOf(data, SHEET.applications)
    .map((r) => ({
      number: str(r['№']),
      fullName: str(r['ФИО']),
      weapon: str(r['Оружие']),
      transportStart: toDate(r['Сроки перевозки начало']),
      transportEnd: toDate(r['Сроки перевозки окончание']),
      transport: str(r['Вид транспорта']),
      competitionKind: str(r['Вид соревнования']),
      competitionTitle: str(r['Название соревнования']),
      ekpNumber: str(r['Номер в ЕКП']),
      ekpStart: toDate(r['Сроки по ЕКП начало']),
      ekpEnd: toDate(r['Сроки по ЕКП окончание']),
      address: str(r['Адрес']),
      status: str(r['Статус']),
      canEdit: str(r['Статус']) === APPLICATION_STATUS.new,
      // Оружие: строки для показа и разобранные записи «спортсмен → его оружие»; виды транспорта — списком
      weaponLines: textLines(r['Оружие']),
      weaponEntries: parseWeaponText(r['Оружие']),
      transportList: splitList(r['Вид транспорта']),
      // CreatedBy — ID спортсмена, создавшего заявку; CreatedAt — момент создания (московское время)
      createdById: str(r['CreatedBy']),
      author: athleteById.get(str(r['CreatedBy'])) ?? null,
      createdAt: toDate(r['CreatedAt']),
    }))
    // Новые заявки сверху
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

  // Справочник видов транспорта: первый столбец листа — название
  const transportSheet = data?.sheets?.[SHEET.transportTypes];
  const transportTypes = transportSheet ? transportSheet.rows.map((r) => str(r[transportSheet.headers[0]])) : [];

  return {
    competitions,
    athletes,
    weapons,
    applications,
    transportTypes,
    skipped,
    athleteId: data?.athleteId ?? null,
  };
}
