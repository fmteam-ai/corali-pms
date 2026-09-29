// Arrival instructions per mode of arrival and hub, plus transfer ordering rules (pure; unit tested).

import { arrivalInstructions, arrivalLanguages, arrivalModes, defaultArrivalSettings, normalizeArrivalSettings, pick } from "../scripts/arrival-core.mjs";

export { arrivalInstructions, arrivalLanguages, arrivalModes, defaultArrivalSettings, normalizeArrivalSettings, pick };
export type ArrivalLanguage = (typeof arrivalLanguages)[number];
export type ArrivalMode = (typeof arrivalModes)[number];

export type Localized = Partial<Record<ArrivalLanguage, string>>;
export type ArrivalHub = { key: string; name: Localized; text: Localized };
export type TransferVehicle = { key: string; name: Localized; priceCents: number; maxPassengers: number; active: boolean };
export type ArrivalSettings = {
  modes: Record<ArrivalMode, { enabled: boolean; hubs: ArrivalHub[] }>;
  transfer: { enabled: boolean; autoFolio: boolean; modes: ArrivalMode[]; vehicles: TransferVehicle[] };
};

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
