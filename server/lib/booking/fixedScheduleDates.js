import { createHash } from 'node:crypto';

export function fixedKey(...parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
export function validMonth(month) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(month));
}
export function addMonths(month, amount) {
  if (!validMonth(month)) throw new Error('month must be YYYY-MM');
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m - 1 + amount, 1)).toISOString().slice(0, 7);
}
export function occurrenceDates(month, weekday) {
  if (
    !validMonth(month) ||
    !Number.isInteger(weekday) ||
    weekday < 1 ||
    weekday > 7
  )
    throw new Error('Invalid month or weekday');
  const [y, m] = month.split('-').map(Number);
  const dates = [];
  for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++) {
    const date = new Date(Date.UTC(y, m - 1, d));
    if ((date.getUTCDay() || 7) === weekday)
      dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}
export function fixedStart(date, time) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    throw new Error('Invalid date or time');
  const value = new Date(`${date}T${time}:00+09:00`);
  if (
    Number.isNaN(value.getTime()) ||
    new Date(value.getTime() + 32400000).toISOString().slice(0, 10) !== date
  )
    throw new Error('Invalid calendar date');
  return value;
}
