import { Palette } from 'lucide-react'
import {
  GOOGLE_CALENDAR_EVENT_COLORS,
  googleCalendarColorLabel,
  isCalendarHexColor,
  normalizeCalendarHex,
} from '../constants/googleCalendarColors'

/**
 * Google Calendar event colors as clickable swatches (native <select> cannot show colors).
 * Also supports custom `#RRGGBB` stored in the same field as calendar_color_id.
 * @param {string} value - "" for Auto, "1"–"11", or `#rrggbb`
 * @param {(next: string) => void} onChange - receives "" or id string or hex
 */
export default function StaffScheduleColorPicker({ value, onChange, idPrefix = 'staff-schedule-color' }) {
  const selected = value == null || String(value).trim() === '' ? '' : String(value).trim()
  const hexSelected = isCalendarHexColor(selected)
  const selectedLabel = selected ? googleCalendarColorLabel(selected) : 'Auto'

  const summarySuffix = !selected
    ? ' · palette rotates by staff order'
    : hexSelected
      ? ` · ${normalizeCalendarHex(selected)}`
      : ` · Calendar id ${selected}`

  const colorInputValue = hexSelected ? normalizeCalendarHex(selected) : '#94a3b8'

  const ringSelected = 'ring-2 ring-green-600 ring-offset-2 ring-offset-white'
  const ringIdle = 'ring-1 ring-gray-300 hover:ring-gray-400'

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">
        Selected: <span className="font-medium text-gray-900">{selectedLabel}</span>
        {summarySuffix}
      </p>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Google Calendar event color">
        <button
          type="button"
          id={`${idPrefix}-auto`}
          title="Auto: rotate palette when unset"
          aria-pressed={selected === ''}
          onClick={() => onChange('')}
          className={`inline-flex h-10 min-w-[4.5rem] shrink-0 items-center justify-center gap-1 rounded-lg border border-dashed border-gray-400 bg-gradient-to-br from-gray-100 to-gray-200 px-2 text-xs font-medium text-gray-700 transition ${
            selected === '' ? ringSelected : ringIdle
          }`}
        >
          <Palette className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
          Auto
        </button>
        {GOOGLE_CALENDAR_EVENT_COLORS.map((c) => {
          const isOn = selected === c.id
          return (
            <button
              key={c.id}
              type="button"
              id={`${idPrefix}-${c.id}`}
              title={`${c.label} (Google Calendar color ${c.id})`}
              aria-label={c.label}
              aria-pressed={isOn}
              onClick={() => onChange(c.id)}
              className={`h-10 w-10 shrink-0 rounded-lg border border-black/10 shadow-sm transition ${isOn ? ringSelected : ringIdle}`}
              style={{ backgroundColor: c.swatchHex }}
            />
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <span className="text-xs font-medium text-slate-700">Custom color</span>
        <div
          className={`inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 ${hexSelected ? ringSelected : ringIdle}`}
        >
          <input
            type="color"
            id={`${idPrefix}-custom-hex`}
            value={colorInputValue}
            onChange={(e) => onChange(normalizeCalendarHex(e.target.value))}
            className="h-9 w-12 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
            title="Pick a custom color (stored as #RRGGBB)"
            aria-label="Custom schedule color"
          />
          {hexSelected && (
            <span className="text-xs font-mono text-gray-700">{normalizeCalendarHex(selected)}</span>
          )}
        </div>
      </div>
    </div>
  )
}
