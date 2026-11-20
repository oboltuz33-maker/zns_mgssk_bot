import { useState } from 'react';
import { isUpcomingCompetition } from '../data/model.js';
import { deleteApplication } from '../data/applications.js';
import { withoutApplication } from '../data/patches.js';
import { ApplicationCard, CardsOrTable, EmptyState, ListToolbar, PageHeader, SearchInput } from '../components.jsx';
import { APPLICATION_CARD_HEIGHT, confirmAction, useListView } from '../helpers.js';
import { fuzzySearch } from '../data/search.js';
import { MY_APPLICATION_COLUMNS, PARTICIPANT_APPLICATION_COLUMNS } from '../listColumns.jsx';

const searchText = (a) =>
  [a.number, a.competitionTitle, a.ekpNumber, a.address, a.status, ...a.weaponLines, ...a.transportList].join(' ');

// Заявки других перевозчиков, где спортсмен участник, — только просмотр, с ФИО перевозчика.
// Свои поиск и переключатель «лента / таблица» (выбор запоминается отдельно от «Моих заявок»)
function ParticipantApplications({ applications, title }) {
  const [query, setQuery] = useState('');
  const listView = useListView('participant-applications', PARTICIPANT_APPLICATION_COLUMNS);
  const list = fuzzySearch(applications, query, (a) => [searchText(a), a.fullName].join(' '));
  return (
    <>
      {title && <h2 className="section-title">{title}</h2>}
      <ListToolbar listView={listView}>
        <SearchInput value={query} onChange={setQuery} placeholder="№, перевозчик, соревнование" />
      </ListToolbar>
      {list.length === 0 && <EmptyState icon="🚚" title="Ничего не найдено" />}
      <CardsOrTable
        listView={listView}
        items={list}
        source={applications}
        rowKey={(a) => a.number}
        cardHeight={APPLICATION_CARD_HEIGHT}
        resetKey={query}
        renderCard={(a) => <ApplicationCard key={a.number} application={a} showAuthor />}
      />
    </>
  );
}

export function ApplicationsPage({ model, me, sheets, onOpenPage, onMessage }) {
  // Свои заявки (CreatedBy = ID спортсмена) и заявки, где он участник (столбец «ID участников»); отбор делает и Apps Script.
  // Блоки не пересекаются: своя заявка, где перевозчик ещё и участник, — только в «Моих заявках»
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState(null);

  const mine = me ? model.applications.filter((a) => a.createdById === me.id) : [];
  const participating = me ? model.applications.filter((a) => a.createdById !== me.id && a.participantIds.includes(me.id)) : [];
  // Поиск с опечатками, в другой раскладке и транслитом
  const list = fuzzySearch(mine, query, searchText);
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
      {!me?.isCarrier ? (
        <>
          <PageHeader title="Заявки" subtitle={me ? `${me.fullName} · с моим участием: ${participating.length}` : undefined} />
          {participating.length === 0 ? (
            <EmptyState icon="🚚" title="Вас пока не включили ни в одну заявку">
              Создавать заявки могут только перевозчики — они и включают в них участников
            </EmptyState>
          ) : (
            <ParticipantApplications applications={participating} title="Заявки с моим участием" />
          )}
        </>
      ) : (
        <>
          <PageHeader title="Мои заявки" subtitle={me ? `${me.fullName} · всего: ${mine.length}` : undefined} />
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

          {participating.length > 0 && <ParticipantApplications applications={participating} title="Заявки с моим участием" />}
        </>
      )}
    </>
  );
}
