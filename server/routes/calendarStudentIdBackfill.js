import { Router } from 'express';
import { query } from '../db/index.js';
import { gasCalendarEventIdFromMonthly } from '../lib/calendarEventId.js';

const router = Router();
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const TAG_GAS_TIMEOUT_MS = 45000;
const UPDATE_CONCURRENCY = 3;

function currentYyyyMmJst() {
  const jst = new Date(Date.now() + JST_OFFSET_MS);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

function uniqueSortedStrings(values) {
  return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
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

  if (group.studentIds.length === 0) {
    return {
      ...baseItem(group),
      status: 'missing_student_id',
      reason: 'The cached monthly_schedule rows do not contain a student_id.',
    };
  }

  if (group.calendarSourceEventIds.length > 1) {
    return {
      ...baseItem(group),
      status: 'ambiguous_calendar_match',
      reason: 'Cached monthly_schedule has more than one Calendar source event ID for this lesson.',
    };
  }

  return null;
}

function localPreviewGroup(group) {
  const blocked = classifyLocalGroup(group);
  if (blocked) return { item: blocked, safeGroup: null };

  return {
    item: {
      ...baseItem(group),
      status: 'safe_to_tag',
      reason: 'Cached schedule data is ready. Google Calendar will be checked only if you tag this event.',
    },
    safeGroup: group,
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
    already_tagged: 1,
    ambiguous_calendar_match: 2,
    not_synced: 3,
    local_only: 4,
    missing_student_id: 5,
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
  // Intentionally local-only. Preview must never call Google Calendar or GAS.
  const rows = await loadMonthRows(month);
  const groups = groupMonthlyRows(rows);
  const resolved = groups.map(localPreviewGroup);
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
      source: 'monthly_schedule_cache',
      directCalendarAccess: false,
      month,
      monthlyScheduleRows: preview.rows.length,
      lessonEventsScanned: preview.groups.length,
      counts: preview.counts,
      items: preview.items,
    });
  } catch (err) {
    console.error('[calendar-student-id-backfill/preview]', err.message);
    res.status(err.statusCode || 500).json({
      error: err.message || 'Failed to build student ID backfill preview',
    });
  }
});

/**
 * Tag one event.
 * This is intentionally the only normal UI path that reaches Google Calendar.
 * The dedicated GAS performs all Calendar-side safety checks, patches description
 * only, then re-reads the exact same event and returns verified:true.
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
        error: 'That cached event no longer exists in monthly_schedule. Run preview again.',
      });
    }

    const blocked = classifyLocalGroup(group);
    if (blocked) {
      return res.status(409).json({
        error: `Cached event is not eligible for tagging: ${blocked.reason}`,
        status: blocked.status,
        item: blocked,
      });
    }

    const result = await callTagGas(makeGasRequest(group, 'student_number_tag_update'));
    if (!result?.ok || result?.verified !== true) {
      return res.status(409).json({
        error: result?.error || 'Exact Calendar tag verification failed',
        code: result?.code || 'CALENDAR_VERIFY_FAILED',
      });
    }

    const wasTaggedNow = result.actionTaken === 'tagged';
    const wasAlreadyTagged = result.actionTaken === 'already_tagged';
    const item = {
      ...baseItem(group),
      status: 'already_tagged',
      reason: wasAlreadyTagged
        ? 'Google Calendar already contained the same student ID tag and exact verification passed.'
        : 'Google Calendar description was tagged and exact verification passed.',
      calendarEventId: result.eventId || baseItem(group).calendarEventId,
      calendarStudentIds: group.studentIds,
      description: String(result.description || ''),
    };

    console.log(
      '[calendar-student-id-backfill/apply-one]',
      month,
      group.eventId,
      `action=${String(result.actionTaken || '')}`,
      'verified=true'
    );

    return res.json({
      ok: true,
      month,
      tagged: wasTaggedNow ? 1 : 0,
      alreadyTagged: wasAlreadyTagged ? 1 : 0,
      failed: 0,
      skipped: 0,
      verified: true,
      result: {
        eventId: group.eventId,
        studentIds: group.studentIds,
        calendarEventId: result.eventId || '',
        actionTaken: result.actionTaken || null,
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

/**
 * Bulk tagging endpoint. It is currently blocked by the React client while the
 * one-event workflow is being validated. If enabled later, every request here is
 * still a tagging operation, so direct Calendar access is intentional.
 */
router.post('/apply', async (req, res) => {
  try {
    const month = String(req.body?.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month must be YYYY-MM' });
    }

    requireTagGasConfig();
    const preview = await buildPreview(month);
    const safeGroups = preview.safeGroups;

    const updateResults = await mapWithConcurrency(
      safeGroups,
      UPDATE_CONCURRENCY,
      async (group) => {
        try {
          const result = await callTagGas(makeGasRequest(group, 'student_number_tag_update'));
          const verified = !!result?.ok && result?.verified === true;
          return {
            eventId: group.eventId,
            studentIds: group.studentIds,
            ok: verified,
            actionTaken: verified ? (result?.actionTaken || null) : null,
            calendarEventId: result?.eventId || '',
            code: verified ? null : (result?.code || 'CALENDAR_VERIFY_FAILED'),
            error: verified ? null : (result?.error || 'Exact Calendar tag verification failed'),
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
