import { amenityIcon, amenityName } from "@/lib/amenity-icons";
import { differenceInCalendarDays, eachDayOfInterval, parseISO, subDays } from "date-fns";
import { db } from "@/lib/db";
import {rateNames,type BookingLanguage} from "@/lib/booking-i18n";
import { priceForRoomTotals } from "@/lib/room-pricing";
import { chargeMode } from "@/lib/climate-fee";
import { cardAmenities, cardImages } from "@/lib/room-card";
import { requiredMinStay, type MinStayRule } from "@/lib/min-stay";
import { nightlyPrice, ruleTarget } from "@/lib/season-rates";
import { DEFAULT_DIRECT_DISCOUNT_PERCENT, couponProblem, normalizeCouponCode, planPricing, priceWithOffers, type Coupon, type CouponProblem } from "@/lib/direct-pricing";
import { hotelToday } from "@/lib/tape-chart";
import { applyOffer, bestOfferSet, combines, isPromotion, offerCoversNight, offerValue, offerFitsStay, promotionText, type Offer } from "@/lib/offers";

type Lang = BookingLanguage;
export type AvailabilityInput = { ownerId:string; checkIn:string; checkOut:string; adults:number; children:number; rooms:number; lang:Lang; couponCode?:string|null; guestEmail?:string|null; excludeBookingId?:number|null };

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
/** Share of the amount paid refunded on a cancellation in time: 0 for non-refundable, the plan's % (partly refundable), else 100. */
export function refundPercentOf(planKey:string,value:unknown){if(planKey==="non_refundable")return 0;const n=Number(value);return value===null||value===undefined||value===""||!Number.isFinite(n)?100:Math.max(0,Math.min(100,Math.trunc(n)))}

