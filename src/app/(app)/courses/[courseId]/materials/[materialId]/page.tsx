import Link from "next/link";
import { MaterialButton, MaterialPolling } from "@/components/material-controls";
import { MaterialPreview } from "@/components/material-preview";
import { getMaterial, materialStatus } from "@/features/library/data";

export default async function MaterialPage({ params, searchParams }: {
  params: Promise<{ courseId: string; materialId: string }>; searchParams: Promise<{ page?: string }>;
}) {
  const [{ courseId, materialId }, query] = await Promise.all([params, searchParams]);
  const initialPage = typeof query.page === "string" && /^[1-9]\d{0,5}$/.test(query.page) ? Number(query.page) : 1;
  const item = await getMaterial(courseId, materialId);
  const back = "/courses/" + courseId + "/library";
  const file = "/courses/" + courseId + "/materials/" + materialId + "/file";
  return <>
    <div className="page-head">
      <Link className="back" href={back}>← Course library</Link><h1>{item.name}</h1>
      <p>{materialStatus(item)}</p>
      {item.page_count && <p>{item.page_count} pages</p>}
    </div>
    <MaterialPolling active={item.upload_state === "submitted" || item.extraction_state === "queued"} />
    <section className="panel">
      <h2>Original file</h2>
      {item.upload_state === "verified" ? <>
        <a className="button" href={file} referrerPolicy="no-referrer">Download original</a>
        <MaterialPreview file={file} mime={item.mime_type} initialPage={initialPage} />
      </> : <p>The original becomes available after file verification.</p>}
      <div className="row">
        {item.upload_state === "pending" && <MaterialButton id={item.id} operation="submit" label="Check upload" />}
        {item.extraction_state === "failed" && <MaterialButton id={item.id} operation="retry" label="Retry text extraction" />}
        <MaterialButton id={item.id} operation="remove" label="Remove file" returnTo={back} />
      </div>
    </section>
  </>;
}
