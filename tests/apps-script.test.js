import { beforeEach, describe, expect, it } from 'vitest';
import { contactFor, createGas, initDataFor, signTelegram } from './gas.js';

// Даты — полночь по Москве (тесты запускаются с TZ=Europe/Moscow, как часовой пояс скрипта)
const day = (offset) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
};

const IVANOV = { id: 111, first_name: 'Иван' }; // перевозчик
const PETROV = { id: 222, first_name: 'Пётр' }; // подтверждён, не перевозчик, администратор
const SIDOROV = { id: 333, first_name: 'Сидор' }; // ждёт подтверждения
const STRANGER = { id: 999, first_name: 'Незнакомец' };

const APPLICATION_HEADERS = [
  '№', 'ФИО', 'Оружие', 'Сроки перевозки начало', 'Сроки перевозки окончание', 'Вид транспорта', 'Вид соревнования',
  'Название соревнования', 'Номер в ЕКП', 'Сроки по ЕКП начало', 'Сроки по ЕКП окончание', 'Адрес', 'Статус',
  'CreatedBy', 'CreatedAt', 'Примечание', 'Причина отклонения',
];

const application = (number, author, status, note = '') => [
  number, 'ФИО', 'Иванов И.И. : МР-512 - 123', '', '', 'Автомобиль', 'Пулевая', 'Кубок', '1', '', '', 'Москва',
  status, author, day(-1), note, '',
];

