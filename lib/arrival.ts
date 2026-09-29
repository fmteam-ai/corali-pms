// Arrival instructions per mode of arrival and hub, plus transfer ordering rules (pure; unit tested).

export const arrivalLanguages = ["el", "en", "fr", "de", "it", "es"] as const;
export type ArrivalLanguage = (typeof arrivalLanguages)[number];
export const arrivalModes = ["port", "airport", "car", "taxi"] as const;
export type ArrivalMode = (typeof arrivalModes)[number];

type Localized = Partial<Record<ArrivalLanguage, string>>;
export type ArrivalHub = { key: string; name: Localized; text: Localized };
export type TransferVehicle = { key: string; name: Localized; priceCents: number; maxPassengers: number; active: boolean };
export type ArrivalSettings = {
  modes: Record<ArrivalMode, { enabled: boolean; hubs: ArrivalHub[] }>;
  transfer: { enabled: boolean; autoFolio: boolean; modes: ArrivalMode[]; vehicles: TransferVehicle[] };
};

// Starting templates; the hotel edits fares, meeting points and links in PMS → Settings → Arrival instructions.
export function defaultArrivalSettings(): ArrivalSettings {
  return {
    modes: {
      port: {
        enabled: true,
        hubs: [
          {
            key: "parikia",
            name: { el: "Λιμάνι Παροικιάς (πλοία από Πειραιά / Ραφήνα)", en: "Parikia port (ferries from Piraeus / Rafina)" },
            text: {
              el: "Τα πλοία από Πειραιά και Ραφήνα δένουν στην Παροικιά. Αν έχετε κλείσει transfer, ο οδηγός σας περιμένει στην έξοδο του λιμανιού με πινακίδα «Hotel Corali». Διαφορετικά, η πιάτσα ταξί βρίσκεται δίπλα στην έξοδο του λιμανιού· η διαδρομή για το Πίσω Λιβάδι διαρκεί περίπου 25 λεπτά. Το υπεραστικό λεωφορείο (ΚΤΕΛ) φεύγει από τη στάση του λιμανιού προς Μάρπησσα / Πίσω Λιβάδι.",
              en: "Ferries from Piraeus and Rafina dock at Parikia. If you booked a transfer, your driver waits at the port exit holding a “Hotel Corali” sign. Otherwise, the taxi rank is next to the port exit; the ride to Pisso Livadi takes about 25 minutes. The public bus (KTEL) leaves from the port stop towards Marpissa / Pisso Livadi.",
            },
          },
          {
            key: "pisso_livadi",
            name: { el: "Λιμανάκι Πίσω Λιβαδίου (τοπικά σκάφη)", en: "Pisso Livadi harbour (local boats)" },
            text: {
              el: "Το ξενοδοχείο απέχει λίγα λεπτά με τα πόδια από το λιμανάκι. Ακολουθήστε τον παραλιακό δρόμο και καλέστε μας αν χρειάζεστε βοήθεια με τις αποσκευές (υπάρχουν περίπου 50 σκαλοπάτια).",
              en: "The hotel is a few minutes’ walk from the harbour. Follow the seafront road and call us if you need help with your luggage (there are about 50 steps).",
            },
          },
        ],
      },
      airport: {
        enabled: true,
        hubs: [
          {
            key: "paros_airport",
            name: { el: "Αεροδρόμιο Πάρου (PAS)", en: "Paros airport (PAS)" },
            text: {
              el: "Με transfer: ο οδηγός σας περιμένει στις αφίξεις με πινακίδα «Hotel Corali». Χωρίς transfer: ταξί διατίθενται έξω από τον τερματικό σταθμό· η διαδρομή για το Πίσω Λιβάδι διαρκεί περίπου 25 λεπτά.",
              en: "With a transfer: your driver meets you in arrivals with a “Hotel Corali” sign. Without one: taxis wait outside the terminal; the ride to Pisso Livadi takes about 25 minutes.",
            },
          },
          {
            key: "athens_airport",
            name: { el: "Αεροδρόμιο Αθηνών (ATH) → πλοίο", en: "Athens airport (ATH) → ferry" },
            text: {
              el: "Από το αεροδρόμιο Αθηνών μπορείτε να πάτε στο λιμάνι της Ραφήνας (λεωφορείο ή ταξί, κοντινότερη επιλογή) ή στον Πειραιά (μετρό / λεωφορείο express). Αφήστε αρκετό χρόνο πριν την αναχώρηση του πλοίου. Στην Πάρο ακολουθήστε τις οδηγίες για το λιμάνι της Παροικιάς.",
              en: "From Athens airport you can reach Rafina port (bus or taxi, the closest option) or Piraeus (metro / express bus). Allow plenty of time before your ferry departs. On Paros, follow the Parikia port instructions.",
            },
          },
        ],
      },
      car: {
        enabled: true,
        hubs: [
          {
            key: "self_drive",
            name: { el: "Ενοικιαζόμενο / δικό σας αυτοκίνητο", en: "Rental car / own car" },
            text: {
              el: "Από την Παροικιά ακολουθήστε τον κεντρικό δρόμο προς Μάρπησσα και στη συνέχεια τις πινακίδες για Πίσω Λιβάδι. Στάθμευση: ενημερώστε μας για τη διαθεσιμότητα θέσεων κοντά στο ξενοδοχείο. Σύνδεσμος GPS: [προσθέστε τον σύνδεσμο Google Maps του ξενοδοχείου].",
              en: "From Parikia follow the main road towards Marpissa, then the signs for Pisso Livadi. Parking: ask us about spaces near the hotel. GPS link: [add the hotel’s Google Maps link].",
            },
          },
        ],
      },
      taxi: {
        enabled: true,
        hubs: [
          {
            key: "taxi_bus",
            name: { el: "Ταξί / λεωφορείο", en: "Taxi / public bus" },
            text: {
              el: "Ταξί: ζητήστε Πίσω Λιβάδι, Hotel Corali. Η τιμή εξαρτάται από την ώρα και τις αποσκευές· ρωτήστε τον οδηγό πριν ξεκινήσετε. Λεωφορείο (ΚΤΕΛ Πάρου): κατεβείτε στη στάση Πίσω Λιβάδι.",
              en: "Taxi: ask for Pisso Livadi, Hotel Corali. The fare depends on time and luggage; confirm it with the driver before you set off. Bus (KTEL Paros): get off at the Pisso Livadi stop.",
            },
          },
        ],
      },
    },
    transfer: {
      enabled: true,
      autoFolio: true,
      modes: ["port", "airport"],
      vehicles: [
        { key: "sedan", name: { el: "Sedan (έως 3 άτομα)", en: "Sedan (up to 3 guests)" }, priceCents: 3500, maxPassengers: 3, active: true },
        { key: "minivan", name: { el: "Minivan (έως 7 άτομα)", en: "Minivan (up to 7 guests)" }, priceCents: 6000, maxPassengers: 7, active: true },
      ],
    },
  };
}

