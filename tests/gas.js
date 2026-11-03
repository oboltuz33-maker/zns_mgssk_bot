// Запуск apps-script/sheets.gs в Node с подставными сервисами Google (таблица в памяти, кэш, свойства, блокировки,
// UrlFetchApp) — чтобы проверять doGet, doPost и onSheetEdit без Google. Подпись Telegram — настоящий HMAC.
import fs from 'node:fs';
import crypto from 'node:crypto';

const SOURCE = fs.readFileSync(new URL('../apps-script/sheets.gs', import.meta.url), 'utf8');

const SERVICES = [
  'SpreadsheetApp', 'CacheService', 'PropertiesService', 'LockService', 'Utilities', 'Session',
  'ContentService', 'UrlFetchApp', 'ScriptApp', 'console',
];

// Функции скрипта, которые тесты вызывают напрямую
const EXPORTS = ['doGet', 'doPost', 'onSheetEdit', 'safeCell_', 'normalizePhone_', 'sheetDate_', 'isUpcoming_'];

// Скрипт компилируется один раз, а каждый вызов получает свою область видимости — как отдельное выполнение
// Apps Script (глобальные переменные скрипта, например память прочитанных листов, живут один вызов)
const factory = new Function(
  ...SERVICES,
  `${SOURCE}\nreturn { ${EXPORTS.join(', ')}, __eval: (code) => eval(code) };`,
);

export const BOT_TOKEN = '123456:TEST-TOKEN';

// ---------- Таблица в памяти ----------

// Запись значения как в Google Таблицах: '=…' — формула, "'…" — текст без апострофа
function storeCell(sheet, r, c, value) {
  while (sheet.values.length <= r) sheet.values.push([]);
  while (sheet.formulas.length <= r) sheet.formulas.push([]);
  if (typeof value === 'string' && value.startsWith('=')) {
    if (sheet.formulas[r][c] !== value) sheet.values[r][c] = '';
    sheet.formulas[r][c] = value;
  } else {
    sheet.values[r][c] = typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value;
    sheet.formulas[r][c] = '';
  }
}

class FakeRange {
  constructor(sheet, row, column, numRows, numColumns) {
    Object.assign(this, { sheet, row, column, numRows, numColumns });
  }
  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getColumn() { return this.column; }
  getLastRow() { return this.row + this.numRows - 1; }
  getLastColumn() { return this.column + this.numColumns - 1; }
  getNumRows() { return this.numRows; }
  getNumColumns() { return this.numColumns; }
  grid(source) {
    return Array.from({ length: this.numRows }, (_, i) =>
      Array.from({ length: this.numColumns }, (_, j) => source[this.row - 1 + i]?.[this.column - 1 + j] ?? ''),
    );
  }
  getValues() { return this.grid(this.sheet.values); }
  getValue() { return this.getValues()[0][0]; }
  getFormulas() { return this.grid(this.sheet.formulas); }
  setValues(rows) {
    rows.forEach((row, i) => row.forEach((v, j) => storeCell(this.sheet, this.row - 1 + i, this.column - 1 + j, v)));
    return this;
  }
  setValue(value) {
    storeCell(this.sheet, this.row - 1, this.column - 1, value);
    return this;
  }
}

export class FakeSheet {
  constructor(name, rows = []) {
    this.name = name;
    this.values = [];
    this.formulas = [];
    rows.forEach((row, r) => row.forEach((v, c) => storeCell(this, r, c, v)));
  }
  getName() { return this.name; }
  getLastRow() { return this.values.length; }
  getLastColumn() { return Math.max(0, ...this.values.map((r) => r.length)); }
  getRange(row, column, numRows = 1, numColumns = 1) { return new FakeRange(this, row, column, numRows, numColumns); }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(row) {
    const r = this.values.length;
    row.forEach((v, c) => storeCell(this, r, c, v));
    return this;
  }
  deleteRow(row) {
    this.values.splice(row - 1, 1);
    this.formulas.splice(row - 1, 1);
  }
  insertRowBefore(row) {
    this.values.splice(row - 1, 0, []);
    this.formulas.splice(row - 1, 0, []);
  }
  setFrozenRows() {}
  // Строки листа объектами { заголовок: значение } — для проверок
  objects() {
    const [headers, ...rows] = this.values;
    return rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
  }
}

class FakeSpreadsheet {
  constructor(sheets) { this.sheets = sheets; }
  getName() { return 'Тестовая таблица'; }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) ?? null; }
  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this.sheets.push(sheet);
    return sheet;
  }
}

