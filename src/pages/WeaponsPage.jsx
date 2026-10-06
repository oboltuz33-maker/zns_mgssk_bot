import { useState } from 'react';
import { findMyAthlete } from '../data/model.js';
import { postAction } from '../data/api.js';
import { fuzzySearch } from '../data/search.js';
import { Chips, EmptyState, PageHeader, SearchInput, confirmAction } from '../components.jsx';

// Сколько результатов поиска по справочнику показывать — справочник может быть большим
const SEARCH_LIMIT = 20;

// Раздел «Оружие»: вкладка «Закреплённое» — своё оружие (можно открепить),
// вкладка «Справочник» — поиск по общему справочнику без своего (можно закрепить за собой)
export function WeaponsPage({ model, user, sheets, onMessage }) {
  const me = findMyAthlete(model, user);
  const [tab, setTab] = useState('mine');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);

  if (!me) return <EmptyState icon="🎯" title="Спортсмен не определён" />;

  const mine = me.weapons;
  const catalog = model.weapons.filter((w) => !mine.includes(w));
  // Справочник целиком не показываем — только результаты поиска
  const found = query.trim() ? fuzzySearch(catalog, query, (w) => `${w.title} ${w.number}`, SEARCH_LIMIT) : [];

  // Закрепить или открепить; после ответа сервера данные перечитываются из таблицы
  const run = async (action, weapon) => {
    setBusyId(weapon.id);
    try {
      const result = await postAction(action, { weaponId: weapon.id });
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось выполнить действие');
      await sheets.refresh();
      onMessage(result.message);
    } catch (e) {
      console.error(e);
      onMessage(e.message || 'Ошибка сети');
    } finally {
      setBusyId(null);
    }
  };

  const unassign = async (weapon) => {
    if (await confirmAction(`Открепить ${weapon.title} ${weapon.number}?`)) run('unassignWeapon', weapon);
  };

  const owners = (weapon) => weapon.owners.filter((o) => o !== me).map((o) => o.shortName).join(', ');

  return (
    <>
      <PageHeader title="Оружие" subtitle={me.fullName} />
      <Chips
        options={[
          { value: 'mine', label: 'Закреплённое', count: mine.length },
          { value: 'catalog', label: 'Справочник', count: catalog.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'mine' &&
        (mine.length === 0 ? (
          <EmptyState icon="🎯" title="За вами пока не закреплено оружие">
            Найдите свои единицы во вкладке «Справочник» и закрепите их за собой
          </EmptyState>
        ) : (
          <div className="list">
            {mine.map((w) => (
              <div key={w.id} className="list-item">
                <div className="list-text">
                  <div className="item-title">{w.title}</div>
                  <div className="item-hint">
                    <code>{w.number}</code>
                    {owners(w) && ` · также за: ${owners(w)}`}
                  </div>
                </div>
                <button className="secondary-button danger" onClick={() => unassign(w)} disabled={busyId !== null}>
                  {busyId === w.id ? '…' : 'Открепить'}
                </button>
              </div>
            ))}
          </div>
        ))}

      {tab === 'catalog' && (
        <>
          <SearchInput value={query} onChange={setQuery} placeholder="Название или номер — можно с опечатками" />
          {!query.trim() && <p className="sheet-meta">Введите название или номер оружия</p>}
          {query.trim() && found.length === 0 && <p className="sheet-meta">Ничего не найдено</p>}
          {found.length > 0 && (
            <div className="list">
              {found.map((w) => (
                <div key={w.id} className="list-item">
                  <div className="list-text">
                    <div className="item-title">{w.title}</div>
                    <div className="item-hint">
                      <code>{w.number}</code>
                      {owners(w) && ` · закреплено за: ${owners(w)}`}
                    </div>
                  </div>
                  <button className="secondary-button" onClick={() => run('assignWeapon', w)} disabled={busyId !== null}>
                    {busyId === w.id ? '…' : 'Закрепить'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
