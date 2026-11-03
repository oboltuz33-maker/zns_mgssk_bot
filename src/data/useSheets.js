import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessDeniedError, clearCache, fetchSheets, readCache, writeCache } from './sheets.js';

// Сразу отдаёт листы из кэша на устройстве (если есть) и тихо подгружает свежие
export function useSheets() {
  const [state, setState] = useState(() => {
    const cached = readCache();
    return { data: cached?.data ?? null, savedAt: cached?.savedAt ?? null, loading: false, error: null, accessDenied: null };
  });

  // Когда данные последний раз правились на месте (patch). Загрузка, начатая раньше, могла уйти до
  // сохранения и вернуть таблицу без него — такой ответ не должен затереть только что сохранённое
  const lastPatchAt = useRef(0);
  // Номер последней начатой загрузки и идёт ли она. Ответ на более раннюю загрузку, пришедший позже, отбрасывается
  const lastRequest = useRef(0);
  const loadingNow = useRef(false);

  // refresh({ fresh: true }) — по явной просьбе пользователя: данные читаются из таблицы мимо кэша скрипта
  const refresh = useCallback(async ({ fresh = false } = {}) => {
    // Загрузка уже идёт — фоновая ещё одна не нужна (при возврате в приложение срабатывают два события сразу).
    // Явная просьба пользователя (fresh) начинает новую загрузку, а ответ на прежнюю будет отброшен
    if (loadingNow.current && !fresh) return;
    const request = ++lastRequest.current;
    loadingNow.current = true;
    const isLatest = () => request === lastRequest.current;
    const startedAt = Date.now();
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchSheets({ fresh });
      if (!isLatest()) return;
      if (startedAt < lastPatchAt.current) {
        // Устаревший ответ отбрасываем: правка на месте уже актуальна, остальное обновится при следующей загрузке
        setState((s) => ({ ...s, loading: false }));
        return;
      }
      setState({ data, savedAt: Date.now(), loading: false, error: null, accessDenied: null });
    } catch (error) {
      console.error(error);
      if (!isLatest()) return;
      if (error instanceof AccessDeniedError) {
        // Доступ закрыт — убираем и сохранённые на устройстве данные
        clearCache();
        setState({ data: null, savedAt: null, loading: false, error: null, accessDenied: { reason: error.reason, message: error.message } });
      } else {
        setState((s) => ({ ...s, loading: false, error: error.message || 'Ошибка сети' }));
      }
    } finally {
      if (isLatest()) loadingNow.current = false;
    }
  }, []);

  // Правка загруженных данных на месте — например, только что сохранённая заявка: её видно сразу,
  // не дожидаясь, пока таблица перечитается (при плохой связи это может затянуться или не получиться)
  const patch = useCallback((updater) => {
    lastPatchAt.current = Date.now();
    setState((s) => {
      if (!s.data) return s;
      const data = updater(s.data);
      writeCache(data, s.savedAt ?? Date.now());
      return { ...s, data };
    });
  }, []);

  // При открытии — сразу показываем сохранённое на устройстве и в фоне загружаем свежее: сохранённое могло
  // устареть (правки в таблице, смена записи спортсмена). При возврате в приложение (Telegram Desktop прячет
  // окно, а не закрывает) — загружаем, если с прошлой загрузки прошло больше SHEETS_CACHE_TTL_MINUTES
  useEffect(() => {
    refresh();
    const onReturn = () => {
      if (document.visibilityState === 'visible' && !readCache()?.isFresh) refresh();
    };
    document.addEventListener('visibilitychange', onReturn);
    const webApp = window.Telegram?.WebApp;
    webApp?.onEvent?.('activated', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      webApp?.offEvent?.('activated', onReturn);
    };
  }, [refresh]);

  return { ...state, refresh, patch };
}
