import { clearStoredSession, getStoredToken } from '../utils/authSession'

const API_BASE = '/api'

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

export function getCalendarStudentIdBackfillPreview(month) {
  const params = new URLSearchParams()
  if (month) params.set('month', String(month))
  const qs = params.toString()
  return fetchJson(`/calendar/student-id-backfill/preview${qs ? `?${qs}` : ''}`)
}

export async function applyOneCalendarStudentIdBackfill(month, groupKey) {
  const result = await fetchJson('/calendar/student-id-backfill/apply-one', {
    method: 'POST',
    body: JSON.stringify({ month, groupKey }),
  })

  // Fail closed. Success means the exact Calendar event was verified AND the
  // new monthlyLessons mirror was updated and re-read successfully.
  if (result?.ok !== true || result?.verified !== true || result?.mirrorUpdated !== true) {
    throw new Error('Calendar/mirror verification did not complete. No success was recorded.')
  }

  return result
}

export function applyCalendarStudentIdBackfill() {
  return Promise.reject(new Error('Bulk student-number tagging is temporarily disabled. Use Tag this event.'))
}
