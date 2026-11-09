"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { Component, useEffect, useState } from "react";

const PdfReader = dynamic(() => import("./pdf-reader").then((module) => module.PdfReader), {
  ssr: false,
  loading: () => <p>Loading PDF reader…</p>,
});

class PdfPreviewBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed
      ? <p role="alert">The PDF preview failed. Refresh it or download the original.</p>
      : this.props.children;
  }
}

export function MaterialPreview({ file, mime, initialPage }: { file: string; mime: string; initialPage: number }) {
  const pdf = mime === "application/pdf";
  const image = mime === "image/png" || mime === "image/jpeg";
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<{ generation: number; url?: string }>({ generation: -1 });
  useEffect(() => {
    if (!pdf && !image) return;
    const signal = new AbortController();
    async function load() {
      try {
        const response = await fetch(file + "?preview=1", { cache: "no-store", signal: signal.signal });
        if (!response.ok) throw new Error("Preview unavailable");
        const body = await response.json();
        if (!signal.signal.aborted) setResult({ generation, url: body.url });
      } catch {
        if (!signal.signal.aborted) setResult({ generation });
      }
    }
    void load();
    return () => signal.abort();
  }, [file, generation, image, pdf]);

  if (!pdf && !image) return <p>Download this file to open it.</p>;
  const refresh = () => setGeneration((value) => value + 1);
  return <div className="stack">
    {result.generation !== generation ? <p role="status">Loading preview…</p>
      : !result.url ? <p role="alert">Preview unavailable. Try refreshing it or download the original.</p>
      : pdf ? <PdfPreviewBoundary key={initialPage + ":" + generation}>
          <PdfReader url={result.url} initialPage={initialPage} />
        </PdfPreviewBoundary>
      : <Image src={result.url} alt="Uploaded source" width={1200} height={900} className="h-auto max-w-full object-contain"
          unoptimized referrerPolicy="no-referrer" />}
    <button className="button secondary" type="button" onClick={refresh}>Refresh preview</button>
  </div>;
}
