import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {createRequire} from "node:module";
import ts from "typescript";
import {PGlite} from "@electric-sql/pglite";

const require=createRequire(import.meta.url);
function moduleFromSource(path:string,dependencies:Record<string,unknown>={}){
  const source=readFileSync(path,"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const exports:Record<string,unknown>={};
  vm.runInNewContext(compiled,{exports,require:(name:string)=>name in dependencies?dependencies[name]:require(name),console,Date,JSON,String,Number,Math,Map,Array},{filename:path});
  return exports;
}

test("public availability serves a room despite legacy JSON null and invalid translations",async()=>{
  const database=new PGlite();
  try{
    await database.exec(readFileSync("server/postgres-schema.sql","utf8"));
    await database.query("INSERT INTO rooms(owner_id,code,room_type,capacity,active,base_rate_cents,operational_status,amenities,images) VALUES($1,'101','double',2,1,10000,'available','null','null')",["hotel-corali"]);
    await database.query("INSERT INTO rate_plans(owner_id,plan_key,name,adjustment_percent,payment_policy,name_translations_json) VALUES($1,'flexible','Flexible',0,'flexible','{\"en\":42}')",["hotel-corali"]);
    await database.query("INSERT INTO special_prices(owner_id,name,starts_on,ends_on,weekdays,room_codes,rate_plan_keys,created_at,updated_at) VALUES($1,'Legacy','2026-09-01','2026-10-31','null','null','null',1,1)",["hotel-corali"]);
    await database.query("INSERT INTO booking_restrictions(owner_id,name,starts_on,ends_on,closed_arrival_weekdays,room_codes,rate_plan_keys,created_at,updated_at) VALUES($1,'Legacy','2026-09-01','2026-10-31','null','null','null',1,1)",["hotel-corali"]);
    const rateNames=moduleFromSource("lib/booking-i18n.ts").rateNames;
    const pricing=moduleFromSource("lib/room-pricing.ts");
    const availability=moduleFromSource("lib/public-rate.ts",{"@/lib/db":{db:()=>database},"@/lib/booking-i18n":{rateNames},"@/lib/room-pricing":pricing,"@/lib/direct-pricing":moduleFromSource("lib/direct-pricing.ts"),"@/lib/amenity-icons":moduleFromSource("lib/amenity-icons.ts"),"@/lib/tape-chart":moduleFromSource("lib/tape-chart.ts"),"@/lib/season-rates":moduleFromSource("lib/season-rates.ts"),"@/lib/min-stay":moduleFromSource("lib/min-stay.ts"),"@/lib/climate-fee":moduleFromSource("lib/climate-fee.ts"),"@/lib/room-card":moduleFromSource("lib/room-card.ts"),"@/lib/offers":moduleFromSource("lib/offers.ts")});
    const result=await (availability.publicAvailability as (input:object)=>Promise<{rooms:{name:string;plans:{totalCents:number}[]}[]}> )({ownerId:"hotel-corali",checkIn:"2026-09-29",checkOut:"2026-10-03",adults:2,children:0,rooms:1,lang:"en"});
    assert.equal(result.rooms.length,1);
    // The direct-booking discount belongs to the direct website rate only: the flexible rate stays at the standard price.
    assert.equal(result.rooms[0].plans[0].totalCents,40000);
    assert.equal((result.rooms[0].plans[0] as unknown as {standardCents:number}).standardCents,40000);
    await database.query("INSERT INTO rate_plans(owner_id,plan_key,name,adjustment_percent,payment_policy) VALUES($1,'direct_web','Direct website rate',-5,'flexible')",["hotel-corali"]);
    const withDirect=await (availability.publicAvailability as (input:object)=>Promise<{rooms:{plans:{key:string;totalCents:number;standardCents:number;directPercent:number}[]}[]}>)({ownerId:"hotel-corali",checkIn:"2026-09-29",checkOut:"2026-10-03",adults:2,children:0,rooms:1,lang:"en"});
    const direct=withDirect.rooms[0].plans.find(p=>p.key==="direct_web")!;
    assert.deepEqual([direct.standardCents,direct.totalCents,direct.directPercent],[40000,38000,5],"5% once, not on top of the plan's own −5%");
    assert.equal(withDirect.rooms[0].plans.find(p=>p.key==="flexible")!.totalCents,40000);
    await database.query("DELETE FROM rate_plans WHERE plan_key='direct_web'");
    await database.query("INSERT INTO coupons(owner_id,code,discount_type,discount_value,applies_to,valid_from,valid_to,max_uses,usage_count,active,created_at,combinable,purpose,restricted_email) VALUES($1,'BDAY-TESTCODE','percentage',10,'room_only','2020-01-01','2099-12-31',1,0,1,1,0,'birthday','maria@example.com')",["hotel-corali"]);
    type WithCoupon={coupon:{problem:string|null;applied:boolean};rooms:{plans:{totalCents:number;couponCents:number}[]}[]};
    const run=availability.publicAvailability as (input:object)=>Promise<WithCoupon>;
    const base={ownerId:"hotel-corali",checkIn:"2026-09-29",checkOut:"2026-10-03",adults:2,children:0,rooms:1,lang:"en"};
    const couponed=await run({...base,couponCode:"bday-testcode"});
    assert.equal(couponed.coupon.problem,null);
    assert.equal(couponed.rooms[0].plans[0].totalCents,36000,"non-stackable 10% applies to the standard price");
    assert.equal((await run({...base,couponCode:"BDAY-TESTCODE",guestEmail:"other@example.com"})).coupon.problem,"EMAIL_MISMATCH");
    assert.equal((await run({...base,couponCode:"NOPE"})).coupon.problem,"NOT_FOUND");
    await database.query("INSERT INTO revenue_settings(owner_id,direct_discount_percent,direct_discount_active,updated_at) VALUES($1,5,0,1)",["hotel-corali"]);
    assert.equal((await run(base)).rooms[0].plans[0].totalCents,40000,"flexible rate unaffected when the discount is off");
    // Two rooms of the same category: a room without a base price is charged at the category price, never for free.
    await database.query("INSERT INTO rooms(owner_id,code,room_type,capacity,active,base_rate_cents,operational_status,amenities,images) VALUES($1,'102','double',2,1,0,'available','[]','[]')",["hotel-corali"]);
    const two=await (availability.publicAvailability as (input:object)=>Promise<{rooms:{plans:{key:string;totalCents:number}[]}[];charges:{multiplier:number}[]}>)({...base,adults:4,rooms:2});
    assert.equal(two.rooms[0].plans.find(p=>p.key==="flexible")!.totalCents,80000,"2 rooms × 4 nights × €100");
    await database.query("UPDATE rooms SET base_rate_cents=0 WHERE owner_id=$1",["hotel-corali"]);
    assert.equal((await (availability.publicAvailability as (input:object)=>Promise<{rooms:unknown[]}>)(base)).rooms.length,0,"a category without any price is not offered");
    await database.query("UPDATE rooms SET base_rate_cents=10000 WHERE owner_id=$1 AND code='101'",["hotel-corali"]);
    await database.query("DELETE FROM rooms WHERE owner_id=$1 AND code='102'",["hotel-corali"]);
    await database.query("INSERT INTO min_stay_rules(owner_id,room_type,starts_on,ends_on,min_nights,active,updated_at) VALUES($1,'double','2026-09-01','2026-10-31',5,1,1)",["hotel-corali"]);
    const short=await (availability.publicAvailability as (input:object)=>Promise<{rooms:unknown[];minStay:{roomType:string;minNights:number}[]}>)(base);
    assert.equal(short.rooms.length,0,"4 nights hidden by a 5-night minimum for the category");
    assert.equal(JSON.stringify(short.minStay.map(m=>[m.roomType,m.minNights])),JSON.stringify([["double",5]]));
    const long=await (availability.publicAvailability as (input:object)=>Promise<{rooms:unknown[]}>)({...base,checkOut:"2026-10-04"});
    assert.equal(long.rooms.length,1,"5 nights allowed");
    // A promotion: −10% shown to guests with its text; an early-booking window the stay misses switches it off.
    await database.query("DELETE FROM min_stay_rules");
    await database.query(`INSERT INTO special_prices(owner_id,name,starts_on,ends_on,adjustment_type,adjustment_value,operation,promotion,promotion_text_json,round_integer,created_at,updated_at) VALUES($1,'Autumn','2026-09-01','2026-10-31','percentage',10,'discount',1,'{"en":"Autumn deal"}',1,1,1)`,["hotel-corali"]);
    type Promo={rooms:{plans:{key:string;totalCents:number;promotions:{name:string;text:string;percent:number|null}[]}[]}[]};
    const promo=await (availability.publicAvailability as (input:object)=>Promise<Promo>)(base);
    assert.equal(promo.rooms[0].plans[0].totalCents,36000);
    assert.equal(JSON.stringify(promo.rooms[0].plans[0].promotions),JSON.stringify([{name:"Autumn",text:"Autumn deal",percent:10,amountCents:null}]));
    await database.query("UPDATE special_prices SET min_advance_days=3650 WHERE name='Autumn'");
    const missed=await (availability.publicAvailability as (input:object)=>Promise<Promo>)(base);
    assert.equal(missed.rooms[0].plans[0].totalCents,40000);
    assert.equal(missed.rooms[0].plans[0].promotions.length,0);
  }finally{await database.close()}
});
