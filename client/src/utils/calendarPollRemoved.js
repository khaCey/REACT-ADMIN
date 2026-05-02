/**
 * Normalize entries from GAS diff.removed for client-side map keys and server payloads.
 * Supports canonical string keys `eventID|studentName` and object shapes from camel/snake fields.
 */

export function normalizeRemovedDiffEntry(entry) {
  if (entry == null) return null
  if (typeof entry === 'string') {
    const i = entry.indexOf('|')
    if (i <= 0) return null
    const eventID = entry.slice(0, i).trim()
    const studentName = entry.slice(i + 1).trim()
    if (!eventID || !studentName) return null
    return { eventID, studentName }
  }
  if (typeof entry === 'object') {
    const eventID = (entry.eventID ?? entry.event_id ?? '').toString().trim()
    const studentName = (entry.studentName ?? entry.student_name ?? '').toString().trim()
    if (!eventID || !studentName) return null
    return { eventID, studentName }
  }
  return null
}

/** Same format as rowKey() in useCalendarPolling — must match monthly_schedule row keys in cache. */
export function removedEntryRowKey(p) {
  return `${p.eventID}|${p.studentName}`
}

export function dedupeRemovedEntries(parsedList) {
  const m = new Map()
  for (const p of parsedList) {
    const k = `${p.eventID}\t${p.studentName}`
    m.set(k, p)
  }
  return Array.from(m.values())
}
