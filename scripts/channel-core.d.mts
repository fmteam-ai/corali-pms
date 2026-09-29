export declare const CHANNEX_HOSTS: { staging: string; production: string };
export declare function availabilityRanges(days: { date: string; available: number }[]): { date_from: string; date_to: string; availability: number }[];
export declare function sellable(free: number): number;
export type NormalizedRevision = { revisionId: string; bookingId: string; status: "new" | "modified" | "cancelled"; channel: string; reference: string; currency: string; paymentCollect: "ota" | "property"; guestName: string; guestEmail: string | null; guestPhone: string; guestCountry: string; guestLanguage: string; notes: string; rooms: { roomType: string | null; externalRoomTypeId: string | null; checkIn: string; checkOut: string; adults: number; children: number; totalCents: number }[] };
export declare function normalizeRevision(revision: unknown, roomTypeByExternalId: Record<string, string>): NormalizedRevision;
