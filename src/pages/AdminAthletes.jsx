import { useRef, useState } from 'react';
import { SHEET } from '../config.js';
import {
  ATHLETE_LOCKED_COLUMNS,
  ATHLETE_STATUS,
  ATHLETE_STATUSES,
  ATHLETE_YES_NO_COLUMNS,
  assignWeaponTo,
  athleteProblem,
  createAthlete,
  deleteAthlete,
  saveAthlete,
  sameWeapon,
  unassignWeaponFrom,
  yesNoValue,
} from '../data/admin.js';
import { idColumn, moscowDay } from '../data/model.js';
import { newRequestId } from '../data/network.js';
import { withSheetRow, withWeaponLink, withoutAthlete, withoutWeaponLink } from '../data/patches.js';
import { fuzzySearch } from '../data/search.js';
import { Badge, CardsOrTable, Chips, EmptyState, FormFooter, ListToolbar, PageHeader, SearchInput } from '../components.jsx';
import { ROW_HEIGHT, confirmAction, useListView, useTelegramBackButton } from '../helpers.js';
import { ATHLETE_COLUMNS } from '../listColumns.jsx';
import { WeaponPicker } from './ApplicationWizard.jsx';

const tg = () => window.Telegram?.WebApp;
const done = () => tg()?.HapticFeedback?.notificationOccurred('success');

const STATUS_TONE = {
  [ATHLETE_STATUS.confirmed]: 'success',
  [ATHLETE_STATUS.pending]: 'warning',
  [ATHLETE_STATUS.archived]: 'muted',
};

