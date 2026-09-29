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
    const availability=moduleFromSource("lib/public-rate.ts",{"@/lib/db":{db:()=>database},"@/lib/booking-i18n":{rateNames},"@/lib/room-pricing":pricing,"@/lib/direct-pricing":moduleFromSource("lib/direct-pricing.ts"),"@/lib/amenity-icons":moduleFromSource("lib/amenity-icons.ts"),"@/lib/tape-chart":moduleFromSource("lib/tape-chart.ts")});
    const result=await (availability.publicAvailability as (input:object)=>Promise<{rooms:{name:string;plans:{totalCents:number}[]}[]}> )({ownerId:"hotel-corali",checkIn:"2026-09-29",checkOut:"2026-10-03",adults:2,children:0,rooms:1,lang:"en"});
    assert.equal(result.rooms.length,1);
    // Default direct-website discount (5%) applies against the standard rate.
    assert.equal(result.rooms[0].plans[0].totalCents,38000);
    assert.equal((result.rooms[0].plans[0] as unknown as {standardCents:number}).standardCents,40000);
    await database.query("INSERT INTO coupons(owner_id,code,discount_type,discount_value,applies_to,valid_from,valid_to,max_uses,usage_count,active,created_at,combinable,purpose,restricted_email) VALUES($1,'BDAY-TESTCODE','percentage',10,'room_only','2020-01-01','2099-12-31',1,0,1,1,0,'birthday','maria@example.com')",["hotel-corali"]);
    type WithCoupon={coupon:{problem:string|null;applied:boolean};rooms:{plans:{totalCents:number;couponCents:number}[]}[]};
    const run=availability.publicAvailability as (input:object)=>Promise<WithCoupon>;
    const base={ownerId:"hotel-corali",checkIn:"2026-09-29",checkOut:"2026-10-03",adults:2,children:0,rooms:1,lang:"en"};
    const couponed=await run({...base,couponCode:"bday-testcode"});
    assert.equal(couponed.coupon.problem,null);
    assert.equal(couponed.rooms[0].plans[0].totalCents,36000,"non-stackable 10% replaces the 5% direct discount");
    assert.equal((await run({...base,couponCode:"BDAY-TESTCODE",guestEmail:"other@example.com"})).coupon.problem,"EMAIL_MISMATCH");
    assert.equal((await run({...base,couponCode:"NOPE"})).coupon.problem,"NOT_FOUND");
    await database.query("INSERT INTO revenue_settings(owner_id,direct_discount_percent,direct_discount_active,updated_at) VALUES($1,5,0,1)",["hotel-corali"]);
    assert.equal((await run(base)).rooms[0].plans[0].totalCents,40000,"discount can be switched off in the PMS");
  }finally{await database.close()}
});
