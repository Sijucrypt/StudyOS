import Link from "next/link";
import { z } from "zod";
import { academics, getCourse, getProfile } from "@/features/academics/data";
import { calendarDate, calendarViews, calendarWindow, localDate, plannerHref, plannerPath } from "@/features/planner/dates";
import { getStudyTimer, getStudyTopics, getStudyWindow } from "@/features/planner/data";
import { PlannerCalendar } from "./planner-calendar";
import { DeadlineForm, SessionForm } from "./study-forms";
import { StudyTimer } from "./study-timer";

export type PlannerQuery = { date?: string; view?: string; timer?: string; edit?: string; scope?: string; deadline?: string };

export async function PlannerPage({ courseId, query }: { courseId: string | null; query: PlannerQuery }) {
  const [{ timezone }, academic, scoped] = await Promise.all([
    getProfile(), academics(), courseId ? getCourse(courseId) : null,
  ]);
  const today = localDate(new Date(), timezone);
  const day = calendarDate.safeParse(query.date).data ?? today;
  const view = z.enum(calendarViews).safeParse(query.view).data ?? "week";
  const dates = calendarWindow(day, view);
  const [window, timer, topics] = await Promise.all([
    getStudyWindow(dates.first, dates.last, timezone, courseId), getStudyTimer(), getStudyTopics(courseId),
  ]);
  const path = plannerPath(courseId);
  const courses = academic.activeCourses.map((course) => ({ id: course.id, label: course.code + " · " + course.title }));
  const context = { scope: courseId, day, view, zone: timezone, courses, topics };
  const future = (startsAt: string) => Date.parse(startsAt) > Date.parse(window.server_now);
  const edit = window.occurrences.find((item) => item.id === query.edit && item.status === "planned" && future(item.starts_at));
  const series = Boolean(edit && query.scope === "series" && edit.recurrence !== "once" && !edit.series_retired);
  const deadline = window.deadlines.find((item) => item.id === query.deadline && item.status !== "cancelled");
  const selected = window.occurrences.find((item) => item.id === query.timer && item.status === "planned");
  const selection = selected ? { id: selected.id, title: selected.title } : null;
  const canCreate = !scoped || !scoped.parentArchived && !scoped.course.archived_at;
  const analytics = "/analytics" + (courseId ? "?course=" + courseId : "");

  return <>
    <header className="page-head">
      {scoped && <Link className="back" href={"/courses/" + courseId}>← {scoped.course.code} overview</Link>}
      <h1>Study planner</h1>
      <p>{scoped ? scoped.course.title : "Plan study sessions, track deadlines, and log focused time."}</p>
      <div className="row">
        <Link className="button secondary" href={analytics}>Study logs and analytics</Link>
        {scoped && <Link className="button secondary" href="/planner">All courses</Link>}
        {canCreate && <a className="button secondary" href="#schedule-form">Plan a session</a>}
      </div>
    </header>
    <StudyTimer initial={timer} selection={selection} scope={canCreate ? courseId : null} courses={courses} />
    <PlannerCalendar path={path} context={context} window={window} today={today} dates={dates} />
    <div className="split">
      {(canCreate || edit) && <section className="panel" id="schedule-form">
        <h2>{series ? "Edit upcoming series" : edit ? "Reschedule a session" : "Plan a study session"}</h2>
        {edit && <Link className="back" href={plannerHref(path, view, day)}>Cancel editing</Link>}
        <SessionForm key={edit ? edit.id + String(series) : "new-session"} context={context} editing={edit} series={series} />
      </section>}
      {(canCreate || deadline) && <section className="panel" id="deadline-form">
        <h2>{deadline ? "Edit a deadline" : "Add a deadline"}</h2>
        {deadline && <Link className="back" href={plannerHref(path, view, day)}>Cancel editing</Link>}
        <DeadlineForm key={deadline?.id ?? "new-deadline"} context={context} editing={deadline} />
      </section>}
    </div>
  </>;
}
