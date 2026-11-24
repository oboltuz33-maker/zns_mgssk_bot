import { useState } from 'react';
import { isUpcomingCompetition, moscowDay } from '../data/model.js';
import { applicationsForCompetition } from '../data/applications.js';
import { Badge, CardsOrTable, EmptyState, ListToolbar, PageHeader, SearchInput } from '../components.jsx';
import { COMPETITION_CARD_HEIGHT, competitionSearchText, formatCompetitionDates, useListView } from '../helpers.js';
import { fuzzySearch } from '../data/search.js';
import { COMPETITION_COLUMNS } from '../listColumns.jsx';

// Номер дня по московскому календарю — чтобы считать «через сколько дней» без влияния часового пояса телефона
const dayNumber = (date) => Math.round(Date.parse(moscowDay(date)) / 86_400_000);

const untilText = (start) => {
  const days = dayNumber(start) - dayNumber(new Date());
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return `через ${days} дн.`;
};

// onApply — кнопка «Подать заявку» (передаётся только перевозчикам).
// existing — уже поданные заявки перевозчика на это соревнование: вместо «Подать заявку» показываются они
function CompetitionCard({ competition, onApply, existing = [], onOpenApplications }) {
  return (
    <div className="card item-card">
      <div className="item-title">{competition.title}</div>
      <div className="item-row">
        📅 {formatCompetitionDates(competition)}
        {competition.start && <span className="item-hint"> · {untilText(competition.start)}</span>}
      </div>
      {competition.address && <div className="item-row">📍 {competition.address}</div>}
      <div className="item-tags">
        {competition.kind && <Badge>{competition.kind}</Badge>}
        {competition.ekpNumber && <Badge>ЕКП № {competition.ekpNumber}</Badge>}
        {competition.oneDay && <Badge tone="accent">Выезд одним днём</Badge>}
      </div>
      {existing.length > 0 ? (
        <div className="card-actions">
          {existing.map((a) => (
            <button key={a.number} className="secondary-button" onClick={onOpenApplications}>
              📝 Заявка № {a.number} · {a.status}
            </button>
          ))}
        </div>
      ) : (
        onApply && (
          <div className="card-actions">
            <button className="primary-button" onClick={() => onApply(competition)}>
              📝 Подать заявку
            </button>
          </div>
        )
      )}
    </div>
  );
}

// Раздел «Соревнования»: только предстоящие — Apps Script других не отдаёт (прошедшие переносятся в архив),
// а здесь они дополнительно отсеиваются на случай данных, сохранённых на устройстве до начала соревнования
export function CompetitionsPage({ model, me, onOpenPage }) {
  const onApply = me?.isCarrier ? (c) => onOpenPage('application-form', { competitionId: c.id }) : undefined;
  const [query, setQuery] = useState('');

  const upcoming = model.competitions.filter((c) => isUpcomingCompetition(c));
  // Поиск с опечатками, в другой раскладке и транслитом
  const list = fuzzySearch(upcoming, query, competitionSearchText);
  // Лентой карточек (порциями по экрану) или таблицей — выбор запоминается на устройстве
  const listView = useListView('competitions', COMPETITION_COLUMNS);

  return (
    <>
      <PageHeader title="Соревнования" subtitle={`Предстоящих: ${upcoming.length}`} />
      {upcoming.length > 0 && (
        <ListToolbar listView={listView}>
          <SearchInput value={query} onChange={setQuery} placeholder="Название, вид, адрес, № ЕКП" />
        </ListToolbar>
      )}

      {list.length === 0 ? (
        <EmptyState icon="🏆" title={upcoming.length ? 'Ничего не найдено' : 'Нет предстоящих соревнований'} />
      ) : (
        <CardsOrTable
          listView={listView}
          items={list}
          rowKey={(c) => c.id}
          cardHeight={COMPETITION_CARD_HEIGHT}
          resetKey={query}
          renderCard={(c) => (
            <CompetitionCard
              key={c.id}
              competition={c}
              onApply={onApply}
              existing={applicationsForCompetition(model, c, me)}
              onOpenApplications={() => onOpenPage('applications')}
            />
          )}
        />
      )}
    </>
  );
}
