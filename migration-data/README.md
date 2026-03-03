# Migration Data

Export your Google Sheets as CSV and place them here, then run:

```bash
node scripts/migrate.js --import
```

## Required files

| File | Source sheet | Columns |
|------|--------------|---------|
| Students.csv | Students | ID, Name, 漢字, Email, Phone, phone, 当日, Status, Payment, Group, 人数, 子 |
| Payment.csv | Payment | Transaction ID, Student ID, Year, Month, Amount, Discount, Total, Date, Method, Staff |
| Notes.csv | Notes | Student ID, ID, Staff, Date, Note |
| Lessons.csv | Lessons | Student ID, Month (YYYY-MM or "January 2025"), Lessons |

## Optional files

| File | Source sheet | Columns |
|------|--------------|---------|
| MonthlySchedule.csv | MonthlySchedule | EventID, Title, Date, Start, End, Status, StudentName, IsKidsLesson, TeacherName |
| Unpaid.csv | Unpaid | Student Name, Student ID |
| Stats.csv | Stats | Month, Lessons, Students |

**Group lessons (MonthlySchedule):** Use `StudentName` = `"Student A and Student B"` (or `,` or `&`). Each name is split and one schedule row is created per student.

**Note:** Lessons This Month uses live Google Calendar data at runtime. For the sample, export `MonthlySchedule` (cached calendar events) as CSV to populate the schedule. Lessons.csv provides monthly totals.

## Export from Google Sheets

1. Open each sheet tab
2. File → Download → Comma-separated values (.csv)
3. Rename to match the table above (e.g. Payment.csv not Payment - Sheet1.csv)
4. Place in this folder
5. Run `node scripts/migrate.js --import`
