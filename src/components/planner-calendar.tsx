import Link from "next/link";
import { calendarDate, dateLabel, instantLabel, localDate, plannerHref, shiftDay, weekStart } from "@/features/planner/dates";
import type { Deadline, Occurrence, StudyWindow } from "@/features/planner/data";
import { ScheduleButton, type StudyFormContext } from "./study-forms";

type CalendarProps = {
  path: string; context: StudyFormContext; window: StudyWindow; today: string;
  dates: { first: string; last: string; previous: string; next: string };
};

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function daysIn(first: string, last: string) {
  const result: string[] = [];
  for (let day = first; day <= last; day = shiftDay(day, 1)) result.push(day);
  return result;
}

function occurrenceStatus(item: Occurrence, now: string) {
  if (item.status === "completed") return "Completed";
  if (item.status === "cancelled") return "Cancelled";
  if (Date.parse(item.ends_at) <= Date.parse(now)) return "Missed";
  return Date.parse(item.starts_at) <= Date.parse(now) ? "In progress" : "Planned";
}

function SessionRow({ item, context, path, now }: { item: Occurrence; context: StudyFormContext; path: string; now: string }) {
  const href = (extra: Record<string, string>) => plannerHref(path, context.view, context.day, extra);
  const future = Date.parse(item.starts_at) > Date.parse(now);
  return <li className="stack">
    <div className="row spread">
      <strong>{item.title}</strong><span className="tag">{occurrenceStatus(item, now)}</span>
    </div>
    <p>{instantLabel(item.starts_at, context.zone, true)} – {instantLabel(item.ends_at, context.zone, true)}
      {item.recurrence !== "once" && " · " + (item.recurrence === "daily" ? "Daily" : "Weekly")}
      {item.topic_title && " · " + item.topic_title}
    </p>
    {item.status === "planned" && <details>
      <summary>Session actions</summary>
      <div className="row">
        <Link className="button secondary" href={href({ timer: item.id }) + "#timer"}>Use timer</Link>
        {future && <Link className="button secondary" href={href({ edit: item.id }) + "#schedule-form"}>Reschedule session</Link>}
        <ScheduleButton context={context} operation="cancel_occurrence" id={item.id} label="Cancel session" />
        {future && item.recurrence !== "once" && !item.series_retired && <>
          <Link className="button secondary" href={href({ edit: item.id, scope: "series" }) + "#schedule-form"}>Edit upcoming series</Link>
          <ScheduleButton context={context} operation="cancel_series" id={item.id} label="Cancel upcoming series" />
        </>}
      </div>
    </details>}
  </li>;
}

function DeadlineRow({ item, context, path, now }: { item: Deadline; context: StudyFormContext; path: string; now: string }) {
  const label = item.status === "done" ? "Done" : item.status === "cancelled" ? "Cancelled"
    : Date.parse(item.due_at) < Date.parse(now) ? "Overdue" : "Open";
  return <li className="stack">
    <div className="row spread"><strong>{item.title}</strong><span className="tag">{label}</span></div>
    <p className="deadline-category">{item.category} · {instantLabel(item.due_at, context.zone, true)}</p>
    <details>
      <summary>Deadline actions</summary>
      <div className="row">
        {item.status !== "cancelled" && <Link className="button secondary"
          href={plannerHref(path, context.view, context.day, { deadline: item.id }) + "#deadline-form"}>Edit deadline</Link>}
        {item.status === "open" ? <>
          <ScheduleButton context={context} operation="deadline_status" id={item.id} label="Mark deadline done" status="done" />
          <ScheduleButton context={context} operation="deadline_status" id={item.id} label="Cancel deadline" status="cancelled" />
        </> : <ScheduleButton context={context} operation="deadline_status" id={item.id} label="Reopen deadline" status="open" />}
      </div>
    </details>
  </li>;
}

