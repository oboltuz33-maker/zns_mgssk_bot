/**
 * Бэкенд Mini App: чтение листов таблицы и авторизация спортсменов.
 *
 * GET  ?action=sheets&initData=<Telegram.WebApp.initData>[&names=A,B][&fresh=1]
 *      Листы одним запросом — Mini App фильтрует их у себя, чтобы не расходовать лимиты.
 *      fresh=1 — прочитать таблицу мимо кэша (кнопка «Обновить» в приложении).
 * POST { action: 'linkPhone', initData, contact }
 *      Привязка по номеру телефона: contact — подписанный ответ Telegram.WebApp.requestContact.
 * POST { action: 'register', initData, lastName, firstName, middleName, contact }
 *      Заявка на доступ по ФИО, если номер (contact обязателен) не найден в списке, —
 *      строка со статусом «Требует подтверждения».
 * POST { action: 'saveApplication', initData, application: { number?, competitionId, items, transport } }
 *      Создание (без number) или изменение заявки на перевозку. items — [{ athleteId, weaponIds: [...] }],
 *      transport — названия из листа «Виды транспорта». Сроки перевозки скрипт ставит сам по датам
 *      соревнования: за TRANSPORT_DAYS_BEFORE дней до начала и через TRANSPORT_DAYS_AFTER после окончания.
 * POST { action: 'assignWeapon', initData, weaponId }
 *      Закрепить единицу из справочника «Оружие» за собой — строка в листе «Спортсмен/Оружие».
 * POST { action: 'unassignWeapon', initData, weaponId }
 *      Открепить единицу от себя — строка удаляется из листа «Спортсмен/Оружие».
 * POST { action: 'deleteApplication', initData, number }
 *      Удаление: заявка переносится в «Архив заявок» со статусом «Удалена».
 *
 * Заявки создают, меняют и удаляют только подтверждённые перевозчики — только свои и только в статусе «Новая».
 * Текст заявки (ФИО, оружие, данные соревнования) скрипт собирает сам по ID из справочников.
 *
 * Доступ:
 *  - initData и contact проверяются по подписи токеном бота — подделать пользователя или номер нельзя;
 *  - пользователь ищется в листе «Спортсмены» по ChatId; данные отдаются только при статусе «Подтвержден»;
 *  - листы из USER_SCOPED_SHEETS отдаются только со строками этого спортсмена;
 *  - из «Соревнований» отдаются только предстоящие (дата начала — сегодня или позже; соревнования
 *    с неуказанной или неверной датой начала тоже отдаются, чтобы не потерялись).
 *
 * Уведомления: при ручной смене статуса спортсмена на «Подтвержден» и статуса заявки на «В работе» /
 * «Выполнена» бот пишет спортсмену, а о новом соревновании (заполнены название, даты и адрес) — всем
 * подтверждённым перевозчикам, один раз; отметка — в столбце «Рассылка» (триггер onSheetEdit; создаётся один раз
 * функцией installTriggers).
 * Настройка окружения и проверка — функции раздела «Настройка окружения» (checkSetup, setupMenuButton, …).
 *
 * Ответы: status = success | unregistered | pending | forbidden | expired | not_found | conflict | error
 * (expired — подпись Telegram верна, но приложение открыто больше INIT_DATA_MAX_AGE_SECONDS назад).
 * События входа пишутся в журнал выполнения и в служебный лист «_Журнал».
 *
 * Настройки окружения хранятся в свойствах скрипта, а не в коде, — поэтому один и тот же код работает
 * и в рабочем, и в тестовом окружении (у каждого свой бот, своя таблица и свой скрипт):
 * «Настройки проекта» (⚙️) → «Свойства скрипта»:
 *   BOT_TOKEN    = <токен от @BotFather>;
 *   MINI_APP_URL = <адрес приложения> — для кнопки «Открыть приложение» в уведомлениях бота
 *                  (рабочее: https://oboltuz33-maker.github.io/zns_mgssk_bot/, тестовое: …/zns_mgssk_bot/test/).
 *                  Не задан — уведомления уходят без кнопки.
 *
 * Первая строка листа — заголовки, первый столбец — ID строки.
 * Приложению отдаются только листы из APP_SHEETS.
 */

// Если скрипт не привязан к таблице, укажите её ID (из адреса таблицы)
const SPREADSHEET_ID = '';

// Названия листов таблицы
const SHEET = {
  athletes: 'Спортсмены',
  applications: 'Заявки',
  applicationsArchive: 'Архив заявок',
  competitions: 'Соревнования',
  weapons: 'Оружие',
  // Какое оружие за каким спортсменом закреплено
  athleteWeapons: 'Спортсмен/Оружие',
  // Справочник видов транспорта: первый столбец — название
  transportTypes: 'Виды транспорта',
  // Журнал событий входа. Имя начинается с "_", поэтому приложению лист не отдаётся,
  // а администратор видит его прямо в таблице. Создаётся автоматически при первой записи.
  log: '_Журнал',
};

// Листы, которые можно отдать приложению. Остальные (архивы, служебные, новые листы, добавленные позже)
// приложению не отдаются, даже если их запросить, — чтобы случайно не открыть лишние данные
const APP_SHEETS = [
  SHEET.competitions,
  SHEET.athletes,
  SHEET.weapons,
  SHEET.athleteWeapons,
  SHEET.applications,
  SHEET.transportTypes,
];

// Названия столбцов (заголовки первой строки) по листам

// Лист «Спортсмены»
const ATHLETE_COLUMN = {
  chatId: 'ChatId',
  status: 'Статус',
  phone: 'Телефон',
  lastName: 'Фамилия',
  firstName: 'Имя',
  middleName: 'Отчество',
  carrier: 'Перевозчик',
};

// Лист «Соревнования»
const COMPETITION_COLUMN = {
  title: 'Название',
  ekpNumber: 'Номер из ЕКП',
  kind: 'Вид соревнования',
  start: 'Дата начала',
  end: 'Дата завершения',
  address: 'Адрес',
  // Когда перевозчикам разослано сообщение о новом соревновании (ставит скрипт). Пусто — ещё не рассылалось;
  // очистить ячейку — разослать заново; вписать что угодно (например, «нет») — не рассылать
  notified: 'Рассылка',
};

// Лист «Оружие»
const WEAPON_COLUMN = {
  title: 'Название',
  number: 'Номер',
};

// Лист «Спортсмен/Оружие»
const ATHLETE_WEAPON_COLUMN = {
  athleteId: 'Спортсмен ид',
  weaponId: 'Оружие ид',
};

// Листы «Заявки» и «Архив заявок»
const APPLICATION_COLUMN = {
  number: '№',
  fullName: 'ФИО',
  weapon: 'Оружие',
  transportStart: 'Сроки перевозки начало',
  transportEnd: 'Сроки перевозки окончание',
  transport: 'Вид транспорта',
  competitionKind: 'Вид соревнования',
  competitionTitle: 'Название соревнования',
  ekpNumber: 'Номер в ЕКП',
  ekpStart: 'Сроки по ЕКП начало',
  ekpEnd: 'Сроки по ЕКП окончание',
  address: 'Адрес',
  status: 'Статус',
  createdBy: 'CreatedBy',
  createdAt: 'CreatedAt',
};

// Значения столбца «Статус» листа «Спортсмены»
const ATHLETE_STATUS = {
  confirmed: 'Подтвержден',
  pending: 'Требует подтверждения',
  addedManually: 'Добавлен вручную',
};

// Строки, внесённые администратором: привязка по телефону сразу подтверждает такого спортсмена.
// Остальные статусы («Требует подтверждения», блокировки и т.п.) при привязке не меняются.
const AUTO_CONFIRM_STATUSES = ['', ATHLETE_STATUS.addedManually];

// Значения столбца «Статус» заявки. Автор может менять и удалять заявку только в статусе «Новая»;
// остальные ставит оформитель, «Удалена» — при удалении автором (заявка уходит в архив)
const APPLICATION_STATUS = {
  new: 'Новая',
  inProgress: 'В работе',
  done: 'Выполнена',
  archived: 'Архив',
  deleted: 'Удалена',
};

// Сроки перевозки: за сколько дней до начала соревнования и через сколько дней после окончания
const TRANSPORT_DAYS_BEFORE = 1;
const TRANSPORT_DAYS_AFTER = 1;

// Разделитель элементов списка в ячейке заявки (виды транспорта)
const LIST_SEPARATOR = ';\n';

// Столбец «Оружие»: по строке на спортсмена — «Фамилия И.О. : Название - Номер ; Название - Номер»
const ATHLETE_WEAPONS_SEPARATOR = ' : ';
const WEAPONS_SEPARATOR = ' ; ';

// Листы, где каждому спортсмену видны только его строки: имя листа → столбец с ID спортсмена
const USER_SCOPED_SHEETS = {
  [SHEET.applications]: APPLICATION_COLUMN.createdBy,
  [SHEET.applicationsArchive]: APPLICATION_COLUMN.createdBy,
};

// Столбцы листа журнала
const LOG_COLUMNS = ['Дата', 'Событие', 'Telegram ID', 'Пользователь Telegram', 'Телефон', 'ID спортсмена', 'Подробности'];

// Сколько живут подписанные данные Telegram (initData выдаётся при открытии Mini App)
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

const NAME_MAX_LENGTH = 100;

// Сколько помнить ответы на POST-запросы по requestId — чтобы повтор при обрыве связи не выполнил действие дважды
const REQUEST_CACHE_SECONDS = 10 * 60;

