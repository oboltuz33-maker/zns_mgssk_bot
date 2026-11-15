import { useState } from 'react';
import { APPLICATION_STATUS } from '../data/model.js';
import { STATUS_ACTION_LABEL, exportApplications, inEkpPeriod, nextStatuses, setApplicationStatus } from '../data/admin.js';
import { withApplicationRow } from '../data/patches.js';
import { fuzzySearch } from '../data/search.js';
import { ApplicationCard, CardsOrTable, Chips, DataStatus, EmptyState, ListToolbar, PageHeader, SearchInput } from '../components.jsx';
import { APPLICATION_CARD_HEIGHT, confirmAction, useListView } from '../helpers.js';
import { ADMIN_APPLICATION_COLUMNS } from '../listColumns.jsx';
import { SHOW_EXCEL_EXPORT } from '../config.js';
import { AdminAthletes } from './AdminAthletes.jsx';
import { AdminCompetitions } from './AdminCompetitions.jsx';
import { AdminWeapons } from './AdminWeapons.jsx';

// Вкладки раздела. Открыть сразу нужную: onOpenPage('admin', { tab: 'athletes' }) — так формы возвращают обратно
const TABS = [
  { value: 'applications', label: 'Заявки', component: AdminApplications },
  { value: 'athletes', label: 'Спортсмены', component: AdminAthletes },
  { value: 'competitions', label: 'Соревнования', component: AdminCompetitions },
  { value: 'weapons', label: 'Оружие', component: AdminWeapons },
];

// Раздел «Администрирование» — только администраторам (в меню он виден только им; права проверяет и Apps Script)
export function AdminPage(props) {
  const [tab, setTab] = useState(() => (TABS.some((t) => t.value === props.params?.tab) ? props.params.tab : TABS[0].value));
  if (!props.me?.isAdmin) return <EmptyState icon="🛠" title="Раздел только для администраторов" />;
  const Tab = TABS.find((t) => t.value === tab).component;

  return (
    <>
      <PageHeader title="Администрирование" />
      <DataStatus sheets={props.sheets} />
      <Chips options={TABS} value={tab} onChange={setTab} />
      <Tab {...props} />
    </>
  );
}

// Фильтр по статусу: «Все» и статусы, которые есть в заявках (основные — всегда, даже без заявок)
const MAIN_STATUSES = [APPLICATION_STATUS.new, APPLICATION_STATUS.inProgress, APPLICATION_STATUS.done, APPLICATION_STATUS.rejected];
const ALL = '';

const tg = () => window.Telegram?.WebApp;

