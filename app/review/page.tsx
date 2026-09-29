import { ReviewForm } from "./review-form";

export const metadata = { title: "Hotel Corali · Review", robots: { index: false } };

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ token?: string; lang?: string }> }) {
  const p = await searchParams;
  return <ReviewForm token={p.token ?? ""} initialLang={p.lang ?? ""} />;
}
