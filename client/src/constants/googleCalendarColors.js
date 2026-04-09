/**
 * Google Calendar event colors (same IDs as Calendar API `colorId` / Calendar UI).
 * Background/foreground hex align with `calendar.colors.get` event palette where possible.
 * @see https://developers.google.com/calendar/api/v3/reference/colors
 */

export const GOOGLE_CALENDAR_EVENT_COLORS = [
  { id: '1', label: 'Lavender', swatchHex: '#a4bdfc', chipClass: 'bg-[#a4bdfc] border-[#6b8fd4] text-[#1d1d1d]' },
  { id: '2', label: 'Sage', swatchHex: '#7ae7bf', chipClass: 'bg-[#7ae7bf] border-[#3cb878] text-[#1d1d1d]' },
  { id: '3', label: 'Grape', swatchHex: '#dbadff', chipClass: 'bg-[#dbadff] border-[#a855e8] text-[#1d1d1d]' },
  { id: '4', label: 'Flamingo', swatchHex: '#ff887c', chipClass: 'bg-[#ff887c] border-[#ea4335] text-[#1d1d1d]' },
  { id: '5', label: 'Banana', swatchHex: '#fbd75b', chipClass: 'bg-[#fbd75b] border-[#f0b400] text-[#1d1d1d]' },
  { id: '6', label: 'Tangerine', swatchHex: '#ffb878', chipClass: 'bg-[#ffb878] border-[#fa903e] text-[#1d1d1d]' },
  { id: '7', label: 'Peacock', swatchHex: '#46d6ff', chipClass: 'bg-[#46d6ff] border-[#12a5d8] text-[#1d1d1d]' },
  { id: '8', label: 'Graphite', swatchHex: '#e1e1e1', chipClass: 'bg-[#e1e1e1] border-[#9e9e9e] text-[#1d1d1d]' },
  { id: '9', label: 'Blueberry', swatchHex: '#5484ed', chipClass: 'bg-[#5484ed] border-[#3367d6] text-white' },
  { id: '10', label: 'Basil', swatchHex: '#51b749', chipClass: 'bg-[#51b749] border-[#0f9d58] text-white' },
  { id: '11', label: 'Tomato', swatchHex: '#dc2127', chipClass: 'bg-[#dc2127] border-[#b3141b] text-white' },
]

const BY_ID = Object.fromEntries(GOOGLE_CALENDAR_EVENT_COLORS.map((c) => [c.id, c]))

/** Human-readable label for a Google event color id, or empty string. */
export function googleCalendarColorLabel(colorId) {
  if (colorId == null || String(colorId).trim() === '') return ''
  return BY_ID[String(colorId).trim()]?.label ?? ''
}

/** Fallback when `calendar_color_id` is unset (deterministic by index). */
const FALLBACK_CHIP_CLASSES = [
  'bg-blue-100 border-blue-300 text-blue-900',
  'bg-amber-100 border-amber-300 text-amber-900',
  'bg-emerald-100 border-emerald-300 text-emerald-900',
  'bg-violet-100 border-violet-300 text-violet-900',
  'bg-rose-100 border-rose-300 text-rose-900',
  'bg-cyan-100 border-cyan-300 text-cyan-900',
  'bg-orange-100 border-orange-300 text-orange-900',
  'bg-slate-100 border-slate-300 text-slate-800',
]

/**
 * Tailwind classes for a colored chip / calendar block (border + bg + text).
 * @param {{ calendar_color_id?: string|null, id?: number }} staff - staff row from API
 * @param {number} [fallbackIndex] - used when no color id set
 */
export function staffScheduleColorChipClass(staff, fallbackIndex = 0) {
  const raw = staff?.calendar_color_id
  const id = raw != null && String(raw).trim() !== '' ? String(raw).trim() : null
  if (id && BY_ID[id]) {
    return BY_ID[id].chipClass
  }
  const i = Number.isFinite(fallbackIndex) ? Math.max(0, Math.floor(fallbackIndex)) : 0
  return FALLBACK_CHIP_CLASSES[i % FALLBACK_CHIP_CLASSES.length]
}

/** Lighter cell background for shift grid (subtle tint). */
export function staffScheduleCellTintClass(staff, fallbackIndex = 0) {
  const raw = staff?.calendar_color_id
  const id = raw != null && String(raw).trim() !== '' ? String(raw).trim() : null
  if (id && BY_ID[id]) {
    const soft = CELL_TINT_BY_ID[id]
    if (soft) return soft
  }
  const i = Number.isFinite(fallbackIndex) ? Math.max(0, Math.floor(fallbackIndex)) : 0
  return CELL_TINT_FALLBACK[i % CELL_TINT_FALLBACK.length]
}

const CELL_TINT_BY_ID = {
  '1': 'bg-[#a4bdfc]/25 border-[#7986cb]/40',
  '2': 'bg-[#7ae7bf]/25 border-[#33b679]/35',
  '3': 'bg-[#dbadff]/25 border-[#a855e8]/35',
  '4': 'bg-[#ff887c]/25 border-[#ea4335]/35',
  '5': 'bg-[#fbd75b]/30 border-[#f0b400]/40',
  '6': 'bg-[#ffb878]/30 border-[#fa903e]/35',
  '7': 'bg-[#46d6ff]/25 border-[#12a5d8]/35',
  '8': 'bg-gray-100/90 border-gray-300/80',
  '9': 'bg-[#5484ed]/20 border-[#3367d6]/35',
  '10': 'bg-[#51b749]/20 border-[#0f9d58]/35',
  '11': 'bg-[#dc2127]/15 border-[#b3141b]/35',
}

const CELL_TINT_FALLBACK = [
  'bg-blue-50/90 border-blue-200/60',
  'bg-amber-50/90 border-amber-200/60',
  'bg-emerald-50/90 border-emerald-200/60',
  'bg-violet-50/90 border-violet-200/60',
]