// Кэш листов для отдачи приложению (doGet): экономит время выполнения и лимиты Apps Script.
// Устаревает при записи через приложение и при ручной правке листа (см. «Работа с листами»); иначе живёт столько секунд
const SHEET_CACHE_SECONDS = 5 * 60;
// Лист больше этого размера (символов JSON) в кэш не кладётся — у CacheService предел 100 КБ на значение
const SHEET_CACHE_MAX_CHARS = 45000;

// В какие листы пишет каждое действие doPost — после действия у них новое поколение кэша
const WRITES_SHEETS = {
  linkPhone: [SHEET.athletes],
  register: [SHEET.athletes],
  saveApplication: [SHEET.applications],
  deleteApplication: [SHEET.applications],
  assignWeapon: [SHEET.athleteWeapons],
  unassignWeapon: [SHEET.athleteWeapons],
};

// Как связаться с администратором (например, '@username' или телефон) — подставляется
// в сообщения пользователю, когда без администратора не обойтись. Пусто — не показывается.
const ADMIN_CONTACT = '';


// Статусы заявки, о смене на которые бот сообщает автору заявки
const NOTIFY_APPLICATION_STATUSES = [APPLICATION_STATUS.inProgress, APPLICATION_STATUS.done];

// Листы, где первый столбец — ID строки и он ставится сам: строке, внесённой вручную, при правке выдаётся ID
// (generateShortId). Не входят: «Заявки» (№ ставит скрипт), «Спортсмен/Оружие» (первый столбец — ID спортсмена),
// «Виды транспорта» (первый столбец — название)
const AUTO_ID_SHEETS = [SHEET.athletes, SHEET.competitions, SHEET.weapons];

// Рассылка перевозчикам о новом соревновании: уходит, когда у строки заполнены все эти столбцы,
// а столбец «Рассылка» пуст. Нет столбца «Рассылка» в листе — рассылки нет
const NEW_COMPETITION_REQUIRED = [COMPETITION_COLUMN.title, COMPETITION_COLUMN.start, COMPETITION_COLUMN.end, COMPETITION_COLUMN.address];

// ---------- Точки входа ----------

function doGet(e) {
  const params = (e && e.parameter) || {};
  return handle_(function () {
    if (params.action !== 'sheets') {
      return { status: 'error', message: 'Неизвестное действие: ' + params.action };
    }
    const user = verifyInitData_(params.initData);
    if (!user) return telegramDenied_(params.initData);

    const ss = spreadsheet_();
    freshRead_ = params.fresh === '1';
    const athlete = findUser_(ss, athletesTable_(ss, true), user);
    const denied = accessDenied_(athlete);
    if (denied) return denied;
    return readSheets_(ss, params.names, athlete.id);
  });
}

function doPost(e) {
  return handle_(function () {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const user = verifyInitData_(body.initData);
    if (!user) return telegramDenied_(body.initData);

    // Запись в лист — под блокировкой, чтобы параллельные запросы не создали дубликаты
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      // Приложение повторяет запрос при обрыве связи. Если этот requestId уже выполнялся (запрос дошёл,
      // а ответ потерялся) — возвращаем прежний ответ, а не выполняем действие второй раз
      const cache = CacheService.getScriptCache();
      const cacheKey = body.requestId ? 'request:' + user.id + ':' + body.requestId : null;
      const done = cacheKey && cache.get(cacheKey);
      if (done) return JSON.parse(done);

      const result = runAction_(user, body);
      if (cacheKey) cache.put(cacheKey, JSON.stringify(result), REQUEST_CACHE_SECONDS);
      // Листы, в которые действие могло записать, — их кэш для чтения устарел
      if (WRITES_SHEETS[body.action]) invalidateSheets_(WRITES_SHEETS[body.action]);
      return result;
    } finally {
      lock.releaseLock();
    }
  });
}

// Ошибки проверки (userError_) не кэшируются — при повторе запрос просто выполнится заново
function runAction_(user, body) {
  if (body.action === 'linkPhone') return linkPhone_(user, body.contact);
  if (body.action === 'register') return register_(user, body);
  if (body.action === 'saveApplication') return saveApplication_(user, body.application || {});
  if (body.action === 'deleteApplication') return deleteApplication_(user, body.number);
  if (body.action === 'assignWeapon') return assignWeapon_(user, body.weaponId);
  if (body.action === 'unassignWeapon') return unassignWeapon_(user, body.weaponId);
  return { status: 'error', message: 'Неизвестное действие: ' + body.action };
}

function handle_(fn) {
  try {
    return json_(fn());
  } catch (err) {
    // Ошибки проверки данных показываются пользователю как есть, остальные — с типом ошибки
    return json_({ status: 'error', message: err.isUserError ? err.message : String(err) });
  }
}

// Ошибка в данных запроса, понятная пользователю (неверный выбор, нет прав и т.п.)
function userError_(message) {
  const err = new Error(message);
  err.isUserError = true;
  return err;
}

// ---------- Доступ ----------

// null — доступ есть; иначе ответ с причиной отказа
function accessDenied_(athlete) {
  if (!athlete) return { status: 'unregistered', message: 'Пользователь не найден среди спортсменов' };
  if (athlete.status === ATHLETE_STATUS.confirmed) return null;
  if (athlete.status === ATHLETE_STATUS.pending) {
    return { status: 'pending', message: 'Заявка на доступ ожидает подтверждения администратором' };
  }
  return { status: 'forbidden', message: 'Доступ закрыт (статус: ' + (athlete.status || 'не указан') + ')' };
}

function accessResult_(athlete) {
  return accessDenied_(athlete) || { status: 'success', athleteId: athlete.id };
}

// Привязка пользователя Telegram к спортсмену, внесённому администратором, по номеру телефона
function linkPhone_(user, contactResponse) {
  const ss = spreadsheet_();
  const table = athletesTable_(ss);
  const linked = findUser_(ss, table, user);
  if (linked) return accessResult_(linked);

  const phone = verifiedPhone_(contactResponse, user);
  if (!phone) {
    log_(ss, 'Неверный номер', user, { text: 'Ответ requestContact не прошёл проверку подписи или это номер другого пользователя' });
    return { status: 'error', message: 'Не удалось подтвердить номер телефона. Попробуйте ещё раз' };
  }

  const athlete = findAthlete_(table, function (a) { return normalizePhone_(a.phone) === phone; });
  if (!athlete) {
    log_(ss, 'Номер не найден', user, { phone: phone, text: 'Пользователю предложена заявка по ФИО' });
    return { status: 'not_found', message: 'Номер не найден среди спортсменов' };
  }

  if (athlete.chatId && athlete.chatId !== String(user.id)) {
    log_(ss, 'Конфликт привязки', user, {
      phone: phone,
      athleteId: athlete.id,
      text: 'Номер спортсмена ' + (athlete.fullName || athlete.id) + ' (строка ' + athlete.row +
        ') уже привязан к Telegram ID ' + athlete.chatId + '. Если это тот же человек с новым аккаунтом — ' +
        'очистите ChatId в его строке, и он сможет войти заново',
    });
    return {
      status: 'conflict',
      title: 'Номер уже используется',
      message: 'Номер ' + formatPhone_(phone) + ' закреплён за спортсменом ' + (athlete.fullName || athlete.id) +
        ', но к этой записи уже привязан другой аккаунт Telegram.\n\n' +
        'Если вы сменили аккаунт Telegram, попросите администратора' + (ADMIN_CONTACT ? ' (' + ADMIN_CONTACT + ')' : '') +
        ' освободить запись — после этого войдите снова. Если это не ваша запись, сообщите администратору: ' +
        'возможно, номер указан с ошибкой.',
    };
  }

  table.set(athlete, ATHLETE_COLUMN.chatId, user.id);
  if (AUTO_CONFIRM_STATUSES.indexOf(athlete.status) !== -1) {
    table.set(athlete, ATHLETE_COLUMN.status, ATHLETE_STATUS.confirmed);
    athlete.status = ATHLETE_STATUS.confirmed;
  }
  log_(ss, 'Привязка по телефону', user, { phone: phone, athleteId: athlete.id, text: 'Статус: ' + athlete.status });
  return accessResult_(athlete);
}

