// Запуск apps-script/sheets.gs в Node с подставными сервисами Google (таблица в памяти, кэш, свойства, блокировки,
// UrlFetchApp) — чтобы проверять doGet, doPost и onSheetEdit без Google. Подпись Telegram — настоящий HMAC.
import fs from 'node:fs';
import crypto from 'node:crypto';

const SOURCE = fs.readFileSync(new URL('../apps-script/sheets.gs', import.meta.url), 'utf8');

const SERVICES = [
  'SpreadsheetApp', 'CacheService', 'PropertiesService', 'LockService', 'Utilities', 'Session',
  'ContentService', 'UrlFetchApp', 'ScriptApp', 'DriveApp', 'MimeType', 'console',
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
    if (this.row + rows.length - 1 > this.sheet.getMaxRows()) throw new Error('Диапазон за пределами листа');
    rows.forEach((row, i) => row.forEach((v, j) => storeCell(this.sheet, this.row - 1 + i, this.column - 1 + j, v)));
    return this;
  }
  setValue(value) {
    storeCell(this.sheet, this.row - 1, this.column - 1, value);
    return this;
  }
  clearContent() {
    for (let i = 0; i < this.numRows; i++) {
      for (let j = 0; j < this.numColumns; j++) {
        const r = this.row - 1 + i;
        const c = this.column - 1 + j;
        if (r < this.sheet.values.length) storeCell(this.sheet, r, c, '');
      }
    }
    return this;
  }
}

export class FakeSheet {
  constructor(name, rows = []) {
    this.name = name;
    this.values = [];
    this.formulas = [];
    // Вызовы записи листа (appendRow, deleteRow, deleteRows) — проверки пакетной записи
    this.calls = [];
    this.maxRows = 1000;
    rows.forEach((row, r) => row.forEach((v, c) => storeCell(this, r, c, v)));
  }
  getName() { return this.name; }
  setName(name) {
    this.name = name;
    return this;
  }
  // Последняя строка с данными (пустые строки в конце, например после clearContent, не считаются)
  getLastRow() {
    let last = this.values.length;
    while (last > 0 && (this.values[last - 1] ?? []).every((v) => v === '' || v === undefined)) last--;
    return last;
  }
  // Копия листа в другую таблицу — значения и формулы, название «Копия …», как у Google
  copyTo(spreadsheet) {
    const copy = new FakeSheet('Копия ' + this.name);
    copy.values = this.values.map((row) => row.slice());
    copy.formulas = this.formulas.map((row) => row.slice());
    spreadsheet.sheets.push(copy);
    return copy;
  }
  getLastColumn() { return Math.max(0, ...this.values.map((r) => r.length)); }
  // Сетка листа: maxRows строк (как у нового листа Google — 1000), insertRowsAfter её расширяет
  getMaxRows() { return Math.max(this.maxRows, this.values.length); }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }
  insertRowsAfter(row, howMany) {
    this.calls.push('insertRowsAfter');
    this.maxRows = this.getMaxRows() + howMany;
  }
  getRange(row, column, numRows = 1, numColumns = 1) { return new FakeRange(this, row, column, numRows, numColumns); }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(row) {
    this.calls.push('appendRow');
    const r = this.values.length;
    row.forEach((v, c) => storeCell(this, r, c, v));
    return this;
  }
  deleteRow(row) {
    this.deleteRows(row, 1);
    this.calls[this.calls.length - 1] = 'deleteRow';
  }
  deleteRows(row, howMany) {
    this.calls.push('deleteRows');
    this.values.splice(row - 1, howMany);
    this.formulas.splice(row - 1, howMany);
  }
  insertRowBefore(row) {
    this.values.splice(row - 1, 0, []);
    this.formulas.splice(row - 1, 0, []);
  }
  setFrozenRows() {}
  // Строки листа объектами { заголовок: значение } — для проверок
  objects() {
    const [headers, ...rows] = this.values.slice(0, this.getLastRow());
    return rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
  }
}

class FakeSpreadsheet {
  constructor(sheets, id = 'main', name = 'Тестовая таблица') {
    Object.assign(this, { sheets, id, name });
  }
  getId() { return this.id; }
  getName() { return this.name; }
  deleteSheet(sheet) {
    if (this.sheets.length === 1) throw new Error('Нельзя удалить все листы');
    this.sheets = this.sheets.filter((s) => s !== sheet);
  }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) ?? null; }
  getSheets() { return this.sheets; }
  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this.sheets.push(sheet);
    return sheet;
  }
}

// ---------- Диск ----------

