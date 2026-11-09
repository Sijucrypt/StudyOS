"use client";

import { useFormStatus } from "react-dom";

export function Submit({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={variant === "secondary" ? "button secondary" : "button"} disabled={pending}>
    {pending ? "Working…" : children}
  </button>;
}
