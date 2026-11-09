"use client";

import { useActionState } from "react";
import type { FormState } from "@/features/academics/actions";

export type FormAction = (state: FormState, data: FormData) => Promise<FormState>;

export function ActionForm({ action, children }: { action: FormAction; children: React.ReactNode }) {
  const [state, formAction] = useActionState(action, {});
  return <form action={formAction} className="form-stack">
    {children}
    {state.error && <p className="feedback error" role="alert">{state.error}</p>}
    {state.success && <p className="feedback" role="status">{state.success}</p>}
  </form>;
}
