/**
 * Calendar Polling API — client for the GAS Calendar Webhook.
 * See POLLING_API_SPEC.md for full spec.
 */

const getBaseUrl = () => import.meta.env.VITE_CALENDAR_POLL_URL || ''
const getApiKey = () => import.meta.env.VITE_CALENDAR_POLL_API_KEY || ''

function buildUrl(full = false) {
  const base = getBaseUrl().replace(/\/$/, '')
  const key = getApiKey()
  if (!base || !key) return null
  const params = new URLSearchParams({ key })
  if (full) params.set('full', '1')
  return `${base}?${params.toString()}`
}

/**
 * Poll for changes (diff only).
 * @returns {Promise<{ changed: boolean, diff?: object }>}
 */
export async function pollCalendarChanges() {
  const url = buildUrl(false)
  if (!url) {
    return { changed: false, _skipped: true }
  }
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (data.error) {
    throw new Error(data.error)
  }
  return data
}

/**
 * Get full MonthlySchedule data (initial load or refresh).
 * @returns {Promise<{ cacheVersion: number, lastUpdated: string, data: Array }>}
 */
export async function fetchFullCalendar() {
  const url = buildUrl(true)
  if (!url) {
    return { data: [], _skipped: true }
  }
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (data.error) {
    throw new Error(data.error)
  }
  return data
}

/**
 * Check if polling is configured (URL and key present).
 */
export function isPollingConfigured() {
  return !!(getBaseUrl() && getApiKey())
}
