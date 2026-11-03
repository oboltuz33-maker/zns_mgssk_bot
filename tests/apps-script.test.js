import { beforeEach, describe, expect, it } from 'vitest';
import { contactFor, createGas, initDataFor, signTelegram } from './gas.js';

// Даты — полночь по Москве (тесты запускаются с TZ=Europe/Moscow, как часовой пояс скрипта)
const day = (offset) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
};

const IVANOV = { id: 111, first_name: 'Иван' }; // перевозчик
const PETROV = { id: 222, first_name: 'Пётр' }; // подтверждён, не перевозчик
const SIDOROV = { id: 333, first_name: 'Сидор' }; // ждёт подтверждения
const STRANGER = { id: 999, first_name: 'Незнакомец' };

const APPLICATION_HEADERS = [
  '№', 'ФИО', 'Оружие', 'Сроки перевозки начало', 'Сроки перевозки окончание', 'Вид транспорта', 'Вид соревнования',
  'Название соревнования', 'Номер в ЕКП', 'Сроки по ЕКП начало', 'Сроки по ЕКП окончание', 'Адрес', 'Статус',
  'CreatedBy', 'CreatedAt', 'Примечание',
];

const application = (number, author, status, note = '') => [
  number, 'ФИО', 'Иванов И.И. : МР-512 - 123', '', '', 'Автомобиль', 'Пулевая', 'Кубок', '1', '', '', 'Москва',
  status, author, day(-1), note,
];

const fixture = () => ({
  Спортсмены: [
    ['ID', 'Фамилия', 'Имя', 'Отчество', 'Телефон', 'ChatId', 'Статус', 'Перевозчик', 'Сообщать о соревнованиях', 'Сообщать о заявках', 'Паспорт'],
    ['a1', 'Иванов', 'Иван', 'Иванович', '79001111111', 111, 'Подтвержден', 'Да', '', '', '4500 111111'],
    ['a2', 'Петров', 'Пётр', '', '79002222222', 222, 'Подтвержден', 'Нет', '', '', '4500 222222'],
    ['a3', 'Сидоров', 'Сидор', '', '79003333333', 333, 'Требует подтверждения', 'Нет', '', '', ''],
    ['a4', 'Кузнецов', 'Кузьма', '', '79004444444', '', '', 'Нет', '', '', ''],
  ],
  Соревнования: [
    ['ID', 'Название', 'Номер из ЕКП', 'Вид соревнования', 'Дата начала', 'Дата завершения', 'Адрес', 'Рассылка'],
    ['c1', 'Кубок Москвы', '101', 'Пулевая', day(10), day(12), 'Москва', 'до рассылки'],
    ['c2', 'Прошедший кубок', '102', 'Пулевая', day(-5), day(-4), 'Тула', 'до рассылки'],
    ['c3', 'Без даты', '103', 'Стендовая', '', '', 'Казань', 'до рассылки'],
  ],
  Оружие: [
    ['Ид', 'Название', 'Номер'],
    ['w1', 'МР-512', '123'],
    ['w2', 'Benelli', '777'],
  ],
  'Спортсмен/Оружие': [
    ['Спортсмен ид', 'Оружие ид'],
    ['a1', 'w1'],
  ],
  Заявки: [
    APPLICATION_HEADERS,
    application(5, 'a1', 'Новая', '=1+1'),
    application(6, 'a2', 'Новая'),
    application(7, 'a1', 'В работе'),
  ],
  'Архив заявок': [APPLICATION_HEADERS, application(9, 'a1', 'Архив')],
  'Виды транспорта': [['Название'], ['Автомобиль'], ['Поезд']],
});

let gas;
beforeEach(() => {
  gas = createGas(fixture());
});

const load = (user) => gas.get({ action: 'sheets', initData: initDataFor(user) });
const post = (user, action, payload = {}) => gas.post({ action, initData: initDataFor(user), ...payload });
const newApplication = { competitionId: 'c1', items: [{ athleteId: 'a1', weaponIds: ['w1'] }, { athleteId: 'a2', weaponIds: ['w2'] }], transport: ['Автомобиль', 'Поезд'] };

describe('Проверка данных Telegram', () => {
  it('пускает подтверждённого спортсмена', () => {
    const result = load(IVANOV);
    expect(result.status).toBe('success');
    expect(result.athleteId).toBe('a1');
  });

  it('отклоняет подделанную подпись и называет бота', () => {
    const forged = initDataFor(IVANOV).replace(/hash=[0-9a-f]+/, 'hash=' + '0'.repeat(64));
    const result = gas.get({ action: 'sheets', initData: forged });
    expect(result.status).toBe('forbidden');
    expect(result.message).toContain('@test_bot');
  });

  it('отклоняет данные, подписанные другим ботом', () => {
    const other = signTelegram({ user: JSON.stringify(IVANOV) }, '999:OTHER');
    expect(gas.get({ action: 'sheets', initData: other }).status).toBe('forbidden');
  });

  it('сообщает об устаревшей подписи', () => {
    const old = String(Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60);
    const result = gas.get({ action: 'sheets', initData: initDataFor(IVANOV, { auth_date: old }) });
    expect(result.status).toBe('expired');
  });

  it('различает незарегистрированного и ждущего подтверждения', () => {
    expect(load(STRANGER).status).toBe('unregistered');
    expect(load(SIDOROV).status).toBe('pending');
  });
});

