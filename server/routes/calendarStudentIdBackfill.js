import { Router } from 'express';
import { query } from '../db/index.js';

const router = Router();
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const TAG_GAS_TIMEOUT_MS = 45000;
const MIRROR_POST_WRITE_VERIFY_DELAYS_MS = [0, 250, 750, 1500];
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

function normalizeAdminCalendarBaseId(value) {
  return stripInstanceSuffix(stripGoogleUidSuffix(stripDbSuffix(value)));
}

function googleInstanceUtcSuffix(startIso) {
  if (!startIso) return '';
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
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
  if (result?.ok !== true || !Array.isArray(result?.rows)) {
    const err = new Error(result?.error || 'New Calendar mirror could not be read through GAS');
    err.statusCode = 502;
    throw err;
  }
  return result;
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyMirrorAfterWrite(month, group) {
  let lastItem = null;
  let lastError = null;

  for (let index = 0; index < MIRROR_POST_WRITE_VERIFY_DELAYS_MS.length; index += 1) {
    const delayMs = MIRROR_POST_WRITE_VERIFY_DELAYS_MS[index];
    if (delayMs > 0) await waitMs(delayMs);

    try {
      const mirror = await readMirrorMonth(month);
      lastItem = classifyGroup(group, mirror.rows || []);
      lastError = null;
      if (lastItem.status === 'already_tagged') {
        return { ok: true, item: lastItem, attempts: index + 1 };
      }
    } catch (err) {
      lastError = err;
    }
  }

  return {
    ok: false,
    item: lastItem,
    attempts: MIRROR_POST_WRITE_VERIFY_DELAYS_MS.length,
    error: lastError,
  };
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
        calendarGoogleEventIds: [],
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
    if (row.calendar_google_event_id) group.calendarGoogleEventIds.push(String(row.calendar_google_event_id));
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
    calendarGoogleEventIds: uniqueSortedStrings(group.calendarGoogleEventIds),
    studentIds: uniqueSortedStrings(group.studentIds),
    studentNames: uniqueSortedStrings(group.studentNames),
    titles: uniqueSortedStrings(group.titles),
    statuses: uniqueSortedStrings(group.statuses),
    calendarSyncStatuses: uniqueSortedStrings(group.calendarSyncStatuses),
    lessonKinds: uniqueSortedStrings(group.lessonKinds),
  }));
}

