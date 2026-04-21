import { createGuideDefinition } from './guideStepSchema'

const BASE_SANDBOX = {
  useDummyStudentId: 565,
  forbidMutations: true,
}

export const GUIDE_DEFINITIONS = {
  'guide.students': createGuideDefinition({
    title: '生徒管理ガイド',
    steps: [
      {
        id: 'students-create',
        title: '生徒を作成する',
        description: '新しい生徒を登録するには、まず「Add Student」ボタンを押します。生徒情報を入力し、最後に「Add Student」を押して保存します。',
        route: '/students',
        target: {
          selector: '[data-guide="students-add-button"]',
          fallbackSelectors: ['button:has-text("Add Student")', 'button'],
        },
        tooltip: { placement: 'bottom-right' },
        completion: { type: 'modal-open', payload: { action: 'students.create' } },
        sandbox: BASE_SANDBOX,
      },
      {
        id: 'students-view',
        title: '生徒詳細を表示する',
        description: '生徒詳細を表示するには、生徒一覧で対象の行をクリックします。詳細モーダルが開いたら、名前・連絡先・支払い情報を確認します。',
        route: '/students',
        target: {
          selector: '[data-guide="students-table-row"]',
          fallbackSelectors: ['table tbody tr', '[role="row"]'],
        },
        tooltip: { placement: 'bottom-right' },
        completion: { type: 'click', payload: { action: 'students.view' } },
        sandbox: BASE_SANDBOX,
      },
      {
        id: 'students-edit',
        title: '生徒情報を編集する',
        description: '生徒情報を編集するには、詳細モーダルの「Edit」を押します。変更したい項目を更新し、「Save」で保存します。',
        route: '/students',
        target: {
          selector: '[data-guide="students-edit-button"]',
          fallbackSelectors: ['button:has-text("Edit")', 'button'],
          placement: 'bottom-left',
        },
        tooltip: { placement: 'bottom-left' },
        completion: { type: 'modal-open', payload: { action: 'students.edit' } },
        sandbox: BASE_SANDBOX,
      },
      {
        id: 'students-delete',
        title: '生徒を削除する',
        description: '生徒を削除するには、詳細モーダルの「Edit」を押し、編集モーダル内の「Delete」を選びます。確認モーダルで削除を確定します。',
        route: '/students',
        target: {
          selector: '[data-guide="students-delete-button"]',
          fallbackSelectors: ['button:has-text("Delete")', 'button'],
          placement: 'top-right',
        },
        highlight: { shape: 'rect', padding: 12 },
        tooltip: { placement: 'top-right' },
        completion: { type: 'click', payload: { action: 'students.delete' } },
        sandbox: BASE_SANDBOX,
      },
    ],
  }),
  'guide.payments': createGuideDefinition({
    title: '支払いガイド',
    steps: [
      {
        id: 'payments-add',
        title: '支払いを追加する',
        description: '支払いを追加するには、生徒詳細モーダルで「Add Payment」を押します。金額・回数・日付を入力し、保存して登録します。',
        route: '/students',
        target: {
          selector: '[data-guide="payments-add-button"]',
          fallbackSelectors: ['button:has-text("Add Payment")', 'button'],
        },
        tooltip: { placement: 'bottom-right' },
        completion: { type: 'modal-open', payload: { action: 'payments.add' } },
        sandbox: BASE_SANDBOX,
      },
      {
        id: 'payments-edit',
        title: '支払いを編集する',
        description: '支払いを編集するには、支払い一覧の対象レコードをクリックします。編集モーダルで内容を更新し、「Save」で反映します。',
        route: '/students',
        target: {
          selector: '[data-guide="payments-table-row"]',
          fallbackSelectors: ['[data-payment-id]', 'table tbody tr'],
        },
        tooltip: { placement: 'bottom-right' },
        completion: { type: 'click', payload: { action: 'payments.edit' } },
        sandbox: BASE_SANDBOX,
      },
      {
        id: 'payments-delete',
        title: '支払いを削除する',
        description: '支払いを削除するには、支払いレコードを開いて編集モーダル内の「Delete」を押します。確認後に削除を確定します。',
        route: '/students',
        target: {
          selector: '[data-guide="payments-delete-button"]',
          fallbackSelectors: ['button:has-text("Delete")', 'button'],
        },
        tooltip: { placement: 'bottom-right' },
        completion: { type: 'click', payload: { action: 'payments.delete' } },
        sandbox: BASE_SANDBOX,
      },
    ],
  }),
  'guide.notes': createGuideDefinition({
    title: 'ノートガイド',
    steps: [
      {
        id: 'notes-add',
        title: 'ノートを追加する',
        description: 'ノートを追加するには、生徒詳細モーダルで「Add Note」を押します。内容を入力し、保存して記録します。',
        route: '/students',
        target: {
          selector: '[data-guide="notes-add-button"]',
          fallbackSelectors: ['button:has-text("Add Note")', 'button'],
        },
        completion: { type: 'modal-open', payload: { action: 'notes.add' } },
        sandbox: BASE_SANDBOX,
      },
      {
        id: 'notes-edit',
        title: 'ノートを編集する',
        description: 'ノートを編集するには、ノート一覧から対象の行をクリックします。編集モーダルで内容を更新し、「Save」で保存します。',
        route: '/students',
        target: {
          selector: '[data-guide="notes-table-row"]',
          fallbackSelectors: ['[data-note-id]', 'table tbody tr'],
        },
        completion: { type: 'click', payload: { action: 'notes.edit' } },
        sandbox: BASE_SANDBOX,
      },
      {
        id: 'notes-delete',
        title: 'ノートを削除する',
        description: 'ノートを削除するには、編集モーダル内の「Delete」を押します。確認モーダルで削除を確定します。',
        route: '/students',
        target: {
          selector: '[data-guide="notes-delete-button"]',
          fallbackSelectors: ['button:has-text("Delete")', 'button'],
        },
        completion: { type: 'click', payload: { action: 'notes.delete' } },
        sandbox: BASE_SANDBOX,
      },
    ],
  }),
  'guide.notifications': createGuideDefinition({
    title: '通知ガイド',
    steps: [
      {
        id: 'notifications-create',
        title: '通知を作成する',
        description: '通知を作成するには、「Create Notification」を押して作成モーダルを開きます。タイトルと本文を入力し、作成を実行します。',
        route: '/notifications',
        target: {
          selector: '[data-guide="notifications-create-button"]',
          fallbackSelectors: ['button:has-text("Create Notification")', 'button'],
        },
        completion: { type: 'modal-open', payload: { action: 'notifications.create' } },
        sandbox: { useDummyStudentId: 565, forbidMutations: true },
      },
      {
        id: 'notifications-view',
        title: '通知を表示する',
        description: '通知を表示するには、一覧の通知行をクリックします。詳細モーダルでタイトル・本文・作成者・日時を確認します。',
        route: '/notifications',
        target: {
          selector: '[data-guide="notifications-table-row"]',
          fallbackSelectors: ['table tbody tr', '[role="row"]'],
        },
        completion: { type: 'click', payload: { action: 'notifications.view' } },
        sandbox: { useDummyStudentId: 565, forbidMutations: true },
      },
      {
        id: 'notifications-edit',
        title: '通知を編集する',
        description: '通知を編集するには、自分が作成した通知で「Edit」を押します。内容を更新して保存し、一覧への反映を確認します。',
        route: '/notifications',
        target: {
          selector: '[data-guide="notifications-edit-button"]',
          fallbackSelectors: ['button:has-text("Edit")', 'button'],
        },
        completion: { type: 'modal-open', payload: { action: 'notifications.edit' } },
        sandbox: { useDummyStudentId: 565, forbidMutations: true },
      },
      {
        id: 'notifications-delete',
        title: '通知を削除する',
        description: '通知を削除するには、自分が作成した通知で「Delete」を押します。確認モーダルで削除を確定します。',
        route: '/notifications',
        target: {
          selector: '[data-guide="notifications-delete-button"]',
          fallbackSelectors: ['button:has-text("Delete")', 'button'],
        },
        completion: { type: 'click', payload: { action: 'notifications.delete' } },
        sandbox: { useDummyStudentId: 565, forbidMutations: true },
      },
      {
        id: 'notifications-read-unread',
        title: '既読 / 未読を切り替える',
        description: '既読 / 未読を切り替えるには、通知詳細の「既読にする」または「Mark as Unread」を押します。未読数の変化を確認します。',
        route: '/notifications',
        target: {
          selector: '[data-guide="notifications-read-toggle"]',
          fallbackSelectors: ['button:has-text("Mark as Unread")', 'button:has-text("既読にする")', 'button'],
        },
        completion: { type: 'click', payload: { action: 'notifications.read-unread' } },
        sandbox: { useDummyStudentId: 565, forbidMutations: true },
      },
    ],
  }),
  'guide.change-history': createGuideDefinition({
    title: '変更履歴ガイド',
    steps: [
      {
        id: 'change-history-undo-redo',
        title: 'Undo / Redo トグル',
        description: '変更履歴で対象レコードをクリックして詳細を開きます。状態に応じて「Undo / Redo」トグルを押し、結果を確認します。',
        route: '/change-history',
        target: {
          selector: '[data-guide="change-history-undo-redo-toggle"]',
          fallbackSelectors: ['button:has-text("Undo")', 'button:has-text("Redo")', 'button'],
        },
        completion: { type: 'click', payload: { action: 'change-history.undo-redo' } },
        sandbox: { useDummyStudentId: 565, forbidMutations: true },
      },
    ],
  }),
}

export function getGuideBySlug(slug) {
  return GUIDE_DEFINITIONS[slug] || null
}