describe('Отдача листов приложению', () => {
  it('у чужих спортсменов — только открытые столбцы, своя строка целиком', () => {
    const { headers, rows } = load(IVANOV).sheets['Спортсмены'];
    const byId = Object.fromEntries(rows.map((r) => [r[0], Object.fromEntries(headers.map((h, i) => [h, r[i]]))]));
    expect(byId.a1['Телефон']).toBe('79001111111');
    expect(byId.a1['Паспорт']).toBe('4500 111111');
    expect(byId.a2['Фамилия']).toBe('Петров');
    expect(byId.a2['Перевозчик']).toBe('Нет');
    expect(byId.a2['Телефон']).toBe('');
    expect(byId.a2['ChatId']).toBe('');
    expect(byId.a2['Паспорт']).toBe('');
  });

  it('заявки — только свои', () => {
    const numbers = load(IVANOV).sheets['Заявки'].rows.map((r) => r[0]);
    expect(numbers).toEqual([5, 7]);
  });

  it('соревнования — только предстоящие и без даты', () => {
    const ids = load(IVANOV).sheets['Соревнования'].rows.map((r) => r[0]);
    expect(ids).toEqual(['c1', 'c3']);
  });

  it('не отдаёт листы вне списка приложения', () => {
    const result = gas.get({ action: 'sheets', initData: initDataFor(IVANOV), names: 'Архив заявок,_Журнал,Оружие' });
    expect(Object.keys(result.sheets)).toEqual(['Оружие']);
  });

  it('видит запись через приложение сразу, несмотря на кэш', () => {
    load(IVANOV);
    post(IVANOV, 'saveApplication', { application: newApplication });
    const numbers = load(IVANOV).sheets['Заявки'].rows.map((r) => r[0]);
    expect(numbers).toContain(10);
  });
});

describe('Создание заявки', () => {
  it('собирает строку по ID из справочников', () => {
    const result = post(IVANOV, 'saveApplication', { application: newApplication });
    expect(result.status).toBe('success');
    // Наибольший № — в архиве (9)
    expect(result.number).toBe(10);
    const row = gas.sheet('Заявки').objects().find((r) => r['№'] === 10);
    expect(row['ФИО']).toBe('Иванов Иван Иванович');
    expect(row['Оружие']).toBe('Иванов И.И. : МР-512 - 123\nПетров П. : Benelli - 777');
    expect(row['Вид транспорта']).toBe('Автомобиль;\nПоезд');
    expect(row['Статус']).toBe('Новая');
    expect(row['CreatedBy']).toBe('a1');
    expect(row['Сроки перевозки начало']).toEqual(day(9));
    expect(row['Сроки перевозки окончание']).toEqual(day(13));
    expect(row['Название соревнования']).toBe('Кубок Москвы');
  });

  it('на соревнование без даты — без сроков перевозки', () => {
    post(IVANOV, 'saveApplication', { application: { ...newApplication, competitionId: 'c3' } });
    const row = gas.sheet('Заявки').objects().find((r) => r['№'] === 10);
    expect(row['Сроки перевозки начало']).toBe('');
  });

  it('только перевозчикам', () => {
    const result = post(PETROV, 'saveApplication', { application: newApplication });
    expect(result.status).toBe('error');
    expect(result.message).toContain('только перевозчики');
  });

  it('отклоняет прошедшее соревнование, неизвестное оружие и транспорт, спортсмена без оружия', () => {
    const cases = [
      { ...newApplication, competitionId: 'c2' },
      { ...newApplication, items: [{ athleteId: 'a1', weaponIds: ['нет'] }] },
      { ...newApplication, items: [{ athleteId: 'a1', weaponIds: [] }] },
      { ...newApplication, transport: ['Вертолёт'] },
      { ...newApplication, items: [{ athleteId: 'a1', weaponIds: ['w1'] }, { athleteId: 'a1', weaponIds: ['w2'] }] },
    ];
    for (const application of cases) {
      expect(post(IVANOV, 'saveApplication', { application }).status).toBe('error');
    }
    expect(gas.sheet('Заявки').objects()).toHaveLength(3);
  });

  it('повтор запроса с тем же requestId не создаёт вторую заявку', () => {
    const body = { action: 'saveApplication', initData: initDataFor(IVANOV), requestId: 'r1', application: newApplication };
    const first = gas.post(body);
    const second = gas.post(body);
    expect(second).toEqual(first);
    expect(gas.sheet('Заявки').objects()).toHaveLength(4);
  });
});

