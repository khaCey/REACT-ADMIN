import { Router } from 'express';
import { query } from '../db/index.js';
import { gasCalendarEventIdFromMonthly } from '../lib/calendarEventId.js';

const router = Router();
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const TAG_GAS_TIMEOUT_MS = 45000;
const PREVIEW_CONCURRENCY = 6;
const UPDATE_CONCURRENCY = 3;

function currentYyyyMmJst() {
  const jst = new Date(Date.now() + JST_OFFSET_MS);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

function uniqueSortedStrings(values) {
  return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function sameStringSet(a, b) {
  const left = uniqueSortedStrings(a);
  const right = uniqueSortedStrings(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
    if (err?.name === 'AbortError') {
      throw new Error('Student number tag GAS timed out');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  }

  const workers = [];
  const count = Math.max(1, Math.min(concurrency, list.length || 1));
  for (let i = 0; i < count; i += 1) workers.push(runWorker());
  await Promise.all(workers);
  return results;
}

function isoOrEmpty(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
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
    if (row.title) group.titles.push(String(row.title));
    if (row.status) group.statuses.push(String(row.status).toLowerCase());
    if (row.calendar_sync_status) group.calendarSyncStatuses.push(String(row.calendar_sync_status).toLowerCase());
    if (row.lesson_kind) group.lessonKinds.push(String(row.lesson_kind).toLowerCase());
    if (/^(local-booking-|optimistic-|unscheduled-)/i.test(eventId)) group.localOnly = true;
  }

  return [...groups.values()].map((group) => ({
    ...group,
    calendarSourceEventIds: uniqueSortedStrings(group.calendarSourceEventIds),
    studentIds: uniqueSortedStrings(group.studentIds),
    studentNames: uniqueSortedStrings(group.studentNames),
    titles: uniqueSortedStrings(group.titles),
    statuses: uniqueSortedStrings(group.statuses),
    calendarSyncStatuses: uniqueSortedStrings(group.calendarSyncStatuses),
    lessonKinds: uniqueSortedStrings(group.lessonKinds),
  }));
}

function makeGasRequest(group, action) {
  const sourceId = group.calendarSourceEventIds.length === 1
    ? group.calendarSourceEventIds[0]
    : '';
  const resolvedEventId = gasCalendarEventIdFromMonthly(
    group.eventId,
    group.startIso || null,
    sourceId || null
  );

  return {
    action,
    eventId: resolvedEventId || group.eventId,
    rawMonthlyEventId: group.eventId,
    calendarSourceEventId: sourceId || undefined,
    seriesMasterId: sourceId || undefined,
    occurrenceStartIso: group.startIso || undefined,
    lessonKind: group.lessonKinds[0] || 'regular',
    ...(action === 'student_number_tag_update' ? { studentIds: group.studentIds } : {}),
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
    dbStatuses: group.statuses,
    calendarSyncStatuses: group.calendarSyncStatuses,
    lessonKind: group.lessonKinds[0] || 'regular',
    description: '',
    calendarEventId: '',
  };
}

function classifyLocalGroup(group) {
  if (group.localOnly) {
    return {
      ...baseItem(group),
      status: 'local_only',
      reason: 'Local/optimistic booking ID is not a confirmed Google Calendar event.',
    };
  }

  if (group.calendarSyncStatuses.some((status) => status && status !== 'synced')) {
    return {
      ...baseItem(group),
      status: 'not_synced',
      reason: 'At least one monthly_schedule row is not calendar_sync_status=synced.',
    };
  }

  if (group.studentIds.length === 0) {
    return {
      ...baseItem(group),
      status: 'missing_student_id',
      reason: 'The matched monthly_schedule rows do not contain a student_id.',
    };
  }

  if (group.calendarSourceEventIds.length > 1) {
    return {
      ...baseItem(group),
      status: 'ambiguous_calendar_match',
      reason: 'monthly_schedule has more than one Calendar source event ID for this lesson.',
    };
  }

  return null;
}

function statusForGasError(code) {
  if (code === 'EVENT_NOT_FOUND') return 'calendar_missing';
  if (code === 'AMBIGUOUS_RECURRING_EVENT') return 'ambiguous_calendar_match';
  return 'api_error';
}

async function previewRemoteGroup(group) {
  const localClassification = classifyLocalGroup(group);
  if (localClassification) return { item: localClassification, safeGroup: null };

  try {
    const result = await callTagGas(makeGasRequest(group, 'student_number_tag_preview'));
    if (!result?.ok) {
      return {
        item: {
          ...baseItem(group),
          status: statusForGasError(result?.code),
          reason: result?.error || 'Student number tag API could not resolve this event.',
          calendarEventId: result?.eventId || '',
        },
        safeGroup: null,
      };
    }

    const existingIds = uniqueSortedStrings(result.existingStudentIds || []);
    const common = {
      ...baseItem(group),
      title: result.summary || group.titles[0] || '',
      start: result?.start?.dateTime || result?.start?.date || group.startIso,
      end: result?.end?.dateTime || result?.end?.date || '',
      calendarStatus: result.status || '',
      calendarEventId: result.eventId || '',
      calendarStudentIds: existingIds,
      description: String(result.description || ''),
    };

    if (existingIds.length === 0) {
      return {
        item: {
          ...common,
          status: 'safe_to_tag',
          reason: 'Exact Calendar event found and no existing student-ID metadata was detected.',
        },
        safeGroup: group,
      };
    }

    if (sameStringSet(existingIds, group.studentIds)) {
      return {
        item: {
          ...common,
          status: 'already_tagged',
          reason: 'Calendar description already contains the same student ID set.',
        },
        safeGroup: null,
      };
    }

    return {
      item: {
        ...common,
        status: 'tag_mismatch',
        reason: 'Calendar description contains student IDs that do not match monthly_schedule.',
      },
      safeGroup: null,
    };
  } catch (err) {
    return {
      item: {
        ...baseItem(group),
        status: 'api_error',
        reason: err.message || 'Student number tag API request failed.',
      },
      safeGroup: null,
    };
  }
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
    calendar_missing: 3,
    ambiguous_calendar_match: 4,
    api_error: 5,
    not_synced: 6,
    local_only: 7,
    missing_student_id: 8,
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
  // Fail early with a clear config message before doing DB work.
  requireTagGasConfig();

  const rows = await loadMonthRows(month);
  const groups = groupMonthlyRows(rows);
  const resolved = await mapWithConcurrency(groups, PREVIEW_CONCURRENCY, previewRemoteGroup);
  const items = sortItems(resolved.map((entry) => entry.item));
  const safeGroups = resolved.map((entry) => entry.safeGroup).filter(Boolean);

  return {
    month,
    rows,
    groups,
    items,
    safeGroups,
    counts: countStatuses(items),
  };
}

router.get('/preview', async (req, res) => {
  try {
    const month = String(req.query.month || currentYyyyMmJst()).trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month must be YYYY-MM' });
    }

    const preview = await buildPreview(month);
    res.json({
      ok: true,
      readOnly: true,
      month,
      monthlyScheduleRows: preview.rows.length,
      lessonEventsScanned: preview.groups.length,
      counts: preview.counts,
      items: preview.items,
    });
  } catch (err) {
    console.error('[calendar-student-id-backfill/preview]', err.message);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to build Calendar student ID backfill preview',
    });
  }
});

