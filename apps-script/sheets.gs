/**
 * Бэкенд Mini App: вход спортсменов, отдача листов таблицы, заявки на перевозку, закрепление оружия,
 * настройки и уведомления бота.
 *
 * POST { action: 'sheets', initData, names?: [...], fresh?: true }
 *      Листы одним запросом — Mini App фильтрует их у себя, чтобы не расходовать лимиты.
 *      fresh — прочитать таблицу мимо кэша (кнопка «Обновить» в приложении). Запрос POST, а не GET:
 *      подписанные данные Telegram в теле запроса не попадают в адрес и журналы Google.
 * GET  ?action=sheets&initData=…[&names=A,B][&fresh=1]
 *      То же для версий приложения до перехода на POST — убрать, когда старые версии перестанут открываться.
 * POST { action: 'linkPhone', initData, contact }
 *      Привязка по номеру телефона: contact — подписанный ответ Telegram.WebApp.requestContact.
 * POST { action: 'register', initData, lastName, firstName, middleName, contact }
 *      Заявка на доступ по ФИО, если номер (contact обязателен) не найден в списке, —
 *      строка со статусом «Требует подтверждения».
 * POST { action: 'saveApplication', initData, application: { number?, competitionId, items, transport } }
 *      Создание (без number) или изменение заявки на перевозку. items — [{ athleteId, weaponIds: [...] }],
 *      transport — названия из листа «Виды транспорта». Сроки перевозки скрипт ставит сам по датам
 *      соревнования: за TRANSPORT_DAYS_BEFORE дней до начала и через TRANSPORT_DAYS_AFTER после окончания.
 *      Оружие — только закреплённое за спортсменом (при изменении — ещё и уже записанное у него в заявке).
 * POST { action: 'unassignWeapon', initData, weaponId }
 *      Администратор открепляет единицу от себя — строка удаляется из листа «Спортсмен/Оружие».
 *      Закрепляет и открепляет оружие только администратор (adminAssignWeapon, adminUnassignWeapon).
 * POST { action: 'setNotifications', initData, notifications: { competitions?, applications? } }
 *      Настройки уведомлений перевозчика (true/false) — в его строке «Спортсменов».
 * POST { action: 'deleteApplication', initData, number }
 *      Удаление: заявка переносится в «Архив заявок» со статусом «Удалена».
 *
 *
 * Администрирование — только подтверждённым спортсменам с «Да» в столбце «Администратор» (раздел «Администрирование»):
 * POST { action: 'adminSetApplicationStatus', initData, number, status, from, reason? }
 *      Смена статуса заявки по жизненному циклу (APPLICATION_TRANSITIONS); from — статус, который видел администратор.
 *      «Отклонена» — с причиной (столбец «Причина отклонения»). Автору — сообщение бота.
 * POST { action: 'adminSaveApplication', initData, application: { number, competitionId?, items, transport,
 *      transportStart, transportEnd, address } }
 *      Правка любой заявки: участники, оружие, транспорт, соревнование (если выбрано заново), сроки перевозки, адрес.
 * POST { action: 'adminExportApplications', initData, from?, to? }
 *      Выгрузка «Заявок» в .xlsx с отбором по срокам ЕКП («гггг-мм-дд») — бот присылает файл в чат.
 * POST { action: 'adminSaveAthlete', initData, athleteId, fields: { столбец: значение } }
 *      Правка спортсмена (кроме ID, телефона и ChatId), в том числе подтверждение (Статус = «Подтвержден»).
 * POST { action: 'adminDeleteAthlete', initData, athleteId }
 *      Удаление спортсмена: его закрепления удаляются, его заявки переносятся в «Архив заявок» с прежним статусом.
 * POST { action: 'adminSaveCompetition', initData, competition: { id?, title, ekpNumber, kind, start, end, address } }
 *      Создание (без id) или правка соревнования; рассылка перевозчикам — по тем же правилам, что у триггера.
 * POST { action: 'adminSaveWeapon', initData, weapon: { id?, title, number } }
 *      Создание или правка единицы справочника «Оружие»; пара «Название + Номер» уникальна.
 * POST { action: 'adminDeleteWeapon', initData, weaponId } — удаление единицы вместе с её закреплениями.
 * POST { action: 'adminAssignWeapon', initData, athleteId, weaponId? | newWeapon?: { title, number } }
 *      Закрепить единицу за спортсменом; newWeapon — завести её в справочнике (если такой пары ещё нет) и закрепить.
 * POST { action: 'adminUnassignWeapon', initData, athleteId, weaponId } — открепить.
 *
 * Заявки создают, меняют и удаляют только подтверждённые перевозчики — только свои и только в статусе «Новая».
 * Заявки прошедших соревнований раз в сутки переносятся в «Архив заявок» с прежним статусом (archivePastApplications).
 * Текст заявки (ФИО, оружие, данные соревнования) скрипт собирает сам по ID из справочников.
 *
 * Доступ:
 *  - initData и contact проверяются по подписи токеном бота — подделать пользователя или номер нельзя;
 *  - пользователь ищется в листе «Спортсмены» по ChatId; данные отдаются только при статусе «Подтвержден»;
 *  - листы из USER_SCOPED_SHEETS отдаются только со строками этого спортсмена;
 *  - в «Спортсменах» у чужих строк — только столбцы ATHLETE_PUBLIC_COLUMNS;
 *  - из «Соревнований» отдаются только предстоящие (дата начала — сегодня или позже; соревнования
 *    с неуказанной или неверной датой начала тоже отдаются, чтобы не потерялись);
 *  - администратору листы отдаются целиком, без этих ограничений.
 *
 * Уведомления: при ручной смене статуса спортсмена на «Подтвержден» и статуса заявки на «В работе» /
 * «Выполнена» / «Отклонена» (а также при смене статуса заявки из приложения) бот пишет спортсмену, а о новом соревновании (заполнены название, даты и адрес) — всем
 * подтверждённым перевозчикам, один раз; отметка — в столбце «Рассылка» (триггер onSheetEdit; создаётся один раз
 * функцией installTriggers). Перевозчик может отключить в профиле рассылку о соревнованиях и сообщения о своих
 * заявках (столбцы ATHLETE_COLUMN.notifyCompetitions / notifyApplications).
 * Настройка окружения и проверка — функции раздела «Настройка окружения» (checkSetup, setupMenuButton, …).
 * Резервные копии — раз в сутки в папку на Диске владельца; восстановление — вручную (раздел «Резервные копии»).
 *
 * Ответы: status = success | unregistered | pending | forbidden | expired | not_found | conflict | error
 * (expired — подпись Telegram верна, но приложение открыто больше INIT_DATA_MAX_AGE_SECONDS назад).
 * События (вход, заявки, оружие, рассылки, ошибки доставки) пишутся в журнал выполнения и в служебный лист «_Журнал».
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
  // Журнал событий. Имя начинается с "_", поэтому приложению лист не отдаётся,
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
  // «Да» / «Нет»: «Да» — администратор (раздел «Администрирование» в приложении и полные данные, см. «Администрирование»).
  // Пусто — как «Нет». Нет столбца — администраторов нет
  admin: 'Администратор',
  // Настройки уведомлений перевозчика (меняет он сам в профиле приложения): «Нет» — не присылать;
  // пусто или «Да» — присылать. Нет столбца в листе — уведомления у всех включены, а в профиле настройки не видно
  notifyCompetitions: 'Сообщать о соревнованиях',
  notifyApplications: 'Сообщать о заявках',
};

// Столбцы «Спортсменов», которые видны другим спортсменам (кроме ID в первом столбце). Остальные — телефон, ChatId,
// настройки уведомлений и любые столбцы, добавленные позже, — спортсмен видит только в своей строке
const ATHLETE_PUBLIC_COLUMNS = [
  ATHLETE_COLUMN.lastName,
  ATHLETE_COLUMN.firstName,
  ATHLETE_COLUMN.middleName,
  ATHLETE_COLUMN.status,
  ATHLETE_COLUMN.carrier,
];

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
  // Заполняет администратор при отклонении заявки (обязательно); очищается, когда отклонённую берут в работу
  rejectReason: 'Причина отклонения',
  createdBy: 'CreatedBy',
  createdAt: 'CreatedAt',
};

// Служебные столбцы заявки — не попадают в выгрузку в Excel
const APPLICATION_SERVICE_COLUMNS = [APPLICATION_COLUMN.createdBy, APPLICATION_COLUMN.createdAt];

// Значения столбца «Статус» листа «Спортсмены»
const ATHLETE_STATUS = {
  confirmed: 'Подтвержден',
  pending: 'Требует подтверждения',
  addedManually: 'Добавлен вручную',
  // Работа запрещена (как и при любом статусе, кроме «Подтвержден»)
  archived: 'Архив',
};

// Статусы спортсмена, которые администратор может поставить в приложении
const ATHLETE_STATUSES = [ATHLETE_STATUS.confirmed, ATHLETE_STATUS.pending, ATHLETE_STATUS.addedManually, ATHLETE_STATUS.archived];

// Столбцы «Спортсменов», которые администратор не меняет в приложении (кроме ID в первом столбце): телефон и ChatId
// связывают запись с аккаунтом Telegram — их правят только в таблице
const ATHLETE_LOCKED_COLUMNS = [ATHLETE_COLUMN.phone, ATHLETE_COLUMN.chatId];

// Столбцы «Спортсменов» со значениями «Да» / «Нет»
const ATHLETE_YES_NO_COLUMNS = [ATHLETE_COLUMN.carrier, ATHLETE_COLUMN.admin, ATHLETE_COLUMN.notifyCompetitions, ATHLETE_COLUMN.notifyApplications];

// Предел длины текста в прочих столбцах, которые правит администратор
const TEXT_MAX_LENGTH = 500;

// Строки, внесённые администратором: привязка по телефону сразу подтверждает такого спортсмена.
// Остальные статусы («Требует подтверждения», блокировки и т.п.) при привязке не меняются.
const AUTO_CONFIRM_STATUSES = ['', ATHLETE_STATUS.addedManually];

// Значения столбца «Статус» заявки. Автор может менять и удалять заявку только в статусе «Новая»;
// остальные ставит оформитель, «Удалена» — при удалении автором (заявка уходит в архив). Заявки прошедших
// соревнований уходят в архив с прежним статусом (archivePastApplications)
const APPLICATION_STATUS = {
  new: 'Новая',
  inProgress: 'В работе',
  done: 'Выполнена',
  // Заявку нельзя выполнить; причина — в столбце «Причина отклонения»
  rejected: 'Отклонена',
  deleted: 'Удалена',
};

// Смена статуса заявки администратором в приложении — только вперёд по жизненному циклу: из статуса → в какие можно.
// Откатить назад можно только вручную в таблице
const APPLICATION_TRANSITIONS = {
  [APPLICATION_STATUS.new]: [APPLICATION_STATUS.inProgress, APPLICATION_STATUS.rejected],
  [APPLICATION_STATUS.inProgress]: [APPLICATION_STATUS.done, APPLICATION_STATUS.rejected],
  [APPLICATION_STATUS.rejected]: [APPLICATION_STATUS.inProgress],
};

const REJECT_REASON_MAX_LENGTH = 500;
const ADDRESS_MAX_LENGTH = 300;
const TITLE_MAX_LENGTH = 200;

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
};

// Столбцы листа журнала
const LOG_COLUMNS = ['Дата', 'Событие', 'Telegram ID', 'Пользователь Telegram', 'Телефон', 'ID спортсмена', 'Подробности'];

// Сколько живут подписанные данные Telegram (initData выдаётся при открытии Mini App)
const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

const NAME_MAX_LENGTH = 100;

// Сколько помнить ответы на POST-запросы по requestId — чтобы повтор при обрыве связи не выполнил действие дважды
const REQUEST_CACHE_SECONDS = 10 * 60;

// Кэш листов для отдачи приложению (загрузка листов, loadSheets_): экономит время выполнения и лимиты Apps Script.
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
  unassignWeapon: [SHEET.athleteWeapons],
  setNotifications: [SHEET.athletes],
  adminSetApplicationStatus: [SHEET.applications],
  adminSaveApplication: [SHEET.applications],
  adminSaveAthlete: [SHEET.athletes],
  adminDeleteAthlete: [SHEET.athletes, SHEET.athleteWeapons, SHEET.applications],
  adminSaveCompetition: [SHEET.competitions],
  adminSaveWeapon: [SHEET.weapons],
  adminDeleteWeapon: [SHEET.weapons, SHEET.athleteWeapons],
  adminAssignWeapon: [SHEET.weapons, SHEET.athleteWeapons],
  adminUnassignWeapon: [SHEET.athleteWeapons],
};

// Ответы, с которыми действие ничего не записывает в листы (отказ в linkPhone и register; остальные действия при отказе
// бросают userError_). 'pending' и 'forbidden' сюда не входят: linkPhone записывает ChatId и при таких статусах
const NO_WRITE_STATUSES = ['error', 'not_found', 'conflict'];

// Как связаться с администратором (например, '@username' или телефон) — подставляется
// в сообщения пользователю, когда без администратора не обойтись. Пусто — не показывается.
const ADMIN_CONTACT = '';


// Статусы заявки, о смене на которые бот сообщает автору заявки
const NOTIFY_APPLICATION_STATUSES = [APPLICATION_STATUS.inProgress, APPLICATION_STATUS.done, APPLICATION_STATUS.rejected];

// Листы, где первый столбец — ID строки и он ставится сам: строке, внесённой вручную, при правке выдаётся ID
// (generateShortId). Не входят: «Заявки» (№ ставит скрипт), «Спортсмен/Оружие» (первый столбец — ID спортсмена),
// «Виды транспорта» (первый столбец — название)
const AUTO_ID_SHEETS = [SHEET.athletes, SHEET.competitions, SHEET.weapons];

// Рассылка перевозчикам о новом соревновании: уходит, когда у строки заполнены все эти столбцы,
// а столбец «Рассылка» пуст. Нет столбца «Рассылка» в листе — рассылки нет
const NEW_COMPETITION_REQUIRED = [COMPETITION_COLUMN.title, COMPETITION_COLUMN.start, COMPETITION_COLUMN.end, COMPETITION_COLUMN.address];

// ---------- Точки входа ----------

// Загрузка листов старыми версиями приложения (initData в адресе запроса). Новые загружают через doPost
function doGet(e) {
  const params = (e && e.parameter) || {};
  return handle_(function () {
    if (params.action !== 'sheets') {
      return { status: 'error', message: 'Неизвестное действие: ' + params.action };
    }
    const user = verifyInitData_(params.initData);
    if (!user) return telegramDenied_(params.initData);
    return loadSheets_(user, params.names ? params.names.split(',') : null, params.fresh === '1');
  });
}

function doPost(e) {
  return handle_(function () {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const user = verifyInitData_(body.initData);
    if (!user) return telegramDenied_(body.initData);
    // Чтение — без блокировки и без памяти requestId: оно ничего не меняет, его можно повторять
    if (body.action === 'sheets') {
      return loadSheets_(user, Array.isArray(body.names) ? body.names : null, body.fresh === true);
    }

    // Запись в лист — под блокировкой, чтобы параллельные запросы не создали дубликаты
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      return { status: 'error', message: 'Сервер занят другим запросом — попробуйте ещё раз через несколько секунд' };
    }
    // Приложение повторяет запрос при обрыве связи. Если этот requestId уже выполнялся (запрос дошёл,
    // а ответ потерялся) — возвращаем прежний ответ, а не выполняем действие второй раз
    const cache = CacheService.getScriptCache();
    const cacheKey = body.requestId ? 'request:' + user.id + ':' + body.requestId : null;
    let result;
    try {
      const done = cacheKey && cache.get(cacheKey);
      if (done) return JSON.parse(done);

      result = runAction_(user, body);
      if (cacheKey) cache.put(cacheKey, JSON.stringify(result), REQUEST_CACHE_SECONDS);
      // Листы, в которые действие могло записать, — их кэш для чтения устарел. При отказе (NO_WRITE_STATUSES)
      // действие ничего не записало — кэш не трогаем
      if (WRITES_SHEETS[body.action] && NO_WRITE_STATUSES.indexOf(result.status) === -1) {
        invalidateSheets_(WRITES_SHEETS[body.action]);
      }
    } finally {
      lock.releaseLock();
    }

    // Долгое продолжение действия (рассылка) — уже без блокировки: запись других пользователей его не ждёт.
    // Ответ дополняется его итогом и заново запоминается под requestId
    if (afterUnlock_) {
      const after = afterUnlock_;
      afterUnlock_ = null;
      result = after(result);
      if (cacheKey) cache.put(cacheKey, JSON.stringify(result), REQUEST_CACHE_SECONDS);
    }
    return result;
  });
}

// Продолжение действия doPost после снятия блокировки записи: function (result) → result. Действие задаёт его
// последним шагом, когда всё под блокировкой уже записано. Глобальные переменные живут один вызов скрипта
let afterUnlock_ = null;

// Листы для приложения подтверждённому спортсмену. names — какие листы нужны (null — все из APP_SHEETS),
// fresh — читать таблицу мимо кэша
function loadSheets_(user, names, fresh) {
  const ss = spreadsheet_();
  freshRead_ = fresh;
  const athlete = findUser_(ss, athletesTable_(ss, true), user);
  const denied = accessDenied_(athlete);
  if (denied) return denied;
  return readSheets_(ss, names, athlete.id, athlete.isAdmin);
}

// Ошибки проверки (userError_) не кэшируются — при повторе запрос просто выполнится заново
function runAction_(user, body) {
  if (body.action === 'linkPhone') return linkPhone_(user, body.contact);
  if (body.action === 'register') return register_(user, body);
  if (body.action === 'saveApplication') return saveApplication_(user, body.application || {});
  if (body.action === 'deleteApplication') return deleteApplication_(user, body.number);
  // Прежнее самостоятельное закрепление — у старых версий приложения
  if (body.action === 'assignWeapon') throw userError_('Закрепить оружие может только администратор');
  if (body.action === 'unassignWeapon') return unassignWeapon_(user, body.weaponId);
  if (body.action === 'setNotifications') return setNotifications_(user, body.notifications || {});
  if (body.action === 'adminSetApplicationStatus') return adminSetApplicationStatus_(user, body);
  if (body.action === 'adminSaveApplication') return adminSaveApplication_(user, body.application || {});
  if (body.action === 'adminExportApplications') return adminExportApplications_(user, body);
  if (body.action === 'adminSaveAthlete') return adminSaveAthlete_(user, body);
  if (body.action === 'adminDeleteAthlete') return adminDeleteAthlete_(user, body);
  if (body.action === 'adminSaveCompetition') return adminSaveCompetition_(user, body.competition || {});
  if (body.action === 'adminSaveWeapon') return adminSaveWeapon_(user, body.weapon || {});
  if (body.action === 'adminDeleteWeapon') return adminDeleteWeapon_(user, body);
  if (body.action === 'adminAssignWeapon') return adminAssignWeapon_(user, body);
  if (body.action === 'adminUnassignWeapon') return adminUnassignWeapon_(user, body);
  return { status: 'error', message: 'Неизвестное действие: ' + body.action };
}

function handle_(fn) {
  try {
    return json_(fn());
  } catch (err) {
    if (!err.isUserError) logQuotaError_(err, 'Запрос приложения');
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
    // Человек и так видит, что вошёл, — сообщение «доступ подтверждён» при будущих правках его строки не нужно
    PropertiesService.getScriptProperties().setProperty(notifiedKey_(SHEET.athletes, athlete.id), ATHLETE_STATUS.confirmed);
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

// fromCache — для отдачи приложению (loadSheets_) лист можно взять из кэша; для записи — только свежий
function athletesTable_(ss, fromCache) {
  // Сам лист нужен только для записи — при чтении из кэша к таблице не обращаемся
  const sheet = function () { return ss.getSheetByName(SHEET.athletes); };
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
      isAdmin: cell(values[r], ATHLETE_COLUMN.admin).toLowerCase() === 'да',
      // Уведомления включены, пока в столбце не «Нет» (и когда столбца нет)
      wantsCompetitions: cell(values[r], ATHLETE_COLUMN.notifyCompetitions).toLowerCase() !== 'нет',
      wantsApplications: cell(values[r], ATHLETE_COLUMN.notifyApplications).toLowerCase() !== 'нет',
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
    // Индекс столбца (с 0) или -1, если столбца нет
    col: col,
    has: function (name) { return col(name) !== -1; },
    set: function (athlete, name, value) {
      sheet().getRange(athlete.row, col(name, true) + 1).setValue(safeCell_(value));
    },
    append: function (id, valuesByColumn) {
      const row = headers.map(function (h, i) {
        if (i === 0) return id;
        return valuesByColumn.hasOwnProperty(h) ? valuesByColumn[h] : '';
      });
      sheet().appendRow(safeRow_(row));
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
  const table = readTable_(ss, SHEET.applications);
  const own = input.number ? ownNewApplication_(table, input.number, author) : null;
  const allowed = carrierWeaponCheck_(ss, own ? String(table.get(own, APPLICATION_COLUMN.weapon)) : '');
  const fields = buildApplication_(ss, author, input, allowed);

  if (own) {
    const fresh = freshOwnNewRow_(table, own, input.number);
    const values = writeFields_(table, fresh, fields);
    log_(ss, 'Заявка изменена', user, { athleteId: author.id, text: '№ ' + input.number });
    return { status: 'success', number: Number(input.number), row: rowObject_(table.headers, values) };
  }

  const number = nextApplicationNumber_(ss, table);
  fields[APPLICATION_COLUMN.number] = number;
  fields[APPLICATION_COLUMN.status] = APPLICATION_STATUS.new;
  fields[APPLICATION_COLUMN.createdBy] = author.id;
  fields[APPLICATION_COLUMN.createdAt] = new Date();
  const newValues = table.headers.map(function (h) { return fields.hasOwnProperty(h) ? fields[h] : ''; });
  table.sheet.appendRow(safeRow_(newValues));
  log_(ss, 'Заявка создана', user, { athleteId: author.id, text: '№ ' + number + ', ' + fields[APPLICATION_COLUMN.competitionTitle] });
  return { status: 'success', number: number, row: rowObject_(table.headers, newValues) };
}

// Строка { заголовок: значение } — для ответа приложению
function rowObject_(headers, values) {
  const result = {};
  headers.forEach(function (h, i) { result[h] = values[i]; });
  return result;
}

// Запись полей fields ({ заголовок: значение }) в перечитанную строку fresh (freshRow_). Меняются только эти столбцы;
// в остальных — то, что сейчас в таблице: формулы остаются формулами, правки оформителя не затираются.
// Возвращает новые значения строки
function writeFields_(table, fresh, fields) {
  const values = fresh.values.slice();
  const output = table.headers.map(function (h, i) {
    if (fields.hasOwnProperty(h)) {
      values[i] = fields[h];
      return safeCell_(fields[h]);
    }
    return fresh.formulas[i] || safeCell_(fresh.values[i]);
  });
  fresh.range.setValues([output]);
  return values;
}

// Удаление автором: строка переносится в «Архив заявок» (столбцы сопоставляются по заголовкам)
// со статусом «Удалена» и удаляется из «Заявок»
function deleteApplication_(user, number) {
  const ss = spreadsheet_();
  const author = requireCarrier_(ss, user);
  const table = readTable_(ss, SHEET.applications);
  const row = ownNewApplication_(table, number, author);
  const archive = readTable_(ss, SHEET.applicationsArchive);
  const fresh = freshOwnNewRow_(table, row, number);

  const archived = archive.headers.map(function (h) {
    if (h === APPLICATION_COLUMN.status) return APPLICATION_STATUS.deleted;
    const i = table.headers.indexOf(h);
    return i === -1 ? '' : fresh.values[i];
  });
  archive.sheet.appendRow(safeRow_(archived));
  table.sheet.deleteRow(row.row);

  log_(ss, 'Заявка удалена', user, { athleteId: author.id, text: '№ ' + number + ' перенесена в «' + SHEET.applicationsArchive + '»' });
  return { status: 'success', number: Number(number) };
}

// Подтверждённый спортсмен пользователя Telegram; иначе — ошибка с причиной отказа.
// table — лист «Спортсмены» (athletesTable_), если он уже прочитан и нужен для записи
function requireConfirmed_(ss, user, table) {
  const athlete = findUser_(ss, table || athletesTable_(ss), user);
  const denied = accessDenied_(athlete);
  if (denied) throw userError_(denied.message);
  return athlete;
}

// Автор заявки — подтверждённый спортсмен-перевозчик
function requireCarrier_(ss, user) {
  const athlete = requireConfirmed_(ss, user);
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

// Строка заявки, перечитанная из таблицы прямо перед записью или удалением. Пока скрипт читал лист, оформитель мог
// вставить, удалить или отсортировать строки (по запомненному номеру строки теперь другая заявка) или взять заявку
// в работу. Тогда действие не выполняется — повтор через минуту найдёт строку заново.
// { range, values, formulas } — диапазон строки, её значения и формулы (пусто — в ячейке не формула)
function freshOwnNewRow_(table, row, number) {
  const fresh = freshRow_(table, row, number);
  const status = String(fresh.values[table.col(APPLICATION_COLUMN.status)]).trim();
  if (status !== APPLICATION_STATUS.new) {
    throw userError_('Заявка № ' + number + ' уже в статусе «' + status + '» — изменить или удалить её нельзя');
  }
  return fresh;
}

// Строка листа (row из readTable_ с ID id), перечитанная из таблицы прямо перед записью. Если на её месте уже другая
// строка (строки вставили, удалили или отсортировали вручную) — ошибка, повтор через минуту найдёт строку заново.
// { range, values, formulas } — диапазон строки, её значения и формулы (пусто — в ячейке не формула)
function freshRow_(table, row, id) {
  const range = table.sheet.getRange(row.row, 1, 1, table.headers.length);
  const values = range.getValues()[0];
  if (String(values[0]).trim() !== String(id).trim()) {
    throw userError_('Таблицу «' + table.name + '» сейчас правят — попробуйте ещё раз через минуту');
  }
  return { range: range, values: values, formulas: range.getFormulas()[0] };
}

// Перевозчик выбирает спортсмену только закреплённое за ним оружие (лист «Спортсмен/Оружие»). При изменении заявки
// можно оставить и единицы, уже записанные у этого спортсмена в заявке (previousWeapons — прежнее значение столбца
// «Оружие»): раньше их можно было выбрать из всего справочника. function (athlete, weaponId, «Название - Номер») → bool
function carrierWeaponCheck_(ss, previousWeapons) {
  const links = readTable_(ss, SHEET.athleteWeapons);
  const linked = {};
  links.rows.forEach(function (r) {
    linked[String(links.get(r, ATHLETE_WEAPON_COLUMN.athleteId)).trim() + '|' + String(links.get(r, ATHLETE_WEAPON_COLUMN.weaponId)).trim()] = true;
  });
  // Строки «Фамилия И.О. : Название - Номер ; Название - Номер» → { 'Фамилия И.О.|Название - Номер': true }
  const previous = {};
  previousWeapons.split('\n').forEach(function (line) {
    const at = line.indexOf(ATHLETE_WEAPONS_SEPARATOR.trim());
    if (at === -1) return;
    const name = line.slice(0, at).trim();
    line.slice(at + 1).split(WEAPONS_SEPARATOR.trim()).forEach(function (w) {
      if (w.trim()) previous[name + '|' + w.trim()] = true;
    });
  });
  return function (athlete, weaponId, text) {
    return Boolean(linked[athlete.id + '|' + weaponId] || previous[athlete.shortName + '|' + text]);
  };
}

// Значения столбцов заявки (кроме №, статуса и автора) по выбору перевозчика в приложении.
// allowed — какое оружие можно выбрать спортсмену (carrierWeaponCheck_)
function buildApplication_(ss, author, input, allowed) {
  const competitions = readTable_(ss, SHEET.competitions);
  const competition = findById_(competitions, input.competitionId);
  if (!competition) throw userError_('Соревнование не найдено — обновите данные и выберите заново');
  if (!isUpcoming_(competitions.get(competition, COMPETITION_COLUMN.start))) {
    throw userError_('Соревнование уже началось — заявку на него подать нельзя');
  }

  const fields = applicationContent_(ss, input, allowed);
  const competitionFields = competitionFields_(competitions, competition);
  Object.keys(competitionFields).forEach(function (column) { fields[column] = competitionFields[column]; });
  fields[APPLICATION_COLUMN.fullName] = author.fullName;
  return fields;
}

// Столбцы заявки из соревнования: вид, название, № ЕКП, сроки по ЕКП, адрес и сроки перевозки — от дат соревнования.
// Если дата начала не указана или записана неверно, сроки перевозки остаются пустыми (их заполнит оформитель),
// а в «Сроки по ЕКП» переносится то, что записано в ячейках
function competitionFields_(competitions, competition) {
  const rawStart = competitions.get(competition, COMPETITION_COLUMN.start);
  const rawEnd = competitions.get(competition, COMPETITION_COLUMN.end);
  const competitionStart = sheetDate_(rawStart);
  const competitionEnd = sheetDate_(rawEnd) || competitionStart;

  const fields = {};
  fields[APPLICATION_COLUMN.transportStart] = competitionStart ? shiftDays_(competitionStart, -TRANSPORT_DAYS_BEFORE) : '';
  fields[APPLICATION_COLUMN.transportEnd] = competitionEnd ? shiftDays_(competitionEnd, TRANSPORT_DAYS_AFTER) : '';
  fields[APPLICATION_COLUMN.competitionKind] = competitions.get(competition, COMPETITION_COLUMN.kind);
  fields[APPLICATION_COLUMN.competitionTitle] = competitions.get(competition, COMPETITION_COLUMN.title);
  fields[APPLICATION_COLUMN.ekpNumber] = competitions.get(competition, COMPETITION_COLUMN.ekpNumber);
  fields[APPLICATION_COLUMN.ekpStart] = competitionStart || rawStart;
  fields[APPLICATION_COLUMN.ekpEnd] = sheetDate_(rawEnd) || rawEnd;
  fields[APPLICATION_COLUMN.address] = competitions.get(competition, COMPETITION_COLUMN.address);
  return fields;
}

// Столбцы «Оружие» и «Вид транспорта» по выбору из приложения: items — [{ athleteId, weaponIds }],
// transport — названия из листа «Виды транспорта». Значениям из приложения доверяются только ID и выбор.
// allowed — необязательная проверка оружия: function (athlete, weaponId, «Название - Номер») → bool (без неё — любое)
function applicationContent_(ss, input, allowed) {
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

    // Одна и та же единица, переданная дважды, записывается один раз
    const weaponIds = (Array.isArray(item.weaponIds) ? item.weaponIds : []).map(String)
      .filter(function (id, i, all) { return all.indexOf(id) === i; });
    if (!weaponIds.length) throw userError_('Выберите оружие для спортсмена ' + athlete.shortName);
    // Строка спортсмена: «Фамилия И.О. : Название - Номер ; Название - Номер»
    const athleteWeapons = weaponIds.map(function (weaponId) {
      const weapon = findById_(weapons, weaponId);
      if (!weapon) throw userError_('Оружие не найдено — обновите данные и выберите заново');
      const text = String(weapons.get(weapon, WEAPON_COLUMN.title)).trim() + ' - ' + String(weapons.get(weapon, WEAPON_COLUMN.number)).trim();
      if (allowed && !allowed(athlete, weaponId, text)) {
        throw userError_(text + ' не закреплено за спортсменом ' + athlete.shortName + ' — закрепить оружие может администратор');
      }
      return text;
    });
    weaponLines.push(athlete.shortName + ATHLETE_WEAPONS_SEPARATOR + athleteWeapons.join(WEAPONS_SEPARATOR));
  });

  const transportTypes = readTable_(ss, SHEET.transportTypes).rows.map(function (r) { return String(r.values[0]).trim(); });
  const transport = (Array.isArray(input.transport) ? input.transport : []).map(String);
  if (!transport.length) throw userError_('Выберите вид транспорта');
  transport.forEach(function (name) {
    if (transportTypes.indexOf(name) === -1) throw userError_('Вид транспорта «' + name + '» не найден в справочнике');
  });

  const fields = {};
  fields[APPLICATION_COLUMN.weapon] = weaponLines.join('\n');
  fields[APPLICATION_COLUMN.transport] = transport.join(LIST_SEPARATOR);
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

// Администратор открепляет от себя единицу оружия (из раздела «Оружие»): удаляются его строки с этой единицей
// в «Спортсмен/Оружие». Обычный спортсмен открепить не может. На уже поданные заявки не влияет — в них оружие текстом.
function unassignWeapon_(user, weaponId) {
  const ss = spreadsheet_();
  const athlete = requireAdmin_(ss, user);
  const result = unlinkWeapon_(ss, athlete.id, weaponId);
  if (result.already) return { status: 'success', message: 'Это оружие уже не закреплено за вами', link: result.link };
  log_(ss, 'Оружие откреплено', user, { athleteId: athlete.id, text: result.title });
  return { status: 'success', message: result.title + ' откреплено', link: result.link };
}

// Закрепление единицы оружия за спортсменом — строка в «Спортсмен/Оружие».
// { link: { athleteId, weaponId }, title: «Название Номер», already: уже было закреплено }
function linkWeapon_(ss, athleteId, weaponId) {
  const weapons = readTable_(ss, SHEET.weapons);
  const weapon = findById_(weapons, weaponId);
  if (!weapon) throw userError_('Оружие не найдено — обновите данные и выберите заново');
  const title = weaponTitle_(weapons, weapon);

  const links = readTable_(ss, SHEET.athleteWeapons);
  // Нет нужного столбца — ошибка до записи, а не строка без ID спортсмена или оружия
  [ATHLETE_WEAPON_COLUMN.athleteId, ATHLETE_WEAPON_COLUMN.weaponId].forEach(function (column) { links.col(column); });
  const link = { athleteId: String(athleteId), weaponId: String(weaponId) };
  if (links.rows.some(function (r) { return isLinkRow_(links, r.values, link); })) return { link: link, title: title, already: true };

  links.sheet.appendRow(safeRow_(links.headers.map(function (h) {
    if (h === ATHLETE_WEAPON_COLUMN.athleteId) return link.athleteId;
    if (h === ATHLETE_WEAPON_COLUMN.weaponId) return link.weaponId;
    return '';
  })));
  return { link: link, title: title, already: false };
}

// Открепление: удаляются строки связи из «Спортсмен/Оружие». { link, title, already: и так не было закреплено }
function unlinkWeapon_(ss, athleteId, weaponId) {
  const link = { athleteId: String(athleteId), weaponId: String(weaponId) };
  const links = readTable_(ss, SHEET.athleteWeapons);
  const mine = links.rows.filter(function (r) { return isLinkRow_(links, r.values, link); });
  const weapons = readTable_(ss, SHEET.weapons);
  const weapon = findById_(weapons, weaponId);
  const title = weapon ? weaponTitle_(weapons, weapon) : String(weaponId);
  if (!mine.length) return { link: link, title: title, already: true };

  // Перед удалением строки перечитываются: если строки на листе сдвинулись (их вставили, удалили или отсортировали
  // вручную), по запомненным номерам уже другие связи — тогда ничего не удаляем
  const rows = mine.map(function (r) { return r.row; }).sort(function (a, b) { return b - a; });
  const current = links.sheet.getRange(rows[rows.length - 1], 1, rows[0] - rows[rows.length - 1] + 1, links.headers.length).getValues();
  rows.forEach(function (row) {
    if (!isLinkRow_(links, current[row - rows[rows.length - 1]], link)) {
      throw userError_('Таблицу сейчас правят — попробуйте ещё раз через минуту');
    }
  });
  deleteRowNumbers_(links.sheet, rows);
  return { link: link, title: title, already: false };
}

// «Название Номер» единицы оружия — для сообщений и журнала
function weaponTitle_(weapons, weapon) {
  return String(weapons.get(weapon, WEAPON_COLUMN.title)).trim() + ' ' + String(weapons.get(weapon, WEAPON_COLUMN.number)).trim();
}

// Строка листа «Спортсмен/Оружие» (values) — связь link { athleteId, weaponId }
function isLinkRow_(links, values, link) {
  return String(values[links.col(ATHLETE_WEAPON_COLUMN.athleteId)]).trim() === link.athleteId &&
    String(values[links.col(ATHLETE_WEAPON_COLUMN.weaponId)]).trim() === link.weaponId;
}

// ---------- Настройки уведомлений ----------

// Перевозчик включает или выключает уведомления в своём профиле: о новых соревнованиях (рассылка) и о смене статуса
// своих заявок. input — { competitions?, applications? } (true/false); указанное пишется в его строку «Да»/«Нет».
// В ответе — сохранённые значения: приложение сразу показывает их, не перечитывая таблицу
function setNotifications_(user, input) {
  const ss = spreadsheet_();
  const table = athletesTable_(ss);
  const athlete = requireConfirmed_(ss, user, table);
  if (!athlete.isCarrier) throw userError_('Настройки уведомлений есть только у перевозчиков');

  const settings = [
    { key: 'competitions', column: ATHLETE_COLUMN.notifyCompetitions },
    { key: 'applications', column: ATHLETE_COLUMN.notifyApplications },
  ].filter(function (s) { return typeof input[s.key] === 'boolean'; });
  if (!settings.length) throw userError_('Нечего сохранять');

  const saved = {};
  settings.forEach(function (s) {
    if (!table.has(s.column)) throw userError_('Эта настройка пока недоступна — обратитесь к администратору');
    const value = input[s.key] ? 'Да' : 'Нет';
    table.set(athlete, s.column, value);
    saved[s.column] = value;
  });
  log_(ss, 'Настройки уведомлений', user, {
    athleteId: athlete.id,
    text: Object.keys(saved).map(function (column) { return column + ': ' + saved[column]; }).join('; '),
  });
  return { status: 'success', athleteId: athlete.id, fields: saved };
}

// ---------- Администрирование ----------
// Действия раздела «Администрирование» приложения. Доступны подтверждённым спортсменам с «Да» в столбце
// «Администратор». Таблицу по-прежнему можно править вручную — здесь те же правки с проверкой ввода.

// Подтверждённый спортсмен-администратор; иначе — ошибка
function requireAdmin_(ss, user, table) {
  const athlete = requireConfirmed_(ss, user, table);
  if (!athlete.isAdmin) throw userError_('Это действие доступно только администраторам');
  return athlete;
}

// Строка заявки по № для правки администратором, перечитанная из таблицы (freshRow_)
function freshApplication_(table, number) {
  const row = findById_(table, number);
  if (!row) throw userError_('Заявка № ' + number + ' не найдена — возможно, её уже перенесли в архив');
  return freshRow_(table, row, number);
}

// Смена статуса заявки: input — { number, status, from, reason }. from — статус, который видел администратор:
// если в таблице уже другой (заявку тем временем изменили), ничего не меняем. Переходы — APPLICATION_TRANSITIONS.
// «Отклонена» — только с причиной; при взятии отклонённой в работу причина очищается. Автору — сообщение бота
function adminSetApplicationStatus_(user, input) {
  const ss = spreadsheet_();
  const admin = requireAdmin_(ss, user);
  const number = String(input.number || '').trim();
  const status = String(input.status || '').trim();
  const table = readTable_(ss, SHEET.applications);
  const fresh = freshApplication_(table, number);

  const current = String(fresh.values[table.col(APPLICATION_COLUMN.status)]).trim();
  if (input.from !== undefined && current !== String(input.from).trim()) {
    throw userError_('Статус заявки № ' + number + ' уже изменён на «' + current + '» — обновите данные');
  }
  if ((APPLICATION_TRANSITIONS[current] || []).indexOf(status) === -1) {
    throw userError_('Заявку № ' + number + ' в статусе «' + (current || 'без статуса') + '» нельзя перевести в «' + status + '»');
  }

  const fields = {};
  fields[APPLICATION_COLUMN.status] = status;
  const reason = String(input.reason || '').replace(/\s+/g, ' ').trim().slice(0, REJECT_REASON_MAX_LENGTH);
  if (status === APPLICATION_STATUS.rejected || current === APPLICATION_STATUS.rejected) {
    if (table.headers.indexOf(APPLICATION_COLUMN.rejectReason) === -1) {
      throw userError_('Добавьте в лист «' + SHEET.applications + '» столбец «' + APPLICATION_COLUMN.rejectReason + '»');
    }
    if (status === APPLICATION_STATUS.rejected && !reason) throw userError_('Укажите причину отклонения');
    fields[APPLICATION_COLUMN.rejectReason] = status === APPLICATION_STATUS.rejected ? reason : '';
  }

  const values = writeFields_(table, fresh, fields);
  log_(ss, 'Статус заявки', user, {
    athleteId: admin.id,
    text: '№ ' + number + ': «' + current + '» → «' + status + '»' + (reason && status === APPLICATION_STATUS.rejected ? '. Причина: ' + reason : ''),
  });
  // Запись — в таблице до отправки сообщения: при ошибке Telegram статус всё равно сменён
  SpreadsheetApp.flush();
  notifyApplicationStatusNow_(ss, table.headers, values);
  return { status: 'success', number: Number(number), row: rowObject_(table.headers, values) };
}

// Правка заявки администратором: input — { number, competitionId?, items, transport, transportStart, transportEnd, address }.
// Участники, оружие и транспорт — по ID и названиям, как в мастере. competitionId — соревнование выбрано заново: его вид,
// название, № ЕКП и сроки по ЕКП переписываются из листа «Соревнования» (и прошедшего — это исправление ошибок);
// без него эти столбцы не меняются. Сроки перевозки (дата «гггг-мм-дд» или пусто) и адрес — как указал администратор.
// ФИО (автор), статус и автор не меняются
function adminSaveApplication_(user, input) {
  const ss = spreadsheet_();
  const admin = requireAdmin_(ss, user);
  const number = String(input.number || '').trim();
  const table = readTable_(ss, SHEET.applications);
  if (!findById_(table, number)) throw userError_('Заявка № ' + number + ' не найдена — возможно, её уже перенесли в архив');

  const fields = applicationContent_(ss, input);
  if (input.competitionId) {
    const competitions = readTable_(ss, SHEET.competitions);
    const competition = findById_(competitions, input.competitionId);
    if (!competition) throw userError_('Соревнование не найдено — обновите данные и выберите заново');
    const competitionFields = competitionFields_(competitions, competition);
    [APPLICATION_COLUMN.competitionKind, APPLICATION_COLUMN.competitionTitle, APPLICATION_COLUMN.ekpNumber,
      APPLICATION_COLUMN.ekpStart, APPLICATION_COLUMN.ekpEnd].forEach(function (column) { fields[column] = competitionFields[column]; });
  }
  const transportStart = inputDate_(input.transportStart, 'Начало перевозки');
  const transportEnd = inputDate_(input.transportEnd, 'Окончание перевозки');
  if (transportStart && transportEnd && transportStart > transportEnd) throw userError_('Окончание перевозки раньше начала');
  fields[APPLICATION_COLUMN.transportStart] = transportStart;
  fields[APPLICATION_COLUMN.transportEnd] = transportEnd;
  fields[APPLICATION_COLUMN.address] = String(input.address || '').replace(/\s+/g, ' ').trim().slice(0, ADDRESS_MAX_LENGTH);

  // Строка перечитывается после всех проверок — прямо перед записью
  const values = writeFields_(table, freshApplication_(table, number), fields);
  log_(ss, 'Заявка изменена администратором', user, { athleteId: admin.id, text: '№ ' + number });
  return { status: 'success', number: Number(number), row: rowObject_(table.headers, values) };
}

// Дата из приложения: «гггг-мм-дд» (поле выбора даты) → полночь в часовом поясе скрипта; пусто → ''
function inputDate_(value, label) {
  const text = String(value || '').trim();
  if (!text) return '';
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  if (!date || date.getMonth() !== Number(m[2]) - 1) throw userError_(label + ': неверная дата «' + text + '»');
  return date;
}

// Выгрузка листа «Заявки» в Excel: input — { from, to } («гггг-мм-дд», любая может быть пустой). Отбор — по срокам ЕКП:
// в файл попадают заявки, у которых сроки по ЕКП пересекаются с периодом (без периода — все). Заявки без даты по ЕКП
// при заданном периоде не попадают — их число сообщается. Столбцы — как в таблице, без служебных
// (APPLICATION_SERVICE_COLUMNS). Файл .xlsx бот присылает администратору в чат
function adminExportApplications_(user, input) {
  const ss = spreadsheet_();
  const admin = requireAdmin_(ss, user);
  const from = inputDate_(input.from, 'Начало периода');
  const to = inputDate_(input.to, 'Конец периода');
  if (from && to && from > to) throw userError_('Конец периода раньше начала');

  const table = readTable_(ss, SHEET.applications);
  const columns = [];
  table.headers.forEach(function (h, i) {
    if (h.trim() && APPLICATION_SERVICE_COLUMNS.indexOf(h) === -1) columns.push(i);
  });

  let withoutDate = 0;
  const selected = [];
  table.rows.forEach(function (row) {
    const start = sheetDate_(table.get(row, APPLICATION_COLUMN.ekpStart));
    const end = sheetDate_(table.get(row, APPLICATION_COLUMN.ekpEnd)) || start;
    if (from || to) {
      if (!start) {
        withoutDate++;
        return;
      }
      // Конец периода — включительно (до конца дня)
      if (to && start >= shiftDays_(to, 1)) return;
      if (from && end < from) return;
    }
    selected.push({ start: start, number: Number(row.values[0]) || 0, values: row.values });
  });
  if (!selected.length) {
    return { status: 'success', count: 0, message: 'За этот период заявок нет' + (withoutDate ? ' (без даты по ЕКП: ' + withoutDate + ')' : '') };
  }
  // По датам ЕКП, затем по №; без даты — в конце
  selected.sort(function (a, b) {
    return (a.start ? a.start.getTime() : Infinity) - (b.start ? b.start.getTime() : Infinity) || a.number - b.number;
  });

  const day = function (date) { return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd'); };
  const period = from || to ? (from ? day(from) : '…') + '_' + (to ? day(to) : '…') : 'all';
  const periodText = from || to
    ? 'по срокам ЕКП ' + (from ? 'с ' + Utilities.formatDate(from, Session.getScriptTimeZone(), 'dd.MM.yyyy') : '') +
      (to ? ' по ' + Utilities.formatDate(to, Session.getScriptTimeZone(), 'dd.MM.yyyy') : '')
    : 'все';
  // Даты, записанные в ячейки текстом «дд.мм.гггг», — в файле тоже датами
  const dateColumns = [APPLICATION_COLUMN.transportStart, APPLICATION_COLUMN.transportEnd, APPLICATION_COLUMN.ekpStart, APPLICATION_COLUMN.ekpEnd];
  const rows = [columns.map(function (i) { return table.headers[i]; })].concat(selected.map(function (item) {
    return columns.map(function (i) {
      const value = item.values[i];
      return dateColumns.indexOf(table.headers[i]) === -1 ? value : sheetDate_(value) || value;
    });
  }));
  const file = xlsxBlob_(SHEET.applications, rows, 'zayavki_' + period + '.xlsx');

  const caption = 'Заявки (' + periodText + '): ' + selected.length +
    (withoutDate ? '. Без даты по ЕКП не вошли: ' + withoutDate : '');
  const error = telegramError_(fetch_('https://api.telegram.org/bot' + botToken_() + '/sendDocument', {
    method: 'post',
    muteHttpExceptions: true,
    payload: { chat_id: String(user.id), caption: caption, document: file },
  }));
  log_(ss, 'Выгрузка заявок', user, { athleteId: admin.id, text: caption + (error ? '. Не отправлено: ' + error : '') });
  if (error) {
    throw userError_('Бот не смог прислать файл (' + error + '). Откройте чат с ботом, нажмите «Старт» и повторите выгрузку');
  }
  return { status: 'success', count: selected.length, message: 'Файл отправлен в чат с ботом. ' + caption };
}

// ---------- Администрирование: спортсмены ----------

// Правка спортсмена: input — { athleteId, fields: { столбец: значение } } (только изменённые столбцы).
// Менять можно все столбцы, кроме ID, телефона и ChatId (ATHLETE_LOCKED_COLUMNS). Статус — из ATHLETE_STATUSES,
// «Перевозчик», «Администратор» и настройки уведомлений — «Да» / «Нет», ФИО — без дублей (как при заявке на доступ),
// ячейка-дата — датой («гггг-мм-дд»), прочее — текстом. Себе нельзя снять признак администратора и сменить статус —
// иначе пропадёт доступ. Статус сменили на «Подтвержден» — спортсмену сообщение бота, как при ручной правке
function adminSaveAthlete_(user, input) {
  const ss = spreadsheet_();
  const athletes = athletesTable_(ss);
  const admin = requireAdmin_(ss, user, athletes);
  const id = String(input.athleteId || '').trim();
  const athlete = findAthlete_(athletes, function (a) { return a.id === id; });
  if (!athlete) throw userError_('Спортсмен не найден — обновите данные');

  const table = readTable_(ss, SHEET.athletes);
  const fresh = freshRow_(table, findById_(table, id), id);
  const changes = input.fields || {};
  const fields = {};
  Object.keys(changes).forEach(function (column) {
    const i = table.headers.indexOf(column);
    if (i === -1) throw userError_('Нет столбца «' + column + '» на листе «' + SHEET.athletes + '»');
    if (i === 0 || ATHLETE_LOCKED_COLUMNS.indexOf(column) !== -1) throw userError_('Столбец «' + column + '» меняется только в таблице');
    const raw = changes[column];
    if (column === ATHLETE_COLUMN.status) {
      const status = String(raw || '').trim();
      if (ATHLETE_STATUSES.indexOf(status) === -1) throw userError_('Неизвестный статус «' + status + '»');
      fields[column] = status;
    } else if (ATHLETE_YES_NO_COLUMNS.indexOf(column) !== -1) {
      const value = String(raw || '').trim();
      if (value !== 'Да' && value !== 'Нет') throw userError_('«' + column + '»: допустимо «Да» или «Нет»');
      fields[column] = value;
    } else if ([ATHLETE_COLUMN.lastName, ATHLETE_COLUMN.firstName, ATHLETE_COLUMN.middleName].indexOf(column) !== -1) {
      fields[column] = cleanName_(raw);
    } else if (fresh.values[i] instanceof Date) {
      fields[column] = inputDate_(raw, column);
    } else {
      fields[column] = String(raw === null || raw === undefined ? '' : raw).replace(/\r\n?/g, '\n').trim().slice(0, TEXT_MAX_LENGTH);
    }
  });
  if (!Object.keys(fields).length) throw userError_('Нечего сохранять');

  const name = function (column, current) { return fields.hasOwnProperty(column) ? fields[column] : current; };
  const lastName = name(ATHLETE_COLUMN.lastName, athlete.lastName);
  const firstName = name(ATHLETE_COLUMN.firstName, athlete.firstName);
  const middleName = name(ATHLETE_COLUMN.middleName, athlete.middleName);
  if (!lastName || !firstName) throw userError_('Укажите фамилию и имя');
  const namesake = findAthlete_(athletes, function (a) { return a.id !== id && sameName_(a, lastName, firstName, middleName); });
  if (namesake) throw userError_('Спортсмен ' + namesake.fullName + ' уже есть в списке — дубли недопустимы');

  if (id === admin.id) {
    if (fields[ATHLETE_COLUMN.admin] === 'Нет') throw userError_('Снять признак администратора с себя нельзя');
    if (fields.hasOwnProperty(ATHLETE_COLUMN.status) && fields[ATHLETE_COLUMN.status] !== ATHLETE_STATUS.confirmed) {
      throw userError_('Свой статус сменить нельзя — пропадёт доступ к приложению');
    }
  }

  const values = writeFields_(table, fresh, fields);
  log_(ss, 'Спортсмен изменён', user, {
    athleteId: id,
    text: [lastName, firstName, middleName].filter(Boolean).join(' ') + ': ' + Object.keys(fields).map(function (column) {
      const value = fields[column];
      return column + ' = ' + (value instanceof Date ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd.MM.yyyy') : '«' + value + '»');
    }).join('; ') + '. Изменил: ' + admin.fullName,
  });

  if (fields.hasOwnProperty(ATHLETE_COLUMN.status) &&
    notifyStatusNow_(SHEET.athletes, id, fields[ATHLETE_COLUMN.status], [ATHLETE_STATUS.confirmed])) {
    SpreadsheetApp.flush();
    forgetSheet_(SHEET.athletes);
    sendAccessConfirmed_(ss, findAthlete_(athletesTable_(ss), function (a) { return a.id === id; }));
  }
  return { status: 'success', athleteId: id, row: rowObject_(table.headers, values) };
}

// Удаление спортсмена: его закрепления оружия удаляются, его заявки (CreatedBy) переносятся в «Архив заявок»
// с прежним статусом, строка удаляется из «Спортсменов». Заявки других перевозчиков, где он участник, не меняются —
// там он записан текстом. Себя удалить нельзя
function adminDeleteAthlete_(user, input) {
  const ss = spreadsheet_();
  const athletes = athletesTable_(ss);
  const admin = requireAdmin_(ss, user, athletes);
  const id = String(input.athleteId || '').trim();
  const athlete = findAthlete_(athletes, function (a) { return a.id === id; });
  if (!athlete) throw userError_('Спортсмен не найден — обновите данные');
  if (id === admin.id) throw userError_('Удалить себя нельзя');

  const archive = readTable_(ss, SHEET.applicationsArchive);
  const moved = deleteRowsWhere_(ss, SHEET.applications, function (values, headers) {
    return String(values[headers.indexOf(APPLICATION_COLUMN.createdBy)]).trim() === id;
  }, function (rows, headers) {
    // Сначала копии в архив (одной записью), потом удаление — чтобы заявки не потерялись при ошибке
    appendRows_(archive.sheet, rows.map(function (values) {
      return archive.headers.map(function (h) {
        const i = headers.indexOf(h);
        return i === -1 ? '' : values[i];
      });
    }));
  });
  const links = deleteRowsWhere_(ss, SHEET.athleteWeapons, function (values, headers) {
    return String(values[headers.indexOf(ATHLETE_WEAPON_COLUMN.athleteId)]).trim() === id;
  });
  deleteRowsWhere_(ss, SHEET.athletes, function (values) { return String(values[0]).trim() === id; });

  const numbers = moved.map(function (values) { return String(values[0]).trim(); });
  log_(ss, 'Спортсмен удалён', user, {
    athleteId: id,
    phone: athlete.phone,
    text: athlete.fullName + '. Откреплено оружия: ' + links.length +
      (numbers.length ? '; заявки перенесены в «' + SHEET.applicationsArchive + '»: № ' + numbers.join(', ') : '') + '. Удалил: ' + admin.fullName,
  });
  return { status: 'success', athleteId: id, applications: numbers, links: links.length };
}

// ---------- Администрирование: соревнования ----------

// Создание (без id) или правка соревнования: input — { id?, title, ekpNumber, kind, start, end, address }, даты —
// «гггг-мм-дд» или пусто. Поданные заявки не меняются (в них данные соревнования записаны текстом).
// После сохранения — рассылка перевозчикам по тем же правилам, что у триггера (NEW_COMPETITION_REQUIRED и «Рассылка»)
function adminSaveCompetition_(user, input) {
  const ss = spreadsheet_();
  const admin = requireAdmin_(ss, user);
  const table = readTable_(ss, SHEET.competitions);
  const text = function (value, max) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); };

  const fields = {};
  fields[COMPETITION_COLUMN.title] = text(input.title, TITLE_MAX_LENGTH);
  if (!fields[COMPETITION_COLUMN.title]) throw userError_('Укажите название соревнования');
  fields[COMPETITION_COLUMN.ekpNumber] = text(input.ekpNumber, NAME_MAX_LENGTH);
  fields[COMPETITION_COLUMN.kind] = text(input.kind, TITLE_MAX_LENGTH);
  fields[COMPETITION_COLUMN.address] = text(input.address, ADDRESS_MAX_LENGTH);
  fields[COMPETITION_COLUMN.start] = inputDate_(input.start, 'Дата начала');
  fields[COMPETITION_COLUMN.end] = inputDate_(input.end, 'Дата завершения');
  if (fields[COMPETITION_COLUMN.start] && fields[COMPETITION_COLUMN.end] && fields[COMPETITION_COLUMN.start] > fields[COMPETITION_COLUMN.end]) {
    throw userError_('Дата завершения раньше даты начала');
  }
  Object.keys(fields).forEach(function (column) {
    if (table.headers.indexOf(column) === -1) throw userError_('Нет столбца «' + column + '» на листе «' + SHEET.competitions + '»');
  });

  let id = String(input.id || '').trim();
  const created = !id;
  if (created) {
    id = newId_();
    table.sheet.appendRow(safeRow_(table.headers.map(function (h, i) {
      if (i === 0) return id;
      return fields.hasOwnProperty(h) ? fields[h] : '';
    })));
  } else {
    const row = findById_(table, id);
    if (!row) throw userError_('Соревнование не найдено — возможно, его уже перенесли в архив');
    writeFields_(table, freshRow_(table, row, id), fields);
  }
  log_(ss, created ? 'Соревнование создано' : 'Соревнование изменено', user, {
    athleteId: admin.id,
    text: fields[COMPETITION_COLUMN.title] + ' (' + id + ')',
  });

  SpreadsheetApp.flush();
  forgetSheet_(SHEET.competitions);
  const saved = readTable_(ss, SHEET.competitions);

  // Рассылка — после снятия блокировки записи (afterUnlock_): она идёт секунды, а запись других пользователей
  // ждать её не должна. От повтора рассылку защищают своя блокировка таблицы и отметка «Рассылка»
  afterUnlock_ = function (result) {
    try {
      const sent = notifyNewCompetitionsWhere_(ss, function (row) { return String(row.values[0]).trim() === id; });
      if (!sent) return result;
      // Рассылка записала время в «Рассылку» — копия листа в кэше устарела, а приложению нужна свежая строка
      invalidateSheets_([SHEET.competitions]);
      forgetSheet_(SHEET.competitions);
      const fresh = readTable_(ss, SHEET.competitions);
      const row = findById_(fresh, id);
      result.notified = true;
      if (row) result.row = rowObject_(fresh.headers, row.values);
    } catch (err) {
      // Соревнование уже сохранено — ответ остаётся успешным; рассылку доделает триггер при следующей правке строки
      console.error('Рассылка о соревновании ' + id + ': ' + err);
      logQuotaError_(err, 'Рассылка о соревновании');
      log_(ss, 'Рассылка: ошибка', { id: '' }, { text: fields[COMPETITION_COLUMN.title] + ' (' + id + '): ' + err });
    }
    return result;
  };
  return {
    status: 'success',
    id: id,
    created: created,
    notified: false,
    row: rowObject_(saved.headers, findById_(saved, id).values),
  };
}

// ---------- Администрирование: оружие ----------

// Пара «Название + Номер» для сравнения: без учёта регистра, «ё/е» и лишних пробелов
function weaponKey_(title, number) {
  const norm = function (s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/ё/g, 'е'); };
  return norm(title) + '|' + norm(number);
}

// Единица справочника с той же парой «Название + Номер» (кроме exceptId) или null
function sameWeapon_(weapons, title, number, exceptId) {
  const key = weaponKey_(title, number);
  for (let i = 0; i < weapons.rows.length; i++) {
    const row = weapons.rows[i];
    if (String(row.values[0]).trim() === exceptId) continue;
    if (weaponKey_(weapons.get(row, WEAPON_COLUMN.title), weapons.get(row, WEAPON_COLUMN.number)) === key) return row;
  }
  return null;
}

// Название и номер из приложения: оба обязательны
function weaponInput_(input) {
  const title = String(input.title || '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_LENGTH);
  const number = String(input.number || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH);
  if (!title) throw userError_('Укажите название оружия');
  if (!number) throw userError_('Укажите номер оружия');
  return { title: title, number: number };
}

// Новая строка справочника «Оружие» — возвращает её ID
function appendWeapon_(weapons, weapon) {
  [WEAPON_COLUMN.title, WEAPON_COLUMN.number].forEach(function (column) { weapons.col(column); });
  const id = newId_();
  weapons.sheet.appendRow(safeRow_(weapons.headers.map(function (h, i) {
    if (i === 0) return id;
    if (h === WEAPON_COLUMN.title) return weapon.title;
    if (h === WEAPON_COLUMN.number) return weapon.number;
    return '';
  })));
  return id;
}

// Сохранённая строка справочника { заголовок: значение } — перечитывается из таблицы
function weaponRow_(ss, id) {
  SpreadsheetApp.flush();
  forgetSheet_(SHEET.weapons);
  const saved = readTable_(ss, SHEET.weapons);
  return rowObject_(saved.headers, findById_(saved, id).values);
}

// Создание (без id) или правка единицы справочника: input — { id?, title, number }. Номер не уникален,
// уникальна пара «Название + Номер». Поданные заявки не меняются — в них оружие записано текстом
function adminSaveWeapon_(user, input) {
  const ss = spreadsheet_();
  const admin = requireAdmin_(ss, user);
  const weapons = readTable_(ss, SHEET.weapons);
  const weapon = weaponInput_(input);
  let id = String(input.id || '').trim();
  if (sameWeapon_(weapons, weapon.title, weapon.number, id)) throw userError_(weapon.title + ' ' + weapon.number + ' уже есть в справочнике');

  const created = !id;
  if (created) {
    id = appendWeapon_(weapons, weapon);
  } else {
    const row = findById_(weapons, id);
    if (!row) throw userError_('Оружие не найдено — обновите данные');
    const fields = {};
    fields[WEAPON_COLUMN.title] = weapon.title;
    fields[WEAPON_COLUMN.number] = weapon.number;
    writeFields_(weapons, freshRow_(weapons, row, id), fields);
  }
  log_(ss, created ? 'Оружие добавлено в справочник' : 'Оружие изменено', user, { athleteId: admin.id, text: weapon.title + ' ' + weapon.number });
  return { status: 'success', id: id, created: created, row: weaponRow_(ss, id) };
}

// Удаление единицы из справочника вместе с её закреплениями. Заявки не меняются — в них оружие записано текстом
function adminDeleteWeapon_(user, input) {
  const ss = spreadsheet_();
  const admin = requireAdmin_(ss, user);
  const id = String(input.weaponId || '').trim();
  const weapons = readTable_(ss, SHEET.weapons);
  const weapon = findById_(weapons, id);
  if (!weapon) throw userError_('Оружие не найдено — обновите данные');
  const title = weaponTitle_(weapons, weapon);

  const links = deleteRowsWhere_(ss, SHEET.athleteWeapons, function (values, headers) {
    return String(values[headers.indexOf(ATHLETE_WEAPON_COLUMN.weaponId)]).trim() === id;
  });
  deleteRowsWhere_(ss, SHEET.weapons, function (values) { return String(values[0]).trim() === id; });
  log_(ss, 'Оружие удалено из справочника', user, { athleteId: admin.id, text: title + '. Откреплено: ' + links.length });
  return { status: 'success', weaponId: id, links: links.length };
}

// Закрепление единицы за спортсменом администратором: input — { athleteId, weaponId } или { athleteId, newWeapon: { title,
// number } } — новую единицу сначала заводят в справочнике (если такая пара уже есть — берётся она)
function adminAssignWeapon_(user, input) {
  const ss = spreadsheet_();
  const athletes = athletesTable_(ss);
  const admin = requireAdmin_(ss, user, athletes);
  const athlete = findAthlete_(athletes, function (a) { return a.id === String(input.athleteId || '').trim(); });
  if (!athlete) throw userError_('Спортсмен не найден — обновите данные');

  let weaponId = String(input.weaponId || '').trim();
  let weaponRow = null;
  if (!weaponId && input.newWeapon) {
    const weapons = readTable_(ss, SHEET.weapons);
    const weapon = weaponInput_(input.newWeapon);
    const existing = sameWeapon_(weapons, weapon.title, weapon.number, '');
    if (existing) {
      weaponId = String(existing.values[0]).trim();
    } else {
      weaponId = appendWeapon_(weapons, weapon);
      log_(ss, 'Оружие добавлено в справочник', user, { athleteId: admin.id, text: weapon.title + ' ' + weapon.number });
      weaponRow = weaponRow_(ss, weaponId);
    }
  }
  const result = linkWeapon_(ss, athlete.id, weaponId);
  if (!result.already) {
    log_(ss, 'Оружие закреплено', user, { athleteId: athlete.id, text: result.title + ' за ' + athlete.shortName + '. Закрепил: ' + admin.fullName });
  }
  return {
    status: 'success',
    link: result.link,
    weaponRow: weaponRow,
    message: result.title + (result.already ? ' уже закреплено за ' : ' закреплено за ') + athlete.shortName,
  };
}

// Открепление администратором: input — { athleteId, weaponId }
function adminUnassignWeapon_(user, input) {
  const ss = spreadsheet_();
  const athletes = athletesTable_(ss);
  const admin = requireAdmin_(ss, user, athletes);
  const athlete = findAthlete_(athletes, function (a) { return a.id === String(input.athleteId || '').trim(); });
  if (!athlete) throw userError_('Спортсмен не найден — обновите данные');
  const result = unlinkWeapon_(ss, athlete.id, input.weaponId);
  if (!result.already) {
    log_(ss, 'Оружие откреплено', user, { athleteId: athlete.id, text: result.title + ' от ' + athlete.shortName + '. Открепил: ' + admin.fullName });
  }
  return {
    status: 'success',
    link: result.link,
    message: result.title + (result.already ? ' уже не закреплено за ' : ' откреплено от ') + athlete.shortName,
  };
}

// ---------- Файл Excel ----------
// Минимальный .xlsx (Office Open XML) без Google Диска: XML-части листа, упакованные Utilities.zip.
// rows — строки значений, первая — заголовки (жирным, закреплена, с автофильтром). Даты — датами Excel
// (дд.мм.гггг), числа — числами, остальное — текстом с переносом строк

function xlsxBlob_(sheetTitle, rows, fileName) {
  const xml = function (s) {
    // Управляющие символы в XML недопустимы — убираем (кроме табуляции и переносов)
    return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  const columnName = function (index) {
    let name = '';
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
    return name;
  };
  // Дата Excel — дни от 30.12.1899; берём календарные дату и время в часовом поясе скрипта
  const serial = function (d) {
    return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) -
      Date.UTC(1899, 11, 30)) / 86400000;
  };
  // Стили (cellXfs ниже): 1 — дата, 2 — текст с переносом, 3 — заголовок
  const cell = function (value, ref, isHeader) {
    if (value instanceof Date) return '<c r="' + ref + '" s="1"><v>' + serial(value) + '</v></c>';
    if (typeof value === 'number' && isFinite(value)) return '<c r="' + ref + '"><v>' + value + '</v></c>';
    const text = String(value === null || value === undefined ? '' : value);
    if (!text) return '';
    return '<c r="' + ref + '" t="inlineStr" s="' + (isHeader ? 3 : 2) + '"><is><t xml:space="preserve">' + xml(text) + '</t></is></c>';
  };

  const width = rows[0].length;
  const lastColumn = columnName(width - 1);
  // Ширина столбца — по самой длинной строке текста в нём (в пределах 8…60 символов)
  const widths = rows[0].map(function (_, c) {
    let max = 8;
    rows.forEach(function (row) {
      const value = row[c];
      const text = value instanceof Date ? '00.00.0000' : String(value === null || value === undefined ? '' : value);
      text.split('\n').forEach(function (line) { max = Math.max(max, line.length + 2); });
    });
    return Math.min(max, 60);
  });

  const sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<cols>' + widths.map(function (w, c) { return '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>' +
    '<sheetData>' + rows.map(function (row, r) {
      return '<row r="' + (r + 1) + '">' + row.map(function (value, c) { return cell(value, columnName(c) + (r + 1), r === 0); }).join('') + '</row>';
    }).join('') + '</sheetData>' +
    '<autoFilter ref="A1:' + lastColumn + rows.length + '"/>' +
    '</worksheet>';

  const parts = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + xml(sheetTitle.slice(0, 31)) + '" sheetId="1" r:id="rId1"/></sheets>' +
      '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' + xml(sheetTitle.slice(0, 31)) + '\'!$A$1:$' + lastColumn + '$' + rows.length + '</definedName></definedNames>' +
      '</workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
    'xl/worksheets/sheet1.xml': sheetXml,
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="4">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>',
  };
  const blobs = Object.keys(parts).map(function (path) { return Utilities.newBlob(parts[path], 'application/xml', path); });
  return Utilities.zip(blobs, fileName).setContentType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// ---------- Работа с листами ----------
// Чтение листа — самая долгая часть вызова скрипта. Поэтому:
//  - за один вызов каждый лист читается из таблицы не больше одного раза (sheetValuesMemo_);
//  - для отдачи данных приложению (loadSheets_) листы берутся из CacheService на SHEET_CACHE_SECONDS;
//  - запись (действия doPost, кроме загрузки листов) всегда работает со свежими данными таблицы, не из кэша.
//
// Согласованность кэша с таблицей — через поколения. У каждого листа в кэше есть метка поколения
// ('gen:<лист>'), копия листа хранится под ключом с этой меткой ('sheet:<лист>:<метка>').
// Запись через приложение (после SpreadsheetApp.flush) и ручная правка (onSheetEdit) ставят листу новую метку —
// старая копия перестаёт находиться. Читатель узнаёт метку ДО чтения таблицы и кладёт копию под неё же:
// если запись случилась во время чтения, устаревшая копия ляжет под уже ненужную метку и никому не попадётся.
// Итог: загрузка, начатая после завершения записи, всегда видит эту запись. Правки другими скриптами
// (например, перенос строк скриптом другого проекта) скрипт не замечает — они видны через SHEET_CACHE_SECONDS
// или сразу по кнопке «Обновить» (загрузка листов с fresh).

// Значения листов, уже прочитанных в этом вызове скрипта (глобальные переменные живут один вызов)
const sheetValuesMemo_ = {};

// Принудительное обновление (загрузка листов с fresh — кнопки «Обновить» и «Проверить снова» в приложении):
// таблица читается мимо кэша, а кэш заполняется свежими данными. Так правки в таблице видны сразу,
// даже если триггер onSheetEdit не установлен
let freshRead_ = false;

// Метка поколения живёт дольше копий листов (6 часов — максимум CacheService). Пропала — создаётся новая,
// а листы просто перечитываются из таблицы
const SHEET_GENERATION_SECONDS = 6 * 60 * 60;

// Значения листа вместе со строкой заголовков, без пустых столбцов справа от последнего заголовка.
// fromCache — можно взять из CacheService (только для чтения): тогда к таблице не обращаемся вовсе.
// optional — листа нет в таблице: вернуть null, а не ошибку
function sheetValues_(ss, name, fromCache, optional) {
  if (sheetValuesMemo_[name]) return sheetValuesMemo_[name];
  // Метки и копии берутся из кэша до чтения таблицы (см. выше). При принудительном обновлении (fresh)
  // копию не используем, но свежие данные под текущей меткой кладём
  const cached = fromCache ? sheetCache_() : null;
  let values = cached && !freshRead_ ? cached.values[name] : null;
  if (!values) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) {
      if (optional) return null;
      throw new Error('Нет листа «' + name + '»');
    }
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
  // При принудительном обновлении копии всё равно не используются — не забираем их
  if (freshRead_) {
    sheetCacheMemo_ = result;
    return result;
  }

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

// Копия листа для кэша — JSON, даты как { $d: время }
function sheetCacheJson_(values) {
  return JSON.stringify(values.map(function (row) {
    return row.map(function (cell) { return cell instanceof Date ? { $d: cell.getTime() } : cell; });
  }));
}

function cachePutSheet_(ss, name, generation, values) {
  const json = sheetCacheJson_(values);
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
// Сам лист (sheet) нужен только для записи — берётся из таблицы при первом обращении
function readTable_(ss, name) {
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
  let sheet = null;
  return {
    name: name,
    get sheet() {
      if (!sheet) sheet = ss.getSheetByName(name);
      return sheet;
    },
    headers: headers,
    rows: rows,
    col: col,
    get: function (row, column) { return row.values[col(column)]; },
  };
}

// Значения листа, прочитанные в этом вызове, устарели (лист только что изменили) — следующее чтение возьмёт свежие
function forgetSheet_(name) {
  delete sheetValuesMemo_[name];
}

// Удаление строк листа, для которых matches(values, headers) — true. Строки ищутся по свежему чтению листа прямо
// перед удалением (под блокировкой скрипта), удаляются снизу вверх. beforeDelete(rows, headers) — например, копия в архив.
// Возвращает значения удалённых строк (сверху вниз)
function deleteRowsWhere_(ss, name, matches, beforeDelete) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  const headers = (values[0] || []).map(String);
  const found = [];
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][0]).trim() !== '' && matches(values[r], headers)) found.push({ row: r + 1, values: values[r] });
  }
  if (!found.length) return [];
  const rows = found.map(function (f) { return f.values; });
  if (beforeDelete) beforeDelete(rows, headers);
  deleteRowNumbers_(sheet, found.map(function (f) { return f.row; }));
  forgetSheet_(name);
  return rows;
}

// Удаление строк листа по номерам: подряд идущие — одним вызовом deleteRows, блоки — снизу вверх,
// чтобы номера ещё не удалённых строк не сдвигались. Каждый вызов к таблице — сотни миллисекунд под блокировкой записи
function deleteRowNumbers_(sheet, rows) {
  const sorted = rows.slice().sort(function (a, b) { return b - a; });
  let i = 0;
  while (i < sorted.length) {
    const bottom = sorted[i];
    let top = bottom;
    while (i + 1 < sorted.length && sorted[i + 1] === top - 1) top = sorted[++i];
    i++;
    sheet.deleteRows(top, bottom - top + 1);
  }
}

// Строки в конец листа одной записью (вместо appendRow на каждую). Строк в сетке листа не хватает — добавляются
// (appendRow делает это сам, а getRange за пределами сетки — ошибка)
function appendRows_(sheet, rows) {
  if (!rows.length) return;
  const first = sheet.getLastRow() + 1;
  const missing = first + rows.length - 1 - sheet.getMaxRows();
  if (missing > 0) sheet.insertRowsAfter(sheet.getMaxRows(), missing);
  sheet.getRange(first, 1, rows.length, rows[0].length).setValues(rows.map(safeRow_));
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

// isAdmin — администратору листы отдаются целиком: все столбцы спортсменов, все заявки, все соревнования
function readSheets_(ss, names, athleteId, isAdmin) {
  // Список не задан или пуст — все листы приложения
  const wanted = names && names.length ? names.map(function (n) { return String(n).trim(); }) : APP_SHEETS;
  const sheets = {};

  APP_SHEETS.forEach(function (name) {
    if (wanted.indexOf(name) === -1) return;
    // Листа нет в таблице (например, справочник ещё не создан) — просто не отдаём его
    const values = sheetValues_(ss, name, true, true);
    if (!values) return;
    const headers = (values[0] || []).map(String);
    let rows = values.slice(1).filter(function (row) {
      return row.some(function (cell) { return cell !== ''; });
    });

    // У других спортсменов отдаются только столбцы ATHLETE_PUBLIC_COLUMNS (участников выбирают по ФИО), своя строка —
    // целиком. Столбцы, добавленные в лист позже (документы, даты рождения и т.п.), другим так не попадут
    if (isAdmin) {
      sheets[name] = { headers: headers, rows: rows };
      return;
    }

    if (name === SHEET.athletes) {
      rows = rows.map(function (row) {
        if (String(row[0]).trim() === athleteId) return row;
        return row.map(function (cell, i) { return i === 0 || ATHLETE_PUBLIC_COLUMNS.indexOf(headers[i]) !== -1 ? cell : ''; });
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
  // Одна и та же строка проверяется за вызов один раз (например, initData — и при входе, и в ответе об отказе)
  if (!verifiedMemo_.hasOwnProperty(query)) verifiedMemo_[query] = checkSignature_(query);
  return verifiedMemo_[query];
}
const verifiedMemo_ = {};

function checkSignature_(query) {
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

// Адрес приложения из свойств скрипта (пусто — не задан) — читается один раз за вызов: при рассылке он нужен
// для каждого сообщения
let miniAppUrlMemo_;
function miniAppUrl_() {
  if (miniAppUrlMemo_ === undefined) miniAppUrlMemo_ = PropertiesService.getScriptProperties().getProperty('MINI_APP_URL') || '';
  return miniAppUrlMemo_;
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
    const bot = JSON.parse(fetch_('https://api.telegram.org/bot' + botToken_() + '/getMe', { muteHttpExceptions: true }).getContentText());
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
// Новое окружение (например, тестовое: копия таблицы + свой бот) настраивается так (полный порядок, с тем,
// какой идентификатор куда вписывается, — в README, раздел «Настройка нового окружения»):
//   1. «Настройки проекта» (⚙️): часовой пояс — Europe/Moscow (по нему считаются даты соревнований и сроки
//      перевозки); «Свойства скрипта»: BOT_TOKEN и MINI_APP_URL (см. шапку файла);
//   2. installTriggers   — триггеры (или вручную в разделе «Триггеры»);
//      markExistingCompetitions — если в «Соревнованиях» уже есть строки;
//   3. «Развернуть» → новое развёртывание (веб-приложение, «Выполнять как: я», доступ «Все») — его адрес …/exec
//      вписать в VITE_GOOGLE_SCRIPT_URL файла .env этого окружения и выложить приложение. Новое развёртывание —
//      один раз; дальше — новая версия того же развёртывания, адрес не меняется;
//   4. setupMenuButton   — кнопка меню бота ведёт в приложение этого окружения;
//      в @BotFather: Bot Settings → Configure Mini App → Edit Mini App URL — адрес стартовой кнопки бота
//      (Main Mini App); через Bot API он не меняется;
//   5. checkSetup        — проверить, что всё сходится; removeWebhook — если checkSetup показывает вебхук.

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
 *    название таблицы, есть ли триггеры и когда сделана последняя резервная копия.
 */
