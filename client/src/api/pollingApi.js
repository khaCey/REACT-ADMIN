/**
 * Calendar Polling API — client for the GAS Calendar Webhook.
 * See POLLING_API_SPEC.md for full spec.
 *
 * Dev: VITE_CALENDAR_POLL_* from Vite env.
 * Production (e.g. PM2): same values come from server root .env (CALENDAR_POLL_*) via /api/config/calendar-poll after login.
 */

import { getStoredToken } from '../utils/authSession'
import { addOneMonthYyyyMm, getCurrentYyyyMmJst } from '../utils/jstMonth'

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
  const token = getStoredToken()
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
  console.log('[calendar poll] GAS diff poll response:', data)
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
  const rows = Array.isArray(data.data) ? data.data : []
  console.log('[calendar poll] GAS full fetch response:', {
    cacheVersion: data.cacheVersion,
    lastUpdated: data.lastUpdated,
    rowCount: rows.length,
    data: rows,
  })
  return data
}

function pollRowKey(row) {
  if (!row || typeof row !== 'object') return ''
  const id = String(row.eventID ?? '').trim()
  const sn = String(row.studentName ?? '').trim()
  if (!id || !sn) return ''
  return `${id}|${sn}`
}

function mergeDedupePollRows(rowsA, rowsB) {
  const map = new Map()
  for (const row of rowsA) {
    const k = pollRowKey(row)
    if (k) map.set(k, row)
  }
  for (const row of rowsB) {
    const k = pollRowKey(row)
    if (k) map.set(k, row)
  }
  return Array.from(map.values())
}

/**
 * Current + next JST month via GAS month backfill (Calendar → rows), merged and deduped.
 * @returns {Promise<{ data: Array, lastUpdated?: string, cacheVersion?: number, _skipped?: boolean }>}
 */
export async function fetchCalendarCurrentAndNextMonths() {
  await ensurePollingConfig()
  if (!isPollingConfigured()) {
    return { data: [], _skipped: true }
  }
  const curYm = getCurrentYyyyMmJst()
  const nextYm = addOneMonthYyyyMm(curYm)
  if (!nextYm) {
    return { data: [], _skipped: true }
  }

  const [curRes, nextRes] = await Promise.all([
    fetchCalendarMonth(curYm),
    fetchCalendarMonth(nextYm),
  ])

  if (curRes._skipped && nextRes._skipped) {
    return { data: [], _skipped: true }
  }

  const rowsCur = Array.isArray(curRes.data) ? curRes.data : []
  const rowsNext = Array.isArray(nextRes.data) ? nextRes.data : []
  const merged = mergeDedupePollRows(rowsCur, rowsNext)

  const t1 = curRes.lastUpdated ? Date.parse(curRes.lastUpdated) : NaN
  const t2 = nextRes.lastUpdated ? Date.parse(nextRes.lastUpdated) : NaN
  const parsed = [t1, t2].filter((t) => !Number.isNaN(t))
  const lastTs = parsed.length > 0 ? Math.max(...parsed, Date.now()) : Date.now()
  const lastUpdated = new Date(lastTs).toISOString()

  console.log('[calendar poll] GAS cur+next month backfill:', {
    curYm,
    nextYm,
    rowsCur: rowsCur.length,
    rowsNext: rowsNext.length,
    merged: merged.length,
  })

  return {
    data: merged,
    lastUpdated,
    cacheVersion: 0,
  }
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