/**
 * Apply the student-number tag to one exact preview group.
 *
 * Safety:
 * - browser sends only month + an opaque DB-derived group key
 * - server reloads monthly_schedule and finds that exact group again
 * - server re-runs the Calendar preview check for that one group
 * - update is refused unless it is STILL safe_to_tag
 * - the dedicated GAS then performs description-only mutation
 */
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

    const rows = await loadMonthRows(month);
    const groups = groupMonthlyRows(rows);
    const group = groups.find((candidate) => candidate.key === groupKey);

    if (!group) {
      return res.status(404).json({
        error: 'That preview event no longer exists in monthly_schedule. Run the preview again.',
      });
    }

    const checked = await previewRemoteGroup(group);
    if (!checked.safeGroup || checked.item?.status !== 'safe_to_tag') {
      return res.status(409).json({
        error: `Event is no longer safe to tag: ${checked.item?.reason || checked.item?.status || 'unknown reason'}`,
        status: checked.item?.status || 'unsafe',
        item: checked.item || null,
      });
    }

    const result = await callTagGas(makeGasRequest(group, 'student_number_tag_update'));
    if (!result?.ok) {
      return res.status(409).json({
        error: result?.error || 'Student number tag update failed',
        code: result?.code || null,
      });
    }

    const verify = await previewRemoteGroup(group);
    const verified = verify.item?.status === 'already_tagged';

    console.log(
      '[calendar-student-id-backfill/apply-one]',
      month,
      group.eventId,
      `action=${String(result.actionTaken || '')}`,
      `verified=${verified}`
    );

    return res.json({
      ok: verified,
      month,
      tagged: result.actionTaken === 'tagged' ? 1 : 0,
      alreadyTagged: result.actionTaken === 'already_tagged' ? 1 : 0,
      failed: verified ? 0 : 1,
      skipped: 0,
      verified,
      result: {
        eventId: group.eventId,
        studentIds: group.studentIds,
        calendarEventId: result.eventId || verify.item?.calendarEventId || '',
        actionTaken: result.actionTaken || null,
      },
      item: verify.item || null,
    });
  } catch (err) {
    console.error('[calendar-student-id-backfill/apply-one]', err.message);
    return res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to apply student number tag to one Calendar event',
    });
  }
});

