"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { changeTimer } from "@/features/planner/actions";
import { durationLabel } from "@/features/planner/dates";
import type { TimerSnapshot } from "@/features/planner/data";

type TimerCommand = "heartbeat" | "pause" | "pause_hidden" | "resume" | "finish" | "discard";
type Choice = { id: string; label: string };
type Selection = { id: string; title: string } | null;

function clock(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}

export function StudyTimer({ initial, selection, scope, courses }: {
  initial: TimerSnapshot; selection: Selection; scope: string | null; courses: Choice[];
}) {
  const router = useRouter();
  const [state, setState] = useState(() => ({ snapshot: initial, received: performance.now() }));
  const latest = useRef(state);
  const startKey = useRef<string | null>(null);
  const [tick, setTick] = useState(0);
  const [course, setCourse] = useState(scope ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const apply = useCallback((snapshot: TimerSnapshot) => {
    const old = latest.current.snapshot;
    if (Date.parse(snapshot.server_now) < Date.parse(old.server_now)) return;
    if (snapshot.log && old.log && snapshot.log.id === old.log.id && snapshot.log.revision < old.log.revision) return;
    const next = { snapshot, received: performance.now() };
    latest.current = next;
    setState(next);
  }, []);

  const send = useCallback(async (command: TimerCommand, quiet = false) => {
    const current = latest.current.snapshot.log;
    if (!current || current.status === "discarded" || current.status === "completed") return;
    if ((command === "heartbeat" || command === "pause_hidden") && current.status !== "running") return;
    try {
      const result = await changeTimer({ operation: command, id: current.id, revision: current.revision });
      if (result.snapshot) {
        apply(result.snapshot);
        if (command === "finish" || command === "discard") router.refresh();
      } else if (!quiet) setError(result.error ?? "The timer could not update.");
    } catch {
      if (!quiet) setError("The timer could not update. Refresh to check its saved state.");
    }
  }, [apply, router]);

  const log = state.snapshot.log;
  const running = log?.status === "running";
  const active = running || log?.status === "paused";
  useEffect(() => {
    if (!running) return;
    const display = setInterval(() => { if (document.visibilityState === "visible") setTick(performance.now()); }, 250);
    const heartbeat = setInterval(() => { if (document.visibilityState === "visible") void send("heartbeat", true); }, 10_000);
    const onVisibility = () => {
      void send(document.visibilityState === "hidden" ? "pause_hidden" : "heartbeat", true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(display);
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [running, send]);

  const elapsed = (log?.elapsed_ms ?? 0) + (running && log.running_since
    ? Math.max(0, Date.parse(state.snapshot.server_now) - Date.parse(log.running_since))
      + Math.min(30_000, Math.max(0, tick - state.received))
    : 0);

  function begin() {
    setError("");
    startKey.current ??= crypto.randomUUID();
    startTransition(async () => {
      try {
        const result = await changeTimer({
          operation: "start", request_id: startKey.current,
          occurrence_id: selection?.id ?? null, course_id: course || null,
        });
        if (result.snapshot) {
          startKey.current = null;
          apply(result.snapshot);
        } else setError(result.error ?? "Could not start the timer.");
      } catch {
        setError("Could not start the timer. Try again to check the same request.");
      }
    });
  }

  function run(command: TimerCommand) {
    setError("");
    startTransition(() => send(command));
  }

  const courseLabel = courses.find((item) => item.id === log?.course_id)?.label;
  return <section className="panel" id="timer" aria-labelledby="timer-heading">
    <h2 id="timer-heading">Study timer</h2>
    <p>{active ? courseLabel ?? (log?.course_id ? "Course study" : "General study")
      : selection ? "Selected session · " + selection.title : "Start an unplanned session or choose a calendar session."}</p>
    {active && <>
      <p className="study-clock" aria-label="Elapsed study time">{clock(elapsed)}</p>
      <p role="status">{running ? "Running" : log?.pause_reason === "inactive" ? "Paused after the timer stopped checking in." : "Paused"}</p>
      <div className="row">
        {running ? <button className="button secondary" type="button" disabled={pending} onClick={() => run("pause")}>Pause timer</button>
          : <button className="button secondary" type="button" disabled={pending} onClick={() => run("resume")}>Resume timer</button>}
        <button className="button" type="button" disabled={pending} onClick={() => run("finish")}>Finish and log</button>
        <button className="button secondary" type="button" disabled={pending} onClick={() => run("discard")}>Discard timer</button>
      </div>
    </>}
    {!active && <>
      {log?.status === "completed" && <p role="status" className="feedback">Logged {durationLabel(Math.floor(log.elapsed_ms / 1000))} of study.</p>}
      {log?.status === "discarded" && <p role="status">Timer discarded.</p>}
      {!selection && !scope && <label>Timer course
        <select value={course} onChange={(event) => { startKey.current = null; setCourse(event.target.value); }}>
          <option value="">General study</option>
          {courses.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>}
      <button className="button" type="button" disabled={pending} onClick={begin}>Start timer</button>
    </>}
    {error && <p className="feedback error" role="alert">{error}</p>}
  </section>;
}
