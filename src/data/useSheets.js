import { useCallback, useEffect, useState } from 'react';
import { AccessDeniedError, clearCache, fetchSheets, readCache } from './sheets.js';

// Сразу отдаёт листы из кэша (если есть), а если кэш устарел — тихо подгружает свежие
export function useSheets() {
  const [state, setState] = useState(() => {
    const cached = readCache();
    return { data: cached?.data ?? null, savedAt: cached?.savedAt ?? null, loading: false, error: null, accessDenied: null };
  });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchSheets();
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

  useEffect(() => {
    if (!readCache()?.isFresh) refresh();
  }, [refresh]);

  return { ...state, refresh };
}