// Заявка на доступ по ФИО: новая строка в листе «Спортсмены», ждёт подтверждения администратором.
// Принимается только с подтверждённым номером телефона — без него не отличить нового спортсмена от
// внесённого администратором, и в листе появлялись бы дубли.
function register_(user, body) {
  const ss = spreadsheet_();
  const table = athletesTable_(ss);
  const linked = findUser_(ss, table, user);
  if (linked) return accessResult_(linked);

  const phone = verifiedPhone_(body.contact, user);
  if (!phone) return { status: 'error', message: 'Поделитесь номером телефона — без него войти нельзя' };
  // Номер есть в списке (например, администратор внёс спортсмена, пока заполнялась форма) — привязываем
  if (findAthlete_(table, function (a) { return normalizePhone_(a.phone) === phone; })) {
    return linkPhone_(user, body.contact);
  }

  const lastName = cleanName_(body.lastName);
  const firstName = cleanName_(body.firstName);
  const middleName = cleanName_(body.middleName);
  if (!lastName || !firstName) return { status: 'error', message: 'Укажите фамилию и имя' };

  // Спортсмен с такими ФИО уже есть, но с другим номером (или без номера) — вторую строку не создаём.
  // Администратор впишет номер в существующую строку, и человек войдёт по телефону.
  const namesake = findAthlete_(table, function (a) { return sameName_(a, lastName, firstName, middleName); });
  if (namesake) {
    log_(ss, 'Дубль ФИО', user, {
      phone: phone,
      athleteId: namesake.id,
      text: 'Заявка на доступ на имя ' + namesake.fullName + ', а в его строке (' + namesake.row + ') ' +
        (namesake.phone ? 'другой номер' : 'нет номера') + '. Если это он — впишите в строку номер ' + formatPhone_(phone) +
        (namesake.chatId ? ' и очистите ChatId' : '') + ', и он сможет войти',
    });
    return {
      status: 'conflict',
      title: 'Вы уже есть в списке',
      message: 'Спортсмен ' + namesake.fullName + ' уже есть в списке, но с другим номером телефона.\n\n' +
        'Попросите администратора' + (ADMIN_CONTACT ? ' (' + ADMIN_CONTACT + ')' : '') + ' указать в вашей записи номер ' +
        formatPhone_(phone) + ' — после этого войдите снова.',
    };
  }

  const values = {};
  values[ATHLETE_COLUMN.lastName] = lastName;
  values[ATHLETE_COLUMN.firstName] = firstName;
  values[ATHLETE_COLUMN.middleName] = middleName;
  values[ATHLETE_COLUMN.phone] = phone;
  values[ATHLETE_COLUMN.chatId] = user.id;
  values[ATHLETE_COLUMN.status] = ATHLETE_STATUS.pending;
  values[ATHLETE_COLUMN.carrier] = 'Нет';
  const id = newId_();
  table.append(id, values);
  log_(ss, 'Заявка на доступ', user, {
    phone: values[ATHLETE_COLUMN.phone],
    athleteId: id,
    text: [lastName, firstName, middleName].join(' ').trim() + ' — ждёт подтверждения',
  });

  return { status: 'pending', message: 'Заявка на доступ отправлена администратору' };
}

// ---------- Лист «Спортсмены» ----------

// fromCache — для чтения (doGet) лист можно взять из кэша; для записи — только свежий
function athletesTable_(ss, fromCache) {
  const sheet = ss.getSheetByName(SHEET.athletes);
  if (!sheet) throw new Error('Нет листа «' + SHEET.athletes + '»');

  const values = sheetValues_(ss, SHEET.athletes, Boolean(fromCache));
  const headers = values[0].map(String);
  const col = function (name, required) {
    const i = headers.indexOf(name);
    if (i === -1 && required) throw new Error('Нет столбца «' + name + '» на листе «' + SHEET.athletes + '»');
    return i;
  };
  [ATHLETE_COLUMN.chatId, ATHLETE_COLUMN.status, ATHLETE_COLUMN.phone].forEach(function (name) { col(name, true); });

  const cell = function (row, name) {
    const i = col(name);
    return i === -1 ? '' : String(row[i]).trim();
  };

  const athletes = [];
  for (let r = 1; r < values.length; r++) {
    const id = String(values[r][0]).trim();
    if (!id) continue; // строки без ID игнорируются
    const lastName = cell(values[r], ATHLETE_COLUMN.lastName);
    const firstName = cell(values[r], ATHLETE_COLUMN.firstName);
    const middleName = cell(values[r], ATHLETE_COLUMN.middleName);
    athletes.push({
      row: r + 1, // номер строки на листе (с 1, с учётом заголовка)
      id: id,
      chatId: cell(values[r], ATHLETE_COLUMN.chatId),
      status: cell(values[r], ATHLETE_COLUMN.status),
      phone: cell(values[r], ATHLETE_COLUMN.phone),
      isCarrier: cell(values[r], ATHLETE_COLUMN.carrier).toLowerCase() === 'да',
      lastName: lastName,
      firstName: firstName,
      middleName: middleName,
      fullName: [lastName, firstName, middleName].filter(Boolean).join(' '),
      shortName: shortName_(lastName, firstName, middleName),
      // Обращение: «Имя Отчество», без отчества — «Имя Фамилия»
      greetingName: (middleName ? [firstName, middleName] : [firstName, lastName]).filter(Boolean).join(' '),
    });
  }

  return {
    athletes: athletes,
    set: function (athlete, name, value) {
      sheet.getRange(athlete.row, col(name, true) + 1).setValue(value);
    },
    append: function (id, valuesByColumn) {
      const row = headers.map(function (h, i) {
        if (i === 0) return id;
        return valuesByColumn.hasOwnProperty(h) ? valuesByColumn[h] : '';
      });
      sheet.appendRow(row);
    },
  };
}

// Запись спортсмена пользователя Telegram (по ChatId). Если строк с этим ChatId несколько (дубль —
// например, запись пересоздали, а старую не удалили), берётся самая подходящая: подтверждённый перевозчик,
// затем подтверждённый, затем ждущий подтверждения, затем первая. О дубле — запись в «_Журнал»
function findUser_(ss, table, user) {
  const chatId = String(user.id);
  const matches = table.athletes.filter(function (a) { return a.chatId === chatId; });
  if (matches.length < 2) return matches[0] || null;

  const rank = function (a) {
    if (a.status === ATHLETE_STATUS.confirmed) return a.isCarrier ? 0 : 1;
    return a.status === ATHLETE_STATUS.pending ? 2 : 3;
  };
  const chosen = matches.slice().sort(function (a, b) { return rank(a) - rank(b) || a.row - b.row; })[0];
  logDuplicateChatId_(ss, user, matches, chosen);
  return chosen;
}

// Не чаще раза в DUPLICATE_LOG_SECONDS на пользователя — дубль виден при каждом открытии приложения
const DUPLICATE_LOG_SECONDS = 6 * 60 * 60;
function logDuplicateChatId_(ss, user, matches, chosen) {
  const cache = CacheService.getScriptCache();
  const key = 'duplicate-chat:' + user.id;
  if (cache.get(key)) return;
  cache.put(key, '1', DUPLICATE_LOG_SECONDS);
  log_(ss, 'Дубль ChatId', user, {
    athleteId: chosen.id,
    text: 'ChatId ' + user.id + ' указан в нескольких строках «' + SHEET.athletes + '»: ' +
      matches.map(function (a) {
        return 'строка ' + a.row + ' (' + (a.fullName || a.id) + ', ' + (a.status || 'без статуса') + (a.isCarrier ? ', перевозчик' : '') + ')';
      }).join('; ') +
      '. Используется строка ' + chosen.row + '. Удалите лишние строки или очистите в них ChatId',
  });
}

function findAthlete_(table, predicate) {
  for (let i = 0; i < table.athletes.length; i++) {
    if (predicate(table.athletes[i])) return table.athletes[i];
  }
  return null;
}

// ---------- Заявки на перевозку ----------

// Создание (без number) или изменение заявки. Текст строки собирается по ID из справочников —
// значениям из приложения доверяются только ID и выбор, а не готовый текст.
// В ответе — сохранённая строка { заголовок: значение }: приложение сразу показывает её в списке заявок,
// не дожидаясь, пока перечитает таблицу (при плохой связи это может затянуться)
function saveApplication_(user, input) {
  const ss = spreadsheet_();
  const author = requireCarrier_(ss, user);
  const fields = buildApplication_(ss, author, input);
  const table = readTable_(ss, SHEET.applications);
  const rowObject = function (values) {
    const result = {};
    table.headers.forEach(function (h, i) { result[h] = values[i]; });
    return result;
  };

  if (input.number) {
    const row = ownNewApplication_(table, input.number, author);
    const values = row.values.slice();
    Object.keys(fields).forEach(function (name) { values[table.col(name)] = fields[name]; });
    table.sheet.getRange(row.row, 1, 1, values.length).setValues([values]);
    log_(ss, 'Заявка изменена', user, { athleteId: author.id, text: '№ ' + input.number });
    return { status: 'success', number: Number(input.number), row: rowObject(values) };
  }

  const number = nextApplicationNumber_(ss, table);
  fields[APPLICATION_COLUMN.number] = number;
  fields[APPLICATION_COLUMN.status] = APPLICATION_STATUS.new;
  fields[APPLICATION_COLUMN.createdBy] = author.id;
  fields[APPLICATION_COLUMN.createdAt] = new Date();
  const newValues = table.headers.map(function (h) { return fields.hasOwnProperty(h) ? fields[h] : ''; });
  table.sheet.appendRow(newValues);
  log_(ss, 'Заявка создана', user, { athleteId: author.id, text: '№ ' + number + ', ' + fields[APPLICATION_COLUMN.competitionTitle] });
  return { status: 'success', number: number, row: rowObject(newValues) };
}

// Удаление автором: строка переносится в «Архив заявок» (столбцы сопоставляются по заголовкам)
// со статусом «Удалена» и удаляется из «Заявок»
function deleteApplication_(user, number) {
  const ss = spreadsheet_();
  const author = requireCarrier_(ss, user);
  const table = readTable_(ss, SHEET.applications);
  const row = ownNewApplication_(table, number, author);
  const archive = readTable_(ss, SHEET.applicationsArchive);

  const archived = archive.headers.map(function (h) {
    if (h === APPLICATION_COLUMN.status) return APPLICATION_STATUS.deleted;
    const i = table.headers.indexOf(h);
    return i === -1 ? '' : row.values[i];
  });
  archive.sheet.appendRow(archived);
  table.sheet.deleteRow(row.row);

  log_(ss, 'Заявка удалена', user, { athleteId: author.id, text: '№ ' + number + ' перенесена в «' + SHEET.applicationsArchive + '»' });
  return { status: 'success', number: Number(number) };
}

