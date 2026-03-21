/**
 * Calendar Polling API — client for the GAS Calendar Webhook.
 * See POLLING_API_SPEC.md for full spec.
 *
 * Dev: VITE_CALENDAR_POLL_* from Vite env.
 * Production (e.g. PM2): same values come from server root .env (CALENDAR_POLL_*) via /api/config/calendar-poll after login.
 */

const TOKEN_KEY = 'staff_token'

const viteBase = () => (import.meta.env.VITE_CALENDAR_POLL_URL || '').trim()
const viteKey = () => (import.meta.env.VITE_CALENDAR_POLL_API_KEY || '').trim()

let runtimeUrl = ''
let runtimeApiKey = ''
let runtimeLoadPromise = null

export function clearPollingRuntimeConfig() {
  runtimeUrl = ''
  runtimeApiKey = ''
  runtimeLoadPromise = null
}

/**
 * Load CALENDAR_POLL_* from API when Vite env is empty (production bundle).
 */
export async function ensurePollingConfig() {
  if (viteBase() && viteKey()) return true
  if (runtimeUrl && runtimeApiKey) return true
  const token = localStorage.getItem(TOKEN_KEY)
  if (!token) return false
  if (!runtimeLoadPromise) {
    runtimeLoadPromise = (async () => {
      try {
        const res = await fetch('/api/config/calendar-poll', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        const u = (data.url || '').trim()
        const k = (data.apiKey || '').trim()
        if (u && k) {
          runtimeUrl = u.replace(/\/$/, '')
          runtimeApiKey = k
        }
      } finally {
        runtimeLoadPromise = null
      }
    })()
  }
  await runtimeLoadPromise
  return !!(runtimeUrl && runtimeApiKey)
}

function getBaseUrl() {
  const v = viteBase().replace(/\/$/, '')
  if (v) return v
  return (runtimeUrl || '').replace(/\/$/, '')
}

function getApiKey() {
  return viteKey() || runtimeApiKey || ''
}

function buildUrl(full = false, opts = {}) {
  const base = getBaseUrl()
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
  await ensurePollingConfig()
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
  await ensurePollingConfig()
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
  await ensurePollingConfig()
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
  await ensurePollingConfig()
  const url = buildUrl(true, { year: String(year) })
  if (!url) return { data: [], _skipped: true }
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (data.error) throw new Error(data.error)
  return data
}

/**
 * Check if polling is configured (URL and key present — Vite or runtime from server).
 */
export function isPollingConfigured() {
  return !!(getBaseUrl() && getApiKey())
}
