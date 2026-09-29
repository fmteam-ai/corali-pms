import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("reports allocate a cross-month stay to its actual nights", async () => {
  const source = readFileSync("app/pms/reports/page.tsx", "utf8");
  const queries = [...source.matchAll(/db\(\)\.query\(`(WITH stays AS \([\s\S]*?)`,\s*\[user\.ownerId/g)].map(match => match[1]);
  assert.equal(queries.length, 2);
  const database = new PGlite();
  try {
    await database.exec("CREATE TABLE bookings(id integer,owner_id text,channel text,total_cents bigint,check_in text,check_out text,status text,room_id integer); CREATE TABLE rooms(id integer,owner_id text,code text,room_type text)");
    await database.query("INSERT INTO rooms VALUES(11,'hotel','101','Double')");
    await database.query("INSERT INTO bookings VALUES(1,'hotel','direct',40000,'2026-01-30','2026-02-03','checked_out',11)");
    const monthly = await database.query<{sold_nights: number; revenue_cents: string}>(queries[0], ["hotel", "2026-01-01", "2026-03-01"]);
    assert.deepEqual(monthly.rows.map(row => [row.sold_nights, Number(row.revenue_cents)]), [[2, 20000], [2, 20000]]);
    const channels = await database.query<{revenue_cents: string}>(queries[1], ["hotel", "2026-01-01", "2026-02-01"]);
    assert.equal(Number(channels.rows[0].revenue_cents), 20000);
    const previousSql=source.match(/db\(\)\.query\(`(SELECT count\(\*\)::int AS sold_nights[\s\S]*?)`,\[user\.ownerId,previousFrom,from\]/)?.[1];
    const performanceSql=source.match(/db\(\)\.query\(`(SELECT COALESCE\(r\.code[\s\S]*?)`,\[user\.ownerId,from,until\]/)?.[1];
    assert.ok(previousSql);assert.ok(performanceSql);
    const previous=await database.query<{sold_nights:number;revenue_cents:string}>(previousSql,["hotel","2026-01-29","2026-01-31"]);
    assert.equal(previous.rows[0].sold_nights,1);assert.equal(Number(previous.rows[0].revenue_cents),10000);
    const performance=await database.query<{code:string;sold_nights:number;revenue_cents:string}>(performanceSql,["hotel","2026-02-01","2026-02-04"]);
    assert.deepEqual(performance.rows.map(row=>[row.code,row.sold_nights,Number(row.revenue_cents)]),[["101",2,20000]]);
  } finally {
    await database.close();
  }
});
