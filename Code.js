const SS_ID = "1IobCrDaNAPquEX0WKR8fLyh0p-Q9XutIdHHuu_3XXEg";
const STUDENTLIST = SpreadsheetApp.openById(SS_ID);
const CALENDAR_ID = 'greensquare.jp_h8u0oufn8feana384v67o46o78@group.calendar.google.com';
const DEMO_CALENDAR_ID = 'greensquare.jp_1m1bhvfu9mtts7gq9s9jsj9kbk@group.calendar.google.com';
const OWNER_CALENDAR_ID = 'c_403306dccf2039f61a620a4cfc22424c5a6f79e945054e57f30ecc50c90b9207@group.calendar.google.com';

const APPSTATE_SHEET_NAME = 'AppState';

/**
 * Returns the AppState sheet, creating it with headers and initial cacheVersion if it doesn't exist.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss - The spreadsheet (e.g. getActiveSpreadsheet()).
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateAppStateSheet(ss) {
  let sheet = ss.getSheetByName(APPSTATE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(APPSTATE_SHEET_NAME);
    sheet.getRange(1, 1, 1, 2).setValues([['cacheVersion', 'lastUpdated']]);
    sheet.getRange(2, 1).setValue(0);
  }
  return sheet;
}

/** Web app entry point */
function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('Index')
    .setTitle("Today's Lessons");
}

/**
 * Returns every row of your EventCache sheet,
 * converting Date objects in the "Start" and "End"
 * columns into "HH:mm" strings in your script's timezone.
 */
function getEventsJson() {
  const SHEET_NAME     = 'lessons_today';
  const tz             = Session.getScriptTimeZone();
  // Open and read the sheet
  
  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  const data  = sheet.getDataRange().getValues();
  if (data.length < 2) return '[]';         // no rows → empty array

  const headers = data.shift();              // remove header row
  const rows = data.map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let v = row[i];
      // If this column is Start or End and v is a Date, format as "HH:mm"
      if ((h === 'Start' || h === 'End') && v instanceof Date) {
        v = Utilities.formatDate(v, tz, 'HH:mm');
      }
      obj[h] = v;
    });
    return obj;
  });

  Logger.log(`getEventsJson() → ${rows.length} rows`);
  return JSON.stringify(rows);
}

/**
 * Returns the current cache version for client polling. Creates the AppState sheet if it doesn't exist.
 * @returns {{ version: number }}
 */
function getCacheVersion() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateAppStateSheet(ss);
  const version = sheet.getRange(2, 1).getValue();
  return { version: typeof version === 'number' ? version : 0 };
}

/**
 * Computes a fingerprint of lessons_today for change detection.
 * Uses all column values so any change to the cached data bumps the version.
 * @returns {string}
 */
function getLessonsTodayFingerprint() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('lessons_today');
  if (!sheet) return '';
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return '';
  const rows = data.slice(1);
  const parts = rows
    .map(r => r.map(cell => String(cell ?? '').trim()).join('|'))
    .sort();
  return parts.join(',');
}

/**
 * Scheduled job: refreshes lessons from Calendar, compares before/after, bumps cache version if changed.
 * Run this every 15 minutes via a time-driven trigger. Use createScheduledLessonCacheTrigger() once to set up.
 */
function scheduledLessonCacheUpdate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let beforeFingerprint = '';
  try {
    beforeFingerprint = getLessonsTodayFingerprint();
  } catch (e) {
    Logger.log('No lessons_today yet, fingerprint empty: ' + e);
  }
  fetchAndCacheTodayLessons();
  const afterFingerprint = getLessonsTodayFingerprint();
  if (beforeFingerprint !== afterFingerprint) {
    const appState = getOrCreateAppStateSheet(ss);
    const current = appState.getRange(2, 1).getValue();
    const next = (typeof current === 'number' ? current : 0) + 1;
    appState.getRange(2, 1).setValue(next);
    appState.getRange(2, 2).setValue(new Date().toISOString());
    Logger.log('Cache changed, bumped version to ' + next);
  }
}

/**
 * Run this ONCE from the script editor to create a 15-minute trigger for scheduledLessonCacheUpdate.
 * (Triggers > Add trigger > or run this function manually)
 */
function createScheduledLessonCacheTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'scheduledLessonCacheUpdate') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('scheduledLessonCacheUpdate')
    .timeBased()
    .everyMinutes(15)
    .create();
  Logger.log('Created 15-minute trigger for scheduledLessonCacheUpdate');
}

/**
 * Returns an array of { eventID, pdfUpload, lessonHistory, folderName } 
 * for every row in the `lessons_today` sheet.
 */
