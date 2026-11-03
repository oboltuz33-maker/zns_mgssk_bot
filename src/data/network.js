// Запросы к Apps Script с повтором при обрыве связи. Связь с серверами Google бывает нестабильной:
// запрос не доходит или ответ теряется, и браузер сообщает только «Failed to fetch».

// Паузы перед повторными попытками, мс: всего попыток — на одну больше
const RETRY_DELAYS_MS = [1000, 3000];

// Сколько ждать ответа на одну попытку. Apps Script отвечает за секунды (запись ждёт блокировку до 10 с),
// а запрос, оборванный без ошибки, иначе висел бы бесконечно
const TIMEOUT_MS = 45000;

const NETWORK_ERROR_MESSAGE = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз';
const TIMEOUT_MESSAGE = 'Сервер долго не отвечает. Попробуйте ещё раз';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fetch с повтором при сетевой ошибке (ответ с ошибкой от сервера не повторяем — он уже получен).
// Не дождались ответа за TIMEOUT_MS — не повторяем: связь настолько плохая, что решать пользователю.
// Для POST повтор безопасен, только если сервер узнаёт повторный запрос — см. requestId в api.js
export async function fetchWithRetry(url, options) {
  for (let attempt = 0; ; attempt++) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller && setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller?.signal });
    } catch (error) {
      console.warn(`Сетевая ошибка (попытка ${attempt + 1}):`, error);
      if (controller?.signal.aborted) throw new Error(TIMEOUT_MESSAGE);
      if (attempt >= RETRY_DELAYS_MS.length) throw new Error(NETWORK_ERROR_MESSAGE);
      await sleep(RETRY_DELAYS_MS[attempt]);
    } finally {
      clearTimeout(timer);
    }
  }
}

// Уникальный номер запроса — по нему Apps Script узнаёт повтор и не выполняет действие дважды
export const newRequestId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
