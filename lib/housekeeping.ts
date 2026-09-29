// Housekeeping workflow rules (pure; unit tested).

/** The 12-point room checklist from the specification. Keys are stored in checklist_json. */
export const housekeepingChecklist = [
  "bed_linens",
  "bathroom",
  "lights",
  "towels_toiletries",
  "floor_balcony",
  "refrigerator",
  "kettle_coffee",
  "tv",
  "air_conditioning",
  "safe_box",
  "wifi_guide",
  "final_inspection",
] as const;
export type ChecklistKey = (typeof housekeepingChecklist)[number];

export const checklistLabels: Record<"el" | "en", Record<ChecklistKey, string>> = {
  el: {
    bed_linens: "Κρεβάτι & λευκά είδη",
    bathroom: "Μπάνιο, βρύσες, καζανάκι, ντους",
    lights: "Φωτισμός & λάμπες",
    towels_toiletries: "Πετσέτες & είδη μπάνιου",
    floor_balcony: "Δάπεδο & μπαλκόνι",
    refrigerator: "Ψυγείο",
    kettle_coffee: "Βραστήρας, φλιτζάνια & καφετιέρα",
    tv: "Τηλεόραση",
    air_conditioning: "Κλιματισμός",
    safe_box: "Χρηματοκιβώτιο",
    wifi_guide: "Wi-Fi / οδηγός QR",
    final_inspection: "Τελικός έλεγχος",
  },
  en: {
    bed_linens: "Bed & linens",
    bathroom: "Bathroom, faucets, flush, shower",
    lights: "Lights & bulbs",
    towels_toiletries: "Towels & toiletries",
    floor_balcony: "Flooring & balcony",
    refrigerator: "Refrigerator",
    kettle_coffee: "Kettle, cups & coffee machine",
    tv: "TV",
    air_conditioning: "Air conditioning",
    safe_box: "Safe box",
    wifi_guide: "Wi-Fi / QR info guide",
    final_inspection: "Final inspection",
  },
};

export function validChecklist(v: unknown): v is Record<ChecklistKey, true> {
  return !!v && typeof v === "object" && !Array.isArray(v) && housekeepingChecklist.every((i) => (v as Record<string, unknown>)[i] === true);
}

export function checklistProgress(v: Record<string, boolean> | undefined): number {
  return housekeepingChecklist.filter((k) => v?.[k] === true).length;
}

/**
 * Task statuses: todo → in_progress → cleaned (inspection pending) → ready.
 * Damage: report_issue (description required; severe = out_of_order) → repair_done by staff → repaired →
 * approve by a different person (dual sign-off) → ready, the room returns to service as dirty for a fresh clean.
 */
export type HousekeepingAction = "start" | "complete" | "approve" | "reject" | "report_issue" | "repair_done";

export function validHousekeepingTransition(status: string, action: HousekeepingAction): boolean {
  switch (action) {
    case "start": return status === "todo";
    case "complete": return status === "in_progress";
    case "approve":
    case "reject": return status === "cleaned" || status === "repaired";
    case "report_issue": return status === "todo" || status === "in_progress";
    case "repair_done": return status === "out_of_order";
  }
}

/** Next task status after an action (severe damage takes the room out of order). */
export function nextHousekeepingStatus(status: string, action: HousekeepingAction, severe = false): string {
  switch (action) {
    case "start": return "in_progress";
    case "complete": return "cleaned";
    case "approve": return "ready";
    case "reject": return status === "repaired" ? "out_of_order" : "in_progress";
    case "report_issue": return severe ? "out_of_order" : status;
    case "repair_done": return "repaired";
  }
}

/** Room operational status after an action, or null when unchanged. */
export function roomStatusAfter(taskStatus: string, action: HousekeepingAction, severe = false): string | null {
  if (action === "report_issue" && severe) return "out_of_order";
  if (action === "approve") return taskStatus === "repaired" ? "dirty" : "clean";
  return null;
}