function AdminApplications({ model, sheets, onOpenPage, onMessage }) {
  const [status, setStatus] = useState(APPLICATION_STATUS.new);
  const [query, setQuery] = useState('');
  // Период по срокам ЕКП — «гггг-мм-дд» или пусто; им же отбирается выгрузка
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(null); // № заявки, статус которой сейчас меняется
  const [rejecting, setRejecting] = useState(null); // { number, reason } — открыта форма отклонения
  const [exporting, setExporting] = useState(false);

  const inPeriod = model.applications.filter((a) => inEkpPeriod(a, from, to));
  const statuses = [...MAIN_STATUSES, ...new Set(inPeriod.map((a) => a.status).filter((s) => s && !MAIN_STATUSES.includes(s)))];
  const byStatus = status === ALL ? inPeriod : inPeriod.filter((a) => a.status === status);
  // Поиск с опечатками, в другой раскладке и транслитом — и по ФИО перевозчика
  const list = fuzzySearch(byStatus, query, (a) =>
    [a.number, a.fullName, a.competitionTitle, a.ekpNumber, a.address, ...a.weaponLines, ...a.transportList].join(' '),
  );
  // Лентой карточек или таблицей — выбор запоминается на устройстве
  const listView = useListView('admin-applications', ADMIN_APPLICATION_COLUMNS);

  const change = async (application, next, reason) => {
    if (next !== APPLICATION_STATUS.rejected) {
      const ok = await confirmAction(`Заявка № ${application.number}: перевести в «${next}»? Автору придёт сообщение.`);
      if (!ok) return;
    }
    setBusy(application.number);
    try {
      const result = await setApplicationStatus({ number: application.number, from: application.status, status: next, reason });
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось изменить статус');
      // Строка из ответа скрипта — сразу в списке, таблицу целиком не перекачиваем
      sheets.patch((data) => withApplicationRow(data, result.row));
      setRejecting(null);
      tg()?.HapticFeedback?.notificationOccurred('success');
    } catch (e) {
      console.error(e);
      onMessage(e.message || 'Ошибка сети');
    } finally {
      setBusy(null);
    }
  };

  const runExport = async () => {
    setExporting(true);
    try {
      const result = await exportApplications({ from, to });
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось выгрузить заявки');
      onMessage(result.message);
    } catch (e) {
      console.error(e);
      onMessage(e.message || 'Ошибка сети');
    } finally {
      setExporting(false);
    }
  };

  const dateField = (label, value, onChange) => (
    <label className="form-field">
      <span>{label}</span>
      <input className="sheet-search" type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );

  return (
    <>
      <div className="card item-card">
        <div className="section-label">Период по срокам ЕКП</div>
        <div className="period-fields">
          {dateField('С', from, setFrom)}
          {dateField('По', to, setTo)}
        </div>
        <div className="card-actions">
          {SHOW_EXCEL_EXPORT && (
            <button className="primary-button" onClick={runExport} disabled={exporting || !inPeriod.length}>
              {exporting ? 'Готовим файл…' : `📥 Выгрузить в Excel (${inPeriod.length})`}
            </button>
          )}
          {(from || to) && (
            <button
              className="secondary-button"
              onClick={() => {
                setFrom('');
                setTo('');
              }}
            >
              Сбросить период
            </button>
          )}
        </div>
        <div className="item-hint">
          {SHOW_EXCEL_EXPORT && 'В файл попадают все заявки за период, независимо от статуса. Бот пришлёт его в чат. '}
          {(from || to) && 'Заявки без дат по ЕКП в период не входят.'}
        </div>
      </div>

      <Chips
        options={[
          { value: ALL, label: 'Все', count: inPeriod.length },
          ...statuses.map((s) => ({ value: s, label: s, count: inPeriod.filter((a) => a.status === s).length })),
        ]}
        value={status}
        onChange={setStatus}
      />
      {byStatus.length > 0 && (
        <ListToolbar listView={listView}>
          <SearchInput value={query} onChange={setQuery} placeholder="№, ФИО, оружие, соревнование" />
        </ListToolbar>
      )}
      {list.length === 0 && <EmptyState icon="📝" title={byStatus.length ? 'Ничего не найдено' : 'Заявок нет'} />}

      <CardsOrTable
        listView={listView}
        items={list}
        source={model.applications}
        rowKey={(a) => a.number}
        cardHeight={APPLICATION_CARD_HEIGHT}
        resetKey={[status, query, from, to].join('|')}
        renderCard={(a) => (
          <ApplicationCard key={a.number} application={a} showAuthor>
            {rejecting?.number === a.number ? (
              <div className="reject-form">
                <label className="form-field">
                  <span>Причина отклонения *</span>
                  <textarea
                    className="sheet-search"
                    value={rejecting.reason}
                    maxLength={500}
                    autoFocus
                    onChange={(e) => setRejecting({ ...rejecting, reason: e.target.value })}
                  />
                </label>
                <div className="card-actions">
                  <button
                    className="secondary-button danger"
                    disabled={busy === a.number || !rejecting.reason.trim()}
                    onClick={() => change(a, APPLICATION_STATUS.rejected, rejecting.reason)}
                  >
                    {busy === a.number ? 'Сохраняем…' : '⛔ Отклонить'}
                  </button>
                  <button className="secondary-button" disabled={busy === a.number} onClick={() => setRejecting(null)}>
                    Отмена
                  </button>
                </div>
                <div className="item-hint">Причину увидит автор заявки в сообщении бота</div>
              </div>
            ) : (
              <div className="card-actions">
                {nextStatuses(a).map((next) => (
                  <button
                    key={next}
                    className={next === APPLICATION_STATUS.rejected ? 'secondary-button danger' : 'secondary-button'}
                    disabled={busy !== null}
                    onClick={() =>
                      next === APPLICATION_STATUS.rejected ? setRejecting({ number: a.number, reason: '' }) : change(a, next)
                    }
                  >
                    {busy === a.number ? '…' : STATUS_ACTION_LABEL[next]}
                  </button>
                ))}
                <button
                  className="secondary-button"
                  disabled={busy !== null}
                  onClick={() => onOpenPage('admin-application', { number: a.number })}
                >
                  ✏️ Изменить
                </button>
              </div>
            )}
          </ApplicationCard>
        )}
      />
    </>
  );
}
