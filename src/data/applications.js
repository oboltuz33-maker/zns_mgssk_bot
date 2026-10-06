import { postAction } from './api.js';
import { DEFAULT_TRANSPORT } from '../config.js';

// Черновик заявки — то, что выбирает перевозчик в мастере:
// { number, competitionId, items: [{ athleteId, weaponIds }], transport: [названия] }
// number задан при изменении существующей заявки. Сроки перевозки в черновик не входят —
// Apps Script ставит их сам по датам соревнования.

const DAY_MS = 24 * 60 * 60 * 1000;

// Сроки перевозки, которые Apps Script запишет в заявку: за день до начала соревнования и через день
// после окончания (TRANSPORT_DAYS_BEFORE / TRANSPORT_DAYS_AFTER в скрипте). Здесь — только для показа.
export const transportDates = (competition) => {
  if (!competition?.start) return { start: null, end: null };
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
    // Перевозчик добавлен в заявку по умолчанию
    items: me ? [{ athleteId: me.id, weaponIds: defaultWeaponIds(me) }] : [],
    // Вид транспорта по умолчанию (если он есть в справочнике)
    transport: model.transportTypes.includes(DEFAULT_TRANSPORT) ? [DEFAULT_TRANSPORT] : [],
  };
}

// Запись из столбца «Оружие» («Фамилия И.О.» + { title, number }) → { athlete, weapon } или null.
// Оружие — по номеру, спортсмен — по «Фамилия И.О.» (сначала среди владельцев этого оружия)
function matchWeapon(model, name, { number }) {
  const weapon = number && model.weapons.find((w) => w.number.toLowerCase() === number.toLowerCase());
  const athlete =
    (weapon && weapon.owners.find((a) => a.shortName === name)) || model.athletes.find((a) => a.shortName === name);
  return weapon && athlete ? { athlete, weapon } : null;
}

// Восстановление черновика из строки заявки. В листе «Заявки» нет ID, поэтому выбор
// восстанавливается по тексту: оружие — по номеру, спортсмен — по «Фамилия И.О.» (сначала среди
// владельцев этого оружия), соревнование — по названию и № ЕКП, транспорт — по названию.
// problems — то, что распознать не удалось: это нужно выбрать в мастере заново.
export function draftFromApplication(model, application) {
  const problems = [];

  const sameTitle = model.competitions.filter((c) => c.title === application.competitionTitle);
  const competition =
    sameTitle.find((c) => c.ekpNumber === application.ekpNumber) || (sameTitle.length === 1 ? sameTitle[0] : null);
  if (!competition) problems.push(`Соревнование «${application.competitionTitle}» не найдено в списке`);

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

  const draft = {
    number: application.number,
    competitionId: competition ? competition.id : '',
    items,
    transport,
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
  if (stepId === 'review') return draft.transport.length ? null : 'Выберите вид транспорта';
  return null;
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

const draftKey = (me) => `zns-application-draft:${me.id}`;
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

// Отправка в Apps Script. Ответ: { status: 'success', number } или { status: 'error', message }
export const saveApplication = (draft) =>
  postAction('saveApplication', {
    application: {
      number: draft.number || undefined,
      competitionId: draft.competitionId,
      items: draft.items,
      transport: draft.transport,
    },
  });

export const deleteApplication = (number) => postAction('deleteApplication', { number });
