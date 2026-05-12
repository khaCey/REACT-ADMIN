/**
 * Google Calendar event colors (same IDs as Calendar API `colorId` / Calendar UI).
 * Background/foreground hex align with `calendar.colors.get` event palette where possible.
 * Custom hex `#RRGGBB` may also be stored in `staff.calendar_color_id` for UI-only tinting.
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

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/

/** True if value is a stored custom UI color `#RRGGBB`. */
export function isCalendarHexColor(value) {
  if (value == null || String(value).trim() === '') return false
  return HEX_COLOR_RE.test(String(value).trim())
}

/** Normalize hex to lowercase `#rrggbb`. */
export function normalizeCalendarHex(value) {
  const s = String(value || '').trim()
  if (!HEX_COLOR_RE.test(s)) return s
  return `#${s.slice(1).toLowerCase()}`
}

/**
 * @param {string|null|undefined} raw - staff.calendar_color_id
 * @returns {{ kind: 'auto' } | { kind: 'google', googleId: string } | { kind: 'hex', hex: string }}
 */
export function parseStaffCalendarColorId(raw) {
  if (raw == null || String(raw).trim() === '') return { kind: 'auto' }
  const s = String(raw).trim()
  if (HEX_COLOR_RE.test(s)) return { kind: 'hex', hex: normalizeCalendarHex(s) }
  if (BY_ID[s]) return { kind: 'google', googleId: s }
  return { kind: 'auto' }
}

function contrastTextForHexBg(hex) {
  const safe = String(hex || '').replace('#', '')
  if (safe.length !== 6) return '#111827'
  const r = parseInt(safe.slice(0, 2), 16)
  const g = parseInt(safe.slice(2, 4), 16)
  const b = parseInt(safe.slice(4, 6), 16)
  if ([r, g, b].some((v) => Number.isNaN(v))) return '#111827'
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.68 ? '#111827' : '#ffffff'
}

function hexToRgba(hex, alpha) {
  const safe = String(hex || '').replace('#', '')
  if (safe.length !== 6) return undefined
  const r = parseInt(safe.slice(0, 2), 16)
  const g = parseInt(safe.slice(2, 4), 16)
  const b = parseInt(safe.slice(4, 6), 16)
  if ([r, g, b].some((x) => Number.isNaN(x))) return undefined
  return `rgba(${r},${g},${b},${alpha})`
}

/** Human-readable label for a Google event color id, hex Custom, or empty string. */
export function googleCalendarColorLabel(colorId) {
  if (colorId == null || String(colorId).trim() === '') return ''
  const s = String(colorId).trim()
  if (HEX_COLOR_RE.test(s)) return 'Custom'
  return BY_ID[s]?.label ?? ''
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
 * For custom hex, returns border-only classes; use {@link staffScheduleColorChipPresentation} for fill.
 * @param {{ calendar_color_id?: string|null, id?: number }} staff - staff row from API
 * @param {number} [fallbackIndex] - used when no color id set
 */
export function staffScheduleColorChipClass(staff, fallbackIndex = 0) {
  const parsed = parseStaffCalendarColorId(staff?.calendar_color_id)
  if (parsed.kind === 'hex') {
    return 'border border-black/15 shadow-sm'
  }
  if (parsed.kind === 'google') {
    return BY_ID[parsed.googleId].chipClass
  }
  const i = Number.isFinite(fallbackIndex) ? Math.max(0, Math.floor(fallbackIndex)) : 0
  return FALLBACK_CHIP_CLASSES[i % FALLBACK_CHIP_CLASSES.length]
}

/**
 * Chip styling including inline background for custom hex (Tailwind-safe).
 * @returns {{ className: string, style?: import('react').CSSProperties }}
 */
export function staffScheduleColorChipPresentation(staff, fallbackIndex = 0) {
  const parsed = parseStaffCalendarColorId(staff?.calendar_color_id)
  if (parsed.kind === 'hex') {
    const hex = parsed.hex
    return {
      className: 'border border-black/15 shadow-sm',
      style: {
        backgroundColor: hex,
        borderColor: 'rgba(0,0,0,0.12)',
        color: contrastTextForHexBg(hex),
      },
    }
  }
  if (parsed.kind === 'google') {
    return { className: BY_ID[parsed.googleId].chipClass, style: undefined }
  }
  const i = Number.isFinite(fallbackIndex) ? Math.max(0, Math.floor(fallbackIndex)) : 0
  return { className: FALLBACK_CHIP_CLASSES[i % FALLBACK_CHIP_CLASSES.length], style: undefined }
}

/** Lighter cell background for shift grid (subtle tint). */
export function staffScheduleCellTintClass(staff, fallbackIndex = 0) {
  const parsed = parseStaffCalendarColorId(staff?.calendar_color_id)
  if (parsed.kind === 'hex') {
    return 'border-gray-200/80'
  }
  if (parsed.kind === 'google') {
    const soft = CELL_TINT_BY_ID[parsed.googleId]
    if (soft) return soft
  }
  const i = Number.isFinite(fallbackIndex) ? Math.max(0, Math.floor(fallbackIndex)) : 0
  return CELL_TINT_FALLBACK[i % CELL_TINT_FALLBACK.length]
}

/**
 * Shift grid cell tint with optional inline rgba for custom hex.
 * @returns {{ className: string, style?: import('react').CSSProperties }}
 */
export function staffScheduleCellTintPresentation(staff, fallbackIndex = 0) {
  const parsed = parseStaffCalendarColorId(staff?.calendar_color_id)
  if (parsed.kind === 'hex') {
    const hex = parsed.hex
    const bg = hexToRgba(hex, 0.22)
    const bd = hexToRgba(hex, 0.42)
    return {
      className: 'border rounded-lg',
      style: {
        backgroundColor: bg,
        borderColor: bd,
      },
    }
  }
  if (parsed.kind === 'google') {
    const soft = CELL_TINT_BY_ID[parsed.googleId]
    if (soft) return { className: soft, style: undefined }
  }
  const i = Number.isFinite(fallbackIndex) ? Math.max(0, Math.floor(fallbackIndex)) : 0
  return { className: CELL_TINT_FALLBACK[i % CELL_TINT_FALLBACK.length], style: undefined }
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
