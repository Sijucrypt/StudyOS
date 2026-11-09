import Link from "next/link";
import { instantLabel, localDate, plannerHref } from "@/features/planner/dates";
import type { StudyMetrics } from "@/features/planner/data";

function DeadlineList({ items, zone, title, empty }: {
  items: StudyMetrics["upcoming"]; zone: string; title: string; empty: string;
}) {
  return <div className="stack">
    <h3>{title}</h3>
    {items.length ? <ul className="record-list">{items.map((item) => <li key={item.id} className="stack">
      <Link className="record-link" href={plannerHref("/planner", "day", localDate(new Date(item.due_at), zone))}>
        {item.title}
      </Link>
      <p className="deadline-category">{item.category} · {instantLabel(item.due_at, zone, true)}</p>
    </li>)}</ul> : <p>{empty}</p>}
  </div>;
}

export function StudyDeadlines({ metrics, zone }: { metrics: StudyMetrics; zone: string }) {
  return <section className="panel">
    <h2>Deadlines</h2>
    <DeadlineList items={metrics.overdue} zone={zone} title="Overdue" empty="No overdue deadlines." />
    <DeadlineList items={metrics.upcoming} zone={zone} title="Upcoming" empty="No upcoming deadlines." />
  </section>;
}
