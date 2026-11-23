// v193 Guest experience in the PMS: Comfort Score of occupied rooms, Verified Room Turnover after check-out, and the
// root causes behind recurring requests and lower ratings.
import { db } from "@/lib/db";
import { comfortBoard, saveComfortPolicy } from "../scripts/comfort-core.mjs";
import { confirmEquipment, turnoverBoard, verifyTurnover } from "../scripts/turnover-core.mjs";
import { actOnFinding, rootCauses } from "../scripts/root-cause-core.mjs";

export async function guestExperience(ownerId: string) {
  const [comfort, turnover, causes] = await Promise.all([
    comfortBoard({ pool: db(), owner: ownerId }),
    turnoverBoard({ pool: db(), owner: ownerId }),
    rootCauses({ pool: db(), owner: ownerId }),
  ]);
  return { comfort, turnover, causes };
}
export type GuestExperience = Awaited<ReturnType<typeof guestExperience>>;

export const equipmentChecked = (ownerId: string, bookingId: number, roomId: number, by: string, note: string) => confirmEquipment({ pool: db(), owner: ownerId, bookingId, roomId, by, note });
export const turnoverVerified = (ownerId: string, bookingId: number, by: string) => verifyTurnover({ pool: db(), owner: ownerId, bookingId, by });
export const findingAction = (ownerId: string, key: string, action: "maintenance" | "dismiss", userId: number, reason: string) => actOnFinding({ pool: db(), owner: ownerId, key, action, userId, reason });
export const comfortPolicySaved = (ownerId: string, settings: unknown, by: string) => saveComfortPolicy({ pool: db(), owner: ownerId, settings, by });
