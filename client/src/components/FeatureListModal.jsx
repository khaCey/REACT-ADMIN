import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, CalendarX, ChevronRight, RefreshCw, X } from 'lucide-react'
import { api } from '../api'
import StudentDetailsModal from './StudentDetailsModal'
import ModalLoadingOverlay from './ModalLoadingOverlay'

/**
 * Modal list: 未納 (unpaid) or 未定 (unscheduled).
 * Click row → open student details.
 */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function getCurrentMonthYYYYMM() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function studentInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase()
}

function monthOptions() {
  const now = new Date()
  const cur = getCurrentMonthYYYYMM()
  const options = []
  for (let i = -2; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const yyyyMm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    options.push({
      value: yyyyMm,
      label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}${yyyyMm === cur ? ' (Current)' : ''}`,
    })
  }
  return options
}

const THEMES = {
  unpaid: {
    title: '未納',
    empty: 'No unpaid students for this month.',
    shell: 'from-rose-700 via-rose-600 to-orange-500',
    glow: 'bg-rose-400/30',
    avatar: 'bg-rose-100 text-rose-700 ring-rose-200',
    rowHover: 'hover:border-rose-200 hover:bg-rose-50/70',
    chip: 'bg-rose-50 text-rose-700 ring-rose-200',
    countDot: 'bg-rose-500',
    Icon: AlertCircle,
  },
  unscheduled: {
    title: '未定',
    empty: 'No unscheduled students this month.',
    shell: 'from-teal-700 via-emerald-600 to-green-500',
    glow: 'bg-emerald-300/30',
    avatar: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
    rowHover: 'hover:border-emerald-200 hover:bg-emerald-50/70',
    chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    countDot: 'bg-emerald-500',
    Icon: CalendarX,
  },
}

export default function FeatureListModal({ mode, onClose, onOpenStudent }) {
  const isUnpaid = mode === 'unpaid'
  const theme = THEMES[isUnpaid ? 'unpaid' : 'unscheduled']
  const ThemeIcon = theme.Icon
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [detailStudentId, setDetailStudentId] = useState(null)
  const [unpaidMonth, setUnpaidMonth] = useState(getCurrentMonthYYYYMM)
  const months = useMemo(() => monthOptions(), [])

  const fetchList = () => {
    setLoading(true)
    setError(null)
    const promise = isUnpaid
      ? api.getUnpaidStudents(unpaidMonth)
      : api.getUnscheduledLessonsStudents()
    promise
      .then((rows) => setList(rows || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (mode) fetchList()
  }, [mode, isUnpaid ? unpaidMonth : undefined])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const handleRowClick = (id) => {
    if (onOpenStudent) onOpenStudent(id)
    else setDetailStudentId(id)
  }

  const modal = (
    <div className="fixed inset-0 z-[50]" role="dialog" aria-modal="true" aria-labelledby="featureModalTitle">
      <div className="absolute inset-0 bg-slate-900/55 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-8 overflow-auto">
        <div className="relative w-full max-w-2xl rounded-[1.75rem] bg-[#f7f8f5] shadow-[0_28px_80px_-24px_rgba(15,23,42,0.55)] ring-1 ring-black/10 flex flex-col max-h-[90vh] overflow-hidden">
          {loading && <ModalLoadingOverlay className="rounded-[1.75rem]" />}

          <header className={`relative flex-shrink-0 overflow-hidden bg-gradient-to-br ${theme.shell} px-6 pb-6 pt-5 text-white`}>
            <div className={`pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full ${theme.glow} blur-2xl`} />
            <div className={`pointer-events-none absolute -bottom-16 left-10 h-36 w-36 rounded-full ${theme.glow} blur-3xl`} />
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.12]"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
                backgroundSize: '18px 18px',
              }}
            />

            <div className="relative flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tracking-wide text-white/90 ring-1 ring-white/20">
                  <ThemeIcon className="h-3.5 w-3.5" />
                  {isUnpaid ? 'Outstanding payments' : 'No lessons this month'}
                </div>
                <h3 id="featureModalTitle" className="text-3xl font-bold tracking-tight">
                  {theme.title}
                </h3>
                <p className="mt-1.5 text-sm text-white/80">
                  {loading ? 'Loading…' : (
                    <>
                      <span className="font-semibold text-white">{list.length}</span>
                      {' '}student{list.length === 1 ? '' : 's'} · tap a row to open details
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/15 ring-1 ring-white/25 hover:bg-white/25 cursor-pointer"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="relative mt-5 flex flex-wrap items-center gap-2">
              {isUnpaid && (
                <select
                  id="unpaidMonthSelect"
                  value={unpaidMonth}
                  onChange={(e) => setUnpaidMonth(e.target.value)}
                  className="rounded-full border-0 bg-white/95 px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-white/60 cursor-pointer"
                  aria-label="Month"
                >
                  {months.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={fetchList}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-2 text-sm font-semibold text-white ring-1 ring-white/25 hover:bg-white/25 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <span className={`ml-auto inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${theme.chip}`}>
                <span className={`h-2 w-2 rounded-full ${theme.countDot}`} />
                {list.length}
              </span>
            </div>
          </header>

          <div className="flex flex-col flex-1 min-h-0 px-4 py-4 sm:px-5">
            {error && (
              <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {error}
              </p>
            )}

            <div className="relative overflow-y-auto max-h-[52vh] flex-1 min-h-0 pr-1">
              {!loading && !error && list.length === 0 && (
                <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/70 px-6 text-center">
                  <span className={`mb-3 grid h-14 w-14 place-items-center rounded-2xl ${theme.avatar} ring-1`}>
                    <ThemeIcon className="h-6 w-6" />
                  </span>
                  <p className="text-sm font-medium text-slate-500">{theme.empty}</p>
                </div>
              )}

              {!loading && !error && list.length > 0 && (
                <ul className="space-y-2">
                  {list.map((s, index) => (
                    <li
                      key={s.ID}
                      style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
                      className="animate-[featureRowIn_280ms_ease-out_both]"
                    >
                      <button
                        type="button"
                        onClick={() => handleRowClick(s.ID)}
                        className={`group flex w-full items-center gap-3 rounded-2xl border border-white bg-white px-3.5 py-3 text-left shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_24px_-16px_rgba(15,23,42,0.35)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-14px_rgba(15,23,42,0.35)] cursor-pointer ${theme.rowHover}`}
                      >
                        <span
                          className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-sm font-bold ring-1 ${theme.avatar}`}
                        >
                          {studentInitials(s.Name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-semibold text-slate-900">
                            {s.Name || '—'}
                          </span>
                          <span className="mt-0.5 block text-xs font-medium tabular-nums text-slate-400">
                            ID {s.ID}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-slate-500" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <footer className="flex-shrink-0 flex items-center justify-between gap-3 border-t border-slate-200/80 bg-white/80 px-5 py-3.5 backdrop-blur">
            <p className="text-sm text-slate-500">
              <span className="font-semibold text-slate-700">{theme.title}</span>
              <span className="mx-1.5 text-slate-300">·</span>
              <span className="tabular-nums font-semibold text-slate-800">{list.length}</span>
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 cursor-pointer"
            >
              Close
            </button>
          </footer>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {createPortal(modal, document.body)}
      {detailStudentId != null && (
        <StudentDetailsModal
          studentId={detailStudentId}
          onClose={() => setDetailStudentId(null)}
          onStudentDeleted={() => {
            setDetailStudentId(null)
            fetchList()
          }}
          onStudentUpdated={fetchList}
        />
      )}
    </>
  )
}
