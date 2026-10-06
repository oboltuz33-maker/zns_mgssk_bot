import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessDeniedError, clearCache, fetchSheets, readCache, writeCache } from './sheets.js';

// Сразу отдаёт листы из кэша (если есть), а если кэш устарел — тихо подгружает свежие
export function useSheets() {
  const [state, setState] = useState(() => {
    const cached = readCache();
    return { data: cached?.data ?? null, savedAt: cached?.savedAt ?? null, loading: false, error: null, accessDenied: null };
  });

  // Когда данные последний раз правились на месте (patch). Загрузка, начатая раньше, могла уйти до
  // сохранения и вернуть таблицу без него — такой ответ не должен затереть только что сохранённое
  const lastPatchAt = useRef(0);

  const refresh = useCallback(async () => {
    const startedAt = Date.now();
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchSheets();
      if (startedAt < lastPatchAt.current) {
        // Устаревший ответ: следующая загрузка (её запускает тот, кто правил) принесёт актуальные данные
        setState((s) => ({ ...s, loading: false }));
        return;
      }
      setState({ data, savedAt: Date.now(), loading: false, error: null, accessDenied: null });
    } catch (error) {
      console.error(error);
      if (error instanceof AccessDeniedError) {
        // Доступ закрыт — убираем и сохранённые на устройстве данные
        clearCache();
        setState({ data: null, savedAt: null, loading: false, error: null, accessDenied: { reason: error.reason, message: error.message } });
      } else {
        setState((s) => ({ ...s, loading: false, error: error.message || 'Ошибка сети' }));
      }
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

  useEffect(() => {
    if (!readCache()?.isFresh) refresh();
  }, [refresh]);

  return { ...state, refresh, patch };
}
