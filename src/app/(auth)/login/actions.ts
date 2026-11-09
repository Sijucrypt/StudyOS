"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticated, serverClient } from "@/lib/auth/server";

const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});

export async function signIn(form: FormData) {
  const input = credentials.safeParse({
    email: String(form.get("email") ?? "").trim(),
    password: form.get("password"),
  });
  if (!input.success) redirect("/login?error=1");
  const client = await serverClient();
  const { error } = await client.auth.signInWithPassword(input.data);
  if (error) redirect("/login?error=1");
  redirect("/dashboard");
}

export async function signOut() {
  const { db } = await authenticated();
  const { error } = await db.auth.signOut({ scope: "local" });
  if (error) redirect("/settings?error=signout");
  redirect("/login");
}