const fixture = () => ({
  Спортсмены: [
    ['ID', 'Фамилия', 'Имя', 'Отчество', 'Телефон', 'ChatId', 'Статус', 'Перевозчик', 'Сообщать о соревнованиях', 'Сообщать о заявках', 'Паспорт', 'Администратор'],
    ['a1', 'Иванов', 'Иван', 'Иванович', '79001111111', 111, 'Подтвержден', 'Да', '', '', '4500 111111', ''],
    ['a2', 'Петров', 'Пётр', '', '79002222222', 222, 'Подтвержден', 'Нет', '', '', '4500 222222', 'Да'],
    ['a3', 'Сидоров', 'Сидор', '', '79003333333', 333, 'Требует подтверждения', 'Нет', '', '', '', 'Да'],
    ['a4', 'Кузнецов', 'Кузьма', '', '79004444444', '', '', 'Нет', '', '', '', ''],
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

const load = (user, extra = {}) => gas.post({ action: 'sheets', initData: initDataFor(user), ...extra });
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
    const result = gas.post({ action: 'sheets', initData: forged });
    expect(result.status).toBe('forbidden');
    expect(result.message).toContain('@test_bot');
  });

  it('отклоняет данные, подписанные другим ботом', () => {
    const other = signTelegram({ user: JSON.stringify(IVANOV) }, '999:OTHER');
    expect(gas.post({ action: 'sheets', initData: other }).status).toBe('forbidden');
  });

  it('сообщает об устаревшей подписи', () => {
    const old = String(Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60);
    const result = gas.post({ action: 'sheets', initData: initDataFor(IVANOV, { auth_date: old }) });
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
    const result = load(IVANOV, { names: ['Архив заявок', '_Журнал', 'Оружие'] });
    expect(Object.keys(result.sheets)).toEqual(['Оружие']);
  });

  it('пустой список листов — все листы приложения', () => {
    expect(Object.keys(load(IVANOV, { names: [] }).sheets)).toHaveLength(6);
  });

  it('старые версии приложения загружают через GET', () => {
    const result = gas.get({ action: 'sheets', initData: initDataFor(IVANOV), names: 'Оружие,Заявки', fresh: '1' });
    expect(result.status).toBe('success');
    expect(Object.keys(result.sheets)).toEqual(['Оружие', 'Заявки']);
  });

  it('fresh читает таблицу мимо кэша скрипта', () => {
    load(IVANOV);
    // Правка, о которой скрипт не узнал (например, сделанная другим скриптом), — в кэше старая копия
    gas.sheet('Оружие').appendRow(['w9', 'Новое', '999']);
    expect(load(IVANOV).sheets['Оружие'].rows).toHaveLength(2);
    expect(load(IVANOV, { fresh: true }).sheets['Оружие'].rows).toHaveLength(3);
  });

  it('загрузка не запоминается по requestId — повтор отдаёт свежие данные', () => {
    load(IVANOV, { requestId: 'same' });
    post(IVANOV, 'assignWeapon', { weaponId: 'w2' });
    const links = load(IVANOV, { requestId: 'same' }).sheets['Спортсмен/Оружие'].rows;
    expect(links).toHaveLength(2);
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

  it('одна и та же единица оружия, переданная дважды, записывается один раз', () => {
    const items = [{ athleteId: 'a1', weaponIds: ['w1', 'w1'] }];
    post(IVANOV, 'saveApplication', { application: { ...newApplication, items } });
    const row = gas.sheet('Заявки').objects().find((r) => r['№'] === 10);
    expect(row['Оружие']).toBe('Иванов И.И. : МР-512 - 123');
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

  it('не принимает чужой номер — и не сбрасывает кэш листов, раз ничего не записано', () => {
    const user = { id: 444, first_name: 'Кузьма' };
    load(IVANOV);
    const generation = gas.cache.get('gen:Спортсмены');
    expect(post(user, 'linkPhone', { contact: contactFor(555, '79004444444') }).status).toBe('error');
    expect(gas.cache.get('gen:Спортсмены')).toBe(generation);
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

describe('Администрирование', () => {
  const messages = () => gas.telegram.filter((r) => r.url.endsWith('/sendMessage'));
  const appRow = (number) => gas.sheet('Заявки').objects().find((r) => r['№'] === number);
  const isoDay = (offset) => day(offset).toLocaleDateString('sv-SE');
  const setStatus = (number, from, status, reason) =>
    post(PETROV, 'adminSetApplicationStatus', { number, from, status, reason });

  it('администратору — все заявки, все соревнования и все столбцы спортсменов', () => {
    const { sheets } = load(PETROV);
    expect(sheets['Заявки'].rows.map((r) => r[0])).toEqual([5, 6, 7]);
    expect(sheets['Соревнования'].rows.map((r) => r[0])).toEqual(['c1', 'c2', 'c3']);
    const phone = sheets['Спортсмены'].headers.indexOf('Телефон');
    expect(sheets['Спортсмены'].rows.find((r) => r[0] === 'a1')[phone]).toBe('79001111111');
  });

  it('не администратору и неподтверждённому администратору — отказ', () => {
    for (const user of [IVANOV, SIDOROV]) {
      const result = post(user, 'adminSetApplicationStatus', { number: 5, from: 'Новая', status: 'В работе' });
      expect(result.status).toBe('error');
    }
    expect(post(IVANOV, 'adminExportApplications', {}).message).toContain('только администраторам');
    expect(appRow(5)['Статус']).toBe('Новая');
  });

  it('статус — только вперёд по жизненному циклу, автору — сообщение', () => {
    expect(setStatus(5, 'Новая', 'Выполнена').message).toContain('нельзя перевести');
    expect(setStatus(7, 'В работе', 'Новая').message).toContain('нельзя перевести');

    const result = setStatus(5, 'Новая', 'В работе');
    expect(result.status).toBe('success');
    expect(result.row['Статус']).toBe('В работе');
    expect(appRow(5)['Статус']).toBe('В работе');
    expect(messages().map((m) => m.payload.chat_id)).toEqual(['111']);

    // Тот же статус потом вставили в таблице вручную — второго сообщения нет
    gas.edit('Заявки', 2, 13, [['В работе']], 'Новая');
    expect(messages()).toHaveLength(1);

    expect(setStatus(5, 'В работе', 'Выполнена').status).toBe('success');
    expect(messages()).toHaveLength(2);
  });

  it('статус уже изменили в таблице — смена не проходит', () => {
    gas.sheet('Заявки').values[1][12] = 'В работе';
    expect(setStatus(5, 'Новая', 'В работе').message).toContain('уже изменён');
  });

  it('отклонение — с причиной; взятие отклонённой в работу очищает причину', () => {
    expect(setStatus(7, 'В работе', 'Отклонена', '  ').message).toContain('причину');
    expect(appRow(7)['Статус']).toBe('В работе');

    expect(setStatus(7, 'В работе', 'Отклонена', 'Нет разрешения').status).toBe('success');
    expect(appRow(7)).toMatchObject({ Статус: 'Отклонена', 'Причина отклонения': 'Нет разрешения' });
    expect(messages().at(-1).payload.text).toContain('Причина: Нет разрешения');

    expect(setStatus(7, 'Отклонена', 'В работе').status).toBe('success');
    expect(appRow(7)).toMatchObject({ Статус: 'В работе', 'Причина отклонения': '' });
    expect(messages()).toHaveLength(2);
  });

  it('правка заявки: участники, транспорт, сроки, адрес; ФИО, статус и прочие столбцы не меняются', () => {
    const application = {
      number: 5,
      items: [{ athleteId: 'a2', weaponIds: ['w2'] }],
      transport: ['Поезд'],
      transportStart: isoDay(3),
      transportEnd: isoDay(4),
      address: 'Тула, тир',
    };
    const result = post(PETROV, 'adminSaveApplication', { application });
    expect(result.status).toBe('success');
    expect(appRow(5)).toMatchObject({
      ФИО: 'ФИО',
      Оружие: 'Петров П. : Benelli - 777',
      'Вид транспорта': 'Поезд',
      'Сроки перевозки начало': day(3),
      'Сроки перевозки окончание': day(4),
      Адрес: 'Тула, тир',
      'Название соревнования': 'Кубок',
      Статус: 'Новая',
      CreatedBy: 'a1',
    });
    expect(gas.sheet('Заявки').formulas[1][15]).toBe('=1+1');
  });

  it('правка заявки: соревнование выбрано заново — его поля из справочника, и прошедшее тоже', () => {
    const application = { number: 7, competitionId: 'c2', items: [{ athleteId: 'a1', weaponIds: ['w1'] }], transport: ['Автомобиль'], address: 'Тула' };
    expect(post(PETROV, 'adminSaveApplication', { application }).status).toBe('success');
    expect(appRow(7)).toMatchObject({ 'Название соревнования': 'Прошедший кубок', 'Номер в ЕКП': '102', 'Сроки по ЕКП начало': day(-5), Статус: 'В работе' });

    const bad = { ...application, transportStart: isoDay(5), transportEnd: isoDay(1) };
    expect(post(PETROV, 'adminSaveApplication', { application: bad }).message).toContain('раньше начала');
  });

  it('выгрузка: отбор по срокам ЕКП, без служебных столбцов, файл — в чат', () => {
    const sheet = gas.sheet('Заявки');
    sheet.values[1][9] = day(10); // № 5
    sheet.values[1][10] = day(12);
    sheet.values[2][9] = '20.01.2099'; // № 6 — дата текстом, вне периода
    // № 7 — без даты по ЕКП

    const result = post(PETROV, 'adminExportApplications', { from: isoDay(5), to: isoDay(10) });
    expect(result).toMatchObject({ status: 'success', count: 1 });
    const sent = gas.telegram.find((r) => r.url.endsWith('/sendDocument'));
    expect(sent.payload.chat_id).toBe('222');
    expect(sent.payload.caption).toContain('Без даты по ЕКП не вошли: 1');
    const xml = sent.payload.document.files['xl/worksheets/sheet1.xml'];
    expect(xml).toContain('Иванов И.И. : МР-512 - 123');
    expect(xml).toContain('Причина отклонения');
    expect(xml).not.toContain('CreatedBy');
    expect(xml.match(/<row /g)).toHaveLength(2);
    expect(Object.keys(sent.payload.document.files)).toContain('xl/styles.xml');

    // Без периода — все заявки
    expect(post(PETROV, 'adminExportApplications', {}).count).toBe(3);
    // Пустой период — файл не отправляется
    expect(post(PETROV, 'adminExportApplications', { from: isoDay(100), to: isoDay(101) }).count).toBe(0);
    expect(gas.telegram.filter((r) => r.url.endsWith('/sendDocument'))).toHaveLength(2);
  });
});

describe('Администрирование: спортсмены', () => {
  const messages = () => gas.telegram.filter((r) => r.url.endsWith('/sendMessage'));
  const athleteRow = (id) => gas.sheet('Спортсмены').objects().find((r) => r.ID === id);
  const save = (athleteId, fields, user = PETROV) => post(user, 'adminSaveAthlete', { athleteId, fields });

  it('подтверждение — сообщение спортсмену; ручная вставка того же статуса не повторяет', () => {
    const result = save('a3', { Статус: 'Подтвержден' });
    expect(result.status).toBe('success');
    expect(result.row['Статус']).toBe('Подтвержден');
    expect(messages().map((m) => m.payload.chat_id)).toEqual(['333']);
    expect(messages()[0].payload.text).toContain('доступ к приложению подтверждён');

    gas.edit('Спортсмены', 4, 7, [['Подтвержден']], 'Требует подтверждения');
    expect(messages()).toHaveLength(1);
  });

  it('правит ФИО, признаки и прочие столбцы; формулу пишет текстом', () => {
    expect(save('a4', { Фамилия: '  Новиков ', Перевозчик: 'Да', Администратор: 'Нет', Паспорт: '=IMPORTXML(1)' }).status).toBe('success');
    expect(athleteRow('a4')).toMatchObject({ Фамилия: 'Новиков', Перевозчик: 'Да', Администратор: 'Нет', Паспорт: '=IMPORTXML(1)' });
    expect(gas.sheet('Спортсмены').formulas[4][10]).toBe('');
  });

  it('телефон, ChatId и ID не меняются; значения проверяются; дубли ФИО не допускаются', () => {
    expect(save('a4', { Телефон: '79000000000' }).message).toContain('только в таблице');
    expect(save('a4', { ChatId: '1' }).message).toContain('только в таблице');
    expect(save('a4', { ID: 'x' }).message).toContain('только в таблице');
    expect(save('a4', { Статус: 'Заблокирован' }).message).toContain('Неизвестный статус');
    expect(save('a4', { Перевозчик: 'да' }).message).toContain('«Да» или «Нет»');
    expect(save('a4', { Фамилия: 'Иванов', Имя: 'Иван' }).message).toContain('уже есть в списке');
    expect(save('a4', { Фамилия: '' }).message).toContain('фамилию и имя');
    expect(athleteRow('a4')['Фамилия']).toBe('Кузнецов');
  });

  it('себе нельзя снять признак администратора и сменить статус; не администратору — отказ', () => {
    expect(save('a2', { Администратор: 'Нет' }).message).toContain('с себя нельзя');
    expect(save('a2', { Статус: 'Архив' }).message).toContain('Свой статус');
    expect(save('a2', { Отчество: 'Петрович' }).status).toBe('success');
    expect(save('a4', { Фамилия: 'Новиков' }, IVANOV).message).toContain('только администраторам');
  });

  it('удаление: закрепления удаляются, заявки — в архив с прежним статусом; себя удалить нельзя', () => {
    expect(post(PETROV, 'adminDeleteAthlete', { athleteId: 'a2' }).message).toContain('себя');

    const result = post(PETROV, 'adminDeleteAthlete', { athleteId: 'a1' });
    expect(result).toMatchObject({ status: 'success', applications: ['5', '7'], links: 1 });
    expect(athleteRow('a1')).toBeUndefined();
    expect(gas.sheet('Спортсмен/Оружие').objects()).toEqual([]);
    expect(gas.sheet('Заявки').objects().map((r) => r['№'])).toEqual([6]);
    const archived = gas.sheet('Архив заявок').objects();
    expect(archived.map((r) => [r['№'], r['Статус']])).toEqual([[9, 'Архив'], [5, 'Новая'], [7, 'В работе']]);
    // В архив — одной записью; строки 5 и 7 не подряд — два удаления
    expect(gas.sheet('Архив заявок').calls).toEqual([]);
    expect(gas.sheet('Заявки').calls).toEqual(['deleteRows', 'deleteRows']);
  });

  it('удаление: подряд идущие строки — одним вызовом; архиву не хватает строк сетки — они добавляются', () => {
    const applications = gas.sheet('Заявки');
    applications.values[2][APPLICATION_HEADERS.indexOf('CreatedBy')] = 'a1'; // заявка № 6 — тоже Иванова
    gas.sheet('Архив заявок').maxRows = 2;

    expect(post(PETROV, 'adminDeleteAthlete', { athleteId: 'a1' })).toMatchObject({ status: 'success', applications: ['5', '6', '7'] });
    expect(applications.calls).toEqual(['deleteRows']);
    expect(applications.objects()).toEqual([]);
    expect(gas.sheet('Архив заявок').calls).toEqual(['insertRowsAfter']);
    expect(gas.sheet('Архив заявок').objects().map((r) => r['№'])).toEqual([9, 5, 6, 7]);
  });
});

describe('Администрирование: соревнования', () => {
  const messages = () => gas.telegram.filter((r) => r.url.endsWith('/sendMessage'));
  const isoDay = (offset) => day(offset).toLocaleDateString('sv-SE');
  const competition = { title: 'Кубок области', ekpNumber: '300', kind: 'Пулевая', start: isoDay(20), end: isoDay(22), address: 'Тверь' };

  it('создание: строка с ID и датами, рассылка перевозчикам один раз', () => {
    const result = post(PETROV, 'adminSaveCompetition', { competition });
    expect(result).toMatchObject({ status: 'success', created: true, notified: true });
    const row = gas.sheet('Соревнования').objects().find((r) => r.ID === result.id);
    expect(row).toMatchObject({ Название: 'Кубок области', 'Номер из ЕКП': '300', 'Дата начала': day(20), 'Дата завершения': day(22), Адрес: 'Тверь' });
    expect(row['Рассылка']).toBeInstanceOf(Date);
    expect(result.row['Рассылка']).toMatch(/^\d{4}-/); // в JSON-ответе дата — ISO-строкой
    expect(messages().map((m) => m.payload.chat_id)).toEqual(['111']);
    // Рассылка — после снятия блокировки записи: запросы других пользователей её не ждут
    expect(messages().every((m) => !m.scriptLocked)).toBe(true);

    // Правка того же соревнования рассылку не повторяет
    expect(post(PETROV, 'adminSaveCompetition', { competition: { ...competition, id: result.id, address: 'Тверь, тир' } }).notified).toBe(false);
    expect(messages()).toHaveLength(1);
  });

  it('повтор с тем же requestId: ответ уже с итогом рассылки, второй рассылки нет', () => {
    const body = { action: 'adminSaveCompetition', initData: initDataFor(PETROV), requestId: 'c-1', competition };
    const first = gas.post(body);
    expect(first).toMatchObject({ status: 'success', notified: true });
    expect(gas.post(body)).toEqual(first);
    expect(gas.sheet('Соревнования').objects().filter((r) => r['Название'] === 'Кубок области')).toHaveLength(1);
    expect(messages()).toHaveLength(1);
  });

  it('сбой рассылки не отменяет сохранение', () => {
    gas.failTelegram('DNS error');
    const result = post(PETROV, 'adminSaveCompetition', { competition });
    expect(result).toMatchObject({ status: 'success', created: true, notified: false });
    const row = gas.sheet('Соревнования').objects().find((r) => r.ID === result.id);
    expect(row['Рассылка']).toBe(''); // не отмечена — рассылку можно повторить
    expect(gas.sheet('_Журнал').objects().some((r) => JSON.stringify(r).includes('DNS error'))).toBe(true);
  });

  it('без адреса — без рассылки (как у триггера); правка не трогает заявки', () => {
    expect(post(PETROV, 'adminSaveCompetition', { competition: { ...competition, address: '' } }).notified).toBe(false);
    expect(messages()).toHaveLength(0);

    expect(post(PETROV, 'adminSaveCompetition', { competition: { ...competition, id: 'c1', title: 'Кубок Москвы — финал' } }).status).toBe('success');
    expect(gas.sheet('Соревнования').objects().find((r) => r.ID === 'c1')['Название']).toBe('Кубок Москвы — финал');
    expect(gas.sheet('Заявки').objects()[0]['Название соревнования']).toBe('Кубок');
  });

  it('проверки: название, порядок дат, существование', () => {
    expect(post(PETROV, 'adminSaveCompetition', { competition: { ...competition, title: ' ' } }).message).toContain('название');
    expect(post(PETROV, 'adminSaveCompetition', { competition: { ...competition, end: isoDay(1) } }).message).toContain('раньше');
    expect(post(PETROV, 'adminSaveCompetition', { competition: { ...competition, id: 'нет' } }).message).toContain('не найдено');
    expect(post(IVANOV, 'adminSaveCompetition', { competition }).status).toBe('error');
  });
});

describe('Администрирование: оружие', () => {
  const weapons = () => gas.sheet('Оружие').objects();
  const links = () => gas.sheet('Спортсмен/Оружие').objects();

  it('справочник: пара «Название + Номер» уникальна без учёта регистра и пробелов, номер — нет', () => {
    expect(post(PETROV, 'adminSaveWeapon', { weapon: { title: ' мр-512 ', number: '123' } }).message).toContain('уже есть');
    const created = post(PETROV, 'adminSaveWeapon', { weapon: { title: 'Benelli', number: '123' } });
    expect(created).toMatchObject({ status: 'success', created: true, row: { Название: 'Benelli', Номер: '123' } });
    expect(weapons()).toHaveLength(3);

    expect(post(PETROV, 'adminSaveWeapon', { weapon: { id: 'w2', title: 'Benelli', number: '123' } }).message).toContain('уже есть');
    expect(post(PETROV, 'adminSaveWeapon', { weapon: { id: 'w2', title: 'Benelli M2', number: '777' } }).status).toBe('success');
    expect(weapons().find((w) => w['Ид'] === 'w2')['Название']).toBe('Benelli M2');
    expect(post(PETROV, 'adminSaveWeapon', { weapon: { title: 'Без номера', number: '' } }).message).toContain('номер');
  });

  it('удаление единицы удаляет и её закрепления', () => {
    expect(post(PETROV, 'adminDeleteWeapon', { weaponId: 'w1' })).toMatchObject({ status: 'success', links: 1 });
    expect(weapons().map((w) => w['Ид'])).toEqual(['w2']);
    expect(links()).toEqual([]);
  });

  it('закрепление за любым спортсменом; новая единица заводится в справочнике, существующая пара — берётся она', () => {
    expect(post(PETROV, 'adminAssignWeapon', { athleteId: 'a4', weaponId: 'w2' }).link).toEqual({ athleteId: 'a4', weaponId: 'w2' });

    const added = post(PETROV, 'adminAssignWeapon', { athleteId: 'a4', newWeapon: { title: 'Beretta', number: '555' } });
    expect(added.weaponRow).toMatchObject({ Название: 'Beretta', Номер: '555' });
    expect(weapons()).toHaveLength(3);

    const same = post(PETROV, 'adminAssignWeapon', { athleteId: 'a4', newWeapon: { title: 'МР-512', number: '123' } });
    expect(same).toMatchObject({ link: { weaponId: 'w1' }, weaponRow: null });
    expect(weapons()).toHaveLength(3);
    expect(links().filter((l) => l['Спортсмен ид'] === 'a4')).toHaveLength(3);

    expect(post(PETROV, 'adminUnassignWeapon', { athleteId: 'a4', weaponId: 'w2' }).status).toBe('success');
    expect(links().filter((l) => l['Спортсмен ид'] === 'a4')).toHaveLength(2);
    expect(post(IVANOV, 'adminAssignWeapon', { athleteId: 'a4', weaponId: 'w2' }).status).toBe('error');
  });
});

describe('Перенос заявок в архив', () => {
  const START = APPLICATION_HEADERS.indexOf('Сроки по ЕКП начало');
  const END = APPLICATION_HEADERS.indexOf('Сроки по ЕКП окончание');
  const archive = () => gas.run().__eval('archivePastApplications()');
  const setEkp = (row, start, end) => {
    gas.sheet('Заявки').values[row][START] = start;
    gas.sheet('Заявки').values[row][END] = end;
  };

  it('со следующего дня после окончания по ЕКП — в архив с прежним статусом; без даты — остаются', () => {
    setEkp(1, day(-3), day(-1)); // № 5 «Новая»: закончилось вчера
    setEkp(2, day(-2), day(0)); // № 6: последний день — сегодня
    setEkp(3, '20.01.2000', ''); // № 7 «В работе»: окончания нет, начало давно (текстом)
    gas.props.put('notified:Заявки:7', 'В работе');
    const generation = gas.cache.get('gen:Заявки');

    expect(archive()).toBe(2);
    expect(gas.sheet('Заявки').objects().map((r) => r['№'])).toEqual([6]);
    const archived = gas.sheet('Архив заявок').objects();
    expect(archived.map((r) => [r['№'], r['Статус']])).toEqual([[9, 'Архив'], [5, 'Новая'], [7, 'В работе']]);
    expect(gas.props.get('notified:Заявки:7')).toBeNull();
    expect(gas.cache.get('gen:Заявки')).not.toBe(generation);
    const log = gas.sheet('_Журнал').objects().find((r) => r['Событие'] === 'Перенос заявок в архив');
    expect(log['Подробности']).toContain('№ 5, 7');

    // Повторный запуск — переносить нечего
    expect(archive()).toBe(0);
  });

  it('нет прошедших — ничего не меняется и журнал не пишется', () => {
    expect(archive()).toBe(0); // в фикстуре даты по ЕКП пусты
    expect(gas.sheet('Заявки').objects()).toHaveLength(3);
    expect(gas.sheet('_Журнал')).toBeNull();
  });
});

describe('Лимиты Google', () => {
  const events = (name) => (gas.sheet('_Журнал')?.objects() ?? []).filter((r) => r['Событие'] === name);
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
  const setStatus = (number, from, status) => post(PETROV, 'adminSetApplicationStatus', { number, from, status });

  it('ошибка лимита — в «_Журнал», одна и та же не чаще раза в час', () => {
    gas.failTelegram('Service invoked too many times for one day: urlfetch.');
    expect(setStatus(5, 'Новая', 'В работе').status).toBe('error');
    expect(setStatus(7, 'В работе', 'Выполнена').status).toBe('error');
    const logged = events('Лимит Google исчерпан');
    expect(logged).toHaveLength(1);
    expect(logged[0]['Подробности']).toContain('Запрос приложения: Service invoked too many times');
  });

  it('прочие ошибки лимитом не считаются', () => {
    gas.failTelegram('DNS error');
    setStatus(5, 'Новая', 'В работе');
    expect(events('Лимит Google исчерпан')).toHaveLength(0);
  });

  it('запросы к Telegram считаются; при 70% лимита — «Лимит близко» один раз', () => {
    setStatus(5, 'Новая', 'В работе');
    expect(gas.cache.get('urlfetch:' + today())).toBe('1');

    gas.cache.put('urlfetch:' + today(), 13999);
    setStatus(7, 'В работе', 'Выполнена');
    expect(gas.cache.get('urlfetch:' + today())).toBe('14000');
    expect(events('Лимит близко')).toHaveLength(1);
    expect(events('Лимит близко')[0]['Подробности']).toContain('14000 из 20000 (70%)');

    setStatus(5, 'В работе', 'Выполнена');
    expect(events('Лимит близко')).toHaveLength(1);
  });

  it('отчёт checkSetup: счётчик, свойства, копии листов, ячейки', () => {
    gas.cache.put('urlfetch:' + today(), 15000);
    const lines = gas.run().__eval('limitsReport_(spreadsheet_())');
    expect(lines[0]).toBe('Запросы к Telegram за сегодня (счётчик скрипта): ⚠ 15000 из 20000 (75%)');
    expect(lines[1]).toMatch(/^Свойства скрипта, байт: \d+ из 512000 \(0%\)/);
    expect(lines.some((l) => l.startsWith('Лист «Заявки» для кэша, символов: '))).toBe(true);
    expect(lines.at(-1)).toMatch(/^Ячеек в таблице \(с пустыми\): \d+ из 10000000/);
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
    expect(sheetDate_('05.03.2027 10:30')).toEqual(new Date(2027, 2, 5, 10, 30));
    expect(sheetDate_('31.02.2027')).toBeNull();
    expect(sheetDate_('скоро')).toBeNull();
  });
});
