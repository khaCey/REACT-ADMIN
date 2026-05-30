/** Asia/Tokyo calendar month helpers (match server `latest-by-month` and GAS backfill). */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Japan-facing calendar date (YYYY-MM-DD) for a UTC instant — matches server `utcToJstDateAndTime`. */
export function utcInstantToJstYyyyMmDd(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  if (Number.isNaN(d.getTime())) return ''
  const jstMs = d.getTime() + JST_OFFSET_MS
  const jstDay = Math.floor(jstMs / MS_PER_DAY)
  const jd = new Date(jstDay * MS_PER_DAY)
  const y = jd.getUTCFullYear()
  const mo = jd.getUTCMonth() + 1
  const day = jd.getUTCDate()
  return `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function getCurrentYyyyMmJst() {
  const jst = new Date(Date.now() + JST_OFFSET_MS)
  const y = jst.getUTCFullYear()
  const m = jst.getUTCMonth() + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

export function addOneMonthYyyyMm(yyyyMm) {
  const [ys, ms] = String(yyyyMm).split('-')
  const y = parseInt(ys, 10)
  const mo = parseInt(ms, 10)
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return null
  let ny = y
  let nm = mo + 1
  if (nm > 12) {
    nm = 1
    ny += 1
  }
  return `${ny}-${String(nm).padStart(2, '0')}`
}
