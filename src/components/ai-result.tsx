import Link from "next/link";
import { insufficientMessage, type AiOutput } from "@/features/ai/contracts";
import type { AiResult, Citation } from "@/features/ai/data";

export function CitationLinks({ courseId, ids, citations, available }: {
  courseId: string; ids: string[]; citations: Citation[]; available: ReadonlySet<string>;
}) {
  return <ul className="row" aria-label="Sources">
    {ids.map((id) => {
      const ref = citations.find((citation) => citation.citation_id === id);
      if (!ref) return null;
      const pdf = ref.mime_type === "application/pdf";
      const slides = ref.mime_type.includes("presentationml");
      const range = ref.page_start === ref.page_end ? ref.page_start : ref.page_start + "–" + ref.page_end;
      const label = ref.source_name + (ref.page_start ? (slides ? " · slide " : " · page ") + range : "");
      const href = "/courses/" + courseId + "/materials/" + ref.material_id + (pdf && ref.page_start ? "?page=" + ref.page_start : "");
      return <li key={id}>
        {available.has(ref.material_id) ? <Link className="record-link" href={href}>{label}</Link> : <span>{label} (removed)</span>}
      </li>;
    })}
  </ul>;
}

export function AiResultView({ courseId, record, output, citations, available }: {
  courseId: string; record: AiResult; output: AiOutput; citations: Citation[]; available: ReadonlySet<string>;
}) {
  if (output.outcome === "insufficient") return <p className="feedback" role="status">{insufficientMessage(record.kind)}</p>;
  return <>
    <p className="feedback">{record.provider === "fixture" ? "Demo output from local excerpts." : "AI-generated. Check claims against the linked sources."}</p>
    {record.saved_at && <p>Source links reflect the generated draft. Review them against any edits.</p>}
    <ul className="record-list">
      {output.items.map((item, index) => <li className="stack" key={index}>
        <h3>{item.heading}</h3>
        {item.options.length > 0 && <ol className="list-decimal pl-6">
          {item.options.map((option) => <li key={option}>{option}</li>)}
        </ol>}
        {record.kind === "flashcards" || record.kind === "mcq" || record.kind === "theory" ? <details>
          <summary>Reveal answer</summary>
          {item.correctOption >= 0 && <p>Correct answer: {item.options[item.correctOption]}</p>}
          <p className="whitespace-pre-wrap">{item.body}</p>
        </details> : <p className="whitespace-pre-wrap">{item.body}</p>}
        <CitationLinks courseId={courseId} ids={item.citations} citations={citations} available={available} />
      </li>)}
    </ul>
  </>;
}
