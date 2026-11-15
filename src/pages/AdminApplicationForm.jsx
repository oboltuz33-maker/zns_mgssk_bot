import { useRef, useState } from 'react';
import { adminDraft, adminDraftProblem, saveApplicationAsAdmin, withCompetition } from '../data/admin.js';
import { withApplicationRow } from '../data/patches.js';
import { newRequestId } from '../data/network.js';
import { fuzzySearch } from '../data/search.js';
import { Badge, EmptyState, FormFooter, PageHeader, SearchInput, ShowMore, StatusBadge } from '../components.jsx';
import {
  COMPETITION_CARD_HEIGHT,
  competitionSearchText,
  formatCompetitionDates,
  formatRange,
  usePaged,
  useTelegramBackButton,
} from '../helpers.js';
import { ParticipantsStep } from './ApplicationWizard.jsx';

const tg = () => window.Telegram?.WebApp;

// Правка заявки администратором (исправление ошибок): участники и оружие, транспорт, соревнование, сроки перевозки,
// адрес — на одном экране. ФИО (автор) и статус здесь не меняются; статус — кнопками в списке заявок.
// params: { number }
export function AdminApplicationForm({ model, me, params, sheets, onOpenPage, onMessage }) {
  const application = model.applications.find((a) => a.number === String(params.number));
  const [initial] = useState(() => (application ? adminDraft(model, application) : null));
  const [draft, setDraft] = useState(initial?.draft);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [attempted, setAttempted] = useState(false);
  // Повторное нажатие после ошибки связи сервер узнает по requestId; после правки черновика — новый запрос
  const requestId = useRef(null);

  // Страница без нижнего меню (кнопки сохранения внизу экрана) — кнопка «Назад» Telegram ведёт в список заявок
  useTelegramBackButton(() => onOpenPage('admin'));

  if (!me?.isAdmin) return <EmptyState icon="🛠" title="Раздел только для администраторов" />;
  if (!application || !draft) {
    return (
      <EmptyState icon="📝" title={`Заявка № ${params.number} не найдена`}>
        Возможно, её уже перенесли в архив
      </EmptyState>
    );
  }

  const author = model.athletes.find((a) => a.id === application.createdById) ?? null;
  const competition = model.competitions.find((c) => c.id === draft.competitionId);
  const problem = adminDraftProblem(draft, model);

  const update = (changes) => {
    requestId.current = null;
    setDraft((d) => ({ ...d, ...changes }));
  };

  const save = async () => {
    if (problem) {
      setAttempted(true);
      requestAnimationFrame(() => document.querySelector('.invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
      return;
    }
    setBusy(true);
    setError(null);
    requestId.current ??= newRequestId();
    try {
      const result = await saveApplicationAsAdmin(draft, requestId.current);
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось сохранить заявку');
      sheets.patch((data) => withApplicationRow(data, result.row));
      tg()?.HapticFeedback?.notificationOccurred('success');
      onMessage(`Заявка № ${result.number} сохранена`);
      onOpenPage('admin');
    } catch (e) {
      console.error(e);
      setError(e.message || 'Ошибка сети');
      tg()?.HapticFeedback?.notificationOccurred('error');
    } finally {
      setBusy(false);
    }
  };

  const toggleTransport = (name) =>
    update({ transport: draft.transport.includes(name) ? draft.transport.filter((t) => t !== name) : [...draft.transport, name] });

  const dateField = (label, key) => (
    <label className="form-field">
      <span>{label}</span>
      <input className="sheet-search" type="date" value={draft[key]} onChange={(e) => update({ [key]: e.target.value })} />
    </label>
  );

  return (
    <>
      <PageHeader title={`Заявка № ${application.number}`} subtitle={application.fullName} />
      <div className="item-tags">
        <StatusBadge status={application.status} />
      </div>

      {initial.problems.length > 0 && (
        <div className="card wizard-warning">
          <b>Часть заявки не распознана — выберите заново:</b>
          <ul className="sub-list">
            {initial.problems.map((p) => (
              <li key={p}>⚠️ {p}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card item-card">
        <div className="item-head">
          <div className="section-label">Соревнование</div>
          <button className="link-button" onClick={() => setPicking(true)}>
            Выбрать другое
          </button>
        </div>
        {competition ? (
          <>
            <div className="item-title">{competition.title}</div>
            <div className="item-row">📅 {formatCompetitionDates(competition)}</div>
            <div className="item-tags">
              {competition.kind && <Badge>{competition.kind}</Badge>}
              {competition.ekpNumber && <Badge>ЕКП № {competition.ekpNumber}</Badge>}
            </div>
            <div className="item-hint">Название, вид, № и сроки по ЕКП запишутся из справочника соревнований</div>
          </>
        ) : (
          <>
            <div className="item-title">{application.competitionTitle}</div>
            {application.ekpStart && <div className="item-row">📅 По ЕКП: {formatRange(application.ekpStart, application.ekpEnd)}</div>}
            <div className="item-tags">
              {application.competitionKind && <Badge>{application.competitionKind}</Badge>}
              {application.ekpNumber && <Badge>ЕКП № {application.ekpNumber}</Badge>}
            </div>
            <div className="item-hint">Как записано в заявке. Чтобы обновить из справочника — «Выбрать другое»</div>
          </>
        )}
      </div>

      <ParticipantsStep
        draft={draft}
        model={model}
        me={author}
        update={update}
        showErrors={attempted}
        recentLabel="Был в заявках автора"
      />

      <div className={attempted && !draft.transport.length ? 'card item-card invalid' : 'card item-card'}>
        <div className="section-label">Транспорт</div>
        <div className="item-tags">
          {/* Вид транспорта из заявки, которого уже нет в справочнике, не показывается — его нужно выбрать заново */}
          {model.transportTypes.map((t) => (
            <button key={t} className={draft.transport.includes(t) ? 'sheet-tab active' : 'sheet-tab'} onClick={() => toggleTransport(t)}>
              {draft.transport.includes(t) && '✓ '}
              {t}
            </button>
          ))}
        </div>
        <div className="period-fields">
          {dateField('Перевозка: начало', 'transportStart')}
          {dateField('Окончание', 'transportEnd')}
        </div>
      </div>

      <div className="card item-card">
        <label className="form-field">
          <span>Адрес</span>
          <input className="sheet-search" value={draft.address} maxLength={300} onChange={(e) => update({ address: e.target.value })} />
        </label>
      </div>

      <FormFooter
        error={error}
        problem={problem}
        attempted={attempted}
        busy={busy}
        onCancel={() => onOpenPage('admin')}
        onSave={save}
      />

      {picking && (
        <CompetitionPicker
          competitions={model.competitions}
          onPick={(c) => {
            update(withCompetition(draft, c));
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

// Выбор соревнования поверх экрана: все соревнования основного листа (и прошедшие — это исправление ошибок)
function CompetitionPicker({ competitions, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const found = fuzzySearch(competitions, query, competitionSearchText);
  const paged = usePaged(found, COMPETITION_CARD_HEIGHT, query);

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <div className="item-head">
          <div className="item-title">Соревнование</div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="Название, город, № ЕКП" />
        <div className="item-hint">Сроки перевозки и адрес заполнятся по выбранному соревнованию</div>
        {found.length === 0 && <p className="sheet-meta">{query.trim() ? 'Ничего не найдено' : 'Список соревнований пуст'}</p>}
        <div className="list">
          {paged.visible.map((c) => (
            <button key={c.id} className="list-item choice-row" onClick={() => onPick(c)}>
              <div className="list-text">
                <div className="item-title">{c.title}</div>
                <div className="item-hint">
                  📅 {formatCompetitionDates(c)}
                  {c.ekpNumber && ` · ЕКП № ${c.ekpNumber}`}
                  {c.address && ` · ${c.address}`}
                </div>
              </div>
            </button>
          ))}
        </div>
        <ShowMore paged={paged} />
      </div>
    </div>
  );
}
