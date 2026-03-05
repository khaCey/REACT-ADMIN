/**
 * Calendar Polling API — client for the GAS Calendar Webhook.
 * See POLLING_API_SPEC.md for full spec.
 */

const getBaseUrl = () => import.meta.env.VITE_CALENDAR_POLL_URL || ''
const getApiKey = () => import.meta.env.VITE_CALENDAR_POLL_API_KEY || ''

function buildUrl(full = false, opts = {}) {
  const base = getBaseUrl().replace(/\/$/, '')
  const key = getApiKey()
  if (!base || !key) return null
  const params = new URLSearchParams({ key })
  if (full) params.set('full', '1')
  if (opts.month) params.set('month', opts.month)
  if (opts.year) params.set('year', opts.year)
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
 * Fetch schedule for a specific month (retroactive backfill). Fetches directly from Calendar.
 * @param {string} month - YYYY-MM (e.g. '2024-06')
 * @returns {Promise<{ data: Array, backfill?: object }>}
 */
export async function fetchCalendarMonth(month) {
  const url = buildUrl(true, { month })
  if (!url) return { data: [], _skipped: true }
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (data.error) throw new Error(data.error)
  return data
}

/**
 * Fetch schedule for a full year (retroactive backfill). Fetches directly from Calendar.
 * @param {string|number} year - e.g. 2024
 * @returns {Promise<{ data: Array, backfill?: object }>}
 */
export async function fetchCalendarYear(year) {
  const url = buildUrl(true, { year: String(year) })
  if (!url) return { data: [], _skipped: true }
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (data.error) throw new Error(data.error)
  return data
}

/**
 * Check if polling is configured (URL and key present).
 */
export function isPollingConfigured() {
  return !!(getBaseUrl() && getApiKey())
}