describe('Изменение и удаление заявки', () => {
  const edit = { ...newApplication, number: 5, transport: ['Поезд'] };

  it('меняет только столбцы заявки — формулы и прочие столбцы остаются', () => {
    const result = post(IVANOV, 'saveApplication', { application: edit });
    expect(result.status).toBe('success');
    const sheet = gas.sheet('Заявки');
    expect(sheet.values[1][5]).toBe('Поезд');
    expect(sheet.formulas[1][15]).toBe('=1+1');
    expect(sheet.values[1][12]).toBe('Новая');
  });

  it('не меняет чужую и уже взятую в работу заявку', () => {
    expect(post(IVANOV, 'saveApplication', { application: { ...edit, number: 6 } }).message).toContain('не найдена');
    expect(post(IVANOV, 'saveApplication', { application: { ...edit, number: 7 } }).message).toContain('В работе');
  });

  it('удаление переносит заявку в архив со статусом «Удалена»', () => {
    expect(post(IVANOV, 'deleteApplication', { number: 5 }).status).toBe('success');
    expect(gas.sheet('Заявки').objects().map((r) => r['№'])).toEqual([6, 7]);
    const archived = gas.sheet('Архив заявок').objects().find((r) => r['№'] === 5);
    expect(archived['Статус']).toBe('Удалена');
  });

  it('если строки сдвинулись после чтения листа — ничего не меняет и не удаляет', () => {
    const script = gas.run();
    const table = script.__eval("readTable_(spreadsheet_(), 'Заявки')");
    // Оформитель вставил строку над заявкой № 5, пока скрипт работал со старой копией листа
    gas.sheet('Заявки').insertRowBefore(2);
    const row = table.rows.find((r) => r.values[0] === 5);
    expect(() => script.__eval('freshOwnNewRow_')(table, row, 5)).toThrow('сейчас правят');
  });

  it('если оформитель взял заявку в работу после чтения листа — изменение не проходит', () => {
    const script = gas.run();
    const table = script.__eval("readTable_(spreadsheet_(), 'Заявки')");
    gas.sheet('Заявки').values[1][12] = 'В работе';
    const row = table.rows.find((r) => r.values[0] === 5);
    expect(() => script.__eval('freshOwnNewRow_')(table, row, 5)).toThrow('В работе');
  });
});

describe('Доступ по телефону и по ФИО', () => {
  it('привязывает по номеру и подтверждает внесённого вручную', () => {
    const user = { id: 444, first_name: 'Кузьма' };
    const result = post(user, 'linkPhone', { contact: contactFor(444, '+7 (900) 444-44-44') });
    expect(result).toMatchObject({ status: 'success', athleteId: 'a4' });
    const row = gas.sheet('Спортсмены').objects().find((r) => r.ID === 'a4');
    expect(row.ChatId).toBe(444);
    expect(row['Статус']).toBe('Подтвержден');
  });

  it('не принимает чужой номер', () => {
    const user = { id: 444, first_name: 'Кузьма' };
    expect(post(user, 'linkPhone', { contact: contactFor(555, '79004444444') }).status).toBe('error');
  });

  it('номер, привязанный к другому аккаунту, — конфликт', () => {
    expect(post(STRANGER, 'linkPhone', { contact: contactFor(999, '79001111111') }).status).toBe('conflict');
  });

  it('заявка по ФИО — строка «Требует подтверждения»; дубль ФИО отклоняется', () => {
    const contact = contactFor(999, '79009999999');
    expect(post(STRANGER, 'register', { lastName: 'Новиков', firstName: 'Ник', contact }).status).toBe('pending');
    expect(gas.sheet('Спортсмены').objects().at(-1)).toMatchObject({ Фамилия: 'Новиков', Статус: 'Требует подтверждения' });

    const user = { id: 888, first_name: 'Двойник' };
    const twin = post(user, 'register', { lastName: 'ИВАНОВ', firstName: 'Иван', contact: contactFor(888, '79008888888') });
    expect(twin.status).toBe('conflict');
  });

  it('ФИО, похожее на формулу, пишется в таблицу текстом', () => {
    const contact = contactFor(999, '79009999999');
    post(STRANGER, 'register', { lastName: '=IMPORTXML("http://evil")', firstName: 'Ник', contact });
    const sheet = gas.sheet('Спортсмены');
    const last = sheet.values.length - 1;
    expect(sheet.formulas[last][1]).toBe('');
    expect(sheet.values[last][1]).toBe('=IMPORTXML("http://evil")');
  });
});

