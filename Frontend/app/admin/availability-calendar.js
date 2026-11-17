// Calendar dates use Nairobi throughout, independently of the browser's timezone.
export const calendarDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
export const dayStart = day => Date.parse(`${day}T00:00:00+03:00`);
export const moveDay = (day, count) => new Date(Date.parse(`${day}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
export function calendarMonth(value, now = new Date()) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '') && Number(value.slice(0, 4)) >= 1000 && Number(value.slice(0, 4)) <= 9998 ? value : calendarDay(now).slice(0, 7);
}
export function moveMonth(month, count) {
  const date = new Date(`${calendarMonth(month)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString().slice(0, 7);
}
export function monthDays(month) {
  const first = `${calendarMonth(month)}-01`;
  const weekday = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = moveDay(first, -weekday);
  const length = Math.ceil((Number(moveDay(`${moveMonth(month, 1)}-01`, -1).slice(-2)) + weekday) / 7) * 7;
  return Array.from({ length }, (_, i) => moveDay(start, i));
}
export const windowsOnDay = (windows, day) => windows.filter(window => Date.parse(window.startsAt) < dayStart(moveDay(day, 1)) && Date.parse(window.endsAt) > dayStart(day));
export function matchingWindows(windows, blueprints, filters) {
  return windows.filter(window => (!filters.active || String(window.active) === filters.active) && (!filters.blueprint || window.blueprintId === filters.blueprint) && (!filters.career || blueprints.find(b => b.id === window.blueprintId)?.jobRoleId === filters.career)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
}
