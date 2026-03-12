import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6)

export default function AdjustShiftTimeModal({ slot, onSave, onClose }) {
  const startDefault = slot?.start_time ? parseInt(slot.start_time.slice(0, 2), 10) : 10
  const endDefault = slot?.end_time ? parseInt(slot.end_time.slice(0, 2), 10) : 17
  const [startHour, setStartHour] = useState(
    Number.isFinite(startDefault) && startDefault >= 6 && startDefault <= 23 ? startDefault : 10
  )
  const [endHour, setEndHour] = useState(
    Number.isFinite(endDefault) && endDefault >= 6 && endDefault <= 23 ? endDefault : 17
  )

  useEffect(() => {
    const h = slot?.start_time ? parseInt(slot.start_time.slice(0, 2), 10) : 10
    const e = slot?.end_time ? parseInt(slot.end_time.slice(0, 2), 10) : 17
    setStartHour(Number.isFinite(h) && h >= 6 && h <= 23 ? h : 10)
    setEndHour(Number.isFinite(e) && e >= 6 && e <= 23 ? e : 17)
  }, [slot])

  const handleSave = () => {
    const start = `${String(startHour).padStart(2, '0')}:00`
    const end = `${String(endHour).padStart(2, '0')}:00`
    onSave?.(start, end)
    onClose?.()
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Adjust shift time</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="flex gap-4 items-center">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Start (hour)</label>
              <select
                value={startHour}
                onChange={(e) => setStartHour(Number(e.target.value))}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">End (hour)</label>
              <select
                value={endHour}
                onChange={(e) => setEndHour(Number(e.target.value))}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </div>
          </div>
          {slot?.shift_type === 'weekday_morning' && (
            <p className="text-xs text-gray-500">
              Evening shift start for this day will be set to the same time as this end.
            </p>
          )}
          {slot?.shift_type === 'weekday_evening' && (
            <p className="text-xs text-gray-500">
              Morning shift end for this day will be set to the same time as this start.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 cursor-pointer"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
