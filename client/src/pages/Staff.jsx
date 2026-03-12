import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import AddStaffModal from '../components/AddStaffModal'
import EditStaffModal from '../components/EditStaffModal'
import AdjustShiftTimeModal from '../components/AdjustShiftTimeModal'

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

/** Monday of the week containing d */
function getMonday(d) {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  return date
}

/** Format a Date as YYYY-MM-DD in local calendar date */
function toLocalDateString(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatWeekLabel(weekStart) {
  const mon = new Date(weekStart + 'T12:00:00Z')
  const sun = new Date(mon)
  sun.setUTCDate(sun.getUTCDate() + 6)
  return `${mon.getUTCDate()} ${mon.toLocaleDateString(undefined, { month: 'short' })} – ${sun.getUTCDate()} ${sun.toLocaleDateString(undefined, { month: 'short' })} ${sun.getUTCFullYear()}`
}

const STAFF_TYPE_LABELS = { japanese_staff: 'Japanese Staff', english_teacher: 'English Teacher' }
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SHIFT_DEFAULT_TIMES = {
  weekday_morning: { start: '10:00', end: '16:00' },
  weekday_evening: { start: '16:00', end: '21:00' },
  weekend: { start: '10:00', end: '17:00' },
}

export default function Staff() {
  const { staff: authStaff } = useAuth()
  const isAdmin = !!authStaff?.is_admin || String(authStaff?.name || '').trim().toLowerCase() === 'khacey'

  const [staffList, setStaffList] = useState([])
  const [shiftLog, setShiftLog] = useState([])
  const [weekSlots, setWeekSlots] = useState([])
  const [weekStart, setWeekStart] = useState(() => {
    const m = getMonday(new Date())
    return toLocalDateString(m)
  })
  const [loading, setLoading] = useState(true)
  const [loadingShifts, setLoadingShifts] = useState(false)
  const [shiftLoadError, setShiftLoadError] = useState(null)
  const [error, setError] = useState(null)
  const [showAddStaffModal, setShowAddStaffModal] = useState(false)
  const [selectedStaff, setSelectedStaff] = useState(null)
  const [adjustSlot, setAdjustSlot] = useState(null)

  const loadStaff = useCallback(() => {
    api.getStaff().then((res) => setStaffList(res.staff || [])).catch(() => setStaffList([]))
  }, [])

  const loadShiftLog = useCallback(() => {
    api.getStaffShifts().then((res) => setShiftLog(res.shifts || [])).catch(() => setShiftLog([]))
  }, [])

  const loadWeek = useCallback(() => {
    setLoadingShifts(true)
    setShiftLoadError(null)
    api
      .getShiftsWeek(weekStart)
      .then((res) => {
        setWeekSlots(res.week || [])
        setShiftLoadError(null)
      })
      .catch((e) => {
        setShiftLoadError(e?.message || 'Failed to refresh shifts')
        // Keep previous weekSlots so the table does not disappear
      })
      .finally(() => setLoadingShifts(false))
  }, [weekStart])

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([api.getStaff(), api.getStaffShifts()])
      .then(([staffRes, shiftsRes]) => {
        setStaffList(staffRes.staff || [])
        setShiftLog(shiftsRes.shifts || [])
      })
      .catch((e) => setError(e.message || 'Could not load staff'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadWeek()
  }, [loadWeek])

  const handleAssignShift = (slot, staffIdOrName, customStart, customEnd) => {
    const body = {
      date: slot.date,
      shift_type: slot.shift_type,
      staff_id: typeof staffIdOrName === 'number' ? staffIdOrName : undefined,
      staff_name: typeof staffIdOrName === 'string' ? staffIdOrName : undefined,
      start_time: customStart || undefined,
      end_time: customEnd || undefined,
    }
    if (body.staff_id == null && body.staff_name == null) {
      const s = staffList.find((x) => String(x.id) === String(staffIdOrName) || x.name === staffIdOrName)
      if (s) body.staff_id = s.id
      else body.staff_name = staffIdOrName
    }
    setLoadingShifts(true)
    api
      .assignShift(body)
      .then(() => loadWeek())
      .catch((e) => setError(e.message))
      .finally(() => setLoadingShifts(false))
    setAdjustSlot(null)
  }

  const slotByKey = useCallback(
    (date, shiftType) => weekSlots.find((s) => s.date === date && s.shift_type === shiftType),
    [weekSlots]
  )
  const weekDates = useCallback(() => {
    const mon = new Date(weekStart + 'T12:00:00Z')
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon)
      d.setUTCDate(d.getUTCDate() + i)
      return d.toISOString().slice(0, 10)
    })
  }, [weekStart])

  const dates = weekDates()
  const calendarStaffOptions = staffList.filter(
    (x) => (x.staff_type === 'japanese_staff' || !x.staff_type) && x.active !== false
  )

  return (
    <div className="w-full flex flex-col h-full min-h-0 overflow-y-auto">
      <div className="flex justify-between items-center pt-3 pb-2 mb-3 border-b border-gray-200">
        <h2 className="text-2xl font-bold text-gray-900">Staff</h2>
        <button
          type="button"
          onClick={() => setShowAddStaffModal(true)}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg cursor-pointer"
        >
          Add Staff
        </button>
      </div>

      {error && (
        <div className="mb-3 py-2 px-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {loading ? (
        <p className="py-8 text-gray-500">Loading…</p>
      ) : (
        <>
          <section className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Staff list</h3>
            <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Name</th>
                    <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Calendar ID</th>
                    <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Type</th>
                    <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Role</th>
                    <th className="px-4 py-2 text-center text-sm font-semibold text-gray-700">Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {staffList.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedStaff({ ...s, canEditRole: isAdmin })}
                      className="hover:bg-gray-100 cursor-pointer"
                    >
                      <td className="px-4 py-2 font-medium text-gray-900">{s.name}</td>
                      <td className="px-4 py-2 text-sm text-gray-600 truncate max-w-[200px]">
                        {s.calendar_id || '—'}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600">
                        {STAFF_TYPE_LABELS[s.staff_type] ?? s.staff_type ?? '—'}
                      </td>
                      <td className="px-4 py-2">
                        {s.is_admin ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                            Admin
                          </span>
                        ) : s.is_operator ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-800">
                            Operator
                          </span>
                        ) : (
                          <span className="text-gray-600">Staff</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center text-sm">
                        {s.active !== false ? 'Yes' : 'No'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Shift management (week view)</h3>
            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => {
                  const m = new Date(weekStart + 'T12:00:00Z')
                  m.setUTCDate(m.getUTCDate() - 7)
                  setWeekStart(m.toISOString().slice(0, 10))
                }}
                className="p-2 rounded-lg border border-gray-300 hover:bg-gray-100 cursor-pointer"
                aria-label="Previous week"
              >
                <ChevronLeft className="w-5 h-5 text-gray-600" />
              </button>
              <span className="font-medium text-gray-700 min-w-[220px] text-center">
                {formatWeekLabel(weekStart)}
              </span>
              <button
                type="button"
                onClick={() => {
                  const m = new Date(weekStart + 'T12:00:00Z')
                  m.setUTCDate(m.getUTCDate() + 7)
                  setWeekStart(m.toISOString().slice(0, 10))
                }}
                className="p-2 rounded-lg border border-gray-300 hover:bg-gray-100 cursor-pointer"
                aria-label="Next week"
              >
                <ChevronRight className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            {shiftLoadError && (
              <div className="mb-3 py-2 px-3 rounded-lg bg-amber-50 text-amber-800 text-sm">
                {shiftLoadError}
              </div>
            )}

            {loadingShifts ? (
              <p className="py-4 text-gray-500 text-sm">Loading shifts…</p>
            ) : (
              <div className="rounded-xl border border-gray-200 overflow-x-auto bg-white">
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-2 py-2 text-left text-sm font-semibold text-gray-700 w-40">Shift</th>
                      {dates.map((date) => {
                        const d = new Date(date + 'T12:00:00Z')
                        const dayIdx = d.getUTCDay()
                        const name = DAY_NAMES[dayIdx === 0 ? 6 : dayIdx - 1]
                        return (
                          <th key={date} className="px-2 py-2 text-center text-sm font-semibold text-gray-700 min-w-[140px]">
                            {name} {d.getUTCDate()}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[
                      { row: 'am', label: 'AM' },
                      { row: 'pm', label: 'PM' },
                    ].map(({ row, label }) => (
                      <tr key={row}>
                        <td className="px-2 py-2 text-sm text-gray-600 align-top border-r border-gray-100">
                          {label}
                        </td>
                        {dates.map((date) => {
                          const d = new Date(date + 'T12:00:00Z')
                          const dow = d.getUTCDay()
                          const isWeekend = [0, 1, 6].includes(dow)
                          const isWeekday = [2, 3, 4, 5].includes(dow)
                          const shiftType =
                            row === 'am'
                              ? isWeekend
                                ? 'weekend'
                                : isWeekday
                                  ? 'weekday_morning'
                                  : null
                              : row === 'pm' && isWeekday
                                ? 'weekday_evening'
                                : null
                          const slot = shiftType ? slotByKey(date, shiftType) : null
                          const isAdjusting =
                            adjustSlot && adjustSlot.date === date && adjustSlot.shift_type === shiftType

                          if (!shiftType) {
                            return (
                              <td key={date} className="px-2 py-2 min-w-[140px] bg-gray-50/50 align-top">
                                <span className="text-gray-300 text-xs">—</span>
                              </td>
                            )
                          }

                          return (
                            <td key={date} className="px-2 py-2 min-w-[140px] align-top">
                              <div className="space-y-1">
                                <select
                                  value={slot?.staff_name ?? ''}
                                  onChange={(e) => {
                                    const v = e.target.value
                                    const slotData = slot || { date, shift_type: shiftType }
                                    if (!v) {
                                      handleAssignShift(slotData, null)
                                      return
                                    }
                                    const s = calendarStaffOptions.find((x) => x.name === v)
                                    handleAssignShift(slotData, s ? s.id : v)
                                  }}
                                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
                                >
                                  <option value="">— Select staff —</option>
                                  {calendarStaffOptions.map((x) => (
                                    <option key={x.id} value={x.name}>
                                      {x.name}
                                    </option>
                                  ))}
                                </select>
                                <div className="flex items-center gap-1 text-xs text-gray-500">
                                  <Clock className="w-3.5 h-3.5 shrink-0" />
                                  <span>
                                    {(slot?.start_time ?? SHIFT_DEFAULT_TIMES[shiftType]?.start ?? '—')}–{(slot?.end_time ?? SHIFT_DEFAULT_TIMES[shiftType]?.end ?? '—')}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      const defaults = SHIFT_DEFAULT_TIMES[shiftType]
                                      const slotData = slot
                                        ? { ...slot, date, shift_type: shiftType }
                                        : { date, shift_type: shiftType, start_time: defaults?.start, end_time: defaults?.end }
                                      setAdjustSlot(isAdjusting ? null : slotData)
                                    }}
                                    className="text-green-600 hover:underline cursor-pointer shrink-0"
                                  >
                                    {isAdjusting ? 'Cancel' : 'Adjust'}
                                  </button>
                                </div>
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mb-4">
            <details className="rounded-lg border border-gray-200 bg-gray-50/50">
              <summary className="px-4 py-2 cursor-pointer font-medium text-gray-700">
                Recent shift log (login/logout)
              </summary>
              <div className="px-4 pb-3 pt-1">
                {shiftLog.length === 0 ? (
                  <p className="text-sm text-gray-500">No shift data yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {shiftLog.slice(0, 20).map((s) => (
                      <li
                        key={s.id ?? `${s.staff_id}-${s.started_at}`}
                        className="text-sm text-gray-600"
                      >
                        <span className="font-medium text-gray-900">{s.staff_name}</span>{' '}
                        {formatShiftDate(s.started_at)} {formatShiftTime(s.started_at)}
                        {s.ended_at ? (
                          <> → {formatShiftTime(s.ended_at)}</>
                        ) : (
                          <span className="text-green-600 ml-1">(in progress)</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          </section>
        </>
      )}

      {showAddStaffModal && (
        <AddStaffModal
          onClose={() => setShowAddStaffModal(false)}
          onCreated={() => {
            loadStaff()
            loadShiftLog()
          }}
        />
      )}

      {selectedStaff && (
        <EditStaffModal
          staff={selectedStaff}
          onClose={() => setSelectedStaff(null)}
          onSaved={(updated) => {
            if (updated) {
              setStaffList((prev) =>
                prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
              )
            } else {
              loadStaff()
            }
          }}
          onDeleted={(id) => {
            setStaffList((prev) => prev.filter((s) => s.id !== id))
            setSelectedStaff(null)
          }}
        />
      )}

      {adjustSlot && (
        <AdjustShiftTimeModal
          slot={adjustSlot}
          onSave={(start, end) => {
            handleAssignShift(adjustSlot, adjustSlot.staff_name, start, end)
          }}
          onClose={() => setAdjustSlot(null)}
        />
      )}
    </div>
  )
}
