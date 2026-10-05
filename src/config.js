// Настройки приложения

// Веб-приложение Google Apps Script, привязанное к таблице
export const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxLCEk-qSvy3ZDf6A15TOT7rIQOrtfRfVbRQvh3X907Trjh6PojNBA7HryTZEXu60cxxw/exec';

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
};

// Какие листы загружать. Пустой список — все листы, кроме тех, чьё имя начинается с "_".
export const SHEETS_TO_LOAD = Object.values(SHEET);
