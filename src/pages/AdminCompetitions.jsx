import { useRef, useState } from 'react';
import { SHEET } from '../config.js';
import { competitionDraft, competitionProblem, saveCompetition } from '../data/admin.js';
import { isUpcomingCompetition } from '../data/model.js';
import { newRequestId } from '../data/network.js';
import { withSheetRow } from '../data/patches.js';
import { fuzzySearch } from '../data/search.js';
import { Badge, CardsOrTable, Chips, EmptyState, FormFooter, ListToolbar, PageHeader, SearchInput } from '../components.jsx';
import {
  COMPETITION_CARD_HEIGHT,
  competitionSearchText,
  formatCompetitionDates,
  useListView,
  useTelegramBackButton,
} from '../helpers.js';
import { COMPETITION_COLUMNS } from '../listColumns.jsx';

const UPCOMING = 'upcoming';
const PAST = 'past';
const ALL = 'all';

// Вкладка «Соревнования»: все соревнования листа (прошедшие остаются в нём — перевозчикам приложение их не показывает),
// создание и правка. Удаления нет
export function AdminCompetitions({ model, onOpenPage }) {
  const [filter, setFilter] = useState(UPCOMING);
  const [query, setQuery] = useState('');

  const upcoming = model.competitions.filter((c) => isUpcomingCompetition(c));
  const past = model.competitions.filter((c) => !isUpcomingCompetition(c)).reverse(); // недавние — первыми
  const shown = { [UPCOMING]: upcoming, [PAST]: past, [ALL]: model.competitions }[filter];
  const list = fuzzySearch(shown, query, competitionSearchText);
  const listView = useListView('admin-competitions', COMPETITION_COLUMNS);

  return (
    <>
      <button className="primary-button wide-button" onClick={() => onOpenPage('admin-competition', {})}>
        ＋ Новое соревнование
      </button>
      <Chips
        options={[
          { value: UPCOMING, label: 'Предстоящие', count: upcoming.length },
          { value: PAST, label: 'Прошедшие', count: past.length },
          { value: ALL, label: 'Все', count: model.competitions.length },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {shown.length > 0 && (
        <ListToolbar listView={listView}>
          <SearchInput value={query} onChange={setQuery} placeholder="Название, вид, адрес, № ЕКП" />
        </ListToolbar>
      )}
      {list.length === 0 && <EmptyState icon="🏆" title={shown.length ? 'Ничего не найдено' : 'Соревнований нет'} />}

      <CardsOrTable
        listView={listView}
        items={list}
        source={model.competitions}
        rowKey={(c) => c.id}
        cardHeight={COMPETITION_CARD_HEIGHT}
        resetKey={filter + query}
        renderCard={(c) => (
          <div key={c.id} className="card item-card">
            <div className="item-title">{c.title}</div>
            <div className="item-row">📅 {formatCompetitionDates(c)}</div>
            {c.address && <div className="item-row">📍 {c.address}</div>}
            <div className="item-tags">
              {c.kind && <Badge>{c.kind}</Badge>}
              {c.ekpNumber && <Badge>ЕКП № {c.ekpNumber}</Badge>}
              {c.oneDay && <Badge tone="accent">Выезд одним днём</Badge>}
            </div>
            <div className="card-actions">
              <button className="secondary-button" onClick={() => onOpenPage('admin-competition', { id: c.id })}>
                ✏️ Изменить
              </button>
            </div>
          </div>
        )}
      />
    </>
  );
}

// Создание (params без id) или правка соревнования. params: { id? }
export function AdminCompetitionForm({ model, me, sheets, params, onOpenPage, onMessage }) {
  const back = () => onOpenPage('admin', { tab: 'competitions' });
  useTelegramBackButton(back);
  const competition = params.id ? model.competitions.find((c) => c.id === params.id) : null;
  const [draft, setDraft] = useState(() => competitionDraft(competition));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [attempted, setAttempted] = useState(false);
  // Повтор после ошибки связи сервер узнает по requestId и не создаст второе соревнование; после правки — новый запрос
  const requestId = useRef(null);

  if (!me?.isAdmin) return <EmptyState icon="🛠" title="Раздел только для администраторов" />;
  if (params.id && !competition) {
    return (
      <EmptyState icon="🏆" title="Соревнование не найдено">
        Возможно, его уже перенесли в архив
      </EmptyState>
    );
  }

  const problem = competitionProblem(draft);
  // Виды соревнований, которые уже встречаются, — подсказки при вводе (вид — свободный текст)
  const kinds = [...new Set(model.competitions.map((c) => c.kind).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));

  const update = (key, value) => {
    requestId.current = null;
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const save = async () => {
    if (problem) return setAttempted(true);
    setBusy(true);
    setError(null);
    requestId.current ??= newRequestId();
    try {
      const result = await saveCompetition(draft, requestId.current);
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось сохранить');
      sheets.patch((data) => withSheetRow(data, SHEET.competitions, result.row));
      tg()?.HapticFeedback?.notificationOccurred('success');
      onMessage(
        (result.created ? 'Соревнование добавлено' : 'Соревнование сохранено') +
          (result.notified ? '. Перевозчикам отправлена рассылка' : ''),
      );
      back();
    } catch (e) {
      console.error(e);
      setError(e.message || 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  };

  const field = (key, label, { type = 'text', required = false, maxLength = 200, list } = {}) => (
    <label className="form-field">
      <span>
        {label}
        {required && ' *'}
      </span>
      <input
        className={attempted && required && !draft[key].trim() ? 'sheet-search invalid' : 'sheet-search'}
        type={type}
        value={draft[key]}
        maxLength={maxLength}
        list={list}
        autoComplete="off"
        onChange={(e) => update(key, e.target.value)}
      />
    </label>
  );

  return (
    <>
      <PageHeader title={competition ? 'Соревнование' : 'Новое соревнование'} subtitle={competition?.title} />
      <div className="card item-card">
        {field('title', 'Название', { required: true })}
        {field('kind', 'Вид соревнования', { list: 'competition-kinds' })}
        <datalist id="competition-kinds">
          {kinds.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
        {field('ekpNumber', 'Номер из ЕКП', { maxLength: 100 })}
        <div className="period-fields">
          {field('start', 'Дата начала', { type: 'date' })}
          {field('end', 'Дата завершения', { type: 'date' })}
        </div>
        {field('address', 'Адрес', { maxLength: 300 })}
        <label className="switch-row">
          <span>Выезд одним днём</span>
          <input type="checkbox" className="switch" checked={draft.oneDay} onChange={() => update('oneDay', !draft.oneDay)} />
        </label>
        {draft.oneDay && (
          <div className={attempted && !draft.start ? 'invalid-text' : 'item-hint'}>
            Перевозчик выберет в заявке день перевозки из периода соревнования — он запишется в сроки перевозки
          </div>
        )}
      </div>
      <div className="item-hint">
        {competition
          ? 'Поданные заявки не меняются — в них данные соревнования записаны текстом. Исправить их можно в разделе «Заявки».'
          : 'Когда заполнены название, даты и адрес, перевозчикам уйдёт рассылка о новом соревновании.'}
      </div>

      <FormFooter error={error} problem={problem} attempted={attempted} busy={busy} onCancel={back} onSave={save} />
    </>
  );
}

const tg = () => window.Telegram?.WebApp;
