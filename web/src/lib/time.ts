/* The clock-and-calendar words the programme speaks: when something would end if you pressed play now,
   how long is left, today's date, the greeting. Pure functions that take the time and the locale as
   arguments (so tests can fix both), plus one hook that re-renders each minute on the minute.
   The user's locale decides 12 or 24 hour clocks and the order of day and month. */

import { useSyncExternalStore } from 'react'

const MINUTE = 60_000

/** A time with no break inside it ("9:48 PM" stays on one line). Intl puts a narrow no-break space
 *  before AM/PM on newer engines and a plain one on older; this makes them the same. */
const tidy = (text: string) => text.replace(/[   ]/g, ' ')

const clockFormats = new Map<string, Intl.DateTimeFormat>()
function clockFormat(locale?: string) {
  const key = locale ?? ''
  let format = clockFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
    // A 24 hour clock is zero-padded ("09:05"), so a column of times lines up as in a printed timetable.
    const cycle = format.resolvedOptions().hourCycle
    if (cycle === 'h23' || cycle === 'h24') format = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: cycle })
    clockFormats.set(key, format)
  }
  return format
}

/** The short clock time in the locale's own style: "21:48" or "9:48 PM". */
export function formatClock(date: Date | number, locale?: string): string {
  return tidy(clockFormat(locale).format(date))
}

/** The same time, split so a 12 hour clock can set "PM" small beside the digits: `{ time: '9:48', period: 'PM' }`.
 *  A 24 hour clock has no period. */
export function clockParts(date: Date | number, locale?: string): { time: string; period?: string } {
  const parts = clockFormat(locale).formatToParts(date)
  const period = parts.find((p) => p.type === 'dayPeriod')?.value
  if (!period) return { time: tidy(clockFormat(locale).format(date)) }
  const time = parts
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .trim()
  return { time, period }
}

/** Whole minutes, never below one: "0 min left" would read as finished. */
const minutesIn = (seconds: number) => Math.max(1, Math.round(seconds / 60))

/** When it would end if started at `now` with `seconds` left (the rest of a resume item, or a film's
 *  runtime). Both the start and the length are whole minutes, the same ones the screen says ("18 min
 *  left"), so every place that shows an end time for the same title shows the same time. */
export function endTime(now: Date | number, seconds: number): Date {
  const start = Math.floor((typeof now === 'number' ? now : now.getTime()) / MINUTE) * MINUTE
  return new Date(start + minutesIn(seconds) * MINUTE)
}

/** "18 min", "1 h 44 min", "2 h": a duration for the meta line. */
export function formatDuration(seconds: number): string {
  const total = minutesIn(seconds)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** A runtime as edge print reads it: "2 h 47", "3 h 01", "47 min". Minutes are padded after an hour, like a
 *  clock, so a row of them lines up. */
export function formatRuntime(seconds: number): string {
  const total = minutesIn(seconds)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h === 0 ? `${m} min` : `${h} h ${String(m).padStart(2, '0')}`
}

/** "18 min left", "1 h 44 min left". */
export function formatLeft(seconds: number): string {
  return `${formatDuration(seconds)} left`
}

/** The same, for a screen reader: "18 minutes left", "1 hour 44 minutes left". */
export function spokenDuration(seconds: number): string {
  const total = minutesIn(seconds)
  const h = Math.floor(total / 60)
  const m = total % 60
  const hours = h ? `${h} ${h === 1 ? 'hour' : 'hours'}` : ''
  const minutes = m || !h ? `${m} ${m === 1 ? 'minute' : 'minutes'}` : ''
  return [hours, minutes].filter(Boolean).join(' ')
}

const weekdayDates = new Map<string, Intl.DateTimeFormat>()
/** "Thursday 22 October" or "Thursday, October 22": the weekday and date, in the locale's order. */
export function formatWeekdayDate(date: Date | number, locale?: string): string {
  const key = locale ?? ''
  let format = weekdayDates.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' })
    weekdayDates.set(key, format)
  }
  return format.format(date)
}

const shortDays = new Map<string, Intl.DateTimeFormat>()
/** "Tue 12": a short weekday, then the day of the month, for the air-date column. Always in that order
 *  (some locales' own pattern puts the day first, which reads oddly in a column of dates). */
export function formatShortDay(date: Date | number, locale?: string): string {
  const key = locale ?? ''
  let format = shortDays.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' })
    shortDays.set(key, format)
  }
  const parts = format.formatToParts(date)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const dayOfMonth = parts.find((p) => p.type === 'day')?.value ?? ''
  return `${weekday} ${dayOfMonth}`.trim()
}

/** The page title that reflects the hour: 5 to 12 "This Morning", 12 to 17 "This Afternoon", else "Tonight". */
export function greetingTitle(date: Date | number): string {
  const hour = new Date(date).getHours()
  if (hour >= 5 && hour < 12) return 'This Morning'
  if (hour >= 12 && hour < 17) return 'This Afternoon'
  return 'Tonight'
}

/** The user's own locale, which Intl falls back to when it's undefined. Kept as one name so a test or a
 *  setting could swap it later. */
export const userLocale: string | undefined = typeof navigator === 'undefined' ? undefined : navigator.language

/* One timer for every listing on screen: a store of "the time as of the last minute boundary". Each
   subscriber re-renders when the minute turns, and nothing runs while nobody is subscribed. */

let tickNow = Date.now()
const tickListeners = new Set<() => void>()
let tickTimer: ReturnType<typeof setTimeout> | undefined

function scheduleTick() {
  const now = Date.now()
  // A few ms past the boundary, so the clock has certainly turned when we read it.
  tickTimer = setTimeout(() => {
    tickNow = Date.now()
    tickListeners.forEach((l) => l())
    scheduleTick()
  }, MINUTE - (now % MINUTE) + 20)
}

function subscribeTick(listener: () => void) {
  if (tickListeners.size === 0) {
    // Time has passed since the last tick, or since nobody was listening.
    tickNow = Date.now()
    scheduleTick()
    document.addEventListener('visibilitychange', onVisible)
  }
  tickListeners.add(listener)
  return () => {
    tickListeners.delete(listener)
    if (tickListeners.size === 0) {
      clearTimeout(tickTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }
}

/** A tab that was hidden may have slept through minutes: catch up the moment it's shown again. */
function onVisible() {
  if (document.hidden) return
  clearTimeout(tickTimer)
  tickNow = Date.now()
  tickListeners.forEach((l) => l())
  scheduleTick()
}

const tickSnapshot = () => tickNow

/** The current time (ms since the epoch), refreshed on every minute boundary. A component that reads it
 *  re-renders once a minute, on the minute, and only while it's mounted. */
export function useMinuteTick(): number {
  return useSyncExternalStore(subscribeTick, tickSnapshot, tickSnapshot)
}
