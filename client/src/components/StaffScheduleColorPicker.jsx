import { Palette } from 'lucide-react'
import { GOOGLE_CALENDAR_EVENT_COLORS, googleCalendarColorLabel } from '../constants/googleCalendarColors'

/**
 * Google Calendar event colors as clickable swatches (native <select> cannot show colors).
 * @param {string} value - "" for Auto, or "1"–"11"
 * @param {(next: string) => void} onChange - receives "" or id string
 */
export default function StaffScheduleColorPicker({ value, onChange, idPrefix = 'staff-schedule-color' }) {
  const selected = value == null || String(value).trim() === '' ? '' : String(value).trim()
  const selectedLabel = selected ? googleCalendarColorLabel(selected) : 'Auto'

  const ringSelected = 'ring-2 ring-green-600 ring-offset-2 ring-offset-white'
  const ringIdle = 'ring-1 ring-gray-300 hover:ring-gray-400'

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">
        Selected: <span className="font-medium text-gray-900">{selectedLabel}</span>
        {selected ? ` · Calendar id ${selected}` : ' · palette rotates by staff order'}
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
    </div>
  )
}
