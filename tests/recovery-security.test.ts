import assert from "node:assert/strict";
import test from "node:test";
import { applyAdministratorRecovery, validateRecoveryInput } from "../scripts/admin-recovery-core.mjs";

test("administrator recovery validates and normalizes protected input", () => {
  const input = validateRecoveryInput({ username: "  HC.Owner ", displayName: "Hotel Corali", email: " OWNER@HOTELCORALI.GR ", password: "a-secure-password-of-adequate-length", resetTwoFactor: true });
  assert.equal(input.username, "hc.owner");
  assert.equal(input.email, "owner@hotelcorali.gr");
  assert.throws(() => validateRecoveryInput({ ...input, password: "short" }), /14 to 256/);
});

test("administrator recovery updates owner, resets 2FA and commits atomically", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client = { async query(query: string | { text: string; values?: unknown[] }, values?: unknown[]) {
    const text = typeof query === "string" ? query : query.text;
    calls.push({ text, values: typeof query === "string" ? values : query.values });
    if (text.startsWith("SELECT id FROM pms_staff_users")) return { rowCount: 1, rows: [{ id: 42 }] };
    return { rowCount: 1, rows: [] };
  } };
  const input = validateRecoveryInput({ username: "owner", displayName: "Hotel Corali", email: "owner@hotelcorali.gr", password: "another-secure-password", resetTwoFactor: true });
  const id = await applyAdministratorRecovery(client, { ownerId: "hotel-corali", input, passwordHash: "argon-hash", now: 123 });
  assert.equal(id, 42);
  assert.equal(calls[0].text, "BEGIN");
  const sql = calls.map((call) => call.text).join("\n");
  assert.match(sql, /totp_secret=CASE WHEN/);
  assert.match(sql, /recovery_codes_json=CASE WHEN/);
  assert.match(sql, /UPDATE pms_sessions SET revoked_at/);
  assert.match(sql, /role='owner' AND id<>\$3/);
  assert.equal(calls.at(-1)?.text, "COMMIT");
});

test("administrator recovery rolls back on database failure", async () => {
  const calls: string[] = [];
  const client = { async query(query: string) {
    calls.push(query);
    if (query.startsWith("SELECT id FROM pms_staff_users")) throw new Error("database failure");
    return { rowCount: 0, rows: [] };
  } };
  const input = validateRecoveryInput({ username: "owner", displayName: "Hotel Corali", email: "owner@hotelcorali.gr", password: "another-secure-password" });
  await assert.rejects(applyAdministratorRecovery(client, { ownerId: "hotel-corali", input, passwordHash: "argon-hash", now: 123 }), /database failure/);
  assert.deepEqual(calls, ["BEGIN", "SELECT id FROM pms_staff_users WHERE owner_id=$1 AND lower(username)=$2 FOR UPDATE", "ROLLBACK"]);
});
