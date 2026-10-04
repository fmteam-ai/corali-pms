import Stripe from "stripe";
import {z} from "zod";
import {env} from "@/lib/env";
import {db,withTransaction} from "@/lib/db";
import {publicAvailability} from "@/lib/public-rate";
import {getPaymentPolicy} from "@/lib/payment-policy-db";
import {balanceChargeDays,calculatePayment,planPaymentTerms} from "@/lib/payment-policy";
import {bookingText} from "@/lib/booking-i18n";
import {stripeCredentials} from "@/lib/provider-connections";
import {bookingCheckoutParams,cardFeeCents} from "@/lib/stripe-options";

const schema=z.object({checkIn:z.iso.date(),checkOut:z.iso.date(),adults:z.number().int().min(1).max(20),children:z.number().int().min(0).max(20),rooms:z.number().int().min(1).max(10),roomType:z.string().min(1).max(120),roomIds:z.array(z.number().int().positive()).min(1).max(10),ratePlanKey:z.string().min(1).max(50),selectedExtraIds:z.array(z.number().int().positive()).max(30).default([]),language:z.enum(["el","en","fr","de","it","es"]),guestFirstName:z.string().trim().min(1).max(80),guestLastName:z.string().trim().min(1).max(80),guestEmail:z.string().email(),guestPhone:z.string().trim().min(5).max(40),country:z.string().trim().min(2).max(80),specialRequests:z.string().trim().max(500).default(""),accessAcknowledged:z.literal(true),policyAccepted:z.literal(true),whatsappOptIn:z.boolean().default(false),emailMarketingOptIn:z.boolean().default(false),couponCode:z.string().trim().max(40).optional()}).refine(x=>x.roomIds.length===x.rooms&&new Set(x.roomIds).size===x.rooms);

