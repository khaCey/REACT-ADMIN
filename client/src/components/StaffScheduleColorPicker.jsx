import { useCallback, useEffect, useState } from 'react'
import { Palette } from 'lucide-react'
import {
  GOOGLE_CALENDAR_EVENT_COLORS,
  googleCalendarColorLabel,
  isCalendarHexColor,
  normalizeCalendarHex,
  parseScheduleHexInput,
} from '../constants/googleCalendarColors'

/**
 * Google Calendar event colors as clickable swatches (native <select> cannot show colors).
 * Also supports custom `#RRGGBB` stored in the same field as calendar_color_id.
 * @param {string} value - "" for Auto, "1"–"11", or `#rrggbb`
 * @param {(next: string) => void} onChange - receives "" or id string or hex
 */
export default function StaffScheduleColorPicker({
  value,
  onChange,
  idPrefix = 'staff-schedule-color',
  /** Parent can read the hex field at form submit (avoids stale querySelector / timing issues). */
  hexInputRef,
}) {
  const selected = value == null || String(value).trim() === '' ? '' : String(value).trim()
  const hexSelected = isCalendarHexColor(selected)
  const selectedLabel = selected ? googleCalendarColorLabel(selected) : 'Auto'

  const summarySuffix = !selected
    ? ' · palette rotates by staff order'
    : hexSelected
      ? ` · ${normalizeCalendarHex(selected)}`
      : ` · Calendar id ${selected}`

  const [hexDraft, setHexDraft] = useState(() =>
    hexSelected ? normalizeCalendarHex(selected) : ''
  )

  useEffect(() => {
    const s = value == null || String(value).trim() === '' ? '' : String(value).trim()
    if (isCalendarHexColor(s)) {
      setHexDraft(normalizeCalendarHex(s))
    } else {
      setHexDraft('')
    }
  }, [value])

  const commitHexDraft = useCallback(() => {
    const t = hexDraft.trim()
    if (t === '') {
      const cur = value == null || String(value).trim() === '' ? '' : String(value).trim()
      // Only clearing the text field should drop *custom hex* to Auto — not a Google swatch selection.
      if (isCalendarHexColor(cur)) onChange('')
      return
    }
    const parsed = parseScheduleHexInput(t)
    if (parsed) {
      onChange(parsed)
      return
    }
    const cur = value == null || String(value).trim() === '' ? '' : String(value).trim()
    setHexDraft(isCalendarHexColor(cur) ? normalizeCalendarHex(cur) : '')
  }, [hexDraft, onChange, value])

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
        <label htmlFor={`${idPrefix}-custom-hex`} className="text-xs font-medium text-slate-700">
          Custom hex
        </label>
        <div
          className={`inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 ${hexSelected ? ringSelected : ringIdle}`}
        >
          <input
            ref={hexInputRef}
            type="text"
            id={`${idPrefix}-custom-hex`}
            name="schedule_color_hex"
            value={hexDraft}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={commitHexDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitHexDraft()
                e.currentTarget.blur()
              }
            }}
            placeholder="#RRGGBB or RRGGBB"
            maxLength={7}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="h-9 w-[7.5rem] rounded border border-gray-300 bg-white px-2 font-mono text-sm text-gray-900"
            title="Enter #RRGGBB (e.g. #ff0000). Leave empty and blur for Auto."
            aria-label="Custom hex color (#RRGGBB)"
          />
        </div>
      </div>
    </div>
  )
}
