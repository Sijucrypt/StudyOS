"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { changeMaterial } from "@/features/library/actions";

export function MaterialPolling({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}

export function MaterialButton({ id, operation, label, returnTo }: {
  id: string; operation: "submit" | "retry" | "remove"; label: string; returnTo?: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  return <div className="stack">
    <button className="button secondary" type="button" disabled={busy} onClick={() => {
      if (operation === "remove" && !window.confirm("Remove this file from your library?")) return;
      setError("");
      start(async () => {
        try {
          const result = await changeMaterial(id, operation);
          if (result.error) setError(result.error);
          else if (returnTo) router.replace(returnTo);
          else router.refresh();
        } catch {
          setError("The file action could not be completed. Try again.");
        }
      });
    }}>{busy ? "Working…" : label}</button>
    {error && <p role="alert" className="feedback error">{error}</p>}
  </div>;
}
