import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardList, Plus, Download, X } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../context/ToastContext'
import { getCurrentYyyyMmJst, addOneMonthYyyyMm } from '../utils/jstMonth'
import ToggleSwitch from '../components/ToggleSwitch'
import StudentDetailsModal from '../components/StudentDetailsModal'
import LoadingSpinner from '../components/LoadingSpinner'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function getMondayJstStr() {
  const jst = new Date(Date.now() + JST_OFFSET_MS)
  const y = jst.getUTCFullYear()
  const m = jst.getUTCMonth()
  const d = jst.getUTCDate()
  const day = new Date(Date.UTC(y, m, d)).getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const mon = new Date(Date.UTC(y, m, d + mondayOffset))
  return `${mon.getUTCFullYear()}-${String(mon.getUTCMonth() + 1).padStart(2, '0')}-${String(mon.getUTCDate()).padStart(2, '0')}`
}

function monthOptions() {
  const cur = getCurrentYyyyMmJst()
  const [curY] = cur.split('-').map(Number)
  const janThisYear = `${curY}-01`
  const opts = []
  const next = addOneMonthYyyyMm(cur)
  if (next) opts.push(next)
  let ym = cur
  // Current month back through January of this (JST) year
  while (ym && ym >= janThisYear) {
    opts.push(ym)
    if (ym === janThisYear) break
    const [y, m] = ym.split('-').map(Number)
    let nm = m - 1
    let ny = y
    if (nm < 1) {
      nm = 12
      ny -= 1
    }
    ym = `${ny}-${String(nm).padStart(2, '0')}`
  }
  return [...new Set(opts)]
}

