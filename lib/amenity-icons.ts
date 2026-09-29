// Icons for room characteristics (shown in the PMS and the booking engine). Keys are stored in room_amenities.icon.
export const amenityIcons: Record<string, string> = {
  air_conditioning: "❄️", wifi: "📶", bathtub: "🛁", shower: "🚿", tv: "📺", fridge: "🧊", kettle: "☕", coffee: "☕",
  safe: "🔐", balcony: "🌅", sea_view: "🌊", garden: "🌿", pool: "🏊", parking: "🅿️", hairdryer: "💨", kitchen: "🍳",
  washing_machine: "🧺", iron: "👔", baby_cot: "👶", family: "👨‍👩‍👧", pets: "🐾", non_smoking: "🚭", accessible: "♿",
  heating: "🔥", desk: "💼", double_bed: "🛏️", sofa_bed: "🛋️", towels: "🧻", toiletries: "🧴", minibar: "🍷", beach: "🏖️",
  bbq: "🍖", terrace: "🪴", fan: "🌀", soundproof: "🔇", sparkles: "✨",
};

export function amenityIcon(key: string | null | undefined): string {
  return (key && amenityIcons[key]) || amenityIcons.sparkles;
}

export type AmenityNames = Partial<Record<"el" | "en" | "fr" | "de" | "it" | "es", string>>;

/** Name in the requested language, then English, then Greek. */
export function amenityName(names: AmenityNames, lang: string): string {
  return names[lang as keyof AmenityNames] || names.en || names.el || "";
}
