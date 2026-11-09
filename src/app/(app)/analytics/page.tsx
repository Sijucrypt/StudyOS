import type { Metadata } from "next";
import Link from "next/link";
import { CorrectionForm } from "@/components/study-forms";
import { StudyDeadlines } from "@/components/study-deadlines";
import { academics, getProfile } from "@/features/academics/data";
import { calendarDate, dateLabel, durationLabel, instantLabel, localDate, shiftDay } from "@/features/planner/dates";
import { getStudyLogs, getStudyMetrics, logSeconds } from "@/features/planner/data";

export const metadata: Metadata = { title: "Study analytics" };

type Query = { days?: string; through?: string; course?: string; page?: string };

export default async function Analytics({ searchParams }: { searchParams: Promise<Query> }) {
  const [query, { timezone }, { courses, activeCourses }] = await Promise.all([searchParams, getProfile(), academics()]);
  const today = localDate(new Date(), timezone);
  const candidate = calendarDate.safeParse(query.through).data;
  const last = candidate && candidate <= today ? candidate : today;
  const dayCount = query.days === "30" ? 30 : 7;
  const first = shiftDay(last, 1 - dayCount);
  const course = courses.find((item) => item.id === query.course);
  const courseId = course?.id ?? null;
  const page = typeof query.page === "string" && /^\d{1,6}$/.test(query.page) ? Math.max(1, Number(query.page)) : 1;
  const [metrics, history] = await Promise.all([
    getStudyMetrics(first, last, timezone, courseId), getStudyLogs(courseId, page),
  ]);
  const stats = [
    ["Time studied", durationLabel(metrics.seconds)],
    ["Study days", metrics.days_with_study + " of " + metrics.day_count],
    ["Planned sessions completed", metrics.adherence.eligible ? metrics.adherence.completed + " of " + metrics.adherence.eligible : "No eligible sessions"],
    ["Topic completion", metrics.topics.total ? metrics.topics.completed + " of " + metrics.topics.total : "Not started"],
  ];
  const scale = Math.max(1, ...metrics.days.map((day) => day.seconds));
  const link = (number: number) => "/analytics?" + new URLSearchParams({
    days: String(dayCount), through: last, course: courseId ?? "", page: String(number),
  }).toString();
  const choices = activeCourses.some((item) => item.id === courseId) || !course ? activeCourses : [...activeCourses, course];

  return <>
    <header className="page-head">
      <h1>Study analytics</h1><p>{dateLabel(first, { dateStyle: "medium" })} – {dateLabel(last, { dateStyle: "medium" })} · {timezone}</p>
      <Link className="back" href={courseId ? "/courses/" + courseId + "/planner" : "/planner"}>← Study planner</Link>
    </header>
    <section className="panel">
      <h2>Report period</h2>
      <form action="/analytics" className="form-stack">
        <div className="fields">
          <label>Period<select name="days" defaultValue={dayCount}>
            <option value="7">7 days</option><option value="30">30 days</option>
          </select></label>
          <label>Through date<input name="through" type="date" max={today} defaultValue={last} required /></label>
          <label>Course<select name="course" defaultValue={courseId ?? ""}>
            <option value="">All courses</option>
            {choices.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}
          </select></label>
        </div>
        <button className="button secondary" type="submit">Apply report filters</button>
      </form>
    </section>
    <dl className="stats">{stats.map(([label, value]) => <div className="panel" key={label}>
      <dt>{label}</dt><dd className="stat">{value}</dd>
    </div>)}</dl>
    <div className="split">
      <section className="panel">
        <h2>Daily study time</h2>
        <p>A completed log counts on its completion date in {timezone}. A study day has at least one completed log.</p>
        <p>Planned-session counts include completed and missed sessions that have already started. Cancelled sessions are excluded.</p>
        {metrics.seconds > 0 ? <ul className="study-chart">{metrics.days.map(({ date, seconds }) => <li key={date}>
          <span>{dateLabel(date, { month: "short", day: "numeric" })}</span>
          <progress aria-label={"Study time on " + dateLabel(date)} value={seconds} max={scale} />
          <strong>{durationLabel(seconds)}</strong>
        </li>)}</ul> : <p>No completed study logs in this period.</p>}
      </section>
      <StudyDeadlines metrics={metrics} zone={timezone} />
    </div>
    <section className="panel">
      <h2>Study logs</h2><p>Completed logs for the selected course filter, newest first.</p>
      {history.logs.length ? <ul className="record-list">{history.logs.map((log) => <li key={log.id} className="stack">
        <div className="row spread">
          <strong>{courses.find((item) => item.id === log.course_id)?.title ?? "General study"}</strong>
          <span className="tag">{durationLabel(logSeconds(log))}{log.corrected_seconds !== null && " · Corrected"}</span>
        </div>
        <p>{instantLabel(log.finished_at!, timezone, true)} · {log.occurrence_id ? "Planned session" : "Unplanned session"}</p>
        <details><summary>Correct log duration</summary><CorrectionForm log={log} /></details>
      </li>)}</ul> : <p>No study logs yet.</p>}
      {(page > 1 || history.hasNext) && <nav className="row" aria-label="Study log pages">
        {page > 1 && <Link className="button secondary" href={link(page - 1)}>Previous</Link>}
        <span>Page {page}</span>
        {history.hasNext && <Link className="button secondary" href={link(page + 1)}>Next</Link>}
      </nav>}
    </section>
  </>;
}
