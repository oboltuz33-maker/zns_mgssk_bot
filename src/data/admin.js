import { postAction } from './api.js';
import { APPLICATION_STATUS, moscowDay } from './model.js';
import { draftFromApplication, transportDates } from './applications.js';

// Раздел «Администрирование». Права проверяет Apps Script (requireAdmin_), здесь — только интерфейс.

// Смена статуса заявки — только вперёд по жизненному циклу (как APPLICATION_TRANSITIONS в Apps Script):
// из статуса → в какие можно. Откатить назад можно только в таблице
export const APPLICATION_TRANSITIONS = {
  [APPLICATION_STATUS.new]: [APPLICATION_STATUS.inProgress, APPLICATION_STATUS.rejected],
  [APPLICATION_STATUS.inProgress]: [APPLICATION_STATUS.done, APPLICATION_STATUS.rejected],
  [APPLICATION_STATUS.rejected]: [APPLICATION_STATUS.inProgress],
};

export const nextStatuses = (application) => APPLICATION_TRANSITIONS[application.status] ?? [];

// Подписи кнопок смены статуса
export const STATUS_ACTION_LABEL = {
  [APPLICATION_STATUS.inProgress]: '▶️ В работу',
  [APPLICATION_STATUS.done]: '✅ Выполнена',
  [APPLICATION_STATUS.rejected]: '⛔ Отклонить',
};

// Сроки по ЕКП заявки пересекаются с периодом: from, to — «гггг-мм-дд» или пусто (без границы).
// Заявки без даты по ЕКП в период не попадают (так же отбирает выгрузка в Apps Script)
export function inEkpPeriod(application, from, to) {
  if (!from && !to) return true;
  if (!application.ekpStart) return false;
  const start = moscowDay(application.ekpStart);
  const end = moscowDay(application.ekpEnd ?? application.ekpStart);
  return (!to || start <= to) && (!from || end >= from);
}

const dayOrEmpty = (date) => (date ? moscowDay(date) : '');

// Черновик правки заявки администратором:
// { number, competitionId, items, transport, transportStart, transportEnd, address }.
// competitionId пуст — соревнование в заявке не меняется; сроки перевозки — «гггг-мм-дд» для полей выбора даты
export function adminDraft(model, application) {
  const { draft, problems } = draftFromApplication(model, application, { withCompetition: false });
  return {
    draft: {
      ...draft,
      competitionId: '',
      transportStart: dayOrEmpty(application.transportStart),
      transportEnd: dayOrEmpty(application.transportEnd),
      address: application.address,
    },
    problems,
  };
}

// Соревнование выбрано заново: сроки перевозки и адрес — по нему (администратор может поправить).
// Выезд одним днём — обе даты перевозки по дате начала
export function withCompetition(draft, competition) {
  const dates = competition.oneDay && competition.start
    ? { start: competition.start, end: competition.start }
    : transportDates(competition);
  return {
    ...draft,
    competitionId: competition.id,
    transportStart: dayOrEmpty(dates.start),
    transportEnd: dayOrEmpty(dates.end),
    address: competition.address,
  };
}

// Чего не хватает в черновике: null — можно сохранять
export function adminDraftProblem(draft, model) {
  if (!draft.items.length) return 'Добавьте хотя бы одного участника';
  const empty = draft.items.find((i) => !i.weaponIds.length);
  if (empty) return `Выберите оружие для спортсмена ${model.athletes.find((a) => a.id === empty.athleteId)?.shortName ?? ''}`;
  if (!draft.transport.length) return 'Выберите вид транспорта';
  if (draft.transportStart && draft.transportEnd && draft.transportStart > draft.transportEnd) return 'Окончание перевозки раньше начала';
  return null;
}

// Ответ: { status: 'success', number, row } — row: сохранённая строка { заголовок: значение }
export const saveApplicationAsAdmin = (draft, requestId) =>
  postAction(
    'adminSaveApplication',
    {
      application: {
        number: draft.number,
        competitionId: draft.competitionId || undefined,
        items: draft.items,
        transport: draft.transport,
        transportStart: draft.transportStart,
        transportEnd: draft.transportEnd,
        address: draft.address,
      },
    },
    requestId,
  );

// from — статус, который видит администратор: если в таблице уже другой, скрипт ничего не изменит
export const setApplicationStatus = ({ number, from, status, reason }) =>
  postAction('adminSetApplicationStatus', { number, from, status, reason });

// Выгрузка «Заявок» в Excel за период по срокам ЕКП — файл бот присылает в чат. Ответ: { status, count, message }
export const exportApplications = ({ from, to }) => postAction('adminExportApplications', { from, to });

// ---------- Спортсмены ----------

// Статусы спортсмена, которые можно поставить в приложении (как ATHLETE_STATUSES в Apps Script)
export const ATHLETE_STATUS = {
  confirmed: 'Подтвержден',
  pending: 'Требует подтверждения',
  addedManually: 'Добавлен вручную',
  archived: 'Архив',
};
export const ATHLETE_STATUSES = Object.values(ATHLETE_STATUS);

// Столбцы, которые меняются только в таблице (кроме ID в первом столбце)
export const ATHLETE_LOCKED_COLUMNS = ['ChatId'];