function getLessonsTodayStatuses() {
  const SHEET_NAME = 'lessons_today';
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found.`);
  
  // Read all data
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];  // no data
  
  // First row = headers
  const headers = data.shift().map(h => h.toString().trim());
  const idxID   = headers.indexOf('eventID');
  const idxPDF  = headers.indexOf('pdfUpload');
  const idxLH   = headers.indexOf('lessonHistory');
  const idxFolder = headers.indexOf('folderName');
  if (idxID < 0 || idxPDF < 0 || idxLH < 0) {
    throw new Error('Missing one of eventID, pdfUpload or lessonHistory headers.');
  }
  
  // Build and return status objects
  return data.map(row => {
    // normalise any case or boolean
    const pdf = String(row[idxPDF]).toLowerCase() === 'true';
    const lh  = String(row[idxLH]).toLowerCase()  === 'true';
    return {
      eventID:       String(row[idxID]),
      pdfUpload:     pdf,
      lessonHistory: lh,
      folderName:    idxFolder >= 0 ? String(row[idxFolder] || '') : ''
    };
  });
}

/**
 * Marks the given event row in `lessons_today` as having had its PDF uploaded.
 */
function markPdfUploaded(eventID, flag) {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const sht  = ss.getSheetByName('lessons_today');
  const data = sht.getDataRange().getValues();
  const hdrs = data.shift();

  // find the row matching eventID
  for (let r = 0; r < data.length; r++) {
    if (data[r][ hdrs.indexOf('eventID') ] === eventID) {
      sht.getRange(r+2, hdrs.indexOf('pdfUpload')+1)
         .setValue(flag ? 'TRUE' : 'FALSE');
      return { success: true };
    }
  }
  throw new Error("EventID not found in lessons_today: " + eventID);
}

/**
 * Marks the given event row in `lessons_today` as having had its lesson history recorded.
 */
function markLessonHistory(eventID, flag) {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const sht  = ss.getSheetByName('lessons_today');
  const data = sht.getDataRange().getValues();
  const hdrs = data.shift();

  // find the row matching eventID
  for (let r = 0; r < data.length; r++) {
    if (data[r][ hdrs.indexOf('eventID') ] === eventID) {
      sht.getRange(r+2, hdrs.indexOf('lessonHistory')+1)
         .setValue(flag ? 'TRUE' : 'FALSE');
      return { success: true };
    }
  }
  throw new Error("EventID not found in lessons_today: " + eventID);
}

/**
 * Returns lesson status from calendar event color (cancelled/rescheduled) or null for normal lessons.
 * Graphite (8) = cancelled; Lavender (9), Banana (5) = rescheduled.
 * @param {CalendarEvent} event - Calendar event object
 * @returns {'cancelled'|'rescheduled'|null}
 */
function getLessonStatus_(event) {
  var color = event.getColor();
  if (color === '8') return 'cancelled';
  if (color === '9' || color === '5') return 'rescheduled';
  return null;
}

/**
 * Returns location/lesson status for display: cafe, online, or regular (for normal lessons only).
 * @param {string} title - Event title
 * @returns {string}
 */
function getLessonLocationStatus_(title) {
  if (/\(\s*Cafe\s*\)/i.test(title)) return 'cafe';
  if (/\(\s*Online\s*\)/i.test(title)) return 'online';
  return 'regular';
}

/**
 * Fetches all lesson & demo events for today (or a specific date) from the two specified calendars,
 * preserves any existing pdfUpload and lessonHistory flags, and writes the combined results into 'lessons_today'.
 *
 * Task List:
 * 1. Read existing pdfUpload & lessonHistory statuses from the current 'lessons_today' sheet.
 * 2. Determine the target date (today or dateOverride).
 * 3. Fetch events for that date from both CALENDAR_ID and DEMO_CALENDAR_ID.
 * 4. Build a flat list of student occurrences (one per student per event).
 * 5. Group the flat list by eventID, accumulating multiple studentNames.
 * 6. Merge old statuses (pdfUpload, lessonHistory) back into each grouped lesson.
 * 7. Clear and overwrite the 'lessons_today' sheet with the merged data.
 *
 * @param {string=} dateOverride Optional "DD/MM/YYYY" string to fetch for a specific day.
 * @returns {Array<Object>}      Array of grouped lesson objects written to sheet.
 */
function fetchAndCacheTodayLessons(dateOverride) {
  Logger.log('--- fetchAndCacheTodayLessons START ---');
  Logger.log('dateOverride value: %s, type: %s', dateOverride, typeof dateOverride);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = Session.getScriptTimeZone();

  // Fingerprint before we change the sheet (for cache version bump)
  let beforeFingerprint = '';
  try {
    beforeFingerprint = getLessonsTodayFingerprint();
  } catch (e) {
    Logger.log('No lessons_today yet, fingerprint empty: ' + e);
  }

  // Penultimate lesson = evaluation due when AppState B5 is TRUE (title x/y with y-x===1)
  let penultimateEvalDue = false;
  try {
    const appStateSheet = getOrCreateAppStateSheet(ss);
    const b5 = appStateSheet.getRange(5, 2).getValue();
    penultimateEvalDue = (b5 === true || String(b5).toLowerCase() === 'true');
  } catch (e) {
    Logger.log('AppState B5 not set or error: ' + e);
  }

  // 1) Read existing statuses (pdfUpload & lessonHistory) from 'lessons_today' sheet
  const oldStatusMap = {};
  try {
    const existingStatuses = getLessonsTodayStatuses();
    existingStatuses.forEach(status => {
      oldStatusMap[status.eventID] = {
        pdfUpload: status.pdfUpload,
        lessonHistory: status.lessonHistory,
        folderName: status.folderName // Preserve folderName
      };
    });
    Logger.log('Loaded %s existing statuses', existingStatuses.length);
  } catch (err) {
    Logger.log('No existing statuses or error: %s', err);
  }

  // 2) Determine target date (today or dateOverride)
  let targetDate;
  if (typeof dateOverride === 'string' && dateOverride.includes('/')) {
    Logger.log('Parsing dateOverride as string in DD/MM/YYYY format');
    const parts = dateOverride.split('/').map(Number);
    const d = parts[0], m = parts[1], y = parts[2];
    targetDate = new Date(y, m - 1, d);
  } else if (dateOverride instanceof Date) {
    Logger.log('Using dateOverride as Date object');
    targetDate = new Date(dateOverride);
  } else {
    Logger.log('No valid dateOverride, using today');
    targetDate = new Date();
  }
  targetDate.setHours(0, 0, 0, 0);
  Logger.log('Target date: %s', targetDate);

  // 3) Fetch events for that date from both calendars
  const calMain = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calMain) throw new Error('Calendar not found: ' + CALENDAR_ID);
  const calDemo = CalendarApp.getCalendarById(DEMO_CALENDAR_ID);
  if (!calDemo) throw new Error('Calendar not found: ' + DEMO_CALENDAR_ID);
  const calOwner = CalendarApp.getCalendarById(OWNER_CALENDAR_ID);
  if (!calOwner) throw new Error('Calendar not found: ' + OWNER_CALENDAR_ID);

  const startTime = new Date(targetDate);
  const endTime = new Date(targetDate);
  endTime.setDate(endTime.getDate() + 1);
  Logger.log('Fetching events from %s to %s', startTime, endTime);

  const eventsMain = calMain.getEvents(startTime, endTime);
  const eventsDemo = calDemo.getEvents(startTime, endTime);
  const eventsOwner = calOwner.getEvents(startTime, endTime);
  Logger.log('Fetched %s main events, %s demo events', eventsMain.length, eventsDemo.length);
  // After fetching eventsMain, eventsDemo, eventsOwner
  const allEvents = [];

  // Tag each event with calendar type
  eventsMain.forEach(e => allEvents.push({ event: e, calendarType: 'main' }));
  eventsDemo.forEach(e => allEvents.push({ event: e, calendarType: 'demo' }));
  eventsOwner.forEach(e => allEvents.push({ event: e, calendarType: 'owner' }));

  // 4) Build flat array: one entry per student occurrence
  const studentSheet = STUDENTLIST.getSheetByName('Student List');
  if (!studentSheet) throw new Error('Student List sheet not found');
  const studentData = studentSheet.getDataRange().getValues();
  Logger.log('Loaded %s students from Student List', studentData.length - 1);
  const studentMap = {};
  for (let i = 1; i < studentData.length; i++) {
    const name = studentData[i][2];
    const folder = studentData[i][3];
    if (name && folder) studentMap[name] = folder;
  }

  const flat = [];
  allEvents.forEach(({ event, calendarType }) => {
    const title = event.getTitle();
    if (/break/i.test(title) || /teacher/i.test(title)) return;

    const lessonStatus = getLessonStatus_(event); // 'cancelled' | 'rescheduled' | null
    const status = lessonStatus !== null
      ? lessonStatus
      : getLessonLocationStatus_(title); // 'cafe' | 'online' | 'regular'

    const rawStart = event.getStartTime();
    const rawEnd = event.getEndTime();
    const namePart = title.split('(')[0].replace(/子/g, '');
    // Clean D/L markers BEFORE splitting by "and"
    const namePartClean = namePart.replace(/\s*D\/L\s*/i, '').trim();
    const names = namePartClean.split(/\s+and\s+/i).map(n => n.trim()).filter(Boolean);
    const cleanNames = names; // Already clean

    // Check for evaluation tags in description (#evaluationReady and #evaluationDone are equivalent)
    const description = event.getDescription() || '';
    let hasEvaluationReady = description.includes('#evaluationReady') || description.includes('#evaluationDone');
    let hasEvaluationDue = description.includes('#evaluationDue');
    // If AppState B5 is true: title "x/y" with y-x===1 (penultimate lesson) => evaluation due
    const fractionMatch = title.match(/(\d+)\s*\/\s*(\d+)/);
    if (penultimateEvalDue && fractionMatch) {
      const x = parseInt(fractionMatch[1], 10);
      const y = parseInt(fractionMatch[2], 10);
      if (y - x === 1) hasEvaluationDue = true;
    }
    const teacherMatch = description.match(/#teacher(\w+)/i);
    const teacher = teacherMatch ? teacherMatch[1] : '';

    // Improved last name detection for students with same last name
    let sharedLastName = '';
    if (cleanNames.length > 1) {
      // Check if first student has only one word (first name only)
      const firstStudentParts = cleanNames[0].split(/\s+/);
      if (firstStudentParts.length === 1) {
        // First student has only first name, look for last name in subsequent students
        for (let i = 1; i < cleanNames.length; i++) {
          const parts = cleanNames[i].split(/\s+/);
          if (parts.length > 1) {
            sharedLastName = parts[parts.length - 1]; // Get last part as last name
            Logger.log('Detected shared last name "%s" for students: %s', sharedLastName, cleanNames.join(', '));
            break;
          }
        }
      } else {
        // First student has full name, use their last name
        const firstStudentParts = cleanNames[0].split(/\s+/);
        sharedLastName = firstStudentParts[firstStudentParts.length - 1];
        Logger.log('Using last name "%s" from first student for shared last name', sharedLastName);
      }
    }

    cleanNames.forEach((nm, index) => {
      const parts = nm.split(/\s+/);
      // If student has only one word and we have a shared last name, combine them
      const fullName = (parts.length === 1 && sharedLastName) ? 
        (parts[0] + ' ' + sharedLastName) : nm;
      
      Logger.log('Student %d: Original="%s", Parts=%s, FullName="%s", SharedLastName="%s"', 
        index + 1, nm, JSON.stringify(parts), fullName, sharedLastName);
      
      // Clean the student name (D/L already removed above)
      let cleanStudentName = fullName.trim();
      
      let folderName = studentMap[ cleanStudentName ] || '';
      if (/D\/L/i.test(title)) {
        // For demo lessons, create a temporary folder name for display
        folderName = cleanStudentName + ' DEMO';
        Logger.log('Demo lesson: event "%s", using temporary folderName "%s" for display', title, folderName);
      }
      const isOnline = /\(\s*(Cafe|Online)\s*\)/i.test(title);
      flat.push({
        eventID:       event.getId(),
        eventName:     title,
        Start:         Utilities.formatDate(rawStart, tz, 'HH:mm'),
        End:           Utilities.formatDate(rawEnd,   tz, 'HH:mm'),
        studentName:   cleanStudentName,
        folderName:    folderName,
        pdfUpload:     false,
        lessonHistory: false,
        evaluationReady: hasEvaluationReady,
        evaluationDue: hasEvaluationDue,
        isOnline:      isOnline,
        status:        status,
        teacher:       teacher,
        calendarType: calendarType,
      });
    });
  });
  Logger.log('Built flat array of %s lesson occurrences', flat.length);

  // 5) Group by eventID
  const grouped = {};
  flat.forEach(item => {
    if (!grouped[item.eventID]) {
      grouped[item.eventID] = {
        eventID:       item.eventID,
        eventName:     item.eventName,
        Start:         item.Start,
        End:           item.End,
        folderName:    item.folderName,
        studentNames:  [ item.studentName ],
        pdfUpload:     item.pdfUpload,
        lessonHistory: item.lessonHistory,
        evaluationReady: item.evaluationReady,
        evaluationDue: item.evaluationDue,
        status:        item.status,
        teacher:       item.teacher,
        calendarType: item.calendarType,
      };
    } else {
      grouped[item.eventID].studentNames.push(item.studentName);
      // If any student has evaluation tags, mark the event accordingly
      if (item.evaluationReady) grouped[item.eventID].evaluationReady = true;
      if (item.evaluationDue) grouped[item.eventID].evaluationDue = true;
      if (!grouped[item.eventID].teacher && item.teacher) {
        grouped[item.eventID].teacher = item.teacher;
      }
    }
  });
  const lessons = Object.values(grouped);
  Logger.log('Grouped into %s lessons', lessons.length);

  // 6) Merge old statuses and preserve converted demo lessons
  lessons.forEach(lesson => {
    const oldStatus = oldStatusMap[lesson.eventID];
    if (oldStatus) {
      lesson.pdfUpload = oldStatus.pdfUpload;
      lesson.lessonHistory = oldStatus.lessonHistory;
      lesson.folderName = oldStatus.folderName; // Preserve folderName
      
      // Check if this was a demo lesson that has been converted to regular
      // If the old status has a real folder name (not ending in DEMO), preserve it
      if (oldStatus.folderName && !oldStatus.folderName.endsWith('DEMO')) {
        lesson.folderName = oldStatus.folderName;
        Logger.log(`Preserving converted demo lesson: ${lesson.eventID} -> ${lesson.folderName}`);
      }
    }
  });

  // 7) Write into 'lessons_today' sheet
  let tgt = ss.getSheetByName('lessons_today');
  if (!tgt) {
    tgt = ss.insertSheet('lessons_today');
    Logger.log('Created new lessons_today sheet');
  } else {
    tgt.clearContents();
    Logger.log('Cleared lessons_today sheet');
  }

  const headers = [
    'eventID', 'eventName', 'Start', 'End',
    'folderName', 'studentNames', 'pdfUpload', 'lessonHistory',
    'evaluationReady', 'evaluationDue', 'isOnline', 'status', 'teacher',
    'calendarType'
  ];
  tgt.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (lessons.length) {
    const out = lessons.map(l => [
      l.eventID,
      l.eventName,
      l.Start,
      l.End,
      l.folderName,
      l.studentNames.join(', '),
      l.pdfUpload,
      l.lessonHistory,
      l.evaluationReady || false,
      l.evaluationDue || false,
      l.isOnline || false,
      l.status || 'regular',
      l.teacher || '',
      l.calendarType || ''
    ]);
    tgt.getRange(2, 1, out.length, headers.length).setValues(out);
    Logger.log('Wrote %s lessons to sheet', out.length);
  } else {
    Logger.log('No lessons to write to sheet');
  }

  // Bump cache version when data changed so clients refetch
  const afterFingerprint = getLessonsTodayFingerprint();
  if (beforeFingerprint !== afterFingerprint) {
    const appState = getOrCreateAppStateSheet(ss);
    const current = appState.getRange(2, 1).getValue();
    const next = (typeof current === 'number' ? current : 0) + 1;
    appState.getRange(2, 1).setValue(next);
    appState.getRange(2, 2).setValue(new Date().toISOString());
    Logger.log('Cache changed, bumped version to ' + next);
  }

  Logger.log('--- fetchAndCacheTodayLessons END ---');
  return lessons;
}

// Helper to determine lesson type and prefix from event name
function determineLessonTypeAndPrefix(eventName) {
  if (eventName.includes('子')) {
    return { type: 'Kids', prefix: 'K' };
  }
  if (/\sand\s/i.test(eventName)) {
    return { type: 'Multiple', prefix: 'M' };
  }
  return { type: 'Regular', prefix: '0' };
}

// Helper to increment the lesson type ID in the Code sheet
function incrementLessonTypeID(lessonType) {
  const spreadsheet = STUDENTLIST;
  const codeSheet = spreadsheet.getSheetByName("Code");
  const codeData = codeSheet.getDataRange().getValues();
  for (let i = 1; i < codeData.length; i++) {
    // Unify Kids and Kids [Group] as 'Kids'
    let type = codeData[i][0];
    if (type && (type === 'Kids' || type === 'Kids [Group]')) type = 'Kids';
    if (type && type.toString().trim() === lessonType.toString().trim()) {
      let currentID = parseInt(codeData[i][1], 10);
      if (!isNaN(currentID)) {
        codeSheet.getRange(i + 1, 2).setValue(currentID + 1); // Column B (2)
      }
      break;
    }
  }
}

// Function to create folders and files for students
// Implementation moved to Legacy.js for reference.
function createFoldersForStudents(eventName, students) {
  // Stub: see Legacy.js createFoldersForStudents_legacy
}

function manual() {
  fetchAndCacheTodayLessons('17/02/2026');
}

/**
 * Creates a folder for a demo lesson
 * @param {string} eventID - The ID of the demo lesson event
 * @param {string} eventName - The name of the demo lesson
 * @returns {string} The created folder name
 */
// Implementation moved to Legacy.js for reference.
function createDemoLessonFolder(eventID, eventName) {
  // Stub: see Legacy.js createDemoLessonFolder_legacy
}

/**
 * Creates a folder for a demo lesson with detailed information and updates the event
 * @param {Object} payload - Object containing lesson details
 * @param {string} payload.lessonType - Type of lesson (Regular, Kids, Kids [Group], Group)
 * @param {string} payload.studentNumber - Student number (3 digits)
 * @param {Array} payload.studentNames - Array of student names
 * @param {string} payload.folderName - Generated folder name
 * @param {string} payload.eventID - Calendar event ID
 * @returns {Object} Result object with success status and folder name
 */
function createDemoLessonFolderWithDetails(payload) {
  try {
    const { lessonType, studentNumber, studentNames, folderName, eventID } = payload;
    
    Logger.log(`Creating demo lesson folder with details: ${JSON.stringify(payload)}`);
    
    const studentsFolderId = '11KrhsdqEpjUdMMGsNC67WRiS-gG1TAIV'; // Parent folder ID
    const studentsFolder = DriveApp.getFolderById(studentsFolderId);

    // Check if folder already exists
    const existingFolders = studentsFolder.getFoldersByName(folderName);
    if (existingFolders.hasNext()) {
      Logger.log(`Folder already exists: ${folderName}`);
      return { success: true, folderName: folderName, message: 'Folder already exists' };
    }

    // Fetch template IDs from the "Code" sheet
    const spreadsheet = STUDENTLIST;
    const codeSheet = spreadsheet.getSheetByName("Code");
    
    // Temporarily skip template creation for testing
    let lessonNoteDocId = null;
    let lessonHistorySheetId = null;
    
    if (codeSheet) {
      lessonNoteDocId = codeSheet.getRange("E2").getValue();
      lessonHistorySheetId = codeSheet.getRange("E4").getValue();
    }

    // Create the main folder
    const mainFolder = studentsFolder.createFolder(folderName);
    
    // Create subfolders with student names
    const lessonNotesFolder = mainFolder.createFolder(`${studentNames.join(' & ')}'s Lesson Notes`);
    const evaluationFolder = mainFolder.createFolder(`${studentNames.join(' & ')}'s Evaluation`);
    
    // Only create template files if IDs are provided
    if (lessonNoteDocId && lessonHistorySheetId) {
      // Create lesson note document with student name (possessive format)
      const lessonNoteDocTemplate = DriveApp.getFileById(lessonNoteDocId);
      const lessonNoteFileName = `${studentNames.join(' & ')}'s Lesson Note`;
      const lessonNoteDoc = lessonNoteDocTemplate.makeCopy(lessonNoteFileName, mainFolder);
      
      // Create lesson history spreadsheet with student name (possessive format)
      const lessonHistorySheetTemplate = DriveApp.getFileById(lessonHistorySheetId);
      const lessonHistoryFileName = `${studentNames.join(' & ')}'s Lesson History`;
      const copiedLessonHistorySheet = lessonHistorySheetTemplate.makeCopy(lessonHistoryFileName, mainFolder);
      const copiedSheet = SpreadsheetApp.openById(copiedLessonHistorySheet.getId());
      const firstSheet = copiedSheet.getSheets()[0];
      
      // Set the student name in the history sheet
      const studentNameText = studentNames.join(' & ');
      firstSheet.getRange("A1").setValue(studentNameText);
      
      // Add student information to the Student List sheet
      addStudentToStudentList(studentNames, folderName, lessonNoteDoc.getUrl(), copiedLessonHistorySheet.getUrl());
    } else {
      Logger.log('Template file IDs not found - skipping template creation');
      // Add student information to the Student List sheet without URLs
      addStudentToStudentList(studentNames, folderName, '', '');
    }
    
    // Update the lessons_today sheet to mark this as a regular lesson (not demo)
    updateDemoLessonToRegular(eventID, folderName, studentNames);
    
    // Increment the lesson type ID
    incrementLessonTypeID(lessonType);
    
    Logger.log(`Successfully created folder: ${folderName}`);
    return { success: true, folderName: folderName };
    
  } catch (error) {
    Logger.log(`Error creating demo lesson folder: ${error.message}`);
    throw error;
  }
}

