export type PaidCheckout = {
  mode?:string|null; payment_status?:string|null; currency?:string|null; amount_total?:number|null;
  metadata?:Record<string,string>|null;
};
export type PendingBooking = {id:number;owner_id:string;token:string;status:string;payment_gateway:string;payable_cents:number|null};

export function stripeCheckoutIsPaid(session:PaidCheckout){
  return session.mode==="payment" && session.payment_status==="paid" && session.currency?.toLowerCase()==="eur";
}

export function assertStripeCheckoutMatches(session:PaidCheckout,booking:PendingBooking){
  if(booking.status!=="payment_pending"||booking.payment_gateway!=="stripe")throw new Error("INVALID_BOOKING_STATE");
  if(!stripeCheckoutIsPaid(session))throw new Error("PAYMENT_NOT_CONFIRMED");
  if(session.metadata?.owner_id!==booking.owner_id||session.metadata?.booking_session_id!==String(booking.id)||session.metadata?.token!==booking.token)throw new Error("PAYMENT_METADATA_MISMATCH");
  if(!Number.isSafeInteger(session.amount_total)||!Number.isSafeInteger(booking.payable_cents)||booking.payable_cents===null||Number(session.amount_total)!==Number(booking.payable_cents)||Number(session.amount_total)<=0)throw new Error("PAYMENT_AMOUNT_MISMATCH");
}

export function splitCents(total:number,count:number):number[]{
  if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(count)||count<1||count>20)throw new Error("INVALID_ALLOCATION");
  const base=Math.floor(total/count),remainder=total%count;
  return Array.from({length:count},(_,index)=>base+(index<remainder?1:0));
}
