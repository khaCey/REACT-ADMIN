export const GUIDE_DEFINITIONS = {
  'guide.students': {
    title: '生徒管理ガイド',
    steps: [
      {
        title: '生徒を作成する',
        description: '新しい生徒を登録するには、まず「Add Student」ボタンを押します。生徒情報を入力し、最後に「Add Student」を押して保存します。',
        route: '/students',
        action: 'students.create',
      },
      {
        title: '生徒詳細を表示する',
        description: '生徒詳細を表示するには、生徒一覧で対象の行をクリックします。詳細モーダルが開いたら、名前・連絡先・支払い情報を確認します。',
        route: '/students',
        action: 'students.view',
      },
      {
        title: '生徒情報を編集する',
        description: '生徒情報を編集するには、詳細モーダルの「Edit」を押します。変更したい項目を更新し、「Save」で保存します。',
        route: '/students',
        action: 'students.edit',
      },
      {
        title: '生徒を削除する',
        description: '生徒を削除するには、詳細モーダルの「Edit」を押し、編集モーダル内の「Delete」を選びます。確認モーダルで削除を確定します。',
        route: '/students',
        action: 'students.delete',
      },
    ],
  },
  'guide.payments': {
    title: '支払いガイド',
    steps: [
      {
        title: '支払いを追加する',
        description: '支払いを追加するには、生徒詳細モーダルで「Add Payment」を押します。金額・回数・日付を入力し、保存して登録します。',
        route: '/students',
        action: 'payments.add',
      },
      {
        title: '支払いを編集する',
        description: '支払いを編集するには、支払い一覧の対象レコードをクリックします。編集モーダルで内容を更新し、「Save」で反映します。',
        route: '/students',
        action: 'payments.edit',
      },
      {
        title: '支払いを削除する',
        description: '支払いを削除するには、支払いレコードを開いて編集モーダル内の「Delete」を押します。確認後に削除を確定します。',
        route: '/students',
        action: 'payments.delete',
      },
    ],
  },
  'guide.notes': {
    title: 'ノートガイド',
    steps: [
      {
        title: 'ノートを追加する',
        description: 'ノートを追加するには、生徒詳細モーダルで「Add Note」を押します。内容を入力し、保存して記録します。',
        route: '/students',
        action: 'notes.add',
      },
      {
        title: 'ノートを編集する',
        description: 'ノートを編集するには、ノート一覧から対象の行をクリックします。編集モーダルで内容を更新し、「Save」で保存します。',
        route: '/students',
        action: 'notes.edit',
      },
      {
        title: 'ノートを削除する',
        description: 'ノートを削除するには、編集モーダル内の「Delete」を押します。確認モーダルで削除を確定します。',
        route: '/students',
        action: 'notes.delete',
      },
    ],
  },
  'guide.notifications': {
    title: '通知ガイド',
    steps: [
      {
        title: '通知を作成する',
        description: '通知を作成するには、「Create Notification」を押して作成モーダルを開きます。タイトルと本文を入力し、作成を実行します。',
        route: '/notifications',
        action: 'notifications.create',
      },
      {
        title: '通知を表示する',
        description: '通知を表示するには、一覧の通知行をクリックします。詳細モーダルでタイトル・本文・作成者・日時を確認します。',
        route: '/notifications',
        action: 'notifications.view',
      },
      {
        title: '通知を編集する',
        description: '通知を編集するには、自分が作成した通知で「Edit」を押します。内容を更新して保存し、一覧への反映を確認します。',
        route: '/notifications',
        action: 'notifications.edit',
      },
      {
        title: '通知を削除する',
        description: '通知を削除するには、自分が作成した通知で「Delete」を押します。確認モーダルで削除を確定します。',
        route: '/notifications',
        action: 'notifications.delete',
      },
      {
        title: '既読 / 未読を切り替える',
        description: '既読 / 未読を切り替えるには、通知詳細の「既読にする」または「Mark as Unread」を押します。未読数の変化を確認します。',
        route: '/notifications',
        action: 'notifications.read-unread',
      },
    ],
  },
  'guide.change-history': {
    title: '変更履歴ガイド',
    steps: [
      {
        title: 'Undo / Redo トグル',
        description: '変更履歴で対象レコードをクリックして詳細を開きます。状態に応じて「Undo / Redo」トグルを押し、結果を確認します。',
        route: '/change-history',
        action: 'change-history.undo-redo',
      },
    ],
  },
};

export function getGuideBySlug(slug) {
  return GUIDE_DEFINITIONS[slug] || null;
}
