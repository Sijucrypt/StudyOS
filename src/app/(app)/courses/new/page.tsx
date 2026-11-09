import type { Metadata } from "next";
import Link from "next/link";
import { CourseFields, SemesterPicker } from "@/components/academics";
import { ActionForm } from "@/components/ui/action-form";
import { Submit } from "@/components/ui/submit";
import { saveCourse } from "@/features/academics/actions";
import { academics } from "@/features/academics/data";

export const metadata: Metadata = { title: "New course" };

export default async function NewCourse({ searchParams }: { searchParams: Promise<{ semester?: string }> }) {
  const [{ activeSemesters, activeSemesterIds, sessionsById }, query] = await Promise.all([academics(), searchParams]);
  const current = query.semester && activeSemesterIds.has(query.semester) ? query.semester : undefined;
  return <>
    <div className="page-head"><Link className="back" href="/sessions">← Academics</Link><h1>New course</h1></div>
    <section className="panel max-w-xl">
      <h2>Course details</h2>
      <ActionForm action={saveCourse.bind(null, null)}>
        <SemesterPicker semesters={activeSemesters} sessions={sessionsById} current={current} />
        <CourseFields />
        <Submit>Create course</Submit>
      </ActionForm>
    </section>
  </>;
}
