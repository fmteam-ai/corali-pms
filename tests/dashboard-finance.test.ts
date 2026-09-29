import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";

test("front desk net receipts account for signed payments and refunds",async()=>{
 const source=readFileSync("app/pms/page.tsx","utf8");
 const sql=source.match(/financial\?query\(`(SELECT COALESCE\(sum\(CASE WHEN entry_type IN \('payment','refund'\)[\s\S]*?)`,\[user\.ownerId\]\)/)?.[1];
 assert.ok(sql);
 const database=new PGlite();
 try{
  await database.exec("CREATE TABLE folio_entries(owner_id text,entry_type text,amount_cents bigint,created_at bigint)");
  await database.query("INSERT INTO folio_entries VALUES('hotel','payment',-10000,$1),('hotel','refund',2000,$1),('other','payment',-50000,$1)",[Date.now()]);
  const result=await database.query<{net_cents:string}>(sql,["hotel"]);
  assert.equal(Number(result.rows[0].net_cents),8000);
 }finally{await database.close()}
});
