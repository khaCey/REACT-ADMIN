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