// Автор заявки — подтверждённый спортсмен-перевозчик
function requireCarrier_(ss, user) {
  const athlete = findUser_(ss, athletesTable_(ss), user);
  const denied = accessDenied_(athlete);
  if (denied) throw userError_(denied.message);
  if (!athlete.isCarrier) throw userError_('Создавать заявки могут только перевозчики');
  return athlete;
}

// Строка своей заявки в статусе «Новая» — только такую автор может менять и удалять
function ownNewApplication_(table, number, author) {
  const row = findById_(table, number);
  if (!row || String(table.get(row, APPLICATION_COLUMN.createdBy)).trim() !== author.id) {
    throw userError_('Заявка № ' + number + ' не найдена');
  }
  const status = String(table.get(row, APPLICATION_COLUMN.status)).trim();
  if (status !== APPLICATION_STATUS.new) {
    throw userError_('Заявка № ' + number + ' уже в статусе «' + status + '» — изменить или удалить её нельзя');
  }
  return row;
}

// Значения столбцов заявки (кроме №, статуса и автора) по выбору из приложения
function buildApplication_(ss, author, input) {
  const competitions = readTable_(ss, SHEET.competitions);
  const competition = findById_(competitions, input.competitionId);
  if (!competition) throw userError_('Соревнование не найдено — обновите данные и выберите заново');

  const athletes = athletesTable_(ss);
  const weapons = readTable_(ss, SHEET.weapons);
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) throw userError_('Добавьте хотя бы одного спортсмена');

  const seen = {};
  const weaponLines = [];
  items.forEach(function (item) {
    const athlete = findAthlete_(athletes, function (a) { return a.id === String(item.athleteId); });
    if (!athlete) throw userError_('Спортсмен не найден — обновите данные и выберите заново');
    if (seen[athlete.id]) throw userError_(athlete.shortName + ' добавлен в заявку дважды');
    seen[athlete.id] = true;

    const weaponIds = Array.isArray(item.weaponIds) ? item.weaponIds : [];
    if (!weaponIds.length) throw userError_('Выберите оружие для спортсмена ' + athlete.shortName);
    // Строка спортсмена: «Фамилия И.О. : Название - Номер ; Название - Номер»
    const athleteWeapons = weaponIds.map(function (weaponId) {
      const weapon = findById_(weapons, weaponId);
      if (!weapon) throw userError_('Оружие не найдено — обновите данные и выберите заново');
      return String(weapons.get(weapon, WEAPON_COLUMN.title)).trim() + ' - ' + String(weapons.get(weapon, WEAPON_COLUMN.number)).trim();
    });
    weaponLines.push(athlete.shortName + ATHLETE_WEAPONS_SEPARATOR + athleteWeapons.join(WEAPONS_SEPARATOR));
  });

  const transportTypes = readTable_(ss, SHEET.transportTypes).rows.map(function (r) { return String(r.values[0]).trim(); });
  const transport = (Array.isArray(input.transport) ? input.transport : []).map(String);
  if (!transport.length) throw userError_('Выберите вид транспорта');
  transport.forEach(function (name) {
    if (transportTypes.indexOf(name) === -1) throw userError_('Вид транспорта «' + name + '» не найден в справочнике');
  });

  // Сроки перевозки — от дат соревнования. Если дата начала не указана или записана неверно,
  // сроки остаются пустыми (их заполнит оформитель), а в «Сроки по ЕКП» переносится то, что записано в ячейках
  const rawStart = competitions.get(competition, COMPETITION_COLUMN.start);
  const rawEnd = competitions.get(competition, COMPETITION_COLUMN.end);
  const competitionStart = sheetDate_(rawStart);
  const competitionEnd = sheetDate_(rawEnd) || competitionStart;
  if (!isUpcoming_(rawStart)) throw userError_('Соревнование уже началось — заявку на него подать нельзя');
  const transportStart = competitionStart ? shiftDays_(competitionStart, -TRANSPORT_DAYS_BEFORE) : '';
  const transportEnd = competitionEnd ? shiftDays_(competitionEnd, TRANSPORT_DAYS_AFTER) : '';

  const fields = {};
  fields[APPLICATION_COLUMN.fullName] = author.fullName;
  fields[APPLICATION_COLUMN.weapon] = weaponLines.join('\n');
  fields[APPLICATION_COLUMN.transport] = transport.join(LIST_SEPARATOR);
  fields[APPLICATION_COLUMN.transportStart] = transportStart;
  fields[APPLICATION_COLUMN.transportEnd] = transportEnd;
  fields[APPLICATION_COLUMN.competitionKind] = competitions.get(competition, COMPETITION_COLUMN.kind);
  fields[APPLICATION_COLUMN.competitionTitle] = competitions.get(competition, COMPETITION_COLUMN.title);
  fields[APPLICATION_COLUMN.ekpNumber] = competitions.get(competition, COMPETITION_COLUMN.ekpNumber);
  fields[APPLICATION_COLUMN.ekpStart] = competitionStart || rawStart;
  fields[APPLICATION_COLUMN.ekpEnd] = sheetDate_(rawEnd) || rawEnd;
  fields[APPLICATION_COLUMN.address] = competitions.get(competition, COMPETITION_COLUMN.address);
  return fields;
}

// Следующий № заявки: наибольший в «Заявках» и «Архиве заявок» + 1
function nextApplicationNumber_(ss, table) {
  let max = 0;
  [table, readTable_(ss, SHEET.applicationsArchive)].forEach(function (t) {
    t.rows.forEach(function (r) {
      const n = Number(r.values[0]);
      if (n > max) max = n;
    });
  });
  return max + 1;
}

// ---------- Закрепление оружия ----------

// Подтверждённый спортсмен закрепляет за собой единицу из справочника «Оружие».
// Одна единица может быть закреплена за несколькими спортсменами.
function assignWeapon_(user, weaponId) {
  const ss = spreadsheet_();
  const athlete = findUser_(ss, athletesTable_(ss), user);
  const denied = accessDenied_(athlete);
  if (denied) throw userError_(denied.message);

  const weapons = readTable_(ss, SHEET.weapons);
  const weapon = findById_(weapons, weaponId);
  if (!weapon) throw userError_('Оружие не найдено — обновите данные и выберите заново');
  const title = String(weapons.get(weapon, WEAPON_COLUMN.title)).trim() + ' ' + String(weapons.get(weapon, WEAPON_COLUMN.number)).trim();

  const links = readTable_(ss, SHEET.athleteWeapons);
  const athleteCol = links.col(ATHLETE_WEAPON_COLUMN.athleteId);
  const weaponCol = links.col(ATHLETE_WEAPON_COLUMN.weaponId);
  const already = links.rows.some(function (r) {
    return String(r.values[athleteCol]).trim() === athlete.id && String(r.values[weaponCol]).trim() === String(weaponId);
  });
  const link = { athleteId: athlete.id, weaponId: String(weaponId) };
  if (already) return { status: 'success', message: title + ' уже закреплено за вами', link: link };

  links.sheet.appendRow(links.headers.map(function (h) {
    if (h === ATHLETE_WEAPON_COLUMN.athleteId) return athlete.id;
    if (h === ATHLETE_WEAPON_COLUMN.weaponId) return String(weaponId);
    return '';
  }));
  log_(ss, 'Оружие закреплено', user, { athleteId: athlete.id, text: title });
  return { status: 'success', message: title + ' закреплено за вами', link: link };
}

// Спортсмен открепляет от себя единицу оружия: удаляются его строки с этой единицей в «Спортсмен/Оружие».
// На уже поданные заявки не влияет — в них оружие записано текстом.
function unassignWeapon_(user, weaponId) {
  const ss = spreadsheet_();
  const athlete = findUser_(ss, athletesTable_(ss), user);
  const denied = accessDenied_(athlete);
  if (denied) throw userError_(denied.message);

  const links = readTable_(ss, SHEET.athleteWeapons);
  const athleteCol = links.col(ATHLETE_WEAPON_COLUMN.athleteId);
  const weaponCol = links.col(ATHLETE_WEAPON_COLUMN.weaponId);
  const mine = links.rows.filter(function (r) {
    return String(r.values[athleteCol]).trim() === athlete.id && String(r.values[weaponCol]).trim() === String(weaponId);
  });
  const link = { athleteId: athlete.id, weaponId: String(weaponId) };
  if (!mine.length) return { status: 'success', message: 'Это оружие уже не закреплено за вами', link: link };

  // Снизу вверх, чтобы номера ещё не удалённых строк не сдвигались
  mine.map(function (r) { return r.row; }).sort(function (a, b) { return b - a; }).forEach(function (row) {
    links.sheet.deleteRow(row);
  });

  const weapons = readTable_(ss, SHEET.weapons);
  const weapon = findById_(weapons, weaponId);
  const title = weapon
    ? String(weapons.get(weapon, WEAPON_COLUMN.title)).trim() + ' ' + String(weapons.get(weapon, WEAPON_COLUMN.number)).trim()
    : String(weaponId);
  log_(ss, 'Оружие откреплено', user, { athleteId: athlete.id, text: title });
  return { status: 'success', message: title + ' откреплено', link: link };
}

