import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/auth/config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = authConfig();
  if (config) {
    const client = createServerClient(config.url, config.key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (updates) => {
          for (const { name, value } of updates) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of updates) response.cookies.set(name, value, options);
        },
      },
    });
    await client.auth.getSession();
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/login", "/dashboard/:path*", "/sessions/:path*", "/courses/:path*", "/library/:path*", "/ai-studio/:path*",
    "/planner/:path*", "/analytics/:path*", "/settings/:path*"],
};
