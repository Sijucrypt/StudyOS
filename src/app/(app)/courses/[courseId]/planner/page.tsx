import { PlannerPage, type PlannerQuery } from "@/components/planner-page";

export default async function CoursePlanner({ params, searchParams }: {
  params: Promise<{ courseId: string }>; searchParams: Promise<PlannerQuery>;
}) {
  const [{ courseId }, query] = await Promise.all([params, searchParams]);
  return <PlannerPage courseId={courseId} query={query} />;
}