function checkSetup() {
  const props = PropertiesService.getScriptProperties();
  const rawToken = props.getProperty('BOT_TOKEN') || '';
  const lines = [];
  if (!rawToken) {
    lines.push('BOT_TOKEN: не задан');
  } else {
    lines.push('BOT_TOKEN: ' + rawToken.length + ' символов' + (rawToken !== rawToken.trim() ? ' — есть пробелы или переносы по краям (скрипт их отбрасывает)' : ''));
    const callBot = function (method) {
      return JSON.parse(fetch_('https://api.telegram.org/bot' + rawToken.trim() + '/' + method, { muteHttpExceptions: true }).getContentText());
    };
    const bot = callBot('getMe');
    lines.push(bot.ok ? 'Бот: @' + bot.result.username + ' (' + bot.result.first_name + ')' : 'Бот: токен не принят Telegram — ' + bot.description);
    if (bot.ok) {
      // Кто получает сообщения боту: наш скрипт сообщения не обрабатывает, поэтому вебхук должен быть пустым.
      // Если он задан — ответы в чате (клавиатуры, команды) даёт тот код, а не этот скрипт
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
  const handlers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  SCRIPT_TRIGGERS.forEach(function (name) {
    lines.push('Триггер ' + name + ': ' + (handlers.indexOf(name) !== -1 ? 'есть' : 'нет — запустите installTriggers'));
  });
  lines.push(backupReport_());
  lines.push('');
  lines.push('Запас по лимитам (⚠ — занято больше ' + Math.round(LIMIT_WARN_SHARE * 100) + '%):');
  limitsReport_(spreadsheet_()).forEach(function (line) { lines.push(line); });
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
  const appUrl = miniAppUrl_();
  if (!appUrl) throw new Error('Не задано свойство скрипта MINI_APP_URL');
  const response = fetch_('https://api.telegram.org/bot' + botToken_() + '/setChatMenuButton', {
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
  const responses = fetchAll_(chatIds.map(function (chatId) {
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
  const response = fetch_('https://api.telegram.org/bot' + botToken_() + '/deleteWebhook?drop_pending_updates=true', {
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
 * installTriggers — триггеры скрипта:
 *  - onSheetEdit на ручные правки таблицы (ID новым строкам, сброс кэша, уведомления);
 *  - archivePastApplications раз в сутки в ARCHIVE_HOUR (перенос заявок прошедших соревнований в архив);
 *  - backupSpreadsheet раз в сутки в BACKUP_HOUR (резервная копия таблицы, см. «Резервные копии»).
 *
 * Когда запускать: один раз при настройке окружения. Повторный запуск безопасен — прежние триггеры этих функций
 * удаляются, дублей не будет; другие триггеры не трогаются.
 * Если Google отвечает «Произошла неизвестная ошибка» — создайте триггеры вручную: «Триггеры» (⏰) →
 * «Добавить триггер» → функция onSheetEdit, источник «Из таблицы», тип «При изменении»; функция
 * archivePastApplications и backupSpreadsheet, источник «Время», «Ежедневно», ночью.
 */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (SCRIPT_TRIGGERS.indexOf(trigger.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(spreadsheet_()).onEdit().create();
  ScriptApp.newTrigger('archivePastApplications').timeBased().everyDays(1).atHour(ARCHIVE_HOUR).create();
  ScriptApp.newTrigger('backupSpreadsheet').timeBased().everyDays(1).atHour(BACKUP_HOUR).create();
}

// Функции, на которые installTriggers ставит триггеры
const SCRIPT_TRIGGERS = ['onSheetEdit', 'archivePastApplications', 'backupSpreadsheet'];

// ---------- Перенос заявок в архив ----------

// Час (по часовому поясу скрипта), в который раз в сутки срабатывает перенос — ночью, когда приложением не пользуются
const ARCHIVE_HOUR = 3;

/**
 * archivePastApplications — перенос в «Архив заявок» заявок, чьё соревнование прошло: со следующего дня после
 * «Сроки по ЕКП окончание» (пусто — после «Сроки по ЕКП начало»). Переносятся заявки в любом статусе, статус в архиве —
 * прежний. Заявки без даты по ЕКП (или с датой, которую не разобрать) остаются — их переносят вручную.
 * Соревнования не переносятся.
 *
 * Запускает триггер по времени раз в сутки в ARCHIVE_HOUR (ставит installTriggers); можно запустить и вручную.
 * Под блокировкой записи — той же, что у запросов приложения: перенос не пересечётся с подачей, удалением заявки
 * или удалением спортсмена. Не дождался блокировки — перенос случится в следующий запуск.
 * Возвращает, сколько заявок перенесено. Итог — в «_Журнал»
 */
function archivePastApplications() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) {
    console.log('Перенос заявок в архив: сервер занят — перенос в следующий запуск');
    return 0;
  }
  try {
    const ss = spreadsheet_();
    const archive = readTable_(ss, SHEET.applicationsArchive);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const moved = deleteRowsWhere_(ss, SHEET.applications, function (values, headers) {
      const cell = function (column) {
        const i = headers.indexOf(column);
        return i === -1 ? '' : values[i];
      };
      const end = sheetDate_(cell(APPLICATION_COLUMN.ekpEnd)) || sheetDate_(cell(APPLICATION_COLUMN.ekpStart));
      return Boolean(end) && end < today;
    }, function (rows, headers) {
      // Сначала копии в архив (одной записью), потом удаление — чтобы заявки не потерялись при ошибке
      appendRows_(archive.sheet, rows.map(function (values) {
        return archive.headers.map(function (h) {
          const i = headers.indexOf(h);
          return i === -1 ? '' : values[i];
        });
      }));
    });
    if (!moved.length) return 0;

    invalidateSheets_([SHEET.applications]);
    // Память уведомлений перенесённых строк больше не нужна
    const props = PropertiesService.getScriptProperties();
    const numbers = moved.map(function (values) { return String(values[0]).trim(); });
    numbers.forEach(function (number) { props.deleteProperty(notifiedKey_(SHEET.applications, number)); });
    log_(ss, 'Перенос заявок в архив', { id: '' }, {
      text: 'Соревнование прошло — перенесены в «' + SHEET.applicationsArchive + '»: № ' + numbers.join(', '),
    });
    return moved.length;
  } catch (err) {
    console.error('archivePastApplications: ' + err);
    logQuotaError_(err, 'Перенос заявок в архив');
    throw err; // ошибка видна в «Выполнениях», а Google пришлёт владельцу письмо о сбое триггера
  } finally {
    lock.releaseLock();
  }
}

// ---------- Резервные копии ----------
// Раз в сутки (BACKUP_HOUR, триггер ставит installTriggers) таблица копируется в новую Google Таблицу в папке на Диске
// владельца скрипта: все листы — значения, формулы, оформление. Скрипт таблицы и его свойства (токен бота) в копию
// не попадают. Хранятся копии за BACKUP_KEEP_DAYS дней и первая копия каждого месяца — BACKUP_KEEP_MONTHS месяцев;
// остальные скрипт отправляет в корзину Диска. Папка создаётся при первой копии, её ID — в свойстве скрипта
// BACKUP_FOLDER_ID, у каждого окружения своя. Других таблиц в эту папку не класть.
// В копиях ФИО, телефоны и данные об оружии — папку никому не открывать.
//
// Восстановление — вручную, в редакторе Apps Script (порядок — README, «Резервные копии»):
// listBackups → ID копии в RESTORE → restoreCheck (отчёт, ничего не меняет) → restoreApply.
// Столбцы копии сопоставляются с таблицей по заголовкам, поэтому копия годится и после изменения структуры таблицы:
// порядок столбцов не важен, новые столбцы остаются пустыми, удалённые не восстанавливаются, переименования —
// по RENAMED_SHEETS / RENAMED_COLUMNS.

// Час копирования — до переноса заявок в архив (ARCHIVE_HOUR): копия застаёт заявки ещё на месте
const BACKUP_HOUR = 2;
const BACKUP_KEEP_DAYS = 30;
const BACKUP_KEEP_MONTHS = 12;
// checkSetup предупреждает, если последней копии больше стольких часов
const BACKUP_MAX_AGE_HOURS = 48;
const BACKUP_FOLDER_PROPERTY = 'BACKUP_FOLDER_ID';
// По этой части имени скрипт узнаёт свои копии в папке
const BACKUP_NAME_MARK = ' — копия ';
// Сколько действует проверка restoreCheck: restoreApply без свежей проверки тех же настроек не запустится
const RESTORE_CHECK_SECONDS = 30 * 60;

// Переименования листов и столбцов: восстановление переводит старые названия из копии в новые. Переименовали лист
// или столбец — добавьте строку «старое → новое» и не удаляйте её: по ней читаются все копии, сделанные раньше.
// Новый столбец должен работать с пустым значением — у строк из старых копий он будет пустым
const RENAMED_SHEETS = {
  // 'Старое название листа': 'Новое название',
};
const RENAMED_COLUMNS = {
  // 'Лист (новое название)': { 'Старый заголовок': 'Новый заголовок' },
};

// Что восстанавливать — заполняется перед restoreCheck / restoreApply и после восстановления очищается
const RESTORE = {
  // ID таблицы-копии: из listBackups или из адреса таблицы (…/spreadsheets/d/<ID>/edit). Подойдёт любая таблица с теми же
  // листами — например, файл .xlsx, загруженный на Диск и сохранённый как Google Таблица
  backupId: '',
  // Листы (названия в таблице сейчас); пусто — все листы копии, кроме служебных (имя начинается с «_»)
  sheets: [],
  // Только строки с этими значениями первого столбца (ID спортсмена, № заявки…) на одном листе из sheets: такие строки
  // заменяются строками копии, остальные не трогаются. Пусто — листы целиком
  ids: [],
};

/**
 * backupSpreadsheet — резервная копия таблицы и удаление устаревших копий.
 *
 * Запускает триггер раз в сутки в BACKUP_HOUR (ставит installTriggers); можно запустить и вручную.
 * Сбой — в «_Журнал», сообщение бота подтверждённым администраторам и письмо Google владельцу о сбое триггера.
 */
function backupSpreadsheet() {
  const ss = spreadsheet_();
  // Под блокировкой записи копия не застанет запрос приложения посередине (заявка удалена, но ещё не в архиве).
  // Не дождались блокировки — копируем без неё: копия важнее
  const lock = LockService.getScriptLock();
  const locked = lock.tryLock(60000);
  let file;
  try {
    file = makeBackup_(ss, '');
  } catch (err) {
    console.error('backupSpreadsheet: ' + err);
    log_(ss, 'Резервная копия не сделана', { id: '' }, { text: String((err && err.message) || err) });
    logQuotaError_(err, 'Резервная копия');
    notifyAdminsBackupFailed_(ss, err);
    throw err;
  } finally {
    if (locked) lock.releaseLock();
  }

  let removed = [];
  try {
    removed = removeOldBackups_(backupFolder_(ss));
  } catch (err) {
    console.error('Удаление старых копий: ' + err);
  }
  log_(ss, 'Резервная копия', { id: '' }, {
    text: file.getName() + (locked ? '' : ' (без блокировки записи — сервер был занят)') +
      (removed.length ? '. Удалены устаревшие: ' + removed.join(', ') : ''),
  });
  return file.getId();
}

/**
 * listBackups — список копий (новые сверху) с ID для RESTORE.backupId и адрес папки. Ничего не меняет.
 */
function listBackups() {
  const folder = existingBackupFolder_();
  if (!folder) {
    console.log('Копий ещё нет: папка создаётся при первой копии (backupSpreadsheet)');
    return;
  }
  const lines = ['Папка: ' + folder.getName() + ' — ' + folder.getUrl()];
  backupFiles_(folder).forEach(function (b) { lines.push(b.name + '   ID: ' + b.id); });
  console.log(lines.join('\n'));
}

/**
 * restoreCheck — что сделает восстановление по настройкам RESTORE. Ничего не меняет.
 * Отчёт: какие листы и сколько строк будут заменены, каких столбцов нет в копии или в таблице, какие переименования
 * учтены. Проверка действует RESTORE_CHECK_SECONDS — за это время можно запустить restoreApply.
 */
function restoreCheck() {
  const ss = spreadsheet_();
  const plan = restorePlan_(ss, RESTORE);
  CacheService.getScriptCache().put('restore-checked', JSON.stringify(RESTORE), RESTORE_CHECK_SECONDS);
  console.log(plan.report.concat(['', 'Если всё верно — запустите restoreApply (в течение ' +
    Math.round(RESTORE_CHECK_SECONDS / 60) + ' минут, не меняя RESTORE)']).join('\n'));
  return plan.report;
}

/**
 * restoreApply — восстановление по RESTORE. Только после restoreCheck с теми же настройками.
 *
 * Сначала — копия текущего состояния таблицы (с пометкой «перед восстановлением»): неудачное восстановление
 * откатывается ею же. Затем под блокировкой записи строки листов заменяются строками копии. Кэш листов сбрасывается,
 * память уведомлений восстановленных листов стирается — уведомлений о восстановленных статусах не будет.
 * Ход — в «_Журнал».
 */
function restoreApply() {
  const cache = CacheService.getScriptCache();
  if (cache.get('restore-checked') !== JSON.stringify(RESTORE)) {
    throw new Error('Сначала запустите restoreCheck с теми же настройками RESTORE и проверьте отчёт');
  }
  const ss = spreadsheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) throw new Error('Сервер занят запросами приложения — повторите через минуту');
  try {
    const plan = restorePlan_(ss, RESTORE);
    const before = makeBackup_(ss, 'перед восстановлением');
    plan.sheets.forEach(applySheetRestore_);
    SpreadsheetApp.flush();

    const names = plan.sheets.map(function (p) { return p.sheet.getName(); });
    names.forEach(forgetSheet_);
    invalidateSheets_(names.filter(function (name) { return APP_SHEETS.indexOf(name) !== -1; }));
    forgetNotifications_(names);
    cache.remove('restore-checked');
    log_(ss, 'Восстановление из копии', { id: '' }, {
      text: plan.report.join('\n') + '\nСостояние до восстановления сохранено: ' + before.getName() + ' (ID ' + before.getId() + ')',
    });
    console.log('Готово. Состояние до восстановления: ' + before.getName() + ' (ID ' + before.getId() + ')');
  } catch (err) {
    console.error('restoreApply: ' + err);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

// Копия таблицы в папку копий: новая таблица, в неё — копии всех листов под прежними названиями. label — пометка в имени
function makeBackup_(ss, label) {
  const folder = backupFolder_(ss);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const copy = SpreadsheetApp.create(ss.getName() + BACKUP_NAME_MARK + stamp + (label ? ' (' + label + ')' : ''));
  try {
    // У новой таблицы один пустой лист — удаляется после копирования (последний лист удалить нельзя), а названия
    // ставятся после его удаления (у копируемого листа может быть такое же название)
    const placeholder = copy.getSheets()[0];
    const copied = ss.getSheets().map(function (sheet) { return { name: sheet.getName(), sheet: sheet.copyTo(copy) }; });
    copy.deleteSheet(placeholder);
    copied.forEach(function (c) { c.sheet.setName(c.name); });
    const file = DriveApp.getFileById(copy.getId());
    file.setDescription('Резервная копия таблицы «' + ss.getName() + '» (ID ' + ss.getId() + ')');
    file.moveTo(folder);
    return file;
  } catch (err) {
    // Недоделанная копия не должна остаться в корне Диска и сойти за настоящую
    try {
      DriveApp.getFileById(copy.getId()).setTrashed(true);
    } catch (e) {
      console.error('Не удалось убрать недоделанную копию: ' + e);
    }
    throw err;
  }
}

// Папка копий; нет (не создана, удалена, нет доступа) — создаётся новая
function backupFolder_(ss) {
  const folder = existingBackupFolder_();
  if (folder) return folder;
  const created = DriveApp.createFolder('Резервные копии — ' + ss.getName());
  PropertiesService.getScriptProperties().setProperty(BACKUP_FOLDER_PROPERTY, created.getId());
  return created;
}

function existingBackupFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty(BACKUP_FOLDER_PROPERTY);
  if (!id) return null;
  try {
    const folder = DriveApp.getFolderById(id);
    return folder.isTrashed() ? null : folder;
  } catch (err) {
    return null;
  }
}

// Копии в папке, новые сверху: [{ id, name, created, file }]
function backupFiles_(folder) {
  const files = [];
  const iterator = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (iterator.hasNext()) {
    const file = iterator.next();
    if (file.getName().indexOf(BACKUP_NAME_MARK) === -1) continue;
    files.push({ id: file.getId(), name: file.getName(), created: file.getDateCreated(), file: file });
  }
  return files.sort(function (a, b) { return b.created - a.created; });
}

// Устаревшие копии — в корзину Диска. Возвращает их имена
function removeOldBackups_(folder) {
  return expiredBackups_(backupFiles_(folder), new Date()).map(function (b) {
    b.file.setTrashed(true);
    return b.name;
  });
}

// Какие копии устарели: младше BACKUP_KEEP_DAYS дней — нужны все; старше — только первая копия месяца,
// пока ей меньше BACKUP_KEEP_MONTHS месяцев. backups — [{ created }]
function expiredBackups_(backups, now) {
  const monthKey = function (date) { return date.getFullYear() * 12 + date.getMonth(); };
  const firstOfMonth = {};
  backups.forEach(function (b) {
    const key = monthKey(b.created);
    if (!firstOfMonth[key] || b.created < firstOfMonth[key].created) firstOfMonth[key] = b;
  });
  const keepAll = shiftDays_(now, -BACKUP_KEEP_DAYS);
  const keepMonthly = new Date(now.getFullYear(), now.getMonth() - BACKUP_KEEP_MONTHS, now.getDate());
  return backups.filter(function (b) {
    if (b.created >= keepAll) return false;
    return !(firstOfMonth[monthKey(b.created)] === b && b.created >= keepMonthly);
  });
}

// Строка отчёта checkSetup о копиях
function backupReport_() {
  const folder = existingBackupFolder_();
  if (!folder) return 'Резервные копии: ⚠ ещё не делались — запустите backupSpreadsheet';
  const files = backupFiles_(folder);
  if (!files.length) return 'Резервные копии: ⚠ в папке «' + folder.getName() + '» нет копий — запустите backupSpreadsheet';
  const latest = files[0].created;
  const stale = Date.now() - latest.getTime() > BACKUP_MAX_AGE_HOURS * 60 * 60 * 1000;
  return 'Резервные копии: ' + files.length + ' в папке «' + folder.getName() + '», последняя — ' +
    Utilities.formatDate(latest, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') +
    (stale ? ' ⚠ старше ' + BACKUP_MAX_AGE_HOURS + ' часов — проверьте триггер backupSpreadsheet и «Выполнения»' : '');
}

// Сбой копии — сообщение подтверждённым администраторам с ChatId. Ошибка отправки не скрывает исходную
function notifyAdminsBackupFailed_(ss, err) {
  try {
    if (!botToken_()) return;
    const admins = athletesTable_(ss).athletes.filter(function (a) {
      return a.isAdmin && a.status === ATHLETE_STATUS.confirmed && a.chatId;
    });
    const text = 'Резервная копия таблицы не сделана: ' + String((err && err.message) || err) +
      '\nПодробности — в «' + SHEET.log + '» и в редакторе Apps Script, раздел «Выполнения».';
    fetchAll_(admins.map(function (a) {
      const args = telegramRequestArgs_(a.chatId, text);
      args[1].url = args[0];
      return args[1];
    }));
  } catch (e) {
    console.error('Не удалось сообщить о сбое копии: ' + e);
  }
}

// План восстановления по настройкам options (как RESTORE): { sheets: [план листа], report: [строки отчёта] }.
// Ничего не меняет; ошибки настроек — исключением
function restorePlan_(ss, options) {
  const backupId = String(options.backupId || '').trim();
  if (!backupId) throw new Error('Не указан RESTORE.backupId — ID копии (см. listBackups)');
  if (backupId === ss.getId()) throw new Error('RESTORE.backupId — ID самой таблицы, а нужен ID копии');
  const wanted = options.sheets || [];
  const ids = (options.ids || []).map(function (id) { return String(id).trim(); }).filter(Boolean);
  if (ids.length && wanted.length !== 1) throw new Error('RESTORE.ids — только вместе с одним листом в RESTORE.sheets');

  const backup = SpreadsheetApp.openById(backupId);
  const sources = backup.getSheets().map(function (sheet) {
    const name = sheet.getName();
    return { sheet: sheet, name: name, target: RENAMED_SHEETS[name] || name };
  });
  const hasSource = function (name) { return sources.some(function (s) { return s.target === name; }); };
  wanted.forEach(function (name) {
    if (!hasSource(name)) throw new Error('В копии нет листа «' + name + '»');
    if (!ss.getSheetByName(name)) throw new Error('В таблице нет листа «' + name + '»');
  });

  const report = ['Копия: ' + backup.getName() + ' (ID ' + backupId + ')'];
  const plans = [];
  sources.forEach(function (source) {
    const chosen = wanted.length ? wanted.indexOf(source.target) !== -1 : source.target.charAt(0) !== '_';
    if (!chosen) return;
    const sheet = ss.getSheetByName(source.target);
    if (!sheet) {
      report.push('Лист «' + source.name + '» есть в копии, но нет в таблице — пропущен');
      return;
    }
    plans.push(sheetRestorePlan_(source, sheet, ids, report));
  });
  if (!wanted.length) {
    ss.getSheets().forEach(function (sheet) {
      const name = sheet.getName();
      if (name.charAt(0) !== '_' && !hasSource(name)) report.push('Лист «' + name + '» в копии нет — не трогается');
    });
  }
  return { sheets: plans, report: report };
}

// План одного листа: строки копии, переложенные в столбцы таблицы по заголовкам. Строки отчёта — в report
function sheetRestorePlan_(source, sheet, ids, report) {
  const range = source.sheet.getDataRange();
  const values = range.getValues();
  const formulas = range.getFormulas();
  const renames = RENAMED_COLUMNS[sheet.getName()] || {};
  const renamed = [];
  const sourceHeaders = (values[0] || []).map(function (h) {
    const header = String(h).trim();
    if (!renames[header]) return header;
    renamed.push('«' + header + '» → «' + renames[header] + '»');
    return renames[header];
  });
  const current = sheet.getDataRange().getValues();
  const headers = (current[0] || []).map(function (h) { return String(h).trim(); });
  const from = headers.map(function (h) { return h ? sourceHeaders.indexOf(h) : -1; });

  const title = 'Лист «' + sheet.getName() + '»' + (source.name !== sheet.getName() ? ' (в копии — «' + source.name + '»)' : '');
  if (!headers.length || from[0] === -1) {
    throw new Error(title + ': в копии нет первого столбца таблицы «' + (headers[0] || '') + '» — сопоставить строки нельзя');
  }
  const isEmpty = function (row) { return row.every(function (cell) { return String(cell).trim() === ''; }); };
  // Ячейка копии для записи: формула — формулой, текст, похожий на формулу, — текстом
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    if (isEmpty(values[r]) && formulas[r].every(function (f) { return !f; })) continue;
    if (ids.length && ids.indexOf(String(values[r][from[0]]).trim()) === -1) continue;
    rows.push(from.map(function (i) {
      if (i === -1) return '';
      return formulas[r][i] ? formulas[r][i] : safeCell_(values[r][i]);
    }));
  }

  const plan = { sheet: sheet, rows: rows, ids: ids };
  if (ids.length) {
    const found = rows.map(function (row) { return String(row[0]).trim(); });
    const existing = current.slice(1).filter(function (row) { return ids.indexOf(String(row[0]).trim()) !== -1; }).length;
    const missing = ids.filter(function (id) { return found.indexOf(id) === -1; });
    report.push(title + ': строк с «' + headers[0] + '» ' + ids.join(', ') + ' — в таблице ' + existing +
      ', будут заменены ' + rows.length + ' строками копии' + (missing.length ? '; в копии нет: ' + missing.join(', ') : ''));
  } else {
    const existing = current.slice(1).filter(function (row) { return !isEmpty(row); }).length;
    report.push(title + ': строк сейчас ' + existing + ' → будет ' + rows.length + ' из копии');
  }
  if (renamed.length) report.push('  переименования: ' + renamed.join(', '));
  const absent = headers.filter(function (h, j) { return h && from[j] === -1; });
  if (absent.length) report.push('  в копии нет столбцов: ' + absent.join(', ') + ' — у восстановленных строк будут пустыми');
  const dropped = sourceHeaders.filter(function (h) { return h && headers.indexOf(h) === -1; });
  if (dropped.length) report.push('  в таблице нет столбцов копии: ' + dropped.join(', ') + ' — их данные не восстанавливаются');
  return plan;
}

// Запись плана листа: целиком — строки данных очищаются и заменяются; по ids — заменяются только строки с этими ID
function applySheetRestore_(plan) {
  const sheet = plan.sheet;
  if (plan.ids.length) {
    const values = sheet.getDataRange().getValues();
    const rows = [];
    for (let r = 1; r < values.length; r++) {
      if (plan.ids.indexOf(String(values[r][0]).trim()) !== -1) rows.push(r + 1);
    }
    deleteRowNumbers_(sheet, rows);
    writeRows_(sheet, sheet.getLastRow() + 1, plan.rows);
    return;
  }
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clearContent();
  writeRows_(sheet, 2, plan.rows);
}

// Строки с row-й строки листа как есть (ячейки уже подготовлены: формулы — формулами, остальное — через safeCell_).
// Строк в сетке не хватает — добавляются
function writeRows_(sheet, row, rows) {
  if (!rows.length) return;
  const missing = row + rows.length - 1 - sheet.getMaxRows();
  if (missing > 0) sheet.insertRowsAfter(sheet.getMaxRows(), missing);
  sheet.getRange(row, 1, rows.length, rows[0].length).setValues(rows);
}

// Память уведомлений (notifyStatusChanges_) листов стирается: следующая правка запомнит текущие статусы без сообщений
function forgetNotifications_(sheetNames) {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(function (key) {
    const forget = sheetNames.some(function (name) {
      return key.indexOf(notifiedKey_(name, '')) === 0 || key === 'notified-seeded:' + name;
    });
    if (forget) props.deleteProperty(key);
  });
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
    logQuotaError_(err, 'Правка таблицы');
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
// Под блокировкой: два быстрых срабатывания триггера подряд иначе оба увидели бы пустую отметку. Блокировка — таблицы,
// а не скрипта: рассылка всем перевозчикам идёт долго, и запросы приложения (doPost) не должны её ждать
function notifyNewCompetitions_(ss, range) {
  notifyNewCompetitionsWhere_(ss, function (row) { return rowInRange_(range, row.row); });
}

// Рассылка о новых соревнованиях среди строк, для которых isCandidate(row) — true (строка из readTable_).
// Возвращает, о скольких соревнованиях разослано. Вызывается и триггером, и после сохранения соревнования из приложения
function notifyNewCompetitionsWhere_(ss, isCandidate) {
  let sent = 0;
  const lock = LockService.getDocumentLock() || LockService.getScriptLock();
  if (!lock.tryLock(20000)) return 0; // не дождались — строку подхватит следующая правка
  try {
    const competitions = readTable_(ss, SHEET.competitions);
    if (competitions.headers.indexOf(COMPETITION_COLUMN.notified) === -1) return 0;
    const notifiedCol = competitions.col(COMPETITION_COLUMN.notified) + 1;

    const ready = competitions.rows.filter(function (row) {
      if (!isCandidate(row)) return false;
      if (String(competitions.get(row, COMPETITION_COLUMN.notified)).trim() !== '') return false;
      const filled = NEW_COMPETITION_REQUIRED.every(function (column) {
        return String(competitions.get(row, column)).trim() !== '';
      });
      return filled && isUpcoming_(competitions.get(row, COMPETITION_COLUMN.start));
    });
    if (!ready.length) return 0;

    const allCarriers = athletesTable_(ss).athletes.filter(function (a) {
      return a.status === ATHLETE_STATUS.confirmed && a.isCarrier && a.chatId;
    });
    // Отключившие рассылку в профиле — не получают
    const carriers = allCarriers.filter(function (a) { return a.wantsCompetitions; });
    const optedOut = allCarriers.length - carriers.length;
    ready.forEach(function (row) {
      const text = competitionMessage_(competitions, row);
      // Кнопка ведёт сразу в мастер заявки на этом соревновании
      const button = { text: 'Подать заявку', params: { page: 'application-form', competition: String(row.values[0]).trim() } };
      const responses = fetchAll_(carriers.map(function (a) {
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
      sent++;
      const title = String(competitions.get(row, COMPETITION_COLUMN.title)).trim();
      log_(ss, 'Рассылка: новое соревнование', { id: '' }, {
        text: title + ' — отправлено ' + (carriers.length - failed.length) + ' из ' + carriers.length + ' перевозчикам' +
          (optedOut ? ' (ещё ' + optedOut + ' отключили рассылку)' : '') +
          (failed.length ? '. Не доставлено: ' + failed.join('; ') : ''),
      });
    });
  } finally {
    lock.releaseLock();
  }
  return sent;
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
  if (!columnInRange_(range, table.col(ATHLETE_COLUMN.status) + 1)) return;

  const items = table.athletes.map(function (athlete) {
    return { id: athlete.id, row: athlete.row, status: athlete.status, athlete: athlete };
  });
  notifyStatusChanges_(SHEET.athletes, items, range, [ATHLETE_STATUS.confirmed], function (item) {
    sendAccessConfirmed_(ss, item.athlete);
  });
}

function sendAccessConfirmed_(ss, athlete) {
  if (!athlete.chatId) return;
  notify_(ss, athlete, 'Здравствуйте, ' + athlete.greetingName + '! Ваш доступ к приложению подтверждён.',
    'Уведомление: доступ подтверждён');
}

function notifyApplicationStatus_(ss, range) {
  const applications = readTable_(ss, SHEET.applications);
  if (!columnInRange_(range, applications.col(APPLICATION_COLUMN.status) + 1)) return;
  const athletes = athletesTable_(ss);

  const items = applications.rows.map(function (row) {
    return { id: String(row.values[0]).trim(), row: row.row, status: String(applications.get(row, APPLICATION_COLUMN.status)).trim(), source: row };
  });
  notifyStatusChanges_(SHEET.applications, items, range, NOTIFY_APPLICATION_STATUSES, function (item) {
    sendApplicationStatus_(ss, athletes, applications.headers, item.source.values);
  });
}

// Смена статуса заявки из приложения (администратором). Записи скрипта не запускают onSheetEdit, поэтому
// сообщение автору отправляется здесь — с той же памятью «о каком статусе уже сообщено», что и у триггера:
// если потом тот же статус вставят в таблице вручную, второго сообщения не будет
function notifyApplicationStatusNow_(ss, headers, values) {
  const status = String(values[headers.indexOf(APPLICATION_COLUMN.status)]).trim();
  if (notifyStatusNow_(SHEET.applications, String(values[0]).trim(), status, NOTIFY_APPLICATION_STATUSES)) {
    sendApplicationStatus_(ss, athletesTable_(ss), headers, values);
  }
}

// Память «о каком статусе строки уже сообщено» (как у notifyStatusChanges_) для записи из приложения: true — статус
// новый и о нём нужно сообщить (память уже обновлена); статус не из notifyStatuses — память строки стирается
function notifyStatusNow_(sheetName, id, status, notifyStatuses) {
  const props = PropertiesService.getScriptProperties();
  const key = notifiedKey_(sheetName, id);
  if (notifyStatuses.indexOf(status) === -1) {
    props.deleteProperty(key);
    return false;
  }
  if (props.getProperty(key) === status) return false;
  props.setProperty(key, status);
  return true;
}

// Сообщение автору заявки о её статусе (если автор не отключил такие сообщения). У «Отклонена» — с причиной
function sendApplicationStatus_(ss, athletes, headers, values) {
  const value = function (column) {
    const i = headers.indexOf(column);
    return i === -1 ? '' : String(values[i]).trim();
  };
  const number = String(values[0]).trim();
  const status = value(APPLICATION_COLUMN.status);
  const authorId = value(APPLICATION_COLUMN.createdBy);
  const author = findAthlete_(athletes, function (a) { return a.id === authorId; });
  if (!author || !author.chatId || !author.wantsApplications) return;

  const title = value(APPLICATION_COLUMN.competitionTitle);
  const reason = status === APPLICATION_STATUS.rejected ? value(APPLICATION_COLUMN.rejectReason) : '';
  notify_(ss, author, 'Заявка № ' + number + (title ? ' (' + title + ')' : '') + ': статус изменён на «' + status + '».' +
    (reason ? '\nПричина: ' + reason : ''),
  'Уведомление: заявка № ' + number + ' — ' + status);
}

// Уведомления о смене статуса строк. Правка диапазоном (вставка, протягивание) не сообщает прежних значений, поэтому
// скрипт помнит, о каком статусе каждой строки уже сообщил (свойство скрипта notified:<лист>:<ID>), и пишет только
// при новом статусе: повторная вставка того же статуса сообщений не шлёт. Статус сменили на тот, о котором не сообщаем, —
// память строки стирается, и если статус вернут, сообщение уйдёт снова.
// items — [{ id, row, status }] всех строк листа; notifyStatuses — о каких статусах сообщать; send(item) — отправка
function notifyStatusChanges_(sheetName, items, range, notifyStatuses, send) {
  const props = PropertiesService.getScriptProperties();
  const known = props.getProperties();
  const present = {};
  items.forEach(function (item) { if (item.id) present[notifiedKey_(sheetName, item.id)] = true; });
  // Строки, которых на листе больше нет (удалены, перенесены в архив), забываем — память не растёт
  Object.keys(known).forEach(function (key) {
    if (key.indexOf(notifiedKey_(sheetName, '')) === 0 && !present[key]) props.deleteProperty(key);
  });

  // Первый запуск: о строках, которые уже были в таком статусе, сообщать не нужно — запоминаем их без сообщений.
  // Кроме строки, где только что сменили статус одной ячейкой: это настоящая смена
  const seededKey = 'notified-seeded:' + sheetName;
  const singleCell = range.getNumRows() === 1 && range.getNumColumns() === 1;
  if (!known[seededKey]) {
    const seed = {};
    items.forEach(function (item) {
      if (!item.id || notifyStatuses.indexOf(item.status) === -1) return;
      if (singleCell && item.row === range.getRow()) return;
      seed[notifiedKey_(sheetName, item.id)] = item.status;
    });
    seed[seededKey] = new Date().toISOString();
    props.setProperties(seed);
    Object.keys(seed).forEach(function (key) { known[key] = seed[key]; });
  }

  items.forEach(function (item) {
    if (!item.id || !rowInRange_(range, item.row)) return;
    const key = notifiedKey_(sheetName, item.id);
    if (notifyStatuses.indexOf(item.status) === -1) {
      if (known[key]) props.deleteProperty(key);
      return;
    }
    if (known[key] === item.status) return;
    props.setProperty(key, item.status);
    send(item);
  });
}

function notifiedKey_(sheetName, id) {
  return 'notified:' + sheetName + ':' + id;
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
  return telegramError_(fetch_.apply(null, telegramRequestArgs_(chatId, text)));
}

// Запрос sendMessage с кнопкой, открывающей приложение (если задан MINI_APP_URL): [адрес, параметры] для UrlFetchApp.
// button — { text, params }: надпись и параметры адреса приложения (например, { page, competition });
// по умолчанию «Открыть приложение» на стартовой странице
function telegramRequestArgs_(chatId, text, button) {
  const message = { chat_id: chatId, text: text };
  const appUrl = miniAppUrl_();
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
    sheet.appendRow(safeRow_(row));
  } catch (err) {
    console.error('Не удалось записать в лист ' + SHEET.log + ': ' + err);
  }
}

// ---------- Лимиты Google ----------
// Сколько дневного лимита израсходовано, Google не сообщает — только ошибка, когда лимит кончился. Поэтому:
//  - ошибка лимита пишется в «_Журнал» событием «Лимит Google исчерпан» (одна и та же — не чаще раза в LIMIT_LOG_SECONDS);
//  - запросы к Telegram (UrlFetch — самый расходуемый лимит) скрипт считает сам и при долях URLFETCH_WARN_SHARES
//    лимита пишет «Лимит близко»;
//  - checkSetup показывает запас по объёмам: свойства скрипта, копии листов для кэша, ячейки таблицы.
// Дневные лимиты — на аккаунт владельца скрипта и общие для всех его скриптов (тестовое окружение, другие триггеры
// таблицы), а счётчик видит только свои запросы — это ранний сигнал, а не точный остаток.
// Сообщением Telegram о лимите не предупредить: при исчерпанном UrlFetch бот тоже не может писать

// Значения — для обычного аккаунта Google; у Google Workspace больше (UrlFetch — 100 000 в сутки) — поменяйте
const URLFETCH_DAILY_LIMIT = 20000;
const PROPERTIES_MAX_BYTES = 500 * 1024;
const SPREADSHEET_MAX_CELLS = 10000000;
// Доли дневного лимита запросов, при которых в «_Журнал» пишется «Лимит близко» (каждая — раз в сутки)
const URLFETCH_WARN_SHARES = [0.7, 0.9];
// В отчёте checkSetup — ⚠ у занятого больше этой доли
const LIMIT_WARN_SHARE = 0.7;
const LIMIT_LOG_SECONDS = 60 * 60;
// Дольше CacheService не хранит. Счётчик перезаписывается при каждом запросе; если запросов не было 6 часов, он
// обнуляется — при таком редком расходе лимит не под угрозой
const CACHE_MAX_SECONDS = 6 * 60 * 60;

// Тексты ошибок Google об исчерпании лимитов (на английском и русском — зависит от языка аккаунта)
const QUOTA_ERROR_PATTERN = /too many times|too much computer time|quota|limit exceeded|слишком много раз|слишком много времени|квот|превышен лимит/i;

function isQuotaError_(err) {
  return QUOTA_ERROR_PATTERN.test(String((err && err.message) || err));
}

// Ошибка лимита — в «_Журнал» (where — где случилась). Прочие ошибки не трогает
function logQuotaError_(err, where) {
  if (!isQuotaError_(err)) return;
  try {
    const text = String((err && err.message) || err);
    const cache = CacheService.getScriptCache();
    const key = 'quota-error:' + text.slice(0, 80);
    if (cache.get(key)) return;
    cache.put(key, '1', LIMIT_LOG_SECONDS);
    log_(spreadsheet_(), 'Лимит Google исчерпан', { id: '' }, {
      text: where + ': ' + text + '. Лимиты — на аккаунт владельца скрипта, обновляются в течение суток. ' +
        'Подробности — в редакторе Apps Script, раздел «Выполнения»',
    });
  } catch (e) {
    console.error('Не удалось записать ошибку лимита: ' + e);
  }
}

// Запросы во внешний мир (Telegram) — только через эти обёртки, чтобы их считал countFetches_
function fetch_(url, options) {
  countFetches_(1);
  return UrlFetchApp.fetch(url, options);
}

function fetchAll_(requests) {
  countFetches_(requests.length);
  return UrlFetchApp.fetchAll(requests);
}

// Ключ счётчика запросов за сутки (по часовому поясу скрипта; у Google окно — скользящие 24 часа, это приближение)
function fetchCountKey_() {
  return 'urlfetch:' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Запросов за сегодня по счётчику скрипта
function fetchCount_() {
  return Number(CacheService.getScriptCache().get(fetchCountKey_())) || 0;
}

// +n запросов к счётчику; перешли долю из URLFETCH_WARN_SHARES — «Лимит близко» в «_Журнал». Счёт приблизительный:
// параллельные вызовы могут потерять прибавку друг друга. Ошибка счётчика запрос не ломает
function countFetches_(n) {
  if (!n) return;
  try {
    const cache = CacheService.getScriptCache();
    const key = fetchCountKey_();
    const before = Number(cache.get(key)) || 0;
    const after = before + n;
    cache.put(key, String(after), CACHE_MAX_SECONDS);
    URLFETCH_WARN_SHARES.forEach(function (share) {
      const level = Math.floor(URLFETCH_DAILY_LIMIT * share);
      if (before >= level || after < level) return;
      log_(spreadsheet_(), 'Лимит близко', { id: '' }, {
        text: 'Запросов к Telegram за сегодня: ' + after + ' из ' + URLFETCH_DAILY_LIMIT + ' (' + Math.round(share * 100) +
          '%) — по счётчику этого скрипта; другие скрипты аккаунта расходуют тот же лимит. Когда он кончится, ' +
          'перестанут уходить уведомления и рассылки',
      });
    });
  } catch (err) {
    console.error('Счётчик запросов: ' + err);
  }
}

// Строки отчёта о запасе по лимитам для checkSetup
function limitsReport_(ss) {
  const share = function (used, limit) {
    const percent = Math.round((used / limit) * 100);
    return (used / limit > LIMIT_WARN_SHARE ? '⚠ ' : '') + used + ' из ' + limit + ' (' + percent + '%)';
  };
  const lines = [];
  lines.push('Запросы к Telegram за сегодня (счётчик скрипта): ' + share(fetchCount_(), URLFETCH_DAILY_LIMIT));

  const props = PropertiesService.getScriptProperties().getProperties();
  const keys = Object.keys(props);
  const bytes = Utilities.newBlob(keys.map(function (k) { return k + props[k]; }).join('')).getBytes().length;
  const notified = keys.filter(function (k) { return k.indexOf('notified:') === 0; }).length;
  lines.push('Свойства скрипта, байт: ' + share(bytes, PROPERTIES_MAX_BYTES) + '; из них памяти уведомлений — ' + notified + ' строк');

  // Лист больше предела в кэш не кладётся и читается из таблицы при каждой загрузке приложения
  APP_SHEETS.forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const chars = sheetCacheJson_(trimEmptyColumns_(sheet.getDataRange().getValues())).length;
    lines.push('Лист «' + name + '» для кэша, символов: ' + share(chars, SHEET_CACHE_MAX_CHARS) +
      (chars > SHEET_CACHE_MAX_CHARS ? ' — не помещается, читается из таблицы при каждой загрузке' : ''));
  });

  // В лимит таблицы входят все ячейки сетки, и пустые тоже
  const cells = ss.getSheets().reduce(function (sum, sheet) { return sum + sheet.getMaxRows() * sheet.getMaxColumns(); }, 0);
  lines.push('Ячеек в таблице (с пустыми): ' + share(cells, SPREADSHEET_MAX_CELLS));
  return lines;
}

// ---------- Утилиты ----------

// Текст, который Google Таблицы приняли бы за формулу (начинается с =, +, -, @), записывается как текст —
// с апострофом впереди, как при ручном вводе; в ячейке он виден без апострофа. Иначе через ФИО в заявке на доступ
// или имя в профиле Telegram (оно попадает в «_Журнал») можно подставить в таблицу формулу — например, IMPORTXML,
// которая при открытии таблицы отправит данные листов на чужой сервер. Применяется ко всему, что скрипт пишет в листы
function safeCell_(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
}

function safeRow_(row) {
  return row.map(safeCell_);
}

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

// Дата из ячейки: ячейка с типом «дата» или текст «дд.мм.гггг[ чч:мм[:сс]]» (в часовом поясе скрипта); иначе null.
// Тот же формат разбирает приложение (toDate в src/data/model.js)
function sheetDate_(value) {
  if (value instanceof Date) return value;
  const m = String(value || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const date = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
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
