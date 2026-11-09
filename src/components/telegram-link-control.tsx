"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { createTelegramLink, simulateTelegramLink, type LinkState } from "@/features/telegram/actions";
import { ActionForm } from "@/components/ui/action-form";
import { Submit } from "@/components/ui/submit";

export function TelegramLinkControl({ connected }: { connected: boolean }) {
  const [state, issue] = useActionState<LinkState>(createTelegramLink, {});
  return <div className="stack">
    <form action={issue} className="form-stack">
      <Submit variant="secondary">{connected ? "Create a new link" : "Create Telegram link"}</Submit>
    </form>
    {state.error && <p className="feedback error" role="alert">{state.error}</p>}
    {state.link && <div className="stack">
      <p>Open the bot and press Start within ten minutes to verify this connection.</p>
      <a className="button" href={state.link} target="_blank" rel="noreferrer">Open Telegram bot</a>
    </div>}
    {state.demoCode && <div className="stack">
      <p>One-time demo code <code className="demo-code" aria-label="Demo link code">{state.demoCode}</code></p>
      <ActionForm action={simulateTelegramLink.bind(null, state.demoCode)}>
        <Submit>Simulate Telegram connection</Submit>
      </ActionForm>
    </div>}
  </div>;
}

export function RefreshTelegramStatus() {
  const router = useRouter();
  return <button className="button secondary" type="button" onClick={() => router.refresh()}>Refresh status</button>;
}