/**
 * Gets the next available student number for a given lesson type
 * @param {string} lessonType - The lesson type (Regular, Kids, Group)
 * @returns {string} The next available 3-digit student number
 */
function getNextStudentNumber(lessonType) {
  try {
    const spreadsheet = STUDENTLIST;
    const codeSheet = spreadsheet.getSheetByName("Code");
    const codeData = codeSheet.getDataRange().getValues();
    
    // Unify Kids and Kids [Group] as 'Kids' for matching
    let searchType = lessonType;
    if (lessonType === 'Kids [Group]') searchType = 'Kids';
    
    // Find the row for the lesson type
    for (let i = 1; i < codeData.length; i++) {
      let type = codeData[i][0];
      
      if (type && type.toString().trim() === searchType.toString().trim()) {
        const currentID = parseInt(codeData[i][1], 10);
        if (!isNaN(currentID)) {
          // Return the current ID (it will be incremented when folder is created)
          return currentID.toString().padStart(3, '0');
        }
      }
    }
    
    // Default fallback
    return '001';
  } catch (error) {
    Logger.log(`Error getting next student number: ${error.message}`);
    return '001';
  }
}

/**
 * Adds student information to the Student List sheet
 * @param {Array} studentNames - Array of student names
 * @param {string} folderName - The folder name
 * @param {string} noteUrl - URL to the lesson note document
 * @param {string} historyUrl - URL to the lesson history spreadsheet
 */