// 79001234567 → +7 900 123-45-67
const formatPhone = (phone) => {
  const m = String(phone).replace(/\D/g, '').match(/^7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
};

const PENDING = 'pending';
const ALL = 'all';

// Вкладка «Спортсмены»: ждущие подтверждения и все; подтверждение одной кнопкой, правка, закреплённое оружие
export function AdminAthletes({ model, sheets, onOpenPage, onMessage }) {
  const pending = model.athletes.filter((a) => a.status === ATHLETE_STATUS.pending);
  const [filter, setFilter] = useState(pending.length ? PENDING : ALL);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);

  const shown = filter === PENDING ? pending : model.athletes;
  const sorted = [...shown].sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));
  const list = fuzzySearch(sorted, query, (a) => `${a.fullName} ${a.phone}`);
  const listView = useListView('admin-athletes', ATHLETE_COLUMNS);

  const confirm = async (athlete) => {
    if (!(await confirmAction(`Подтвердить доступ для ${athlete.fullName}? Бот сообщит ему об этом.`))) return;
    setBusyId(athlete.id);
    try {
      const result = await saveAthlete(athlete.id, { Статус: ATHLETE_STATUS.confirmed });
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось подтвердить');
      sheets.patch((data) => withSheetRow(data, SHEET.athletes, result.row));
      done();
    } catch (e) {
      console.error(e);
      onMessage(e.message || 'Ошибка сети');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <button className="primary-button wide-button" onClick={() => onOpenPage('admin-athlete', {})}>
        ＋ Новый спортсмен
      </button>
      <Chips
        options={[
          { value: PENDING, label: 'Ждут подтверждения', count: pending.length },
          { value: ALL, label: 'Все', count: model.athletes.length },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {shown.length > 0 && (
        <ListToolbar listView={listView}>
          <SearchInput value={query} onChange={setQuery} placeholder="Фамилия, имя, телефон" />
        </ListToolbar>
      )}
      {list.length === 0 && (
        <EmptyState icon="👥" title={shown.length ? 'Никого не нашли' : filter === PENDING ? 'Заявок на доступ нет' : 'Список пуст'} />
      )}

      <CardsOrTable
        listView={listView}
        items={list}
        source={model.athletes}
        rowKey={(a) => a.id}
        cardHeight={ROW_HEIGHT * 2}
        resetKey={filter + query}
        renderCard={(a) => (
          <div key={a.id} className="card item-card">
            <div className="item-head">
              <div className="item-title">{a.fullName || a.id}</div>
              {a.status && <Badge tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</Badge>}
            </div>
            {a.phone && <div className="item-row">📞 {formatPhone(a.phone)}</div>}
            <div className="item-tags">
              {a.isCarrier && <Badge tone="accent">🚚 Перевозчик</Badge>}
              {a.isAdmin && <Badge tone="accent">🛠 Администратор</Badge>}
              <Badge>🎯 {a.weapons.length}</Badge>
            </div>
            <div className="card-actions">
              {/* Не входивший в приложение подтверждается сам, когда войдёт по номеру телефона */}
              {a.status !== ATHLETE_STATUS.confirmed && a.hasChatId && (
                <button className="secondary-button" disabled={busyId !== null} onClick={() => confirm(a)}>
                  {busyId === a.id ? '…' : '✅ Подтвердить'}
                </button>
              )}
              <button className="secondary-button" disabled={busyId !== null} onClick={() => onOpenPage('admin-athlete', { id: a.id })}>
                ✏️ Изменить
              </button>
              <button
                className="secondary-button"
                disabled={busyId !== null}
                onClick={() => onOpenPage('admin-athlete-weapons', { id: a.id })}
              >
                🎯 Оружие
              </button>
            </div>
          </div>
        )}
      />
    </>
  );
}

// Значение ячейки для поля ввода: дата (ISO-строка от Apps Script) — «гггг-мм-дд»
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;
const isDateCell = (value) => typeof value === 'string' && ISO_DATE.test(value);
const inputValue = (value) => (isDateCell(value) ? moscowDay(new Date(value)) : String(value ?? ''));

const NAME_COLUMNS = ['Фамилия', 'Имя', 'Отчество'];
// Тот же текст, что у отказа сервера (NOT_LOGGED_IN_CONFIRM_MESSAGE в Apps Script)
const NOT_LOGGED_IN_CONFIRM_HINT =
  'Спортсмен ещё не входил в приложение. Он будет подтверждён автоматически, когда войдёт по номеру телефона';

// Спортсмен: params без id — новый (AthleteCreateForm), { id } — правка (AthleteEditForm)
export const AdminAthleteForm = (props) => (props.params.id ? <AthleteEditForm {...props} /> : <AthleteCreateForm {...props} />);

// Правка спортсмена: все столбцы листа, кроме ID и ChatId. Отправляются только изменённые.
// params: { id }
function AthleteEditForm({ model, me, sheets, params, onOpenPage, onMessage }) {
  const back = () => onOpenPage('admin', { tab: 'athletes' });
  useTelegramBackButton(back);

  const sheet = sheets.data?.sheets?.[SHEET.athletes];
  const id = idColumn(sheets.data, SHEET.athletes);
  const source = sheet?.rows.find((r) => String(r[id]) === params.id);
  const columns = (sheet?.headers ?? []).filter((h, i) => i > 0 && h && !ATHLETE_LOCKED_COLUMNS.includes(h));
  // Значения при открытии формы — с ними сравнивается ввод: отправляются только изменённые столбцы
  const [initial] = useState(() =>
    Object.fromEntries(columns.map((c) => [c, ATHLETE_YES_NO_COLUMNS[c] ? yesNoValue(c, source?.[c]) : inputValue(source?.[c])])),
  );
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [attempted, setAttempted] = useState(false);

  const athlete = model.athletes.find((a) => a.id === params.id);
  if (!me?.isAdmin) return <EmptyState icon="🛠" title="Раздел только для администраторов" />;
  if (!source || !athlete) return <EmptyState icon="👥" title="Спортсмен не найден" />;

  const isSelf = athlete.id === me.id;
  // «Подтвержден» — только входившему в приложение (есть ChatId); уже подтверждённая запись остаётся как есть
  const canConfirm = athlete.hasChatId || initial['Статус'] === ATHLETE_STATUS.confirmed;
  const changed = columns.filter((c) => form[c] !== initial[c]);
  const problem = athleteProblem(
    model,
    {
      lastName: String(form['Фамилия'] ?? ''),
      firstName: String(form['Имя'] ?? ''),
      middleName: String(form['Отчество'] ?? ''),
      // Телефон проверяется, только если его меняли: старый номер из таблицы мог быть записан иначе
      phone: changed.includes('Телефон') ? String(form['Телефон'] ?? '') : '',
    },
    athlete?.id,
  );

  const save = async () => {
    if (problem) return setAttempted(true);
    if (!changed.length) return back();
    setBusy(true);
    setError(null);
    try {
      const fields = Object.fromEntries(changed.map((c) => [c, ATHLETE_YES_NO_COLUMNS[c] ? (form[c] ? 'Да' : 'Нет') : form[c]]));
      const result = await saveAthlete(athlete.id, fields);
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось сохранить');
      sheets.patch((data) => withSheetRow(data, SHEET.athletes, result.row));
      done();
      back();
    } catch (e) {
      console.error(e);
      setError(e.message || 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const applications = model.applications.filter((a) => a.createdById === athlete.id).length;
    const text =
      `Удалить спортсмена ${athlete.fullName}?` +
      (athlete.weapons.length ? ` Будет откреплено оружие: ${athlete.weapons.length}.` : '') +
      (applications ? ` Его заявки (${applications}) будут перенесены в архив.` : '') +
      ' Отменить удаление нельзя.';
    if (!(await confirmAction(text))) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteAthlete(athlete.id);
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось удалить');
      sheets.patch((data) => withoutAthlete(data, athlete.id));
      onMessage(`${athlete.fullName} удалён`);
      back();
    } catch (e) {
      console.error(e);
      setError(e.message || 'Ошибка сети');
      setBusy(false);
    }
  };

  const set = (column, value) => setForm((f) => ({ ...f, [column]: value }));
  const otherColumns = columns.filter(
    (c) => !NAME_COLUMNS.includes(c) && c !== 'Статус' && c !== 'Телефон' && !ATHLETE_YES_NO_COLUMNS[c],
  );
  const phoneInvalid = Boolean(attempted && problem && (problem.startsWith('Телефон') || problem.includes('номер')));
  const textField = (column, required) => (
    <label key={column} className="form-field">
      <span>
        {column}
        {required && ' *'}
      </span>
      <input
        className={
          (attempted && required && !String(form[column]).trim()) || (column === 'Телефон' && phoneInvalid)
            ? 'sheet-search invalid'
            : 'sheet-search'
        }
        type={column === 'Телефон' ? 'tel' : isDateCell(source[column]) ? 'date' : 'text'}
        placeholder={column === 'Телефон' ? '+7 900 123-45-67' : undefined}
        value={form[column]}
        maxLength={NAME_COLUMNS.includes(column) ? 100 : 500}
        autoComplete="off"
        onChange={(e) => set(column, e.target.value)}
      />
    </label>
  );

  return (
    <>
      <PageHeader title={athlete.fullName || 'Спортсмен'} subtitle={athlete.phone ? `📞 ${formatPhone(athlete.phone)}` : 'Телефон не указан'} />

      <div className="card item-card">
        {NAME_COLUMNS.filter((c) => columns.includes(c)).map((c) => textField(c, c !== 'Отчество'))}
        {columns.includes('Телефон') && textField('Телефон', false)}
        {columns.includes('Телефон') && (
          <div className="item-hint">
            {athlete.hasChatId
              ? 'Спортсмен уже входил в приложение — вход идёт по его Telegram, номер на вход не влияет.'
              : 'По этому номеру спортсмен войдёт в приложение в первый раз.'}
          </div>
        )}
        {columns.includes('Статус') && (
          <label className="form-field">
            <span>Статус</span>
            <select className="sheet-search" value={form['Статус']} disabled={isSelf} onChange={(e) => set('Статус', e.target.value)}>
              {/* Статус из таблицы, которого нет в списке, показываем, но выбрать его снова нельзя */}
              {!ATHLETE_STATUSES.includes(initial['Статус']) && (
                <option value={initial['Статус']} disabled>
                  {initial['Статус'] || '— не указан —'}
                </option>
              )}
              {ATHLETE_STATUSES.map((s) => (
                <option key={s} value={s} disabled={s === ATHLETE_STATUS.confirmed && !canConfirm}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        {!canConfirm && <div className="item-hint">{NOT_LOGGED_IN_CONFIRM_HINT}</div>}
        {isSelf && <div className="item-hint">Свой статус и признак администратора изменить нельзя — пропадёт доступ</div>}
      </div>

      <div className="card item-card">
        {columns
          .filter((c) => ATHLETE_YES_NO_COLUMNS[c])
          .map((c) => (
            <label key={c} className="switch-row">
              <span>{ATHLETE_YES_NO_COLUMNS[c].label}</span>
              <input
                type="checkbox"
                className="switch"
                checked={form[c]}
                disabled={isSelf && c === 'Администратор'}
                onChange={() => set(c, !form[c])}
              />
            </label>
          ))}
      </div>

      {otherColumns.length > 0 && <div className="card item-card">{otherColumns.map((c) => textField(c, false))}</div>}

      <div className="item-hint">ChatId меняется только в таблице.</div>
      {!isSelf && (
        <button className="secondary-button danger wide-button" onClick={remove} disabled={busy}>
          🗑 Удалить спортсмена
        </button>
      )}

      <FormFooter
        error={error}
        problem={problem}
        attempted={attempted}
        busy={busy}
        onCancel={back}
        onSave={save}
        saveLabel={changed.length ? 'Сохранить' : 'Готово'}
      />
    </>
  );
}

// Закреплённое оружие спортсмена: открепить, закрепить из справочника, завести новую единицу и закрепить.
// params: { id }
export function AdminAthleteWeapons({ model, me, sheets, params, onOpenPage, onMessage }) {
  const back = () => onOpenPage('admin', { tab: 'athletes' });
  useTelegramBackButton(back);
  const [picking, setPicking] = useState(false);
  const [newWeapon, setNewWeapon] = useState(null); // { title, number } — открыта форма новой единицы
  const [busy, setBusy] = useState(null);

  const athlete = model.athletes.find((a) => a.id === params.id);
  if (!me?.isAdmin) return <EmptyState icon="🛠" title="Раздел только для администраторов" />;
  if (!athlete) return <EmptyState icon="👥" title="Спортсмен не найден" />;

  const run = async (key, action) => {
    setBusy(key);
    try {
      const result = await action();
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось выполнить действие');
      return result;
    } catch (e) {
      console.error(e);
      onMessage(e.message || 'Ошибка сети');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const assign = async (payload) => {
    const result = await run('assign', () => assignWeaponTo({ athleteId: athlete.id, ...payload }));
    if (!result) return false;
    sheets.patch((data) => withWeaponLink(withSheetRow(data, SHEET.weapons, result.weaponRow), result.link));
    done();
    return true;
  };

  const unassign = async (weapon) => {
    if (!(await confirmAction(`Открепить ${weapon.title} ${weapon.number} от ${athlete.shortName}?`))) return;
    const result = await run(weapon.id, () => unassignWeaponFrom(athlete.id, weapon.id));
    if (result) sheets.patch((data) => withoutWeaponLink(data, result.link));
  };

  // Новая единица: если такая пара уже есть — предлагаем закрепить её; иначе — подтверждение добавления в справочник
  const addNew = async () => {
    const title = newWeapon.title.trim();
    const number = newWeapon.number.trim();
    if (!title || !number) return onMessage('Укажите название и номер');
    const existing = sameWeapon(model, title, number);
    if (existing) {
      if (athlete.weapons.includes(existing)) return onMessage(`${existing.title} ${existing.number} уже закреплено за ${athlete.shortName}`);
      if (!(await confirmAction(`${existing.title} ${existing.number} уже есть в справочнике. Закрепить её за ${athlete.shortName}?`))) return;
      if (await assign({ weaponId: existing.id })) setNewWeapon(null);
      return;
    }
    const ok = await confirmAction(
      `Такой единицы нет в справочнике: ${title} ${number}. Подтверждаете её добавление? Она будет закреплена за ${athlete.shortName}.`,
    );
    if (ok && (await assign({ newWeapon: { title, number } }))) setNewWeapon(null);
  };

  const owners = (weapon) => weapon.owners.filter((o) => o !== athlete).map((o) => o.shortName).join(', ');

  return (
    <>
      <PageHeader title="Закреплённое оружие" subtitle={athlete.fullName} />
      {athlete.weapons.length === 0 && <EmptyState icon="🎯" title="Оружие не закреплено" />}
      <div className="list">
        {athlete.weapons.map((w) => (
          <div key={w.id} className="list-item">
            <div className="list-text">
              <div className="item-title">{w.title}</div>
              <div className="item-hint">
                <code>{w.number}</code>
                {owners(w) && ` · также за: ${owners(w)}`}
              </div>
            </div>
            <button className="secondary-button danger" onClick={() => unassign(w)} disabled={busy !== null}>
              {busy === w.id ? '…' : 'Открепить'}
            </button>
          </div>
        ))}
      </div>

      <div className="card-actions">
        <button className="secondary-button" onClick={() => setPicking(true)} disabled={busy !== null}>
          ＋ Из справочника
        </button>
        {!newWeapon && (
          <button className="secondary-button" onClick={() => setNewWeapon({ title: '', number: '' })} disabled={busy !== null}>
            ＋ Новая единица
          </button>
        )}
      </div>

      {newWeapon && (
        <div className="card item-card">
          <div className="section-label">Новая единица</div>
          <label className="form-field">
            <span>Название *</span>
            <input
              className="sheet-search"
              value={newWeapon.title}
              maxLength={200}
              autoComplete="off"
              onChange={(e) => setNewWeapon({ ...newWeapon, title: e.target.value })}
            />
          </label>
          <label className="form-field">
            <span>Номер *</span>
            <input
              className="sheet-search"
              value={newWeapon.number}
              maxLength={100}
              autoComplete="off"
              onChange={(e) => setNewWeapon({ ...newWeapon, number: e.target.value })}
            />
          </label>
          <div className="card-actions">
            <button className="primary-button" onClick={addNew} disabled={busy !== null}>
              {busy === 'assign' ? 'Сохраняем…' : 'Закрепить'}
            </button>
            <button className="secondary-button" onClick={() => setNewWeapon(null)} disabled={busy !== null}>
              Отмена
            </button>
          </div>
        </div>
      )}

      <button className="secondary-button wide-button" onClick={back}>
        ← К спортсменам
      </button>

      {picking && (
        <WeaponPicker
          title={`Закрепить за ${athlete.shortName}`}
          weapons={model.weapons.filter((w) => !athlete.weapons.includes(w))}
          onPick={(w) => {
            setPicking(false);
            assign({ weaponId: w.id });
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

// Новый спортсмен: ФИО, телефон, признаки и прочие столбцы листа (кроме ID, ChatId и статуса). Статус ставит
// Apps Script — «Добавлен вручную»: спортсмен подтвердится сам, когда войдёт в приложение по этому номеру.
// После создания открывается его закреплённое оружие — без оружия перевозчик не сможет взять его в заявку
function AthleteCreateForm({ model, me, sheets, onOpenPage, onMessage }) {
  const back = () => onOpenPage('admin', { tab: 'athletes' });
  useTelegramBackButton(back);

  const headers = sheets.data?.sheets?.[SHEET.athletes]?.headers ?? [];
  const columns = headers.filter((h, i) => i > 0 && h && h !== 'ChatId' && h !== 'Статус');
  const [form, setForm] = useState(() =>
    Object.fromEntries(columns.map((c) => [c, ATHLETE_YES_NO_COLUMNS[c] ? ATHLETE_YES_NO_COLUMNS[c].emptyIsYes : ''])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [attempted, setAttempted] = useState(false);
  // Повтор после ошибки связи сервер узнает по requestId и не создаст второго спортсмена; после правки — новый запрос
  const requestId = useRef(null);

  if (!me?.isAdmin) return <EmptyState icon="🛠" title="Раздел только для администраторов" />;

  const value = (column) => String(form[column] ?? '');
  const problem = athleteProblem(model, {
    lastName: value('Фамилия'),
    firstName: value('Имя'),
    middleName: value('Отчество'),
    phone: value('Телефон'),
  });

  const set = (column, next) => {
    requestId.current = null;
    setForm((f) => ({ ...f, [column]: next }));
  };

  const save = async () => {
    if (problem) return setAttempted(true);
    setBusy(true);
    setError(null);
    requestId.current ??= newRequestId();
    try {
      // Признаки «Да»/«Нет» отправляются только включённые не по умолчанию; пустые поля не отправляются
      const fields = Object.fromEntries(
        columns
          .filter((c) => (ATHLETE_YES_NO_COLUMNS[c] ? form[c] !== ATHLETE_YES_NO_COLUMNS[c].emptyIsYes : value(c).trim()))
          .map((c) => [c, ATHLETE_YES_NO_COLUMNS[c] ? (form[c] ? 'Да' : 'Нет') : value(c)]),
      );
      const result = await createAthlete(fields, requestId.current);
      if (result.status !== 'success') throw new Error(result.message || 'Не удалось сохранить');
      sheets.patch((data) => withSheetRow(data, SHEET.athletes, result.row));
      done();
      onMessage('Спортсмен добавлен — закрепите за ним оружие');
      onOpenPage('admin-athlete-weapons', { id: result.athleteId });
    } catch (e) {
      console.error(e);
      setError(e.message || 'Ошибка сети');
    } finally {
      setBusy(false);
    }
  };

  const nameInvalid = (column) => attempted && column !== 'Отчество' && !value(column).trim();
  const textField = (column, { required = false, type = 'text', invalid = false, placeholder } = {}) => (
    <label key={column} className="form-field">
      <span>
        {column}
        {required && ' *'}
      </span>
      <input
        className={invalid ? 'sheet-search invalid' : 'sheet-search'}
        type={type}
        value={value(column)}
        maxLength={NAME_COLUMNS.includes(column) ? 100 : 500}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => set(column, e.target.value)}
      />
    </label>
  );
  const otherColumns = columns.filter((c) => !NAME_COLUMNS.includes(c) && c !== 'Телефон' && !ATHLETE_YES_NO_COLUMNS[c]);
  // Ошибка про телефон: неверный формат или номер уже занят
  const phoneInvalid = Boolean(attempted && problem && (problem.startsWith('Телефон') || problem.includes('номер')));

  return (
    <>
      <PageHeader title="Новый спортсмен" subtitle={`Статус — «${ATHLETE_STATUS.addedManually}»`} />

      <div className="card item-card">
        {NAME_COLUMNS.filter((c) => columns.includes(c)).map((c) =>
          textField(c, { required: c !== 'Отчество', invalid: nameInvalid(c) }),
        )}
        {columns.includes('Телефон') &&
          textField('Телефон', { type: 'tel', invalid: phoneInvalid, placeholder: '+7 900 123-45-67' })}
        <div className="item-hint">
          Спортсмен подтвердится сам, когда войдёт в приложение по этому номеру. Без номера он сможет участвовать в
          заявках, но войти в приложение не сможет, пока номер не впишут в таблицу.
        </div>
      </div>

      <div className="card item-card">
        {columns
          .filter((c) => ATHLETE_YES_NO_COLUMNS[c])
          .map((c) => (
            <label key={c} className="switch-row">
              <span>{ATHLETE_YES_NO_COLUMNS[c].label}</span>
              <input type="checkbox" className="switch" checked={form[c]} onChange={() => set(c, !form[c])} />
            </label>
          ))}
      </div>

      {otherColumns.length > 0 && <div className="card item-card">{otherColumns.map((c) => textField(c))}</div>}

      <FormFooter error={error} problem={problem} attempted={attempted} busy={busy} onCancel={back} onSave={save} />
    </>
  );
}
