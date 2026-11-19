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
  'CreatedBy', 'CreatedAt', 'Примечание', 'Причина отклонения', 'ID участников',
];

const application = (number, author, status, note = '', participants = '') => [
  number, 'ФИО', 'Иванов И.И. : МР-512 - 123', '', '', 'Автомобиль', 'Пулевая', 'Кубок', '1', '', '', 'Москва',
  status, author, day(-1), note, '', participants,
];
const PARTICIPANTS = APPLICATION_HEADERS.indexOf('ID участников');

const fixture = () => ({
  Спортсмены: [
    ['ID', 'Фамилия', 'Имя', 'Отчество', 'Телефон', 'ChatId', 'Статус', 'Перевозчик', 'Сообщать о соревнованиях', 'Сообщать о заявках', 'Паспорт', 'Администратор'],
    ['a1', 'Иванов', 'Иван', 'Иванович', '79001111111', 111, 'Подтвержден', 'Да', '', '', '4500 111111', ''],
    ['a2', 'Петров', 'Пётр', '', '79002222222', 222, 'Подтвержден', 'Нет', '', '', '4500 222222', 'Да'],
    ['a3', 'Сидоров', 'Сидор', '', '79003333333', 333, 'Требует подтверждения', 'Нет', '', '', '', 'Да'],
    ['a4', 'Кузнецов', 'Кузьма', '', '79004444444', '', '', 'Нет', '', '', '', ''],
  ],
  Соревнования: [
    ['ID', 'Название', 'Номер из ЕКП', 'Вид соревнования', 'Дата начала', 'Дата завершения', 'Адрес', 'Рассылка', 'Выезд одним днём'],
    ['c1', 'Кубок Москвы', '101', 'Пулевая', day(10), day(12), 'Москва', 'до рассылки', ''],
    ['c2', 'Прошедший кубок', '102', 'Пулевая', day(-5), day(-4), 'Тула', 'до рассылки', ''],
    ['c3', 'Без даты', '103', 'Стендовая', '', '', 'Казань', 'до рассылки', ''],
  ],
  Оружие: [
    ['Ид', 'Название', 'Номер'],
    ['w1', 'МР-512', '123'],
    ['w2', 'Benelli', '777'],
  ],
  'Спортсмен/Оружие': [
    ['Спортсмен ид', 'Оружие ид'],
    ['a1', 'w1'],
    ['a2', 'w2'],
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

  it('заявки — и те, где спортсмен участник (ID через «;»)', () => {
    const sheet = gas.sheet('Спортсмены');
    sheet.values[2][11] = 'Нет'; // Петров — не администратор: ему видна не вся таблица
    gas.sheet('Заявки').values[3][PARTICIPANTS] = 'a4;a2 '; // № 7 Иванова: участники Кузнецов и Петров
    expect(load(PETROV).sheets['Заявки'].rows.map((r) => r[0])).toEqual([6, 7]);
    // ID, в котором содержится чужой, не подходит: «a22» — не «a2»
    gas.sheet('Заявки').values[3][PARTICIPANTS] = 'a22';
    expect(load(PETROV, { fresh: true }).sheets['Заявки'].rows.map((r) => r[0])).toEqual([6]);
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
    post(PETROV, 'unassignWeapon', { weaponId: 'w2' });
    const links = load(IVANOV, { requestId: 'same' }).sheets['Спортсмен/Оружие'].rows;
    expect(links).toHaveLength(1);
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
    // Участники — без автора
    expect(row['ID участников']).toBe('a2');
    expect(row['Сроки перевозки начало']).toEqual(day(9));
    expect(row['Сроки перевозки окончание']).toEqual(day(13));
    expect(row['Название соревнования']).toBe('Кубок Москвы');
  });

  it('на соревнование без даты — без сроков перевозки', () => {
    post(IVANOV, 'saveApplication', { application: { ...newApplication, competitionId: 'c3' } });
    const row = gas.sheet('Заявки').objects().find((r) => r['№'] === 10);
    expect(row['Сроки перевозки начало']).toBe('');
  });

  describe('выезд одним днём', () => {
    const isoDay = (offset) => day(offset).toLocaleDateString('sv-SE');
    const ONE_DAY = 8; // столбец «Выезд одним днём»
    beforeEach(() => {
      gas.sheet('Соревнования').values[1][ONE_DAY] = 'да';
    });

    it('сроки перевозки — выбранная дата', () => {
      const result = post(IVANOV, 'saveApplication', { application: { ...newApplication, transportDate: isoDay(11) } });
      expect(result.status).toBe('success');
      const row = gas.sheet('Заявки').objects().find((r) => r['№'] === 10);
      expect(row['Сроки перевозки начало']).toEqual(day(11));
      expect(row['Сроки перевозки окончание']).toEqual(day(11));
      // Границы периода тоже подходят
      expect(post(IVANOV, 'saveApplication', { application: { ...newApplication, transportDate: isoDay(10) } }).status).toBe('success');
      expect(post(IVANOV, 'saveApplication', { application: { ...newApplication, transportDate: isoDay(12) } }).status).toBe('success');
    });

    it('без даты и с датой вне периода — ошибка', () => {
      expect(post(IVANOV, 'saveApplication', { application: newApplication }).message).toContain('Выберите дату перевозки');
      expect(post(IVANOV, 'saveApplication', { application: { ...newApplication, transportDate: isoDay(9) } }).message).toContain(
        'в период соревнования',
      );
      expect(post(IVANOV, 'saveApplication', { application: { ...newApplication, transportDate: isoDay(13) } }).status).toBe('error');
      expect(gas.sheet('Заявки').objects().some((r) => r['№'] === 10)).toBe(false);
    });

    it('у обычного соревнования дата перевозки не учитывается', () => {
      gas.sheet('Соревнования').values[1][ONE_DAY] = '';
      post(IVANOV, 'saveApplication', { application: { ...newApplication, transportDate: isoDay(11) } });
      const row = gas.sheet('Заявки').objects().find((r) => r['№'] === 10);
      expect(row['Сроки перевозки начало']).toEqual(day(9));
      expect(row['Сроки перевозки окончание']).toEqual(day(13));
    });
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

  it('оружие — только закреплённое за спортсменом', () => {
    const items = [{ athleteId: 'a1', weaponIds: ['w1', 'w2'] }];
    const result = post(IVANOV, 'saveApplication', { application: { ...newApplication, items } });
    expect(result.message).toBe('Benelli - 777 не закреплено за спортсменом Иванов И.И. — закрепить оружие может администратор');
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

describe('Сообщение администраторам о новой заявке', () => {
  const messages = () => gas.telegram.filter((r) => r.url.endsWith('/sendMessage'));
  const logEvents = () => gas.sheet('_Журнал').objects().map((r) => r['Событие']);

  it('уходит подтверждённым администраторам после снятия блокировки', () => {
    expect(post(IVANOV, 'saveApplication', { application: newApplication }).status).toBe('success');
    const sent = messages();
    // Сидоров — администратор, но ждёт подтверждения
    expect(sent.map((m) => m.payload.chat_id)).toEqual(['222']);
    expect(sent[0].scriptLocked).toBe(false);
    const dates = `${day(10).toLocaleDateString('ru-RU')} – ${day(12).toLocaleDateString('ru-RU')}`;
    expect(sent[0].payload.text).toBe(
      `Новая заявка № 10\nПеревозчик: Иванов Иван Иванович\nСоревнование: Кубок Москвы\nСроки по ЕКП: ${dates}\nУчастников: 2`,
    );
    expect(logEvents()).toContain('Уведомление администраторам: новая заявка');
  });

  it('без сроков по ЕКП — без строки сроков', () => {
    post(IVANOV, 'saveApplication', { application: { ...newApplication, competitionId: 'c3' } });
    expect(messages()[0].payload.text).not.toContain('Сроки по ЕКП');
  });

  it('не уходит отключившим, автору-администратору и при правке заявки', () => {
    post(PETROV, 'setNotifications', { notifications: { applications: false } });
    post(IVANOV, 'saveApplication', { application: newApplication });
    expect(messages()).toHaveLength(0);

    post(PETROV, 'setNotifications', { notifications: { applications: true } });
    post(IVANOV, 'saveApplication', { application: { ...newApplication, number: 5, transport: ['Поезд'] } });
    expect(messages()).toHaveLength(0);

    // Иванов — администратор и автор: себе не пишет, Петрову — пишет
    gas.sheet('Спортсмены').values[1][11] = 'Да';
    post(IVANOV, 'saveApplication', { application: newApplication });
    expect(messages().map((m) => m.payload.chat_id)).toEqual(['222']);
  });

  it('сбой отправки не отменяет заявку — пишется в журнал', () => {
    gas.failTelegram('сеть недоступна');
    const result = post(IVANOV, 'saveApplication', { application: newApplication });
    expect(result.status).toBe('success');
    expect(gas.sheet('Заявки').objects().some((r) => r['№'] === 10)).toBe(true);
    expect(logEvents()).toContain('Уведомление администраторам: ошибка');
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

  it('оружие, уже записанное у спортсмена в заявке, можно оставить и без закрепления; новое — нет', () => {
    post(PETROV, 'adminUnassignWeapon', { athleteId: 'a1', weaponId: 'w1' });
    const kept = { ...edit, items: [{ athleteId: 'a1', weaponIds: ['w1'] }] };
    expect(post(IVANOV, 'saveApplication', { application: kept }).status).toBe('success');
    const added = { ...edit, items: [{ athleteId: 'a1', weaponIds: ['w1', 'w2'] }] };
    expect(post(IVANOV, 'saveApplication', { application: added }).message).toContain('Benelli - 777 не закреплено');
    // Прежнее оружие одного спортсмена не переходит к другому
    const other = { ...edit, items: [{ athleteId: 'a2', weaponIds: ['w1'] }] };
    expect(post(IVANOV, 'saveApplication', { application: other }).message).toContain('МР-512 - 123 не закреплено');
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

describe('Сообщения администраторам о входе', () => {
  const messages = () => gas.telegram.filter((r) => r.url.endsWith('/sendMessage'));
  const log = () => gas.sheet('_Журнал').objects();
  const KUZMA = { id: 444, first_name: 'Кузьма', username: 'kuzma' };
  // Ячейка листа «Спортсмены»: index — строка (0 — заголовки), столбцы: 5 — ChatId, 6 — Статус, 11 — Администратор
  const setCell = (index, column, value) => void (gas.sheet('Спортсмены').values[index][column] = value);

  it('автоподтверждение — «для сведения», с кнопкой на спортсменов, после снятия блокировки', () => {
    expect(post(KUZMA, 'linkPhone', { contact: contactFor(444, '79004444444') }).status).toBe('success');
    const sent = messages();
    expect(sent.map((m) => m.payload.chat_id)).toEqual(['222']);
    expect(sent[0].scriptLocked).toBe(false);
    expect(sent[0].payload.text).toBe(
      'ℹ️ Для сведения\nВошёл в приложение: Кузнецов Кузьма\nТелефон: +7 900 444-44-44\nTelegram: Кузьма (@kuzma)\n\n' +
        'Подтверждён автоматически (был внесён в список) — делать ничего не нужно.',
    );
    const button = sent[0].payload.reply_markup.inline_keyboard[0][0];
    expect(button.text).toBe('Открыть спортсменов');
    expect(button.web_app.url).toBe('https://example.org/app/?page=admin&tab=athletes');
    expect(log().map((r) => r['Событие'])).toContain('Уведомление администраторам: вход (подтверждён автоматически)');
  });

  it('заявка по ФИО — «требуется участие»; уходит и отключившим сообщения о заявках', () => {
    post(PETROV, 'setNotifications', { notifications: { applications: false } });
    gas.telegram.length = 0;
    const contact = contactFor(999, '79009999999');
    expect(post(STRANGER, 'register', { lastName: 'Новиков', firstName: 'Ник', contact }).status).toBe('pending');
    const sent = messages();
    expect(sent.map((m) => m.payload.chat_id)).toEqual(['222']);
    expect(sent[0].payload.text).toMatch(/^❗ Требуется ваше участие\nЗаявка на доступ: Новиков Ник\nТелефон: \+7 900 999-99-99/);
    expect(sent[0].payload.text).toContain('Проверьте и подтвердите доступ.');
  });

  it('номер найден, запись ждёт подтверждения или доступ закрыт — «требуется участие»', () => {
    setCell(4, 6, 'Требует подтверждения');
    post(KUZMA, 'linkPhone', { contact: contactFor(444, '79004444444') });
    expect(messages()[0].payload.text).toContain('Ждёт подтверждения: Кузнецов Кузьма');

    gas.telegram.length = 0;
    setCell(4, 5, '');
    setCell(4, 6, 'Архив');
    expect(post(KUZMA, 'linkPhone', { contact: contactFor(444, '79004444444') }).status).toBe('forbidden');
    expect(messages()[0].payload.text).toContain('Статус «Архив» — доступ закрыт.');
  });

  it('конфликт привязки и дубль ФИО — с подсказкой; повтор за сутки не отправляется', () => {
    expect(post(STRANGER, 'linkPhone', { contact: contactFor(999, '79001111111') }).status).toBe('conflict');
    expect(messages()[0].payload.text).toContain('очистите ChatId в его строке');
    post(STRANGER, 'linkPhone', { contact: contactFor(999, '79001111111') });
    expect(messages()).toHaveLength(1);
    expect(log().at(-1)['Подробности']).toContain('Повтор за сутки');

    // Через сутки — снова
    gas.props.put('access-alert:conflict:79001111111', String(Date.now() - 25 * 60 * 60 * 1000));
    post(STRANGER, 'linkPhone', { contact: contactFor(999, '79001111111') });
    expect(messages()).toHaveLength(2);

    gas.telegram.length = 0;
    const user = { id: 888, first_name: 'Двойник' };
    const twin = { lastName: 'ИВАНОВ', firstName: 'Иван', contact: contactFor(888, '79008888888') };
    expect(post(user, 'register', twin).status).toBe('conflict');
    expect(messages()[0].payload.text).toContain('В списке уже есть Иванов Иван Иванович — с другим номером.');
    expect(messages()[0].payload.text).toContain('впишите номер +7 900 888-88-88 в его строку и очистите ChatId');
    post(user, 'register', twin);
    expect(messages()).toHaveLength(1);
  });

  it('без сообщения: уже подтверждённая запись, номер не найден, неверная подпись, повторный вход', () => {
    setCell(4, 6, 'Подтвержден');
    post(KUZMA, 'linkPhone', { contact: contactFor(444, '79004444444') });
    post(KUZMA, 'linkPhone', { contact: contactFor(444, '79004444444') });
    expect(post(STRANGER, 'linkPhone', { contact: contactFor(999, '79005555555') }).status).toBe('not_found');
    expect(post(STRANGER, 'linkPhone', { contact: contactFor(555, '79004444444') }).status).toBe('error');
    expect(messages()).toHaveLength(0);
  });

  it('администратор, внесённый заранее, о своём входе не получает', () => {
    setCell(4, 11, 'Да');
    post(KUZMA, 'linkPhone', { contact: contactFor(444, '79004444444') });
    expect(messages().map((m) => m.payload.chat_id)).toEqual(['222']);
  });

  it('сбой Telegram не меняет ответ и пишется в журнал', () => {
    gas.failTelegram('сеть недоступна');
    expect(post(KUZMA, 'linkPhone', { contact: contactFor(444, '79004444444') })).toMatchObject({ status: 'success', athleteId: 'a4' });
    const contact = contactFor(999, '79009999999');
    expect(post(STRANGER, 'register', { lastName: 'Новиков', firstName: 'Ник', contact }).status).toBe('pending');
    expect(log().filter((r) => r['Событие'] === 'Уведомление администраторам: ошибка')).toHaveLength(2);
  });
});

describe('Подтверждение спортсмена без ChatId', () => {
  it('«Подтвержден» не ставится не входившему, ставится входившему', () => {
    const result = post(PETROV, 'adminSaveAthlete', { athleteId: 'a4', fields: { Статус: 'Подтвержден' } });
    expect(result.status).toBe('error');
    expect(result.message).toContain('ещё не входил в приложение');

    expect(post(PETROV, 'adminSaveAthlete', { athleteId: 'a3', fields: { Статус: 'Подтвержден' } }).status).toBe('success');
  });

  it('уже подтверждённую запись без ChatId править можно', () => {
    gas.sheet('Спортсмены').values[4][6] = 'Подтвержден';
    const result = post(PETROV, 'adminSaveAthlete', { athleteId: 'a4', fields: { Статус: 'Подтвержден', Имя: 'Кузя' } });
    expect(result.status).toBe('success');
  });
});

describe('Закрепление оружия и настройки', () => {
  it('закрепить за собой нельзя; открепить от себя — только администратору', () => {
    expect(post(IVANOV, 'assignWeapon', { weaponId: 'w2' }).message).toContain('только администратор');
    expect(post(IVANOV, 'unassignWeapon', { weaponId: 'w1' }).message).toContain('только администраторам');
    expect(gas.sheet('Спортсмен/Оружие').objects()).toHaveLength(2);
    expect(post(PETROV, 'unassignWeapon', { weaponId: 'w2' }).status).toBe('success');
    expect(gas.sheet('Спортсмен/Оружие').objects()).toEqual([{ 'Спортсмен ид': 'a1', 'Оружие ид': 'w1' }]);
  });

  it('настройки уведомлений: о соревнованиях — перевозчику, о заявках — и администратору', () => {
    const result = post(IVANOV, 'setNotifications', { notifications: { competitions: false } });
    expect(result.fields).toEqual({ 'Сообщать о соревнованиях': 'Нет' });
    expect(post(PETROV, 'setNotifications', { notifications: { competitions: false } }).status).toBe('error');
    expect(post(PETROV, 'setNotifications', { notifications: { applications: false } }).fields).toEqual({ 'Сообщать о заявках': 'Нет' });
  });

  it('не перевозчику и не администратору — отказ', () => {
    gas.sheet('Спортсмены').values[2][11] = 'Нет';
    expect(post(PETROV, 'setNotifications', { notifications: { applications: false } }).status).toBe('error');
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
      // Администратору можно и незакреплённое оружие (у Кузнецова закреплений нет)
      items: [{ athleteId: 'a2', weaponIds: ['w2'] }, { athleteId: 'a4', weaponIds: ['w1'] }],
      transport: ['Поезд'],
      transportStart: isoDay(3),
      transportEnd: isoDay(4),
      address: 'Тула, тир',
    };
    const result = post(PETROV, 'adminSaveApplication', { application });
    expect(result.status).toBe('success');
    expect(appRow(5)).toMatchObject({
      ФИО: 'ФИО',
      Оружие: 'Петров П. : Benelli - 777\nКузнецов К. : МР-512 - 123',
      'Вид транспорта': 'Поезд',
      'Сроки перевозки начало': day(3),
      'Сроки перевозки окончание': day(4),
      Адрес: 'Тула, тир',
      'Название соревнования': 'Кубок',
      Статус: 'Новая',
      CreatedBy: 'a1',
      'ID участников': 'a2; a4',
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
    expect(gas.sheet('Спортсмен/Оружие').objects()).toEqual([{ 'Спортсмен ид': 'a2', 'Оружие ид': 'w2' }]);
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

  it('«Выезд одним днём»: пишет «Да», снимается, без дат — ошибка', () => {
    const result = post(PETROV, 'adminSaveCompetition', { competition: { ...competition, oneDay: true } });
    expect(result.status).toBe('success');
    const row = () => gas.sheet('Соревнования').objects().find((r) => r.ID === result.id);
    expect(row()['Выезд одним днём']).toBe('Да');
    post(PETROV, 'adminSaveCompetition', { competition: { ...competition, id: result.id, oneDay: false } });
    expect(row()['Выезд одним днём']).toBe('');
    expect(post(PETROV, 'adminSaveCompetition', { competition: { ...competition, start: '', end: '', oneDay: true } }).message).toContain(
      'одним днём',
    );
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
    expect(links()).toEqual([{ 'Спортсмен ид': 'a2', 'Оружие ид': 'w2' }]);
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

describe('Заполнение «ID участников» у прежних заявок', () => {
  const fill = () => gas.run().__eval('fillApplicationParticipants()');
  const WEAPON = APPLICATION_HEADERS.indexOf('Оружие');

  it('по «Фамилия И.О.» из «Оружия», без автора; заполненные не трогает; несопоставленные — в отчёт', () => {
    const sheet = gas.sheet('Заявки');
    // № 6 Петрова: Иванов, сам Петров (автор) и неизвестный; «ё» и регистр не мешают
    sheet.values[2][WEAPON] = 'ИВАНОВ И.И. : МР-512 - 123\nПётров П. : Benelli - 777\nНеизвестный Н. : X - 1';
    sheet.values[3][PARTICIPANTS] = 'a4'; // № 7 — уже заполнена вручную
    // В архиве № 9 Иванова: участник только сам автор
    fill();

    expect(sheet.objects().map((r) => [r['№'], r['ID участников']])).toEqual([[5, ''], [6, 'a1'], [7, 'a4']]);
    expect(gas.sheet('Архив заявок').objects()[0]['ID участников']).toBe('');
    const log = gas.sheet('_Журнал').objects().find((r) => r['Событие'] === 'Заполнение «ID участников»');
    expect(log['Подробности']).toContain('«Заявки»: заполнено заявок — 1');
    expect(log['Подробности']).toContain('№ 6: «Неизвестный Н.» — не найден');
  });

  it('нет столбца — подсказка в отчёте, лист не меняется', () => {
    gas.sheet('Архив заявок').values[0][PARTICIPANTS] = 'Другое';
    fill();
    const log = gas.sheet('_Журнал').objects().find((r) => r['Событие'] === 'Заполнение «ID участников»');
    expect(log['Подробности']).toContain('«Архив заявок»: нет столбца «ID участников»');
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

describe('Резервные копии', () => {
  const backup = () => gas.run().__eval('backupSpreadsheet()');
  const restore = (fn, options) => gas.run().__eval(`Object.assign(RESTORE, ${JSON.stringify(options)}); ${fn}()`);
  const events = (name) => (gas.sheet('_Журнал')?.objects() ?? []).filter((r) => r['Событие'] === name);
  const folderId = () => gas.props.get('BACKUP_FOLDER_ID');

  it('копия — все листы под прежними названиями, с формулами, в своей папке; сделана — в «_Журнал»', () => {
    const names = gas.spreadsheet.getSheets().map((s) => s.getName());
    const id = backup();
    const copy = gas.drive.spreadsheets.get(id);
    expect(copy.getName()).toMatch(/^Тестовая таблица — копия \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(copy.getSheets().map((s) => s.getName())).toEqual(names);
    expect(copy.getSheetByName('Заявки').formulas[1][APPLICATION_HEADERS.indexOf('Примечание')]).toBe('=1+1');
    expect(gas.drive.filesIn(folderId()).map((f) => f.id)).toEqual([id]);
    expect(events('Резервная копия')).toHaveLength(1);

    // Вторая копия — в ту же папку
    backup();
    expect(gas.drive.filesIn(folderId())).toHaveLength(2);
  });

  it('хранятся 30 дней и первая копия месяца — 12 месяцев; остальные — в корзину', () => {
    const now = new Date(2026, 10, 17, 2);
    const at = (y, m, d) => ({ created: new Date(y, m, d, 2), name: `${y}-${m + 1}-${d}` });
    const backups = [
      at(2026, 10, 16), at(2026, 9, 20), // моложе 30 дней — остаются
      at(2026, 9, 1), at(2026, 9, 15), // старше 30 дней: 1 октября — первая копия месяца, остаётся; 15-го — нет
      at(2026, 0, 3), at(2026, 0, 9), // январь: остаётся только первая
      at(2025, 10, 16), at(2025, 10, 20), // ноябрь прошлого года: даже первая старше 12 месяцев
    ];
    const expired = gas.run().__eval('expiredBackups_')(backups, now).map((b) => b.name);
    expect(expired).toEqual(['2026-10-15', '2026-1-9', '2025-11-16', '2025-11-20']);
  });

  it('устаревшие копии удаляются после новой', () => {
    const old = gas.drive.files.get(backup());
    old.created = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    backup();
    expect(old.trashed).toBe(true);
    expect(gas.drive.filesIn(folderId())).toHaveLength(1);
    expect(events('Резервная копия').at(-1)['Подробности']).toContain('Удалены устаревшие');
  });

  it('сбой — в «_Журнал» и сообщение подтверждённым администраторам', () => {
    gas.drive.createError = 'Service invoked too many times';
    expect(backup).toThrow('too many times');
    expect(events('Резервная копия не сделана')).toHaveLength(1);
    const sent = gas.telegram.filter((t) => t.url.endsWith('/sendMessage'));
    expect(sent.map((t) => t.payload.chat_id)).toEqual(['222']); // Петров; Сидоров — администратор, но не подтверждён
    expect(sent[0].payload.text).toContain('Резервная копия таблицы не сделана');
  });

  it('отчёт checkSetup: нет копий — предупреждение; есть — когда последняя', () => {
    expect(gas.run().__eval('backupReport_()')).toContain('⚠ ещё не делались');
    backup();
    const line = gas.run().__eval('backupReport_()');
    expect(line).toMatch(/^Резервные копии: 1 в папке «Резервные копии — Тестовая таблица», последняя — /);
    expect(line).not.toContain('⚠');
  });

  it('восстановление — только после проверки тех же настроек; проверка ничего не меняет', () => {
    const id = backup();
    gas.sheet('Оружие').values[1][1] = 'Испорчено';
    expect(() => restore('restoreApply', { backupId: id })).toThrow('Сначала запустите restoreCheck');

    const report = restore('restoreCheck', { backupId: id });
    expect(report).toContain('Лист «Оружие»: строк сейчас 2 → будет 2 из копии');
    expect(report.some((l) => l.startsWith('Лист «_Журнал»'))).toBe(false); // служебные листы — только явно
    expect(gas.sheet('Оружие').values[1][1]).toBe('Испорчено');

    expect(() => restore('restoreApply', { backupId: id, sheets: ['Оружие'] })).toThrow('Сначала запустите restoreCheck');
    restore('restoreApply', { backupId: id });
    expect(gas.sheet('Оружие').values[1][1]).toBe('МР-512');
  });

  it('восстановление целиком: строки как в копии, формулы — формулами, текст «=…» — текстом; до этого — копия текущего', () => {
    gas.sheet('Спортсмены').values[1][1] = '=Иванов'; // текст, похожий на формулу (в таблице хранится как текст)
    const id = backup();
    post(IVANOV, 'saveApplication', { application: newApplication });
    post(IVANOV, 'deleteApplication', { number: 5 });
    gas.props.put('notified:Заявки:7', 'В работе');
    const generation = gas.cache.get('gen:Заявки');

    restore('restoreCheck', { backupId: id });
    restore('restoreApply', { backupId: id });

    const applications = gas.sheet('Заявки');
    expect(applications.objects().map((r) => r['№'])).toEqual([5, 6, 7]);
    expect(applications.formulas[1][APPLICATION_HEADERS.indexOf('Примечание')]).toBe('=1+1');
    expect(gas.sheet('Спортсмены').values[1][1]).toBe('=Иванов');
    expect(gas.sheet('Спортсмены').formulas[1][1]).toBe('');
    // Архив тоже как в копии — удалённой заявки № 5 там нет
    expect(gas.sheet('Архив заявок').objects().map((r) => r['№'])).toEqual([9]);
    expect(gas.cache.get('gen:Заявки')).not.toBe(generation);
    expect(gas.props.get('notified:Заявки:7')).toBeNull();

    const files = gas.drive.filesIn(folderId());
    expect(files.at(-1).spreadsheet.getName()).toContain('(перед восстановлением)');
    expect(files.at(-1).spreadsheet.getSheetByName('Заявки').objects().map((r) => r['№'])).toEqual([6, 7, 10]);
    expect(events('Восстановление из копии')[0]['Подробности']).toContain('Состояние до восстановления сохранено');
  });

  it('восстановление строк по ID: заменяются только они, остальное не трогается', () => {
    const id = backup();
    post(PETROV, 'adminDeleteAthlete', { athleteId: 'a1' }); // удаляет закрепление a1 и уносит его заявки в архив
    post(PETROV, 'adminUnassignWeapon', { athleteId: 'a2', weaponId: 'w2' });
    expect(() => restore('restoreCheck', { backupId: id, ids: ['a1'] })).toThrow('только вместе с одним листом');

    const options = { backupId: id, sheets: ['Спортсмены'], ids: ['a1', 'a9'] };
    const report = restore('restoreCheck', options);
    expect(report[1]).toBe('Лист «Спортсмены»: строк с «ID» a1, a9 — в таблице 0, будут заменены 1 строками копии; в копии нет: a9');
    restore('restoreApply', options);

    expect(gas.sheet('Спортсмены').objects().map((r) => r.ID)).toEqual(['a2', 'a3', 'a4', 'a1']);
    expect(gas.sheet('Спортсмен/Оружие').objects()).toEqual([]); // этот лист не восстанавливали
  });

  it('изменённая структура: столбцы по заголовкам, переименования по списку, новые — пустые', () => {
    const id = backup();
    // После копии: в «Оружии» столбцы переставили, «Номер» переименовали в «Заводской номер», добавили «Калибр»;
    // лист «Виды транспорта» переименовали в «Транспорт»
    gas.spreadsheet.getSheetByName('Оружие').values = [['Ид', 'Калибр', 'Заводской номер', 'Название'], ['w1', '12', '123', 'МР-512']];
    gas.spreadsheet.getSheetByName('Оружие').formulas = [];
    gas.spreadsheet.getSheetByName('Виды транспорта').setName('Транспорт');
    gas.spreadsheet.getSheetByName('Транспорт').values = [['Название'], ['Самолёт']];
    gas.drive.spreadsheets.get(id).getSheetByName('Оружие').values[0].push('Примечание'); // столбец, которого уже нет

    const renames = `RENAMED_SHEETS['Виды транспорта'] = 'Транспорт'; RENAMED_COLUMNS['Оружие'] = { 'Номер': 'Заводской номер' };`;
    const options = JSON.stringify({ backupId: id, sheets: ['Оружие', 'Транспорт'] });
    const report = gas.run().__eval(`${renames} Object.assign(RESTORE, ${options}); restoreCheck()`);
    expect(report).toEqual([
      expect.stringContaining('Копия: '),
      'Лист «Оружие»: строк сейчас 1 → будет 2 из копии',
      '  переименования: «Номер» → «Заводской номер»',
      '  в копии нет столбцов: Калибр — у восстановленных строк будут пустыми',
      '  в таблице нет столбцов копии: Примечание — их данные не восстанавливаются',
      'Лист «Транспорт» (в копии — «Виды транспорта»): строк сейчас 1 → будет 2 из копии',
    ]);
    gas.run().__eval(`${renames} Object.assign(RESTORE, ${options}); restoreApply()`);

    expect(gas.sheet('Оружие').objects()).toEqual([
      { Ид: 'w1', Калибр: '', 'Заводской номер': '123', Название: 'МР-512' },
      { Ид: 'w2', Калибр: '', 'Заводской номер': '777', Название: 'Benelli' },
    ]);
    expect(gas.sheet('Транспорт').objects().map((r) => r['Название'])).toEqual(['Автомобиль', 'Поезд']);
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
