import { GOOGLE_SCRIPT_URL } from '../config.js';
import { telegramInitData } from './sheets.js';
import { fetchWithRetry, newRequestId } from './network.js';

// Запрос к Apps Script (doPost). Тело уходит как text/plain — это «простой» запрос без CORS preflight,
// который Apps Script не поддерживает. К каждому запросу добавляются подписанные данные Telegram
// и requestId: при обрыве связи запрос повторяется, и скрипт по requestId не выполнит его второй раз
// (например, не создаст вторую такую же заявку, если первый запрос дошёл, а ответ потерялся).
// Ответ: { status, message, ... }, где status — success | pending | not_found | conflict | forbidden | expired | error.
export async function postAction(action, payload) {
  const response = await fetchWithRetry(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify({ action, initData: telegramInitData(), requestId: newRequestId(), ...payload }),
  });
  try {
    return await response.json();
  } catch {
    throw new Error('Apps Script не вернул ответ — проверьте doPost и доступ к веб-приложению');
  }
}
