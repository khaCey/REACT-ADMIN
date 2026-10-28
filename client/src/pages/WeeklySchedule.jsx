import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react'
import { api } from '../api'
import { addDays, japanToday, layoutDay, splitWeekLessons, weekRange } from '../../../shared/weeklySchedule.js'
import './WeeklySchedule.css'

const dateLabel = (date, options = { day: 'numeric', month: 'short' }) => new Date(date + 'T00:00:00Z').toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' })
const timeLabel = value => value ? new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) : 'No time'
const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
function category(event) {
  const statuses = event.members.map(m => String(m.status || 'scheduled').toLowerCase())
  if (statuses.every(s => ['cancelled', 'canceled', 'rescheduled', 'unscheduled'].includes(s))) return 'inactive'
  if (statuses.every(s => s === 'reserved')) return 'reserved'
  if (event.kind === 'demo') return 'demo'
  if (event.kids) return 'kids'
  return 'regular'
}
function statusLabel(event) {
  if (event.members.some(m => m.awaitingDate)) return 'Date pending'
  const values = [...new Set(event.members.map(m => m.status || 'scheduled'))]
  return values.length === 1 ? values[0] : 'Mixed statuses'
}
function LessonDetails({ event, onClose }) {
  useEffect(() => {
    const close = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])
  return <div className="weekly-modal-backdrop" onClick={onClose}>
    <section className="weekly-modal" role="dialog" aria-modal="true" aria-labelledby="weekly-detail-title" onClick={e => e.stopPropagation()}>
      <button autoFocus type="button" onClick={onClose} aria-label="Close lesson details" className="weekly-close"><X size={20} /></button>
      <h2 id="weekly-detail-title" className="text-lg font-semibold pr-8">{event.title || 'Untitled lesson'}</h2>
      <p className="mt-3 text-sm">{event.date} · {timeLabel(event.start)}{event.end && `–${timeLabel(event.end)}`} · Japan time</p>
      <p className="text-sm mt-1">Teacher: {event.teacher || 'Not set'} · {event.kind || 'regular'}</p>
      <ul className="my-4 space-y-2 text-sm">
        {event.members.map((member, i) => <li key={`${member.id}-${i}`}>
          {member.id ? <Link className="text-green-700 underline" to={`/students/${member.id}`}>{member.name}</Link> : member.name}
          <span> — {member.status || 'scheduled'}{member.awaitingDate ? ' · awaiting new date' : ''} · sync: {member.syncStatus || 'unknown'}</span>
        </li>)}
      </ul>
      <p className="text-xs text-gray-500">Local event ID</p><code className="text-xs break-all">{event.eventId}</code>
    </section>
  </div>
}
export default function WeeklySchedule() {
  const [weekStart, setWeekStart] = useState(() => weekRange(japanToday()).start)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [selected, setSelected] = useState(null)
  const days = useMemo(() => weekRange(weekStart).days, [weekStart])
  useEffect(() => {
    let current = true
    setLoading(true); setError(''); setData(null); setSelected(null)
    api.getWeeklySchedule(weekStart).then(result => { if (current) setData(result) })
      .catch(err => { if (current) setError(err.message) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [weekStart, reload])
  const { timed, untimed } = useMemo(() => splitWeekLessons(data?.lessons || [], days), [data, days])
  const from = Math.max(0, Math.floor(Math.min(600, ...timed.map(e => e.from)) / 60) * 60)
  const until = Math.min(1440, Math.ceil(Math.max(1200, ...timed.map(e => e.to)) / 60) * 60)
  const hours = Array.from({ length: (until - from) / 60 + 1 }, (_, i) => from + i * 60)
  const scale = 1.4
  return <section className="weekly-page">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div><h1 className="text-2xl font-bold text-gray-900">Weekly Schedule</h1><p className="text-sm text-gray-500">Admin database · Japan time · {data?.lessons.length || 0} events</p></div>
      <div className="flex items-center gap-2 flex-wrap">
        <button className="weekly-nav" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={20} /></button>
        <span className="font-semibold text-sm">{dateLabel(weekStart, { day: 'numeric', month: 'short', year: 'numeric' })}–{dateLabel(addDays(weekStart, 6), { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        <button className="weekly-nav" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={20} /></button>
        <input aria-label="Choose a date in the week" type="date" value={weekStart} className="weekly-date" onChange={e => { if (e.target.value) { try { setWeekStart(weekRange(e.target.value).start) } catch { /* Ignore incomplete date input. */ } } }} />
        <button className="weekly-nav" disabled={loading} onClick={() => setReload(n => n + 1)} aria-label="Refresh database schedule"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button>
      </div>
    </div>
    <div className="flex flex-wrap gap-3 text-xs mb-3 text-gray-600">
      {['regular', 'kids', 'demo', 'reserved', 'inactive'].map(type => <span key={type} className="flex items-center gap-1"><i className={`weekly-key weekly-${type}`} />{type === 'inactive' ? 'Cancelled / rescheduled' : type[0].toUpperCase() + type.slice(1)}</span>)}
      {data && <span className="ml-auto">Loaded {timeLabel(data.fetchedAt)}</span>}
    </div>
    {error ? <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div> : loading ? <p role="status" className="p-6 text-gray-500">Loading weekly schedule…</p> : <>
      {data?.lessons.length === 0 && <p className="text-sm text-gray-500 mb-3">No lessons stored for this week.</p>}
      <div className="weekly-scroll" aria-label="Weekly lesson timetable">
        <div className="weekly-grid weekly-heading">
          <div className="p-2 text-xs text-gray-500">JST</div>
          {days.map(day => <div key={day} className={`weekly-day-label ${day === japanToday() ? 'weekly-current' : ''}`}>{dateLabel(day, { weekday: 'short' })}<strong>{dateLabel(day)}</strong></div>)}
        </div>
        <div className="weekly-grid" style={{ height: (until - from) * scale }}>
          <div className="weekly-time-axis">{hours.slice(0, -1).map(minute => <span key={minute} style={{ top: (minute - from) * scale }}>{clock(minute)}</span>)}</div>
          {days.map(day => <div key={day} className="weekly-day-column">
            {hours.map(minute => <div className="weekly-hour-line" key={minute} style={{ top: (minute - from) * scale }} />)}
            {layoutDay(timed.filter(event => event.day === day)).map(event => <button key={event.key} type="button" className={`weekly-event weekly-${category(event)}`} onClick={() => setSelected(event)} title={`${event.title}\n${timeLabel(event.start)}–${timeLabel(event.end)} · ${event.teacher || 'No teacher'} · ${statusLabel(event)}`} style={{ top: (event.from - from) * scale, height: Math.max(16, (event.to - event.from) * scale - 3), left: `calc(${100 * event.lane / event.columns}% + 2px)`, width: `calc(${100 / event.columns}% - 4px)` }}>
              <span className="weekly-event-time">{timeLabel(event.start)}{event.end && `–${timeLabel(event.end)}`}</span>
              <strong>{event.title || event.members.map(m => m.name).join(', ')}</strong>
              <span>{event.teacher || 'No teacher'} · {statusLabel(event)}</span>
            </button>)}
          </div>)}
        </div>
      </div>
      {untimed.length > 0 && <div className="mt-4"><h2 className="font-semibold text-sm mb-2">Without a scheduled time ({untimed.length})</h2><div className="flex flex-wrap gap-2">{untimed.map(event => <button key={event.key} className="weekly-nav text-sm text-left" onClick={() => setSelected(event)}>{event.date} · {event.title || 'Untitled lesson'} · {statusLabel(event)}</button>)}</div></div>}
    </>}
    {selected && <LessonDetails event={selected} onClose={() => setSelected(null)} />}
  </section>
}
