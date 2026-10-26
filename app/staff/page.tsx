import type { Metadata, Viewport } from "next";
import { requireUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { StaffApp } from "./staff-app";
import "./staff.css";

export const metadata: Metadata = {
  title: "Corali Staff",
  manifest: "/staff.webmanifest",
  appleWebApp: { capable: true, title: "Corali Staff", statusBarStyle: "default" },
  icons: { apple: "/staff-apple-touch.png", icon: "/staff-icon-192.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#173e47" };

/** Corali Staff: the phone app for every employee (installable; alerts with the app closed). */
export default async function StaffPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireUser("staff.app");
  const { lang } = await getPmsT();
  return <StaffApp lang={lang} initialTab={(await searchParams).tab ?? null} />;
}
