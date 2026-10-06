import { useState } from 'react';
import { APPLICATION_STATUS, findMyAthlete } from '../data/model.js';
import { deleteApplication } from '../data/applications.js';
import { Badge, EmptyState, PageHeader, SearchInput, ShowMore, confirmAction, formatDateTime, formatRange, usePaged } from '../components.jsx';
import { fuzzySearch } from '../data/search.js';

const STATUS_TONE = {
  [APPLICATION_STATUS.new]: 'accent',
  [APPLICATION_STATUS.inProgress]: 'warning',
  [APPLICATION_STATUS.done]: 'success',
  [APPLICATION_STATUS.archived]: 'muted',
};

export function ApplicationsPage({ model, user, sheets, onOpenPage, onMessage }) {
  // Показываем только заявки текущего спортсмена (CreatedBy = его ID; отбор делает и Apps Script)
  const me = findMyAthlete(model, user);
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState(null);

  const mine = me ? model.applications.filter((a) => a.createdById === me.id) : [];
  // Поиск с опечатками, в другой раскладке и транслитом
  const list = fuzzySearch(mine, query, (a) =>
    [a.number, a.competitionTitle, a.ekpNumber, a.address, a.status, ...a.weaponLines, ...a.transportList].join(' '),
  );
  // Порциями по экрану (карточка заявки ~280px)
  const paged = usePaged(list, 280, query);

  const remove = async (application) => {
    const ok = await confirmAction(`Удалить заявку № ${application.number}? Она будет перенесена в архив.`);
    if (!ok) return;
    setDeleting(application.number);
    try {
      const result = await deleteApplication(application.number);
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось удалить заявку');
      await sheets.refresh();
      onMessage(`Заявка № ${application.number} удалена`);
    } catch (e) {
      console.error(e);
      onMessage(e.message || 'Ошибка сети');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <PageHeader title="Мои заявки" subtitle={me ? `${me.fullName} · всего: ${mine.length}` : undefined} />

      {!me ? (
        <EmptyState icon="👤" title="Спортсмен не определён">
          {user
            ? <>Укажите в листе «Спортсмены» ChatId <code>{user.id}</code>, чтобы видеть свои заявки</>
            : 'Откройте приложение из Telegram, чтобы видеть свои заявки'}
        </EmptyState>
      ) : !me.isCarrier ? (
        <EmptyState icon="🚚" title="Создавать заявки могут только перевозчики" />
      ) : (
        <>
          <button className="primary-button wide-button" onClick={() => onOpenPage('application-form', {})}>
            ＋ Новая заявка
          </button>

          {mine.length === 0 ? (
            <EmptyState icon="📝" title="Заявок пока нет">
              Здесь появятся ваши заявки на перевозку оружия к соревнованиям
            </EmptyState>
          ) : (
            <SearchInput value={query} onChange={setQuery} placeholder="№, оружие, соревнование" />
          )}
          {mine.length > 0 && list.length === 0 && <EmptyState icon="📝" title="Ничего не найдено" />}

          {paged.visible.map((a, i) => (
            <div key={a.number || i} className="card item-card">
              <div className="item-head">
                <div className="item-title">
                  {a.number && `№ ${a.number} · `}
                  {a.competitionTitle}
                </div>
                {a.status && <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</Badge>}
              </div>
              {a.ekpStart && <div className="item-row">📅 По ЕКП: {formatRange(a.ekpStart, a.ekpEnd)}</div>}
              {a.address && <div className="item-row">📍 {a.address}</div>}
              {a.weaponLines.length > 0 && (
                <ul className="sub-list">
                  {a.weaponLines.map((l) => (
                    <li key={l}>🎯 {l}</li>
                  ))}
                </ul>
              )}
              <div className="item-row">
                🚚 {formatRange(a.transportStart, a.transportEnd)}
                {a.transportList.length > 0 && ` · ${a.transportList.join(', ')}`}
              </div>
              <div className="item-tags">
                {a.competitionKind && <Badge>{a.competitionKind}</Badge>}
                {a.ekpNumber && <Badge>ЕКП № {a.ekpNumber}</Badge>}
              </div>
              {a.createdAt && <div className="item-hint">Создана {formatDateTime(a.createdAt)}</div>}

              {/* Менять и удалять можно, пока оформитель не взял заявку в работу */}
              {a.canEdit && (
                <div className="card-actions">
                  <button
                    className="secondary-button"
                    onClick={() => onOpenPage('application-form', { number: a.number })}
                    disabled={deleting === a.number}
                  >
                    ✏️ Изменить
                  </button>
                  <button className="secondary-button danger" onClick={() => remove(a)} disabled={deleting === a.number}>
                    {deleting === a.number ? 'Удаляем…' : '🗑 Удалить'}
                  </button>
                </div>
              )}
            </div>
          ))}
          <ShowMore paged={paged} />
        </>
      )}
    </>
  );
}