export default function DemoTracker() {
  const { success } = useToast()
  const [mode, setMode] = useState('month') // month | week
  const [month, setMonth] = useState(getCurrentYyyyMmJst)
  const [weekStart] = useState(getMondayJstStr)
  const [rows, setRows] = useState([])
  const [counts, setCounts] = useState({ total: 0, signed_up: 0, not_signed_up: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [importing, setImporting] = useState(false)
  const [detailStudentId, setDetailStudentId] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [allStudents, setAllStudents] = useState([])
  const [staffNames, setStaffNames] = useState([])
  const [addQuery, setAddQuery] = useState('')
  const [addStudentId, setAddStudentId] = useState('')
  const [addTeacher, setAddTeacher] = useState('')
  const [addDate, setAddDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [adding, setAdding] = useState(false)

  const months = useMemo(() => monthOptions(), [])

  const fetchList = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = mode === 'week' ? { weekStart } : { month }
    api
      .getDemoTracker(params)
      .then((res) => {
        setRows(Array.isArray(res?.rows) ? res.rows : [])
        setCounts(res?.counts || { total: 0, signed_up: 0, not_signed_up: 0 })
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [mode, month, weekStart])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  useEffect(() => {
    let cancelled = false
    api
      .getStaff()
      .then((staffRes) => {
        if (cancelled) return
        const staff = Array.isArray(staffRes?.staff) ? staffRes.staff : []
        const names = staff
          .filter((s) => s?.staff_type === 'english_teacher' && s.active !== false)
          .map((s) => String(s.name || s.Name || '').trim())
          .filter(Boolean)
        setStaffNames([...new Set(names)].sort((a, b) => a.localeCompare(b)))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!addOpen) return undefined
    let cancelled = false
    api
      .getStudents()
      .then((students) => {
        if (cancelled) return
        setAllStudents(Array.isArray(students) ? students : [])
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [addOpen])

  const addSuggestions = useMemo(() => {
    const q = addQuery.trim().toLowerCase()
    return (allStudents || [])
      .filter((s) => {
        if (!q) return true
        const hay = `${s.Name || ''} ${s.漢字 || ''} ${s.ID || ''}`.toLowerCase()
        return hay.includes(q)
      })
      .slice(0, 10)
  }, [allStudents, addQuery])

  const handleSignedUpChange = async (row, checked) => {
    setBusyId(row.id)
    setError(null)
    try {
      const res = await api.patchDemoTrackerEvent(row.id, { signed_up: checked })
      const next = res?.event
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...(next || { signed_up: checked }) } : r)))
      setCounts((c) => {
        const delta = checked ? 1 : -1
        const signed = Math.max(0, (c.signed_up || 0) + delta)
        return {
          total: c.total,
          signed_up: signed,
          not_signed_up: Math.max(0, (c.total || 0) - signed),
        }
      })
    } catch (e) {
      setError(e.message || 'Failed to update Signed up')
    } finally {
      setBusyId(null)
    }
  }

  const handleTeacherSave = async (row, nextRaw) => {
    const next = String(nextRaw ?? '').trim()
    const prev = String(row.teacher_name || '').trim()
    if (next === prev) return
    setBusyId(row.id)
    setError(null)
    try {
      const res = await api.patchDemoTrackerEvent(row.id, { teacher_name: next || null })
      const updated = res?.event
      setRows((prevRows) =>
        prevRows.map((r) =>
          r.id === row.id ? { ...r, ...(updated || { teacher_name: next || null }) } : r
        )
      )
    } catch (e) {
      setError(e.message || 'Failed to update teacher')
    } finally {
      setBusyId(null)
    }
  }

  const handleImport = async () => {
    setImporting(true)
    setError(null)
    try {
      const res = await api.importPastDemoTracker()
      success(`Imported ${res?.imported ?? 0} past demos (${res?.skipped ?? 0} already tracked)`)
      fetchList()
    } catch (e) {
      setError(e.message || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async (row) => {
    setBusyId(row.id)
    setError(null)
    try {
      await api.deleteDemoTrackerEvent(row.id)
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      setCounts((c) => ({
        total: Math.max(0, (c.total || 0) - 1),
        signed_up: row.signed_up ? Math.max(0, (c.signed_up || 0) - 1) : c.signed_up,
        not_signed_up: !row.signed_up ? Math.max(0, (c.not_signed_up || 0) - 1) : c.not_signed_up,
      }))
      success('Demo event removed from tracker')
    } catch (e) {
      setError(e.message || 'Failed to delete')
    } finally {
      setBusyId(null)
    }
  }

  const handleCreate = async () => {
    if (!addStudentId || !/^\d{4}-\d{2}-\d{2}$/.test(addDate)) {
      setError('Pick a student and date')
      return
    }
    setAdding(true)
    setError(null)
    try {
      await api.createDemoTrackerEvent({
        student_id: Number(addStudentId),
        teacher_name: addTeacher.trim() || undefined,
        demo_date: addDate,
      })
      success('Demo event added')
      setAddOpen(false)
      setAddQuery('')
      setAddStudentId('')
      setAddTeacher('')
      fetchList()
    } catch (e) {
      setError(e.message || 'Failed to create')
    } finally {
      setAdding(false)
    }
  }

  const rate =
    counts.total > 0 ? Math.round((100 * (counts.signed_up || 0)) / counts.total) : 0

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-green-600 text-white">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">Signed Up Tracker</h1>
            <p className="text-sm text-gray-600">
              Demo lessons — auto-tracked from booking &amp; calendar; import past demos anytime.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 cursor-pointer disabled:opacity-50"
          >
            <Download className={`h-4 w-4 ${importing ? 'animate-pulse' : ''}`} />
            {importing ? 'Importing…' : 'Import past demos'}
          </button>
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Add demo event
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
          <button
            type="button"
            onClick={() => setMode('month')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium cursor-pointer ${
              mode === 'month' ? 'bg-green-600 text-white' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            Month
          </button>
          <button
            type="button"
            onClick={() => setMode('week')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium cursor-pointer ${
              mode === 'week' ? 'bg-green-600 text-white' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            This week
          </button>
        </div>
        {mode === 'month' ? (
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          >
            {months.map((ym) => (
              <option key={ym} value={ym}>
                {ym}
                {ym === getCurrentYyyyMmJst() ? ' (current)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-gray-600">Week of {weekStart}</span>
        )}
        <div className="ml-auto flex flex-wrap gap-4 text-sm">
          <span className="text-gray-600">
            Demos <strong className="text-gray-900 tabular-nums">{counts.total}</strong>
          </span>
          <span className="text-gray-600">
            Signed up <strong className="text-green-700 tabular-nums">{counts.signed_up}</strong>
          </span>
          <span className="text-gray-600">
            Rate <strong className="text-gray-900 tabular-nums">{rate}%</strong>
          </span>
        </div>
      </div>

      {addOpen && (
        <div className="rounded-xl border border-green-200 bg-green-50/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Add demo event</h2>
            <button type="button" onClick={() => setAddOpen(false)} className="p-1 text-gray-500 hover:text-gray-800 cursor-pointer" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm sm:col-span-1">
              <span className="font-medium text-gray-700">Student</span>
              <input
                type="search"
                value={addQuery}
                onChange={(e) => {
                  setAddQuery(e.target.value)
                  setAddStudentId('')
                }}
                placeholder="Search name or ID…"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              {addQuery && !addStudentId && (
                <ul className="mt-1 max-h-36 overflow-y-auto rounded-md border border-gray-200 bg-white">
                  {addSuggestions.map((s) => (
                    <li key={s.ID}>
                      <button
                        type="button"
                        onClick={() => {
                          setAddStudentId(String(s.ID))
                          setAddQuery(s.Name || String(s.ID))
                        }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-green-50 cursor-pointer"
                      >
                        {s.Name} <span className="text-xs text-gray-500">#{s.ID}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </label>
            <label className="block text-sm">
              <span className="font-medium text-gray-700">Teacher</span>
              <input
                list="demo-tracker-teachers"
                value={addTeacher}
                onChange={(e) => setAddTeacher(e.target.value)}
                placeholder="Teacher name"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-gray-700">Demo date</span>
              <input
                type="date"
                value={addDate}
                onChange={(e) => setAddDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={adding || !addStudentId}
            onClick={handleCreate}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 cursor-pointer disabled:opacity-50"
          >
            {adding ? 'Saving…' : 'Create'}
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <datalist id="demo-tracker-teachers">
        {staffNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-white">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
            <LoadingSpinner />
          </div>
        )}
        <div className="overflow-x-auto max-h-[65vh]">
          <table className="min-w-full">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Student</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Teacher</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold tracking-wide text-gray-500">Signed up</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-500">
                    No demo events in this range. Try Import past demos or Add demo event.
                  </td>
                </tr>
              )}
              {rows.map((r, index) => {
                const rowBusy = busyId === r.id
                return (
                  <tr
                    key={r.id}
                    className={index % 2 === 1 ? 'bg-gray-50/40' : 'bg-white'}
                  >
                    <td className="px-4 py-3 text-sm tabular-nums text-gray-800">{r.demo_date}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setDetailStudentId(r.student_id)}
                        className="text-sm font-semibold text-green-700 hover:underline cursor-pointer"
                      >
                        {r.student_name || '—'}
                      </button>
                      {r.student_kanji ? (
                        <div className="text-xs text-gray-500">{r.student_kanji}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        list="demo-tracker-teachers"
                        defaultValue={r.teacher_name || ''}
                        key={`${r.id}-${r.teacher_name || ''}`}
                        disabled={rowBusy}
                        placeholder="Set teacher…"
                        onBlur={(e) => handleTeacherSave(r, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                        }}
                        className="w-full min-w-[8rem] max-w-[12rem] rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 disabled:opacity-50"
                        aria-label={`Teacher for ${r.student_name || r.id}`}
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{r.student_status || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="inline-flex justify-center">
                        <ToggleSwitch
                          checked={!!r.signed_up}
                          disabled={rowBusy}
                          onChange={(next) => handleSignedUpChange(r, next)}
                          aria-label={`Signed up ${r.student_name || r.id}`}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={rowBusy}
                        onClick={() => handleDelete(r)}
                        className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {detailStudentId != null && (
        <StudentDetailsModal
          studentId={detailStudentId}
          onClose={() => setDetailStudentId(null)}
          onStudentUpdated={fetchList}
          onStudentDeleted={() => {
            setDetailStudentId(null)
            fetchList()
          }}
        />
      )}
    </div>
  )
}