function addStudentToStudentList(studentNames, folderName, noteUrl, historyUrl) {
  try {
    const studentSheet = STUDENTLIST.getSheetByName('Student List');
    const data = studentSheet.getDataRange().getValues();
    
    // Find the next empty row
    const nextRow = data.length + 1;
    
    // Extract lesson type and ID from folder name
    // Folder name format: "K053 Khacey Salvador" or "053 Khacey Salvador"
    let lessonType = 'Regular';
    let studentId = '';
    
    if (folderName) {
      const parts = folderName.split(' ');
      if (parts.length >= 2) {
        const idPart = parts[0];
        if (idPart.startsWith('K')) {
          lessonType = 'Kids';
          studentId = idPart.substring(1); // Remove 'K' prefix
        } else if (idPart.startsWith('M')) {
          lessonType = 'Group';
          studentId = idPart.substring(1); // Remove 'M' prefix
        } else {
          lessonType = 'Regular';
          studentId = idPart;
        }
      }
    }
    
    // Prepare the row data
    const studentName = studentNames.join(' & '); // Join multiple names with ' & '
    const rowData = [
      lessonType, // Column A (Lesson Type)
      studentId, // Column B (ID)
      studentName, // Column C (Student Name)
      folderName, // Column D (Student Folder)
      '', // Column E (Level - empty for now)
      '', // Column F (Book - empty for now)
      noteUrl, // Column G (Note)
      historyUrl // Column H (History)
    ];
    
    // Insert the new row
    studentSheet.getRange(nextRow, 1, 1, rowData.length).setValues([rowData]);
    
    Logger.log(`Added student to Student List: ${studentName} with folder: ${folderName}, type: ${lessonType}, ID: ${studentId}`);
  } catch (error) {
    Logger.log(`Error adding student to Student List: ${error.message}`);
    throw error;
  }
}

