import { clearStoredSession, getStoredToken } from '../utils/authSession'

const API_BASE = '/api'

let lastPreview = null
let useCachedPreviewOnce = false

async function fetchJson(path, options = {}) {
  const token = getStoredToken()
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body,
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    if (res.status === 401) clearStoredSession()
    throw new Error(body?.error || res.statusText || 'Request failed')
  }

  return res.json()
}

function updateCachedPreviewAfterSingleTag(month, groupKey, applyResult) {
  if (!lastPreview || String(lastPreview.month || '') !== String(month || '')) return

  const items = Array.isArray(lastPreview.items) ? lastPreview.items : []
  const index = items.findIndex((item) => item?.groupKey === groupKey)
  if (index < 0) return

  const previous = items[index]
  const serverItem = applyResult?.item && typeof applyResult.item === 'object'
    ? applyResult.item
    : {}

  const updated = {
    ...previous,
    ...serverItem,
    groupKey: previous.groupKey,
    status: 'already_tagged',
    reason: 'Exact Calendar event was tagged and verified.',
    calendarStudentIds:
      Array.isArray(serverItem.calendarStudentIds) && serverItem.calendarStudentIds.length > 0
        ? serverItem.calendarStudentIds
        : (Array.isArray(previous.studentIds) ? previous.studentIds : []),
  }

  const nextItems = [...items]
  nextItems[index] = updated

  const counts = { ...(lastPreview.counts || {}) }
  if (previous.status === 'safe_to_tag') {
    counts.safe_to_tag = Math.max(0, Number(counts.safe_to_tag || 0) - 1)
    counts.already_tagged = Number(counts.already_tagged || 0) + 1
  }

  lastPreview = {
    ...lastPreview,
    counts,
    items: nextItems,
  }

  // CalendarStudentIdBackfill.jsx asks for a full preview immediately after a
  // successful one-event write. Returning this verified local update once keeps
  // the row responsive instead of blocking the button on a 200+ event rescan.
  useCachedPreviewOnce = true
}

export async function getCalendarStudentIdBackfillPreview(month) {
  if (
    useCachedPreviewOnce &&
    lastPreview &&
    String(lastPreview.month || '') === String(month || '')
  ) {
    useCachedPreviewOnce = false
    return lastPreview
  }

  const params = new URLSearchParams()
  if (month) params.set('month', String(month))
  const qs = params.toString()
  const preview = await fetchJson(`/calendar/student-id-backfill/preview${qs ? `?${qs}` : ''}`)
  lastPreview = preview
  useCachedPreviewOnce = false
  return preview
}

export async function applyOneCalendarStudentIdBackfill(month, groupKey) {
  const result = await fetchJson('/calendar/student-id-backfill/apply-one', {
    method: 'POST',
    body: JSON.stringify({ month, groupKey }),
  })

  // Fail closed. Do not turn ambiguous/zero-count responses into success.
  // The standalone GAS verifies the exact patched Calendar event itself;
  // REACT-ADMIN must still refuse any response that its server did not verify.
  if (result?.ok !== true || result?.verified !== true) {
    throw new Error('Exact Calendar post-write verification did not succeed. No success was recorded.')
  }

  updateCachedPreviewAfterSingleTag(month, groupKey, result)
  return result
}

export function applyCalendarStudentIdBackfill() {
  // Temporarily disabled while the exact single-event path is being validated.
  // Keeping this guard here prevents accidental mass writes even if an older UI
  // still renders the bulk button.
  return Promise.reject(new Error('Bulk student-number tagging is temporarily disabled. Verify one event successfully first.'))
}
