import Link from "next/link";
import { AiResultView } from "@/components/ai-result";
import { ActionForm } from "@/components/ui/action-form";
import { Submit } from "@/components/ui/submit";
import { saveAiResource } from "@/features/ai/actions";
import { kindLabels } from "@/features/ai/contracts";
import { getAiResult } from "@/features/ai/data";

export default async function Resource({ params, searchParams }: {
  params: Promise<{ courseId: string; resultId: string }>; searchParams: Promise<{ saved?: string }>;
}) {
  const { courseId, resultId } = await params;
  const [result, notice] = await Promise.all([getAiResult(courseId, resultId, false), searchParams]);
  const { record, output } = result;
  return <>
    <header className="page-head">
      <Link className="back" href={"/courses/" + courseId + "/studio"}>← AI Study Studio</Link>
      <p>{kindLabels[record.kind]} · {record.saved_at ? "Saved resource" : "Generated draft"}</p>
      <h1>{record.title}</h1>
      {notice.saved === "1" && <p role="status" className="feedback">Resource saved.</p>}
    </header>
    <section className="panel">
      <h2>Study resource</h2>
      <AiResultView courseId={courseId} {...result} />
    </section>
    <details className="panel">
      <summary>Edit and save resource</summary>
      <ActionForm action={saveAiResource.bind(null, courseId, resultId)}>
        <input type="hidden" name="revision" value={record.revision} />
        <label>Resource title<input name="title" defaultValue={output.title} required maxLength={160} /></label>
        {output.items.map((item, index) => <fieldset className="stack" key={index}>
          <legend>Item {index + 1}</legend>
          <label>Heading or question<input name={"heading-" + index} defaultValue={item.heading} maxLength={180} required /></label>
          <label>Text or answer<textarea name={"body-" + index} defaultValue={item.body} maxLength={1800} required /></label>
          {item.options.map((option, position) => <label key={position}>Option {position + 1}
            <input name={"option-" + index + "-" + position} defaultValue={option} maxLength={240} required />
          </label>)}
          {item.options.length > 0 && <label>Correct option
            <select name={"correct-" + index} defaultValue={item.correctOption}>
              {item.options.map((_, position) => <option value={position} key={position}>Option {position + 1}</option>)}
            </select>
          </label>}
        </fieldset>)}
        <Submit>Save resource</Submit>
      </ActionForm>
    </details>
  </>;
}
