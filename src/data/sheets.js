import { GOOGLE_SCRIPT_URL, SHEETS_CACHE_TTL_MINUTES, SHEETS_TO_LOAD } from '../config.js';
import { fetchWithRetry } from './network.js';

const CACHE_TTL_MS = SHEETS_CACHE_TTL_MINUTES * 60 * 1000;
// Список листов входит в ключ кэша: после его изменения в настройках данные загрузятся заново
const SHEETS_PARAM = SHEETS_TO_LOAD.join(',');

// Листы таблицы загружаются одним запросом к Apps Script и хранятся в localStorage,
// чтобы не тратить лимиты на каждое открытие страницы или фильтрацию.
// v3: данные выдаются под конкретного пользователя Telegram — кэш привязан к его id
const CACHE_KEY = 'zns-sheets-v3';

// Подписанные данные пользователя Telegram: по ним Apps Script определяет спортсмена
// и отдаёт только его заявки. Вне Telegram их нет — доступа к данным тоже нет.
export const telegramInitData = () => window.Telegram?.WebApp?.initData || '';
const telegramUserId = () => String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id ?? '');

// Нет доступа к данным. reason — ответ Apps Script:
//   unregistered — пользователь не привязан к спортсмену (нужна авторизация),
//   pending — заявка на доступ ждёт подтверждения администратором,
//   forbidden — доступ закрыт; no-telegram — приложение открыто не из Telegram;
//   expired — подпись Telegram устарела (приложение открыто больше суток назад), нужно переоткрыть
export class AccessDeniedError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}
const ACCESS_STATUSES = ['unregistered', 'pending', 'forbidden', 'expired'];

// Идентификатор строки на каждом листе — в первом столбце. Строки без него
// (пустые, черновики, итоги и т.п.) игнорируются; их число сохраняется в skipped.
const hasId = (row) => String(row[0] ?? '').trim() !== '';

// Ответ Apps Script: { headers: [...], rows: [[...], ...] } → массив объектов { заголовок: значение }
const toObjects = (headers, rows) =>
  rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));

const parseResponse = (json) => {
  if (ACCESS_STATUSES.includes(json.status)) throw new AccessDeniedError(json.status, json.message || 'Нет доступа');
  if (json.status !== 'success') throw new Error(json.message || 'Apps Script вернул ошибку');
  const sheets = {};
  for (const [name, sheet] of Object.entries(json.sheets)) {
    const valid = sheet.rows.filter(hasId);
    sheets[name] = {
      headers: sheet.headers,
      rows: toObjects(sheet.headers, valid),
      skipped: sheet.rows.length - valid.length,
    };
  }
  return { sheets, updatedAt: json.updatedAt, athleteId: json.athleteId };
};

export function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (!cached?.data || cached.sheetsParam !== SHEETS_PARAM || cached.userId !== telegramUserId()) return null;
    return { ...cached, isFresh: Date.now() - cached.savedAt < CACHE_TTL_MS };
  } catch {
    return null;
  }
}

// savedAt — когда данные загружены из таблицы. При правке данных на месте (writeCache с прежним savedAt)
// срок их свежести не продлевается: при следующем открытии таблица перечитается как обычно
export function writeCache(data, savedAt = Date.now()) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt, sheetsParam: SHEETS_PARAM, userId: telegramUserId(), data }));
  } catch {
    // Переполнен localStorage или он недоступен — просто работаем без кэша
  }
}

export function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // localStorage недоступен — нечего чистить
  }
}

export async function fetchSheets() {
  const initData = telegramInitData();
  if (!initData) throw new AccessDeniedError('no-telegram', 'Откройте приложение из Telegram');

  const url = new URL(GOOGLE_SCRIPT_URL);
  url.searchParams.set('action', 'sheets');
  url.searchParams.set('initData', initData);
  if (SHEETS_PARAM) url.searchParams.set('names', SHEETS_PARAM);

  // Адрес запроса всегда одинаковый — запрещаем браузеру отдавать сохранённый ответ вместо свежего
  const response = await fetchWithRetry(url, { cache: 'no-store' });
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
