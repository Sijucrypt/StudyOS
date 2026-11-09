import Link from "next/link";
import { signOut } from "@/app/(auth)/login/actions";
import { Submit } from "@/components/ui/submit";
import { authenticated } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function Workspace({ children }: { children: React.ReactNode }) {
  await authenticated();
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="header-inner">
          <Link className="brand" href="/dashboard"><span className="brand-mark" aria-hidden="true">S</span>StudyOS</Link>
          <nav aria-label="Workspace">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/sessions">Academics</Link>
            <Link href="/library">Library</Link>
            <Link href="/ai-studio">AI Studio</Link>
            <Link href="/planner">Planner</Link>
            <Link href="/analytics">Analytics</Link>
            <Link href="/settings">Settings</Link>
          </nav>
          <form action={signOut}><Submit variant="secondary">Sign out</Submit></form>
        </div>
      </header>
      <main className="workspace" id="main">{children}</main>
    </>
  );
}