// ---------- Работа с листами ----------
// Чтение листа — самая долгая часть вызова скрипта. Поэтому:
//  - за один вызов каждый лист читается из таблицы не больше одного раза (sheetValuesMemo_);
//  - для отдачи данных приложению (doGet) листы берутся из CacheService на SHEET_CACHE_SECONDS;
//  - запись (doPost) всегда работает со свежими данными таблицы, не из кэша.
//
// Согласованность кэша с таблицей — через поколения. У каждого листа в кэше есть метка поколения
// ('gen:<лист>'), копия листа хранится под ключом с этой меткой ('sheet:<лист>:<метка>').
// Запись через приложение (после SpreadsheetApp.flush) и ручная правка (onSheetEdit) ставят листу новую метку —
// старая копия перестаёт находиться. Читатель узнаёт метку ДО чтения таблицы и кладёт копию под неё же:
// если запись случилась во время чтения, устаревшая копия ляжет под уже ненужную метку и никому не попадётся.
// Итог: загрузка, начатая после завершения записи, всегда видит эту запись. Правки другими скриптами
// (например, перенос соревнований в архив) скрипт не замечает — они видны через SHEET_CACHE_SECONDS
// или сразу по кнопке «Обновить» (fresh=1).

// Значения листов, уже прочитанных в этом вызове скрипта (глобальные переменные живут один вызов)
const sheetValuesMemo_ = {};

// Принудительное обновление (GET с fresh=1 — кнопки «Обновить» и «Проверить снова» в приложении):
// таблица читается мимо кэша, а кэш заполняется свежими данными. Так правки в таблице видны сразу,
// даже если триггер onSheetEdit не установлен
let freshRead_ = false;

// Метка поколения живёт дольше копий листов (6 часов — максимум CacheService). Пропала — создаётся новая,
// а листы просто перечитываются из таблицы
const SHEET_GENERATION_SECONDS = 6 * 60 * 60;

// Значения листа вместе со строкой заголовков, без пустых столбцов справа от последнего заголовка.
// fromCache — можно взять из CacheService (только для чтения)
function sheetValues_(ss, name, fromCache) {
  if (sheetValuesMemo_[name]) return sheetValuesMemo_[name];
  // Метки и копии берутся из кэша до чтения таблицы (см. выше). При принудительном обновлении (fresh)
  // копию не используем, но свежие данные под текущей меткой кладём
  const cached = fromCache ? sheetCache_() : null;
  let values = cached && !freshRead_ ? cached.values[name] : null;
  if (!values) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error('Нет листа «' + name + '»');
    values = trimEmptyColumns_(sheet.getDataRange().getValues());
    if (cached && cached.generations[name]) cachePutSheet_(ss, name, cached.generations[name], values);
  }
  sheetValuesMemo_[name] = values;
  return values;
}

// Столбцы справа от последнего непустого заголовка не нужны (их отдаёт getDataRange, если там есть форматирование)
function trimEmptyColumns_(values) {
  const headers = values[0] || [];
  let width = headers.length;
  while (width > 0 && String(headers[width - 1]).trim() === '') width--;
  return width === headers.length ? values : values.map(function (row) { return row.slice(0, width); });
}

const generationKey_ = function (name) { return 'gen:' + name; };
const sheetKey_ = function (name, generation) { return 'sheet:' + name + ':' + generation; };

// Метки поколений и копии всех листов приложения — двумя обращениями к CacheService за вызов.
// Все копии берутся в один момент, поэтому они согласованы между собой
let sheetCacheMemo_ = null;
function sheetCache_() {
  if (sheetCacheMemo_) return sheetCacheMemo_;
  const cache = CacheService.getScriptCache();
  const generations = cache.getAll(APP_SHEETS.map(generationKey_));
  const missing = {};
  const result = { generations: {}, values: {} };
  APP_SHEETS.forEach(function (name) {
    let generation = generations[generationKey_(name)];
    if (!generation) generation = missing[generationKey_(name)] = newId_();
    result.generations[name] = generation;
  });
  if (Object.keys(missing).length) cache.putAll(missing, SHEET_GENERATION_SECONDS);

  const copies = cache.getAll(APP_SHEETS.map(function (name) { return sheetKey_(name, result.generations[name]); }));
  APP_SHEETS.forEach(function (name) {
    const json = copies[sheetKey_(name, result.generations[name])];
    if (!json) return;
    // Даты в кэше хранятся как { $d: время }
    result.values[name] = JSON.parse(json).map(function (row) {
      return row.map(function (cell) { return cell && cell.$d !== undefined ? new Date(cell.$d) : cell; });
    });
  });
  sheetCacheMemo_ = result;
  return result;
}

function cachePutSheet_(ss, name, generation, values) {
  const json = JSON.stringify(values.map(function (row) {
    return row.map(function (cell) { return cell instanceof Date ? { $d: cell.getTime() } : cell; });
  }));
  // Слишком большой для CacheService — лист будет читаться из таблицы при каждой загрузке
  if (json.length > SHEET_CACHE_MAX_CHARS) {
    logOversizedSheet_(ss, name, json.length);
    return;
  }
  try {
    CacheService.getScriptCache().put(sheetKey_(name, generation), json, SHEET_CACHE_SECONDS);
  } catch (err) {
    console.error('Не удалось сохранить лист «' + name + '» в кэш: ' + err);
  }
}

// Предупреждение в «_Журнал», что лист перерос кэш (загрузка приложения замедлится) — не чаще раза в OVERSIZE_LOG_SECONDS
const OVERSIZE_LOG_SECONDS = 6 * 60 * 60;
function logOversizedSheet_(ss, name, chars) {
  const cache = CacheService.getScriptCache();
  const key = 'oversize:' + name;
  if (cache.get(key)) return;
  cache.put(key, '1', OVERSIZE_LOG_SECONDS);
  log_(ss, 'Лист не помещается в кэш', { id: '' }, {
    text: 'Лист «' + name + '»: ' + chars + ' символов при пределе ' + SHEET_CACHE_MAX_CHARS +
      '. Он читается из таблицы при каждой загрузке приложения — загрузка медленнее и тратит лимиты Apps Script. ' +
      'Варианты — в IMPROVEMENTS.md (сжатие и деление копии листа)',
  });
}

// После записи в лист (или ручной правки) его копия в кэше устарела — даём листу новое поколение.
// flush — чтобы запись точно оказалась в таблице раньше, чем кто-то прочитает её под новой меткой
function invalidateSheets_(names) {
  SpreadsheetApp.flush();
  const generations = {};
  names.forEach(function (name) { generations[generationKey_(name)] = newId_(); });
  CacheService.getScriptCache().putAll(generations, SHEET_GENERATION_SECONDS);
  sheetCacheMemo_ = null;
}

// Лист как таблица: заголовки, строки с непустым ID (первый столбец) и доступ к ячейкам по названию столбца
function readTable_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Нет листа «' + name + '»');
  const values = sheetValues_(ss, name, false);
  const headers = (values[0] || []).map(String);
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]).trim() !== '') rows.push({ row: r + 1, values: values[r] });
  }
  const col = function (column) {
    const i = headers.indexOf(column);
    if (i === -1) throw new Error('Нет столбца «' + column + '» на листе «' + name + '»');
    return i;
  };
  return {
    sheet: sheet,
    headers: headers,
    rows: rows,
    col: col,
    get: function (row, column) { return row.values[col(column)]; },
  };
}

function findById_(table, id) {
  const key = String(id === undefined || id === null ? '' : id).trim();
  if (!key) return null;
  for (let i = 0; i < table.rows.length; i++) {
    if (String(table.rows[i].values[0]).trim() === key) return table.rows[i];
  }
  return null;
}

// ---------- Чтение листов ----------

function readSheets_(ss, names, athleteId) {
  const wanted = names ? names.split(',').map(function (n) { return n.trim(); }) : APP_SHEETS;
  const sheets = {};

  APP_SHEETS.forEach(function (name) {
    if (wanted.indexOf(name) === -1 || !ss.getSheetByName(name)) return;

    const values = sheetValues_(ss, name, true);
    const headers = (values[0] || []).map(String);
    let rows = values.slice(1).filter(function (row) {
      return row.some(function (cell) { return cell !== ''; });
    });

    // Телефоны и ChatId спортсменов приложению не нужны (участников выбирают по ФИО) — отдаём только свои
    if (name === SHEET.athletes) {
      const hidden = [headers.indexOf(ATHLETE_COLUMN.phone), headers.indexOf(ATHLETE_COLUMN.chatId)];
      rows = rows.map(function (row) {
        if (String(row[0]).trim() === athleteId) return row;
        return row.map(function (cell, i) { return hidden.indexOf(i) === -1 ? cell : ''; });
      });
    }

    const ownerColumn = USER_SCOPED_SHEETS[name];
    if (ownerColumn) {
      const col = headers.indexOf(ownerColumn);
      rows = col === -1 ? [] : rows.filter(function (row) { return String(row[col]).trim() === athleteId; });
    }

    // Соревнования — только предстоящие: заявку можно подать только на них
    if (name === SHEET.competitions) {
      const startCol = headers.indexOf(COMPETITION_COLUMN.start);
      rows = startCol === -1 ? [] : rows.filter(function (row) { return isUpcoming_(row[startCol]); });
    }

    sheets[name] = { headers: headers, rows: rows };
  });

  return { status: 'success', updatedAt: new Date().toISOString(), athleteId: athleteId, sheets: sheets };
}

// ---------- Проверка данных Telegram ----------

