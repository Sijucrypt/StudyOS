import type { Metadata } from "next";
import Link from "next/link";
import { CourseList } from "@/components/academics";
import { StudyDeadlines } from "@/components/study-deadlines";
import { academics, getProfile } from "@/features/academics/data";
import { durationLabel, instantLabel, localDate, plannerHref, shiftDay, weekStart } from "@/features/planner/dates";
import { getStudyMetrics, getStudyWindow } from "@/features/planner/data";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const [{ sessions, activeSemesters, activeCourses }, profile] = await Promise.all([academics(), getProfile()]);
  const today = localDate(new Date(), profile.timezone);
  const [metrics, calendar] = await Promise.all([
    getStudyMetrics(weekStart(today), today, profile.timezone),
    getStudyWindow(today, shiftDay(today, 14), profile.timezone),
  ]);
  const upcoming = calendar.occurrences
    .filter((item) => item.status === "planned" && Date.parse(item.starts_at) >= Date.parse(calendar.server_now)).slice(0, 5);
  const stats = [
    ["Active sessions", sessions.filter((session) => !session.archived_at).length],
    ["Active semesters", activeSemesters.length],
    ["Active courses", activeCourses.length],
    ["Study time this week", durationLabel(metrics.seconds)],
    ["Topic completion", metrics.topics.total ? metrics.topics.completed + " of " + metrics.topics.total : "Not started"],
  ] as const;

  return <>
    <div className="page-head">
      <h1>{profile.display_name ? "Welcome, " + profile.display_name : "Your dashboard"}</h1>
      <p>Organize your academic sessions, courses and study topics.</p>
    </div>
    <dl className="stats">{stats.map(([label, count]) => <div key={label} className="panel">
      <dt>{label}</dt><dd className="stat">{count}</dd>
    </div>)}</dl>
    <section className="panel">
      <h2>Active courses</h2>
      <CourseList courses={activeCourses.slice(0, 8)} empty="Your courses will appear here as you add them." />
      <div className="row">
        <Link className="button" href="/sessions">Manage academics</Link>
        <Link className="button secondary" href="/courses/new">Add a course</Link>
      </div>
    </section>
    <div className="split">
      <section className="panel">
        <h2>Upcoming study sessions</h2>
        {upcoming.length ? <ul className="record-list">{upcoming.map((item) => <li key={item.id} className="stack">
          <Link className="record-link" href={plannerHref("/planner", "day", localDate(new Date(item.starts_at), profile.timezone))}>
            {item.title}
          </Link>
          <p>{instantLabel(item.starts_at, profile.timezone, true)}</p>
        </li>)}</ul> : <p>No upcoming sessions in the next two weeks.</p>}
        <div className="row"><Link className="button secondary" href="/planner">Open planner</Link>
          <Link className="button secondary" href="/analytics">View analytics</Link></div>
      </section>
      <StudyDeadlines metrics={metrics} zone={profile.timezone} />
    </div>
  </>;
}
