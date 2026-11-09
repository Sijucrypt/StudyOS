import Link from "next/link";
import { LibraryList } from "@/components/library-list";
import { LibraryUpload } from "@/components/library-upload";
import { getCourse } from "@/features/academics/data";

export default async function CourseLibrary({ params, searchParams }: {
  params: Promise<{ courseId: string }>; searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { courseId } = await params;
  const { course, parentArchived } = await getCourse(courseId);
  return <>
    <div className="page-head">
      <Link className="back" href={"/courses/" + courseId}>← {course.code} overview</Link>
      <h1>Course library</h1><p>{course.title}</p>
    </div>
    {!course.archived_at && !parentArchived && <section className="panel"><h2>Add a source</h2><LibraryUpload courseId={courseId} /></section>}
    <LibraryList courseId={courseId} search={await searchParams} />
  </>;
}
