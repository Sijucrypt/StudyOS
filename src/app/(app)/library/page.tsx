import type { Metadata } from "next";
import Link from "next/link";
import { LibraryList } from "@/components/library-list";

export const metadata: Metadata = { title: "Library" };

export default async function Library({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  return <>
    <div className="page-head">
      <h1>Library</h1><p>Search private files across your courses. Open a course to upload a new file.</p>
      <Link className="back" href="/sessions">Browse academics</Link>
    </div>
    <LibraryList courseId={null} search={await searchParams} />
  </>;
}