/**
 * Updates a demo lesson event to become a regular lesson
 * @param {string} eventID - The calendar event ID
 * @param {string} folderName - The new folder name
 * @param {Array} studentNames - Array of student names
 */
function updateDemoLessonToRegular(eventID, folderName, studentNames) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sht = ss.getSheetByName('lessons_today');
    const data = sht.getDataRange().getValues();
    const hdrs = data.shift();

    for (let r = 0; r < data.length; r++) {
      if (data[r][hdrs.indexOf('eventID')] === eventID) {
        // Update the row with new information
        const studentName = studentNames.join(' & ');
        sht.getRange(r + 2, hdrs.indexOf('studentNames') + 1).setValue(studentName);
        sht.getRange(r + 2, hdrs.indexOf('folderName') + 1).setValue(folderName);
        sht.getRange(r + 2, hdrs.indexOf('pdfUpload') + 1).setValue('FALSE');
        sht.getRange(r + 2, hdrs.indexOf('lessonHistory') + 1).setValue('FALSE');
        
        Logger.log(`Updated demo lesson to regular: ${eventID} -> ${folderName}`);
        return;
      }
    }
    
    Logger.log(`Event ID not found in lessons_today: ${eventID}`);
  } catch (error) {
    Logger.log(`Error updating demo lesson to regular: ${error.message}`);
    throw error;
  }
}

