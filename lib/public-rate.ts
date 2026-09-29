import { differenceInCalendarDays, eachDayOfInterval, parseISO, subDays } from "date-fns";
import { db } from "@/lib/db";
import {rateNames,type BookingLanguage} from "@/lib/booking-i18n";
import { priceForRoomTotals } from "@/lib/room-pricing";
import { DEFAULT_DIRECT_DISCOUNT_PERCENT, couponProblem, normalizeCouponCode, priceWithOffers, type Coupon, type CouponProblem } from "@/lib/direct-pricing";
import { hotelToday } from "@/lib/tape-chart";

type Lang = BookingLanguage;
export type AvailabilityInput = { ownerId:string; checkIn:string; checkOut:string; adults:number; children:number; rooms:number; lang:Lang; couponCode?:string|null; guestEmail?:string|null };

export function jsonArray<T>(value:unknown):T[]{
  try{const parsed=typeof value==="string"?JSON.parse(value):value;return Array.isArray(parsed)?parsed as T[]:[]}
  catch{return []}
}
export function translatedText(value:unknown,lang:Lang,el:unknown,en:unknown,fallback:unknown):string{
  let translations:unknown=value;
  if(typeof value==="string")try{translations=JSON.parse(value)}catch{translations=null}
  const candidate=translations&&typeof translations==="object"&&!Array.isArray(translations)?(translations as Record<string,unknown>)[lang]:null;
  if(typeof candidate==="string"&&candidate.trim())return candidate.trim();
  return lang==="el"?String(el||en||fallback||""):String(en||fallback||"");
}
function money(value:unknown){return Math.max(0,Number(value)||0)}

