import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { purgeExpiredIdentityData, retentionCutoff } from "../scripts/retention-core.mjs";
import { birthdayCode, birthdayLanguage, birthdayMessage } from "../scripts/birthday-core.mjs";

test("retention cutoff is three calendar years in Athens time", () => {
  assert.equal(retentionCutoff(new Date("2026-09-29T10:00:00Z")), "2023-09-29");
  assert.equal(retentionCutoff(new Date("2026-09-29T22:30:00Z")), "2023-09-30");
  assert.equal(retentionCutoff(new Date("2028-02-29T10:00:00Z")), "2025-02-28");
});

test("identity data is purged three years after the last check-out only", async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(new URL("../server/postgres-schema.sql", import.meta.url), "utf8"));
    const now = new Date("2026-09-29T10:00:00Z");
    const insertBooking = `INSERT INTO bookings(owner_id,reference,guest_name,guest_email,check_in,check_out,status,created_at) VALUES('hotel-corali',$1,'G',$2,$3,$4,$5,0) RETURNING id`;
    const oldStay = (await db.query<{ id: number }>(insertBooking, ["R1", "old@example.com", "2023-06-01", "2023-06-05", "checked_out"])).rows[0].id;
    const recentStay = (await db.query<{ id: number }>(insertBooking, ["R2", "back@example.com", "2023-06-01", "2023-06-05", "checked_out"])).rows[0].id;
    await db.query(insertBooking, ["R3", "back@example.com", "2025-07-01", "2025-07-05", "checked_out"]);
    await db.query(insertBooking, ["R4", "old@example.com", "2027-01-01", "2027-01-03", "cancelled"]);
    const insertCheckin = `INSERT INTO guest_checkins(owner_id,booking_id,first_name,last_name,email,phone,arrival_time,document_number,date_of_birth_encrypted,birth_month,birth_day,submitted_at) VALUES('hotel-corali',$1,'A','B',$2,'1','14:00','v1.enc','v1.dob',5,4,$3)`;
    await db.query(insertCheckin, [oldStay, "old@example.com", Date.parse("2023-05-20")]);
    await db.query(insertCheckin, [recentStay, "back@example.com", Date.parse("2023-05-20")]);
    await db.query(insertCheckin, [null, "nostay@example.com", Date.parse("2023-01-10")]);
    await db.query(insertCheckin, [null, "fresh@example.com", Date.parse("2026-01-10")]);
    const query = (text: string, values: unknown[]) => db.query(text, values);
    assert.equal(await purgeExpiredIdentityData(query, "hotel-corali", now), 2);
    const rows = (await db.query<{ email: string; document_number: string; date_of_birth_encrypted: string | null; birth_month: number | null; purged: boolean }>(`SELECT email,document_number,date_of_birth_encrypted,birth_month,identity_purged_at IS NOT NULL AS purged FROM guest_checkins ORDER BY email`)).rows;
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r]));
    assert.deepEqual([byEmail["old@example.com"].purged, byEmail["old@example.com"].document_number, byEmail["old@example.com"].date_of_birth_encrypted, byEmail["old@example.com"].birth_month], [true, "", null, null]);
    assert.equal(byEmail["nostay@example.com"].purged, true);
    assert.equal(byEmail["back@example.com"].purged, false, "a later stay extends retention");
    assert.equal(byEmail["back@example.com"].document_number, "v1.enc");
    assert.equal(byEmail["fresh@example.com"].purged, false);
    assert.equal(await purgeExpiredIdentityData(query, "hotel-corali", now), 0, "idempotent");
  } finally {
    await db.close();
  }
});

test("birthday codes are unambiguous and messages are localised", () => {
  let i = 0;
  const code = birthdayCode(() => i++ % 32);
  assert.match(code, /^BDAY-[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(birthdayLanguage("de"), "de");
  assert.equal(birthdayLanguage("pt"), "en");
  const m = birthdayMessage("el", { name: "Μαρία", code: "BDAY-ABCDEFGH", percent: 10, until: "28/11/2026" });
  assert.match(m.body, /Μαρία/);
  assert.match(m.body, /BDAY-ABCDEFGH/);
  assert.match(m.body, /10%/);
  assert.match(m.body, /δεν συνδυάζεται/);
  for (const lang of ["el", "en", "fr", "de", "it", "es"]) assert.doesNotMatch(birthdayMessage(lang, { name: "x", code: "C", percent: 10, until: "u" }).body, /\{\w+\}/);
});

test("birthday terms fall back to defaults and are spelled out in the guest message", async () => {
  const { birthdayTerms } = await import("../scripts/birthday-core.mjs");
  assert.deepEqual(birthdayTerms(null), { percent: 10, validDays: 60, stayFrom: null, stayTo: null, blackout: [] });
  const t = birthdayTerms({ discount_percent: 15, valid_days: 90, stay_from: "04-01", stay_to: "10-31", blackout_json: '[{"from":"07-20","to":"08-20"},{"from":"x","to":"y"}]' });
  assert.deepEqual(t, { percent: 15, validDays: 90, stayFrom: "04-01", stayTo: "10-31", blackout: [{ from: "07-20", to: "08-20" }] });
  assert.equal(birthdayTerms({ discount_percent: 99, valid_days: 1 }).percent, 10);
  const el = birthdayMessage("el", { ...t, name: "Μαρία", code: "BDAY-ABCDEFGH", until: "01/03/2027" });
  assert.match(el.body, /Ισχύει για διαμονές από 01\/04 έως 31\/10\. Δεν ισχύει για διαμονές στις περιόδους 20\/07–20\/08\./);
  assert.match(el.body, /Hotel Corali$/);
  assert.doesNotMatch(birthdayMessage("en", { name: "A", code: "C", percent: 10, until: "x" }).body, /Not valid/);
});
