import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { authConfig } from "./config";

export const serverClient = cache(async () => {
  const config = authConfig();
  if (!config) redirect("/login");
  const cookieStore = await cookies();

  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (updates) => {
        try {
          for (const { name, value, options } of updates) cookieStore.set(name, value, options);
        } catch {
          // Server Components read cookies. The proxy refreshes them on navigation.
        }
      },
    },
  });
});

export const authenticated = cache(async () => {
  const db = await serverClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) redirect("/login");
  return { db, user: data.user };
});
