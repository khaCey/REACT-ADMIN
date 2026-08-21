import { Router } from 'express';
import { query } from '../db/index.js';
import { gasCalendarEventIdFromMonthly } from '../lib/calendarEventId.js';

const router = Router();
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const TAG_GAS_TIMEOUT_MS = 45000;
const DB_DISAMBIGUATION_SUFFIX_RE = /_\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?$/;
const INSTANCE_SUFFIX_RE = /_\d{8}T\d{6}Z$/i;

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

function stripInstanceSuffix(value) {
  return String(value || '').trim().replace(INSTANCE_SUFFIX_RE, '');
}

function eventIdVariants(values) {
  const out = [];
  for (const raw of values || []) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const noGoogle = stripGoogleUidSuffix(value);
    const noDb = stripDbSuffix(value);
    const noBoth = stripGoogleUidSuffix(noDb);
    out.push(value, noGoogle, noDb, noBoth, stripInstanceSuffix(noGoogle), stripInstanceSuffix(noBoth));
  }
  return uniqueSortedStrings(out);
}

function getTagGasConfig() {
  return {
    url: String(process.env.STUDENT_NUMBER_TAG_GAS_URL || '').trim(),
    key: String(process.env.STUDENT_NUMBER_TAG_API_KEY || '').trim(),
  };
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
      const err = new Error(json?.error || `Student-number GAS returned HTTP ${response.status}`);
      err.statusCode = response.status;
      throw err;
    }
    return json;
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Student-number GAS timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function readMirrorMonth(month) {
  const result = await callTagGas({ action: 'calendar_mirror_read_month', month });
  if (!result?.ok || !Array.isArray(result.rows)) {
    const err = new Error(result?.error || 'Calendar mirror could not be read');
    err.statusCode = 502;
    throw err;
  }
  return result.rows;
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

function makeGasTagRequest(group) {
  const sourceId = group.calendarSourceEventIds.length === 1 ? group.calendarSourceEventIds[0] : '';
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

function expectedMirrorSource(group) {
  const kind = String(group.lessonKinds[0] || '').toLowerCase();
  if (kind === 'demo') return 'demo';
  if (kind === 'owner') return 'owner';
  if (kind === 'regular') return 'main';
  return '';
}

function parseMirrorStudentIds(value) {
  return uniqueSortedStrings(String(value || '').split(','));
}

function startCloseEnough(groupStartIso, mirrorStart) {
  if (!groupStartIso || !mirrorStart) return true;
  const left = new Date(groupStartIso).getTime();
  const right = new Date(mirrorStart).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) <= 6 * 60 * 1000;
}

function rowMatchesEventIdentity(group, row) {
  const wantedIds = new Set(eventIdVariants([group.eventId, ...group.calendarSourceEventIds]));
  const rowIds = eventIdVariants([
    row.googleEventId,
    row.iCalUID,
    row.recurringEventId,
  ]);
  if (!rowIds.some((id) => wantedIds.has(id))) return false;
  return startCloseEnough(group.startIso, row.start || row.originalStartTime);
}

function matchingMirrorRows(group, mirrorRows) {
  // Event ID/iCalUID + occurrence time is the identity. Do not reject a real event
  // merely because legacy PostgreSQL lesson_kind disagrees with the mirror source.
  const identityMatches = (mirrorRows || []).filter((row) => rowMatchesEventIdentity(group, row));
  if (identityMatches.length <= 1) return identityMatches;

  const preferredSource = expectedMirrorSource(group);
  if (!preferredSource) return identityMatches;
  const preferred = identityMatches.filter(
    (row) => String(row.calendarSource || '').toLowerCase() === preferredSource
  );
  return preferred.length === 1 ? preferred : identityMatches;
}

function baseItem(group) {
  return {
    groupKey: group.key,
    eventId: group.eventId,
    title: group.titles[0] || '',
    start: group.startIso,
    studentIds: group.studentIds,
    studentNames: group.studentNames,
    sheetStudentIds: [],
    calendarStudentIds: [],
    dbStatuses: group.statuses,
    calendarSyncStatuses: group.calendarSyncStatuses,
    lessonKind: group.lessonKinds[0] || 'regular',
    description: '',
    calendarEventId: group.calendarSourceEventIds.length === 1
      ? group.calendarSourceEventIds[0]
      : group.eventId,
    eventKey: '',
  };
}

function classifyGroup(group, mirrorRows) {
  if (group.localOnly) {
    return { ...baseItem(group), status: 'local_only', reason: 'Local/optimistic booking ID is not a confirmed Calendar event.' };
  }
  if (group.calendarSyncStatuses.some((status) => status && status !== 'synced')) {
    return { ...baseItem(group), status: 'not_synced', reason: 'At least one monthly_schedule row is not synced.' };
  }
  if (group.studentIds.length === 0) {
    return { ...baseItem(group), status: 'missing_student_id', reason: 'PostgreSQL does not contain a student ID for this lesson.' };
  }
  if (group.calendarSourceEventIds.length > 1) {
    return { ...baseItem(group), status: 'ambiguous_calendar_match', reason: 'PostgreSQL contains more than one Calendar source ID for this lesson.' };
  }

  const matches = matchingMirrorRows(group, mirrorRows);
  if (matches.length === 0) {
    return {
      ...baseItem(group),
      status: 'mirror_missing',
      reason: 'No monthlyLessons row matched this Calendar event ID/iCalUID and occurrence time.',
    };
  }
  if (matches.length > 1) {
    return {
      ...baseItem(group),
      status: 'ambiguous_calendar_match',
      reason: 'More than one monthlyLessons row matched this Calendar event identity.',
    };
  }

  const mirror = matches[0];
  const mirrorIds = parseMirrorStudentIds(mirror.studentId);
  const common = {
    ...baseItem(group),
    sheetStudentIds: mirrorIds,
    calendarStudentIds: mirrorIds,
    calendarEventId: String(mirror.googleEventId || baseItem(group).calendarEventId),
    eventKey: String(mirror.eventKey || ''),
    title: String(mirror.title || group.titles[0] || ''),
    start: String(mirror.start || group.startIso || ''),
  };

  if (mirrorIds.length === 0) {
    return {
      ...common,
      status: 'safe_to_tag',
      reason: 'monthlyLessons has this event but no student ID. Calendar is contacted only when you tag it.',
    };
  }
  if (sameStringSet(mirrorIds, group.studentIds)) {
    return {
      ...common,
      status: 'already_tagged',
      reason: 'monthlyLessons already contains the expected student ID(s).',
    };
  }
  return {
    ...common,
    status: 'tag_mismatch',
    reason: 'monthlyLessons contains student ID(s) that do not match PostgreSQL.',
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
    mirror_missing: 3,
    ambiguous_calendar_match: 4,
    not_synced: 5,
    local_only: 6,
    missing_student_id: 7,
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
  const [rows, mirrorRows] = await Promise.all([
    loadMonthRows(month),
    readMirrorMonth(month),
  ]);
  const groups = groupMonthlyRows(rows);
  const items = sortItems(groups.map((group) => classifyGroup(group, mirrorRows)));
  return { rows, mirrorRows, groups, items, counts: countStatuses(items) };
}

router.get('/preview', async (req, res) => {
  try {
    const month = String(req.query.month || currentYyyyMmJst()).trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });

    const preview = await buildPreview(month);
    return res.json({
      ok: true,
      readOnly: true,
      source: 'new_calendar_mirror_monthlyLessons',
      directCalendarAccess: false,
      month,
      monthlyScheduleRows: preview.rows.length,
      mirrorRows: preview.mirrorRows.length,
      lessonEventsScanned: preview.groups.length,
      counts: preview.counts,
      items: preview.items,
    });
  } catch (err) {
    console.error('[calendar-student-id-backfill/preview]', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to build student ID preview' });
  }
});

router.post('/apply-one', async (req, res) => {
  try {
    const month = String(req.body?.month || '').trim();
    const groupKey = String(req.body?.groupKey || '');
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
    if (!groupKey) return res.status(400).json({ error: 'groupKey is required' });

    requireTagGasConfig();
    const rows = await loadMonthRows(month);
    const groups = groupMonthlyRows(rows);
    const group = groups.find((candidate) => candidate.key === groupKey);
    if (!group) return res.status(404).json({ error: 'That event no longer exists in monthly_schedule. Run preview again.' });

    const mirrorBefore = await readMirrorMonth(month);
    const before = classifyGroup(group, mirrorBefore);
    if (before.status !== 'safe_to_tag') {
      return res.status(409).json({
        error: `Mirror state is not ready for tagging: ${before.reason}`,
        status: before.status,
        item: before,
      });
    }

    const gasResult = await callTagGas(makeGasTagRequest(group));
    if (!gasResult?.ok || gasResult?.verified !== true || gasResult?.mirrorUpdated !== true) {
      return res.status(409).json({
        error: gasResult?.error || 'Calendar tag/mirror verification failed',
        code: gasResult?.code || 'TAG_VERIFY_FAILED',
        calendarTagged: !!gasResult?.calendarTagged,
        calendarVerified: !!gasResult?.calendarVerified,
        mirrorUpdated: !!gasResult?.mirrorUpdated,
      });
    }

    const mirrorAfter = await readMirrorMonth(month);
    const after = classifyGroup(group, mirrorAfter);
    if (after.status !== 'already_tagged') {
      return res.status(502).json({
        error: `Calendar was verified, but the new Sheet mirror did not verify afterward: ${after.reason}`,
        code: 'MIRROR_POST_WRITE_VERIFY_FAILED',
        calendarVerified: true,
        mirrorUpdated: true,
        item: after,
      });
    }

    const wasTaggedNow = gasResult.actionTaken === 'tagged';
    const wasAlreadyTagged = gasResult.actionTaken === 'already_tagged';
    return res.json({
      ok: true,
      month,
      tagged: wasTaggedNow ? 1 : 0,
      alreadyTagged: wasAlreadyTagged ? 1 : 0,
      failed: 0,
      skipped: 0,
      verified: true,
      mirrorUpdated: true,
      result: {
        eventId: group.eventId,
        studentIds: group.studentIds,
        calendarEventId: gasResult.eventId || '',
        eventKey: after.eventKey || gasResult?.mirror?.eventKey || '',
        actionTaken: gasResult.actionTaken || null,
      },
      item: after,
    });
  } catch (err) {
    console.error('[calendar-student-id-backfill/apply-one]', err.message);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Failed to tag one Calendar event' });
  }
});

router.post('/apply', (_req, res) => {
  return res.status(409).json({
    error: 'Bulk student-number tagging is temporarily disabled. Use Tag this event.',
  });
});

export default router;
