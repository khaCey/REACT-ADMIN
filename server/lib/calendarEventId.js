/**
 * Map monthly_schedule.event_id (often raw Google id + date/time disambiguation suffix)
 * to the Calendar event id GAS should use. For recurring series, the poll may store only
 * the series master id; append Google's instance suffix from the occurrence start time.
 */

/** Suffix we append in calendarSync.buildMonthlyScheduleRows: _YYYY-MM-DD or _YYYY-MM-DD_HH-mm-ss (UTC). */
const OUR_DISAMBIGUATION_SUFFIX_RE = /_(\d{4}-\d{2}-\d{2})(?:_(\d{2})-(\d{2})-(\d{2}))?$/;

/** Google Calendar recurring instance id ends with _YYYYMMDDTHHMMSSZ */
export const GOOGLE_INSTANCE_SUFFIX_RE = /_\d{8}T\d{6}Z$/i;

export function stripOurMonthlyDisambiguationSuffix(monthlyEventId) {
  return String(monthlyEventId || '')
    .trim()
    .replace(/_\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}-\d{2})?$/, '');
}

/**
 * @param {string|Date} isoOrDate
 * @returns {string|null} e.g. 20260321T090000Z
 */
export function formatGoogleCalendarInstanceSuffix(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}${mo}${day}T${h}${mi}${s}Z`;
}

/**
 * Parse occurrence UTC instant from our DB event_id suffix (from buildMonthlyScheduleRows).
 * @param {string} monthlyEventId
 * @returns {string|null} ISO string
 */
export function occurrenceStartIsoFromMonthlyEventId(monthlyEventId) {
  const m = String(monthlyEventId || '').match(OUR_DISAMBIGUATION_SUFFIX_RE);
  if (!m) return null;
  const [, date, hh, mm, ss] = m;
  if (hh != null && mm != null && ss != null) {
    const d = new Date(`${date}T${hh}:${mm}:${ss}Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Date-only disambiguation must not invent midnight UTC — that builds the wrong Google instance
  // suffix and can make the server send a bogus id while the real lesson time lives on the row.
  return null;
}

/**
 * @param {Array<{ start?: Date|string|null }>|null|undefined} rows
 * @returns {string|null}
 */
export function occurrenceStartIsoFromScheduleRows(rows) {
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!row?.start) return null;
  const d = new Date(row.start);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * True when we only have a recurring series master id (no per-occurrence instance id from poll).
 * @param {string} monthlyEventId
 * @param {string|null|undefined} calendarSourceEventId
 */
export function isAmbiguousRecurringSeriesMaster(monthlyEventId, calendarSourceEventId = null) {
  const src = String(calendarSourceEventId || '').trim();
  if (src && GOOGLE_INSTANCE_SUFFIX_RE.test(src)) return false;
  const calendarPart = stripOurMonthlyDisambiguationSuffix(monthlyEventId);
  if (!calendarPart || GOOGLE_INSTANCE_SUFFIX_RE.test(calendarPart)) return false;
  return true;
}

/**
 * Resolve the Google Calendar event id for GAS lesson_book_update / lesson_book_delete.
 * @param {string} monthlyEventId - monthly_schedule.event_id
 * @param {string|null|undefined} occurrenceStartIso - original occurrence start (preferred)
 * @param {string|null|undefined} calendarSourceEventId - exact id from calendar poll when available
 * @returns {string}
 */
export function gasCalendarEventIdFromMonthly(
  monthlyEventId,
  occurrenceStartIso = null,
  calendarSourceEventId = null
) {
  const id = String(monthlyEventId || '').trim();
  if (!id) return '';

  // After stripping our _YYYY-MM-DD disambiguation, the key may already be Google's instance id
  // (…_YYYYMMDDTHHMMSSZ). Prefer that over calendar_source_event_id, which is often the bare series
  // master — returning src would make GAS delete the whole recurring series.
  const strippedEarly = stripOurMonthlyDisambiguationSuffix(id);
  if (GOOGLE_INSTANCE_SUFFIX_RE.test(strippedEarly)) {
    return strippedEarly;
  }

  const src = String(calendarSourceEventId || '').trim();
  if (src) {
    if (GOOGLE_INSTANCE_SUFFIX_RE.test(src)) return src;
    const strippedId = stripOurMonthlyDisambiguationSuffix(id);
    const iso =
      (occurrenceStartIso && String(occurrenceStartIso).trim()) ||
      occurrenceStartIsoFromMonthlyEventId(id) ||
      null;
    // Bare poll id often equals the recurring series master. When it disagrees with stripped event_id,
    // prefer strippedId (authoritative for this row) so we never call GAS with only the master.
    if (iso && !GOOGLE_INSTANCE_SUFFIX_RE.test(strippedId)) {
      const masterBase = strippedId && src !== strippedId ? strippedId : src || strippedId;
      if (masterBase && !GOOGLE_INSTANCE_SUFFIX_RE.test(masterBase)) {
        const instanceSuffix = formatGoogleCalendarInstanceSuffix(iso);
        if (instanceSuffix) return `${masterBase}_${instanceSuffix}`;
      }
    }
    return src;
  }

  const calendarPart = stripOurMonthlyDisambiguationSuffix(id);
  if (!calendarPart) return id;

  const iso =
    (occurrenceStartIso && String(occurrenceStartIso).trim()) ||
    occurrenceStartIsoFromMonthlyEventId(id) ||
    null;
  if (iso) {
    const instanceSuffix = formatGoogleCalendarInstanceSuffix(iso);
    if (instanceSuffix) {
      return `${calendarPart}_${instanceSuffix}`;
    }
  }

  return calendarPart;
}
