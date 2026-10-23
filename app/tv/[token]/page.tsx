import { TvScreen } from "./tv-screen";

export const metadata = { title: "Hotel Corali", robots: { index: false, follow: false } };

export default async function TvPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string }> }) {
  const [{ token }, { lang }] = await Promise.all([params, searchParams]);
  return <TvScreen token={token} lang={lang ?? ""} />;
}
