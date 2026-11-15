import { SHEET } from '../config.js';
import { idColumn } from './model.js';

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

// Поля строки спортсмена изменены (например, настройки уведомлений): fields — { заголовок: значение } из ответа Apps Script
export const withAthleteFields = (data, athleteId, fields) => {
  const id = idColumn(data, SHEET.athletes);
  return withRows(data, SHEET.athletes, (rows) => rows.map((r) => (String(r[id]) === String(athleteId) ? { ...r, ...fields } : r)));
};

// Строка листа добавлена или изменена (ответ Apps Script на действие администратора): замена по ID (первый столбец)
// или добавление в конец
export const withSheetRow = (data, sheetName, row) => {
  if (!row) return data;
  const id = idColumn(data, sheetName);
  const key = String(row[id]);
  return withRows(data, sheetName, (rows) =>
    rows.some((r) => String(r[id]) === key) ? rows.map((r) => (String(r[id]) === key ? row : r)) : [...rows, row],
  );
};

// Строки листа удалены: matches(row) — какие
export const withoutSheetRows = (data, sheetName, matches) => withRows(data, sheetName, (rows) => rows.filter((r) => !matches(r)));

// Спортсмен удалён: вместе с ним — его закрепления и его заявки (перенесены в архив)
export const withoutAthlete = (data, athleteId) => {
  const id = idColumn(data, SHEET.athletes);
  let next = withoutSheetRows(data, SHEET.athletes, (r) => String(r[id]) === athleteId);
  next = withoutSheetRows(next, SHEET.athleteWeapons, (r) => String(r[ATHLETE_ID]) === athleteId);
  return withoutSheetRows(next, SHEET.applications, (r) => String(r['CreatedBy']) === athleteId);
};

// Единица оружия удалена из справочника вместе с закреплениями
export const withoutWeapon = (data, weaponId) => {
  const id = idColumn(data, SHEET.weapons);
  const next = withoutSheetRows(data, SHEET.weapons, (r) => String(r[id]) === weaponId);
  return withoutSheetRows(next, SHEET.athleteWeapons, (r) => String(r[WEAPON_ID]) === weaponId);
};
