import { useState, useEffect } from 'react'
import { api } from '../api'

function formatShiftTime(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function formatShiftDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  return isToday ? 'Today' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function Staff() {
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getStaffShifts()
      .then((res) => setShifts(res.shifts || []))
      .catch((e) => {
        setShifts([])
        setError(e.message || 'Could not load shift data')
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="w-full flex flex-col h-full min-h-0">
      <div className="flex justify-between items-center pt-3 pb-2 mb-3 border-b border-gray-200">
        <h2 className="text-2xl font-bold text-gray-900">Staff login</h2>
      </div>
      {loading ? (
        <p className="py-8 text-gray-500">Loading…</p>
      ) : error ? (
        <div className="py-6 space-y-2">
          <p className="text-red-600 font-medium">{error}</p>
          <p className="text-sm text-gray-600">
            Run the database migration in the <code className="bg-gray-100 px-1 rounded">react-app</code> folder: <code className="bg-gray-100 px-1 rounded">npm run migrate</code>. Then log out and log in again so your shift is recorded.
          </p>
        </div>
      ) : shifts.length === 0 ? (
        <p className="py-8 text-gray-500">No shift data yet. Log out and log in again to record a shift.</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <ul className="space-y-2">
            {shifts.map((s) => (
              <li
                key={s.id ?? `${s.staff_id}-${s.started_at}`}
                className="px-4 py-3 rounded-lg bg-white border border-gray-200 shadow-sm text-gray-700"
              >
                <span className="font-medium text-gray-900">{s.staff_name}</span>
                <div className="mt-1 text-gray-500 text-sm">
                  {formatShiftDate(s.started_at)} {formatShiftTime(s.started_at)}
                  {s.ended_at ? (
                    <> → {formatShiftTime(s.ended_at)}</>
                  ) : (
                    <span className="text-green-600 ml-1">(in progress)</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
