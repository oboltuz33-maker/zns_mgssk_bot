// Telegram (как и браузер) может держать старую index.html в кэше до 10 минут
// (GitHub Pages отдаёт Cache-Control: max-age=600). При запуске скачиваем свежую
// index.html в обход кэша и, если в ней другой бандл, перезагружаемся на новую версию.
const RELOAD_FLAG = 'zns-reloaded-for';

const bundleName = (src) => src?.match(/assets\/index-[^"'?]+\.js/)?.[0];

export async function checkForUpdate() {
  // В режиме разработки (vite dev) бандла нет
  if (import.meta.env.DEV) return;

  const current = bundleName(document.querySelector('script[type="module"][src*="assets/index-"]')?.src);
  if (!current) return;

  try {
    const response = await fetch(`${location.pathname}?nocache=${Date.now()}`, { cache: 'no-store' });
    const latest = bundleName(await response.text());
    if (!latest || latest === current) return;

    // Защита от бесконечной перезагрузки, если CDN ещё не обновился
    if (sessionStorage.getItem(RELOAD_FLAG) === latest) return;
    sessionStorage.setItem(RELOAD_FLAG, latest);

    // Новый параметр v обходит кэш. Остальные параметры (?page=…&competition=… из ссылки бота) и hash сохраняем —
    // в hash данные Telegram (tgWebAppData)
    const search = new URLSearchParams(location.search);
    search.set('v', Date.now());
    location.replace(`${location.pathname}?${search}${location.hash}`);
  } catch {
    // Нет сети — работаем с тем, что загрузилось
  }
}
