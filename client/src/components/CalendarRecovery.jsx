import { useEffect, useState } from 'react'
import { api } from '../api'
import ConfirmActionModal from './ConfirmActionModal'

const inputClass = 'rounded border border-gray-300 px-2 py-1.5 text-sm'
export default function CalendarRecovery() {
  const [settings, setSettings] = useState(null)
  const [filters, setFilters] = useState({ studentId: '', from: '', to: '', calendarId: '' })
  const [preview, setPreview] = useState(null)
  const [selected, setSelected] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [results, setResults] = useState([])
  useEffect(() => {
    let current = true
    api.getCalendarRecoverySettings().then(s => {
      if (!current) return
      setSettings(s)
      setFilters(f => ({ ...f, calendarId: s.calendars[0]?.id || '' }))
    }).catch(e => { if (current) setError(e.message) })
    return () => { current = false }
  }, [])
  const change = (key, value) => { setFilters(f => ({ ...f, [key]: value })); setPreview(null); setSelected([]); setResults([]) }
  const scan = async () => {
    setBusy(true); setError(''); setResults([]); setSelected([]); setPreview(null)
    try { setPreview(await api.previewCalendarRecovery(filters)) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const rebuild = async () => {
    setBusy(true); setError(''); const done = []
    for (const eventId of selected) {
      try { const r = await api.rebuildCalendarEvent({ ...filters, eventId }); done.push({ eventId, ok: true, newEventId: r.newEventId }) }
      catch (e) { done.push({ eventId, ok: false, error: e.message }); break }
    }
    setResults(done); setConfirm(false); setBusy(false); setSelected([]); setPreview(null)
  }
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 mb-6 space-y-3">
      <h2 className="font-semibold text-lg">Recover missing Calendar events</h2>
      <p className="text-sm text-gray-600">Check lessons previously linked to Google Calendar. Local-only lessons are excluded. Only verified missing events can be rebuilt; lesson UUIDs and notes are retained.</p>
      {settings && <p className="text-xs text-gray-500">Uses the existing Apps Script Calendar API. No additional Calendar sharing setup is needed.</p>}
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm">Student ID<input aria-label="Recovery student ID" type="number" min="1" value={filters.studentId} onChange={e => change('studentId', e.target.value)} className={inputClass + ' block w-28'} disabled={busy} /></label>
        <label className="text-sm">From<input aria-label="Recovery from" type="date" value={filters.from} onChange={e => change('from', e.target.value)} className={inputClass + ' block'} disabled={busy} /></label>
        <label className="text-sm">To<input aria-label="Recovery to" type="date" value={filters.to} onChange={e => change('to', e.target.value)} className={inputClass + ' block'} disabled={busy} /></label>
        <label className="text-sm">Rebuild into<select aria-label="Recovery destination" value={filters.calendarId} onChange={e => change('calendarId', e.target.value)} className={inputClass + ' block'} disabled={busy}>{settings?.calendars.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <button type="button" onClick={scan} disabled={busy || !settings || !filters.studentId || !filters.from || !filters.to} className="rounded bg-green-700 text-white px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Working…' : 'Check Calendar'}</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {preview && <>
        <p className="text-sm">Missing: {preview.counts.missing || 0} · Present: {preview.counts.present || 0} · Review: {preview.counts.review || 0} · Excluded: {preview.counts.excluded || 0}</p>
        <div className="overflow-auto max-h-96"><table className="w-full text-sm text-left"><thead><tr><th>Select</th><th>Lesson</th><th>Time (Japan)</th><th>Check</th></tr></thead><tbody>{preview.items.map(item => <tr key={item.eventId} className="border-t"><td><input type="checkbox" aria-label={'Rebuild ' + item.title + ' ' + item.start} disabled={busy || item.status !== 'missing'} checked={selected.includes(item.eventId)} onChange={e => setSelected(s => e.target.checked ? [...s, item.eventId] : s.filter(id => id !== item.eventId))} /></td><td className="py-2">{item.title}<details><summary className="text-xs text-gray-500 cursor-pointer">Recorded event ID</summary><code className="text-xs break-all">{item.eventId}</code></details></td><td>{item.start ? new Date(item.start).toLocaleString('en-GB', { timeZone: 'Asia/Tokyo' }) : '—'}</td><td>{item.status}<p className="text-xs text-gray-500">{item.reason?.replaceAll('_', ' ')}</p></td></tr>)}</tbody></table></div>
        <button type="button" disabled={busy || !selected.length} onClick={() => setConfirm(true)} className="rounded bg-green-700 text-white px-3 py-2 text-sm disabled:opacity-50">Rebuild selected ({selected.length})</button>
      </>}
      {results.length > 0 && <div className="text-sm"><p>Rebuilt and linked: {results.filter(r => r.ok).length}. Refresh the check before another rebuild.</p>{results.filter(r => !r.ok).map(r => <p key={r.eventId} className="text-red-700">Stopped: {r.error}. Retrying uses the same recovery event ID.</p>)}</div>}
      {confirm && <ConfirmActionModal title="Rebuild missing Calendar events" message={`Create ${selected.length} individual events in ${settings?.calendars.find(c => c.id === filters.calendarId)?.label}? Original descriptions and Calendar-only details cannot be recovered from the database. Existing lesson UUIDs, notes and reschedule links will be retained. No Calendar events will be deleted.`} confirmLabel="Rebuild and link" confirming={busy} onConfirm={rebuild} onClose={() => !busy && setConfirm(false)} />}
    </section>
  )
}
