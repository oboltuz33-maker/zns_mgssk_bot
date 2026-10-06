/**
 * Бэкенд Mini App: чтение листов таблицы и авторизация спортсменов.
 *
 * GET  ?action=sheets&initData=<Telegram.WebApp.initData>[&names=A,B]
 *      Листы одним запросом — Mini App фильтрует их у себя, чтобы не расходовать лимиты.
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
 *  - листы из USER_SCOPED_SHEETS отдаются только со строками этого спортсмена.
 *
 * Уведомления: при ручной смене статуса спортсмена на «Подтвержден» и статуса заявки на «В работе» /
 * «Выполнена» бот пишет спортсмену (триггер onSheetEdit; создаётся один раз функцией installTriggers).
 *
 * Ответы: status = success | unregistered | pending | forbidden | expired | not_found | conflict | error
 * (expired — подпись Telegram верна, но приложение открыто больше INIT_DATA_MAX_AGE_SECONDS назад).
 * События входа пишутся в журнал выполнения и в служебный лист «_Журнал».
 *
 * Токен бота хранится в свойствах скрипта, а не в коде:
 * «Настройки проекта» (⚙️) → «Свойства скрипта» → BOT_TOKEN = <токен от @BotFather>.
 *
 * Первая строка листа — заголовки, первый столбец — ID строки.
 * Листы, имя которых начинается с "_", не отдаются.
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

// Разделитель элементов списка в ячейке заявки (оружие, виды транспорта)
const LIST_SEPARATOR = ';\n';

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

// Как связаться с администратором (например, '@username' или телефон) — подставляется
// в сообщения пользователю, когда без администратора не обойтись. Пусто — не показывается.
const ADMIN_CONTACT = '';

// Адрес Mini App — для кнопки «Открыть приложение» в уведомлениях бота
const MINI_APP_URL = 'https://oboltuz33-maker.github.io/zns_mgssk_bot/';

// Статусы заявки, о смене на которые бот сообщает автору заявки
const NOTIFY_APPLICATION_STATUSES = [APPLICATION_STATUS.inProgress, APPLICATION_STATUS.done];

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
    const athlete = findAthlete_(athletesTable_(ss), function (a) { return a.chatId === String(user.id); });
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
  const linked = findAthlete_(table, function (a) { return a.chatId === String(user.id); });
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
  const linked = findAthlete_(table, function (a) { return a.chatId === String(user.id); });
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

function athletesTable_(ss) {
  const sheet = ss.getSheetByName(SHEET.athletes);
  if (!sheet) throw new Error('Нет листа «' + SHEET.athletes + '»');

  const values = sheet.getDataRange().getValues();
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

function findAthlete_(table, predicate) {
  for (let i = 0; i < table.athletes.length; i++) {
    if (predicate(table.athletes[i])) return table.athletes[i];
  }
  return null;
}

// ---------- Заявки на перевозку ----------

// Создание (без number) или изменение заявки. Текст строки собирается по ID из справочников —
// значениям из приложения доверяются только ID и выбор, а не готовый текст.
function saveApplication_(user, input) {
  const ss = spreadsheet_();
  const author = requireCarrier_(ss, user);
  const fields = buildApplication_(ss, author, input);
  const table = readTable_(ss, SHEET.applications);

  if (input.number) {
    const row = ownNewApplication_(table, input.number, author);
    const values = row.values.slice();
    Object.keys(fields).forEach(function (name) { values[table.col(name)] = fields[name]; });
    table.sheet.getRange(row.row, 1, 1, values.length).setValues([values]);
    log_(ss, 'Заявка изменена', user, { athleteId: author.id, text: '№ ' + input.number });
    return { status: 'success', number: Number(input.number) };
  }

  const number = nextApplicationNumber_(ss, table);
  fields[APPLICATION_COLUMN.number] = number;
  fields[APPLICATION_COLUMN.status] = APPLICATION_STATUS.new;
  fields[APPLICATION_COLUMN.createdBy] = author.id;
  fields[APPLICATION_COLUMN.createdAt] = new Date();
  table.sheet.appendRow(table.headers.map(function (h) { return fields.hasOwnProperty(h) ? fields[h] : ''; }));
  log_(ss, 'Заявка создана', user, { athleteId: author.id, text: '№ ' + number + ', ' + fields[APPLICATION_COLUMN.competitionTitle] });
  return { status: 'success', number: number };
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
  const athlete = findAthlete_(athletesTable_(ss), function (a) { return a.chatId === String(user.id); });
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
    weaponIds.forEach(function (weaponId) {
      const weapon = findById_(weapons, weaponId);
      if (!weapon) throw userError_('Оружие не найдено — обновите данные и выберите заново');
      weaponLines.push([
        athlete.shortName,
        String(weapons.get(weapon, WEAPON_COLUMN.title)).trim(),
        String(weapons.get(weapon, WEAPON_COLUMN.number)).trim(),
      ].join(' - '));
    });
  });

  const transportTypes = readTable_(ss, SHEET.transportTypes).rows.map(function (r) { return String(r.values[0]).trim(); });
  const transport = (Array.isArray(input.transport) ? input.transport : []).map(String);
  if (!transport.length) throw userError_('Выберите вид транспорта');
  transport.forEach(function (name) {
    if (transportTypes.indexOf(name) === -1) throw userError_('Вид транспорта «' + name + '» не найден в справочнике');
  });

  // Сроки перевозки — от дат соревнования; без дат заявку не оформить
  const competitionStart = competitions.get(competition, COMPETITION_COLUMN.start);
  const competitionEnd = competitions.get(competition, COMPETITION_COLUMN.end) || competitionStart;
  if (!(competitionStart instanceof Date) || !(competitionEnd instanceof Date)) {
    throw userError_('У соревнования не указаны даты — обратитесь к администратору');
  }
  const transportStart = shiftDays_(competitionStart, -TRANSPORT_DAYS_BEFORE);
  const transportEnd = shiftDays_(competitionEnd, TRANSPORT_DAYS_AFTER);

  const fields = {};
  fields[APPLICATION_COLUMN.fullName] = author.fullName;
  fields[APPLICATION_COLUMN.weapon] = weaponLines.join(LIST_SEPARATOR);
  fields[APPLICATION_COLUMN.transport] = transport.join(LIST_SEPARATOR);
  fields[APPLICATION_COLUMN.transportStart] = transportStart;
  fields[APPLICATION_COLUMN.transportEnd] = transportEnd;
  fields[APPLICATION_COLUMN.competitionKind] = competitions.get(competition, COMPETITION_COLUMN.kind);
  fields[APPLICATION_COLUMN.competitionTitle] = competitions.get(competition, COMPETITION_COLUMN.title);
  fields[APPLICATION_COLUMN.ekpNumber] = competitions.get(competition, COMPETITION_COLUMN.ekpNumber);
  fields[APPLICATION_COLUMN.ekpStart] = competitions.get(competition, COMPETITION_COLUMN.start);
  fields[APPLICATION_COLUMN.ekpEnd] = competitions.get(competition, COMPETITION_COLUMN.end);
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
  const athlete = findAthlete_(athletesTable_(ss), function (a) { return a.chatId === String(user.id); });
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
  if (already) return { status: 'success', message: title + ' уже закреплено за вами' };

  links.sheet.appendRow(links.headers.map(function (h) {
    if (h === ATHLETE_WEAPON_COLUMN.athleteId) return athlete.id;
    if (h === ATHLETE_WEAPON_COLUMN.weaponId) return String(weaponId);
    return '';
  }));
  log_(ss, 'Оружие закреплено', user, { athleteId: athlete.id, text: title });
  return { status: 'success', message: title + ' закреплено за вами' };
}

// Спортсмен открепляет от себя единицу оружия: удаляются его строки с этой единицей в «Спортсмен/Оружие».
// На уже поданные заявки не влияет — в них оружие записано текстом.
function unassignWeapon_(user, weaponId) {
  const ss = spreadsheet_();
  const athlete = findAthlete_(athletesTable_(ss), function (a) { return a.chatId === String(user.id); });
  const denied = accessDenied_(athlete);
  if (denied) throw userError_(denied.message);

  const links = readTable_(ss, SHEET.athleteWeapons);
  const athleteCol = links.col(ATHLETE_WEAPON_COLUMN.athleteId);
  const weaponCol = links.col(ATHLETE_WEAPON_COLUMN.weaponId);
  const mine = links.rows.filter(function (r) {
    return String(r.values[athleteCol]).trim() === athlete.id && String(r.values[weaponCol]).trim() === String(weaponId);
  });
  if (!mine.length) return { status: 'success', message: 'Это оружие уже не закреплено за вами' };

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
  return { status: 'success', message: title + ' откреплено' };
}

// ---------- Работа с листами ----------

// Лист как таблица: заголовки, строки с непустым ID (первый столбец) и доступ к ячейкам по названию столбца
function readTable_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Нет листа «' + name + '»');
  const values = sheet.getDataRange().getValues();
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
  const wanted = names ? names.split(',').map(function (n) { return n.trim(); }) : null;
  const sheets = {};

  ss.getSheets().forEach(function (sheet) {
    const name = sheet.getName();
    if (name.charAt(0) === '_') return;
    if (wanted && wanted.indexOf(name) === -1) return;

    // Один вызов getValues на лист — самый дешёвый способ чтения
    const values = sheet.getDataRange().getValues();
    const headers = (values.shift() || []).map(String);
    let rows = values.filter(function (row) {
      return row.some(function (cell) { return cell !== ''; });
    });

    const ownerColumn = USER_SCOPED_SHEETS[name];
    if (ownerColumn) {
      const col = headers.indexOf(ownerColumn);
      rows = col === -1 ? [] : rows.filter(function (row) { return String(row[col]).trim() === athleteId; });
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
  const botToken = PropertiesService.getScriptProperties().getProperty('BOT_TOKEN');
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
  return { status: 'forbidden', message: 'Не удалось подтвердить пользователя Telegram' };
}

// Номер из подписанного ответа requestContact — только если это номер самого пользователя
function verifiedPhone_(contactResponse, user) {
  const fields = verifySigned_(contactResponse).fields;
  if (!fields || !fields.contact) return null;
  const contact = JSON.parse(fields.contact);
  if (String(contact.user_id) !== String(user.id)) return null;
  return normalizePhone_(contact.phone_number) || null;
}

// ---------- Уведомления в Telegram ----------

/**
 * Один раз запустите эту функцию в редакторе Apps Script (выбрать installTriggers → «Выполнить»)
 * и разрешите доступ: она создаёт триггер onSheetEdit на правки таблицы. Повторный запуск не плодит дубли.
 */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'onSheetEdit') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(spreadsheet_()).onEdit().create();
}

