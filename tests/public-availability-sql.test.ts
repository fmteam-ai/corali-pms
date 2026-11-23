import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {sellableForArrival} from "../scripts/room-ready-core.mjs";

test("every public availability query binds the exact PostgreSQL parameters",async()=>{
 const source=readFileSync("lib/public-rate.ts","utf8");
 const queries=[...source.matchAll(/db\(\)\.query\(`([\s\S]*?)`,\[([^\]]*)\]\)/g)];
 assert.equal(queries.length,11);
 const values:Record<string,string|number>={"input.ownerId":"hotel-corali","input.checkIn":"2026-09-30","input.checkOut":"2026-10-08","input.adults":2,"input.lang":"en","Date.now()":Date.now(),"input.excludeBookingId??0":0,"Math.ceil((input.adults+input.children)/input.rooms)":2,"couponCode":"BDAY-TEST","hotelToday()":"2026-09-30"};
 const database=new PGlite();
 try{
  await database.exec(readFileSync("server/postgres-schema.sql","utf8"));
  for(const [index,match] of queries.entries()){
   const expressions=match[2].split(/,(?![^()]*\))/).map(s=>s.trim());
   const args=expressions.map(expr=>{assert.ok(expr in values,`query ${index}: unknown ${expr}`);return values[expr]});
   // v186: the shared «room ready» rule is interpolated into the room query.
   const sql=match[1].replace(/\$\{sellableForArrival\("(\$\d+)","(\$\d+)","(\$\d+)"\)\}/g,(_,a,b,c)=>sellableForArrival(a,b,c));
   assert.ok(!sql.includes("${"),`query ${index}: uninterpolated expression`);
   await database.query(sql,args);
  }
 }finally{await database.close()}
});