const keyRe = /^[a-z0-9_]{1,40}$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
function localized(v: unknown, max: number): Localized {
  const out: Localized = {};
  if (v && typeof v === "object") for (const l of arrivalLanguages) { const s = str((v as Record<string, unknown>)[l], max); if (s) out[l] = s; }
  return out;
}

/** Validate stored or submitted settings; anything missing falls back to the defaults. */
export function normalizeArrivalSettings(raw: unknown): ArrivalSettings {
  const base = defaultArrivalSettings();
  let value = raw;
  if (typeof raw === "string") { try { value = JSON.parse(raw || "{}"); } catch { value = {}; } }
  if (!value || typeof value !== "object") return base;
  const v = value as Record<string, unknown>;
  const modesIn = (v.modes ?? {}) as Record<string, unknown>;
  for (const mode of arrivalModes) {
    const m = modesIn[mode] as { enabled?: unknown; hubs?: unknown } | undefined;
    if (!m) continue;
    const hubs = Array.isArray(m.hubs)
      ? m.hubs.flatMap((h: Record<string, unknown>) => (h && keyRe.test(String(h.key)) ? [{ key: String(h.key), name: localized(h.name, 120), text: localized(h.text, 3000) }] : [])).slice(0, 12)
      : base.modes[mode].hubs;
    const unique = hubs.filter((h, i) => hubs.findIndex((x) => x.key === h.key) === i);
    base.modes[mode] = { enabled: m.enabled !== false, hubs: unique };
  }
  const t = v.transfer as Record<string, unknown> | undefined;
  if (t && typeof t === "object") {
    const vehicles = Array.isArray(t.vehicles)
      ? t.vehicles.flatMap((x: Record<string, unknown>) => {
          const price = Number(x?.priceCents), pax = Number(x?.maxPassengers);
          return x && keyRe.test(String(x.key)) && Number.isInteger(price) && price >= 0 && price <= 1_000_000 && Number.isInteger(pax) && pax >= 1 && pax <= 60
            ? [{ key: String(x.key), name: localized(x.name, 80), priceCents: price, maxPassengers: pax, active: x.active !== false }]
            : [];
        }).slice(0, 12)
      : base.transfer.vehicles;
    base.transfer = {
      enabled: t.enabled !== false,
      autoFolio: t.autoFolio !== false,
      modes: Array.isArray(t.modes) ? arrivalModes.filter((m) => (t.modes as unknown[]).includes(m)) : base.transfer.modes,
      vehicles: vehicles.filter((x, i) => vehicles.findIndex((y) => y.key === x.key) === i),
    };
  }
  return base;
}

