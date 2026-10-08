import { SHEET } from '../config.js';

// Правка загруженных данных листов на месте — после действия, которое Apps Script уже выполнил.
// Так изменение видно сразу, а таблицу не нужно перекачивать целиком (экономия трафика и лимитов Apps Script).
// Полная загрузка — как обычно: при открытии приложения, при возврате в него или по кнопке «Обновить».

const withRows = (data, sheetName, change) => {
  const sheet = data.sheets[sheetName];
  if (!sheet) return data;
  return { ...data, sheets: { ...data.sheets, [sheetName]: { ...sheet, rows: change(sheet.rows) } } };
};

// Заявка: добавить или заменить (по №) строку, которую вернул Apps Script после сохранения
export const withApplicationRow = (data, row) => {
  if (!row) return data;
  const number = String(row['№']);
  return withRows(data, SHEET.applications, (rows) =>
    rows.some((r) => String(r['№']) === number) ? rows.map((r) => (String(r['№']) === number ? row : r)) : [...rows, row],
  );
};

// Заявка удалена (ушла в архив)
export const withoutApplication = (data, number) =>
  withRows(data, SHEET.applications, (rows) => rows.filter((r) => String(r['№']) !== String(number)));

// Оружие закреплено или откреплено: link — { athleteId, weaponId } из ответа Apps Script
const ATHLETE_ID = 'Спортсмен ид';
const WEAPON_ID = 'Оружие ид';
const isLink = (r, link) => String(r[ATHLETE_ID]) === link.athleteId && String(r[WEAPON_ID]) === link.weaponId;

export const withWeaponLink = (data, link) =>
  withRows(data, SHEET.athleteWeapons, (rows) =>
    rows.some((r) => isLink(r, link)) ? rows : [...rows, { [ATHLETE_ID]: link.athleteId, [WEAPON_ID]: link.weaponId }],
  );

export const withoutWeaponLink = (data, link) => withRows(data, SHEET.athleteWeapons, (rows) => rows.filter((r) => !isLink(r, link)));
