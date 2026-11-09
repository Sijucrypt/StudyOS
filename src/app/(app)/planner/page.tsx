import type { Metadata } from "next";
import { PlannerPage, type PlannerQuery } from "@/components/planner-page";

export const metadata: Metadata = { title: "Study planner" };

export default async function Planner({ searchParams }: { searchParams: Promise<PlannerQuery> }) {
  return <PlannerPage courseId={null} query={await searchParams} />;
}
