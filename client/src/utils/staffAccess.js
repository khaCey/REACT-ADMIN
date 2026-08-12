/** Owner-only features (e.g. Signed Up Tracker). Name match is case-insensitive. */
export function isKhaceyStaff(staff) {
  return String(staff?.name || '').trim().toLowerCase() === 'khacey'
}