function makeGasTagRequest(group, mirrorRow) {
  const exactGoogleEventId = String(mirrorRow?.googleEventId || '').trim();
  if (!exactGoogleEventId) throw new Error('Matched monthlyLessons row has no googleEventId');

  return {
    action: 'student_number_tag_update',
    eventId: exactGoogleEventId,
    calendarSourceEventId: exactGoogleEventId,
    seriesMasterId: String(mirrorRow?.recurringEventId || '').trim() || undefined,
    occurrenceStartIso: String(mirrorRow?.originalStartTime || mirrorRow?.start || group.startIso || '').trim() || undefined,
    lessonKind: String(mirrorRow?.lessonKind || group.lessonKinds[0] || 'regular').toLowerCase(),
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

function preferSingleMirrorSource(group, rows) {
  if (rows.length <= 1) return rows;
  const preferredSource = expectedMirrorSource(group);
  if (!preferredSource) return rows;
  const preferred = rows.filter((row) => String(row.calendarSource || '').toLowerCase() === preferredSource);
  return preferred.length === 1 ? preferred : rows;
}

function parseMirrorStudentIds(value) {
  return uniqueSortedStrings(String(value || '').split(','));
}

function adminCalendarBaseIds(group) {
  const sourceIds = group.calendarSourceEventIds.length ? group.calendarSourceEventIds : [group.eventId];
  return uniqueSortedStrings(sourceIds.map(normalizeAdminCalendarBaseId));
}

// One-time bridge for old React Admin rows.
// Build the exact Calendar API occurrence ID from the old CalendarApp/iCal series ID
// plus this lesson's UTC start, then compare that exact value to monthlyLessons.googleEventId.
function legacyExactGoogleEventIdCandidates(group) {
  const sourceIds = group.calendarSourceEventIds.length ? group.calendarSourceEventIds : [group.eventId];
  const directIds = uniqueSortedStrings(
    sourceIds.map((value) => stripGoogleUidSuffix(stripDbSuffix(value)))
  );
  const baseIds = adminCalendarBaseIds(group);
  const occurrenceSuffix = googleInstanceUtcSuffix(group.startIso);
  const recurringOccurrenceIds = occurrenceSuffix
    ? baseIds.map((baseId) => `${baseId}_${occurrenceSuffix}`)
    : [];

  // directIds covers one-off events (and any row that already contains an exact API id).
  // recurringOccurrenceIds covers legacy recurring CalendarApp IDs such as xxx@google.com.
  return uniqueSortedStrings([...directIds, ...recurringOccurrenceIds]);
}

function legacyMatchingMirrorRows(group, mirrorRows) {
  const candidates = new Set(legacyExactGoogleEventIdCandidates(group));
  if (candidates.size === 0) return [];
  return preferSingleMirrorSource(
    group,
    (mirrorRows || []).filter((row) => candidates.has(String(row.googleEventId || '').trim()))
  );
}

// Steady-state join: exact Google occurrence ID on both sides.
function exactMatchingMirrorRows(group, mirrorRows) {
  if (group.calendarGoogleEventIds.length !== 1) return [];
  const exactId = group.calendarGoogleEventIds[0];
  return preferSingleMirrorSource(
    group,
    (mirrorRows || []).filter((row) => String(row.googleEventId || '').trim() === exactId)
  );
}

function matchingMirrorRows(group, mirrorRows) {
  return group.calendarGoogleEventIds.length === 1
    ? exactMatchingMirrorRows(group, mirrorRows)
    : legacyMatchingMirrorRows(group, mirrorRows);
}

async function saveExactGoogleEventId(group, mirrorRow) {
  const exactId = String(mirrorRow?.googleEventId || '').trim();
  if (!exactId) return false;

  if (group.calendarGoogleEventIds.length > 1) {
    throw new Error(`Conflicting calendar_google_event_id values already exist for ${group.eventId}`);
  }
  if (group.calendarGoogleEventIds.length === 1) {
    if (group.calendarGoogleEventIds[0] !== exactId) {
      throw new Error(`Stored exact Google event ID conflicts with monthlyLessons for ${group.eventId}`);
    }
    return false;
  }

  const result = await query(
    `UPDATE monthly_schedule
        SET calendar_google_event_id = $1
      WHERE event_id = $2
        AND (calendar_google_event_id IS NULL OR TRIM(calendar_google_event_id) = '')`,
    [exactId, group.eventId]
  );

  if ((result.rowCount ?? 0) > 0) {
    group.calendarGoogleEventIds = [exactId];
    return true;
  }
  return false;
}

async function enrichExactGoogleEventIds(groups, mirrorRows) {
  let savedGroups = 0;
  let skippedAmbiguous = 0;
  let skippedMissing = 0;

  for (const group of groups) {
    if (group.localOnly || group.calendarGoogleEventIds.length > 0) continue;
    if (group.calendarSourceEventIds.length > 1) {
      skippedAmbiguous++;
      continue;
    }

    const matches = legacyMatchingMirrorRows(group, mirrorRows);
    if (matches.length !== 1) {
      if (matches.length > 1) skippedAmbiguous++;
      else skippedMissing++;
      continue;
    }
    if (!String(matches[0]?.googleEventId || '').trim()) {
      skippedMissing++;
      continue;
    }
    if (await saveExactGoogleEventId(group, matches[0])) savedGroups++;
  }

  return { savedGroups, skippedAmbiguous, skippedMissing };
}

function baseItem(group) {
  const exactId = group.calendarGoogleEventIds.length === 1 ? group.calendarGoogleEventIds[0] : '';
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
    calendarGoogleEventId: exactId,
    calendarEventId: exactId || (group.calendarSourceEventIds.length === 1 ? group.calendarSourceEventIds[0] : group.eventId),
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
  if (group.calendarSourceEventIds.length > 1 || group.calendarGoogleEventIds.length > 1) {
    return { ...baseItem(group), status: 'ambiguous_calendar_match', reason: 'PostgreSQL contains conflicting Calendar identity for this lesson.' };
  }

  const matches = matchingMirrorRows(group, mirrorRows);
  if (matches.length === 0) {
    return {
      ...baseItem(group),
      status: 'mirror_missing',
      reason: group.calendarGoogleEventIds.length === 1
        ? 'No monthlyLessons row has this exact googleEventId.'
        : 'Exact Google event ID has not been resolved from monthlyLessons yet.',
    };
  }
  if (matches.length > 1) {
    return {
      ...baseItem(group),
      status: 'ambiguous_calendar_match',
      reason: 'More than one monthlyLessons row has this exact Google event ID.',
    };
  }

  const mirror = matches[0];
  const mirrorIds = parseMirrorStudentIds(mirror.studentId);
  const common = {
    ...baseItem(group),
    sheetStudentIds: mirrorIds,
    calendarStudentIds: mirrorIds,
    calendarGoogleEventId: String(mirror.googleEventId || baseItem(group).calendarGoogleEventId),
    calendarEventId: String(mirror.googleEventId || baseItem(group).calendarEventId),
    eventKey: String(mirror.eventKey || ''),
    mirrorRecurringEventId: String(mirror.recurringEventId || ''),
    mirrorOriginalStartTime: String(mirror.originalStartTime || ''),
    title: String(mirror.title || group.titles[0] || ''),
    start: String(mirror.start || group.startIso || ''),
  };

  if (mirrorIds.length === 0) {
    return { ...common, status: 'safe_to_tag', reason: 'Exact googleEventId matched. monthlyLessons has no student ID yet.' };
  }
  if (sameStringSet(mirrorIds, group.studentIds)) {
    return { ...common, status: 'already_tagged', reason: 'Exact googleEventId matched and monthlyLessons already contains the expected student ID(s).' };
  }
  return { ...common, status: 'tag_mismatch', reason: 'Exact googleEventId matched, but monthlyLessons contains different student ID(s).' };
}

async function loadMonthRows(month) {
  const result = await query(
    `SELECT event_id, calendar_source_event_id, calendar_google_event_id,
            student_id, student_name, title, date, start, status,
            calendar_sync_status, lesson_kind
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
    return rank !== 0 ? rank : String(a.start || '').localeCompare(String(b.start || ''));
  });
}

function countStatuses(items) {
  const counts = {};
  for (const item of items || []) counts[item.status] = (counts[item.status] || 0) + 1;
  return counts;
}

async function buildPreview(month) {
  const [rows, mirror] = await Promise.all([loadMonthRows(month), readMirrorMonth(month)]);
  const mirrorRows = mirror.rows || [];
  const groups = groupMonthlyRows(rows);

  // Additive one-time enrichment only. Existing IDs and existing calendar-poll
  // infrastructure are left untouched.
  const enrichment = await enrichExactGoogleEventIds(groups, mirrorRows);
  const items = sortItems(groups.map((group) => classifyGroup(group, mirrorRows)));
  return { rows, mirrorRows, groups, items, enrichment, counts: countStatuses(items) };
}

router.get('/preview', async (req, res) => {
  try {
    const month = String(req.query.month || currentYyyyMmJst()).trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });

    const preview = await buildPreview(month);
    return res.json({
      ok: true,
      readOnly: false,
      calendarReadOnly: true,
      idEnrichmentOnly: true,
      source: 'monthlyLessons_via_new_gas',
      directCalendarAccess: false,
      month,
      monthlyScheduleRows: preview.rows.length,
      mirrorRows: preview.mirrorRows.length,
      sheetRows: preview.mirrorRows.length,
      lessonEventsScanned: preview.groups.length,
      exactGoogleEventIdsSaved: preview.enrichment.savedGroups,
      exactGoogleEventIdsSkippedAmbiguous: preview.enrichment.skippedAmbiguous,
      exactGoogleEventIdsSkippedMissing: preview.enrichment.skippedMissing,
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
    const mirrorBefore = await readMirrorMonth(month);
    const mirrorBeforeRows = mirrorBefore.rows || [];
    const rows = await loadMonthRows(month);
    const groups = groupMonthlyRows(rows);
    const group = groups.find((candidate) => candidate.key === groupKey);
    if (!group) return res.status(404).json({ error: 'That event no longer exists in monthly_schedule. Run preview again.' });

    if (group.calendarGoogleEventIds.length === 0) {
      const legacyMatches = legacyMatchingMirrorRows(group, mirrorBeforeRows);
      if (legacyMatches.length !== 1 || !String(legacyMatches[0]?.googleEventId || '').trim()) {
        return res.status(409).json({
          error: 'Could not resolve one exact googleEventId for this lesson.',
          code: 'EXACT_GOOGLE_EVENT_ID_NOT_RESOLVED',
        });
      }
      await saveExactGoogleEventId(group, legacyMatches[0]);
    }

    const before = classifyGroup(group, mirrorBeforeRows);
    if (before.status !== 'safe_to_tag') {
      return res.status(409).json({
        error: `Mirror state is not ready for tagging: ${before.reason}`,
        status: before.status,
        item: before,
      });
    }

    const targetMatches = exactMatchingMirrorRows(group, mirrorBeforeRows);
    if (targetMatches.length !== 1) {
      return res.status(409).json({
        error: 'Could not resolve one exact monthlyLessons googleEventId target for tagging.',
        code: 'MIRROR_TARGET_NOT_EXACT',
      });
    }

    const gasResult = await callTagGas(makeGasTagRequest(group, targetMatches[0]));
    if (!gasResult?.ok || gasResult?.verified !== true || gasResult?.mirrorUpdated !== true) {
      return res.status(409).json({
        error: gasResult?.error || 'Calendar tag/mirror verification failed',
        code: gasResult?.code || 'TAG_VERIFY_FAILED',
        calendarTagged: !!gasResult?.calendarTagged,
        calendarVerified: !!gasResult?.calendarVerified,
        mirrorUpdated: !!gasResult?.mirrorUpdated,
      });
    }

    const postVerify = await verifyMirrorAfterWrite(month, group);
    const after = postVerify.item;
    if (!postVerify.ok || !after) {
      const detail = after?.reason || postVerify.error?.message || 'monthlyLessons did not return the verified student ID set';
      return res.status(502).json({
        error: `Calendar was verified, but monthlyLessons did not verify afterward: ${detail}`,
        code: 'MIRROR_POST_WRITE_VERIFY_FAILED',
        calendarVerified: true,
        mirrorUpdated: true,
        mirrorVerifyAttempts: postVerify.attempts,
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
      mirrorVerifyAttempts: postVerify.attempts,
      result: {
        eventId: group.eventId,
        calendarGoogleEventId: group.calendarGoogleEventIds[0] || '',
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
  return res.status(409).json({ error: 'Bulk student-number tagging is temporarily disabled. Use Tag this event.' });
});

export default router;
