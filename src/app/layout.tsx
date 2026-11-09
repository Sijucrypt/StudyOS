import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "StudyOS", template: "%s | StudyOS" },
  description: "A private workspace for your courses and study progress.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
