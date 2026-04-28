import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { MessageSquare, Send, Plus, Users, Clock3, Reply, Inbox, PencilLine } from 'lucide-react'
import { api } from '../api'
import FullPageLoading from '../components/FullPageLoading'

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

export default function Messages() {
  const location = useLocation()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [conversations, setConversations] = useState([])
  const [selectedConversationId, setSelectedConversationId] = useState(null)
  const [selectedConversation, setSelectedConversation] = useState(null)
  const [participants, setParticipants] = useState([])
  const [items, setItems] = useState([])
  const [replyBody, setReplyBody] = useState('')
  const [replyParentId, setReplyParentId] = useState(null)
  const [sendingReply, setSendingReply] = useState(false)
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createSubject, setCreateSubject] = useState('')
  const [createBody, setCreateBody] = useState('')
  const [staffOptions, setStaffOptions] = useState([])
  const [selectedParticipantIds, setSelectedParticipantIds] = useState([])
  const selectedParticipantIdNums = useMemo(
    () =>
      selectedParticipantIds
        .map((v) => Number.parseInt(v, 10))
        .filter((v) => Number.isFinite(v) && v > 0),
    [selectedParticipantIds]
  )
  const allStaffIdStrings = useMemo(
    () => staffOptions.map((s) => String(s.id)),
    [staffOptions]
  )
  const isAllParticipantsSelected =
    staffOptions.length > 0 &&
    allStaffIdStrings.length > 0 &&
    allStaffIdStrings.every((id) => selectedParticipantIds.includes(id))

  const selectedConversationPreview = useMemo(
    () => conversations.find((c) => String(c.id) === String(selectedConversationId)) || null,
    [conversations, selectedConversationId]
  )
  const itemById = useMemo(() => {
    const map = new Map()
    for (const item of items) map.set(Number(item.id), item)
    return map
  }, [items])
  const selectedParentPreview = replyParentId != null ? itemById.get(Number(replyParentId)) || null : null

  const fetchConversations = useCallback(async ({ keepSelection = true } = {}) => {
    const data = await api.getMessageConversations({ limit: 100, offset: 0 })
    const rows = Array.isArray(data?.conversations) ? data.conversations : []
    setConversations(rows)
    if (!keepSelection || !rows.some((r) => String(r.id) === String(selectedConversationId))) {
      setSelectedConversationId(rows[0]?.id ?? null)
    }
  }, [selectedConversationId])

  const fetchConversationDetails = useCallback(async (conversationId) => {
    if (!conversationId) {
      setSelectedConversation(null)
      setParticipants([])
      setItems([])
      return
    }
    const [details, timeline] = await Promise.all([
      api.getMessageConversation(conversationId),
      api.getMessageItems(conversationId, { limit: 100 }),
    ])
    setSelectedConversation(details?.conversation || null)
    setParticipants(Array.isArray(details?.participants) ? details.participants : [])
    const timelineItems = Array.isArray(timeline?.items) ? timeline.items : []
    setItems(timelineItems)
    const lastId = timelineItems[timelineItems.length - 1]?.id
    if (lastId) {
      await api.markMessageConversationRead(conversationId, lastId)
    }
  }, [])

  const bootstrap = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [staffRes] = await Promise.all([
        api.getMessageStaff(),
        fetchConversations({ keepSelection: false }),
      ])
      setStaffOptions(Array.isArray(staffRes?.staff) ? staffRes.staff : [])
    } catch (err) {
      setError(err.message || 'Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [fetchConversations])

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  useEffect(() => {
    fetchConversationDetails(selectedConversationId).catch((err) => {
      setError(err.message || 'Failed to load conversation')
    })
  }, [selectedConversationId, fetchConversationDetails])

  useEffect(() => {
    const targetConversationId = String(location.state?.conversationId || '').trim()
    if (!targetConversationId) return
    setSelectedConversationId(targetConversationId)
    navigate(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state?.conversationId, navigate])

  const handleSendReply = async () => {
    if (!selectedConversationId) return
    const body = replyBody.trim()
    if (!body || sendingReply) return
    setSendingReply(true)
    setError('')
    try {
      await api.sendMessageItem(selectedConversationId, {
        body,
        parent_message_id: replyParentId,
      })
      setReplyBody('')
      setReplyParentId(null)
      await Promise.all([
        fetchConversationDetails(selectedConversationId),
        fetchConversations(),
      ])
    } catch (err) {
      setError(err.message || 'Failed to send message')
    } finally {
      setSendingReply(false)
    }
  }

  const handleCreateConversation = async (e) => {
    e.preventDefault()
    if (creating) return
    const body = createBody.trim()
    if (!body) {
      setError('Initial message is required')
      return
    }
    setCreating(true)
    setError('')
    try {
      const created = await api.createMessageConversation({
        subject: createSubject.trim(),
        message: body,
        participant_ids: selectedParticipantIdNums,
      })
      const conversationId = created?.conversation?.id
      setShowCreate(false)
      setCreateSubject('')
      setCreateBody('')
      setSelectedParticipantIds([])
      await fetchConversations({ keepSelection: false })
      if (conversationId) setSelectedConversationId(conversationId)
    } catch (err) {
      setError(err.message || 'Failed to create conversation')
    } finally {
      setCreating(false)
    }
  }

  if (loading) return <FullPageLoading />

  const buildTree = (flatItems) => {
    const byParent = new Map()
    for (const item of flatItems || []) {
      const parentKey = item.parent_message_id == null ? 'root' : String(item.parent_message_id)
      if (!byParent.has(parentKey)) byParent.set(parentKey, [])
      byParent.get(parentKey).push(item)
    }
    const sortFn = (a, b) => {
      const ta = new Date(a.created_at || 0).getTime()
      const tb = new Date(b.created_at || 0).getTime()
      if (ta !== tb) return ta - tb
      return Number(a.id) - Number(b.id)
    }
    for (const arr of byParent.values()) arr.sort(sortFn)
    const seen = new Set()
    const visit = (parentKey, depth = 0) => {
      const branch = byParent.get(parentKey) || []
      const out = []
      for (const node of branch) {
        const idKey = String(node.id)
        if (seen.has(idKey)) continue
        seen.add(idKey)
        out.push({
          node,
          depth,
          children: visit(idKey, depth + 1),
        })
      }
      return out
    }
    return visit('root', 0)
  }
  const tree = buildTree(items)
  const renderNode = (entry) => {
    const { node, depth, children } = entry
    const clampedDepth = Math.min(depth, 6)
    const indentPx = clampedDepth * 16
    return (
      <div key={node.id} className="space-y-1.5" style={indentPx > 0 ? { marginLeft: `${indentPx}px` } : undefined}>
        <div className={`relative ${clampedDepth > 0 ? 'border-l border-gray-300 pl-3' : ''}`}>
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 shadow-sm">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-700">{node.sender_name || `Staff #${node.sender_staff_id}`}</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                <Clock3 className="h-3 w-3 text-gray-400" />
                {formatDateTime(node.created_at)}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-gray-900">{node.body}</p>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setReplyParentId(node.id)}
                className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-900 cursor-pointer"
              >
                <Reply className="h-3 w-3" />
                Reply
              </button>
            </div>
          </div>
        </div>
        {children.length > 0 && (
          <div className="space-y-2">
            {children.map((child) => renderNode(child))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="w-full flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex justify-between items-center pt-3 pb-2 mb-3 border-b border-gray-200">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-green-600" />
          Messages
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            New Message
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreateConversation} className="mb-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Subject (optional)</label>
            <input
              value={createSubject}
              onChange={(e) => setCreateSubject(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm"
              placeholder="Message Subject"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Participants</label>
            <div className="max-h-40 overflow-y-auto rounded-md border border-gray-300 bg-gray-50 px-2.5 py-2 space-y-1.5">
              <label className="flex items-center gap-2 text-sm text-gray-900">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300"
                  checked={isAllParticipantsSelected}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedParticipantIds(allStaffIdStrings)
                    } else {
                      setSelectedParticipantIds([])
                    }
                  }}
                />
                <span>All</span>
              </label>
              {staffOptions.map((s) => {
                const value = String(s.id)
                const checked = selectedParticipantIds.includes(value)
                return (
                  <label key={s.id} className="flex items-center gap-2 text-sm text-gray-900">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300"
                      checked={checked}
                      onChange={(e) => {
                        setSelectedParticipantIds((prev) => {
                          if (e.target.checked) {
                            return [...new Set([...prev, value])]
                          }
                          return prev.filter((id) => id !== value)
                        })
                      }}
                    />
                    <span>{s.name}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <div>
            <textarea
              value={createBody}
              onChange={(e) => setCreateBody(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm"
              rows={3}
              placeholder="Type your message..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
            >
              {creating ? 'Creating…' : 'Create message'}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-3 flex-1 min-h-0">
        <section className="rounded-xl border border-gray-200 bg-white overflow-hidden min-h-0 flex flex-col shadow-sm">
          <div className="px-3 py-2 border-b border-gray-200 text-sm font-semibold text-gray-800 inline-flex items-center gap-1.5">
            <Inbox className="w-4 h-4 text-gray-500" />
            Threads
          </div>
          <div className="overflow-y-auto flex-1 min-h-0">
            {conversations.length === 0 ? (
              <p className="px-3 py-3 text-sm text-gray-500 inline-flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-gray-400" />
                No conversations yet.
              </p>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => setSelectedConversationId(conv.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition ${
                    String(conv.id) === String(selectedConversationId)
                      ? 'bg-green-50 border-l-4 border-l-green-500'
                      : 'bg-white border-l-4 border-l-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900 truncate">{conv.subject || 'Untitled conversation'}</p>
                    <div className="inline-flex items-center gap-1.5">
                      {Number(conv.unread_count || 0) > 0 && <span className="h-2 w-2 rounded-full bg-rose-500" />}
                      {Number(conv.unread_count || 0) > 0 && (
                        <span className="inline-flex min-w-5 justify-center rounded-full bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 truncate mt-0.5">{conv.last_message_body || 'No messages yet'}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5 inline-flex items-center gap-1">
                    <Clock3 className="w-3 h-3 text-gray-400" />
                    {conv.last_message_sender_name ? `${conv.last_message_sender_name} · ` : ''}
                    {formatDateTime(conv.last_message_at || conv.updated_at || conv.created_at)}
                  </p>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white overflow-hidden min-h-0 flex flex-col shadow-sm">
          {!selectedConversationId ? (
            <div className="flex-1 min-h-0 grid place-items-center text-sm text-gray-500">Select a thread to view messages.</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                <p className="text-sm font-semibold text-gray-900">
                  {selectedConversation?.subject || selectedConversationPreview?.subject || 'Untitled conversation'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5 truncate inline-flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-gray-400" />
                  Participants: {participants.map((p) => p.name).join(', ') || 'Loading…'}
                </p>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2 bg-gray-50/40">
                {tree.length === 0 ? (
                  <p className="text-sm text-gray-500 inline-flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-gray-400" />
                    No messages yet.
                  </p>
                ) : (
                  tree.map((entry) => renderNode(entry))
                )}
              </div>
              <div className="border-t border-gray-200 p-3 bg-white">
                {selectedParentPreview && (
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-800">
                    <PencilLine className="h-3 w-3" />
                    <span>
                      Replying to {selectedParentPreview.sender_name || `Staff #${selectedParentPreview.sender_staff_id}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setReplyParentId(null)}
                      className="font-semibold hover:text-green-900 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={2}
                    className="flex-1 rounded-md border border-gray-300 px-2.5 py-2 text-sm"
                    placeholder="Message"
                  />
                  <button
                    type="button"
                    onClick={handleSendReply}
                    disabled={sendingReply || !replyBody.trim()}
                    className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
                  >
                    <Send className="w-4 h-4" />
                    {sendingReply ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
