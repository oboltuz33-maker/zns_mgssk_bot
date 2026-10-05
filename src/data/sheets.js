import { GOOGLE_SCRIPT_URL, SHEETS_CACHE_TTL_MINUTES, SHEETS_TO_LOAD } from '../config.js';

const CACHE_TTL_MS = SHEETS_CACHE_TTL_MINUTES * 60 * 1000;
// Список листов входит в ключ кэша: после его изменения в настройках данные загрузятся заново
const SHEETS_PARAM = SHEETS_TO_LOAD.join(',');

// Листы таблицы загружаются одним запросом к Apps Script и хранятся в localStorage,
// чтобы не тратить лимиты на каждое открытие страницы или фильтрацию.
const CACHE_KEY = 'zns-sheets-v1';

// Ответ Apps Script: { headers: [...], rows: [[...], ...] } → массив объектов { заголовок: значение }
const toObjects = ({ headers, rows }) =>
  rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));

const parseResponse = (json) => {
  if (json.status !== 'success') throw new Error(json.message || 'Apps Script вернул ошибку');
  const sheets = {};
  for (const [name, sheet] of Object.entries(json.sheets)) {
    sheets[name] = { headers: sheet.headers, rows: toObjects(sheet) };
  }
  return { sheets, updatedAt: json.updatedAt };
};

export function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (!cached?.data || cached.sheetsParam !== SHEETS_PARAM) return null;
    return { ...cached, isFresh: Date.now() - cached.savedAt < CACHE_TTL_MS };
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), sheetsParam: SHEETS_PARAM, data }));
  } catch {
    // Переполнен localStorage или он недоступен — просто работаем без кэша
  }
}

export async function fetchSheets() {
  const url = new URL(GOOGLE_SCRIPT_URL);
  url.searchParams.set('action', 'sheets');
  if (SHEETS_PARAM) url.searchParams.set('names', SHEETS_PARAM);

  const response = await fetch(url);
  let json;
  try {
    json = await response.json();
  } catch {
    // Вместо JSON пришла HTML-страница ошибки Google: нет doGet или веб-приложение закрыто
    throw new Error('Apps Script не вернул данные — проверьте doGet и доступ к веб-приложению');
  }
  const data = parseResponse(json);
  writeCache(data);
  return data;
}

// Поиск без учёта регистра по всем столбцам строки
export function filterRows(rows, query) {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => Object.values(row).some((v) => String(v).toLowerCase().includes(q)));
}
