"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Upload } from "tus-js-client";
import { changeMaterial, reserveUpload } from "@/features/library/actions";
import { BUCKET, FILE_LIMIT, RESUMABLE_THRESHOLD } from "@/features/library/formats.mjs";

type Reservation = Extract<Awaited<ReturnType<typeof reserveUpload>>, { token: string }>;

async function transfer(file: File, reservation: Reservation, progress: (value: number) => void) {
  if (file.size > RESUMABLE_THRESHOLD) {
    await new Promise<void>((resolve, reject) => {
      new Upload(file, {
        endpoint: reservation.tusEndpoint,
        headers: { "x-signature": reservation.token, apikey: reservation.publishableKey },
        metadata: { bucketName: BUCKET, objectName: reservation.storageKey, contentType: reservation.mime, cacheControl: "0" },
        chunkSize: 6 * 1024 * 1024,
        uploadDataDuringCreation: true,
        storeFingerprintForResuming: false,
        retryDelays: [0, 1000, 3000, 5000],
        onError: reject,
        onSuccess: () => resolve(),
        onProgress: (sent, total) => progress(Math.floor(sent * 100 / total)),
      }).start();
    });
    return;
  }
  const body = new FormData();
  body.append("cacheControl", "0");
  body.append("", new Blob([file], { type: reservation.mime }));
  const result = await fetch(reservation.signedUrl, {
    method: "PUT", headers: { "x-upsert": "false", apikey: reservation.publishableKey }, body,
  });
  if (!result.ok) throw new Error("Storage upload failed");
  progress(100);
}

export function LibraryUpload({ courseId }: { courseId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    const file = input.current?.files?.[0];
    if (!file || file.size < 1 || file.size > FILE_LIMIT) {
      setError("Choose a file from 1 byte to 25 MB.");
      return;
    }
    active.current = true;
    setBusy(true);
    setProgress(0);
    setStatus("");
    setError("");
    let uploadedId: string | undefined;
    try {
      const reservation = await reserveUpload(courseId, { name: file.name, size: file.size });
      if (!reservation.token) {
        setError(reservation.error ?? "Could not authorize the upload.");
        return;
      }
      uploadedId = reservation.id;
      await transfer(file, reservation, setProgress);
      const result = await changeMaterial(reservation.id, "submit");
      if (result.error) {
        setError("The upload finished. Use Check upload in the file list to submit it for verification.");
      } else {
        if (input.current) input.current.value = "";
        setStatus("Upload received. The original becomes available after verification.");
      }
    } catch {
      setError("The upload could not be confirmed. Check its entry in the library before trying again.");
    } finally {
      if (uploadedId) router.refresh();
      active.current = false;
      setBusy(false);
    }
  }

  return <form className="form-stack" onSubmit={upload}>
    <label>Choose a file
      <input ref={input} type="file" accept=".pdf,.docx,.pptx,.txt,.md,.jpg,.jpeg,.png" disabled={busy} required />
    </label>
    <p>PDF, DOCX, PPTX, TXT, Markdown, JPEG or PNG. Up to 25 MB per file.</p>
    <button className="button" type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload file"}</button>
    {busy && <progress aria-label="Upload progress" max={100} value={progress}>{progress}%</progress>}
    {status && <p role="status" className="feedback">{status}</p>}
    {error && <p role="alert" className="feedback error">{error}</p>}
  </form>;
}
