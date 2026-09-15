/**
 * Time helpers. Task files use ISO 8601 with a local offset (Contract 1), and rows show
 * a coarse relative time that never needs a ticking timer to stay honest.
 */

/** Current time as ISO 8601 with the local UTC offset, e.g. `2026-09-14T21:04:00+05:30`. */
export function nowIso(date: Date = new Date()): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(offsetMin) / 60));
  const om = pad(Math.abs(offsetMin) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${oh}:${om}`
  );
}

/** Coarse "5 min ago" style label. Coarse on purpose so the UI never needs a clock. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, now - t);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  const mo = Math.round(d / 30);
  return `${mo} mo ago`;
}

/** Today as a calendar day in the local zone, `YYYY-MM-DD`, the shape `planned` uses. */
export function todayIso(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A `YYYY-MM-DD` day as a local Date at midnight, or undefined when it is not a day. */
export function parseDay(day: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = parseDay(from);
  const b = parseDay(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * A planned day in the words a person would use: today, yesterday, tomorrow, then a short
 * date. The year appears only when it is not the current one, because a panel this narrow
 * cannot spend four characters on something that is almost always the same.
 */
export function dayLabel(day: string, today: string = todayIso()): string {
  const date = parseDay(day);
  if (!date) return day;
  const diff = daysBetween(today, day);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return date.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
}

/** How late a planned day is, in words: `3 days late`. Empty when it is not in the past. */
export function lateLabel(day: string, today: string = todayIso()): string {
  const diff = daysBetween(day, today);
  if (diff <= 0) return '';
  if (diff === 1) return '1 day late';
  if (diff < 14) return `${diff} days late`;
  const weeks = Math.floor(diff / 7);
  return weeks < 9 ? `${weeks} weeks late` : `${Math.round(diff / 30)} months late`;
}
