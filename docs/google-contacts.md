# Google Contacts sync (students via GAS)

Student contact sync now runs through **Calendar API (Google Apps Script)**:

1. Admin app creates/updates a student in Node (`/api/students`).
2. Node sends a server-to-server POST to GAS.
3. GAS creates/updates a Google Contact via the **People API** advanced service (`People.People.createContact` / `updateContact`).

This avoids Workspace domain-wide delegation setup in Node.

## Environment variables (Node server)

| Variable | Meaning |
|----------|---------|
| `STUDENT_SYNC_GAS_URL` | GAS Web App `/exec` URL that accepts `student_upsert` POSTs. |
| `STUDENT_SYNC_API_KEY` | Dedicated secret key for student sync POST auth. |

If either value is missing, student CRUD still works and contact sync is reported as `disabled`.

## GAS script properties

In Apps Script project settings, add script property:

- `STUDENT_SYNC_API_KEY` = same value as server `.env`

## OAuth (required for People API)

The manifest must include `https://www.googleapis.com/auth/contacts`, and the **same Google account that deploys the Web app** must complete consent after that scope is added. In the Apps Script editor, run **`runAuthorizePeopleContactsOnce`** once (see `Calendar API/Code.js`), then deploy a **new** Web app version. If the error persists, see **Contacts permission** in [`how-to-update-gas.md`](how-to-update-gas.md) (revoke + re-authorize, Workspace admin).

## Request contract (Node -> GAS)

- `action`: `"student_upsert"`
- `studentId`, `name`, `nameKanji`, `email`, `phone`, `phoneSecondary`, `groupType`, `isChild`
- `source`, `timestamp`
- Auth key via query string `?key=...`

## API behavior in Student Admin

- **POST `/api/students`** returns:
  - `id`
  - `googleContactCreated` (boolean)
  - `googleContactSync`: `ok | failed | disabled`
- **PUT `/api/students/:id`** returns:
  - `ok`
  - `googleContactSync`: `ok | failed | disabled`
- **POST `/api/students/:id/google-contact-sync`** (manual button trigger) returns:
  - Success: `{ ok: true, googleContactSync: "ok", actionTaken, contactId }`
  - Failure: `{ ok: false, googleContactSync: "failed"|"disabled", error }`

Sync failures do not roll back the student insert/update.

## Manual sync button

`StudentDetailsModal` now shows an always-visible **Create/Resync Google Contact** button.  
It calls `POST /api/students/:id/google-contact-sync` and surfaces result in the UI without closing the modal.

## Idempotency and dedupe

GAS writes a marker in contact notes: `[STUDENT_ID:<id>]`, then prefers:

1. Marker/property lookup for that student id
2. Email match
3. Name match fallback

Repeated `student_upsert` requests update the same contact when possible.

## Related code

- `server/lib/studentContactSync.js` — Node sender
- `server/routes/students.js` — create/update hooks + response status
- `Calendar API/Code.js` — `doPost` routing/auth for `student_upsert`
- `Calendar API/Functions.js` — `upsertStudentContact_` helpers
