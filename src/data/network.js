// Запросы к Apps Script с повтором при обрыве связи. Связь с серверами Google бывает нестабильной:
// запрос не доходит или ответ теряется, и браузер сообщает только «Failed to fetch».

// Паузы перед повторными попытками, мс: всего попыток — на одну больше
const RETRY_DELAYS_MS = [1000, 3000];

export const NETWORK_ERROR_MESSAGE = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fetch с повтором при сетевой ошибке (ответ с ошибкой от сервера не повторяем — он уже получен).
// Для POST повтор безопасен, только если сервер узнаёт повторный запрос — см. requestId в api.js
export async function fetchWithRetry(url, options) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      console.warn(`Сетевая ошибка (попытка ${attempt + 1}):`, error);
      if (attempt >= RETRY_DELAYS_MS.length) throw new Error(NETWORK_ERROR_MESSAGE);
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

// Уникальный номер запроса — по нему Apps Script узнаёт повтор и не выполняет действие дважды
export const newRequestId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
