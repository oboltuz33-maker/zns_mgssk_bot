import { beforeEach, describe, expect, it } from 'vitest';
import { buildModel, findMyAthlete, isUpcomingCompetition, moscowDay } from '../src/data/model.js';
import {
  applicationsForCompetition,
  draftFromApplication,
  loadSavedDraft,
  newDraft,
  recentAthletes,
  saveDraftLocally,
  stepProblem,
  transportDates,
  weaponLines,
} from '../src/data/applications.js';
import { withAthleteFields, withApplicationRow, withWeaponLink, withoutApplication, withoutWeaponLink } from '../src/data/patches.js';
import { fuzzySearch } from '../src/data/search.js';

// Данные в том виде, в каком их отдаёт sheets.js: { sheets: { лист: { headers, rows: [{ заголовок: значение }] } } }
const sheet = (headers, ...rows) => ({
  headers,
  rows: rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']))),
  skipped: 0,
});

// Даты, как их присылает Apps Script: ячейка-дата — ISO-строка (полночь по Москве = 21:00 UTC накануне)
const moscowMidnight = (offsetDays) => {
  const today = moscowDay(new Date());
  const date = new Date(`${today}T00:00:00+03:00`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString();
};

const data = () => ({
  athleteId: 'a1',
  sheets: {
    // Заголовки первого столбца у листов разные — ID берётся из первого столбца, как в Apps Script
    Спортсмены: sheet(
      ['ID', 'Фамилия', 'Имя', 'Отчество', 'Телефон', 'Статус', 'Перевозчик', 'Сообщать о заявках'],
      ['a1', 'Иванов', 'Иван', 'Иванович', '79001111111', 'Подтвержден', 'Да', 'Нет'],
      ['a2', 'Петров', 'Пётр', '', '', 'Подтвержден', 'Нет'],
      ['a3', 'Иванов', 'Олег', 'Олегович', '', 'Подтвержден', 'Нет'],
    ),
    Соревнования: sheet(
      ['Ид соревнования', 'Название', 'Номер из ЕКП', 'Вид соревнования', 'Дата начала', 'Дата завершения', 'Адрес'],
      ['c2', 'Поздний кубок', '2', 'Пулевая', moscowMidnight(30), moscowMidnight(31), 'Тула'],
      ['c3', 'Без даты', '3', 'Стендовая', '', '', 'Казань'],
      ['c1', 'Кубок Москвы', '1', 'Пулевая', moscowMidnight(10), '12.11.2099', 'Москва'],
    ),
    Оружие: sheet(['Ид', 'Название', 'Номер'], ['w1', 'МР-512', '123'], ['w2', 'Benelli', '777'], ['w3', 'Beretta', '123']),
    'Спортсмен/Оружие': sheet(['Спортсмен ид', 'Оружие ид'], ['a1', 'w1'], ['a2', 'w2'], ['a2', 'нет-такого'], ['a3', 'w3']),
    Заявки: sheet(
      ['№', 'ФИО', 'Оружие', 'Сроки перевозки начало', 'Сроки перевозки окончание', 'Вид транспорта', 'Вид соревнования',
        'Название соревнования', 'Номер в ЕКП', 'Сроки по ЕКП начало', 'Сроки по ЕКП окончание', 'Адрес', 'Статус', 'CreatedBy', 'CreatedAt'],
      [3, 'Иванов Иван Иванович', 'Иванов И.И. : МР-512 - 123\nПетров П. : Benelli - 777 ; Дробовик - 000', '', '', 'Автомобиль;\nДирижабль',
        'Пулевая', 'Кубок Москвы', '1', moscowMidnight(10), '', 'Москва', 'Новая', 'a1', '01.10.2026 10:30'],
      [4, 'Иванов Иван Иванович', 'Иванов И.И. : Beretta - 123', '', '', 'Поезд', 'Пулевая', 'Поздний кубок', '2', '', '', '', 'В работе', 'a1',
        '02.10.2026 09:00'],
    ),
    'Виды транспорта': sheet(['Вид'], ['Автомобиль'], ['Поезд']),
  },
});

let model;
beforeEach(() => {
  model = buildModel(data());
});

describe('buildModel', () => {
  it('берёт ID из первого столбца любого листа и связывает оружие со спортсменами', () => {
    const me = findMyAthlete(model);
    expect(me.fullName).toBe('Иванов Иван Иванович');
    expect(me.shortName).toBe('Иванов И.И.');
    expect(me.weapons.map((w) => w.id)).toEqual(['w1']);
    expect(model.weapons.find((w) => w.id === 'w2').owners.map((a) => a.id)).toEqual(['a2']);
    // Связь с несуществующим оружием пропускается
    expect(model.athletes.find((a) => a.id === 'a2').weapons).toHaveLength(1);
  });

  it('разбирает даты по Москве и сортирует соревнования, без даты — в конце', () => {
    expect(model.competitions.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    const c1 = model.competitions[0];
    expect(c1.end.toISOString()).toBe('2099-11-11T21:00:00.000Z');
    expect(model.competitions[2].start).toBeNull();
  });

  it('разбирает заявки: оружие по спортсменам, транспорт, новые сверху', () => {
    expect(model.applications.map((a) => a.number)).toEqual(['4', '3']);
    const application = model.applications[1];
    expect(application.canEdit).toBe(true);
    expect(application.transportList).toEqual(['Автомобиль', 'Дирижабль']);
    expect(application.weaponEntries[1]).toEqual({
      name: 'Петров П.',
      weapons: [{ title: 'Benelli', number: '777' }, { title: 'Дробовик', number: '000' }],
    });
    expect(application.createdAt.toISOString()).toBe('2026-10-01T07:30:00.000Z');
  });

  it('настройки уведомлений — только те, для которых есть столбец', () => {
    expect(model.notificationSettings).toEqual(['applications']);
    expect(findMyAthlete(model).notifyApplications).toBe(false);
  });

  it('предстоящее — с сегодняшнего дня по Москве; без даты — тоже', () => {
    expect(isUpcomingCompetition({ start: new Date() })).toBe(true);
    expect(isUpcomingCompetition({ start: new Date(Date.now() - 2 * 86400000) })).toBe(false);
    expect(isUpcomingCompetition({ start: null })).toBe(true);
  });
});

describe('Черновик заявки', () => {
  it('новый: перевозчик со своим оружием, транспорт по умолчанию, соревнование — только существующее', () => {
    const me = findMyAthlete(model);
    expect(newDraft(model, me, 'c1')).toEqual({
      number: null,
      competitionId: 'c1',
      items: [{ athleteId: 'a1', weaponIds: ['w1'] }],
      transport: ['Автомобиль'],
    });
    expect(newDraft(model, me, 'нет-такого').competitionId).toBe('');
  });

  it('из заявки: выбор восстанавливается по тексту, нераспознанное — в problems', () => {
    const { draft, problems } = draftFromApplication(model, model.applications.find((a) => a.number === '3'));
    expect(draft).toEqual({
      number: '3',
      competitionId: 'c1',
      items: [
        { athleteId: 'a1', weaponIds: ['w1'] },
        { athleteId: 'a2', weaponIds: ['w2'] },
      ],
      transport: ['Автомобиль'],
    });
    expect(problems).toEqual(['Не распознано: «Петров П. : Дробовик - 000»', 'Вида транспорта «Дирижабль» нет в справочнике']);
  });

  it('оружие с одинаковым номером различается по названию', () => {
    const { draft } = draftFromApplication(model, model.applications.find((a) => a.number === '4'));
    expect(draft.items).toEqual([{ athleteId: 'a1', weaponIds: ['w3'] }]);
  });

  it('проверка шагов', () => {
    const draft = { competitionId: '', items: [{ athleteId: 'a2', weaponIds: [] }], transport: [] };
    expect(stepProblem('competition', draft, model)).toBe('Выберите соревнование');
    expect(stepProblem('participants', draft, model)).toBe('Выберите оружие для спортсмена Петров П.');
    expect(stepProblem('participants', { ...draft, items: [] }, model)).toBe('Добавьте хотя бы одного участника');
    expect(stepProblem('review', draft, model)).toBe('Выберите вид транспорта');
  });

  it('предпросмотр строк «Оружие» — в формате, который пишет Apps Script', () => {
    const draft = { items: [{ athleteId: 'a1', weaponIds: ['w1', 'w2'] }, { athleteId: 'a2', weaponIds: ['w2'] }] };
    expect(weaponLines(draft, model)).toEqual(['Иванов И.И. : МР-512 - 123 ; Benelli - 777', 'Петров П. : Benelli - 777']);
  });

  it('сроки перевозки — за день до начала и через день после окончания', () => {
    const competition = model.competitions[0];
    const { start, end } = transportDates(competition);
    expect(moscowDay(start)).toBe(moscowDay(new Date(competition.start.getTime() - 86400000)));
    expect(moscowDay(end)).toBe('2099-11-13');
    expect(transportDates(model.competitions[2])).toEqual({ start: null, end: null });
  });

  it('недавние участники и заявки на соревнование', () => {
    const me = findMyAthlete(model);
    expect(recentAthletes(model, me).map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(applicationsForCompetition(model, model.competitions[0], me).map((a) => a.number)).toEqual(['3']);
  });
});

describe('Черновик на устройстве', () => {
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
  });

  it('отбрасывает то, чего уже нет в таблице', () => {
    const me = findMyAthlete(model);
    saveDraftLocally(me, {
      competitionId: 'удалено',
      items: [{ athleteId: 'a1', weaponIds: ['w1', 'удалено'] }, { athleteId: 'удалён', weaponIds: ['w2'] }],
      transport: ['Поезд', 'Дирижабль'],
    }, 1);
    expect(loadSavedDraft(model, me)).toMatchObject({
      step: 1,
      draft: { number: null, competitionId: '', items: [{ athleteId: 'a1', weaponIds: ['w1'] }], transport: ['Поезд'] },
    });
  });
});

describe('Правки загруженных данных на месте', () => {
  it('заявка добавляется, заменяется и удаляется по №', () => {
    let d = withApplicationRow(data(), { '№': 5, Статус: 'Новая' });
    expect(d.sheets['Заявки'].rows.map((r) => r['№'])).toEqual([3, 4, 5]);
    d = withApplicationRow(d, { '№': 3, Статус: 'Новая', Адрес: 'Химки' });
    expect(d.sheets['Заявки'].rows[0]['Адрес']).toBe('Химки');
    d = withoutApplication(d, '4');
    expect(d.sheets['Заявки'].rows.map((r) => r['№'])).toEqual([3, 5]);
  });

  it('связи с оружием — без дублей', () => {
    const link = { athleteId: 'a1', weaponId: 'w2' };
    let d = withWeaponLink(withWeaponLink(data(), link), link);
    expect(buildModel(d).athletes[0].weapons.map((w) => w.id)).toEqual(['w1', 'w2']);
    d = withoutWeaponLink(d, link);
    expect(buildModel(d).athletes[0].weapons.map((w) => w.id)).toEqual(['w1']);
  });

  it('поля спортсмена меняются в его строке', () => {
    const d = withAthleteFields(data(), 'a1', { 'Сообщать о заявках': 'Да' });
    expect(buildModel(d).athletes[0].notifyApplications).toBe(true);
    expect(d.sheets['Спортсмены'].rows[1]).toEqual(data().sheets['Спортсмены'].rows[1]);
  });
});

describe('Нечёткий поиск', () => {
  const people = ['Иванов Иван', 'Петров Пётр', 'Ивашкин Олег', 'Falcon Shooter'];
  const search = (q) => fuzzySearch(people, q, (s) => s);

  it('по началу слова, лучшие совпадения первыми', () => {
    expect(search('ива')).toEqual(['Иванов Иван', 'Ивашкин Олег']);
    expect(search('иван')[0]).toBe('Иванов Иван');
  });

  it('с опечатками, в другой раскладке и транслитом, ё = е', () => {
    expect(search('ивнов')).toEqual(['Иванов Иван']);
    expect(search('bdfyjd')).toEqual(['Иванов Иван']);
    expect(search('фалкон')).toEqual(['Falcon Shooter']);
    expect(search('ivanov')).toEqual(['Иванов Иван']);
    expect(search('петр')).toEqual(['Петров Пётр']);
  });

  it('все слова запроса должны совпасть; пустой запрос — весь список с ограничением', () => {
    expect(search('иванов олег')).toEqual([]);
    expect(fuzzySearch(people, '  ', (s) => s, 2)).toEqual(people.slice(0, 2));
  });
});