export async function publicAvailability(input:AvailabilityInput){
  const nights=differenceInCalendarDays(parseISO(input.checkOut),parseISO(input.checkIn));
  if(nights<1||nights>60) throw new Error("INVALID_DATES");
  const dates=eachDayOfInterval({start:parseISO(input.checkIn),end:subDays(parseISO(input.checkOut),1)}).map(d=>d.toISOString().slice(0,10));
  const couponCode=normalizeCouponCode(input.couponCode);
  const [rooms,plans,policies,extras,charges,rules,specials,restrictions,revenue,couponRows]=await Promise.all([
    db().query(`SELECT r.id,r.code,r.room_type,r.capacity,r.description,r.base_rate_cents,r.amenities,r.images,(SELECT COALESCE(json_agg(json_build_object('icon',a.icon,'el',a.name_el,'en',a.name_en,'tr',a.name_translations_json) ORDER BY a.display_order,a.id),'[]'::json) FROM room_amenity_assignments x JOIN room_amenities a ON a.id=x.amenity_id AND a.owner_id=r.owner_id AND a.active=1 WHERE x.room_id=r.id) AS amenity_list,c.name_el,c.name_en,c.description_el,c.description_en,c.name_translations_json,c.description_translations_json
      FROM rooms r LEFT JOIN room_categories c ON c.id=r.category_id AND c.owner_id=r.owner_id
      WHERE r.owner_id=$1 AND r.active=1 AND r.operational_status<>'out_of_order' AND r.capacity >= $4
      AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.owner_id=r.owner_id AND b.room_id=r.id AND b.id<>$6 AND b.status NOT IN ('cancelled','checked_out','no_show') AND b.check_in<$3 AND b.check_out>$2)
      AND NOT EXISTS(SELECT 1 FROM booking_sessions s WHERE s.owner_id=r.owner_id AND s.status='payment_pending' AND s.recovery_due_at>$5 AND s.check_in<$3 AND s.check_out>$2 AND s.room_allocations::jsonb @> jsonb_build_array(r.id))
      ORDER BY COALESCE(c.display_order,999),r.code`,[input.ownerId,input.checkIn,input.checkOut,Math.ceil((input.adults+input.children)/input.rooms),Date.now(),input.excludeBookingId??0]),
    db().query(`SELECT plan_key,name,name_translations_json,adjustment_percent,payment_policy,deposit_percent,balance_mode,balance_days_before,full_prepayment,cancellation_days,refund_percent FROM rate_plans WHERE owner_id=$1 AND active=1 ORDER BY CASE plan_key WHEN 'flexible' THEN 1 WHEN 'direct_web' THEN 2 ELSE 3 END`,[input.ownerId]),
    db().query(`SELECT start_date,end_date,free_cancellation_days FROM cancellation_policies WHERE owner_id=$1 AND start_date<=$2 AND end_date>=$2 ORDER BY updated_at DESC LIMIT 1`,[input.ownerId,input.checkIn]),
    db().query(`SELECT id,code,name,name_el,name_en,description,description_el,description_en,name_translations_json,description_translations_json,price_cents,pricing_mode FROM extras WHERE owner_id=$1 AND active=1 ORDER BY sort_order,id`,[input.ownerId]),
    db().query(`SELECT id,name,name_el,name_en,name_translations_json,category,amount_cents,calculation_mode FROM mandatory_charges WHERE owner_id=$1 AND active=1 AND (valid_from IS NULL OR valid_from<=$3) AND (valid_to IS NULL OR valid_to>=$2) ORDER BY id`,[input.ownerId,input.checkIn,input.checkOut]),
    db().query(`SELECT id,room_type,room_codes,weekdays,active,updated_at,starts_on,ends_on,price_cents,minimum_stay,maximum_stay,closed,closed_to_arrival,closed_to_departure FROM rate_rules WHERE owner_id=$1 AND active=1 AND starts_on<$3 AND ends_on>=$2 ORDER BY id`,[input.ownerId,input.checkIn,input.checkOut]),
    db().query(`SELECT name,starts_on,ends_on,adjustment_type,adjustment_value,operation,weekdays,room_codes,rate_plan_keys,minimum_stay,priority,promotion,promotion_text_json,last_minute_days,min_advance_days,checkin_in_season,round_integer,nights_overrides_json,combine_offers,combine_plan,combine_direct,combine_coupons FROM special_prices WHERE owner_id=$1 AND active=1 AND starts_on<$3 AND ends_on>=$2 ORDER BY priority,id`,[input.ownerId,input.checkIn,input.checkOut]),
    db().query(`SELECT starts_on,ends_on,minimum_stay,maximum_stay,closed_arrival_weekdays,closed_departure_weekdays,room_codes,rate_plan_keys,priority FROM booking_restrictions WHERE owner_id=$1 AND active=1 AND starts_on<$3 AND ends_on>=$2 ORDER BY priority,id`,[input.ownerId,input.checkIn,input.checkOut]),
    db().query(`SELECT direct_discount_percent,direct_discount_active FROM revenue_settings WHERE owner_id=$1 LIMIT 1`,[input.ownerId]),
    couponCode?db().query(`SELECT c.*,(SELECT count(*)::int FROM booking_sessions s WHERE s.owner_id=c.owner_id AND s.coupon_code=c.code AND s.status='payment_pending' AND s.recovery_due_at>$3) AS pending_uses FROM coupons c WHERE c.owner_id=$1 AND upper(c.code)=$2 LIMIT 1`,[input.ownerId,couponCode,Date.now()]):Promise.resolve({rows:[]}),
  ]);
  const cancellationDays=Number(policies.rows[0]?.free_cancellation_days??7);
  const settings=revenue.rows[0];
  const directPercent=settings?(Number(settings.direct_discount_active)===1?Number(settings.direct_discount_percent):0):DEFAULT_DIRECT_DISCOUNT_PERCENT;
  const couponRow=couponRows.rows[0] as (Coupon&{pending_uses:number})|undefined;
  const problem:CouponProblem|null=couponCode?couponProblem(couponRow,{today:hotelToday(),email:input.guestEmail,pendingUses:Number(couponRow?.pending_uses??0),checkIn:input.checkIn,checkOut:input.checkOut}):null;
  const coupon=couponCode&&!problem?couponRow:null;
  let couponUsed=false;
  const planRows=plans.rows.length?plans.rows:[{plan_key:"flexible",name:"Flexible",adjustment_percent:0,payment_policy:"flexible"}];
  const localized=(value:unknown,el:unknown,en:unknown,fallback:unknown)=>translatedText(value,input.lang,el,en,fallback);
  const planName=(key:string,fallback:string,translations:unknown)=>localized(translations,rateNames.el[key],rateNames[input.lang][key]||rateNames.en[key],fallback);
  // Offers whose stay-level conditions hold (min nights, last-minute / early-booking window, arrival within the period).
  const stayOffers=(specials.rows as Offer[]).filter(o=>offerFitsStay(o,{checkIn:input.checkIn,nights,today:hotelToday()}));
  const grouped=new Map<string,typeof rooms.rows>(); for(const row of rooms.rows){const key=String(row.room_type);grouped.set(key,[...(grouped.get(key)??[]),row])}
  // Minimum stay per room category, judged on the check-in date; rooms hidden for it are reported so the guest knows why.
  const minStayRows=(await db().query(`SELECT id,room_type,starts_on,ends_on,min_nights,active,updated_at FROM min_stay_rules WHERE owner_id=$1 AND active=1`,[input.ownerId])).rows as MinStayRule[];
  const minStayNotices:{roomType:string;name:string;minNights:number}[]=[];
  const available=[...grouped.entries()].filter(([roomType,list])=>{if(list.length<input.rooms)return false;const need=requiredMinStay(minStayRows,input.checkIn,roomType);if(nights<need){const first=list[0];minStayNotices.push({roomType,name:localized(first.name_translations_json,first.name_el,first.name_en,roomType),minNights:need});return false}return true}).map(([roomType,list])=>{
    // A room without a base price (0 €, e.g. added in the PMS without one) takes its category's price, so booking
    // several rooms never adds a free room to the total; a category with no price at all is not offered.
    const typeBaseCents=Math.max(0,...list.map(r=>Number(r.base_rate_cents)||0));
    const roomBase=(r:{base_rate_cents:unknown})=>Number(r.base_rate_cents)>0?Number(r.base_rate_cents):typeBaseCents;
    const selectedRooms=list.slice(0,input.rooms),room=selectedRooms[0],arrivalDow=parseISO(input.checkIn).getUTCDay(),departureDow=parseISO(input.checkOut).getUTCDay();
    const plansForRoom=planRows.flatMap(p=>{
      const pricing=planPricing(p.plan_key,Number(p.adjustment_percent),directPercent);
      const planDiscount=pricing.adjustmentPercent<0,directDiscount=pricing.directPercent>0;
      type Promo={text:string;percent:number|null;amountCents:number|null};
      // Room totals for this plan with the offers that pass `skip`; also which discounts the applied offers exclude.
      const totals=(skip:(o:Offer)=>boolean)=>{
        let restricted=false,unpriced=false,noPlan=false,noDirect=false,couponExclusive=false;
        const promos=new Map<string,Promo>(),nonPromoTotals:number[]=[];
        const roomTotals=selectedRooms.map(selected=>{
          let base=0,nonPromoBase=0;
          for(const date of dates){
            const rule=rules.rows.filter(r=>ruleTarget(r,roomType,selected.code)>0&&r.starts_on<=date&&r.ends_on>=date&&(r.minimum_stay!==null||r.maximum_stay!==null||Number(r.closed)===1||Number(r.closed_to_arrival)===1||Number(r.closed_to_departure)===1)).at(-1);
            if(Number(rule?.closed)===1||Number(rule?.minimum_stay??1)>nights||(rule?.maximum_stay&&Number(rule.maximum_stay)<nights)||date===input.checkIn&&Number(rule?.closed_to_arrival)===1||date===dates.at(-1)&&Number(rule?.closed_to_departure)===1)restricted=true;
            const start=money(nightlyPrice(rules.rows,date,roomType,selected.code,roomBase(selected)));if(start<=0)unpriced=true;
            const used=bestOfferSet(start,stayOffers.filter(o=>!skip(o)&&offerCoversNight(o,{date,roomCode:String(selected.code),planKey:p.plan_key})),nights);
            let nightly=start,nonPromo=start;
            for(const offer of used){nightly=applyOffer(nightly,offer,nights);
              if(offer.operation==="discount"){if(!combines(offer,"plan"))noPlan=true;if(!combines(offer,"direct"))noDirect=true;if(!combines(offer,"coupons"))couponExclusive=true}
              if(isPromotion(offer)){const name=String(offer.name??""),value=offerValue(offer,nights);if(!promos.has(name))promos.set(name,{text:promotionText(offer,input.lang),percent:offer.adjustment_type==="fixed"?null:value,amountCents:offer.adjustment_type==="fixed"?Math.trunc(value):null})}
              // Promotional discounts, and offers that exclude promo codes, are left out of the base a non-stackable code applies to.
              else if(combines(offer,"coupons")||offer.operation!=="discount")nonPromo=applyOffer(nonPromo,offer,nights)}
            base+=nightly;nonPromoBase+=nonPromo;
          }
          for(const r of restrictions.rows.filter(r=>r.starts_on<input.checkOut&&r.ends_on>=input.checkIn&&(!jsonArray<string>(r.room_codes).length||jsonArray<string>(r.room_codes).includes(selected.code)))){if(jsonArray<string>(r.rate_plan_keys).length&&!jsonArray<string>(r.rate_plan_keys).includes(p.plan_key))continue;if(Number(r.minimum_stay)>nights||(r.maximum_stay&&Number(r.maximum_stay)<nights)||jsonArray<number>(r.closed_arrival_weekdays).includes(arrivalDow)||jsonArray<number>(r.closed_departure_weekdays).includes(departureDow))restricted=true}
          nonPromoTotals.push(nonPromoBase);
          return base;
        });
        // An applied offer that does not combine with the plan's / direct discount replaces that discount.
        const adjustment=planDiscount&&noPlan?0:pricing.adjustmentPercent,direct=directDiscount&&noDirect?0:pricing.directPercent;
        const offer=priceWithOffers({standardCents:priceForRoomTotals(roomTotals,adjustment),nonPromoStandardCents:priceForRoomTotals(nonPromoTotals,adjustment),directPercent:direct,coupon,couponExclusive});
        // Price before the plan's own discount (e.g. non-refundable −10%) and before promotions, shown struck through so guests see what they save.
        const referenceCents=priceForRoomTotals(nonPromoTotals,Math.max(0,pricing.adjustmentPercent));
        return {restricted,unpriced,promos,offer,referenceCents,adjustment,direct,conflict:(planDiscount&&noPlan)||(directDiscount&&noDirect)};
      };
      let best=totals(()=>false);
      if(best.restricted||best.unpriced)return [];
      // Offers that exclude this plan's discount: the guest gets the cheaper of "offers instead of the discount" and "the discount without those offers".
      if(best.conflict){const without=totals(o=>o.operation==="discount"&&((planDiscount&&!combines(o,"plan"))||(directDiscount&&!combines(o,"direct"))));if(without.offer.totalCents<best.offer.totalCents)best=without}
      const {offer,promos,referenceCents}=best;
      if(offer.couponApplied)couponUsed=true;
      return [{key:p.plan_key,name:planName(p.plan_key,p.name,p.name_translations_json),adjustmentPercent:best.direct?-best.direct:best.adjustment,directPercent:best.direct,paymentPolicy:p.payment_policy,payment:{depositPercent:p.deposit_percent===null||p.deposit_percent===undefined?null:Number(p.deposit_percent),balanceMode:String(p.balance_mode??"general"),balanceDaysBefore:p.balance_days_before===null||p.balance_days_before===undefined?null:Number(p.balance_days_before),fullPrepayment:Number(p.full_prepayment??0)===1},cancellationDays:p.cancellation_days===null||p.cancellation_days===undefined?cancellationDays:Number(p.cancellation_days),refundPercent:refundPercentOf(p.plan_key,p.refund_percent),totalCents:offer.totalCents,standardCents:offer.standardCents,referenceCents:Math.max(referenceCents,offer.standardCents),directCents:offer.directCents,directSavingCents:offer.directSavingCents,couponCents:offer.couponCents,promotions:[...promos].map(([name,x])=>({name,...x}))}];
    });
    return {roomType,roomIds:list.slice(0,input.rooms).map(r=>Number(r.id)),code:room.code,name:localized(room.name_translations_json,room.name_el,room.name_en,roomType),description:list.map(r=>localized(r.description_translations_json,r.description_el,r.description_en,r.description)).find(d=>String(d??"").trim())??"",capacity:Number(room.capacity),amenities:jsonArray<string>(room.amenities),characteristics:cardAmenities<{icon:string;el:string;en:string;tr:string}>(list).map(a=>{let tr:Record<string,string>={};try{tr=JSON.parse(a.tr||"{}")}catch{tr={}}return {icon:amenityIcon(a.icon),name:amenityName({...tr,el:a.el,en:a.en},input.lang)}}),images:cardImages(list),availableCount:list.length,plans:plansForRoom};
  }).filter(r=>r.plans.length>0);
  const extraRows=extras.rows.map(e=>({...e,name:localized(e.name_translations_json,e.name_el,e.name_en,e.name),description:localized(e.description_translations_json,e.description_el,e.description_en,e.description),id:Number(e.id),price_cents:Number(e.price_cents)}));
  const chargeRows=charges.rows.map(c=>{const unit=money(c.amount_cents);const mode=chargeMode(c);const multiplier=mode==="per_night"?nights:mode==="per_room"?input.rooms:mode==="per_person"?(input.adults+input.children):mode==="per_room_night"?input.rooms*nights:1;return {...c,calculation_mode:mode,name:localized(c.name_translations_json,c.name_el,c.name_en,c.name),id:Number(c.id),amount_cents:unit,multiplier,total_cents:unit*multiplier};});
  return {nights,cancellationDays,directDiscountPercent:directPercent,coupon:couponCode?{code:couponCode,problem,applied:couponUsed,combinable:coupon?Number(coupon.combinable)===1:null}:null,rooms:available,minStay:minStayNotices,extras:extraRows,charges:chargeRows};
}
