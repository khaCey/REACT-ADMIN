/**
 * Normalize entries from GAS diff.removed for client-side map keys and server payloads.
 * Supports canonical string keys `eventID|studentName` and object shapes from camel/snake fields.
 */

export function normalizeRemovedDiffEntry(entry) {
  if (entry == null) return null
  if (typeof entry === 'string') {
    const parts = entry.split('|')
    if (parts.length < 2) return null
    const eventID = parts[0].trim()
    if (!eventID) return null
    let studentParts = parts.slice(1)
    let lessonDate = null
    const last = studentParts[studentParts.length - 1]?.trim() || ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(last)) {
      lessonDate = last
      studentParts = studentParts.slice(0, -1)
    }
    const studentName = studentParts.join('|').trim()
    if (!studentName) return null
    return { eventID, studentName, lessonDate }
  }
  if (typeof entry === 'object') {
    const eventID = (entry.eventID ?? entry.event_id ?? '').toString().trim()
    const studentName = (entry.studentName ?? entry.student_name ?? '').toString().trim()
    const ldRaw = String(entry.date ?? entry.lesson_date ?? '')
      .trim()
      .slice(0, 10)
    const lessonDate = /^\d{4}-\d{2}-\d{2}$/.test(ldRaw) ? ldRaw : null
    if (!eventID || !studentName) return null
    return { eventID, studentName, lessonDate }
  }
  return null
}

/** Poll `removed` keys: `eventID|studentName|YYYY-MM-DD` when date is present (recurring-safe), else legacy two-part. */
export function removedEntryRowKey(p) {
  const d = p.lessonDate && /^\d{4}-\d{2}-\d{2}$/.test(String(p.lessonDate)) ? String(p.lessonDate) : ''
  return d ? `${p.eventID}|${p.studentName}|${d}` : `${p.eventID}|${p.studentName}`
}

export function dedupeRemovedEntries(parsedList) {
  const m = new Map()
  for (const p of parsedList) {
    const k = `${p.eventID}\t${p.studentName}\t${p.lessonDate || ''}`
    m.set(k, p)
  }
  return Array.from(m.values())
}
