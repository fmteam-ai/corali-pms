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

/** WhatsApp Business accounts the token may manage (debug_token → granular_scopes). */
export function wabaIdsFromDebug(json: unknown): string[] {
  const scopes = (json as { data?: { granular_scopes?: { scope?: string; target_ids?: unknown[] }[] } } | null)?.data?.granular_scopes ?? [];
  const ids = scopes.filter((s) => s.scope === "whatsapp_business_management" || s.scope === "whatsapp_business_messaging").flatMap((s) => (Array.isArray(s.target_ids) ? s.target_ids.map(String) : []));
  return [...new Set(ids.filter((id) => /^\d{5,30}$/.test(id)))];
}

/** When the token stops working: 0 = never (a System User token), else epoch ms. */
export function tokenExpiry(json: unknown): number {
  const d = (json as { data?: { expires_at?: unknown; data_access_expires_at?: unknown } } | null)?.data;
  const exp = Number(d?.expires_at ?? 0);
  return exp > 0 ? exp * 1000 : 0;
}

export type WaPhone = { id: string; number: string; name: string; wabaId: string };
export function parsePhones(json: unknown, wabaId: string): WaPhone[] {
  const data = (json as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((p) => {
    const r = p as { id?: unknown; display_phone_number?: unknown; verified_name?: unknown };
    return typeof r.id === "string" ? [{ id: r.id, number: String(r.display_phone_number ?? ""), name: String(r.verified_name ?? ""), wabaId }] : [];
  });
}
