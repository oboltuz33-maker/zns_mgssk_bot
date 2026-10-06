import { useState } from 'react';
import { competitionStatus, findMyAthlete } from '../data/model.js';
import { applicationsForCompetition } from '../data/applications.js';
import { Badge, Chips, EmptyState, PageHeader, SearchInput, formatRange, matches } from '../components.jsx';

const STATUS_BADGE = {
  upcoming: { tone: 'accent', label: 'Предстоит' },
  ongoing: { tone: 'success', label: 'Идёт сейчас' },
  past: { tone: 'muted', label: 'Завершено' },
};

const daysUntil = (date) => Math.ceil((date - new Date()) / 86_400_000);

// onApply — кнопка «Подать заявку» (передаётся только перевозчикам).
// existing — уже поданные заявки перевозчика на это соревнование: вместо «Подать заявку» показываются они
export function CompetitionCard({ competition, onApply, existing = [], onOpenApplications }) {
  const status = competitionStatus(competition);
  const badge = STATUS_BADGE[status];
  const days = status === 'upcoming' && competition.start ? daysUntil(competition.start) : null;

  return (
    <div className={status === 'past' ? 'card item-card is-past' : 'card item-card'}>
      <div className="item-head">
        <div className="item-title">{competition.title}</div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      <div className="item-row">📅 {formatRange(competition.start, competition.end)}
        {days !== null && <span className="item-hint"> · через {days} дн.</span>}
      </div>
      {competition.address && <div className="item-row">📍 {competition.address}</div>}
      <div className="item-tags">
        {competition.kind && <Badge>{competition.kind}</Badge>}
        {competition.ekpNumber && <Badge>ЕКП № {competition.ekpNumber}</Badge>}
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
        onApply &&
        status !== 'past' && (
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

export function CompetitionsPage({ model, user, onOpenPage }) {
  const me = findMyAthlete(model, user);
  const onApply = me?.isCarrier ? (c) => onOpenPage('application-form', { competitionId: c.id }) : undefined;
  const [filter, setFilter] = useState('active');
  const [query, setQuery] = useState('');

  const isActive = (c) => competitionStatus(c) !== 'past';
  const groups = {
    active: model.competitions.filter(isActive),
    past: model.competitions.filter((c) => !isActive(c)).reverse(),
    all: model.competitions,
  };
  const list = groups[filter].filter((c) => matches(query, c.title, c.kind, c.address, c.ekpNumber));

  return (
    <>
      <PageHeader title="Соревнования" subtitle={`Всего: ${model.competitions.length}`} />
      <Chips
        options={[
          { value: 'active', label: 'Предстоящие', count: groups.active.length },
          { value: 'past', label: 'Прошедшие', count: groups.past.length },
          { value: 'all', label: 'Все', count: groups.all.length },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <SearchInput value={query} onChange={setQuery} placeholder="Название, вид, адрес, № ЕКП" />

      {list.length === 0 ? (
        <EmptyState icon="🏆" title="Ничего не найдено" />
      ) : (
        list.map((c) => (
          <CompetitionCard
            key={c.id}
            competition={c}
            onApply={onApply}
            existing={applicationsForCompetition(model, c, me)}
            onOpenApplications={() => onOpenPage('applications')}
          />
        ))
      )}
    </>
  );
}
