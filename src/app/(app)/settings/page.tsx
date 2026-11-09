import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { Submit } from "@/components/ui/submit";
import { saveProfile } from "@/features/academics/actions";
import { getProfile } from "@/features/academics/data";

export const metadata: Metadata = { title: "Settings" };

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const [profile, notice] = await Promise.all([getProfile(), searchParams]);
  return <>
    <div className="page-head"><h1>Settings</h1><p>Manage your profile and local timezone.</p></div>
    <section className="panel max-w-xl">
      <h2>Profile</h2>
      {notice.saved === "1" && <p className="feedback" role="status">Profile saved.</p>}
      {notice.error === "signout" && <p className="feedback error" role="alert">Sign-out failed. Try again.</p>}
      <ActionForm action={saveProfile}>
        <label>Display name<input name="display_name" maxLength={100} defaultValue={profile.display_name} /></label>
        <label>Timezone<input name="timezone" maxLength={100} defaultValue={profile.timezone} aria-describedby="tz-hint" required /></label>
        <p id="tz-hint">Use an IANA timezone, such as Africa/Lagos.</p>
        <Submit>Save profile</Submit>
      </ActionForm>
    </section>
    <section className="panel max-w-xl">
      <h2>Notifications</h2>
      <Link className="button secondary" href="/settings/integrations/telegram">Telegram reminders</Link>
    </section>
  </>;
}
