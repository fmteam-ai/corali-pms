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

// Default names for each icon in the six guest languages; picking an icon in the PMS fills these in (editable).
export const amenityDefaults: Record<string, Required<AmenityNames>> = {
  air_conditioning: { el: "Κλιματισμός", en: "Air conditioning", fr: "Climatisation", de: "Klimaanlage", it: "Aria condizionata", es: "Aire acondicionado" },
  wifi: { el: "Δωρεάν Wi-Fi", en: "Free Wi-Fi", fr: "Wi-Fi gratuit", de: "Kostenloses WLAN", it: "Wi-Fi gratuito", es: "Wi-Fi gratis" },
  bathtub: { el: "Μπανιέρα", en: "Bathtub", fr: "Baignoire", de: "Badewanne", it: "Vasca da bagno", es: "Bañera" },
  shower: { el: "Ντους", en: "Shower", fr: "Douche", de: "Dusche", it: "Doccia", es: "Ducha" },
  tv: { el: "Τηλεόραση", en: "TV", fr: "Télévision", de: "Fernseher", it: "TV", es: "Televisión" },
  fridge: { el: "Ψυγείο", en: "Fridge", fr: "Réfrigérateur", de: "Kühlschrank", it: "Frigorifero", es: "Nevera" },
  kettle: { el: "Βραστήρας", en: "Kettle", fr: "Bouilloire", de: "Wasserkocher", it: "Bollitore", es: "Hervidor" },
  coffee: { el: "Καφετιέρα", en: "Coffee maker", fr: "Cafetière", de: "Kaffeemaschine", it: "Macchina del caffè", es: "Cafetera" },
  safe: { el: "Χρηματοκιβώτιο", en: "Safe", fr: "Coffre-fort", de: "Safe", it: "Cassaforte", es: "Caja fuerte" },
  balcony: { el: "Μπαλκόνι", en: "Balcony", fr: "Balcon", de: "Balkon", it: "Balcone", es: "Balcón" },
  sea_view: { el: "Θέα θάλασσα", en: "Sea view", fr: "Vue sur la mer", de: "Meerblick", it: "Vista mare", es: "Vistas al mar" },
  garden: { el: "Κήπος", en: "Garden", fr: "Jardin", de: "Garten", it: "Giardino", es: "Jardín" },
  pool: { el: "Πισίνα", en: "Pool", fr: "Piscine", de: "Pool", it: "Piscina", es: "Piscina" },
  parking: { el: "Χώρος στάθμευσης", en: "Parking", fr: "Parking", de: "Parkplatz", it: "Parcheggio", es: "Aparcamiento" },
  hairdryer: { el: "Σεσουάρ", en: "Hairdryer", fr: "Sèche-cheveux", de: "Haartrockner", it: "Asciugacapelli", es: "Secador de pelo" },
  kitchen: { el: "Κουζίνα", en: "Kitchen", fr: "Cuisine", de: "Küche", it: "Cucina", es: "Cocina" },
  washing_machine: { el: "Πλυντήριο", en: "Washing machine", fr: "Lave-linge", de: "Waschmaschine", it: "Lavatrice", es: "Lavadora" },
  iron: { el: "Σίδερο", en: "Iron", fr: "Fer à repasser", de: "Bügeleisen", it: "Ferro da stiro", es: "Plancha" },
  baby_cot: { el: "Βρεφική κούνια", en: "Baby cot", fr: "Lit bébé", de: "Babybett", it: "Culla", es: "Cuna" },
  family: { el: "Οικογενειακό", en: "Family friendly", fr: "Idéal pour les familles", de: "Familienfreundlich", it: "Adatto alle famiglie", es: "Ideal para familias" },
  pets: { el: "Επιτρέπονται κατοικίδια", en: "Pets allowed", fr: "Animaux acceptés", de: "Haustiere erlaubt", it: "Animali ammessi", es: "Se admiten mascotas" },
  non_smoking: { el: "Μη καπνιστών", en: "Non-smoking", fr: "Non-fumeurs", de: "Nichtraucher", it: "Non fumatori", es: "No fumadores" },
  accessible: { el: "Προσβάσιμο", en: "Accessible", fr: "Accessible", de: "Barrierefrei", it: "Accessibile", es: "Accesible" },
  heating: { el: "Θέρμανση", en: "Heating", fr: "Chauffage", de: "Heizung", it: "Riscaldamento", es: "Calefacción" },
  desk: { el: "Γραφείο εργασίας", en: "Desk", fr: "Bureau", de: "Schreibtisch", it: "Scrivania", es: "Escritorio" },
  double_bed: { el: "Διπλό κρεβάτι", en: "Double bed", fr: "Lit double", de: "Doppelbett", it: "Letto matrimoniale", es: "Cama doble" },
  sofa_bed: { el: "Καναπές-κρεβάτι", en: "Sofa bed", fr: "Canapé-lit", de: "Schlafsofa", it: "Divano letto", es: "Sofá cama" },
  towels: { el: "Πετσέτες", en: "Towels", fr: "Serviettes", de: "Handtücher", it: "Asciugamani", es: "Toallas" },
  toiletries: { el: "Είδη περιποίησης", en: "Toiletries", fr: "Articles de toilette", de: "Pflegeprodukte", it: "Set di cortesia", es: "Artículos de aseo" },
  minibar: { el: "Μίνι μπαρ", en: "Minibar", fr: "Minibar", de: "Minibar", it: "Minibar", es: "Minibar" },
  beach: { el: "Κοντά στην παραλία", en: "Near the beach", fr: "Près de la plage", de: "Strandnah", it: "Vicino alla spiaggia", es: "Cerca de la playa" },
  bbq: { el: "Ψησταριά", en: "BBQ", fr: "Barbecue", de: "Grill", it: "Barbecue", es: "Barbacoa" },
  terrace: { el: "Βεράντα", en: "Terrace", fr: "Terrasse", de: "Terrasse", it: "Terrazza", es: "Terraza" },
  fan: { el: "Ανεμιστήρας", en: "Fan", fr: "Ventilateur", de: "Ventilator", it: "Ventilatore", es: "Ventilador" },
  soundproof: { el: "Ηχομόνωση", en: "Soundproofing", fr: "Insonorisation", de: "Schallisoliert", it: "Insonorizzato", es: "Insonorizado" },
  sparkles: { el: "", en: "", fr: "", de: "", it: "", es: "" },
};

/** The usual set offered by “Add standard characteristics”. */
export const standardAmenities = ["air_conditioning", "wifi", "tv", "fridge", "safe", "hairdryer", "balcony", "sea_view", "shower", "kettle", "towels", "toiletries", "non_smoking"];
