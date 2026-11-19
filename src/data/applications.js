import { postAction } from './api.js';
import { DEFAULT_TRANSPORT, storageKey } from '../config.js';
import { moscowDay } from './model.js';

// Черновик заявки — то, что выбирает перевозчик в мастере:
// { number, competitionId, items: [{ athleteId, weaponIds }], transport: [названия], transportDate }
// number задан при изменении существующей заявки. Сроки перевозки Apps Script ставит сам по датам соревнования;
// transportDate («гггг-мм-дд» или '') — только для соревнований «Выезд одним днём»: перевозчик выбирает день
// из периода соревнования, он записывается в обе даты сроков перевозки.

const DAY_MS = 24 * 60 * 60 * 1000;
// Больше стольких дней в выборе даты перевозки не показываем (защита от ошибки в датах соревнования)
const MAX_COMPETITION_DAYS = 31;

// Полночь по Москве дня «гггг-мм-дд»
const dayToDate = (day) => new Date(`${day}T00:00:00+03:00`);

// Дни соревнования «гггг-мм-дд» от начала до окончания (без даты начала — пусто)
export function competitionDays(competition) {
  if (!competition?.start) return [];
  const last = moscowDay(competition.end || competition.start);
  const days = [];
  for (let i = 0; i < MAX_COMPETITION_DAYS; i++) {
    const day = moscowDay(new Date(competition.start.getTime() + i * DAY_MS));
    if (day > last) break;
    days.push(day);
  }
  return days;
}

// Дата перевозки, выбранная сразу: у соревнования «одним днём» из одного дня — этот день, иначе ''
export const defaultTransportDate = (competition) => {
  const days = competition?.oneDay ? competitionDays(competition) : [];
  return days.length === 1 ? days[0] : '';
};

// Сроки перевозки, которые Apps Script запишет в заявку: за день до начала соревнования и через день
// после окончания (TRANSPORT_DAYS_BEFORE / TRANSPORT_DAYS_AFTER в скрипте), у соревнования «одним днём» —
// выбранная дата перевозки (transportDate). Здесь — только для показа.
export const transportDates = (competition, transportDate = '') => {
  if (!competition?.start) return { start: null, end: null };
  if (competition.oneDay) {
    const date = transportDate ? dayToDate(transportDate) : null;
    return { start: date, end: date };
  }
  const end = competition.end || competition.start;
  return { start: new Date(competition.start.getTime() - DAY_MS), end: new Date(end.getTime() + DAY_MS) };
};

// Оружие, которое сразу отмечается при добавлении спортсмена: всё закреплённое за ним (обычно везут своё;
// лишнее снимается одним нажатием)
export const defaultWeaponIds = (athlete) => (athlete?.weapons ?? []).map((w) => w.id);

export function newDraft(model, me, competitionId = '') {
  const competition = model.competitions.find((c) => c.id === competitionId);
  return {
    number: null,
    competitionId: competition ? competition.id : '',
    transportDate: defaultTransportDate(competition),
    // Перевозчик добавлен в заявку по умолчанию
    items: me ? [{ athleteId: me.id, weaponIds: defaultWeaponIds(me) }] : [],
    // Вид транспорта по умолчанию (если он есть в справочнике)
    transport: model.transportTypes.includes(DEFAULT_TRANSPORT) ? [DEFAULT_TRANSPORT] : [],
  };
}

// Запись из столбца «Оружие» («Фамилия И.О.» + { title, number }) → { athlete, weapon } или null.
// Оружие — по номеру (если номер совпал у нескольких единиц — та, у которой совпало и название),
// спортсмен — по «Фамилия И.О.» (сначала среди владельцев этого оружия)
function matchWeapon(model, name, { title, number }) {
  const sameNumber = number ? model.weapons.filter((w) => w.number.toLowerCase() === number.toLowerCase()) : [];
  const weapon = sameNumber.find((w) => w.title.toLowerCase() === title.toLowerCase()) || sameNumber[0];
  const athlete =
    (weapon && weapon.owners.find((a) => a.shortName === name)) || model.athletes.find((a) => a.shortName === name);
  return weapon && athlete ? { athlete, weapon } : null;
}

