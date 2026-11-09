import { AiWorkspace } from "@/components/ai-workspace";

export default async function Studio({ params, searchParams }: {
  params: Promise<{ courseId: string }>; searchParams: Promise<{ page?: string }>;
}) {
  const [{ courseId }, query] = await Promise.all([params, searchParams]);
  return <AiWorkspace courseId={courseId} mode="studio" query={query} />;
}
