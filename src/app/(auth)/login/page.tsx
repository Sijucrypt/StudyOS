import type { Metadata } from "next";
import { authConfig } from "@/lib/auth/config";
import { Submit } from "@/components/ui/submit";
import { signIn } from "./actions";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <section className="panel login-panel" aria-labelledby="signin-title">
        <div className="brand"><span className="brand-mark" aria-hidden="true">S</span>StudyOS</div>
        <h1 id="signin-title">Sign in</h1>
        <p>Your private study workspace.</p>
        {authConfig() ? (
          <form action={signIn} className="form-stack">
            <label>Email<input name="email" type="email" autoComplete="username" maxLength={254} required /></label>
            <label>Password<input name="password" type="password" autoComplete="current-password" maxLength={256} required /></label>
            {error === "1" && <p className="feedback error" role="alert">Sign-in failed. Check your email and password and try again.</p>}
            <Submit>Sign in</Submit>
          </form>
        ) : <p className="feedback" role="status">Connect a development Supabase project to enable sign-in. See the setup instructions in README.md.</p>}
      </section>
    </main>
  );
}
