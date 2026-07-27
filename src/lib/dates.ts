import type { IsoDate } from './types'

/**
 * All date handling here is deliberately calendar-based, not instant-based.
 * A lead created on the 3rd belongs to the week containing the 3rd regardless
 * of the user's clock time, so dates are parsed as *local* midnight and never
 * round-tripped through UTC (`toISOString()` on a local date silently shifts
 * the day for anyone east or west of Greenwich).
 */

/** Formats a `Date` as a local `YYYY-MM-DD` — the UTC-safe `toISOString` swap. */
export function toIsoDate(date: Date): IsoDate {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Parses a `YYYY-MM-DD` into a `Date` at local midnight. */
export function fromIsoDate(iso: IsoDate): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, (month ?? 1) - 1, day ?? 1)
}

export function today(): IsoDate {
  return toIsoDate(new Date())
}

/** Shifts an ISO date by whole days, staying on the local calendar. */
export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = fromIsoDate(iso)
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

/** The Monday of the week containing `iso`. Weeks run Monday–Sunday. */
export function weekStart(iso: IsoDate): IsoDate {
  const date = fromIsoDate(iso)
  const day = date.getDay() // 0 = Sunday
  const delta = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + delta)
  return toIsoDate(date)
}

/** The Sunday closing the week that began on `start`. */
export function weekEnd(start: IsoDate): IsoDate {
  return addDays(start, 6)
}

/** Inclusive range test. A missing date is never in range. */
export function inRange(
  iso: IsoDate | null | undefined,
  start: IsoDate,
  end: IsoDate,
): boolean {
  if (!iso) return false
  return iso >= start && iso <= end
}

/**
 * Whole days from today until `iso`. Negative when the date has passed,
 * `null` when there is no date.
 */
export function daysUntil(iso: IsoDate | null | undefined): number | null {
  if (!iso) return null
  const now = fromIsoDate(today())
  const target = fromIsoDate(iso)
  return Math.round((target.getTime() - now.getTime()) / 86_400_000)
}

/** Short display form, e.g. `04 Aug`. */
export function formatDate(iso: IsoDate | null | undefined): string {
  if (!iso) return '—'
  return fromIsoDate(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  })
}

/**
 * Display form carrying the year, e.g. `29 Jul 2026`. Used for deadlines,
 * which routinely sit in a different year to the one being viewed — the bare
 * `04 Aug` form is ambiguous there.
 */
export function formatDateWithYear(iso: IsoDate | null | undefined): string {
  if (!iso) return '—'
  return fromIsoDate(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** Long display form, e.g. `4 August 2026`. */
export function formatDateLong(iso: IsoDate | null | undefined): string {
  if (!iso) return '—'
  return fromIsoDate(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/** e.g. `Monday, 4 August` — used for the dashboard's date stamp. */
export function formatToday(): string {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/** The `count` most recent week-start dates, oldest first, ending this week. */
export function recentWeekStarts(count: number, from: IsoDate = today()): IsoDate[] {
  const weeks: IsoDate[] = []
  let cursor = weekStart(from)
  for (let i = 0; i < count; i++) {
    weeks.unshift(cursor)
    cursor = addDays(cursor, -7)
  }
  return weeks
}

/**
 * Start and end of the reporting period containing `iso`.
 *
 * Weeks run Monday–Sunday; months and quarters are calendar. `shift` moves
 * whole periods, so the report view can page back and forward without knowing
 * how long a month is.
 */
export function periodRange(
  period: 'week' | 'month' | 'quarter',
  iso: IsoDate,
  shift = 0,
): { start: IsoDate; end: IsoDate } {
  if (period === 'week') {
    const start = addDays(weekStart(iso), shift * 7)
    return { start, end: weekEnd(start) }
  }

  const date = fromIsoDate(iso)

  if (period === 'month') {
    const start = new Date(date.getFullYear(), date.getMonth() + shift, 1)
    // Day 0 of the next month is the last day of this one — no length table.
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0)
    return { start: toIsoDate(start), end: toIsoDate(end) }
  }

  const quarterIndex = Math.floor(date.getMonth() / 3) + shift
  const start = new Date(date.getFullYear(), quarterIndex * 3, 1)
  const end = new Date(start.getFullYear(), start.getMonth() + 3, 0)
  return { start: toIsoDate(start), end: toIsoDate(end) }
}

/**
 * Inverse of `periodRange`'s `shift`: how many whole periods `start` sits from
 * the one containing today. Lets a saved report be reopened by offset.
 */
export function periodOffset(
  period: 'week' | 'month' | 'quarter',
  start: IsoDate,
): number {
  const now = fromIsoDate(today())
  const target = fromIsoDate(start)

  if (period === 'week') {
    const currentStart = fromIsoDate(weekStart(today()))
    return Math.round(
      (fromIsoDate(weekStart(start)).getTime() - currentStart.getTime()) /
        (7 * 86_400_000),
    )
  }

  const months =
    (target.getFullYear() - now.getFullYear()) * 12 +
    (target.getMonth() - now.getMonth())

  return period === 'month' ? months : Math.round(months / 3)
}

/** Human label for a period, e.g. `Week of 20 Jul`, `July 2026`, `Q3 2026`. */
export function formatPeriod(
  period: 'week' | 'month' | 'quarter',
  start: IsoDate,
): string {
  const date = fromIsoDate(start)
  if (period === 'week') return `Week of ${formatDate(start)}`
  if (period === 'month') {
    return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  }
  return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`
}

export function formatKes(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toLocaleString('en-KE', { maximumFractionDigits: 0 })
}
