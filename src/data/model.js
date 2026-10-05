import { SHEET } from '../config.js';

// Превращает строки листов (объекты «заголовок → значение») в удобные для страниц сущности.
// Названия столбцов таблицы используются только здесь.

const str = (value) => String(value ?? '').trim();

const toDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const rowsOf = (data, sheetName) => data?.sheets?.[sheetName]?.rows ?? [];

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

// upcoming — ещё не началось, ongoing — идёт сейчас, past — завершилось
export function competitionStatus(competition, now = new Date()) {
  const today = startOfDay(now);
  const start = competition.start && startOfDay(competition.start);
  const end = competition.end ? startOfDay(competition.end) : start;
  if (end && end < today) return 'past';
  if (start && start <= today) return 'ongoing';
  return 'upcoming';
}

export function buildModel(data) {
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

  const applications = rowsOf(data, SHEET.applications).map((r) => ({
    number: str(r['№']),
    fullName: str(r['ФИО']),
    weapon: str(r['Оружие']),
    transportStart: toDate(r['Сроки перевозки начало']),
    transportEnd: toDate(r['Сроки перевозки окончание']),
    transport: str(r['Вид транспорта']),
    competitionKind: str(r['Вид соревнования']),
    competitionTitle: str(r['Название соревнования']),
    address: str(r['Адрес']),
    status: str(r['Статус']),
    createdAt: toDate(r['CreatedAt']),
  }));

  return { competitions, athletes, weapons, applications };
}
