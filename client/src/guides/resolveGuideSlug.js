export function resolveGuideSlug(notification) {
  const rawSlug = String(notification?.slug || '').trim().toLowerCase()
  if (rawSlug) {
    if (rawSlug === 'guide.students' || rawSlug.startsWith('guide.students')) return 'guide.students'
    if (rawSlug === 'guide.payments' || rawSlug.startsWith('guide.payments')) return 'guide.payments'
    if (rawSlug === 'guide.notes' || rawSlug.startsWith('guide.notes')) return 'guide.notes'
    if (rawSlug === 'guide.notifications' || rawSlug.startsWith('guide.notifications')) return 'guide.notifications'
    if (rawSlug === 'guide.change-history' || rawSlug.startsWith('guide.change-history')) return 'guide.change-history'
  }

  const text = `${notification?.title || ''} ${notification?.message || ''}`.toLowerCase()
  if (/(生徒|student)/.test(text)) return 'guide.students'
  if (/(支払い|payment)/.test(text)) return 'guide.payments'
  if (/(ノート|note)/.test(text)) return 'guide.notes'
  if (/(通知|notification)/.test(text)) return 'guide.notifications'
  if (/(変更履歴|change history|undo|redo)/.test(text)) return 'guide.change-history'
  return null
}
