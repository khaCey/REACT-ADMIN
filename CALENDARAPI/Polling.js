/**
 * Polling.js — Serves MonthlySchedule data to the react-app client (GET with key + full).
 * Config (ADMIN_SS_ID, POLL_API_KEY, etc.) in Config.js.
 * Fallback if Config not loaded.
 */
var _ADMIN_SS_ID = '1upKC-iNWs7HIeKiVVAegve5O5WbNebbjMlveMcvnuow';
var _SCHEDULE_CACHE_STATE_SHEET = 'ScheduleCacheState';

function getScheduleCacheState() {
  var adminId = (typeof ADMIN_SS_ID !== 'undefined' && ADMIN_SS_ID) ? ADMIN_SS_ID : _ADMIN_SS_ID;
  var sheetName = (typeof SCHEDULE_CACHE_STATE_SHEET !== 'undefined' && SCHEDULE_CACHE_STATE_SHEET) ? SCHEDULE_CACHE_STATE_SHEET : _SCHEDULE_CACHE_STATE_SHEET;
  var ss = SpreadsheetApp.openById(adminId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, 2).setValues([['cacheVersion', 'lastUpdated']]);
    sheet.getRange(2, 1).setValue(0);
    sheet.getRange(2, 2).setValue(new Date().toISOString());
  }
  var version = sheet.getRange(2, 1).getValue();
  var updated = sheet.getRange(2, 2).getValue();
  return {
    cacheVersion: typeof version === 'number' ? version : 0,
    lastUpdated: updated ? new Date(updated).toISOString() : new Date().toISOString()
  };
}

/**
 * Bump cache version and lastUpdated in ScheduleCacheState. Call after writing MonthlySchedule/NextMonthSchedule.
 */
function bumpScheduleCacheVersion() {
  var adminId = (typeof ADMIN_SS_ID !== 'undefined' && ADMIN_SS_ID) ? ADMIN_SS_ID : _ADMIN_SS_ID;
  var sheetName = (typeof SCHEDULE_CACHE_STATE_SHEET !== 'undefined' && SCHEDULE_CACHE_STATE_SHEET) ? SCHEDULE_CACHE_STATE_SHEET : _SCHEDULE_CACHE_STATE_SHEET;
  var ss = SpreadsheetApp.openById(adminId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, 2).setValues([['cacheVersion', 'lastUpdated']]);
  }
  var current = sheet.getRange(2, 1).getValue();
  var next = (typeof current === 'number' ? current : 0) + 1;
  sheet.getRange(2, 1).setValue(next);
  sheet.getRange(2, 2).setValue(new Date().toISOString());
}

/**
 * Read MonthlySchedule and NextMonthSchedule sheets and return rows in react-app format.
 * Column order: EventID, Title, Date, Start, End, Status, StudentName, IsKidsLesson, TeacherName
 * @returns {Array<{eventID: string, title: string, date: string, start: string, end: string, status: string, studentName: string, isKidsLesson: boolean|string, teacherName: string}>}
 */
function readScheduleSheetsForPolling() {
  var adminId = (typeof ADMIN_SS_ID !== 'undefined' && ADMIN_SS_ID) ? ADMIN_SS_ID : _ADMIN_SS_ID;
  var ss = SpreadsheetApp.openById(adminId);
  var tz = Session.getScriptTimeZone();
  var out = [];

  ['MonthlySchedule'].forEach(function (sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    var headers = data[0].map(function (h) { return String(h || '').trim(); });
    var idx = {
      eventID: headers.indexOf('EventID'),
      title: headers.indexOf('Title'),
      date: headers.indexOf('Date'),
      start: headers.indexOf('Start'),
      end: headers.indexOf('End'),
      status: headers.indexOf('Status'),
      studentName: headers.indexOf('StudentName'),
      isKidsLesson: headers.indexOf('IsKidsLesson'),
      teacherName: headers.indexOf('TeacherName')
    };
    if (idx.eventID < 0 || idx.studentName < 0) return;
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var eventId = row[idx.eventID] != null ? String(row[idx.eventID]).trim() : '';
      var studentName = row[idx.studentName] != null ? String(row[idx.studentName]).trim() : '';
      if (!eventId || !studentName) continue;
      var dateVal = row[idx.date];
      var dateStr = '';
      if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
        dateStr = Utilities.formatDate(dateVal, tz, 'yyyy-MM-dd');
      } else if (dateVal) {
        dateStr = String(dateVal).trim();
        if (dateStr.length >= 10) dateStr = dateStr.substring(0, 10);
      }
      var startVal = row[idx.start];
      var startStr = '';
      if (startVal instanceof Date && !isNaN(startVal.getTime())) {
        startStr = Utilities.formatDate(startVal, tz, "yyyy-MM-dd HH:mm");
      } else if (startVal) {
        startStr = String(startVal).trim();
      }
      var endVal = row[idx.end];
      var endStr = '';
      if (endVal instanceof Date && !isNaN(endVal.getTime())) {
        endStr = Utilities.formatDate(endVal, tz, "yyyy-MM-dd HH:mm");
      } else if (endVal) {
        endStr = String(endVal).trim();
      }
      var isKids = row[idx.isKidsLesson];
      var isKidsOut = (isKids === '子' || isKids === true || String(isKids).toLowerCase() === 'true');
      out.push({
        eventID: eventId,
        title: row[idx.title] != null ? String(row[idx.title]).trim() : '',
        date: dateStr,
        start: startStr,
        end: endStr,
        status: row[idx.status] != null ? String(row[idx.status]).trim() || 'scheduled' : 'scheduled',
        studentName: studentName,
        isKidsLesson: isKidsOut,
        teacherName: row[idx.teacherName] != null ? String(row[idx.teacherName]).trim() : ''
      });
    }
  });

  return out;
}

/**
 * Get full polling payload: schedule rows plus cacheVersion and lastUpdated.
 * @returns {{ data: Array, cacheVersion: number, lastUpdated: string }}
 */
function getScheduleDataForPolling() {
  var state = getScheduleCacheState();
  var data = readScheduleSheetsForPolling();
  return {
    data: data,
    cacheVersion: state.cacheVersion,
    lastUpdated: state.lastUpdated
  };
}
