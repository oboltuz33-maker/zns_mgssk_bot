import { useState } from 'react';
import { Badge, EmptyState, PageHeader, SearchInput } from '../components.jsx';
import { fuzzySearch } from '../data/search.js';

export function AthleteStatus({ athlete }) {
  return (
    <>
      {athlete.status && (
        <Badge tone={athlete.status.toLowerCase() === 'подтвержден' ? 'success' : 'warning'}>{athlete.status}</Badge>
      )}
      {athlete.isCarrier && <Badge tone="accent">🚚 Перевозчик</Badge>}
    </>
  );
}

export function WeaponList({ weapons }) {
  if (weapons.length === 0) return <div className="item-hint">Оружие не закреплено</div>;
  return (
    <ul className="sub-list">
      {weapons.map((w) => (
        <li key={w.id}>
          🎯 {w.title} <code>{w.number}</code>
        </li>
      ))}
    </ul>
  );
}

export function AthletesPage({ model }) {
  const [query, setQuery] = useState('');
  // Поиск с опечатками, в другой раскладке и транслитом
  const list = fuzzySearch(model.athletes, query, (a) =>
    [a.fullName, a.phone, a.status, ...a.weapons.map((w) => `${w.title} ${w.number}`)].join(' '),
  );

  return (
    <>
      <PageHeader title="Спортсмены" subtitle={`Всего: ${model.athletes.length}`} />
      <SearchInput value={query} onChange={setQuery} placeholder="ФИО, телефон, оружие" />

      {list.length === 0 ? (
        <EmptyState icon="👤" title="Ничего не найдено" />
      ) : (
        list.map((a) => (
          <div key={a.id} className="card item-card">
            <div className="item-head">
              <div className="item-title">{a.fullName || 'Без имени'}</div>
            </div>
            <div className="item-tags">
              <AthleteStatus athlete={a} />
            </div>
            {a.phone && (
              <div className="item-row">
                📞 <a href={`tel:+${a.phone.replace(/\D/g, '')}`}>{a.phone}</a>
              </div>
            )}
            <WeaponList weapons={a.weapons} />
          </div>
        ))
      )}
    </>
  );
}