// Столбцы «Да» / «Нет». Настройки уведомлений пустым значением включены, признаки — выключены
export const ATHLETE_YES_NO_COLUMNS = {
  Перевозчик: { label: '🚚 Перевозчик', emptyIsYes: false },
  Администратор: { label: '🛠 Администратор', emptyIsYes: false },
  'Сообщать о соревнованиях': { label: 'Сообщать о новых соревнованиях', emptyIsYes: true },
  'Сообщать о заявках': { label: 'Сообщать о статусе заявок', emptyIsYes: true },
};

export const yesNoValue = (column, value) => {
  const text = String(value ?? '').trim().toLowerCase();
  return text ? text === 'да' : ATHLETE_YES_NO_COLUMNS[column].emptyIsYes;
};

// Изменённые столбцы спортсмена: fields — { столбец: значение } (только изменённые). Ответ: { status, athleteId, row }
export const saveAthlete = (athleteId, fields) => postAction('adminSaveAthlete', { athleteId, fields });

export const deleteAthlete = (athleteId) => postAction('adminDeleteAthlete', { athleteId });

// Новый спортсмен: fields — { столбец: значение } (ФИО, «Телефон», признаки «Да»/«Нет», прочее). Статус ставит
// Apps Script — «Добавлен вручную». requestId — один на отправку: повтор после обрыва связи не создаст второго.
// Ответ: { status, athleteId, row }
export const createAthlete = (fields, requestId) => postAction('adminCreateAthlete', { fields }, requestId);

// Телефон к виду 7XXXXXXXXXX — как normalizePhone_ в Apps Script
export const normalizePhone = (value) => {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '8') digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits;
};

const normName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/ё/g, 'е');

// Чего не хватает в форме спортсмена: null — можно сохранять. Те же проверки, что в Apps Script: фамилия и имя,
// без дублей ФИО (отчество сравнивается, если указано у обоих) и телефона, телефон — 11 цифр с 7 или пусто.
// exceptId — правка: сам спортсмен дублем не считается
export function athleteProblem(model, { lastName, firstName, middleName, phone }, exceptId = '') {
  if (!lastName.trim() || !firstName.trim()) return 'Укажите фамилию и имя';
  const namesake = model.athletes.find(
    (a) =>
      a.id !== exceptId &&
      normName(a.lastName) === normName(lastName) &&
      normName(a.firstName) === normName(firstName) &&
      (!normName(a.middleName) || !normName(middleName) || normName(a.middleName) === normName(middleName)),
  );
  if (namesake) return `${namesake.fullName} уже есть в списке`;
  if (!phone.trim()) return null;
  const digits = normalizePhone(phone);
  if (!/^7\d{10}$/.test(digits)) return 'Телефон: 11 цифр, например +7 900 123-45-67';
  const owner = model.athletes.find((a) => a.id !== exceptId && a.phone && normalizePhone(a.phone) === digits);
  return owner ? `Этот номер уже указан у спортсмена ${owner.fullName}` : null;
}

// ---------- Соревнования ----------

// Черновик формы соревнования: даты — «гггг-мм-дд»
export const competitionDraft = (competition) => ({
  id: competition?.id ?? '',
  title: competition?.title ?? '',
  ekpNumber: competition?.ekpNumber ?? '',
  kind: competition?.kind ?? '',
  start: dayOrEmpty(competition?.start),
  end: dayOrEmpty(competition?.end),
  address: competition?.address ?? '',
  oneDay: competition?.oneDay ?? false,
});

export function competitionProblem(draft) {
  if (!draft.title.trim()) return 'Укажите название соревнования';
  if (draft.start && draft.end && draft.start > draft.end) return 'Дата завершения раньше даты начала';
  if (draft.oneDay && !draft.start) return 'Для выезда одним днём укажите даты соревнования';
  return null;
}

// Ответ: { status, id, created, notified, row }
export const saveCompetition = (draft, requestId) => postAction('adminSaveCompetition', { competition: draft }, requestId);

// ---------- Оружие ----------

// Пара «Название + Номер» для сравнения — как weaponKey_ в Apps Script
export const weaponKey = (title, number) =>
  [title, number].map((s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/ё/g, 'е')).join('|');

// Единица справочника с той же парой (кроме exceptId) или undefined
export const sameWeapon = (model, title, number, exceptId = '') =>
  model.weapons.find((w) => w.id !== exceptId && weaponKey(w.title, w.number) === weaponKey(title, number));

export function weaponProblem(model, { id, title, number }) {
  if (!title.trim()) return 'Укажите название';
  if (!number.trim()) return 'Укажите номер';
  if (sameWeapon(model, title, number, id)) return 'Такая единица уже есть в справочнике';
  return null;
}

// Ответ: { status, id, created, row }
export const saveWeapon = ({ id, title, number }) => postAction('adminSaveWeapon', { weapon: { id: id || undefined, title, number } });

export const deleteWeapon = (weaponId) => postAction('adminDeleteWeapon', { weaponId });

// Закрепить: { athleteId, weaponId } или { athleteId, newWeapon: { title, number } }. Ответ: { status, link, weaponRow, message }
export const assignWeaponTo = (payload) => postAction('adminAssignWeapon', payload);

export const unassignWeaponFrom = (athleteId, weaponId) => postAction('adminUnassignWeapon', { athleteId, weaponId });