/**
 * Fetches the Note and History URLs for a given folder name from the 'Student List' sheet.
 * @param {string} folderName The folder name to look up (can be multiple names separated by commas for group lessons).
 * @returns {{noteUrl: string, historyUrl: string}|null} An object with the URLs, or null if not found.
 */
function getStudentLinks(folderName) {
  try {
    const studentSheet = STUDENTLIST.getSheetByName('Student List');
    if (!studentSheet) {
      Logger.log('Student List sheet not found');
      return null;
    }
    const data = studentSheet.getDataRange().getValues();

    // Column indices from the spreadsheet:
    // D: Student Folder (index 3)
    // G: Note (index 6)
    // H: History (index 7)
    const FOLDER_COL_IDX = 3;
    const NOTE_COL_IDX = 6;
    const HISTORY_COL_IDX = 7;

    // Handle group lessons - split by comma and take the first folder
    const folderNames = folderName.split(',').map(name => name.trim());
    const firstFolderName = folderNames[0];

    for (let i = 1; i < data.length; i++) { // Start from row 2 (index 1) to skip header
      if (data[i][FOLDER_COL_IDX] && data[i][FOLDER_COL_IDX].toString().trim() === firstFolderName) {
        return {
          noteUrl: data[i][NOTE_COL_IDX],
          historyUrl: data[i][HISTORY_COL_IDX]
        };
      }
    }

    Logger.log(`Folder not found in Student List: "${firstFolderName}"`);
    return null; // Folder not found
  } catch (e) {
    Logger.log(`Error in getStudentLinks for folder "${folderName}": ${e.toString()}`);
    return { error: e.toString() };
  }
}

