import { useMemo, useState } from 'react';
import { filterRows } from './data/sheets.js';
import { Chips, SearchInput } from './components.jsx';

// Чтобы длинный лист не тормозил отрисовку, показываем первые N строк результата
const MAX_VISIBLE_ROWS = 200;

const formatCell = (value) => {
  // Даты из Apps Script приходят строкой ISO
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return new Date(value).toLocaleDateString('ru-RU');
  }
  return String(value);
};

// Просмотр листов таблицы «как есть» — для проверки данных
export function SheetBrowser({ data }) {
  const names = data ? Object.keys(data.sheets) : [];
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');

  const sheetName = names.includes(selected) ? selected : names[0];
  const sheet = sheetName ? data.sheets[sheetName] : null;
  const filtered = useMemo(() => (sheet ? filterRows(sheet.rows, query) : []), [sheet, query]);

  if (!sheet) return <p className="sheet-meta">Нет загруженных листов</p>;

  return (
    <div className="sheet-browser">
      <Chips
        options={names.map((name) => ({ value: name, label: name, count: data.sheets[name].rows.length }))}
        value={sheetName}
        onChange={setSelected}
      />

      <SearchInput value={query} onChange={setQuery} placeholder="Поиск по всем столбцам" />

      <p className="sheet-meta">
        Найдено: {filtered.length}
        {filtered.length > MAX_VISIBLE_ROWS && `, показаны первые ${MAX_VISIBLE_ROWS}`}
      </p>

      <div className="sheet-table-wrap">
        <table className="sheet-table">
          <thead>
            <tr>
              {sheet.headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, MAX_VISIBLE_ROWS).map((row, i) => (
              <tr key={i}>
                {sheet.headers.map((h) => (
                  <td key={h}>{formatCell(row[h])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
