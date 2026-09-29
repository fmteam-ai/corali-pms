// Rule-based upsell recommendations (pure; unit tested). Breakfast is never recommended (it is part of the default offer).

export type UpsellContext = { adults: number; children: number; nights: number; checkIn: string; bookingDate: string };
export type UpsellExtra = { id: number; code: string; name: string; description?: string; pricing_mode?: string };
export type UpsellReason = "family" | "couple" | "long_stay" | "arrival" | "last_minute" | "summer" | "group";

const has = (extra: UpsellExtra, words: string[]) => {
  const text = `${extra.code} ${extra.name} ${extra.description ?? ""}`.toLowerCase();
  return words.some((w) => text.includes(w));
};

export function isBreakfast(extra: UpsellExtra) {
  return has(extra, ["breakfast", "πρωιν", "frühstück", "petit-déjeuner", "petit déjeuner", "colazione", "desayuno"]);
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Up to `limit` extras with a reason, best first. */
export function recommendExtras(extras: UpsellExtra[], ctx: UpsellContext, limit = 3): { id: number; reason: UpsellReason; score: number }[] {
  const lead = daysBetween(ctx.bookingDate, ctx.checkIn);
  const month = Number(ctx.checkIn.slice(5, 7));
  const scored = extras.filter((e) => !isBreakfast(e)).map((e) => {
    let score = 0;
    let reason: UpsellReason = "arrival";
    const bump = (points: number, why: UpsellReason) => { if (points > score) reason = why; score += points; };
    if (ctx.children > 0 && has(e, ["cot", "crib", "baby", "κούνια", "παιδ", "child", "kid", "family"])) bump(6, "family");
    if (ctx.adults === 2 && ctx.children === 0 && has(e, ["wine", "κρασ", "champagne", "σαμπάνια", "flower", "λουλούδ", "romantic", "ρομαντ", "spa", "massage", "μασάζ"])) bump(4, "couple");
    if (ctx.nights >= 4 && has(e, ["boat", "σκάφ", "βάρκ", "tour", "εκδρομ", "excursion", "car", "αυτοκίν", "scooter", "bike", "ποδήλ", "rental", "ενοικ"])) bump(4, "long_stay");
    if (has(e, ["transfer", "μεταφορ", "port", "λιμάν", "airport", "αεροδρ", "taxi", "ταξί", "luggage", "αποσκευ"])) bump(3, "arrival");
    if (lead <= 7 && has(e, ["late check", "early check", "αργή αναχώρ", "πρώιμη άφιξ"])) bump(3, "last_minute");
    if (month >= 6 && month <= 9 && has(e, ["beach", "παραλί", "umbrella", "ομπρέλ", "snorkel", "sup", "kayak", "boat", "σκάφ"])) bump(2, "summer");
    if (ctx.adults + ctx.children >= 4 && has(e, ["transfer", "μεταφορ", "car", "αυτοκίν", "van"])) bump(2, "group");
    return { id: e.id, reason, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, limit);
}