/**
 * Returns the Google Drive folder URL for a student folder by name.
 * Returns null for demo lessons (folder not created yet) or if not found.
 * @param {string} folderName - The folder name (e.g. "053 Khacey Salvador")
 * @returns {{ url: string }|null}
 */
function getStudentFolderUrl(folderName) {
  if (!folderName || String(folderName).trim().endsWith('DEMO')) return null;
  try {
    const folder = findStudentFolder(String(folderName).trim());
    return folder ? { url: folder.getUrl() } : null;
  } catch (e) {
    Logger.log('getStudentFolderUrl error: ' + e);
    return null;
  }
}

/**
 * Extracts student name from a demo lesson event name
 * @param {string} eventName - The full event name (e.g. "John Smith D/L")
 * @returns {string} The student name (e.g. "John Smith")
 */
function extractStudentNameFromDemo(eventName) {
  // Split by D/L and take the first part, then trim any whitespace
  return eventName.split(/D\/L/i)[0].trim();
}

/**
 * Changes the color of a calendar event based on evaluation tags
 * @param {string} eventID - The calendar event ID
 * @param {string} color - The color to set (e.g., 'red', 'blue', 'green', etc.)
 */
function changeEventColor(eventID, color) {
  try {
    // Try to find the event in both calendars
    const calMain = CalendarApp.getCalendarById(CALENDAR_ID);
    const calDemo = CalendarApp.getCalendarById(DEMO_CALENDAR_ID);
    
    let event = null;
    
    // Search in main calendar
    if (calMain) {
      try {
        event = calMain.getEventById(eventID);
      } catch (e) {
        Logger.log('Event not found in main calendar: ' + eventID);
      }
    }
    
    // If not found in main calendar, search in demo calendar
    if (!event && calDemo) {
      try {
        event = calDemo.getEventById(eventID);
      } catch (e) {
        Logger.log('Event not found in demo calendar: ' + eventID);
      }
    }

    // If not found in demo calendar, search in owner calendar
    if (!event) {
      const calOwner = CalendarApp.getCalendarById(OWNER_CALENDAR_ID);
      if (calOwner) {
        try {
          event = calOwner.getEventById(eventID);
        } catch (e) {
          Logger.log('Event not found in owner calendar: ' + eventID);
        }
      }
    }
    
    if (event) {
      event.setColor(color);
      Logger.log('Changed event color to ' + color + ' for event: ' + eventID);
      return { success: true, message: 'Event color updated successfully' };
    } else {
      throw new Error('Event not found in any calendar');
    }
  } catch (error) {
    Logger.log('Error changing event color: ' + error.message);
    return { success: false, message: error.message };
  }
}

