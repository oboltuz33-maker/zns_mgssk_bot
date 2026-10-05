import { useState } from 'react';
import { Badge, EmptyState, PageHeader, SearchInput, formatDate, formatRange, matches } from '../components.jsx';

export function ApplicationsPage({ model }) {
  const [query, setQuery] = useState('');
  const list = model.applications.filter((a) =>
    matches(query, a.number, a.fullName, a.weapon, a.competitionTitle, a.status, a.transport),
  );

  return (
    <>
      <PageHeader title="Заявки" subtitle={`Всего: ${model.applications.length}`} />

      {model.applications.length === 0 ? (
        <EmptyState icon="📝" title="Заявок пока нет">
          Здесь появятся заявки на перевозку оружия к соревнованиям
        </EmptyState>
      ) : (
        <>
          <SearchInput value={query} onChange={setQuery} placeholder="№, ФИО, оружие, соревнование" />
          {list.length === 0 && <EmptyState icon="📝" title="Ничего не найдено" />}
          {list.map((a, i) => (
            <div key={a.number || i} className="card item-card">
              <div className="item-head">
                <div className="item-title">
                  {a.number && `№ ${a.number} · `}
                  {a.fullName}
                </div>
                {a.status && <Badge tone="accent">{a.status}</Badge>}
              </div>
              {a.competitionTitle && <div className="item-row">🏆 {a.competitionTitle}</div>}
              {a.weapon && <div className="item-row">🎯 {a.weapon}</div>}
              <div className="item-row">
                🚚 {formatRange(a.transportStart, a.transportEnd)}
                {a.transport && ` · ${a.transport}`}
              </div>
              {a.createdAt && <div className="item-hint">Создана {formatDate(a.createdAt)}</div>}
            </div>
          ))}
        </>
      )}
    </>
  );
}
