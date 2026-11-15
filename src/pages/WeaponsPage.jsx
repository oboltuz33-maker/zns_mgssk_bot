import { useState } from 'react';
import { postAction } from '../data/api.js';
import { withoutWeaponLink } from '../data/patches.js';
import { EmptyState, PageHeader, ShowMore } from '../components.jsx';
import { ROW_HEIGHT, confirmAction, usePaged } from '../helpers.js';

// Раздел «Оружие»: закреплённое за спортсменом оружие (можно открепить от себя). Закрепляет оружие только
// администратор — в разделе «Админ». Список показывается порциями по экрану с кнопкой «Показать ещё»
export function WeaponsPage({ me, sheets, onMessage }) {
  const [busyId, setBusyId] = useState(null);

  const mine = me?.weapons ?? [];
  const paged = usePaged(mine, ROW_HEIGHT);

  if (!me) return <EmptyState icon="🎯" title="Спортсмен не определён" />;

  // Открепить. Изменение применяется на месте — таблицу целиком не перекачиваем
  const unassign = async (weapon) => {
    if (!(await confirmAction(`Открепить ${weapon.title} ${weapon.number}?`))) return;
    setBusyId(weapon.id);
    try {
      const result = await postAction('unassignWeapon', { weaponId: weapon.id });
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось выполнить действие');
      sheets.patch((data) => withoutWeaponLink(data, result.link));
      onMessage(result.message);
    } catch (e) {
      console.error(e);
      onMessage(e.message || 'Ошибка сети');
    } finally {
      setBusyId(null);
    }
  };

  const owners = (weapon) => weapon.owners.filter((o) => o !== me).map((o) => o.shortName).join(', ');

  return (
    <>
      <PageHeader title="Оружие" subtitle={me.fullName} />
      {mine.length === 0 ? (
        <EmptyState icon="🎯" title="За вами пока не закреплено оружие">
          Закрепить оружие может администратор — обратитесь к нему
        </EmptyState>
      ) : (
        <>
          <div className="list">
            {paged.visible.map((w) => (
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
          <ShowMore paged={paged} />
        </>
      )}
    </>
  );
}
