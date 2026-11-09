import { AiWorkspace } from "@/components/ai-workspace";

export default async function Chat({ params, searchParams }: {
  params: Promise<{ courseId: string }>; searchParams: Promise<{ result?: string; page?: string }>;
}) {
  const [{ courseId }, query] = await Promise.all([params, searchParams]);
  return <AiWorkspace courseId={courseId} mode="chat" query={query} />;
}
