// PMS → Ενσωματώσεις → Facebook / Instagram → «Γρήγορη σύνδεση» (pure; unit tested): from the short token copied
// out of Graph API Explorer the PMS finds the Page, its permanent token and the linked Instagram account itself.
export const DEFAULT_GRAPH_VERSION = "v26.0";

export type MetaPage = { id: string; name: string; accessToken: string; instagramId: string; instagramName: string };

export function parseAccounts(json: unknown): MetaPage[] {
  const data = (json as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((p) => {
    const r = p as { id?: unknown; name?: unknown; access_token?: unknown; instagram_business_account?: { id?: unknown; username?: unknown } };
    if (typeof r.id !== "string" || typeof r.access_token !== "string") return [];
    return [{ id: r.id, name: String(r.name ?? ""), accessToken: r.access_token, instagramId: String(r.instagram_business_account?.id ?? ""), instagramName: String(r.instagram_business_account?.username ?? "") }];
  });
}

/** The page to use: the one asked for, or the only one; null when the hotel has to choose. */
export function pickPage(pages: MetaPage[], pageId?: string): MetaPage | null {
  if (pageId) return pages.find((p) => p.id === pageId) ?? null;
  return pages.length === 1 ? pages[0] : null;
}

/** A pasted token, trimmed of spaces and of a leading "access_token=" or quotes copied by mistake. */
export const cleanToken = (v: string) => v.trim().replace(/^access_token=/, "").replace(/^["']|["']$/g, "").trim();
export const validGraphVersion = (v: string) => (/^v\d{1,2}\.0$/.test(v) ? v : DEFAULT_GRAPH_VERSION);
