import { redirect } from "next/navigation";

/** v94 address of the housekeeping phone page; now part of the Corali Staff app. */
export default function OldHousekeepingPhonePage() {
  redirect("/staff?tab=housekeeping");
}