describe('Закрепление оружия и настройки', () => {
  it('закрепляет и открепляет', () => {
    expect(post(PETROV, 'assignWeapon', { weaponId: 'w2' }).link).toEqual({ athleteId: 'a2', weaponId: 'w2' });
    expect(gas.sheet('Спортсмен/Оружие').objects()).toHaveLength(2);
    expect(post(PETROV, 'unassignWeapon', { weaponId: 'w2' }).status).toBe('success');
    expect(gas.sheet('Спортсмен/Оружие').objects()).toEqual([{ 'Спортсмен ид': 'a1', 'Оружие ид': 'w1' }]);
  });

  it('настройки уведомлений — только перевозчику', () => {
    const result = post(IVANOV, 'setNotifications', { notifications: { competitions: false } });
    expect(result.fields).toEqual({ 'Сообщать о соревнованиях': 'Нет' });
    expect(post(PETROV, 'setNotifications', { notifications: { competitions: false } }).status).toBe('error');
  });
});

describe('Уведомления при ручной правке', () => {
  const messages = () => gas.telegram.filter((r) => r.url.endsWith('/sendMessage'));

  it('о подтверждении доступа — один раз, повторная вставка блока не повторяет', () => {
    // Статус Сидорова (строка 4, столбец 7) сменили на «Подтвержден»
    gas.edit('Спортсмены', 4, 7, [['Подтвержден']], 'Требует подтверждения');
    expect(messages().map((m) => m.payload.chat_id)).toEqual(['333']);

    // Вставили блок статусов поверх всех строк — статусы не изменились, сообщений нет
    gas.edit('Спортсмены', 2, 7, [['Подтвержден'], ['Подтвержден'], ['Подтвержден']]);
    expect(messages()).toHaveLength(1);
  });

  it('статус вернули после блокировки — сообщение уходит снова', () => {
    gas.edit('Спортсмены', 3, 7, [['Заблокирован']], 'Подтвержден');
    gas.edit('Спортсмены', 3, 7, [['Подтвержден']], 'Заблокирован');
    expect(messages().map((m) => m.payload.chat_id)).toEqual(['222']);
  });

  it('о смене статуса заявки — автору, если он не отключил', () => {
    gas.edit('Заявки', 2, 13, [['В работе']], 'Новая');
    expect(messages().map((m) => m.payload.chat_id)).toEqual(['111']);

    post(IVANOV, 'setNotifications', { notifications: { applications: false } });
    gas.edit('Заявки', 2, 13, [['Выполнена']], 'В работе');
    expect(messages()).toHaveLength(1);
  });

  it('о новом соревновании — перевозчикам, один раз', () => {
    gas.edit('Соревнования', 5, 1, [['c9', 'Новый кубок', '200', 'Пулевая', day(20), day(21), 'Сочи', '']]);
    const sent = messages();
    expect(sent.map((m) => m.payload.chat_id)).toEqual(['111']);
    expect(sent[0].payload.reply_markup.inline_keyboard[0][0].web_app.url).toBe(
      'https://example.org/app/?page=application-form&competition=c9',
    );
    expect(gas.sheet('Соревнования').values[4][7]).toBeInstanceOf(Date);

    gas.edit('Соревнования', 5, 7, [['Сочи, стадион']], 'Сочи');
    expect(messages()).toHaveLength(1);
  });

  it('строке, внесённой вручную, выдаётся ID', () => {
    gas.edit('Оружие', 4, 2, [['Beretta', '555']]);
    expect(String(gas.sheet('Оружие').values[3][0])).toMatch(/^[0-9a-z]{8,}$/);
  });
});

describe('Утилиты', () => {
  it('safeCell_ экранирует то, что Таблицы приняли бы за формулу', () => {
    const { safeCell_ } = gas.run();
    expect(['=A1', '+7', '-1', '@x', 'Иванов', 5].map(safeCell_)).toEqual(["'=A1", "'+7", "'-1", "'@x", 'Иванов', 5]);
  });

  it('normalizePhone_ приводит номер к 7XXXXXXXXXX', () => {
    const { normalizePhone_ } = gas.run();
    expect(['+7 (900) 123-45-67', '89001234567', '9001234567'].map(normalizePhone_)).toEqual(Array(3).fill('79001234567'));
  });

  it('sheetDate_ разбирает дд.мм.гггг и отбрасывает неверные даты', () => {
    const { sheetDate_ } = gas.run();
    expect(sheetDate_('05.03.2027')).toEqual(new Date(2027, 2, 5));
    expect(sheetDate_('31.02.2027')).toBeNull();
    expect(sheetDate_('скоро')).toBeNull();
  });
});
