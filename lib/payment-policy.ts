const dayMs=86400000;
export type PaymentPolicy={fullPayment:boolean;depositPercent:number;balanceDueDays:number;fullPaymentWindowActive:boolean;fullPaymentDaysBeforeArrival:number};
export type PaymentCalculation={mode:"full"|"deposit";payableNowCents:number;balanceCents:number;daysUntilArrival:number};
function utc(v:string|Date){const d=typeof v==="string"?new Date(`${v}T00:00:00Z`):v;if(Number.isNaN(d.getTime()))throw Error("INVALID_DATE");return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())}
/** Bookings made less than this many days before arrival always pay the whole amount at booking, on every plan. */
export const LAST_MINUTE_FULL_PAYMENT_DAYS=7;
export function calculatePayment(total:number,checkIn:string,p:PaymentPolicy,now=new Date()):PaymentCalculation{if(!Number.isInteger(total)||total<0)throw Error("INVALID_TOTAL");const days=Math.ceil((utc(checkIn)-utc(now))/dayMs);const full=p.fullPayment||days<LAST_MINUTE_FULL_PAYMENT_DAYS||(p.fullPaymentWindowActive&&days>=0&&days<=p.fullPaymentDaysBeforeArrival);const pay=full?total:Math.min(total,Math.round(total*p.depositPercent/100));return{mode:full?"full":"deposit",payableNowCents:pay,balanceCents:total-pay,daysUntilArrival:days}}

/** Per rate plan (cancellation policy) payment terms; empty values fall back to the general policy. */
export type BalanceMode = "general" | "cancellation_deadline" | "days_before" | "at_hotel";
export type PlanPayment = { depositPercent: number | null; balanceMode: BalanceMode | string; balanceDaysBefore: number | null; fullPrepayment: boolean };
export type PlanTerms = { policy: PaymentPolicy; autoChargeDays: number | null; atHotel: boolean; fullPrepayment: boolean };

/**
 * Resolve how a booking on this plan is paid: deposit % now and when the balance is taken.
 * - full prepayment: everything at booking (e.g. non-refundable)
 * - cancellation_deadline: balance charged automatically when free cancellation ends
 * - days_before: balance charged automatically N days before arrival
 * - at_hotel: deposit online, balance paid at the hotel
 * Inside the charge window the whole amount is taken at booking.
 */
export function planPaymentTerms(general: PaymentPolicy, plan: Partial<PlanPayment> | null | undefined, cancellationDays: number): PlanTerms {
  const deposit = plan?.depositPercent ?? general.depositPercent;
  if (plan?.fullPrepayment || general.fullPayment) return { policy: { ...general, fullPayment: true, depositPercent: 100 }, autoChargeDays: null, atHotel: false, fullPrepayment: true };
  const mode = plan?.balanceMode ?? "general";
  if (mode === "at_hotel") return { policy: { ...general, depositPercent: deposit, fullPaymentWindowActive: false }, autoChargeDays: null, atHotel: true, fullPrepayment: false };
  if (mode === "cancellation_deadline" || mode === "days_before") {
    const days = Math.max(0, mode === "cancellation_deadline" ? cancellationDays : (plan?.balanceDaysBefore ?? general.fullPaymentDaysBeforeArrival));
    return { policy: { ...general, depositPercent: deposit, fullPaymentWindowActive: true, fullPaymentDaysBeforeArrival: days }, autoChargeDays: days, atHotel: false, fullPrepayment: false };
  }
  const active = general.fullPaymentWindowActive;
  return { policy: { ...general, depositPercent: deposit }, autoChargeDays: active ? general.fullPaymentDaysBeforeArrival : null, atHotel: !active, fullPrepayment: false };
}

/** Value stored on the booking for the balance collection worker: days before arrival, or -1 for "at the hotel". */
export function balanceChargeDays(terms: PlanTerms): number | null {
  if (terms.fullPrepayment) return null;
  return terms.autoChargeDays ?? -1;
}
