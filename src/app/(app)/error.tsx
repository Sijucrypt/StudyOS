"use client";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return <section className="panel" role="alert">
    <h1>StudyOS could not load this page</h1>
    <p>Try again in a moment.</p>
    <button type="button" className="button" onClick={reset}>Try again</button>
  </section>;
}