/**
 * Проверка подписанной строки Telegram (initData или ответ requestContact) по алгоритму:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Возвращает { fields } — разобранные поля, или { expired: true } — подпись верна, но данные старше
 * INIT_DATA_MAX_AGE_SECONDS, или {} — подписи нет или она неверна.
 */
function verifySigned_(query) {
  if (!query) return {};
  const botToken = botToken_();
  if (!botToken) throw new Error('Не задано свойство скрипта BOT_TOKEN');

  const fields = {};
  String(query).split('&').forEach(function (pair) {
    const i = pair.indexOf('=');
    if (i === -1) return;
    fields[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, '%20'));
  });

  const hash = fields.hash;
  if (!hash) return {};
  delete fields.hash;

  const dataCheckString = Object.keys(fields).sort().map(function (key) {
    return key + '=' + fields[key];
  }).join('\n');

  const secretKey = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(botToken).getBytes(),
    Utilities.newBlob('WebAppData').getBytes()
  );
  const signature = Utilities.computeHmacSha256Signature(Utilities.newBlob(dataCheckString).getBytes(), secretKey);
  if (toHex_(signature) !== hash) return {};

  const authDate = Number(fields.auth_date);
  if (!authDate) return {};
  if (Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_SECONDS) return { expired: true };

  return { fields: fields };
}

// Токен бота из свойств скрипта — читается один раз за вызов. Пробелы и переносы по краям (частая ошибка
// при вставке) отбрасываются — иначе подпись Telegram не сойдётся
let botTokenMemo_;
function botToken_() {
  if (botTokenMemo_ === undefined) botTokenMemo_ = (PropertiesService.getScriptProperties().getProperty('BOT_TOKEN') || '').trim();
  return botTokenMemo_;
}

// Пользователь Telegram из initData или null
function verifyInitData_(initData) {
  const fields = verifySigned_(initData).fields;
  return fields && fields.user ? JSON.parse(fields.user) : null;
}

// Ответ, когда initData не прошли проверку: устарели (приложение открыто больше суток назад) или подделаны
function telegramDenied_(initData) {
  if (verifySigned_(initData).expired) {
    return { status: 'expired', message: 'Сеанс Telegram устарел — закройте приложение и откройте его заново' };
  }
  // Чаще всего подпись не сходится, когда приложение открыто из другого бота (например, тестовое — из рабочего).
  // Называем бота этого скрипта, чтобы это было видно сразу
  const bot = botUsername_();
  return {
    status: 'forbidden',
    message: 'Не удалось подтвердить пользователя Telegram' + (bot ? '. Откройте приложение из бота @' + bot : ''),
  };
}

// Имя бота по токену — для подсказок; запоминается в кэше на 6 часов. Нет связи с Telegram — пусто
function botUsername_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('bot-username');
  if (cached) return cached;
  try {
    const bot = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken_() + '/getMe', { muteHttpExceptions: true }).getContentText());
    if (!bot.ok) return '';
    cache.put('bot-username', bot.result.username, 6 * 60 * 60);
    return bot.result.username;
  } catch (err) {
    return '';
  }
}

// Номер из подписанного ответа requestContact — только если это номер самого пользователя
function verifiedPhone_(contactResponse, user) {
  const fields = verifySigned_(contactResponse).fields;
  if (!fields || !fields.contact) return null;
  const contact = JSON.parse(fields.contact);
  if (String(contact.user_id) !== String(user.id)) return null;
  return normalizePhone_(contact.phone_number) || null;
}

// ---------- Настройка окружения (функции для ручного запуска) ----------
//
// Эти функции приложение не вызывает — их запускают вручную в редакторе Apps Script: выбрать функцию в списке
// над кодом → «Выполнить». При первом запуске Google попросит разрешить доступ. Вывод — в «Журнале выполнения»
// внизу редактора.
//
// Новое окружение (например, тестовое: копия таблицы + свой бот) настраивается так:
//   1. «Настройки проекта» (⚙️) → «Свойства скрипта»: BOT_TOKEN и MINI_APP_URL (см. шапку файла);
//   2. installTriggers   — триггер onSheetEdit (или вручную в разделе «Триггеры»);
//   3. setupMenuButton   — кнопка меню бота ведёт в приложение этого окружения;
//   4. removeWebhook     — если checkSetup показывает вебхук (сообщения боту уходят старому коду);
//      markExistingCompetitions — один раз после добавления столбца «Рассылка» в «Соревнования»;
//   5. «Развернуть» → новое развёртывание (веб-приложение, «Выполнять как: я», доступ «Все») — его адрес
//      вписать в VITE_GOOGLE_SCRIPT_URL файла .env этого окружения;
//   6. checkSetup        — проверить, что всё сходится.
// Адрес стартовой кнопки бота (Main Mini App) через Bot API не меняется — только в @BotFather:
// Bot Settings → Configure Mini App → Edit Mini App URL.

/**
 * checkSetup — проверка настроек окружения. Ничего не меняет.
 *
 * Когда запускать: после настройки окружения и когда приложение пишет «Не удалось подтвердить пользователя
 * Telegram», открывает не то окружение или бот ведёт себя странно.
 *
 * Что выводит (в «Журнал выполнения» и строкой «Проверка настроек» в «_Журнал»):
 *  - BOT_TOKEN — длина и лишние пробелы (сам токен не выводится) и бот, которому он принадлежит;
 *  - вебхук — должен быть «не задан»: сообщения боту этот скрипт не обрабатывает (иначе см. removeWebhook);
 *  - кнопка меню — куда ведёт (должна вести на MINI_APP_URL; иначе см. setupMenuButton);
 *  - MINI_APP_URL, адрес веб-приложения этого скрипта (в редакторе часто видна служебная ссылка …/dev),
 *    название таблицы и есть ли триггер onSheetEdit.
 */
function checkSetup() {
  const props = PropertiesService.getScriptProperties();
  const rawToken = props.getProperty('BOT_TOKEN') || '';
  const lines = [];
  if (!rawToken) {
    lines.push('BOT_TOKEN: не задан');
  } else {
    lines.push('BOT_TOKEN: ' + rawToken.length + ' символов' + (rawToken !== rawToken.trim() ? ' — есть пробелы или переносы по краям (скрипт их отбрасывает)' : ''));
    const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + rawToken.trim() + '/getMe', { muteHttpExceptions: true });
    const bot = JSON.parse(response.getContentText());
    lines.push(bot.ok ? 'Бот: @' + bot.result.username + ' (' + bot.result.first_name + ')' : 'Бот: токен не принят Telegram — ' + bot.description);
    if (bot.ok) {
      // Кто получает сообщения боту: наш скрипт сообщения не обрабатывает, поэтому вебхук должен быть пустым.
      // Если он задан — ответы в чате (клавиатуры, команды) даёт тот код, а не этот скрипт
      const callBot = function (method) {
        return JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + rawToken.trim() + '/' + method, { muteHttpExceptions: true }).getContentText());
      };
      const webhook = callBot('getWebhookInfo');
      if (webhook.ok) {
        lines.push('Вебхук: ' + (webhook.result.url || 'не задан') +
          (webhook.result.pending_update_count ? ' (ждут обработки: ' + webhook.result.pending_update_count + ')' : '') +
          (webhook.result.last_error_message ? ' (последняя ошибка: ' + webhook.result.last_error_message + ')' : ''));
      }
      const menu = callBot('getChatMenuButton');
      if (menu.ok) {
        lines.push('Кнопка меню: ' + (menu.result.type === 'web_app' ? '«' + menu.result.text + '» → ' + menu.result.web_app.url : menu.result.type));
      }
    }
  }
  lines.push('MINI_APP_URL: ' + (props.getProperty('MINI_APP_URL') || 'не задан'));
  lines.push('Адрес веб-приложения этого скрипта: ' + (ScriptApp.getService().getUrl() || 'не развёрнут'));
  lines.push('Таблица: ' + spreadsheet_().getName());
  const triggers = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'onSheetEdit'; });
  lines.push('Триггер onSheetEdit: ' + (triggers.length ? 'есть' : 'нет'));
  // И в журнал выполнения, и строкой в «_Журнал» — там вывод видно, даже если журнал выполнения не открылся
  console.log(lines.join('\n'));
  log_(spreadsheet_(), 'Проверка настроек', { id: '' }, { text: lines.join('\n') });
}

/**
 * setupMenuButton — кнопка меню бота «Приложение» (слева от поля ввода в чате) на адрес MINI_APP_URL.
 *
 * Что делает:
 *  1. ставит общую кнопку меню для всех чатов бота;
 *  2. сбрасывает кнопки, заданные для отдельных чатов (их мог поставить прежний код бота — они важнее общей),
 *     у всех спортсменов с ChatId, чтобы у них тоже действовала общая.
 *
 * Когда запускать: при настройке окружения и после смены MINI_APP_URL. Повторный запуск безопасен.
 * Нужно: свойства BOT_TOKEN и MINI_APP_URL.
 * Что выводит: куда ведёт кнопка и сколько кнопок отдельных чатов сброшено.
 * Не меняет: стартовую кнопку бота (Main Mini App) — её адрес задаётся только в @BotFather.
 * У пользователей Telegram может показывать старую кнопку, пока чат с ботом не открыт заново.
 */
