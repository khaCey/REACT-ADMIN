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

export function applyOneCalendarStudentIdBackfill(month, groupKey) {
  return fetchJson('/calendar/student-id-backfill/apply-one', {
    method: 'POST',
    body: JSON.stringify({ month, groupKey }),
  })
}

export function applyCalendarStudentIdBackfill(month) {
  return fetchJson('/calendar/student-id-backfill/apply', {
    method: 'POST',
    body: JSON.stringify({ month }),
  })
}