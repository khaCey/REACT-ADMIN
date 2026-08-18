# LINE Linking Email Test

Branch: `feature/line-link-email`

## Scope of this branch

This branch tests only the REACT-ADMIN email portion of LINE ↔ student linking.

Current flow:

```text
Staff opens a student in REACT-ADMIN
        ↓
LINE連携メールを送信
        ↓
REACT-ADMIN reads the student's saved email from PostgreSQL
        ↓
REACT-ADMIN sends the email through the Gmail API
        ↓
Student receives a Green Square LINE linking email
```

The email currently contains a configurable **test URL**. It does not yet create or claim a GAS one-time linking token.

Default test URL:

```text
https://booking.kaelenoer.com/link/TEST
```

The next phase will replace this test URL with the URL returned by the GAS `line_link_create` action.

---

## Security decisions in this branch

- The browser does not choose the destination email address.
- The Node backend reads the student's email from the private `students` table.
- Gmail/service-account credentials never reach the React frontend.
- The API response returns only a masked recipient address.
- The audit log records only the masked recipient address, send timestamp and test mode.
- This branch does not send student data to GAS.
- Email sending requires an authenticated REACT-ADMIN session.

---

## Google Workspace setup

REACT-ADMIN already uses `googleapis` and supports service-account credentials.

The Gmail sender uses the same credential inputs:

```text
GOOGLE_SERVICE_ACCOUNT_KEY_PATH
```

or:

```text
GOOGLE_SERVICE_ACCOUNT_JSON
```

The Google Workspace service account must have domain-wide delegation configured for this scope:

```text
https://www.googleapis.com/auth/gmail.send
```

The delegated user is the mailbox that sends the message.

---

## `.env` settings

Add:

```env
GOOGLE_MAIL_ENABLED=1
GOOGLE_MAIL_DELEGATED_USER=office@yourdomain.com
GOOGLE_MAIL_FROM_ADDRESS=office@yourdomain.com
GOOGLE_MAIL_FROM_NAME=Green Square
LINE_LINK_EMAIL_TEST_URL=https://booking.kaelenoer.com/link/TEST
```

`GOOGLE_MAIL_FROM_ADDRESS` may be omitted when it is the same as `GOOGLE_MAIL_DELEGATED_USER`.

If a different Gmail send-as alias is used, that alias must already be valid for the delegated Gmail account.

Never commit the real `.env` or service-account credentials.

---

## Unit test

From the REACT-ADMIN project root:

```powershell
npm run test:line-email
```

This checks:

- email validation
- masked recipient output
- Japanese subject/body generation
- test booking link placement in both text and HTML versions

It does not send a real email.

---

## Manual send test

1. Configure the Gmail environment variables.
2. Restart the REACT-ADMIN Node server so it reads the new `.env` values.
3. Use a test student whose saved email address you control.
4. Open that student's detail page.
5. Find the `LINE連携` section.
6. Click `LINE連携メールを送信`.
7. Confirm the warning that this branch currently sends a test link.
8. Verify the UI displays a successful send result.
9. Verify the email arrives.
10. Check both the HTML button and fallback URL.

Expected subject:

```text
Green Square LINE予約サービスのご案内
```

Expected CTA:

```text
LINEと連携する
```

---

## Failure tests

### Student has no email

Expected:

```text
メールアドレスが登録されていないため送信できません。
```

The button is disabled in the UI.

### Gmail feature disabled

Set:

```env
GOOGLE_MAIL_ENABLED=0
```

Expected backend error code:

```text
EMAIL_NOT_CONFIGURED
```

### Bad saved email

Expected backend error code:

```text
INVALID_EMAIL
```

### Gmail API / delegation failure

Expected backend error code:

```text
EMAIL_SEND_FAILED
```

Check the Node server log for the underlying configuration/API error. The raw credentials are never returned to the browser.

---

## Next phase

After real email delivery is confirmed:

```text
REACT-ADMIN
  ↓ selected student number
GAS line_link_create
  ↓ secure one-time URL
REACT-ADMIN email sender
  ↓
https://booking.kaelenoer.com/link/<opaque-token>
```

At that point the test URL is removed and the email sender uses the GAS-generated invitation URL instead.
