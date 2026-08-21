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

  // The server performs a post-write Calendar verification. Some deployed GAS
  // versions may return ok:true without the optional actionTaken field. If the
  // event is verified as already_tagged after starting from safe_to_tag, the
  // single-event write succeeded even when the raw counters are both zero.
  if (
    result?.verified === true &&
    Number(result?.tagged || 0) === 0 &&
    Number(result?.alreadyTagged || 0) === 0 &&
    Number(result?.failed || 0) === 0
  ) {
    return {
      ...result,
      tagged: 1,
      verifiedByCalendar: true,
    }
  }

  return result
}

export function applyCalendarStudentIdBackfill(month) {
  return fetchJson('/calendar/student-id-backfill/apply', {
    method: 'POST',
    body: JSON.stringify({ month }),
  })
}