/**
 * Срабатывает при ручной правке таблицы (на изменения, сделанные скриптом, не срабатывает):
 *  - статус спортсмена сменили на «Подтвержден» — бот поздравляет его с доступом;
 *  - статус заявки сменили на один из NOTIFY_APPLICATION_STATUSES — бот сообщает автору заявки.
 * Обрабатываются и правки диапазоном (вставка, протягивание).
 */
function onSheetEdit(e) {
  try {
    const sheetName = e.range.getSheet().getName();
    // Значение не изменилось (выбрали то же самое) — молчим. oldValue есть только у правки одной ячейки
    if (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1 && e.oldValue === e.value) return;

    const ss = spreadsheet_();
    if (sheetName === SHEET.athletes) notifyConfirmedAthletes_(ss, e.range);
    if (sheetName === SHEET.applications) notifyApplicationStatus_(ss, e.range);
  } catch (err) {
    console.error('onSheetEdit: ' + err);
  }
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
  const botToken = PropertiesService.getScriptProperties().getProperty('BOT_TOKEN');
  if (!botToken) return 'не задано свойство скрипта BOT_TOKEN';
  const response = UrlFetchApp.fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      chat_id: chatId,
      text: text,
      reply_markup: { inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: MINI_APP_URL } }]] },
    }),
  });
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
