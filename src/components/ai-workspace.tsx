import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { Submit } from "@/components/ui/submit";
import { getCourse } from "@/features/academics/data";
import { runAi } from "@/features/ai/actions";
import { aiProvider } from "@/features/ai/config";
import { artifactKinds, kindLabels } from "@/features/ai/contracts";
import { getAiResult, listAiResults, listAiSources } from "@/features/ai/data";
import { AiResultView } from "./ai-result";

export async function AiWorkspace({ courseId, mode, query }: {
  courseId: string; mode: "studio" | "chat"; query: { result?: string; page?: string };
}) {
  const { course, parentArchived } = await getCourse(courseId);
  const chat = mode === "chat";
  const coursePath = "/courses/" + courseId;
  const path = coursePath + "/" + mode;
  const page = typeof query.page === "string" && /^\d{1,6}$/.test(query.page) ? Math.max(1, Number(query.page)) : 1;
  const provider = aiProvider();
  const canRun = provider && !course.archived_at && !parentArchived;
  const [sources, results, current] = await Promise.all([
    canRun ? listAiSources(courseId) : [],
    listAiResults(courseId, chat, page),
    chat && typeof query.result === "string" ? getAiResult(courseId, query.result, true) : null,
  ]);

  return <>
    <header className="page-head">
      <Link className="back" href={coursePath}>← {course.code} overview</Link>
      <h1>{chat ? "Source Q&A" : "AI Study Studio"}</h1>
      <p>{course.title}</p>
      <nav className="row" aria-label="Study Studio">
        <Link className="button secondary" href={coursePath + "/studio"} aria-current={!chat ? "page" : undefined}>Study resources</Link>
        <Link className="button secondary" href={coursePath + "/chat"} aria-current={chat ? "page" : undefined}>Source Q&amp;A</Link>
      </nav>
    </header>
    {current && <section className="panel" aria-label="Answer">
      <h2>{current.record.question}</h2>
      <AiResultView courseId={courseId} {...current} />
    </section>}
    <div className="split">
      <section className="panel">
        <h2>{chat ? "Ask about your sources" : "Generate a resource"}</h2>
        {!provider ? <p className="feedback">AI generation is disabled. Your library, notes, and existing results are available.</p>
          : !canRun ? <p>Restore this course to start a new request.</p>
          : <>
            {provider.kind === "fixture" && <p className="feedback">Local demo. Results use sample excerpts. No external AI provider is contacted.</p>}
            {sources.length ? <ActionForm action={runAi.bind(null, courseId, mode)}>
              {!chat && <label>Resource format<select name="kind">
                {artifactKinds.map((kind) => <option value={kind} key={kind}>{kindLabels[kind]}</option>)}
              </select></label>}
              <fieldset className="ai-source-picker">
                <legend>Choose one to six sources with extracted text</legend>
                {sources.map((source) => <label className="ai-check" key={source.id}>
                  <input name="source" type="checkbox" value={source.id} /> <span>{source.name}</span>
                </label>)}
              </fieldset>
              <label>{chat ? "Question" : "Instructions (optional)"}
                <textarea name="prompt" maxLength={500} required={chat} />
              </label>
              {provider.kind === "gemini" && <p>Google may retain prompts and responses for abuse monitoring. <a href="https://ai.google.dev/gemini-api/terms">Review Gemini’s data terms.</a></p>}
              <label className="ai-check">
                <input name="consent" type="checkbox" value={provider.kind} required />
                <span>{provider.kind === "gemini"
                  ? "I agree to send this request and excerpts from the selected files to Google Gemini."
                  : "Use the selected excerpts in this local demo."}</span>
              </label>
              <Submit>{chat ? "Ask question" : "Generate draft"}</Submit>
            </ActionForm> : <p><Link href={coursePath + "/library"}>Add a source in the course library</Link> and wait for text extraction.</p>}
          </>}
      </section>
      <section className="panel">
        <h2>{chat ? "Question history" : "Your study resources"}</h2>
        {results.rows.length ? <ul className="record-list">
          {results.rows.map((result) => <li key={result.id} className="row spread">
            <Link className="record-link" href={chat ? path + "?result=" + result.id + "&page=" + page : path + "/" + result.id}>
              {chat ? result.question : result.title}
            </Link>
            {!chat && <span className="tag">{kindLabels[result.kind]} · {result.saved_at ? "Saved" : "Draft"}</span>}
          </li>)}
        </ul> : <p>{chat ? "No questions yet." : "No generated resources yet."}</p>}
        {(page > 1 || results.next) && <nav className="row" aria-label="Result pages">
          {page > 1 && <Link className="button secondary" href={path + "?page=" + (page - 1)}>Previous</Link>}
          <span>Page {page}</span>
          {results.next && <Link className="button secondary" href={path + "?page=" + (page + 1)}>Next</Link>}
        </nav>}
      </section>
    </div>
  </>;
}