// ---------- Сервисы ----------

function keyValueStore() {
  const map = new Map();
  return {
    map,
    get: (key) => map.get(key) ?? null,
    getAll: (keys) => Object.fromEntries(keys.filter((k) => map.has(k)).map((k) => [k, map.get(k)])),
    put: (key, value) => void map.set(key, String(value)),
    putAll: (values) => Object.entries(values).forEach(([k, v]) => map.set(k, String(v))),
    remove: (key) => void map.delete(key),
  };
}

const bytes = (value) => [...Buffer.from(value, 'utf8')];
const hmac = (key, value) => crypto.createHmac('sha256', Buffer.from(key)).update(Buffer.from(value)).digest();

// Подписанная строка, как её выдаёт Telegram (initData или ответ requestContact)
export function signTelegram(fields, botToken = BOT_TOKEN) {
  const all = { auth_date: String(Math.floor(Date.now() / 1000)), ...fields };
  const check = Object.keys(all).sort().map((k) => `${k}=${all[k]}`).join('\n');
  const hash = hmac(hmac('WebAppData', botToken), check).toString('hex');
  return new URLSearchParams({ ...all, hash }).toString();
}

export const initDataFor = (user, extra = {}) => signTelegram({ user: JSON.stringify(user), ...extra });
export const contactFor = (userId, phone) =>
  signTelegram({ contact: JSON.stringify({ user_id: userId, phone_number: phone, first_name: 'Тест' }) });

// Окружение скрипта: таблица из листов sheets ({ имя: [[заголовки], [строка], …] }) и сервисы с общим состоянием
export function createGas(sheets) {
  const spreadsheet = new FakeSpreadsheet(Object.entries(sheets).map(([name, rows]) => new FakeSheet(name, rows)));
  const cache = keyValueStore();
  const props = keyValueStore();
  props.put('BOT_TOKEN', BOT_TOKEN);
  props.put('MINI_APP_URL', 'https://example.org/app/');
  // Запросы к Telegram: { url, payload }
  const telegram = [];
  const response = (body) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(body) });
  const fetch = (url, options = {}) => {
    telegram.push({ url, payload: options.payload ? JSON.parse(options.payload) : null });
    return response(url.endsWith('/getMe') ? { ok: true, result: { username: 'test_bot' } } : { ok: true });
  };
  const lock = { waitLock() {}, tryLock: () => true, releaseLock() {} };

  const services = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet, flush() {} },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: props.get,
        getProperties: () => Object.fromEntries(props.map),
        setProperty: props.put,
        setProperties: props.putAll,
        deleteProperty: props.remove,
      }),
    },
    LockService: { getScriptLock: () => lock, getDocumentLock: () => lock },
    Utilities: {
      newBlob: (value) => ({ getBytes: () => bytes(value) }),
      computeHmacSha256Signature: (value, key) => [...hmac(Buffer.from(key), Buffer.from(value))],
      formatDate: (date) => date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }),
    },
    Session: { getScriptTimeZone: () => 'Europe/Moscow' },
    ContentService: { createTextOutput: (text) => ({ text, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    UrlFetchApp: { fetch, fetchAll: (requests) => requests.map((r) => fetch(r.url, r)) },
    ScriptApp: { getProjectTriggers: () => [], getService: () => ({ getUrl: () => '' }) },
    console: { log() {}, error() {}, warn() {} },
  };

  // Новое «выполнение» скрипта
  const run = () => factory(...SERVICES.map((name) => services[name]));
  const parse = (output) => JSON.parse(output.text);

  return {
    spreadsheet,
    sheet: (name) => spreadsheet.getSheetByName(name),
    cache,
    props,
    telegram,
    run,
    get: (params) => parse(run().doGet({ parameter: params })),
    post: (body) => parse(run().doPost({ postData: { contents: JSON.stringify(body) } })),
    // Ручная правка листа: значения пишутся в таблицу, затем срабатывает onSheetEdit
    edit(sheetName, row, column, rows, oldValue) {
      const sheet = spreadsheet.getSheetByName(sheetName);
      const range = sheet.getRange(row, column, rows.length, rows[0].length).setValues(rows);
      const single = rows.length === 1 && rows[0].length === 1;
      run().onSheetEdit({ range, value: single ? rows[0][0] : undefined, oldValue: single ? oldValue : undefined });
    },
  };
}