function setupMenuButton() {
  const props = PropertiesService.getScriptProperties();
  const appUrl = props.getProperty('MINI_APP_URL');
  if (!appUrl) throw new Error('Не задано свойство скрипта MINI_APP_URL');
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken_() + '/setChatMenuButton', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({ menu_button: { type: 'web_app', text: 'Приложение', web_app: { url: appUrl } } }),
  });
  const result = JSON.parse(response.getContentText());
  console.log(result.ok ? 'Кнопка меню: «Приложение» → ' + appUrl : 'Не удалось: ' + result.description);
  if (!result.ok) return;

  // Кнопка, заданная для отдельного чата (её мог поставить прежний код бота), важнее общей — сбрасываем такие
  // кнопки у всех спортсменов с ChatId, чтобы у них действовала общая. Запросы — пачкой, одним fetchAll
  const chatIds = athletesTable_(spreadsheet_()).athletes
    .map(function (a) { return a.chatId; })
    .filter(function (id, i, all) { return id && all.indexOf(id) === i; });
  const responses = UrlFetchApp.fetchAll(chatIds.map(function (chatId) {
    return {
      url: 'https://api.telegram.org/bot' + botToken_() + '/setChatMenuButton',
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: chatId, menu_button: { type: 'default' } }),
    };
  }));
  const failed = responses.filter(function (r) { return !JSON.parse(r.getContentText()).ok; }).length;
  console.log('Кнопки отдельных чатов сброшены: ' + (chatIds.length - failed) + ' из ' + chatIds.length +
    (failed ? ' (не удалось — обычно чаты, где пользователь не писал боту)' : ''));
  console.log('Если приложение всё ещё открывается не то — проверьте адрес в @BotFather → Bot Settings → Configure Mini App');
}

/**
 * removeWebhook — снять вебхук бота.
 *
 * Зачем: сообщения боту этот скрипт не обрабатывает. Если у бота задан вебхук на старый адрес (старое
 * развёртывание, другой сервер), в чате отвечает старый код — со старыми клавиатурами и командами, —
 * или Telegram копит ошибки доставки.
 *
 * Когда запускать: если checkSetup показывает вебхук. Сначала убедитесь, что по тому адресу нет нужной логики
 * (команд, рассылок), — после снятия она перестанет получать сообщения. Повторный запуск безопасен.
 * Что выводит: «Вебхук снят» или ошибку Telegram. Сообщения, ждущие обработки, отбрасываются.
 */
function removeWebhook() {
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken_() + '/deleteWebhook?drop_pending_updates=true', {
    muteHttpExceptions: true,
  });
  const result = JSON.parse(response.getContentText());
  console.log(result.ok ? 'Вебхук снят' : 'Не удалось: ' + result.description);
}

/**
 * markExistingCompetitions — отметить все уже внесённые соревнования как разосланные.
 *
 * Зачем: рассылка о новом соревновании уходит, когда у строки пуст столбец «Рассылка». Сразу после добавления
 * этого столбца он пуст у всех строк — и первая же правка старого соревнования разослала бы его как новое.
 * Функция пишет «до рассылки» во все пустые ячейки «Рассылки», и рассылаются только соревнования, добавленные после.
 *
 * Когда запускать: один раз — сразу после того, как в лист «Соревнования» добавлен столбец «Рассылка».
 * Повторный запуск безопасен: заполненные ячейки не трогаются (но и новые неразосланные строки будут отмечены).
 * Что выводит: сколько строк отмечено.
 */
function markExistingCompetitions() {
  const competitions = readTable_(spreadsheet_(), SHEET.competitions);
  if (competitions.headers.indexOf(COMPETITION_COLUMN.notified) === -1) {
    throw new Error('Сначала добавьте в лист «' + SHEET.competitions + '» столбец «' + COMPETITION_COLUMN.notified + '»');
  }
  const col = competitions.col(COMPETITION_COLUMN.notified);
  let marked = 0;
  competitions.rows.forEach(function (row) {
    if (String(row.values[col]).trim() !== '') return;
    competitions.sheet.getRange(row.row, col + 1).setValue('до рассылки');
    marked++;
  });
  console.log('Отмечено соревнований: ' + marked);
}

/**
 * installTriggers — триггер onSheetEdit на ручные правки таблицы (ID новым строкам, сброс кэша, уведомления).
 *
 * Когда запускать: один раз при настройке окружения. Повторный запуск безопасен — прежний триггер onSheetEdit
 * удаляется, дублей не будет; другие триггеры не трогаются.
 * Если Google отвечает «Произошла неизвестная ошибка» — создайте триггер вручную: «Триггеры» (⏰) →
 * «Добавить триггер» → функция onSheetEdit, источник «Из таблицы», тип «При изменении».
 */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'onSheetEdit') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(spreadsheet_()).onEdit().create();
}

// ---------- Ручные правки таблицы и уведомления в Telegram ----------

/**
 * Срабатывает при ручной правке таблицы (на изменения, сделанные скриптом, не срабатывает):
 *  - строке без ID на листе из AUTO_ID_SHEETS, где появились данные, выдаётся ID;
 *  - у нового соревнования заполнены все NEW_COMPETITION_REQUIRED — перевозчикам уходит рассылка;
 *  - статус спортсмена сменили на «Подтвержден» — бот поздравляет его с доступом;
 *  - статус заявки сменили на один из NOTIFY_APPLICATION_STATUSES — бот сообщает автору заявки.
 * Обрабатываются и правки диапазоном (вставка, протягивание).
 */
function onSheetEdit(e) {
  try {
    const sheetName = e.range.getSheet().getName();
    // ID — до сброса кэша, чтобы приложение сразу получило строку уже с ID
    if (AUTO_ID_SHEETS.indexOf(sheetName) !== -1) assignMissingIds_(e.range);
    if (sheetName === SHEET.competitions) notifyNewCompetitions_(spreadsheet_(), e.range);
    // Лист правили вручную — его кэш для приложения устарел
    if (APP_SHEETS.indexOf(sheetName) !== -1) invalidateSheets_([sheetName]);
    // Значение не изменилось (выбрали то же самое) — молчим. oldValue есть только у правки одной ячейки
    if (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 && e.oldValue === e.value) return;

    const ss = spreadsheet_();
    if (sheetName === SHEET.athletes) notifyConfirmedAthletes_(ss, e.range);
    if (sheetName === SHEET.applications) notifyApplicationStatus_(ss, e.range);
  } catch (err) {
    console.error('onSheetEdit: ' + err);
  }
}

// Строкам правки (кроме заголовка), где есть данные, но пуст первый столбец, — новый ID.
// Одно чтение и одна запись на всю правку, даже если вставили много строк
function assignMissingIds_(range) {
  const sheet = range.getSheet();
  const firstRow = Math.max(range.getRow(), 2);
  const numRows = range.getLastRow() - firstRow + 1;
  const lastColumn = sheet.getLastColumn();
  if (numRows < 1 || lastColumn < 1) return;

  const block = sheet.getRange(firstRow, 1, numRows, lastColumn);
  const values = block.getValues();
  let changed = false;
  const issued = {};
  const ids = values.map(function (row) {
    if (String(row[0]).trim() !== '') return [row[0]];
    const hasData = row.slice(1).some(function (cell) { return String(cell).trim() !== ''; });
    if (!hasData) return [row[0]];
    // При вставке многих строк ID выдаются в одну миллисекунду — повтор внутри вставки исключаем
    let id = generateShortId();
    while (issued[id]) id = generateShortId();
    issued[id] = true;
    changed = true;
    return [id];
  });
  if (changed) sheet.getRange(firstRow, 1, numRows, 1).setValues(ids);
}

// Рассылка подтверждённым перевозчикам о новых соревнованиях в строках правки: заполнены все
// NEW_COMPETITION_REQUIRED, столбец «Рассылка» пуст, соревнование ещё не началось. После рассылки в «Рассылку»
// пишется её время — поэтому каждое соревнование рассылается один раз, и последующие правки строки рассылку не повторяют.
// Под блокировкой: два быстрых срабатывания триггера подряд иначе оба увидели бы пустую отметку
function notifyNewCompetitions_(ss, range) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return; // не дождались — строку подхватит следующая правка
  try {
    const competitions = readTable_(ss, SHEET.competitions);
    if (competitions.headers.indexOf(COMPETITION_COLUMN.notified) === -1) return;
    const notifiedCol = competitions.col(COMPETITION_COLUMN.notified) + 1;

    const ready = competitions.rows.filter(function (row) {
      if (!rowInRange_(range, row.row)) return false;
      if (String(competitions.get(row, COMPETITION_COLUMN.notified)).trim() !== '') return false;
      const filled = NEW_COMPETITION_REQUIRED.every(function (column) {
        return String(competitions.get(row, column)).trim() !== '';
      });
      return filled && isUpcoming_(competitions.get(row, COMPETITION_COLUMN.start));
    });
    if (!ready.length) return;

    const carriers = athletesTable_(ss).athletes.filter(function (a) {
      return a.status === ATHLETE_STATUS.confirmed && a.isCarrier && a.chatId;
    });
    ready.forEach(function (row) {
      const text = competitionMessage_(competitions, row);
      // Кнопка ведёт сразу в мастер заявки на этом соревновании
      const button = { text: 'Подать заявку', params: { page: 'application-form', competition: String(row.values[0]).trim() } };
      const responses = UrlFetchApp.fetchAll(carriers.map(function (a) {
        const args = telegramRequestArgs_(a.chatId, text, button);
        args[1].url = args[0];
        return args[1];
      }));
      const failed = [];
      responses.forEach(function (response, i) {
        const error = telegramError_(response);
        if (error) failed.push(carriers[i].shortName + ' — ' + error);
      });
      competitions.sheet.getRange(row.row, notifiedCol).setValue(new Date());
      const title = String(competitions.get(row, COMPETITION_COLUMN.title)).trim();
      log_(ss, 'Рассылка: новое соревнование', { id: '' }, {
        text: title + ' — отправлено ' + (carriers.length - failed.length) + ' из ' + carriers.length + ' перевозчикам' +
          (failed.length ? '. Не доставлено: ' + failed.join('; ') : ''),
      });
    });
  } finally {
    lock.releaseLock();
  }
}

