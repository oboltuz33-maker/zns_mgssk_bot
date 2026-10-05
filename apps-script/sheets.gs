/**
 * Отдаёт все листы таблицы одним запросом — Mini App загружает их целиком
 * и фильтрует у себя, чтобы не расходовать лимиты Apps Script на каждый поиск.
 *
 * GET <URL веб-приложения>?action=sheets            — все листы
 * GET <URL веб-приложения>?action=sheets&names=A,B  — только листы A и B
 *
 * Первая строка листа — заголовки столбцов. Листы, имя которых начинается с "_",
 * не отдаются (служебные/закрытые данные).
 *
 * Если в проекте уже есть свой doGet — перенесите в него ветку action === 'sheets'.
 * Существующий doPost не трогается.
 */

// Если скрипт не привязан к таблице, укажите её ID (из адреса таблицы)
const SPREADSHEET_ID = '';

function doGet(e) {
  const params = (e && e.parameter) || {};
  try {
    if (params.action === 'sheets') {
      return json_(readSheets_(params.names));
    }
    return json_({ status: 'error', message: 'Неизвестное действие: ' + params.action });
  } catch (err) {
    return json_({ status: 'error', message: String(err) });
  }
}

function readSheets_(names) {
  const ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  const wanted = names ? names.split(',').map(function (n) { return n.trim(); }) : null;
  const sheets = {};

  ss.getSheets().forEach(function (sheet) {
    const name = sheet.getName();
    if (name.charAt(0) === '_') return;
    if (wanted && wanted.indexOf(name) === -1) return;

    // Один вызов getValues на лист — самый дешёвый способ чтения
    const values = sheet.getDataRange().getValues();
    const headers = (values.shift() || []).map(String);
    const rows = values.filter(function (row) {
      return row.some(function (cell) { return cell !== ''; });
    });
    sheets[name] = { headers: headers, rows: rows };
  });

  return { status: 'success', updatedAt: new Date().toISOString(), sheets: sheets };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
