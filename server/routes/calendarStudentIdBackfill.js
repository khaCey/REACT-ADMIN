import { Router } from 'express';
import { query } from '../db/index.js';
import { gasCalendarEventIdFromMonthly } from '../lib/calendarEventId.js';
import {
  fetchMonthlyScheduleFromSheet,
  writeMonthlyScheduleStudentIds,
} from '../lib/googleSheets.js';

const router = Router();
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const TAG_GAS_TIMEOUT_MS = 45000;
const DB_DISAMBIGUATION_SUFFIX_RE = /_\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?$/;

function currentYyyyMmJst() {
  const jst = new Date(Date.now() + JST_OFFSET_MS);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

function uniqueSortedStrings(values) {
  return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function sameStringSet(left, right) {
  const a = uniqueSortedStrings(left);
  const b = uniqueSortedStrings(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function toYmd(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
}

function isoOrEmpty(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function stripGoogleUidSuffix(value) {
  return String(value || '').trim().replace(/@google\.com$/i, '');
}

function stripDbSuffix(value) {
  return String(value || '').trim().replace(DB_DISAMBIGUATION_SUFFIX_RE, '');
}

function eventIdVariants(values) {
  const out = [];
  for (const raw of values || []) {
    const value = String(raw || '').trim();
    if (!value) continue;
    out.push(value);
    out.push(stripGoogleUidSuffix(value));
    out.push(stripDbSuffix(value));
    out.push(stripGoogleUidSuffix(stripDbSuffix(value)));
  }
  return uniqueSortedStrings(out);
}

function getTagGasConfig() {
  const url = String(process.env.STUDENT_NUMBER_TAG_GAS_URL || '').trim();
  const key = String(process.env.STUDENT_NUMBER_TAG_API_KEY || '').trim();
  return { url, key };
}

function requireTagGasConfig() {
  const config = getTagGasConfig();
  if (!config.url || !config.key) {
    const missing = [];
    if (!config.url) missing.push('STUDENT_NUMBER_TAG_GAS_URL');
    if (!config.key) missing.push('STUDENT_NUMBER_TAG_API_KEY');
    const err = new Error(`${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not configured`);
    err.statusCode = 503;
    throw err;
  }
  return config;
}

async function callTagGas(body) {
  const { url: baseUrl, key } = requireTagGasConfig();
  const url = new URL(baseUrl);
  url.searchParams.set('key', key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TAG_GAS_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(json?.error || `Student number tag GAS returned HTTP ${response.status}`);
    }
    return json;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Student number tag GAS timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function groupMonthlyRows(rows) {
  const groups = new Map();

  for (const row of rows || []) {
    const eventId = String(row.event_id || '').trim();
    const startIso = isoOrEmpty(row.start);
    const key = `${eventId}\t${startIso}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        eventId,
        startIso,
        calendarSourceEventIds: [],
        studentIds: [],
        studentNames: [],
        students: [],
        dates: [],
        titles: [],
        statuses: [],
        calendarSyncStatuses: [],
        lessonKinds: [],
        localOnly: false,
      });
    }

    const group = groups.get(key);
    if (row.calendar_source_event_id) group.calendarSourceEventIds.push(String(row.calendar_source_event_id));
    if (row.student_id != null && row.student_id !== '') group.studentIds.push(String(row.student_id));
    if (row.student_name) group.studentNames.push(String(row.student_name));
    if (row.student_id != null && row.student_id !== '' && row.student_name) {
      group.students.push({
        id: String(row.student_id).trim(),
        name: String(row.student_name).trim(),
      });
    }
    const date = toYmd(row.date);
    if (date) group.dates.push(date);
    if (row.title) group.titles.push(String(row.title));
    if (row.status) group.statuses.push(String(row.status).toLowerCase());
    if (row.calendar_sync_status) group.calendarSyncStatuses.push(String(row.calendar_sync_status).toLowerCase());
    if (row.lesson_kind) group.lessonKinds.push(String(row.lesson_kind).toLowerCase());
    if (/^(local-booking-|optimistic-|unscheduled-)/i.test(eventId)) group.localOnly = true;
  }

  return [...groups.values()].map((group) => {
    const seenStudents = new Set();
    const students = [];
    for (const student of group.students) {
      const key = `${student.id}\t${normalizeName(student.name)}`;
      if (seenStudents.has(key)) continue;
      seenStudents.add(key);
      students.push(student);
    }

    return {
      ...group,
      calendarSourceEventIds: uniqueSortedStrings(group.calendarSourceEventIds),
      studentIds: uniqueSortedStrings(group.studentIds),
      studentNames: uniqueSortedStrings(group.studentNames),
      students,
      dates: uniqueSortedStrings(group.dates),
      titles: uniqueSortedStrings(group.titles),
      statuses: uniqueSortedStrings(group.statuses),
      calendarSyncStatuses: uniqueSortedStrings(group.calendarSyncStatuses),
      lessonKinds: uniqueSortedStrings(group.lessonKinds),
    };
  });
}

function makeGasRequest(group) {
  const sourceId = group.calendarSourceEventIds.length === 1
    ? group.calendarSourceEventIds[0]
    : '';
  const resolvedEventId = gasCalendarEventIdFromMonthly(
    group.eventId,
    group.startIso || null,
    sourceId || null
  );

  return {
    action: 'student_number_tag_update',
    eventId: resolvedEventId || group.eventId,
    rawMonthlyEventId: group.eventId,
    calendarSourceEventId: sourceId || undefined,
    seriesMasterId: sourceId || undefined,
    occurrenceStartIso: group.startIso || undefined,
    lessonKind: group.lessonKinds[0] || 'regular',
    studentIds: group.studentIds,
  };
}

function baseItem(group) {
  return {
    groupKey: group.key,
    eventId: group.eventId,
    title: group.titles[0] || '',
    start: group.startIso,
    studentIds: group.studentIds,
    studentNames: group.studentNames,
    calendarStudentIds: [],
    sheetStudentIds: [],
    dbStatuses: group.statuses,
    calendarSyncStatuses: group.calendarSyncStatuses,
    lessonKind: group.lessonKinds[0] || 'regular',
    description: '',
    calendarEventId: group.calendarSourceEventIds.length === 1
      ? group.calendarSourceEventIds[0]
      : group.eventId,
  };
}

function classifyLocalGroup(group) {
  if (group.localOnly) {
    return {
      ...baseItem(group),
      status: 'local_only',
      reason: 'Local/optimistic booking ID is not a confirmed synced event.',
    };
  }

  if (group.calendarSyncStatuses.some((status) => status && status !== 'synced')) {
    return {
      ...baseItem(group),
      status: 'not_synced',
      reason: 'At least one monthly_schedule row is not calendar_sync_status=synced.',
    };
  }

  if (group.studentIds.length === 0 || group.students.length === 0) {
    return {
      ...baseItem(group),
      status: 'missing_student_id',
      reason: 'monthly_schedule does not contain a student ID for this lesson.',
    };
  }

  if (group.calendarSourceEventIds.length > 1 || group.dates.length > 1) {
    return {
      ...baseItem(group),
      status: 'ambiguous_calendar_match',
      reason: 'Cached lesson identity is ambiguous; refusing automatic tagging.',
    };
  }

  return null;
}

function matchingSheetRows(group, allSheetRows) {
  const wantedDate = group.dates[0] || toYmd(group.startIso);
  const wantedEventIds = new Set(
    eventIdVariants([group.eventId, ...group.calendarSourceEventIds])
  );

  return (allSheetRows || []).filter((row) => {
    const rowVariants = eventIdVariants([row.eventID]);
    if (!rowVariants.some((id) => wantedEventIds.has(id))) return false;
    if (wantedDate && String(row.date || '').trim() !== wantedDate) return false;
    return true;
  });
}

function sheetPreviewGroup(group, allSheetRows) {
  const blocked = classifyLocalGroup(group);
  if (blocked) return { item: blocked, safeGroup: null };

  const eventRows = matchingSheetRows(group, allSheetRows);
  const matched = [];

  for (const student of group.students) {
    const name = normalizeName(student.name);
    const matches = eventRows.filter((row) => normalizeName(row.studentName) === name);
    if (matches.length !== 1) {
      return {
        item: {
          ...baseItem(group),
          status: matches.length === 0 ? 'tag_mismatch' : 'ambiguous_calendar_match',
          reason: matches.length === 0
            ? `MonthlySchedule Sheet row is missing for ${student.name}.`
            : `More than one MonthlySchedule Sheet row matched ${student.name}.`,
        },
        safeGroup: null,
      };
    }
    matched.push({ student, row: matches[0] });
  }

  const sheetIds = uniqueSortedStrings(matched.map(({ row }) => row.studentID).filter(Boolean));
  const common = {
    ...baseItem(group),
    calendarStudentIds: sheetIds,
    sheetStudentIds: sheetIds,
  };

  const allBlank = matched.every(({ row }) => !String(row.studentID || '').trim());
  if (allBlank) {
    return {
      item: {
        ...common,
        status: 'safe_to_tag',
        reason: 'MonthlySchedule.studentID is blank. Calendar will be contacted only when this event is tagged.',
      },
      safeGroup: group,
    };
  }

  const exactPerStudent = matched.every(({ student, row }) => (
    String(row.studentID || '').trim() === String(student.id || '').trim()
  ));

  if (exactPerStudent && sameStringSet(sheetIds, group.studentIds)) {
    return {
      item: {
        ...common,
        status: 'already_tagged',
        reason: 'MonthlySchedule.studentID already contains the expected student ID(s).',
      },
      safeGroup: null,
    };
  }

  return {
    item: {
      ...common,
      status: 'tag_mismatch',
      reason: 'MonthlySchedule.studentID is partial or does not match the expected student ID(s).',
    },
    safeGroup: null,
  };
}

async function loadMonthRows(month) {
  const result = await query(
    `SELECT event_id, calendar_source_event_id, student_id, student_name, title,
            date, start, status, calendar_sync_status, lesson_kind
       FROM monthly_schedule
      WHERE date IS NOT NULL
        AND to_char(date, 'YYYY-MM') = $1
      ORDER BY start ASC NULLS LAST, event_id ASC, student_id ASC NULLS LAST`,
    [month]
  );
  return result.rows || [];
}

function sortItems(items) {
  const order = {
    safe_to_tag: 0,
    tag_mismatch: 1,
    already_tagged: 2,
    ambiguous_calendar_match: 3,
    not_synced: 4,
    local_only: 5,
    missing_student_id: 6,
  };

  return [...items].sort((a, b) => {
    const rank = (order[a.status] ?? 99) - (order[b.status] ?? 99);
    if (rank !== 0) return rank;
    return String(a.start || '').localeCompare(String(b.start || ''));
  });
}

function countStatuses(items) {
  const counts = {};
  for (const item of items || []) counts[item.status] = (counts[item.status] || 0) + 1;
  return counts;
}

async function buildPreview(month) {
  // Preview reads Postgres + Google Sheets only. It never calls Google Calendar/GAS.
  const [rows, sheetRowsAll] = await Promise.all([
    loadMonthRows(month),
    fetchMonthlyScheduleFromSheet(),
  ]);

  if (rows.length > 0 && sheetRowsAll.length === 0) {
    const err = new Error('MonthlySchedule could not be read from Google Sheets');
    err.statusCode = 503;
    throw err;
  }

  const sheetRows = sheetRowsAll.filter((row) => !row.date || String(row.date).startsWith(month));
  const groups = groupMonthlyRows(rows);
  const resolved = groups.map((group) => sheetPreviewGroup(group, sheetRows));
  const items = sortItems(resolved.map((entry) => entry.item));
  const safeGroups = resolved.map((entry) => entry.safeGroup).filter(Boolean);

  return {
    month,
    rows,
    groups,
    sheetRows,
    items,
    safeGroups,
    counts: countStatuses(items),
  };
}

function sheetAssignmentsForGroup(group) {
  const eventIDs = eventIdVariants([group.eventId, ...group.calendarSourceEventIds]);
  const date = group.dates[0] || toYmd(group.startIso);

  return group.students.map((student) => ({
    eventIDs,
    date,
    studentName: student.name,
    studentID: student.id,
  }));
}

router.get('/preview', async (req, res) => {
  try {
    const month = String(req.query.month || currentYyyyMmJst()).trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month must be YYYY-MM' });
    }

    const preview = await buildPreview(month);
    return res.json({
      ok: true,
      readOnly: true,
      source: 'monthly_schedule_sheet_student_id',
      directCalendarAccess: false,
      month,
      monthlyScheduleRows: preview.rows.length,
      sheetRows: preview.sheetRows.length,
      lessonEventsScanned: preview.groups.length,
      counts: preview.counts,
      items: preview.items,
    });
  } catch (err) {
    console.error('[calendar-student-id-backfill/preview]', err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to build student ID backfill preview',
    });
  }
});

router.post('/apply-one', async (req, res) => {
  try {
    const month = String(req.body?.month || '').trim();
    const groupKey = String(req.body?.groupKey || '');

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month must be YYYY-MM' });
    }
    if (!groupKey) {
      return res.status(400).json({ error: 'groupKey is required' });
    }

    requireTagGasConfig();

    const [rows, sheetRows] = await Promise.all([
      loadMonthRows(month),
      fetchMonthlyScheduleFromSheet(),
    ]);
    const group = groupMonthlyRows(rows).find((candidate) => candidate.key === groupKey);

    if (!group) {
      return res.status(404).json({
        error: 'That cached event no longer exists. Run preview again.',
      });
    }

    const before = sheetPreviewGroup(group, sheetRows);
    if (!before.safeGroup || before.item?.status !== 'safe_to_tag') {
      return res.status(409).json({
        error: `Sheet state is not ready for tagging: ${before.item?.reason || before.item?.status || 'unknown state'}`,
        status: before.item?.status || 'unsafe',
        item: before.item || null,
      });
    }

    // This is the only step that reaches Google Calendar.
    const calendarResult = await callTagGas(makeGasRequest(group));
    if (!calendarResult?.ok || calendarResult?.verified !== true) {
      return res.status(409).json({
        error: calendarResult?.error || 'Exact Calendar tag verification failed',
        code: calendarResult?.code || 'CALENDAR_VERIFY_FAILED',
      });
    }

    let sheetUpdate;
    try {
      sheetUpdate = await writeMonthlyScheduleStudentIds(sheetAssignmentsForGroup(group));
    } catch (sheetErr) {
      console.error('[calendar-student-id-backfill/apply-one] Calendar verified but Sheet update failed:', sheetErr.message);
      return res.status(502).json({
        error: `Calendar tag was verified, but MonthlySchedule.studentID could not be saved: ${sheetErr.message}`,
        code: 'SHEET_STUDENT_ID_WRITE_FAILED',
        calendarTagged: true,
        calendarVerified: true,
        sheetUpdated: false,
        calendarEventId: calendarResult.eventId || '',
      });
    }

    const wasTaggedNow = calendarResult.actionTaken === 'tagged';
    const wasAlreadyTagged = calendarResult.actionTaken === 'already_tagged';
    const item = {
      ...baseItem(group),
      status: 'already_tagged',
      reason: 'Calendar tag was verified and MonthlySchedule.studentID was saved.',
      calendarEventId: calendarResult.eventId || baseItem(group).calendarEventId,
      calendarStudentIds: group.studentIds,
      sheetStudentIds: group.studentIds,
      description: String(calendarResult.description || ''),
    };

    console.log(
      '[calendar-student-id-backfill/apply-one]',
      month,
      group.eventId,
      `action=${String(calendarResult.actionTaken || '')}`,
      `sheetUpdated=${sheetUpdate.updated}`,
      `sheetAlreadyPresent=${sheetUpdate.alreadyPresent}`
    );

    return res.json({
      ok: true,
      month,
      tagged: wasTaggedNow ? 1 : 0,
      alreadyTagged: wasAlreadyTagged ? 1 : 0,
      failed: 0,
      skipped: 0,
      verified: true,
      sheetUpdated: true,
      sheetUpdate,
      result: {
        eventId: group.eventId,
        studentIds: group.studentIds,
        calendarEventId: calendarResult.eventId || '',
        actionTaken: calendarResult.actionTaken || null,
      },
      item,
    });
  } catch (err) {
    console.error('[calendar-student-id-backfill/apply-one]', err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to tag one Calendar event',
    });
  }
});

// Bulk remains deliberately disabled until the single-event Sheet+Calendar flow is validated.
router.post('/apply', (_req, res) => {
  return res.status(409).json({
    error: 'Bulk student-number tagging is temporarily disabled. Use Tag this event.',
  });
});

export default router;
