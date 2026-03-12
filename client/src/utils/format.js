const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Convert YYYY-MM to "January", "February", etc (month name only) */
export function formatMonth(val) {
  if (!val) return ''
  const s = String(val).trim()
  const m = s.match(/^(\d{4})-(\d{2})$/)
  if (m) {
    const monthIdx = parseInt(m[2], 10) - 1
    return MONTH_NAMES[monthIdx] || m[2]
  }
  return s
}

/** Display number without trailing .00 for whole numbers (4 not 4.00) */
export function formatNumber(val) {
  if (val == null || val === '') return '-'
  const n = Number(val)
  if (isNaN(n)) return String(val)
  return n % 1 === 0 ? String(Math.round(n)) : String(n)
}

/** Format date as YYYY-MM-DD */
export function formatDate(val) {
  if (!val) return ''
  const d = new Date(val)
  if (isNaN(d.getTime())) return String(val)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Format ISO date string as YYYY-MM-DD using UTC components (date only, no time) */
export function formatDateUTC(val) {
  if (!val) return ''
  const d = new Date(val)
  if (isNaN(d.getTime())) return String(val)
  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

/** Format ISO date string as "4 Mar 2026, 15:30 UTC" using UTC components */
export function formatDateTimeUTC(val) {
  if (!val) return ''
  const d = new Date(val)
  if (isNaN(d.getTime())) return String(val)
  const day = d.getUTCDate()
  const month = MONTH_NAMES_SHORT[d.getUTCMonth()] || ''
  const year = d.getUTCFullYear()
  const h = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  return `${day} ${month} ${year}, ${h}:${m} UTC`
}
