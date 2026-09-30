// Pre-fill the guest's online check-in from the booking (pure; unit tested).
import { dialCodes } from "./dial-codes.ts";

export function splitGuestName(full: string): { firstName: string; lastName: string } {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1)! };
}

// Main country for calling codes several countries share.
const mainCountry: Record<string, string> = { "1": "US", "7": "RU", "39": "IT", "44": "GB", "47": "NO", "61": "AU", "212": "MA", "262": "RE", "358": "FI", "590": "GP", "599": "CW" };

/** "+49 170 1234567" → { country: "DE", local: "170 1234567" }; prefers the guest's country when codes are shared (e.g. +1). */
export function splitPhone(phone: string, preferredCountry = ""): { country: string; local: string } {
  const raw = String(phone ?? "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  const international = raw.startsWith("+") ? digits : raw.startsWith("00") ? digits.slice(2) : "";
  if (!international) return { country: preferredCountry && dialCodes[preferredCountry] ? preferredCountry : "", local: raw };
  const preferred = preferredCountry && dialCodes[preferredCountry] && international.startsWith(dialCodes[preferredCountry]) ? preferredCountry : "";
  const code = Object.values(dialCodes).filter((d) => international.startsWith(d)).sort((a, b) => b.length - a.length)[0] ?? "";
  const country = preferred || (code ? mainCountry[code] ?? Object.keys(dialCodes).find((c) => dialCodes[c] === code) ?? "" : "");
  if (!country) return { country: "", local: raw };
  const rest = raw.replace(/^(\+|00)\s*/, "").replace(new RegExp(`^${dialCodes[country].split("").join("[\\s-]*")}[\\s-]*`), "");
  return { country, local: rest.trim() };
}
