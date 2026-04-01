/** Break presets are always 1 hour: end = start + 60 minutes (cap 23:59 same calendar day). */
export function endTimeOneHourAfterStart(startHHMM) {
  const s = String(startHHMM || '').trim().slice(0, 5)
  if (!/^\d{2}:\d{2}$/.test(s)) return ''
  const [h, m] = s.split(':').map(Number)
  let total = h * 60 + m + 60
  if (total > 24 * 60) total = 24 * 60
  if (total === 24 * 60) return '23:59'
  const eh = Math.floor(total / 60)
  const em = total % 60
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`
}