export async function POST(request:Request){
  let bookingSessionId:number|undefined;
  try{
    const c=env(),credentials=await stripeCredentials(c.PMS_OWNER_ID);if(!credentials?.secretKey)return Response.json({ok:false,error:"PAYMENT_NOT_CONFIGURED"},{status:503});
    const i=schema.parse(await request.json());
    const availability=await publicAvailability({ownerId:c.PMS_OWNER_ID,checkIn:i.checkIn,checkOut:i.checkOut,adults:i.adults,children:i.children,rooms:i.rooms,lang:i.language,couponCode:i.couponCode||null,guestEmail:i.guestEmail});
    if(availability.coupon?.problem)return Response.json({ok:false,error:"COUPON_INVALID",reason:availability.coupon.problem},{status:409});
    const room=availability.rooms.find(r=>r.roomType===i.roomType&&i.roomIds.every(id=>r.roomIds.includes(id))),plan=room?.plans.find(p=>p.key===i.ratePlanKey);
    if(!room||!plan)return Response.json({ok:false,error:"ROOM_UNAVAILABLE"},{status:409});
    const selected=availability.extras.filter(x=>i.selectedExtraIds.includes(x.id));
    const extrasCents=selected.reduce((s,x)=>s+x.price_cents*(x.pricing_mode==="per_night"?availability.nights:x.pricing_mode==="per_person"?i.adults+i.children:x.pricing_mode==="per_room"?i.rooms:1),0),baseCharges=availability.charges.reduce((s,x)=>s+x.total_cents,0),feeCents=cardFeeCents(plan.totalCents+extrasCents+baseCharges,credentials.options.fee),chargesCents=baseCharges+Math.max(0,feeCents),total=plan.totalCents+extrasCents+baseCharges+feeCents,policy=await getPaymentPolicy(c.PMS_OWNER_ID),terms=planPaymentTerms(policy,plan.payment,plan.cancellationDays),payment=calculatePayment(total,i.checkIn,terms.policy),token=crypto.randomUUID(),now=Date.now();
    bookingSessionId=await withTransaction(async client=>{
      for(const id of [...i.roomIds].sort((a,b)=>a-b))await client.query("SELECT pg_advisory_xact_lock($1)",[id]);
      for(const id of i.roomIds){
        const conflict=await client.query(`SELECT 1 FROM bookings WHERE owner_id=$1 AND room_id=$2 AND status NOT IN ('cancelled','checked_out','no_show') AND check_in<$4 AND check_out>$3 UNION ALL SELECT 1 FROM booking_sessions WHERE owner_id=$1 AND status='payment_pending' AND recovery_due_at>$5 AND check_in<$4 AND check_out>$3 AND room_allocations::jsonb @> $6::jsonb LIMIT 1`,[c.PMS_OWNER_ID,id,i.checkIn,i.checkOut,now,JSON.stringify([id])]);
        if(conflict.rowCount)throw new Error("ROOM_UNAVAILABLE");
      }
      const inserted=await client.query(`INSERT INTO booking_sessions(owner_id,token,guest_first_name,guest_last_name,guest_email,guest_phone,country,check_in,check_out,guests,children,rooms_count,room_allocations,room_key,rate_policy,payment_gateway,special_requests,access_acknowledged,policy_accepted_at,selected_extra_ids,room_subtotal_cents,extras_cents,charges_cents,charge_breakdown,total_cents,status,recovery_due_at,created_at,updated_at,language,payable_cents,whatsapp_opt_in,email_marketing_opt_in,coupon_code,balance_charge_days,cancellation_days,refund_percent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'stripe',$16,1,$17,$18,$19,$20,$21,$22,$23,'payment_pending',$24,$17,$17,$25,$26,$27,$28,$29,$30,$31,$32) RETURNING id`,[c.PMS_OWNER_ID,token,i.guestFirstName,i.guestLastName,i.guestEmail,i.guestPhone,i.country,i.checkIn,i.checkOut,i.adults,i.children,i.rooms,JSON.stringify(i.roomIds),i.roomType,i.ratePlanKey,i.specialRequests,now,JSON.stringify(i.selectedExtraIds),plan.totalCents,extrasCents,chargesCents,JSON.stringify(feeCents>0?[...availability.charges,{name:"Χρέωση επεξεργασίας κάρτας / Card processing fee",category:"card_fee",total_cents:feeCents}]:availability.charges),total,now+31*60_000,i.language,payment.payableNowCents,i.whatsappOptIn?1:0,i.emailMarketingOptIn?1:0,availability.coupon?.applied?availability.coupon.code:null,balanceChargeDays(terms),plan.cancellationDays,plan.refundPercent]);
      return Number(inserted.rows[0].id);
    });
    // Deposit bookings keep the card (with the guest informed) so the balance can be collected before arrival.
    const saveCard=payment.balanceCents>0&&terms.autoChargeDays!==null;
    const stripe=new Stripe(credentials.secretKey);
    const o=credentials.options,meta={...o.metadata,booking_session_id:String(bookingSessionId),owner_id:c.PMS_OWNER_ID,token};
    const product={name:`${o.companyName} · ${room.name} · ${i.checkIn}–${i.checkOut}`,...(o.imageUrl?{images:[o.imageUrl]}:{})};
    const common={expires_at:Math.floor((now+31*60_000)/1000),success_url:`${c.BOOKING_ORIGIN}/book?payment=success`,cancel_url:`${c.BOOKING_ORIGIN}/book?payment=cancelled`,metadata:meta};
    let session:Stripe.Checkout.Session;
    if(o.paymentType==="off_session"){
      // Card guarantee only: no charge now, the card is saved for charges from the PMS (and automatic balance collection).
      const customer=await stripe.customers.create({email:i.guestEmail,name:`${i.guestFirstName} ${i.guestLastName}`,metadata:{owner_id:c.PMS_OWNER_ID}});
      session=await stripe.checkout.sessions.create({...common,mode:"setup",currency:"eur",customer:customer.id,...(o.automaticMethods?{}:{payment_method_types:["card"]}),setup_intent_data:{metadata:{...o.metadata,booking_session_id:String(bookingSessionId),owner_id:c.PMS_OWNER_ID}},custom_text:{submit:{message:bookingText[i.language].cardGuarantee.replaceAll("{gateway}","Stripe")}}});
    }else{
      const params=bookingCheckoutParams(o,saveCard);
      const message=o.paymentType==="authorization"?bookingText[i.language].cardHold:saveCard?bookingText[i.language].balanceAutoCharge.replace("{days}",String(terms.autoChargeDays)):null;
      session=await stripe.checkout.sessions.create({...common,...params,mode:"payment",customer_email:i.guestEmail,line_items:[{quantity:1,price_data:{currency:"eur",unit_amount:payment.payableNowCents,product_data:product}}],payment_intent_data:{...params.payment_intent_data,description:product.name,metadata:{...o.metadata,booking_session_id:String(bookingSessionId),owner_id:c.PMS_OWNER_ID}},...(message?{custom_text:{submit:{message}}}:{})});
    }
    return Response.json({ok:true,url:session.url,payNowCents:credentials.options.paymentType==="capture"?payment.payableNowCents:0,totalCents:total});
  }catch(e){
    if(bookingSessionId)await db().query("UPDATE booking_sessions SET status='payment_creation_failed',updated_at=$1 WHERE id=$2",[Date.now(),bookingSessionId]).catch(()=>undefined);
    if(e instanceof z.ZodError)return Response.json({ok:false,error:"INVALID_INPUT",issues:e.issues},{status:400});
    if(e instanceof Error&&e.message==="ROOM_UNAVAILABLE")return Response.json({ok:false,error:"ROOM_UNAVAILABLE"},{status:409});
    console.error("checkout creation failed",e);return Response.json({ok:false,error:"CHECKOUT_FAILED"},{status:500});
  }
}
