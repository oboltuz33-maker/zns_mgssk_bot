// Настройки приложения

// Веб-приложение Google Apps Script, привязанное к таблице. Своё у каждого окружения — см. .env.production и .env.test
export const GOOGLE_SCRIPT_URL = import.meta.env.VITE_GOOGLE_SCRIPT_URL;

// Метка окружения («ТЕСТ»), пусто — рабочее
export const ENV_LABEL = import.meta.env.VITE_ENV_LABEL || '';

// Рабочее и тестовое приложения открываются с одного домена (github.io) и делят localStorage —
// ключи тестового получают приставку, чтобы его данные не попадали в рабочее. У рабочего ключи прежние
export const storageKey = (name) => (ENV_LABEL ? `test:${name}` : name);

// Через сколько минут сохранённые на устройстве листы считаются устаревшими
// и перезапрашиваются у Apps Script
export const SHEETS_CACHE_TTL_MINUTES = 10;

// Листы таблицы, которые использует приложение (имена точно как на вкладках таблицы).
// Ключ — внутреннее имя в коде, значение — название листа.
export const SHEET = {
  competitions: 'Соревнования',
  athletes: 'Спортсмены',
  weapons: 'Оружие',
  athleteWeapons: 'Спортсмен/Оружие',
  applications: 'Заявки',
  // Справочник видов транспорта: первый столбец — название
  transportTypes: 'Виды транспорта',
};

// Какие листы загружать. Пустой список — все листы, кроме тех, чьё имя начинается с "_".
export const SHEETS_TO_LOAD = Object.values(SHEET);

// Вид транспорта, отмеченный в новой заявке по умолчанию (название из листа «Виды транспорта»)
export const DEFAULT_TRANSPORT = 'Автомобиль';
