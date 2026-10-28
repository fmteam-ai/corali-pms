import type { Metadata } from "next";
import { Unsubscribe } from "./unsubscribe";

export const metadata: Metadata = { title: "Hotel Corali", robots: { index: false, follow: false } };

/** Unsubscribe from the hotel's bulk messages (link at the bottom of every e-mail). */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams, one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const lang = ["el", "en", "fr", "de", "it", "es"].includes(one("lang")) ? one("lang") : "en";
  return <Unsubscribe r={one("r")} t={one("t")} lang={lang as "el"} test={one("test") === "1"} />;
}
