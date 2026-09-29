import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { needsSecondPerson, parsePhoto, roomStatusAfterResolution, severityBlocksRoom, severityFrom, severityRank } from "../lib/maintenance.ts";

const jpeg = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)]).toString("base64")}`;
const png = `data:image/png;base64,${Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(60, 1)]).toString("base64")}`;

test("major and out-of-order defects block the room; minor ones do not", () => {
  assert.equal(severityBlocksRoom("minor"), false);
  assert.equal(severityBlocksRoom("major"), true);
  assert.equal(severityBlocksRoom("out_of_order"), true);
  assert.ok(severityRank("out_of_order") > severityRank("major") && severityRank("major") > severityRank("minor"));
  assert.equal(severityFrom({ severe: true }), "out_of_order");
  assert.equal(severityFrom({ severe: false }), "minor");
  assert.equal(severityFrom({ severity: "major", severe: false }), "major");
  assert.equal(severityFrom({ severity: "bogus" }), "minor");
});

test("post-repair override decides the room state unless another blocking defect stays open", () => {
  assert.equal(roomStatusAfterResolution({ otherBlockingOpen: false, override: "clean" }), "clean");
  assert.equal(roomStatusAfterResolution({ otherBlockingOpen: false, override: "dirty" }), "dirty");
  assert.equal(roomStatusAfterResolution({ otherBlockingOpen: true, override: "clean" }), "out_of_order");
});

test("the reporter of a blocking defect cannot sign off its repair", () => {
  assert.equal(needsSecondPerson({ severity: "major", reported_by: 7 }, 7), true);
  assert.equal(needsSecondPerson({ severity: "major", reported_by: 7 }, 8), false);
  assert.equal(needsSecondPerson({ severity: "minor", reported_by: 7 }, 7), false);
  assert.equal(needsSecondPerson({ severity: "out_of_order", reported_by: null }, 7), false);
});

test("photos must be real JPEG/PNG/WebP data URLs within the size limit", () => {
  assert.equal(parsePhoto(jpeg)?.mime, "image/jpeg");
  assert.equal(parsePhoto(png)?.mime, "image/png");
  assert.equal(parsePhoto(jpeg.replace("image/jpeg", "image/png")), null); // declared type must match content
  assert.equal(parsePhoto("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), null);
  assert.equal(parsePhoto("https://example.com/a.jpg"), null);
  assert.equal(parsePhoto(`data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2_600_000)]).toString("base64")}`), null);
  assert.equal(parsePhoto(42), null);
});

test("maintenance history is append-only and resolved notices need notes", async () => {
  const db = new PGlite();
  try {
    const schema = await readFile(new URL("../server/postgres-schema.sql", import.meta.url), "utf8");
    await db.exec(schema);
    await db.exec(schema); // idempotent
    const room = (await db.query<{ id: number }>(`INSERT INTO rooms(owner_id,code,room_type,capacity,base_rate_cents) VALUES('h','101','Double',2,10000) RETURNING id`)).rows[0].id;
    const n = (await db.query<{ id: number }>(`INSERT INTO maintenance_notices(owner_id,room_id,severity,description,reported_by,reported_at) VALUES('h',$1,'major','Leaking faucet',1,1) RETURNING id`, [room])).rows[0].id;
    await db.query(`INSERT INTO maintenance_notice_photos(owner_id,notice_id,mime,data_base64,byte_size,created_at) VALUES('h',$1,'image/jpeg','AA',1,1)`, [n]);
    await assert.rejects(db.query(`UPDATE maintenance_notices SET status='resolved',resolved_at=2 WHERE id=$1`, [n]), /check/i);
    await assert.rejects(db.query(`UPDATE maintenance_notices SET status='resolved',resolved_at=2,resolution_notes='  ' WHERE id=$1`, [n]), /check/i);
    await db.query(`UPDATE maintenance_notices SET status='resolved',resolved_at=2,resolved_by=2,resolution_notes='Replaced washer',post_repair_state='dirty' WHERE id=$1`, [n]);
    await assert.rejects(db.query(`DELETE FROM maintenance_notice_photos WHERE notice_id=$1`, [n]), /append-only/);
    await assert.rejects(db.query(`DELETE FROM maintenance_notices WHERE id=$1`, [n]), /append-only/);
    await assert.rejects(db.query(`INSERT INTO maintenance_notices(owner_id,room_id,severity,description,reported_at) VALUES('h',$1,'critical','x',1)`, [room]), /check/i);
    assert.deepEqual((await db.query(`SELECT status,resolution_notes FROM maintenance_notices`)).rows, [{ status: "resolved", resolution_notes: "Replaced washer" }]);
  } finally {
    await db.close();
  }
});