// Текст рассылки о соревновании: название, вид, даты, адрес
function competitionMessage_(competitions, row) {
  const value = function (column) { return String(competitions.get(row, column)).trim(); };
  const date = function (column) {
    const raw = competitions.get(row, column);
    const parsed = sheetDate_(raw);
    return parsed ? Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'dd.MM.yyyy') : String(raw).trim();
  };
  const start = date(COMPETITION_COLUMN.start);
  const end = date(COMPETITION_COLUMN.end);
  return [
    'Новое соревнование: ' + value(COMPETITION_COLUMN.title),
    value(COMPETITION_COLUMN.kind),
    'Даты: ' + (end && end !== start ? start + ' – ' + end : start),
    'Адрес: ' + value(COMPETITION_COLUMN.address),
    '',
    'Чтобы подать заявку на перевозку, нажмите «Подать заявку».',
  ].filter(function (line, i) { return i !== 1 || line; }).join('\n');
}

function notifyConfirmedAthletes_(ss, range) {
  const table = athletesTable_(ss);
  const statusCol = readTable_(ss, SHEET.athletes).col(ATHLETE_COLUMN.status) + 1;
  if (!columnInRange_(range, statusCol)) return;

  table.athletes.forEach(function (athlete) {
    if (!rowInRange_(range, athlete.row) || athlete.status !== ATHLETE_STATUS.confirmed || !athlete.chatId) return;
    notify_(ss, athlete, 'Здравствуйте, ' + athlete.greetingName + '! Ваш доступ к приложению подтверждён.',
      'Уведомление: доступ подтверждён');
  });
}

function notifyApplicationStatus_(ss, range) {
  const applications = readTable_(ss, SHEET.applications);
  if (!columnInRange_(range, applications.col(APPLICATION_COLUMN.status) + 1)) return;
  const athletes = athletesTable_(ss);

  applications.rows.forEach(function (row) {
    if (!rowInRange_(range, row.row)) return;
    const status = String(applications.get(row, APPLICATION_COLUMN.status)).trim();
    if (NOTIFY_APPLICATION_STATUSES.indexOf(status) === -1) return;

    const authorId = String(applications.get(row, APPLICATION_COLUMN.createdBy)).trim();
    const author = findAthlete_(athletes, function (a) { return a.id === authorId; });
    if (!author || !author.chatId) return;

    const number = row.values[0];
    const title = String(applications.get(row, APPLICATION_COLUMN.competitionTitle)).trim();
    notify_(ss, author, 'Заявка № ' + number + (title ? ' (' + title + ')' : '') + ': статус изменён на «' + status + '».',
      'Уведомление: заявка № ' + number + ' — ' + status);
  });
}

// Сообщение спортсмену от бота с кнопкой, открывающей Mini App; результат — в журнал
function notify_(ss, athlete, text, logEvent) {
  const error = sendTelegram_(athlete.chatId, text);
  log_(ss, logEvent, { id: athlete.chatId, first_name: athlete.fullName }, {
    athleteId: athlete.id,
    text: error ? 'Не отправлено: ' + error : 'Отправлено',
  });
}

// Отправка через Bot API. Возвращает null или текст ошибки (например, пользователь не разрешил боту писать)
function sendTelegram_(chatId, text) {
  if (!botToken_()) return 'не задано свойство скрипта BOT_TOKEN';
  return telegramError_(UrlFetchApp.fetch.apply(UrlFetchApp, telegramRequestArgs_(chatId, text)));
}

// Запрос sendMessage с кнопкой, открывающей приложение (если задан MINI_APP_URL): [адрес, параметры] для UrlFetchApp.
// button — { text, params }: надпись и параметры адреса приложения (например, { page, competition });
// по умолчанию «Открыть приложение» на стартовой странице
function telegramRequestArgs_(chatId, text, button) {
  const message = { chat_id: chatId, text: text };
  const appUrl = PropertiesService.getScriptProperties().getProperty('MINI_APP_URL');
  if (appUrl) {
    const params = (button && button.params) || {};
    const query = Object.keys(params).map(function (key) { return key + '=' + encodeURIComponent(params[key]); }).join('&');
    const url = query ? appUrl + (appUrl.indexOf('?') === -1 ? '?' : '&') + query : appUrl;
    message.reply_markup = { inline_keyboard: [[{ text: (button && button.text) || 'Открыть приложение', web_app: { url: url } }]] };
  }
  return ['https://api.telegram.org/bot' + botToken_() + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify(message),
  }];
}

// null — сообщение доставлено; иначе текст ошибки Telegram
function telegramError_(response) {
  if (response.getResponseCode() === 200) return null;
  try {
    return JSON.parse(response.getContentText()).description || 'код ' + response.getResponseCode();
  } catch (err) {
    return 'код ' + response.getResponseCode();
  }
}

function rowInRange_(range, row) {
  return row >= range.getRow() && row <= range.getLastRow();
}

function columnInRange_(range, col) {
  return col >= range.getColumn() && col <= range.getLastColumn();
}

// ---------- Журнал ----------

// Запись в журнал выполнения Apps Script и в лист _Журнал. Ошибка записи не ломает ответ пользователю.
function log_(ss, event, user, details) {
  const tgName = [user.first_name, user.last_name].filter(Boolean).join(' ') + (user.username ? ' (@' + user.username + ')' : '');
  const row = [new Date(), event, user.id, tgName, details.phone || '', details.athleteId || '', details.text || ''];
  console.log(JSON.stringify({ event: event, telegramId: user.id, telegramUser: tgName, phone: row[4], athleteId: row[5], details: row[6] }));
  try {
    let sheet = ss.getSheetByName(SHEET.log);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET.log);
      sheet.appendRow(LOG_COLUMNS);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow(row);
  } catch (err) {
    console.error('Не удалось записать в лист ' + SHEET.log + ': ' + err);
  }
}

// ---------- Утилиты ----------

// 79001234567 → +7 900 123-45-67
function formatPhone_(digits) {
  const m = String(digits).match(/^7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? '+7 ' + m[1] + ' ' + m[2] + '-' + m[3] + '-' + m[4] : '+' + digits;
}

// Телефон к виду 7XXXXXXXXXX: «+7 (900) 123-45-67», «89001234567» и «9001234567» совпадут
function normalizePhone_(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.charAt(0) === '8') digits = '7' + digits.slice(1);
  if (digits.length === 10) digits = '7' + digits;
  return digits;
}

// «Иванов Иван Петрович» → «Иванов И.П.»
function shortName_(lastName, firstName, middleName) {
  const initials = [firstName, middleName].filter(Boolean).map(function (n) { return n.charAt(0).toUpperCase() + '.'; }).join('');
  return [lastName, initials].filter(Boolean).join(' ');
}

// Предстоящее соревнование: дата начала — сегодня или позже (по часовому поясу скрипта).
// Дата не указана или записана так, что её не разобрать, — тоже считаем предстоящим, иначе соревнование
// пропадёт из приложения; заявка на него оформляется без сроков перевозки
function isUpcoming_(start) {
  const date = sheetDate_(start);
  if (!date) return true;
  const now = new Date();
  return date >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Дата из ячейки: ячейка с типом «дата» или текст «дд.мм.гггг» (полночь в часовом поясе скрипта); иначе null
function sheetDate_(value) {
  if (value instanceof Date) return value;
  const m = String(value || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const date = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return date.getMonth() === Number(m[2]) - 1 ? date : null;
}

// Дата ± дни (полночь в часовом поясе скрипта)
function shiftDays_(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// Тот же человек по ФИО: без учёта регистра, «ё/е» и лишних пробелов. Если отчество не указано
// у одного из двоих — сравниваются фамилия и имя (у разных отчеств — разные люди)
function sameName_(athlete, lastName, firstName, middleName) {
  const norm = function (s) { return cleanName_(s).toLowerCase().replace(/ё/g, 'е'); };
  if (norm(athlete.lastName) !== norm(lastName) || norm(athlete.firstName) !== norm(firstName)) return false;
  return !norm(athlete.middleName) || !norm(middleName) || norm(athlete.middleName) === norm(middleName);
}

function cleanName_(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH);
}

// ID в том же формате, что и существующие: время в base36 + 4 случайных символа
function newId_() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// generateShortId — короткий ID строки (тот же формат, что у newId_). Имя без «_», чтобы функция была доступна
// вне скрипта: её вызывает onSheetEdit для строк, внесённых вручную, и её можно вызвать из других скриптов таблицы
// (например, при переносе строк). Формулой в ячейке (=generateShortId()) не использовать: при пересчёте таблицы
// ID поменяется и связи с ним потеряются
function generateShortId() {
  return newId_();
}

function spreadsheet_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function toHex_(bytes) {
  return bytes.map(function (b) {
    return ('0' + (b & 0xff).toString(16)).slice(-2);
  }).join('');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
