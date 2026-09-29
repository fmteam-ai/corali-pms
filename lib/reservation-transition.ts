export type ReservationAction = "move" | "check_in" | "check_out" | "cancel" | "confirm" | "no_show";

export function validReservationTransition(status: string, action: ReservationAction): boolean {
  switch (action) {
    case "move": return status === "confirmed" || status === "checked_in";
    case "check_in": return status === "confirmed";
    case "check_out": return status === "checked_in";
    case "cancel": return status === "confirmed";
    case "no_show": return status === "confirmed";
    case "confirm": return status === "cancelled";
  }
}
