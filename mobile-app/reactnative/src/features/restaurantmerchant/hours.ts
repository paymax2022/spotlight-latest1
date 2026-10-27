// ── Trading hours — pure editor rules ───────────────────────────────────────
// No React, no network: the week the owner edits is a flat list of seven day-rows, and
// the server takes the whole schedule in one PUT (a full replace), so the row list IS
// the request. Kept here so `node --test` can check it, and kept in step with the Go
// side (backend/internal/restaurant/hours.go):
//   - day_of_week 0 = Sunday … 6 = Saturday (Go's time.Weekday),
//   - "HH:MM" 24-hour, close "24:00" or "00:00" both meaning up to midnight,
//   - close earlier than open is an OVERNIGHT window, not a mistake,
//   - open == close is refused (a window that never opens is never what was meant).
//
// One window per day: the server accepts split shifts, but this editor is the only
// writer of a restaurant's schedule in the app, so the row list it sends is the whole
// truth and nothing gets silently dropped.

import type { StoreHourWindow } from './types';

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** What a fresh day looks like when the owner turns it on: an ordinary trading day. */
export const DEFAULT_OPEN = '09:00';
export const DEFAULT_CLOSE = '17:00';

/** One day in the editor. `open` is the switch; the times stay filled so toggling back
 *  on doesn't lose what was typed. */
export interface DayRow {
  dayOfWeek: number;
  open: boolean;
  from: string;
  to: string;
}

/** Minutes from midnight back to "HH:MM" (1440 renders as "24:00"). */
export function formatMinute(min: number): string {
  if (!Number.isFinite(min) || min < 0 || min > 1440) return DEFAULT_OPEN;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "HH:MM" to minutes from midnight, or null when it isn't a time the server accepts. */
export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

export function emptyWeek(): DayRow[] {
  return WEEKDAY_LABELS.map((_, dayOfWeek) => ({ dayOfWeek, open: false, from: DEFAULT_OPEN, to: DEFAULT_CLOSE }));
}

/** The stored windows as seven editable rows. A day with no window is a closed day. */
export function weekFromWindows(windows: StoreHourWindow[]): DayRow[] {
  const rows = emptyWeek();
  for (const w of windows ?? []) {
    const row = rows[w.dayOfWeek];
    if (!row) continue;
    row.open = true;
    row.from = w.open;
    row.to = w.close;
  }
  return rows;
}

/** The editable rows as the PUT body: only days that are switched on are traded. */
export function windowsFromWeek(rows: DayRow[]): StoreHourWindow[] {
  return rows
    .filter((r) => r.open)
    .map((r) => ({ dayOfWeek: r.dayOfWeek, open: r.from, close: r.to }));
}

export function rowFor(rows: DayRow[], dayOfWeek: number): DayRow | undefined {
  return rows.find((r) => r.dayOfWeek === dayOfWeek);
}

/** Apply one day's switch and times to every day — the usual case is the same window all week. */
export function copyToAll(rows: DayRow[], dayOfWeek: number): DayRow[] {
  const src = rowFor(rows, dayOfWeek);
  if (!src) return rows;
  return rows.map((r) => ({ ...r, open: src.open, from: src.from, to: src.to }));
}

/**
 * The first thing wrong with the week, in words naming the day, or null when the whole
 * week could be saved. Checked here so the owner is told before the server refuses it.
 */
export function validateWeek(rows: DayRow[]): string | null {
  for (const r of rows) {
    if (!r.open) continue;
    const day = WEEKDAY_LABELS[r.dayOfWeek] ?? `Day ${r.dayOfWeek}`;
    const openM = toMinutes(r.from);
    if (openM === null) return `${day}: the opening time must be a 24-hour time like 09:30.`;
    if (openM === 1440) return `${day}: it can't open at 24:00 — that is the end of the day.`;
    const closeM = toMinutes(r.to);
    if (closeM === null) return `${day}: the closing time must be a 24-hour time like 22:00.`;
    if (closeM === openM) return `${day}: opening and closing times can't be the same.`;
  }
  return null;
}

/**
 * The week in one line, for the summary under the switch and for the customer's store
 * page: runs of the same window collapse into "Mon–Fri 09:00–17:00", a day that runs
 * past midnight shows its overnight window as written, and no windows at all says so in
 * words rather than leaving an empty table that looks like a bug.
 */
export function summarizeWeek(rows: DayRow[]): string {
  const open = rows.filter((r) => r.open);
  if (open.length === 0) return 'No set hours — orders follow the open/closed switch.';
  const parts: string[] = [];
  let i = 0;
  while (i < open.length) {
    let j = i;
    while (
      j + 1 < open.length &&
      open[j + 1].from === open[i].from &&
      open[j + 1].to === open[i].to &&
      open[j + 1].dayOfWeek === open[j].dayOfWeek + 1
    ) j += 1;
    const span = i === j ? WEEKDAY_SHORT[open[i].dayOfWeek]
      : `${WEEKDAY_SHORT[open[i].dayOfWeek]}–${WEEKDAY_SHORT[open[j].dayOfWeek]}`;
    parts.push(`${span} ${open[i].from}–${open[i].to}`);
    i = j + 1;
  }
  return parts.join(', ');
}