export function PlannerCalendar({ path, context, window, today, dates }: CalendarProps) {
  const { view, day, zone } = context;
  const fullDays = daysIn(dates.first, dates.last);
  const localSessions = window.occurrences.map((item) => ({
    item, first: localDate(new Date(item.starts_at), zone),
    last: localDate(new Date(Date.parse(item.ends_at) - 1), zone),
  }));
  const localDeadlines = window.deadlines.map((item) => ({ item, day: localDate(new Date(item.due_at), zone) }));
  const agenda = (view === "month" ? [day] : fullDays).map((date) => ({
    date,
    sessions: localSessions.filter((item) => item.first <= date && date <= item.last).map(({ item }) => item),
    deadlines: localDeadlines.filter((item) => item.day === date).map(({ item }) => item),
  }));
  const title = view === "month" ? dateLabel(dates.first, { month: "long", year: "numeric" })
    : view === "week" ? dateLabel(dates.first, { month: "short", day: "numeric" }) + " – " + dateLabel(dates.last, { dateStyle: "medium" })
    : dateLabel(day);
  const padding = Math.round((Date.parse(dates.first) - Date.parse(weekStart(dates.first))) / 86_400_000);

  return <section className="panel" aria-labelledby="calendar-heading">
    <div className="row spread"><h2 id="calendar-heading">{title}</h2><span className="tag">{zone}</span></div>
    <nav className="row" aria-label="Calendar view">
      {(["day", "week", "month"] as const).map((option) => <Link className={"button" + (view === option ? "" : " secondary")}
        href={plannerHref(path, option, day)} key={option} aria-current={view === option ? "page" : undefined}>
        {option[0].toUpperCase() + option.slice(1)}
      </Link>)}
    </nav>
    <nav className="row" aria-label="Calendar dates">
      {calendarDate.safeParse(dates.previous).success && <Link className="button secondary" href={plannerHref(path, view, dates.previous)}>Previous</Link>}
      <Link className="button secondary" href={plannerHref(path, view, today)}>Today</Link>
      {calendarDate.safeParse(dates.next).success && <Link className="button secondary" href={plannerHref(path, view, dates.next)}>Next</Link>}
      <form action={path} className="row">
        <input type="hidden" name="view" value={view} />
        <label className="sr-only" htmlFor="jump-date">Jump to date</label>
        <input className="planner-date" id="jump-date" name="date" type="date" defaultValue={day} required />
        <button type="submit" className="button secondary">Go</button>
      </form>
    </nav>
    {view === "month" && <div className="planner-grid" aria-label="Month calendar">
      {weekdays.map((weekday) => <span key={weekday} className="planner-weekday">{weekday}</span>)}
      {Array.from({ length: padding }, (_, index) => <span key={"empty-" + index} />)}
      {fullDays.map((date) => {
        const total = localSessions.filter((item) => item.first <= date && date <= item.last).length
          + localDeadlines.filter((item) => item.day === date).length;
        return <Link className="planner-day" key={date} href={plannerHref(path, "month", date)}
          aria-current={date === day ? "date" : undefined} aria-label={dateLabel(date) + ", " + total + " items"}>
          <strong>{Number(date.slice(-2))}</strong>{total > 0 && <span aria-hidden="true">{total}</span>}
        </Link>;
      })}
    </div>}
    <div className="stack">
      {agenda.map(({ date, sessions, deadlines }) => <section className="planner-agenda-day stack" key={date} aria-label={dateLabel(date)}>
        <h3>{dateLabel(date)}</h3>
        {sessions.length + deadlines.length === 0 ? <p>No sessions or deadlines.</p> : <ul className="record-list">
          {sessions.map((item) => <SessionRow key={item.id} item={item} context={context} path={path} now={window.server_now} />)}
          {deadlines.map((item) => <DeadlineRow key={item.id} item={item} context={context} path={path} now={window.server_now} />)}
        </ul>}
      </section>)}
    </div>
  </section>;
}
