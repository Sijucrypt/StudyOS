"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
const options = {
  isEvalSupported: false,
  enableXfa: false,
  useWasm: false,
  cMapUrl: "/pdf-assets/cmaps/",
  standardFontDataUrl: "/pdf-assets/standard_fonts/",
};

export function PdfReader({ url, initialPage }: { url: string; initialPage: number }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (!frame.current) return;
    const resize = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    resize.observe(frame.current);
    return () => resize.disconnect();
  }, []);
  const failed = <p role="alert">The PDF could not be displayed. Refresh the preview or download the original.</p>;

  return <div ref={frame} className="stack min-w-0">
    <div className="row" aria-label="PDF pages">
      <button className="button secondary" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous page</button>
      <p role="status">Page {page}{total ? " of " + total : ""}</p>
      <button className="button secondary" type="button" disabled={page >= total} onClick={() => setPage(page + 1)}>Next page</button>
    </div>
    <Document file={url} options={options} error={failed} onLoadSuccess={({ numPages }) => {
      setTotal(numPages);
      setPage((value) => Math.min(value, numPages));
    }}>
      {width > 0 && total > 0 && <Page pageNumber={page} width={Math.min(width, 1000)} renderAnnotationLayer={false} error={failed} />}
    </Document>
  </div>;
}
