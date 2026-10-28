import type { Metadata, Viewport } from "next";
import { PartnerApp } from "./partner-app";
import "./partner.css";

export const metadata: Metadata = { title: "Corali Partners", manifest: "/partner.webmanifest", appleWebApp: { capable: true, title: "Corali Partners", statusBarStyle: "default" }, icons: { apple: "/partner-icon-192.png" } };
export const viewport: Viewport = { themeColor: "#173e47" };

/** App of the hotel's partner businesses: guest orders, guest pass check, offers (approved by the hotel), catalogue. */
export default function PartnerPage() {
  return <PartnerApp />;
}
