import { SHEET } from '../config.js';

// Превращает строки листов (объекты «заголовок → значение») в удобные для страниц сущности.
// Названия столбцов таблицы используются только здесь.

const str = (value) => String(value ?? '').trim();

// Все даты в таблице — московские. Ячейка с типом «дата» приходит от Apps Script ISO-строкой
// (точный момент времени); текст «дд.мм.гггг[ чч:мм[:сс]]» считаем московским временем (UTC+3).
// Другой текст датой не считается — как и в Apps Script (sheetDate_): иначе приложение показало бы
// сроки перевозки, которые скрипт не запишет
const RU_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;
const MOSCOW_UTC_OFFSET_HOURS = 3;

const toDate = (value) => {
  if (!value) return null;
  const text = str(value);
  const m = text.match(RU_DATE);
  let date = null;
  if (m) {
    date = new Date(Date.UTC(+m[3], m[2] - 1, +m[1], (+m[4] || 0) - MOSCOW_UTC_OFFSET_HOURS, +m[5] || 0, +m[6] || 0));
    // 31.02 и т.п. — не дата (Date переносит их на следующий месяц)
    if (Number(moscowDay(date).slice(5, 7)) !== Number(m[2])) date = null;
  } else if (ISO_DATE.test(text)) {
    date = new Date(text);
  }
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

// Календарный день по Москве в виде «гггг-мм-дд» — такие строки можно сравнивать между собой
// и подставлять в <input type="date">
export const moscowDay = (date) => date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });

// Значения столбца «Статус» заявки (как в Apps Script). Автор может менять и удалять только «Новую».
// «Удалена» в приложение не попадает: такие заявки лежат в «Архиве заявок», а его приложение не загружает
export const APPLICATION_STATUS = {
  new: 'Новая',
  inProgress: 'В работе',
  done: 'Выполнена',
  // Заявку нельзя выполнить — причина в столбце «Причина отклонения»
  rejected: 'Отклонена',
  archived: 'Архив',
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
const parseWeaponText = (value) =>
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
const shortName = (lastName, firstName, middleName) => {
  const initials = [firstName, middleName].filter(Boolean).map((n) => n.charAt(0).toUpperCase() + '.').join('');
  return [lastName, initials].filter(Boolean).join(' ');
};

const rowsOf = (data, sheetName) => data?.sheets?.[sheetName]?.rows ?? [];

// ID строки — в первом столбце листа, как его понимает Apps Script, как бы ни был подписан заголовок
export const idColumn = (data, sheetName) => data?.sheets?.[sheetName]?.headers?.[0] ?? '';

// Столбцы листа «Спортсмены» с настройками уведомлений перевозчика (ключ — как в запросе setNotifications)
const NOTIFY_COLUMN = {
  competitions: 'Сообщать о соревнованиях',
  applications: 'Сообщать о заявках',
};

// Предстоящее соревнование — дата начала сегодня или позже (по Москве). То же правило, что в Apps Script:
// только на такие можно подать заявку. Без даты (или с неверной датой) — тоже предстоящее, чтобы не потерялось.
// Здесь — на случай данных, сохранённых на устройстве раньше
export const isUpcomingCompetition = (competition, now = new Date()) =>
  !competition.start || moscowDay(competition.start) >= moscowDay(now);

// Текущий спортсмен. Его определяет Apps Script по подписанным данным Telegram (athleteId)
export const findMyAthlete = (model) => model.athletes.find((a) => a.id === model.athleteId) ?? null;

export function buildModel(data) {
  // Строки без идентификатора уже отброшены при загрузке (sheets.js) — здесь только их число по листам
  const skipped = Object.fromEntries(
    Object.entries(data?.sheets ?? {})
      .filter(([, sheet]) => sheet.skipped > 0)
      .map(([name, sheet]) => [name, sheet.skipped]),
  );

  const weapons = rowsOf(data, SHEET.weapons).map((r) => ({
    id: str(r[idColumn(data, SHEET.weapons)]),
    title: str(r['Название']),
    number: str(r['Номер']),
    owners: [],
  }));

  const athletes = rowsOf(data, SHEET.athletes).map((r) => {
    const lastName = str(r['Фамилия']);
    const firstName = str(r['Имя']);
    const middleName = str(r['Отчество']);
    return {
      id: str(r[idColumn(data, SHEET.athletes)]),
      lastName,
      firstName,
      middleName,
      fullName: [lastName, firstName, middleName].filter(Boolean).join(' '),
      shortName: shortName(lastName, firstName, middleName),
      // Обращение к спортсмену: «Имя Отчество», без отчества — «Имя Фамилия»
      greetingName: (middleName ? [firstName, middleName] : [firstName, lastName]).filter(Boolean).join(' '),
      // Телефон виден только свой — у других спортсменов Apps Script его не отдаёт
      phone: str(r['Телефон']),
      status: str(r['Статус']),
      isCarrier: str(r['Перевозчик']).toLowerCase() === 'да',
      // Администратор: раздел «Администрирование». Признак виден только в своей строке (и администратору — у всех)
      isAdmin: str(r['Администратор']).toLowerCase() === 'да',
      // Настройки уведомлений (видны только свои): «Нет» — выключено, пусто или «Да» — включено
      notifyCompetitions: str(r[NOTIFY_COLUMN.competitions]).toLowerCase() !== 'нет',
      notifyApplications: str(r[NOTIFY_COLUMN.applications]).toLowerCase() !== 'нет',
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
      id: str(r[idColumn(data, SHEET.competitions)]),
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
      // ФИО перевозчика — автора заявки
      fullName: str(r['ФИО']),
      transportStart: toDate(r['Сроки перевозки начало']),
      transportEnd: toDate(r['Сроки перевозки окончание']),
      competitionKind: str(r['Вид соревнования']),
      competitionTitle: str(r['Название соревнования']),
      ekpNumber: str(r['Номер в ЕКП']),
      ekpStart: toDate(r['Сроки по ЕКП начало']),
      ekpEnd: toDate(r['Сроки по ЕКП окончание']),
      address: str(r['Адрес']),
      status: str(r['Статус']),
      rejectReason: str(r['Причина отклонения']),
      canEdit: str(r['Статус']) === APPLICATION_STATUS.new,
      // Оружие: строки для показа и разобранные записи «спортсмен → его оружие»; виды транспорта — списком
      weaponLines: textLines(r['Оружие']),
      weaponEntries: parseWeaponText(r['Оружие']),
      transportList: splitList(r['Вид транспорта']),
      // CreatedBy — ID спортсмена, создавшего заявку; CreatedAt — момент создания (московское время)
      createdById: str(r['CreatedBy']),
      createdAt: toDate(r['CreatedAt']),
    }))
    // Новые заявки сверху
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

  // Справочник видов транспорта: первый столбец листа — название
  const transportSheet = data?.sheets?.[SHEET.transportTypes];
  const transportTypes = transportSheet ? transportSheet.rows.map((r) => str(r[transportSheet.headers[0]])) : [];

  // Какие настройки уведомлений есть в таблице: нет столбца — в профиле нет и переключателя
  const athleteHeaders = data?.sheets?.[SHEET.athletes]?.headers ?? [];
  const notificationSettings = Object.keys(NOTIFY_COLUMN).filter((key) => athleteHeaders.includes(NOTIFY_COLUMN[key]));

  return {
    competitions,
    athletes,
    weapons,
    applications,
    transportTypes,
    notificationSettings,
    skipped,
    athleteId: data?.athleteId ?? null,
  };
}
