import Link from "next/link";
import { academics } from "@/features/academics/data";

export default async function StudioIndex() {
  const { activeCourses } = await academics();
  return <>
    <header className="page-head">
      <h1>AI Study Studio</h1>
      <p>Choose a course to ask questions about its sources or generate study resources.</p>
    </header>
    <section className="panel">
      <h2>Active courses</h2>
      {activeCourses.length ? <ul className="record-list">
        {activeCourses.map((course) => <li key={course.id}>
          <Link className="record-link" href={"/courses/" + course.id + "/studio"}>{course.code} · {course.title}</Link>
        </li>)}
      </ul> : <p><Link href="/courses/new">Create a course</Link> to get started.</p>}
    </section>
  </>;
}