/**
 * Apply canonical student-number tags to SAFE events only.
 *
 * Safety:
 * - re-runs the preview immediately before writing
 * - updates only events that are still safe_to_tag
 * - the dedicated GAS itself refuses conflicting IDs
 * - GAS mutation is description-only
 * - no Calendar ID is accepted from the browser
 */
router.post('/apply', async (req, res) => {
  try {
    const month = String(req.body?.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month must be YYYY-MM' });
    }

    const preview = await buildPreview(month);
    const safeGroups = preview.safeGroups;

    const updateResults = await mapWithConcurrency(
      safeGroups,
      UPDATE_CONCURRENCY,
      async (group) => {
        try {
          const result = await callTagGas(makeGasRequest(group, 'student_number_tag_update'));
          return {
            eventId: group.eventId,
            studentIds: group.studentIds,
            ok: !!result?.ok,
            actionTaken: result?.actionTaken || null,
            calendarEventId: result?.eventId || '',
            code: result?.code || null,
            error: result?.ok ? null : (result?.error || 'Tag update failed'),
          };
        } catch (err) {
          return {
            eventId: group.eventId,
            studentIds: group.studentIds,
            ok: false,
            actionTaken: null,
            calendarEventId: '',
            code: 'REQUEST_FAILED',
            error: err.message || 'Tag update request failed',
          };
        }
      }
    );

    const tagged = updateResults.filter((item) => item.ok && item.actionTaken === 'tagged').length;
    const alreadyTagged = updateResults.filter((item) => item.ok && item.actionTaken === 'already_tagged').length;
    const failed = updateResults.filter((item) => !item.ok).length;

    console.log(
      '[calendar-student-id-backfill/apply]',
      month,
      `safe=${safeGroups.length}`,
      `tagged=${tagged}`,
      `alreadyTagged=${alreadyTagged}`,
      `failed=${failed}`
    );

    res.json({
      ok: failed === 0,
      month,
      previewSafeCount: safeGroups.length,
      tagged,
      alreadyTagged,
      failed,
      skipped: Math.max(0, preview.groups.length - safeGroups.length),
      results: updateResults,
    });
  } catch (err) {
    console.error('[calendar-student-id-backfill/apply]', err.message);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to apply Calendar student ID backfill',
    });
  }
});

export default router;