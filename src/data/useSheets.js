import { useCallback, useEffect, useState } from 'react';
import { fetchSheets, readCache } from './sheets.js';

// Сразу отдаёт листы из кэша (если есть), а если кэш устарел — тихо подгружает свежие
export function useSheets() {
  const [state, setState] = useState(() => {
    const cached = readCache();
    return { data: cached?.data ?? null, savedAt: cached?.savedAt ?? null, loading: false, error: null };
  });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchSheets();
      setState({ data, savedAt: Date.now(), loading: false, error: null });
    } catch (error) {
      console.error(error);
      setState((s) => ({ ...s, loading: false, error: error.message || 'Ошибка сети' }));
    }
  }, []);

  useEffect(() => {
    if (!readCache()?.isFresh) refresh();
  }, [refresh]);

  return { ...state, refresh };
}