export async function publicAvailability(input:AvailabilityInput){
  const nights=differenceInCalendarDays(parseISO(input.checkOut),parseISO(input.checkIn));
  if(nights<1||nights>60) throw new Error("INVALID_DATES");
  const dates=eachDayOfInterval({start:parseISO(input.checkIn),end:subDays(parseISO(input.checkOut),1)}).map(d=>d.toISOString().slice(0,10));
  const couponCode=normalizeCouponCode(input.couponCode);
  const [rooms,plans,policies,extras,charges,rules,specials,restrictions,revenue,couponRows]=await Promise.all([
    db().query(`SELECT r.id,r.code,r.room_type,r.capacity,r.description,r.base_rate_cents,r.amenities,r.images,c.name_el,c.name_en,c.description_el,c.description_en,c.name_translations_json,c.description_translations_json
      FROM rooms r LEFT JOIN room_categories c ON c.id=r.category_id AND c.owner_id=r.owner_id
      WHERE r.owner_id=$1 AND r.active=1 AND r.operational_status<>'out_of_order' AND r.capacity >= $4
      AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.status NOT IN ('cancelled','checked_out','no_show') AND b.check_in<$3 AND b.check_out>$2)
      AND NOT EXISTS(SELECT 1 FROM booking_sessions s WHERE s.owner_id=r.owner_id AND s.status='payment_pending' AND s.recovery_due_at>$5 AND s.check_in<$3 AND s.check_out>$2 AND s.room_allocations::jsonb @> jsonb_build_array(r.id))
      ORDER BY COALESCE(c.display_order,999),r.code`,[input.ownerId,input.checkIn,input.checkOut,Math.ceil((input.adults+input.children)/input.rooms),Date.now()]),
    db().query(`SELECT plan_key,name,name_translations_json,adjustment_percent,payment_policy FROM rate_plans WHERE owner_id=$1 AND active=1 ORDER BY CASE plan_key WHEN 'flexible' THEN 1 WHEN 'direct_web' THEN 2 ELSE 3 END`,[input.ownerId]),
    db().query(`SELECT start_date,end_date,free_cancellation_days FROM cancellation_policies WHERE owner_id=$1 AND start_date<=$2 AND end_date>=$2 ORDER BY updated_at DESC LIMIT 1`,[input.ownerId,input.checkIn]),
    db().query(`SELECT id,code,name,name_el,name_en,description,description_el,description_en,name_translations_json,description_translations_json,price_cents,pricing_mode FROM extras WHERE owner_id=$1 AND active=1 ORDER BY sort_order,id`,[input.ownerId]),
    db().query(`SELECT id,name,name_el,name_en,name_translations_json,category,amount_cents,calculation_mode FROM mandatory_charges WHERE owner_id=$1 AND active=1 AND (valid_from IS NULL OR valid_from<=$3) AND (valid_to IS NULL OR valid_to>=$2) ORDER BY id`,[input.ownerId,input.checkIn,input.checkOut]),
    db().query(`SELECT room_type,starts_on,ends_on,price_cents,minimum_stay,maximum_stay,closed,closed_to_arrival,closed_to_departure FROM rate_rules WHERE owner_id=$1 AND starts_on<$3 AND ends_on>=$2`,[input.ownerId,input.checkIn,input.checkOut]),
    db().query(`SELECT starts_on,ends_on,adjustment_type,adjustment_value,operation,weekdays,room_codes,rate_plan_keys,minimum_stay,priority,promotion FROM special_prices WHERE owner_id=$1 AND active=1 AND starts_on<$3 AND ends_on>=$2 ORDER BY priority,id`,[input.ownerId,input.checkIn,input.checkOut]),
    db().query(`SELECT starts_on,ends_on,minimum_stay,maximum_stay,closed_arrival_weekdays,closed_departure_weekdays,room_codes,rate_plan_keys,priority FROM booking_restrictions WHERE owner_id=$1 AND active=1 AND starts_on<$3 AND ends_on>=$2 ORDER BY priority,id`,[input.ownerId,input.checkIn,input.checkOut]),
    db().query(`SELECT direct_discount_percent,direct_discount_active FROM revenue_settings WHERE owner_id=$1 LIMIT 1`,[input.ownerId]),
    couponCode?db().query(`SELECT c.*,(SELECT count(*)::int FROM booking_sessions s WHERE s.owner_id=c.owner_id AND s.coupon_code=c.code AND s.status='payment_pending' AND s.recovery_due_at>$3) AS pending_uses FROM coupons c WHERE c.owner_id=$1 AND upper(c.code)=$2 LIMIT 1`,[input.ownerId,couponCode,Date.now()]):Promise.resolve({rows:[]}),
  ]);
  const cancellationDays=Number(policies.rows[0]?.free_cancellation_days??7);
  const settings=revenue.rows[0];
  const directPercent=settings?(Number(settings.direct_discount_active)===1?Number(settings.direct_discount_percent):0):DEFAULT_DIRECT_DISCOUNT_PERCENT;
  const couponRow=couponRows.rows[0] as (Coupon&{pending_uses:number})|undefined;
  const problem:CouponProblem|null=couponCode?couponProblem(couponRow,{today:hotelToday(),email:input.guestEmail,pendingUses:Number(couponRow?.pending_uses??0)}):null;
  const coupon=couponCode&&!problem?couponRow:null;
  let couponUsed=false;
  const planRows=plans.rows.length?plans.rows:[{plan_key:"flexible",name:"Flexible",adjustment_percent:0,payment_policy:"flexible"}];
  const localized=(value:unknown,el:unknown,en:unknown,fallback:unknown)=>translatedText(value,input.lang,el,en,fallback);
  const planName=(key:string,fallback:string,translations:unknown)=>localized(translations,rateNames.el[key],rateNames[input.lang][key]||rateNames.en[key],fallback);
  const grouped=new Map<string,typeof rooms.rows>(); for(const row of rooms.rows){const key=String(row.room_type);grouped.set(key,[...(grouped.get(key)??[]),row])}
  const available=[...grouped.entries()].filter(([,list])=>list.length>=input.rooms).map(([roomType,list])=>{
    const selectedRooms=list.slice(0,input.rooms),room=selectedRooms[0],arrivalDow=parseISO(input.checkIn).getUTCDay(),departureDow=parseISO(input.checkOut).getUTCDay();
    const plansForRoom=planRows.flatMap(p=>{
      let restricted=false;
      const nonPromoTotals:number[]=[];
      const roomTotals=selectedRooms.map(selected=>{
        let base=0,nonPromoBase=0;
        for(const date of dates){
          const rule=rules.rows.filter(r=>(!r.room_type||r.room_type===roomType)&&r.starts_on<=date&&r.ends_on>=date).at(-1);
          if(Number(rule?.closed)===1||Number(rule?.minimum_stay??1)>nights||(rule?.maximum_stay&&Number(rule.maximum_stay)<nights)||date===input.checkIn&&Number(rule?.closed_to_arrival)===1||date===dates.at(-1)&&Number(rule?.closed_to_departure)===1)restricted=true;
          let nightly=money(rule?.price_cents??selected.base_rate_cents),nonPromo=nightly;
          const applicable=specials.rows.filter(s=>s.starts_on<=date&&s.ends_on>=date&&Number(s.minimum_stay)<=nights&&(!jsonArray<string>(s.room_codes).length||jsonArray<string>(s.room_codes).includes(selected.code))&&(!jsonArray<string>(s.rate_plan_keys).length||jsonArray<string>(s.rate_plan_keys).includes(p.plan_key))&&(!jsonArray<number>(s.weekdays).length||jsonArray<number>(s.weekdays).includes(parseISO(date).getUTCDay())));
          for(const offer of applicable){const delta=offer.adjustment_type==="percentage"?Math.round(nightly*Math.abs(Number(offer.adjustment_value))/100):Math.abs(Number(offer.adjustment_value));nightly=offer.operation==="discount"?Math.max(0,nightly-delta):nightly+delta;
            // Promotional discounts are left out of the base a non-stackable promo code applies to.
            if(!(Number(offer.promotion)===1&&offer.operation==="discount")){const d2=offer.adjustment_type==="percentage"?Math.round(nonPromo*Math.abs(Number(offer.adjustment_value))/100):Math.abs(Number(offer.adjustment_value));nonPromo=offer.operation==="discount"?Math.max(0,nonPromo-d2):nonPromo+d2}}
          base+=nightly;nonPromoBase+=nonPromo;
        }
        for(const r of restrictions.rows.filter(r=>r.starts_on<input.checkOut&&r.ends_on>=input.checkIn&&(!jsonArray<string>(r.room_codes).length||jsonArray<string>(r.room_codes).includes(selected.code)))){if(jsonArray<string>(r.rate_plan_keys).length&&!jsonArray<string>(r.rate_plan_keys).includes(p.plan_key))continue;if(Number(r.minimum_stay)>nights||(r.maximum_stay&&Number(r.maximum_stay)<nights)||jsonArray<number>(r.closed_arrival_weekdays).includes(arrivalDow)||jsonArray<number>(r.closed_departure_weekdays).includes(departureDow))restricted=true}
        nonPromoTotals.push(nonPromoBase);
        return base;
      });
      if(restricted)return [];
      const offer=priceWithOffers({standardCents:priceForRoomTotals(roomTotals,Number(p.adjustment_percent)),nonPromoStandardCents:priceForRoomTotals(nonPromoTotals,Number(p.adjustment_percent)),directPercent,coupon});
      if(offer.couponApplied)couponUsed=true;
      return [{key:p.plan_key,name:planName(p.plan_key,p.name,p.name_translations_json),adjustmentPercent:Number(p.adjustment_percent),paymentPolicy:p.payment_policy,cancellationDays,totalCents:offer.totalCents,standardCents:offer.standardCents,directCents:offer.directCents,directSavingCents:offer.directSavingCents,couponCents:offer.couponCents}];
    });
    return {roomType,roomIds:list.slice(0,input.rooms).map(r=>Number(r.id)),code:room.code,name:localized(room.name_translations_json,room.name_el,room.name_en,roomType),description:localized(room.description_translations_json,room.description_el,room.description_en,room.description),capacity:Number(room.capacity),amenities:jsonArray<string>(room.amenities),images:jsonArray<string>(room.images),availableCount:list.length,plans:plansForRoom};
  }).filter(r=>r.plans.length>0);
  const extraRows=extras.rows.map(e=>({...e,name:localized(e.name_translations_json,e.name_el,e.name_en,e.name),description:localized(e.description_translations_json,e.description_el,e.description_en,e.description),id:Number(e.id),price_cents:Number(e.price_cents)}));
  const chargeRows=charges.rows.map(c=>{const unit=money(c.amount_cents);const multiplier=c.calculation_mode==="per_night"?nights:c.calculation_mode==="per_room"?input.rooms:c.calculation_mode==="per_person"?(input.adults+input.children):c.calculation_mode==="per_room_night"?input.rooms*nights:1;return {...c,name:localized(c.name_translations_json,c.name_el,c.name_en,c.name),id:Number(c.id),amount_cents:unit,multiplier,total_cents:unit*multiplier};});
  return {nights,cancellationDays,directDiscountPercent:directPercent,coupon:couponCode?{code:couponCode,problem,applied:couponUsed,combinable:coupon?Number(coupon.combinable)===1:null}:null,rooms:available,extras:extraRows,charges:chargeRows};
}
