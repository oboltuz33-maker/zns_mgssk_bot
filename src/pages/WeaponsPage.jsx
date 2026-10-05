import { useState } from 'react';
import { Chips, EmptyState, PageHeader, SearchInput, matches } from '../components.jsx';

export function WeaponsPage({ model }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const assigned = model.weapons.filter((w) => w.owners.length > 0);
  const source = filter === 'assigned' ? assigned : model.weapons;
  const list = source.filter((w) => matches(query, w.title, w.number, ...w.owners.map((o) => o.fullName)));

  return (
    <>
      <PageHeader title="Оружие" subtitle={`Всего: ${model.weapons.length}, закреплено: ${assigned.length}`} />
      <Chips
        options={[
          { value: 'all', label: 'Всё', count: model.weapons.length },
          { value: 'assigned', label: 'Закреплённое', count: assigned.length },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <SearchInput value={query} onChange={setQuery} placeholder="Название, номер, владелец" />
      <p className="sheet-meta">Найдено: {list.length}</p>

      {list.length === 0 ? (
        <EmptyState icon="🎯" title="Ничего не найдено" />
      ) : (
        <div className="list">
          {list.map((w) => (
            <div key={w.id} className="list-item">
              <div className="list-text">
                <div className="item-title">{w.title}</div>
                {w.owners.length > 0 && (
                  <div className="item-hint">👤 {w.owners.map((o) => o.fullName).join(', ')}</div>
                )}
              </div>
              <code>{w.number}</code>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
