import { useState } from 'react';
import { isUpcomingCompetition } from '../data/model.js';
import { deleteApplication } from '../data/applications.js';
import { withoutApplication } from '../data/patches.js';
import { ApplicationCard, CardsOrTable, EmptyState, ListToolbar, PageHeader, SearchInput } from '../components.jsx';
import { APPLICATION_CARD_HEIGHT, confirmAction, useListView } from '../helpers.js';
import { fuzzySearch } from '../data/search.js';
import { MY_APPLICATION_COLUMNS } from '../listColumns.jsx';

export function ApplicationsPage({ model, me, sheets, onOpenPage, onMessage }) {
  // Показываем только заявки текущего спортсмена (CreatedBy = его ID; отбор делает и Apps Script)
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState(null);

  const mine = me ? model.applications.filter((a) => a.createdById === me.id) : [];
  // Поиск с опечатками, в другой раскладке и транслитом
  const list = fuzzySearch(mine, query, (a) =>
    [a.number, a.competitionTitle, a.ekpNumber, a.address, a.status, ...a.weaponLines, ...a.transportList].join(' '),
  );
  // Лентой карточек или таблицей — выбор запоминается на устройстве
  const listView = useListView('my-applications', MY_APPLICATION_COLUMNS);

  const remove = async (application) => {
    const ok = await confirmAction(`Удалить заявку № ${application.number}? Она будет перенесена в архив.`);
    if (!ok) return;
    setDeleting(application.number);
    try {
      const result = await deleteApplication(application.number);
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось удалить заявку');
      // Удалённая заявка сразу пропадает из списка — таблицу целиком не перекачиваем
      sheets.patch((data) => withoutApplication(data, application.number));
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

      {!me?.isCarrier ? (
        <EmptyState icon="🚚" title="Создавать заявки могут только перевозчики">
          Вас могут включить в заявку перевозчики клуба
        </EmptyState>
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
            <ListToolbar listView={listView}>
              <SearchInput value={query} onChange={setQuery} placeholder="№, оружие, соревнование" />
            </ListToolbar>
          )}
          {mine.length > 0 && list.length === 0 && <EmptyState icon="📝" title="Ничего не найдено" />}

          <CardsOrTable
            listView={listView}
            items={list}
            source={mine}
            rowKey={(a) => a.number}
            cardHeight={APPLICATION_CARD_HEIGHT}
            resetKey={query}
            renderCard={(a) => (
              <ApplicationCard key={a.number} application={a}>
                {/* Менять и удалять можно, пока оформитель не взял заявку в работу; менять — пока соревнование
                    не началось (иначе скрипт изменение не примет), удалять — и после */}
                {a.canEdit && (
                  <div className="card-actions">
                    {isUpcomingCompetition({ start: a.ekpStart }) && (
                      <button
                        className="secondary-button"
                        onClick={() => onOpenPage('application-form', { number: a.number })}
                        disabled={deleting === a.number}
                      >
                        ✏️ Изменить
                      </button>
                    )}
                    <button className="secondary-button danger" onClick={() => remove(a)} disabled={deleting === a.number}>
                      {deleting === a.number ? 'Удаляем…' : '🗑 Удалить'}
                    </button>
                  </div>
                )}
              </ApplicationCard>
            )}
          />
        </>
      )}
    </>
  );
}