// Восстановление черновика из строки заявки. В листе «Заявки» нет ID, поэтому выбор
// восстанавливается по тексту: оружие — по номеру, спортсмен — по «Фамилия И.О.» (сначала среди
// владельцев этого оружия), соревнование — по названию и № ЕКП, транспорт — по названию.
// problems — то, что распознать не удалось: это нужно выбрать в мастере заново.
// withCompetition: false — соревнование не ищется (администратор правит заявку, не меняя соревнования)
export function draftFromApplication(model, application, { withCompetition = true } = {}) {
  const problems = [];

  const sameTitle = model.competitions.filter((c) => c.title === application.competitionTitle);
  const competition = withCompetition
    ? sameTitle.find((c) => c.ekpNumber === application.ekpNumber) || (sameTitle.length === 1 ? sameTitle[0] : null)
    : null;
  if (withCompetition && !competition) problems.push(`Соревнование «${application.competitionTitle}» не найдено в списке`);

  const items = [];
  for (const entry of application.weaponEntries) {
    for (const w of entry.weapons) {
      const matched = matchWeapon(model, entry.name, w);
      if (!matched) {
        problems.push(`Не распознано: «${entry.name} : ${w.title} - ${w.number}»`);
        continue;
      }
      const { athlete, weapon } = matched;
      let item = items.find((i) => i.athleteId === athlete.id);
      if (!item) items.push((item = { athleteId: athlete.id, weaponIds: [] }));
      if (!item.weaponIds.includes(weapon.id)) item.weaponIds.push(weapon.id);
    }
  }

  const transport = application.transportList.filter((t) => model.transportTypes.includes(t));
  application.transportList
    .filter((t) => !model.transportTypes.includes(t))
    .forEach((t) => problems.push(`Вида транспорта «${t}» нет в справочнике`));

  // Дата перевозки на соревнование «одним днём» — из сроков перевозки заявки, если она в периоде соревнования
  const savedDay = application.transportStart ? moscowDay(application.transportStart) : '';
  const transportDate = competition && competitionDays(competition).includes(savedDay) ? savedDay : defaultTransportDate(competition);

  const draft = {
    number: application.number,
    competitionId: competition ? competition.id : '',
    items,
    transport,
    transportDate: competition?.oneDay ? transportDate : '',
  };
  return { draft, problems };
}

// Шаги мастера и проверка каждого: null — можно идти дальше, иначе текст подсказки.
// next — подпись кнопки перехода на следующий шаг
export const WIZARD_STEPS = [
  { id: 'competition', title: 'Соревнование', next: 'Далее: участники' },
  { id: 'participants', title: 'Участники и оружие', next: 'Далее: проверка' },
  { id: 'review', title: 'Проверка' },
];

export function stepProblem(stepId, draft, model) {
  if (stepId === 'competition') return draft.competitionId ? null : 'Выберите соревнование';
  if (stepId === 'participants') {
    if (!draft.items.length) return 'Добавьте хотя бы одного участника';
    const empty = draft.items.find((i) => !i.weaponIds.length);
    if (!empty) return null;
    const athlete = model.athletes.find((a) => a.id === empty.athleteId);
    return `Выберите оружие для спортсмена ${athlete?.shortName ?? ''}`;
  }
  if (stepId === 'review') {
    if (!draft.transport.length) return 'Выберите вид транспорта';
    return transportDateProblem(draft, model);
  }
  return null;
}

// Дата перевозки на соревнование «одним днём»: null — выбрана верно (или не нужна), иначе текст подсказки
export function transportDateProblem(draft, model) {
  const competition = model.competitions.find((c) => c.id === draft.competitionId);
  if (!competition?.oneDay || !competition.start) return null;
  if (!draft.transportDate) return 'Выберите дату перевозки';
  return competitionDays(competition).includes(draft.transportDate) ? null : 'Дата перевозки вне периода соревнования';
}

