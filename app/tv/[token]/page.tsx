import { tvScreenData, type TvScreenData } from "@/lib/tv";
import { TvScreen } from "./tv-screen";

export const metadata = { title: "Hotel Corali", robots: { index: false, follow: false } };

export default async function TvPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string; tab?: string }> }) {
  const [{ token }, { lang, tab }] = await Promise.all([params, searchParams]);
  // Rendered on the server so TVs whose built-in browser cannot run the app's JavaScript (e.g. Samsung 2020 Tizen)
  // still show the full screen; tabs are plain links there.
  let initial: TvScreenData | null | undefined;
  try { initial = await tvScreenData(token, lang); } catch (e) { console.error("TV screen failed", e); }
  // eslint-disable-next-line react-hooks/purity -- a server component renders once per request; the time seeds the clock
  const serverNow = Date.now();
  const home = `/tv/${encodeURIComponent(token)}${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`;
  // Plain ES5 fallback, only acts when the app never started: reload every minute, back home after 90 s on a tab.
  const legacy = `setTimeout(function(){if(!window.__tvLive){location.href=${JSON.stringify(tab ? home : "")}||location.href}},${tab ? 90_000 : 60_000});`;
  return (
    <>
      <TvScreen token={token} lang={lang ?? ""} initial={initial} initialTab={tab ?? "home"} serverNow={serverNow} />
      <script dangerouslySetInnerHTML={{ __html: legacy }} />
    </>
  );
}
