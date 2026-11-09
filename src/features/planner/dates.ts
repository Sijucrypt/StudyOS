import { z } from "zod";

export const calendarViews = ["day", "week", "month"] as const;
export type CalendarView = typeof calendarViews[number];
export const calendarDate = z.iso.date().refine((day) => day >= "2000-01-01" && day <= "2100-12-31");

function parts(time: Date, zone: string, withTime: boolean) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, calendar: "iso8601", numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}),
  });
  return Object.fromEntries(formatter.formatToParts(time).map(({ type, value }) => [type, value]));
}

export function localDate(time: Date, zone: string) {
  const { year, month, day } = parts(time, zone, false);
  return year + "-" + month + "-" + day;
}

export function localInput(instant: string, zone: string) {
  const { year, month, day, hour, minute } = parts(new Date(instant), zone, true);
  return year + "-" + month + "-" + day + "T" + hour + ":" + minute;
}

export function shiftDay(day: string, amount: number) {
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function weekStart(day: string) {
  const weekday = new Date(day + "T00:00:00Z").getUTCDay();
  return shiftDay(day, -((weekday + 6) % 7));
}

export function calendarWindow(day: string, view: CalendarView) {
  if (view === "month") {
    const date = new Date(day + "T00:00:00Z");
    const month = (offset: number) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
    return { first: month(0), last: shiftDay(month(1), -1), previous: month(-1), next: month(1) };
  }
  const first = view === "week" ? weekStart(day) : day;
  const length = view === "week" ? 7 : 1;
  return { first, last: shiftDay(first, length - 1), previous: shiftDay(first, -length), next: shiftDay(first, length) };
}

export function dateLabel(day: string, options: Intl.DateTimeFormatOptions = { dateStyle: "full" }) {
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
}

export function instantLabel(instant: string, zone: string, includeDay = false) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, ...(includeDay ? { dateStyle: "medium" } : {}), timeStyle: "short",
  }).format(new Date(instant));
}

export function durationLabel(seconds: number) {
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor(rounded % 3600 / 60);
  const remainder = rounded % 60;
  return [hours ? hours + "h" : "", minutes ? minutes + "m" : "", remainder || !rounded ? remainder + "s" : ""].filter(Boolean).join(" ");
}

export function plannerPath(courseId: string | null) {
  return courseId ? "/courses/" + courseId + "/planner" : "/planner";
}

export function plannerHref(path: string, view: CalendarView, day: string, extra?: Record<string, string>) {
  return path + "?" + new URLSearchParams({ view, date: day, ...extra }).toString();
}
