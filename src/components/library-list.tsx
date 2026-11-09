import Link from "next/link";
import { MaterialButton, MaterialPolling } from "./material-controls";
import { listMaterials, materialStatus } from "@/features/library/data";

export async function LibraryList({ courseId, search }: { courseId: string | null; search: { q?: string; page?: string } }) {
  const query = typeof search.q === "string" ? search.q.trim().slice(0, 100) : "";
  const page = typeof search.page === "string" && /^\d{1,6}$/.test(search.page) ? Math.max(1, Number(search.page)) : 1;
  const path = courseId ? "/courses/" + courseId + "/library" : "/library";
  const { materials, hasNext } = await listMaterials(courseId, query, (page - 1) * 50);
  const link = (target: number) => path + "?" + new URLSearchParams({ q: query, page: String(target) });
  return <section className="panel">
    <h2>Files</h2>
    <form action={path} className="row">
      <label>Search by filename<input name="q" defaultValue={query} maxLength={100} /></label>
      <button className="button secondary self-end" type="submit">Search</button>
      {query && <Link className="button secondary self-end" href={path}>Clear search</Link>}
    </form>
    <MaterialPolling active={materials.some((item) => item.upload_state === "submitted" || item.extraction_state === "queued")} />
    {materials.length ? <ul className="record-list">{materials.map((item) => <li className="stack" key={item.id}>
      <div className="row spread">
        <Link className="record-link" href={"/courses/" + item.course_id + "/materials/" + item.id}>{item.name}</Link>
        <span className="tag">{Math.max(1, Math.ceil(item.byte_size / 1000))} kB</span>
      </div>
      <p>{materialStatus(item)}</p>
      {item.upload_state === "pending" && <MaterialButton id={item.id} operation="submit" label="Check upload" />}
    </li>)}</ul> : <p>{query ? "No files match this search." : "No files here yet."}</p>}
    {(page > 1 || hasNext) && <nav className="row" aria-label="File pages">
      {page > 1 && <Link className="button secondary" href={link(page - 1)}>Previous</Link>}
      <span>Page {page}</span>
      {hasNext && <Link className="button secondary" href={link(page + 1)}>Next</Link>}
    </nav>}
  </section>;
}
