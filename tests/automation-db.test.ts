import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
test("automation settings, deliveries and balance links persist with unique event/channel",async()=>{
 const db=new PGlite();try{await db.exec(await readFile(new URL("../server/postgres-schema.sql",import.meta.url),"utf8"));const now=Date.now();
 const booking=await db.query<{id:number}>(`INSERT INTO bookings(owner_id,reference,guest_name,guest_email,check_in,check_out,total_cents,balance_cents,created_at) VALUES('hotel-corali','CR-TEST-1','Test Guest','test@example.com','2026-10-01','2026-10-05',25000,12500,$1) RETURNING id`,[now]);const id=booking.rows[0].id;
 await db.query(`INSERT INTO message_automation_settings(owner_id,enabled,email_enabled,whatsapp_enabled,checkin_days_before,balance_days_before_checkout,review_days_after_checkout,send_hour,review_url,events_json,templates_json,updated_at) VALUES('hotel-corali',1,1,0,3,1,2,10,'','{}','{}',$1)`,[now]);
 const insert=`INSERT INTO message_deliveries(owner_id,booking_id,event_key,channel,scheduled_at,status,created_at,updated_at) VALUES('hotel-corali',$1,'balance','email',$2,'pending',$2,$2) ON CONFLICT(owner_id,booking_id,event_key,channel) DO NOTHING RETURNING id`;
 assert.equal((await db.query(insert,[id,now])).rowCount,1);assert.equal((await db.query(insert,[id,now])).rowCount,0);
 await db.query(`INSERT INTO balance_payment_links(owner_id,booking_id,token_hash,token_encrypted,status,expires_at,created_at) VALUES('hotel-corali',$1,'hash-only-test','v1.placeholder.placeholder.placeholder','active',$2,$3)`,[id,now+86400000,now]);
 const r=await db.query<{balance_cents:number;event_key:string;checkin_days_before:number}>(`SELECT b.balance_cents,l.status,d.event_key,s.checkin_days_before FROM bookings b JOIN balance_payment_links l ON l.booking_id=b.id JOIN message_deliveries d ON d.booking_id=b.id JOIN message_automation_settings s ON s.owner_id=b.owner_id WHERE b.id=$1`,[id]);assert.equal(Number(r.rows[0].balance_cents),12500);assert.equal(r.rows[0].event_key,"balance");assert.equal(Number(r.rows[0].checkin_days_before),3);
 }finally{await db.close()}
});