// Спортсмены из прошлых заявок перевозчика — от недавних к давним, без повторов
export function recentAthletes(model, me) {
  const result = [];
  model.applications
    .filter((a) => a.createdById === me?.id) // заявки уже отсортированы: новые первыми
    .forEach((application) =>
      application.weaponEntries.forEach((entry) => {
        const athlete = entry.weapons.map((w) => matchWeapon(model, entry.name, w)?.athlete).find(Boolean);
        if (athlete && !result.includes(athlete)) result.push(athlete);
      }),
    );
  return result;
}

// Заявки перевозчика на это соревнование (сверка по названию и № ЕКП — в заявке они записаны текстом)
export const applicationsForCompetition = (model, competition, me) =>
  model.applications.filter(
    (a) =>
      a.createdById === me?.id &&
      a.competitionTitle === competition.title &&
      (!a.ekpNumber || !competition.ekpNumber || a.ekpNumber === competition.ekpNumber),
  );

// ---------- Черновик на устройстве ----------
// Незаконченная новая заявка сохраняется в localStorage, чтобы её можно было продолжить после закрытия
// приложения или обрыва связи. Хранится отдельно для каждого спортсмена, неделю.

const draftKey = (me) => storageKey(`zns-application-draft:${me.id}`);
const DRAFT_MAX_AGE_MS = 7 * DAY_MS;

export function saveDraftLocally(me, draft, step) {
  try {
    localStorage.setItem(draftKey(me), JSON.stringify({ savedAt: Date.now(), step, draft }));
  } catch {
    // localStorage недоступен — черновик просто не сохранится
  }
}

export function clearSavedDraft(me) {
  try {
    localStorage.removeItem(draftKey(me));
  } catch {
    // нечего чистить
  }
}

// Сохранённый черновик { draft, step, savedAt } или null. Выбор сверяется с текущими данными:
// то, чего уже нет в таблице (спортсмен, оружие, вид транспорта), отбрасывается
export function loadSavedDraft(model, me) {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey(me)));
    if (!saved?.draft || Date.now() - saved.savedAt > DRAFT_MAX_AGE_MS) return null;
    const { draft } = saved;
    const weaponIds = new Set(model.weapons.map((w) => w.id));
    return {
      ...saved,
      draft: {
        number: null,
        competitionId: model.competitions.some((c) => c.id === draft.competitionId) ? draft.competitionId : '',
        transportDate: draft.transportDate ?? '',
        items: draft.items
          .filter((i) => model.athletes.some((a) => a.id === i.athleteId))
          .map((i) => ({ ...i, weaponIds: i.weaponIds.filter((id) => weaponIds.has(id)) })),
        transport: draft.transport.filter((t) => model.transportTypes.includes(t)),
      },
    };
  } catch {
    return null;
  }
}

// Строки столбца «Оружие» — так же, как их соберёт Apps Script (для предпросмотра):
// по строке на спортсмена «Фамилия И.О. : Название - Номер ; Название - Номер»
export const weaponLines = (draft, model) =>
  draft.items.map((item) => {
    const athlete = model.athletes.find((a) => a.id === item.athleteId);
    const weapons = item.weaponIds.map((id) => {
      const weapon = model.weapons.find((w) => w.id === id);
      return `${weapon?.title} - ${weapon?.number}`;
    });
    return `${athlete?.shortName} : ${weapons.join(' ; ')}`;
  });

// Отправка в Apps Script. Ответ: { status: 'success', number, row } (row — сохранённая строка { заголовок: значение })
// или { status: 'error', message }.
// requestId — один на отправку одного и того же черновика: если ответ потерялся и пользователь нажал ещё раз,
// скрипт вернёт прежний ответ, а не создаст вторую заявку
export const saveApplication = (draft, requestId) =>
  postAction(
    'saveApplication',
    {
      application: {
        number: draft.number || undefined,
        competitionId: draft.competitionId,
        items: draft.items,
        transport: draft.transport,
        transportDate: draft.transportDate || undefined,
      },
    },
    requestId,
  );

export const deleteApplication = (number) => postAction('deleteApplication', { number });
