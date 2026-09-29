/** Search terms for reservations: free text plus the digits of a phone number (at least 3 digits). */
export function reservationSearchTerms(query: string): { text: string; digits: string; room: string } {
  const trimmed = query.trim();
  const digits = trimmed.replace(/\D/g, "");
  return { text: trimmed ? `%${trimmed.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : "%%", digits: digits.length >= 3 ? `%${digits}%` : "", room: trimmed };
}