/** Text in the guest's language, falling back to English, then Greek. */
export function pick(value: Localized, lang: string): string {
  return value[lang as ArrivalLanguage] || value.en || value.el || "";
}

/** Guest-facing options (names only) for the pre-check-in form. */
export function arrivalOptions(settings: ArrivalSettings, lang: string) {
  return {
    modes: arrivalModes.filter((m) => settings.modes[m].enabled && settings.modes[m].hubs.length).map((mode) => ({
      mode,
      hubs: settings.modes[mode].hubs.map((h) => ({ key: h.key, name: pick(h.name, lang) || h.key })),
      transfer: settings.transfer.enabled && settings.transfer.modes.includes(mode),
    })),
    vehicles: settings.transfer.enabled ? settings.transfer.vehicles.filter((v) => v.active).map((v) => ({ key: v.key, name: pick(v.name, lang) || v.key, priceCents: v.priceCents, maxPassengers: v.maxPassengers })) : [],
  };
}

export function arrivalInstructions(settings: ArrivalSettings, mode: string, hub: string, lang: string): { hubName: string; text: string } | null {
  const m = settings.modes[mode as ArrivalMode];
  const h = m?.enabled ? m.hubs.find((x) => x.key === hub) : undefined;
  return h ? { hubName: pick(h.name, lang) || h.key, text: pick(h.text, lang) } : null;
}

export type TransferProblem = "TRANSFER_DISABLED" | "TRANSFER_NOT_FOR_MODE" | "VEHICLE_UNAVAILABLE" | "VEHICLE_TOO_SMALL";

/** Fixed price for a transfer request, or why it cannot be ordered. */
export function transferQuote(settings: ArrivalSettings, input: { mode: string; vehicle: string; passengers: number }): { ok: true; vehicle: TransferVehicle } | { ok: false; error: TransferProblem } {
  if (!settings.transfer.enabled) return { ok: false, error: "TRANSFER_DISABLED" };
  if (!settings.transfer.modes.includes(input.mode as ArrivalMode)) return { ok: false, error: "TRANSFER_NOT_FOR_MODE" };
  const vehicle = settings.transfer.vehicles.find((v) => v.key === input.vehicle && v.active);
  if (!vehicle) return { ok: false, error: "VEHICLE_UNAVAILABLE" };
  if (input.passengers > vehicle.maxPassengers) return { ok: false, error: "VEHICLE_TOO_SMALL" };
  return { ok: true, vehicle };
}
