import React, { useState, useEffect } from 'react'
import { api } from '../api'
import { useToast } from '../context/ToastContext'

function formatDateKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatTime(t) {
  if (!t) return '--'
  const s = String(t).trim()
  return s.slice(0, 5)
}

export default function ExtendShiftModal({ onClose }) {
  const { success } = useToast()
  const [date, setDate] = useState(() => formatDateKey(new Date()))
  const [teachers, setTeachers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [extensions, setExtensions] = useState({})
  const [saving, setSaving] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getScheduleTeachers(date)
      .then((data) => {
        setTeachers(data.teachers || [])
        const next = {}
        for (const t of data.teachers || []) {
          const key = t.teacher_name
          next[key] = {
            extend_before_minutes: parseInt(t.extend_before_minutes, 10) || 0,
            extend_after_minutes: parseInt(t.extend_after_minutes, 10) || 0,
          }
        }
        setExtensions(next)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [date])

  const handleChange = (teacherName, field, value) => {
    const v = Math.min(120, Math.max(0, parseInt(value, 10) || 0))
    setExtensions((prev) => ({
      ...prev,
      [teacherName]: {
        ...(prev[teacherName] || { extend_before_minutes: 0, extend_after_minutes: 0 }),
        [field]: v,
      },
    }))
  }

  const handleSave = (teacherName) => {
    const ext = extensions[teacherName]
    if (!ext) return
    setSaving(teacherName)
    api
      .updateScheduleExtend({
        date,
        teacher_name: teacherName,
        extend_before_minutes: ext.extend_before_minutes,
        extend_after_minutes: ext.extend_after_minutes,
      })
      .then(() => {
        success('Shift extension updated')
        setSaving(null)
      })
      .catch((e) => {
        setError(e.message)
        setSaving(null)
      })
  }

  const uniqueTeachers = [...new Map(teachers.map((t) => [t.teacher_name, t])).values()]

  return (
    <div className="fixed inset-0 z-[10000]" role="dialog" aria-modal="true" aria-labelledby="extendShiftTitle">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center p-4 overflow-auto">
        <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl ring-1 ring-black/5 flex flex-col max-h-[90vh] overflow-hidden">
          <header className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-gray-200">
            <h3 id="extendShiftTitle" className="text-lg font-semibold text-gray-900">
              Extend teacher shift
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              Close
            </button>
          </header>
          <div className="p-5 overflow-y-auto flex-1 min-h-0">
            <p className="text-sm text-gray-600 mb-4">
              Up to 2 hours before or after the base shift. Set extend minutes (0–120) then Save.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm w-full max-w-xs"
              />
            </div>
            {error && (
              <div className="mb-3 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-100">
                {error}
              </div>
            )}
            {loading ? (
              <div className="py-8 text-center text-gray-500">Loading teachers…</div>
            ) : uniqueTeachers.length === 0 ? (
              <p className="text-sm text-gray-500">No teacher shifts for this date. Add shifts in teacher_schedules first.</p>
            ) : (
              <ul className="space-y-4">
                {uniqueTeachers.map((t) => (
                  <li key={t.teacher_name} className="border border-gray-200 rounded-lg p-4">
                    <div className="font-medium text-gray-900 mb-2">
                      {t.teacher_name}
                      <span className="text-gray-500 font-normal text-sm ml-2">
                        {formatTime(t.start_time)} – {formatTime(t.end_time)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">Extend before (min)</span>
                        <input
                          type="number"
                          min={0}
                          max={120}
                          value={extensions[t.teacher_name]?.extend_before_minutes ?? 0}
                          onChange={(e) => handleChange(t.teacher_name, 'extend_before_minutes', e.target.value)}
                          className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">Extend after (min)</span>
                        <input
                          type="number"
                          min={0}
                          max={120}
                          value={extensions[t.teacher_name]?.extend_after_minutes ?? 0}
                          onChange={(e) => handleChange(t.teacher_name, 'extend_after_minutes', e.target.value)}
                          className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => handleSave(t.teacher_name)}
                        disabled={saving === t.teacher_name}
                        className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 cursor-pointer disabled:opacity-50"
                      >
                        {saving === t.teacher_name ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
