import { useState, useEffect, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Clock, Calendar, Plus, Trash2 } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import AddStaffModal from '../components/AddStaffModal'
import EditStaffModal from '../components/EditStaffModal'
import AdjustShiftTimeModal from '../components/AdjustShiftTimeModal'
import LoadingSpinner from '../components/LoadingSpinner'
import FullPageLoading from '../components/FullPageLoading'
import {
  googleCalendarColorLabel,
  staffScheduleCellTintClass,
  staffScheduleColorChipClass,
} from '../constants/googleCalendarColors'

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

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** Given a Date (UTC moment), return YYYY-MM-DD for that moment in Japan (Asia/Tokyo). */
function toJapanDateString(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return ''
  const jst = new Date(d.getTime() + JST_OFFSET_MS)
  const y = jst.getUTCFullYear()
  const m = String(jst.getUTCMonth() + 1).padStart(2, '0')
  const day = String(jst.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Given YYYY-MM-DD as Japan calendar date, return Date at midnight Japan (as UTC moment). */
function japanDateStringToUTC(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null
  const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const [, y, m, d] = match.map(Number)
  const utcMidnightJapan = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - JST_OFFSET_MS
  return new Date(utcMidnightJapan)
}

/** Day of week for a Japan date string (0=Sun, 1=Mon, ..., 6=Sat). Uses noon JST so UTC day matches Japan date. */
function getDayOfWeekJapan(dateStr) {
  const d = japanDateStringToUTC(dateStr)
  if (!d) return 0
  const noonJST = new Date(d.getTime() + 12 * 60 * 60 * 1000)
  return noonJST.getUTCDay()
}

/** Add n days to a Japan date string; returns YYYY-MM-DD. */
function addDaysJapan(dateStr, n) {
  const d = japanDateStringToUTC(dateStr)
  if (!d) return dateStr
  d.setUTCDate(d.getUTCDate() + n)
  return toJapanDateString(d)
}

/** Monday of the week that contains this Japan date string (YYYY-MM-DD). */
function getMondayOfWeekJapan(japanDateStr) {
  const dow = getDayOfWeekJapan(japanDateStr)
  const diff = dow === 0 ? -6 : 1 - dow
  return addDaysJapan(japanDateStr, diff)
}

/** Format week label for display in UI: "17 Mar – 23 Mar 2026" (Japan calendar dates). */
function formatWeekLabelJapan(weekStartJapan) {
  if (!weekStartJapan || typeof weekStartJapan !== 'string') return ''
  const [y1, m1, d1] = weekStartJapan.slice(0, 10).split('-').map(Number)
  const sunStr = addDaysJapan(weekStartJapan, 6)
  const [y2, m2, d2] = sunStr.slice(0, 10).split('-').map(Number)
  const monMonth = new Date(Date.UTC(y1, m1 - 1, 1)).toLocaleDateString('en-GB', { month: 'short' })
  const sunMonth = new Date(Date.UTC(y2, m2 - 1, 1)).toLocaleDateString('en-GB', { month: 'short' })
  return `${d1} ${monMonth} – ${d2} ${sunMonth} ${y2}`
}

/** Format a Japan date string as "Mon 17" for column headers (UI: Japan time). */
function formatDayHeaderJapan(dateStr) {
  const dow = getDayOfWeekJapan(dateStr)
  const dayNum = parseInt(String(dateStr).slice(8, 10), 10) || 0
  const dayName = DAY_NAMES[dow === 0 ? 6 : dow - 1]
  return `${dayName} ${dayNum}`
}

const STAFF_TYPE_LABELS = { japanese_staff: 'Japanese Staff', english_teacher: 'English Teacher' }
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TEACHER_CALENDAR_START_HOUR = 10
const TEACHER_CALENDAR_END_HOUR = 21
const TEACHER_CALENDAR_TOTAL_MINUTES = (TEACHER_CALENDAR_END_HOUR - TEACHER_CALENDAR_START_HOUR) * 60
const TEACHER_CALENDAR_ROW_HEIGHT = 24

/** Match schedule/API teacher_name to Staff list despite extra spaces or casing. */
function teacherNameMatchKey(name) {
  return String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/** Map normalized key → display name from sorted English teachers (stable colors in legend + blocks). */
function canonicalTeacherNameMap(englishTeachers) {
  const map = new Map()
  for (const name of englishTeachers) {
    const k = teacherNameMatchKey(name)
    if (k && !map.has(k)) map.set(k, name)
  }
  return map
}

/** Parse "HH:MM" or "HH:MM:SS" to minutes from TEACHER_CALENDAR_START_HOUR (10). Clamp to [0, TEACHER_CALENDAR_TOTAL_MINUTES]. */
function minutesFromTimelineStart(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return 0
  const minutes = parseInt(match[1], 10) * 60 + parseInt(match[2], 10)
  const fromStart = minutes - TEACHER_CALENDAR_START_HOUR * 60
  return Math.max(0, Math.min(TEACHER_CALENDAR_TOTAL_MINUTES, fromStart))
}

/** Horizontal cascade index for overlapping blocks (same day). */
function cascadeIndicesForBlocks(blocks) {
  if (!blocks?.length) return []
  const meta = blocks.map((block, origIdx) => {
    const startMin = minutesFromTimelineStart(block.start_time)
    const endMin = minutesFromTimelineStart(block.end_time)
    const lo = Math.min(startMin, endMin)
    const hi = Math.max(startMin, endMin)
    return { origIdx, startMin: lo, endMin: Math.max(lo + 1, hi) }
  })
  meta.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  const out = new Array(blocks.length)
  for (let i = 0; i < meta.length; i++) {
    let maxC = -1
    for (let j = 0; j < i; j++) {
      if (meta[i].startMin < meta[j].endMin && meta[j].startMin < meta[i].endMin) {
        maxC = Math.max(maxC, out[meta[j].origIdx])
      }
    }
    out[meta[i].origIdx] = maxC + 1
  }
  return out
}

/** Read-only roster: assigned shift slots only (no unassigned “open” blocks). */
function rosterBlocksFromWeekSlots(weekSlots) {
  if (!Array.isArray(weekSlots)) return []
  const out = []
  for (const s of weekSlots) {
    const name = s?.staff_name != null ? String(s.staff_name).trim() : ''
    if (!name) continue
    const date = s?.date != null ? String(s.date).trim().slice(0, 10) : ''
    const start_time = s?.start_time != null ? String(s.start_time).trim().slice(0, 5) : ''
    const end_time = s?.end_time != null ? String(s.end_time).trim().slice(0, 5) : ''
    if (!date || !start_time || !end_time) continue
    out.push({ date, staff_name: name, start_time, end_time })
  }
  return out
}

function findStaffMemberForRosterName(staffList, staffName) {
  const key = teacherNameMatchKey(staffName)
  if (!key) return null
  for (const s of staffList || []) {
    if (teacherNameMatchKey(s?.name) === key) return s
  }
  return null
}

/** Same eligibility as shift-assignment dropdowns: Japanese / legacy staff only, not English teachers. */
function isShiftRosterEligibleStaff(s) {
  if (!s || s.active === false) return false
  const t = s.staff_type
  return t === 'japanese_staff' || t == null || t === ''
}

const SHIFT_DEFAULT_TIMES = {
  weekday_morning: { start: '10:00', end: '16:00' },
  weekday_evening: { start: '16:00', end: '21:00' },
  weekend: { start: '10:00', end: '17:00' },
}
const WEEKDAY_OPTIONS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
]

export default function Staff() {
  const { staff: authStaff } = useAuth()
  const { success } = useToast()
  const isAdmin = !!authStaff?.is_admin || String(authStaff?.name || '').trim().toLowerCase() === 'khacey'

  const [staffList, setStaffList] = useState([])
  const [fetchScheduleStaffId, setFetchScheduleStaffId] = useState('')
  const [fetchScheduleLoading, setFetchScheduleLoading] = useState(false)
  const [fetchScheduleError, setFetchScheduleError] = useState('')
  const [shiftLog, setShiftLog] = useState([])
  const [weekSlots, setWeekSlots] = useState([])
  const [weekStart, setWeekStart] = useState(() => {
    const todayJapan = toJapanDateString(new Date())
    return getMondayOfWeekJapan(todayJapan)
  })
  const [loading, setLoading] = useState(true)
  const [loadingShifts, setLoadingShifts] = useState(false)
  const [shiftLoadError, setShiftLoadError] = useState(null)
  const [error, setError] = useState(null)
  const [showAddStaffModal, setShowAddStaffModal] = useState(false)
  const [selectedStaff, setSelectedStaff] = useState(null)
  const [adjustSlot, setAdjustSlot] = useState(null)
  const [teacherCalendarEvents, setTeacherCalendarEvents] = useState([])
  const [teacherCalendarLoading, setTeacherCalendarLoading] = useState(false)
  const [breakPresets, setBreakPresets] = useState([])
  const [breakPresetLoading, setBreakPresetLoading] = useState(false)
  const [breakPresetError, setBreakPresetError] = useState('')
  const [newBreakPreset, setNewBreakPreset] = useState({
    teacher_name: '',
    weekday: String(getDayOfWeekJapan(toJapanDateString(new Date()))),
    start_time: '15:00',
  })

  const loadStaff = useCallback(() => {
    return api.getStaff().then((res) => setStaffList(res.staff || [])).catch(() => setStaffList([]))
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

  const loadTeacherCalendar = useCallback(() => {
    setTeacherCalendarLoading(true)
    api
      .getTeacherCalendar(weekStart)
      .then((res) => setTeacherCalendarEvents(res.events || []))
      .catch(() => setTeacherCalendarEvents([]))
      .finally(() => setTeacherCalendarLoading(false))
  }, [weekStart])

  const loadBreakPresets = useCallback(() => {
    setBreakPresetLoading(true)
    setBreakPresetError('')
    api
      .getTeacherBreakPresets()
      .then((res) => setBreakPresets(Array.isArray(res.presets) ? res.presets : []))
      .catch((e) => {
        setBreakPresets([])
        setBreakPresetError(e?.message || 'Failed to load break presets')
      })
      .finally(() => setBreakPresetLoading(false))
  }, [])

  useEffect(() => {
    loadTeacherCalendar()
  }, [loadTeacherCalendar])

  useEffect(() => {
    loadBreakPresets()
  }, [loadBreakPresets])

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
      .then(() => {
        loadWeek()
        loadTeacherCalendar()
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingShifts(false))
    setAdjustSlot(null)
  }

  const handleCreateBreakPreset = async () => {
    try {
      if (!newBreakPreset.teacher_name) return
      await api.createTeacherBreakPreset({
        teacher_name: newBreakPreset.teacher_name,
        weekday: parseInt(newBreakPreset.weekday, 10),
        start_time: newBreakPreset.start_time,
        active: true,
      })
      success('Break preset added')
      await Promise.all([loadBreakPresets(), loadTeacherCalendar()])
    } catch (e) {
      setBreakPresetError(e?.message || 'Failed to add break preset')
    }
  }

  const handleToggleBreakPreset = async (preset) => {
    try {
      await api.updateTeacherBreakPreset(preset.id, {
        ...preset,
        active: !preset.active,
      })
      await Promise.all([loadBreakPresets(), loadTeacherCalendar()])
    } catch (e) {
      setBreakPresetError(e?.message || 'Failed to update break preset')
    }
  }

  const handleDeleteBreakPreset = async (id) => {
    try {
      await api.deleteTeacherBreakPreset(id)
      success('Break preset removed')
      await Promise.all([loadBreakPresets(), loadTeacherCalendar()])
    } catch (e) {
      setBreakPresetError(e?.message || 'Failed to remove break preset')
    }
  }

  const slotByKey = useCallback(
    (date, shiftType) => weekSlots.find((s) => s.date === date && s.shift_type === shiftType),
    [weekSlots]
  )
  const weekDates = useCallback(() => {
    try {
      const mon = (weekStart || '').toString().trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(mon)) return []
      return Array.from({ length: 7 }, (_, i) => addDaysJapan(mon, i))
    } catch {
      return []
    }
  }, [weekStart])

  const dates = weekDates()
  const shiftRosterBlocks = useMemo(() => {
    const raw = rosterBlocksFromWeekSlots(weekSlots)
    return raw.filter((b) => {
      const s = findStaffMemberForRosterName(staffList, b.staff_name)
      return s && isShiftRosterEligibleStaff(s)
    })
  }, [weekSlots, staffList])
  const rosterLegendNames = useMemo(() => {
    const set = new Set(shiftRosterBlocks.map((b) => b.staff_name))
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [shiftRosterBlocks])
  const calendarStaffOptions = staffList.filter(
    (x) => (x.staff_type === 'japanese_staff' || !x.staff_type) && x.active !== false
  )

  if (loading) {
    return <FullPageLoading />
  }

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

      <>
          <section className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Staff list</h3>
            <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Name</th>
                    <th className="px-4 py-2 text-left text-sm font-semibold text-gray-700">Color</th>
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
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${staffScheduleColorChipClass(s, s.id)}`}
                          title={
                            s.calendar_color_id
                              ? `Google Calendar: ${googleCalendarColorLabel(s.calendar_color_id)}`
                              : 'Auto (set in Edit Staff)'
                          }
                        >
                          {s.calendar_color_id
                            ? googleCalendarColorLabel(s.calendar_color_id) || s.calendar_color_id
                            : 'Auto'}
                        </span>
                      </td>
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
            <div className="flex items-center gap-2 mb-4">
              <button
                type="button"
                onClick={() => {
                  setWeekStart(addDaysJapan(weekStart, -7))
                }}
                className="p-2 rounded-lg border border-gray-300 hover:bg-gray-100 cursor-pointer"
                aria-label="Previous week"
              >
                <ChevronLeft className="w-5 h-5 text-gray-600" />
              </button>
              <span className="font-medium text-gray-700 min-w-[220px] text-center">
                {formatWeekLabelJapan(weekStart)}
              </span>
              <button
                type="button"
                onClick={() => setWeekStart(addDaysJapan(weekStart, 7))}
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
              <div className="flex flex-col items-center justify-center gap-2 py-8">
                <LoadingSpinner size="sm" />
                <p className="text-sm text-gray-500">Loading shifts…</p>
              </div>
            ) : (
              <>
                <div className="mb-8">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Shift roster (week)</h3>
                  <p className="text-sm text-gray-600 mb-3">
                    Read-only view of staff on shift (same people as the assignment table: Japanese staff and legacy
                    rows, not English teachers). Colors match each person&apos;s schedule color from Edit Staff.
                  </p>
                  {shiftRosterBlocks.length === 0 ? (
                    <div className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
                      No shifts assigned for this week.
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 overflow-x-auto bg-white">
                      {(() => {
                        const rosterByDate = {}
                        for (const b of shiftRosterBlocks) {
                          if (!rosterByDate[b.date]) rosterByDate[b.date] = []
                          rosterByDate[b.date].push({
                            staff_name: b.staff_name,
                            start_time: b.start_time,
                            end_time: b.end_time,
                          })
                        }
                        const rosterColorIndex = {}
                        rosterLegendNames.forEach((name, idx) => {
                          const st = findStaffMemberForRosterName(staffList, name)
                          const listIdx = st ? staffList.findIndex((s) => s.id === st.id) : -1
                          rosterColorIndex[name] = staffScheduleColorChipClass(
                            st || {},
                            listIdx >= 0 ? listIdx : idx
                          )
                        })
                        const hourLabels = Array.from(
                          { length: TEACHER_CALENDAR_END_HOUR - TEACHER_CALENDAR_START_HOUR + 1 },
                          (_, i) => `${String(TEACHER_CALENDAR_START_HOUR + i).padStart(2, '0')}:00`
                        )
                        const timelineHeight = hourLabels.length * TEACHER_CALENDAR_ROW_HEIGHT
                        const dateList = Array.isArray(dates) ? dates : []
                        return (
                          <>
                            <div className="flex flex-wrap gap-2 px-4 pt-3 pb-2 mb-2 border-b border-gray-100">
                              {rosterLegendNames.map((name) => (
                                <span
                                  key={name}
                                  className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border ${rosterColorIndex[name] || 'bg-gray-100 border-gray-300'}`}
                                >
                                  {name}
                                </span>
                              ))}
                            </div>
                            <div className="flex min-w-[600px] border-b border-gray-200">
                              <div className="w-14 shrink-0" />
                              {dateList.map((date) => (
                                <div
                                  key={date}
                                  className="flex-1 min-w-[80px] border-r border-gray-100 last:border-r-0 py-1.5 text-center text-xs font-semibold text-gray-700"
                                >
                                  {formatDayHeaderJapan(date)}
                                </div>
                              ))}
                            </div>
                            <div className="flex min-w-[600px]">
                              <div
                                className="w-14 shrink-0 flex flex-col border-r border-gray-100"
                                style={{ height: timelineHeight }}
                              >
                                {hourLabels.map((label) => (
                                  <div
                                    key={label}
                                    className="text-xs font-medium text-gray-500 flex items-center pr-1 justify-end border-b border-gray-50"
                                    style={{ height: TEACHER_CALENDAR_ROW_HEIGHT }}
                                  >
                                    {label}
                                  </div>
                                ))}
                              </div>
                              {dateList.map((date) => {
                                const blocks = rosterByDate[date] || []
                                const cascadeIndices = cascadeIndicesForBlocks(blocks)
                                return (
                                  <div
                                    key={date}
                                    className="flex-1 min-w-[80px] border-r border-gray-100 last:border-r-0 relative overflow-visible"
                                    style={{ height: timelineHeight }}
                                  >
                                    {blocks.map((block, i) => {
                                      const startMin = minutesFromTimelineStart(block.start_time)
                                      const endMin = minutesFromTimelineStart(block.end_time)
                                      const duration = Math.max(1, endMin - startMin)
                                      const topPct =
                                        TEACHER_CALENDAR_TOTAL_MINUTES > 0
                                          ? (startMin / TEACHER_CALENDAR_TOTAL_MINUTES) * 100
                                          : 0
                                      const heightPct =
                                        TEACHER_CALENDAR_TOTAL_MINUTES > 0
                                          ? (duration / TEACHER_CALENDAR_TOTAL_MINUTES) * 100
                                          : 0
                                      const colorClass =
                                        rosterColorIndex[block.staff_name] ||
                                        'bg-gray-100 border-gray-300 text-gray-800'
                                      const cascadeIndex = cascadeIndices[i] ?? 0
                                      return (
                                        <div
                                          key={`${block.staff_name}-${block.start_time}-${i}`}
                                          className={`absolute rounded border overflow-hidden flex flex-col items-center justify-center ${colorClass}`}
                                          style={{
                                            top: `${topPct}%`,
                                            height: `${heightPct}%`,
                                            minHeight: 20,
                                            width: '80%',
                                            left: `${cascadeIndex * 10}px`,
                                            right: 'auto',
                                            zIndex: 10 + cascadeIndex,
                                          }}
                                          title={`${block.staff_name}: ${block.start_time} – ${block.end_time}`}
                                        >
                                          <span className="text-[9px] font-semibold truncate w-full text-center px-0.5">
                                            {block.staff_name}
                                          </span>
                                          <span className="text-[9px] opacity-90 truncate w-full text-center px-0.5">
                                            {block.start_time}–{block.end_time}
                                          </span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )
                              })}
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Shift management (week view)</h3>
                  <p className="text-sm text-gray-600 mb-3">
                    Cell tint follows each staff member&apos;s Google Calendar color (set in Edit Staff). Unassigned
                    slots stay white.
                  </p>
              <div className="rounded-xl border border-gray-200 overflow-x-auto bg-white">
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-2 py-2 text-left text-sm font-semibold text-gray-700 w-40">Shift</th>
                      {dates.map((date) => (
                          <th key={date} className="px-2 py-2 text-center text-sm font-semibold text-gray-700 min-w-[140px]">
                            {formatDayHeaderJapan(date)}
                          </th>
                        ))}
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
                          const dow = getDayOfWeekJapan(date)
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
                          const assignedStaff = slot?.staff_name
                            ? calendarStaffOptions.find((x) => x.name === slot.staff_name)
                            : null
                          const staffOptIdx = assignedStaff
                            ? calendarStaffOptions.findIndex((x) => x.id === assignedStaff.id)
                            : 0
                          const shiftCellTint =
                            assignedStaff != null
                              ? staffScheduleCellTintClass(assignedStaff, staffOptIdx >= 0 ? staffOptIdx : 0)
                              : 'bg-white border-gray-100'

                          if (!shiftType) {
                            return (
                              <td key={date} className="px-2 py-2 min-w-[140px] bg-gray-50/50 align-top">
                                <span className="text-gray-300 text-xs">—</span>
                              </td>
                            )
                          }

                          return (
                            <td key={date} className="px-2 py-2 min-w-[140px] align-top">
                              <div className={`space-y-1 rounded-lg border p-1.5 ${shiftCellTint}`}>
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
                </div>
              </>
            )}
          </section>

          <section className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Teacher calendar</h3>
            <p className="text-sm text-gray-600 mb-3">
              Time blocks from teacher_schedules for this week (English teachers only; from Google Calendar fetch or shift assignment).
              Legend colors use each teacher&apos;s Schedule color from Edit Staff (Google Calendar palette).
            </p>
            <div className="flex items-center gap-2 mb-4">
              <button
                type="button"
                onClick={() => {
                  setWeekStart(addDaysJapan(weekStart, -7))
                }}
                className="p-2 rounded-lg border border-gray-300 hover:bg-gray-100 cursor-pointer"
                aria-label="Previous week"
              >
                <ChevronLeft className="w-5 h-5 text-gray-600" />
              </button>
              <span className="font-medium text-gray-700 min-w-[220px] text-center">
                {formatWeekLabelJapan(weekStart)}
              </span>
              <button
                type="button"
                onClick={() => setWeekStart(addDaysJapan(weekStart, 7))}
                className="p-2 rounded-lg border border-gray-300 hover:bg-gray-100 cursor-pointer"
                aria-label="Next week"
              >
                <ChevronRight className="w-5 h-5 text-gray-600" />
              </button>
            </div>
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <label className="text-sm font-medium text-gray-700">Fetch schedule for:</label>
                <select
                  value={fetchScheduleStaffId}
                  onChange={(e) => {
                    setFetchScheduleStaffId(e.target.value)
                    setFetchScheduleError('')
                  }}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white min-w-[180px]"
                >
                  <option value="">— Select staff —</option>
                  {staffList.filter((s) => s.calendar_id && s.staff_type === 'english_teacher').map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    const id = fetchScheduleStaffId ? parseInt(fetchScheduleStaffId, 10) : null
                    if (!id || fetchScheduleLoading) return
                    setFetchScheduleError('')
                    setFetchScheduleLoading(true)
                    try {
                      const res = await api.fetchStaffScheduleForStaff(id)
                      const msg =
                        res.eventsStored != null
                          ? `Fetched ${res.eventsStored} events for ${res.teacherName ?? staffList.find((s) => s.id === id)?.name}.`
                          : 'Schedule fetched.'
                      success(msg)
                      loadTeacherCalendar()
                    } catch (err) {
                      setFetchScheduleError(err.message || 'Failed to fetch schedule')
                    } finally {
                      setFetchScheduleLoading(false)
                    }
                  }}
                  disabled={!fetchScheduleStaffId || fetchScheduleLoading}
                  className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {fetchScheduleLoading ? <LoadingSpinner size="xs" /> : <Calendar className="w-4 h-4" />}
                  {fetchScheduleLoading ? 'Fetching…' : 'Fetch schedule'}
                </button>
                {fetchScheduleError && (
                  <span className="text-sm text-red-600">{fetchScheduleError}</span>
                )}
              </div>
            )}
            <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3 mb-4">
              <p className="text-xs text-gray-600 mb-2">
                Recurring break presets (1 hour from start time) are applied to booking capacity and shown in this calendar.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <select
                  value={newBreakPreset.teacher_name}
                  onChange={(e) => setNewBreakPreset((prev) => ({ ...prev, teacher_name: e.target.value }))}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white min-w-[160px]"
                >
                  <option value="">Teacher</option>
                  {staffList
                    .filter((s) => s?.staff_type === 'english_teacher')
                    .map((s) => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                </select>
                <select
                  value={newBreakPreset.weekday}
                  onChange={(e) => setNewBreakPreset((prev) => ({ ...prev, weekday: e.target.value }))}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
                >
                  {WEEKDAY_OPTIONS.map((d) => (
                    <option key={d.value} value={String(d.value)}>{d.label}</option>
                  ))}
                </select>
                <input
                  type="time"
                  title="1 hour break from this time"
                  value={newBreakPreset.start_time}
                  onChange={(e) => setNewBreakPreset((prev) => ({ ...prev, start_time: e.target.value }))}
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
                />
                <button
                  type="button"
                  onClick={handleCreateBreakPreset}
                  disabled={breakPresetLoading || !newBreakPreset.teacher_name}
                  className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" />
                  Add break
                </button>
              </div>
              {breakPresetError && <p className="mt-2 text-xs text-red-600">{breakPresetError}</p>}
              <div className="mt-2 max-h-28 overflow-auto rounded border border-gray-200 bg-white">
                {breakPresetLoading ? (
                  <p className="px-2 py-1.5 text-xs text-gray-500">Loading break presets…</p>
                ) : breakPresets.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-gray-500">No break presets yet.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {breakPresets.map((p) => (
                      <li key={p.id} className="px-2 py-1.5 flex items-center justify-between gap-2 text-xs">
                        <span
                          className={p.active === false ? 'text-gray-400 line-through' : 'text-gray-700'}
                          title={`${WEEKDAY_OPTIONS.find((d) => d.value === Number(p.weekday))?.label || p.weekday} ${String(p.start_time).slice(0, 5)}–${String(p.end_time).slice(0, 5)} (1h)`}
                        >
                          {p.teacher_name}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleToggleBreakPreset(p)}
                            className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
                          >
                            {p.active === false ? 'Enable' : 'Disable'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteBreakPreset(p.id)}
                            className="rounded border border-red-200 px-1.5 py-0.5 text-[11px] text-red-700 hover:bg-red-50"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {teacherCalendarLoading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8">
                <LoadingSpinner size="sm" />
                <p className="text-sm text-gray-500">Loading…</p>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 overflow-x-auto bg-white">
                {(() => {
                  try {
                    const events = Array.isArray(teacherCalendarEvents) ? teacherCalendarEvents : []
                    const staff = Array.isArray(staffList) ? staffList : []
                    const englishTeachers = staff
                      .filter((s) => s && s.staff_type === 'english_teacher')
                      .map((s) => String(s.name || '').trim())
                      .filter(Boolean)
                      .sort((a, b) => a.localeCompare(b))
                    const canonicalTeacher = canonicalTeacherNameMap(englishTeachers)
                    const byDate = {}
                    for (const ev of events) {
                      if (!ev || typeof ev !== 'object') continue
                      const raw = ev.teacher_name != null ? String(ev.teacher_name) : ''
                      const t = canonicalTeacher.get(teacherNameMatchKey(raw))
                      if (!t) continue
                      const d = ev.date != null ? String(ev.date).slice(0, 10) : ''
                      if (!d) continue
                      if (!byDate[d]) byDate[d] = []
                      byDate[d].push({
                        teacher: t,
                        start_time: ev.start_time != null ? String(ev.start_time) : '',
                        end_time: ev.end_time != null ? String(ev.end_time) : '',
                        kind: ev.kind != null ? String(ev.kind) : 'shift',
                      })
                    }
                    const dateList = Array.isArray(dates) ? dates : []
                    if (englishTeachers.length === 0) {
                      return (
                        <div className="px-4 py-6 text-center text-sm text-gray-500">
                          No English teachers in staff list. Add staff with type &quot;English Teacher&quot; to see the calendar.
                        </div>
                      )
                    }
                    const teacherColorIndex = {}
                    englishTeachers.forEach((name, idx) => {
                      const st = staffList.find((s) => s.name === name)
                      teacherColorIndex[name] = staffScheduleColorChipClass(st || {}, idx)
                    })
                    const hourLabels = Array.from(
                      { length: TEACHER_CALENDAR_END_HOUR - TEACHER_CALENDAR_START_HOUR + 1 },
                      (_, i) => `${String(TEACHER_CALENDAR_START_HOUR + i).padStart(2, '0')}:00`
                    )
                    const timelineHeight = hourLabels.length * TEACHER_CALENDAR_ROW_HEIGHT
                    return (
                      <>
                        <div className="flex flex-wrap gap-2 px-4 pt-3 pb-2 mb-2 border-b border-gray-100">
                          {englishTeachers.map((name) => (
                            <span
                              key={name}
                              className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border ${teacherColorIndex[name] || 'bg-gray-100 border-gray-300'}`}
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                        <div className="flex min-w-[600px] border-b border-gray-200">
                          <div className="w-14 shrink-0" />
                          {dateList.map((date) => (
                            <div
                              key={date}
                              className="flex-1 min-w-[80px] border-r border-gray-100 last:border-r-0 py-1.5 text-center text-xs font-semibold text-gray-700"
                            >
                              {formatDayHeaderJapan(date)}
                            </div>
                          ))}
                        </div>
                        <div className="flex min-w-[600px]">
                          <div
                            className="w-14 shrink-0 flex flex-col border-r border-gray-100"
                            style={{ height: timelineHeight }}
                          >
                            {hourLabels.map((label) => (
                              <div
                                key={label}
                                className="text-xs font-medium text-gray-500 flex items-center pr-1 justify-end border-b border-gray-50"
                                style={{ height: TEACHER_CALENDAR_ROW_HEIGHT }}
                              >
                                {label}
                              </div>
                            ))}
                          </div>
                          {dateList.map((date) => {
                            const blocks = byDate[date] || []
                            const cascadeIndices = cascadeIndicesForBlocks(blocks)
                            return (
                              <div
                                key={date}
                                className="flex-1 min-w-[80px] border-r border-gray-100 last:border-r-0 relative overflow-visible"
                                style={{ height: timelineHeight }}
                              >
                                {blocks.map((block, i) => {
                                  const startMin = minutesFromTimelineStart(block.start_time)
                                  const endMin = minutesFromTimelineStart(block.end_time)
                                  const duration = Math.max(1, endMin - startMin)
                                  const topPct = TEACHER_CALENDAR_TOTAL_MINUTES > 0 ? (startMin / TEACHER_CALENDAR_TOTAL_MINUTES) * 100 : 0
                                  const heightPct = TEACHER_CALENDAR_TOTAL_MINUTES > 0 ? (duration / TEACHER_CALENDAR_TOTAL_MINUTES) * 100 : 0
                                  const colorClass = block.kind === 'preset_break'
                                    ? 'bg-slate-100 border-slate-300 text-slate-700'
                                    : (teacherColorIndex[block.teacher] || 'bg-gray-100 border-gray-300 text-gray-800')
                                  const cascadeIndex = cascadeIndices[i] ?? 0
                                  return (
                                    <div
                                      key={i}
                                      className={`absolute rounded border overflow-hidden flex flex-col items-center justify-center ${colorClass}`}
                                      style={{
                                        top: `${topPct}%`,
                                        height: `${heightPct}%`,
                                        minHeight: 20,
                                        width: '80%',
                                        left: `${cascadeIndex * 10}px`,
                                        right: 'auto',
                                        zIndex: 10 + cascadeIndex,
                                      }}
                                      title={
                                        block.kind === 'preset_break'
                                          ? `${block.teacher} · ${block.start_time} (1h)`
                                          : `${block.teacher}: ${block.start_time} – ${block.end_time}`
                                      }
                                    >
                                      <span className="text-[9px] font-semibold truncate w-full text-center px-0.5">
                                        {block.teacher}
                                      </span>
                                      <span className="text-[9px] opacity-90 truncate w-full text-center px-0.5">
                                        {block.kind === 'preset_break'
                                          ? `${block.start_time} (1h)`
                                          : `${block.start_time}–${block.end_time}`}
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            )
                          })}
                        </div>
                      </>
                    )
                  } catch (err) {
                    console.error('[Staff] Teacher calendar render error:', err)
                    return (
                      <div className="px-4 py-6 text-center text-sm text-red-600">
                        Could not display teacher calendar. Check console for details.
                      </div>
                    )
                  }
                })()}
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
          onSaved={async (updated) => {
            if (updated) {
              setStaffList((prev) =>
                prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
              )
            }
            await loadStaff()
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
