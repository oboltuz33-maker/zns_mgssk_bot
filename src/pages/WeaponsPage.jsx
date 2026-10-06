import { useState } from 'react';
import { findMyAthlete } from '../data/model.js';
import { postAction } from '../data/api.js';
import { fuzzySearch } from '../data/search.js';
import { Chips, EmptyState, PageHeader, SearchInput, ShowMore, confirmAction, usePaged } from '../components.jsx';

// Примерная высота строки списка — по ней считается, сколько строк помещается на экран
const ROW_HEIGHT = 64;

// Раздел «Оружие»: вкладка «Закреплённое» — своё оружие (можно открепить),
// вкладка «Справочник» — общий справочник без своего, с поиском (можно закрепить за собой).
// Оба списка показываются порциями по экрану с кнопкой «Показать ещё»
export function WeaponsPage({ model, user, sheets, onMessage }) {
  const me = findMyAthlete(model, user);
  const [tab, setTab] = useState('mine');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);

  const mine = me?.weapons ?? [];
  const catalog = model.weapons.filter((w) => !mine.includes(w));
  // Поиск с опечатками, в другой раскладке и транслитом; без запроса — весь справочник
  const found = fuzzySearch(catalog, query, (w) => `${w.title} ${w.number}`);
  const pagedMine = usePaged(mine, ROW_HEIGHT);
  const pagedFound = usePaged(found, ROW_HEIGHT, query);

  if (!me) return <EmptyState icon="🎯" title="Спортсмен не определён" />;

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
          <>
            <div className="list">
              {pagedMine.visible.map((w) => (
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
            <ShowMore paged={pagedMine} />
          </>
        ))}

      {tab === 'catalog' && (
        <>
          <SearchInput value={query} onChange={setQuery} placeholder="Название или номер — можно с опечатками" />
          {found.length === 0 && <p className="sheet-meta">{query.trim() ? 'Ничего не найдено' : 'Справочник пуст'}</p>}
          {found.length > 0 && (
            <div className="list">
              {pagedFound.visible.map((w) => (
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
          <ShowMore paged={pagedFound} />
        </>
      )}
    </>
  );
}
