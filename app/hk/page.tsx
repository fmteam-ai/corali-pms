import type { Metadata, Viewport } from "next";
import { requireUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { can } from "@/lib/security/permissions";
import { HkApp } from "./hk-app";
import "./hk.css";

export const metadata: Metadata = { title: "Corali · Housekeeping", manifest: "/hk.webmanifest", appleWebApp: { capable: true, title: "Corali HK" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#173e47" };

/** Housekeeping on the phone: today's rooms, sheets & towels, cleaning steps, problems and messages with reception. */
export default async function HousekeepingPhonePage() {
  const u = await requireUser("housekeeping.read");
  const { lang } = await getPmsT();
  return <HkApp lang={lang} me={u.id} name={u.displayName} isHousekeeper={u.role === "housekeeping"} canWrite={can(u.role, "housekeeping.write", u.permissions)} />;
}
