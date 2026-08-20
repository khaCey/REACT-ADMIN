import { Router } from 'express';
import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query } from '../db/index.js';
import {
  gasCalendarEventIdFromMonthly,
  stripOurMonthlyDisambiguationSuffix,
} from '../lib/calendarEventId.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function currentYyyyMmJst() {
  const jst = new Date(Date.now() + JST_OFFSET_MS);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthRangeUtc(yyyyMm) {
  const match = String(yyyyMm || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  // Midnight JST converted to UTC.
  const start = new Date(Date.UTC(year, month - 1, 1, -9, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, -9, 0, 0, 0));
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

function getCalendarAuth() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  let credentials = null;

  if (keyPath) {
    const resolved = join(__dirname, '..', '..', keyPath.replace(/^\.\//, ''));
    credentials = JSON.parse(readFileSync(resolved, 'utf8'));
  } else if (keyJson) {
    const raw = keyJson.startsWith('{')
      ? keyJson
      : Buffer.from(keyJson, 'base64').toString('utf8');
    credentials = JSON.parse(raw);
  }

  if (!credentials) return null;

  // Intentionally READ ONLY. This preview endpoint cannot patch/create/delete Calendar events.
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
}

function getCalendarClient() {
  const auth = getCalendarAuth();
  return auth ? google.calendar({ version: 'v3', auth }) : null;
}

async function fetchMonthEvents(calendarId, yyyyMm) {
  const calendar = getCalendarClient();
  if (!calendar) {
    throw new Error('Google Calendar service account is not configured');
  }

  const range = monthRangeUtc(yyyyMm);
  if (!range) throw new Error('month must be YYYY-MM');

  const events = [];
  let pageToken = undefined;

  do {
    const response = await calendar.events.list({
      calendarId,
      timeMin: range.timeMin,
      timeMax: range.timeMax,
      singleEvents: true,
      showDeleted: true,
      orderBy: 'startTime',
      maxResults: 2500,
      pageToken,
    });

    events.push(...(response.data.items || []));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return events;
}

function splitIds(value) {
  return String(value || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function uniqueSortedStrings(values) {
  return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Transitional parser. Supports the new canonical tag plus descriptions that
 * REACT-ADMIN already writes today.
 */
function parseStudentIdsFromDescription(description) {
  const text = String(description || '');
  const ids = [];

  for (const match of text.matchAll(/\[GS_STUDENT_IDS\s*:\s*([^\]]+)\]/gi)) {
    ids.push(...splitIds(match[1]));
  }

  for (const match of text.matchAll(/^\s*StudentIds\s*:\s*(.+)$/gim)) {
    ids.push(...splitIds(match[1]));
  }

  for (const match of text.matchAll(/^\s*StudentId\s*:\s*([^\s,]+)\s*$/gim)) {
    ids.push(String(match[1]).trim());
  }

  return uniqueSortedStrings(ids);
}

function sameStringSet(a, b) {
  const left = uniqueSortedStrings(a);
  const right = uniqueSortedStrings(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function eventStartValue(event) {
  return event?.start?.dateTime || event?.start?.date || '';
}

function eventEndValue(event) {
  return event?.end?.dateTime || event?.end?.date || '';
}

function rowCandidateIds(row) {
  const eventId = String(row.event_id || '').trim();
  const sourceId = String(row.calendar_source_event_id || '').trim();
  let startIso = null;
  if (row.start) {
    const parsed = new Date(row.start);
    if (!Number.isNaN(parsed.getTime())) startIso = parsed.toISOString();
  }

  const resolved = gasCalendarEventIdFromMonthly(eventId, startIso, sourceId || null);
  return uniqueSortedStrings([
    resolved,
    sourceId,
    stripOurMonthlyDisambiguationSuffix(eventId),
    eventId,
  ]);
}

function classifyGroup(group, calendarEvent) {
  if (group.localOnly) {
    return {
      status: 'local_only',
      reason: 'Local/optimistic booking ID is not a confirmed Google Calendar event.',
    };
  }
  if (group.calendarSyncStatuses.some((status) => status && status !== 'synced')) {
    return {
      status: 'not_synced',
      reason: 'At least one monthly_schedule row is not calendar_sync_status=synced.',
    };
  }
  if (!calendarEvent) {
    return {
      status: 'calendar_missing',
      reason: 'No exact Calendar occurrence was found for this monthly_schedule event.',
    };
  }
  if (group.studentIds.length === 0) {
    return {
      status: 'missing_student_id',
      reason: 'The matched monthly_schedule rows do not contain a student_id.',
    };
  }

  const calendarIds = parseStudentIdsFromDescription(calendarEvent.description);
  if (calendarIds.length === 0) {
    return {
      status: 'safe_to_tag',
      reason: 'Exact Calendar event found and no existing student-ID metadata was detected.',
      calendarStudentIds: [],
    };
  }
  if (sameStringSet(calendarIds, group.studentIds)) {
    return {
      status: 'already_tagged',
      reason: 'Calendar description already contains the same student ID set.',
      calendarStudentIds: calendarIds,
    };
  }
  return {
    status: 'tag_mismatch',
    reason: 'Calendar description contains student IDs that do not match monthly_schedule.',
    calendarStudentIds: calendarIds,
  };
}

router.get('/preview', async (req, res) => {
  try {
    const month = String(req.query.month || currentYyyyMmJst()).trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month must be YYYY-MM' });
    }

    const calendarId = String(process.env.GOOGLE_CALENDAR_ID || '').trim();
    if (!calendarId) {
      return res.status(400).json({ error: 'GOOGLE_CALENDAR_ID is not configured' });
    }

    const [calendarEvents, rowsResult] = await Promise.all([
      fetchMonthEvents(calendarId, month),
      query(
        `SELECT event_id, calendar_source_event_id, student_id, student_name, title,
                date, start, status, calendar_sync_status
           FROM monthly_schedule
          WHERE date IS NOT NULL
            AND to_char(date, 'YYYY-MM') = $1
          ORDER BY start ASC NULLS LAST, event_id ASC, student_id ASC NULLS LAST`,
        [month]
      ),
    ]);

    const eventById = new Map();
    for (const event of calendarEvents) {
      const id = String(event?.id || '').trim();
      if (id) eventById.set(id, event);
    }

    const groups = new Map();

    for (const row of rowsResult.rows || []) {
      const rawEventId = String(row.event_id || '').trim();
      const candidates = rowCandidateIds(row);
      const matchedIds = candidates.filter((id) => eventById.has(id));
      const matchedCalendarId = matchedIds.length === 1 ? matchedIds[0] : '';
      const groupKey = matchedCalendarId || `unmatched:${rawEventId}:${row.start ? new Date(row.start).toISOString() : ''}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          groupKey,
          rawEventIds: [],
          candidateCalendarIds: [],
          matchedCalendarId,
          studentIds: [],
          studentNames: [],
          titles: [],
          starts: [],
          statuses: [],
          calendarSyncStatuses: [],
          localOnly: false,
          ambiguousMatch: false,
        });
      }

      const group = groups.get(groupKey);
      group.rawEventIds.push(rawEventId);
      group.candidateCalendarIds.push(...candidates);
      if (row.student_id != null && row.student_id !== '') group.studentIds.push(String(row.student_id));
      if (row.student_name) group.studentNames.push(String(row.student_name));
      if (row.title) group.titles.push(String(row.title));
      if (row.start) group.starts.push(new Date(row.start).toISOString());
      if (row.status) group.statuses.push(String(row.status).toLowerCase());
      if (row.calendar_sync_status) group.calendarSyncStatuses.push(String(row.calendar_sync_status).toLowerCase());
      if (/^(local-booking-|optimistic-)/i.test(rawEventId)) group.localOnly = true;
      if (matchedIds.length > 1) group.ambiguousMatch = true;
    }

    const items = [];

    for (const group of groups.values()) {
      group.rawEventIds = uniqueSortedStrings(group.rawEventIds);
      group.candidateCalendarIds = uniqueSortedStrings(group.candidateCalendarIds);
      group.studentIds = uniqueSortedStrings(group.studentIds);
      group.studentNames = uniqueSortedStrings(group.studentNames);
      group.titles = uniqueSortedStrings(group.titles);
      group.starts = uniqueSortedStrings(group.starts);
      group.statuses = uniqueSortedStrings(group.statuses);
      group.calendarSyncStatuses = uniqueSortedStrings(group.calendarSyncStatuses);

      let calendarEvent = group.matchedCalendarId
        ? eventById.get(group.matchedCalendarId) || null
        : null;

      let classification;
      if (group.ambiguousMatch) {
        classification = {
          status: 'ambiguous_calendar_match',
          reason: 'More than one Calendar event ID candidate matched. No write should be attempted.',
          calendarStudentIds: [],
        };
        calendarEvent = null;
      } else {
        classification = classifyGroup(group, calendarEvent);
      }

      const calendarStudentIds =
        classification.calendarStudentIds ||
        parseStudentIdsFromDescription(calendarEvent?.description || '');

      items.push({
        status: classification.status,
        reason: classification.reason,
        eventId: group.rawEventIds[0] || '',
        rawEventIds: group.rawEventIds,
        calendarEventId: group.matchedCalendarId || '',
        candidateCalendarIds: group.candidateCalendarIds,
        title: calendarEvent?.summary || group.titles[0] || '',
        start: eventStartValue(calendarEvent) || group.starts[0] || '',
        end: eventEndValue(calendarEvent),
        calendarStatus: calendarEvent?.status || '',
        dbStatuses: group.statuses,
        calendarSyncStatuses: group.calendarSyncStatuses,
        studentIds: group.studentIds,
        studentNames: group.studentNames,
        calendarStudentIds,
        description: String(calendarEvent?.description || ''),
      });
    }

    const order = {
      safe_to_tag: 0,
      tag_mismatch: 1,
      already_tagged: 2,
      calendar_missing: 3,
      ambiguous_calendar_match: 4,
      not_synced: 5,
      local_only: 6,
      missing_student_id: 7,
    };
    items.sort((a, b) => {
      const rank = (order[a.status] ?? 99) - (order[b.status] ?? 99);
      if (rank !== 0) return rank;
      return String(a.start || '').localeCompare(String(b.start || ''));
    });

    const counts = {};
    for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;

    res.json({
      ok: true,
      readOnly: true,
      month,
      calendarId,
      calendarEventsFetched: calendarEvents.length,
      monthlyScheduleRows: (rowsResult.rows || []).length,
      counts,
      items,
    });
  } catch (err) {
    console.error('[calendar-student-id-backfill/preview]', err.message);
    res.status(500).json({ error: err.message || 'Failed to build Calendar student ID backfill preview' });
  }
});

export default router;