/**
 * Fetches evaluation data for a specific student from the "Evaluation" sheet
 * @param {string} studentName - The name of the student
 * @returns {Array} Array of evaluation objects sorted by evaluation number
 */
function getStudentEvaluations(studentName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const evalSheet = ss.getSheetByName('Evaluation');
  if (!evalSheet) throw new Error('Evaluation sheet not found');
  
  const data = evalSheet.getDataRange().getValues();
  if (data.length < 2) return []; // No data
  
  const headers = data.shift();
  const evaluations = [];
  
  // Find column indices
  const studentIdCol = headers.indexOf('Student ID');
  const evalNumCol = headers.indexOf('Evaluation Number');
  const evalDateCol = headers.indexOf('Evaluation Number and Date');
  const grammarCol = headers.indexOf('Grammar');
  const vocabCol = headers.indexOf('Vocabulary');
  const speakingCol = headers.indexOf('Speaking');
  const listeningCol = headers.indexOf('Listening');
  const readingCol = headers.indexOf('Reading');
  const writingCol = headers.indexOf('Writing');
  const fluencyCol = headers.indexOf('Fluency');
  const selfStudyCol = headers.indexOf('Self-Study');
  
  // Filter rows for the specific student
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const studentId = row[studentIdCol];
    
    // Check if this row belongs to the student
    if (studentId && studentId.toString().includes(studentName)) {
      const evaluation = {
        evaluationNumber: row[evalNumCol] || '',
        evaluationDate: row[evalDateCol] || '',
        grammar: row[grammarCol] || '',
        vocabulary: row[vocabCol] || '',
        speaking: row[speakingCol] || '',
        listening: row[listeningCol] || '',
        reading: row[readingCol] || '',
        writing: row[writingCol] || '',
        fluency: row[fluencyCol] || '',
        selfStudy: row[selfStudyCol] || ''
      };
      evaluations.push(evaluation);
    }
  }
  
  // Sort by evaluation number (convert to number for proper sorting)
  evaluations.sort((a, b) => {
    const aNum = parseInt(a.evaluationNumber) || 0;
    const bNum = parseInt(b.evaluationNumber) || 0;
    return aNum - bNum;
  });
  
  return evaluations;
}