// Файлы и папки Диска: таблицы, созданные скриптом (SpreadsheetApp.create), — файлы с той же id
class FakeDrive {
  constructor() {
    this.files = new Map();
    this.folders = new Map();
    this.spreadsheets = new Map();
    this.nextId = 1;
    // Сбой создания таблицы (например, лимит Google)
    this.createError = null;
  }
  createSpreadsheet(name) {
    if (this.createError) throw new Error(this.createError);
    const id = 'file' + this.nextId++;
    const spreadsheet = new FakeSpreadsheet([new FakeSheet('Лист1')], id, name);
    this.spreadsheets.set(id, spreadsheet);
    this.files.set(id, { id, spreadsheet, description: '', folder: null, trashed: false, created: new Date() });
    return spreadsheet;
  }
  // Объект DriveApp
  api() {
    const drive = this;
    const fileApi = (file) => ({
      getId: () => file.id,
      getName: () => file.spreadsheet.getName(),
      getDateCreated: () => file.created,
      setDescription(text) { file.description = text; return this; },
      moveTo(folder) { file.folder = folder.getId(); return this; },
      setTrashed(value) { file.trashed = value; return this; },
    });
    const folderApi = (folder) => ({
      getId: () => folder.id,
      getName: () => folder.name,
      getUrl: () => 'https://drive.example/' + folder.id,
      isTrashed: () => folder.trashed,
      getFilesByType: () => {
        const list = [...drive.files.values()].filter((f) => f.folder === folder.id && !f.trashed).map(fileApi);
        return { hasNext: () => list.length > 0, next: () => list.shift() };
      },
    });
    return {
      getFileById: (id) => {
        if (!drive.files.has(id)) throw new Error('Нет файла ' + id);
        return fileApi(drive.files.get(id));
      },
      getFolderById: (id) => {
        if (!drive.folders.has(id)) throw new Error('Нет папки ' + id);
        return folderApi(drive.folders.get(id));
      },
      createFolder: (name) => {
        const folder = { id: 'folder' + drive.nextId++, name, trashed: false };
        drive.folders.set(folder.id, folder);
        return folderApi(folder);
      },
    };
  }
  // Копии в папке (не в корзине), по порядку создания
  filesIn(folderId) {
    return [...this.files.values()].filter((f) => f.folder === folderId && !f.trashed);
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
  const drive = new FakeDrive();
  const cache = keyValueStore();
  const props = keyValueStore();
  props.put('BOT_TOKEN', BOT_TOKEN);
  props.put('MINI_APP_URL', 'https://example.org/app/');
  // Запросы к Telegram: { url, payload }
  const telegram = [];
  const response = (body) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(body) });
  // fetchError — запросы к Telegram падают с этой ошибкой (сбой сети)
  const state = { fetchError: null };
  const fetch = (url, options = {}) => {
    if (state.fetchError) throw new Error(state.fetchError);
    // payload — JSON-строка (sendMessage) или объект с файлом (sendDocument, multipart)
    const payload = typeof options.payload === 'string' ? JSON.parse(options.payload) : options.payload ?? null;
    // scriptLocked — запрос ушёл, пока скрипт держал блокировку записи (doPost)
    telegram.push({ url, payload, scriptLocked: scriptLock.held });
    return response(url.endsWith('/getMe') ? { ok: true, result: { username: 'test_bot' } } : { ok: true });
  };
  const newLock = () => ({
    held: false,
    waitLock() { this.held = true; },
    tryLock() { this.held = true; return true; },
    releaseLock() { this.held = false; },
  });
  const scriptLock = newLock();
  const documentLock = newLock();

  const services = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById: (id) => {
        if (id === spreadsheet.getId()) return spreadsheet;
        if (!drive.spreadsheets.has(id)) throw new Error('Нет таблицы ' + id);
        return drive.spreadsheets.get(id);
      },
      create: (name) => drive.createSpreadsheet(name),
      flush() {},
    },
    DriveApp: drive.api(),
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
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
    LockService: { getScriptLock: () => scriptLock, getDocumentLock: () => documentLock },
    Utilities: {
      newBlob: (value, contentType, name) => ({ getBytes: () => bytes(value), getDataAsString: () => value, getName: () => name }),
      // Архив — список упакованных частей { имя: текст }: проверки читают части файла Excel
      zip: (blobs, name) => ({
        name,
        files: Object.fromEntries(blobs.map((b) => [b.getName(), b.getDataAsString()])),
        contentType: 'application/zip',
        setContentType(type) {
          this.contentType = type;
          return this;
        },
        getName() {
          return this.name;
        },
      }),
      computeHmacSha256Signature: (value, key) => [...hmac(Buffer.from(key), Buffer.from(value))],
      // Поддерживаются форматы, которые использует скрипт: dd.MM.yyyy, yyyy-MM-dd и yyyy-MM-dd HH:mm
      formatDate: (date, timeZone, format) => {
        const day = date.toLocaleDateString(format.startsWith('yyyy') ? 'sv-SE' : 'ru-RU', { timeZone: 'Europe/Moscow' });
        if (!format.endsWith('HH:mm')) return day;
        return day + ' ' + date.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
      },
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
    drive,
    sheet: (name) => spreadsheet.getSheetByName(name),
    cache,
    props,
    telegram,
    failTelegram: (error) => void (state.fetchError = error),
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
