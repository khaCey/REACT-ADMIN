# Student Admin - React + PostgreSQL

Offline Student Management System. One command to start.

## Quick Start

```bash
cd react-app
npm install
cd client && npm install && cd ..
npm start
```

This will:
1. Start PostgreSQL (embedded, or use existing if `DATABASE_URL` is set)
2. Run database migrations
3. Start the API at http://localhost:3001
4. Start the React app at http://localhost:5173
5. Open your browser

## Alternative: Docker PostgreSQL

Embedded PostgreSQL may fail on Windows. Use Docker instead:

```bash
docker-compose up -d
```

Then (PowerShell):
```powershell
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
npm start
```

Or (CMD):
```cmd
set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
npm start
```

## Project Structure

- `start.js` - Single entry point
- `server/` - Express API + PostgreSQL
- `client/` - Vite + React
- `shared/` - feeTable, constants

## Database migration

```bash
# Apply schema only
npm run migrate

# Apply schema + import from CSV files
npm run migrate:import
```

Export your Google Sheets as CSV to `migration-data/` (Students.csv, Payment.csv, Notes.csv, Lessons.csv). See `migration-data/README.md` for details.

## API

- `GET /api/students` - List students
- `GET /api/students/:id` - Get student
- `POST /api/students` - Add student
- `PUT /api/students/:id` - Update student
- `DELETE /api/students/:id` - Delete student
- `GET /api/payments` - List payments
- `POST /api/payments` - Add payment
- `GET /api/notes?student_id=X` - List notes
- `POST /api/notes` - Add note
- `GET /api/dashboard/stats` - Dashboard stats
- `GET /api/config/feature-flags` - Feature flags
