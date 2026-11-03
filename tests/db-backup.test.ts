import assert from "node:assert/strict";
import test from "node:test";
import { backupName, decryptBuffer, encryptBuffer, expiredBackups } from "../scripts/db-backup-core.mjs";

test("encrypted backups: round trip, wrong key and tampering are rejected", () => {
  const plain = Buffer.from("PGDMP guest data");
  const enc = encryptBuffer(plain, "k".repeat(40));
  assert.ok(!enc.includes(Buffer.from("guest data")));
  assert.deepEqual(decryptBuffer(enc, "k".repeat(40)), plain);
  assert.throws(() => decryptBuffer(enc, "x".repeat(40)));
  const bad = Buffer.from(enc); bad[20] ^= 1;
  assert.throws(() => decryptBuffer(bad, "k".repeat(40)));
});

test("backup rotation keeps the newest", () => {
  const names = [1, 2, 3, 4].map((d) => backupName(new Date(Date.UTC(2026, 10, d, 3, 40)))).concat("notes.txt");
  assert.deepEqual(expiredBackups(names, 2), [backupName(new Date(Date.UTC(2026, 10, 2, 3, 40))), backupName(new Date(Date.UTC(2026, 10, 1, 3, 40)))]);
});
