import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { acknowledgeAlert, alertDeliveryIssues, alertRecipients, deliverAlerts, escalateAlerts, raiseAlert, resolveAlerts } from "../scripts/alert-core.mjs";

const o = "hotel-corali";
type Row = Record<string, unknown>;

test("v189 alert delivery: told once, every delivery confirmed, retried with backoff, never sent twice, escalated, acknowledged", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync("server/postgres-schema.sql", "utf8"));
    const pool = { query: async (sql: string, params: unknown[] = []) => { const r = await db.query<Row>(sql, params); return { rows: r.rows, rowCount: r.affectedRows || r.rows.length }; } };
    await db.query(`INSERT INTO pms_staff_users(owner_id,username,display_name,email,password_hash,totp_secret,active,role,created_at,updated_at) VALUES($1,'maria','Maria','Maria@Hotel.gr','x','x',1,'admin',1,1),($1,'nikos','Nikos','nikos@hotel.gr','x','x',1,'reception',1,1),($1,'old','Old','old@hotel.gr','x','x',0,'owner',1,1)`, [o]);
    assert.deepEqual(await alertRecipients(pool, o, ""), ["maria@hotel.gr"], "active owners / admins only");
    assert.deepEqual(await alertRecipients(pool, o, "a@x.gr, bad, b@y.gr"), ["a@x.gr", "b@y.gr"]);

    const t = Date.parse("2026-07-15T10:00:00Z");
    const first = await raiseAlert({ pool, owner: o, key: "rel:cron:stopped", area: "automations", title: "Το cron σταμάτησε", now: t });
    assert.equal(first.fresh, true);
    assert.equal((await raiseAlert({ pool, owner: o, key: "rel:cron:stopped", title: "Το cron σταμάτησε", now: t + 600_000 })).fresh, false, "an ongoing problem is not told again");
    assert.equal((await db.query(`SELECT 1 FROM pms_notifications`)).rows.length, 1);
    const box = async () => (await db.query<Row>(`SELECT channel,recipient,purpose,status,attempts,next_attempt_at FROM alert_outbox ORDER BY id`)).rows;
    assert.deepEqual((await box()).map((r) => `${r.channel}:${r.recipient}`), ["push:desk", "email:maria@hotel.gr"]);

    // The mail server is down: retried with backoff (1′, 5′, …), push reaches 2 phones.
    let mailUp = false, pushes = 0;
    const send = { push: async () => { pushes++; return 2; }, email: async () => { if (!mailUp) throw new Error("SMTP 421"); } };
    let r = await deliverAlerts({ pool, owner: o, send, now: t });
    assert.deepEqual(r, { sent: 1, failed: 0, skipped: 0, retry: 1 });
    let rows = await box();
    assert.equal(rows[0].status, "sent");
    assert.equal(rows[1].status, "pending");
    assert.equal(Number(rows[1].next_attempt_at), t + 60_000);
    // Not due yet: nothing is sent; two runs at the same time send each delivery at most once.
    r = await deliverAlerts({ pool, owner: o, send, now: t + 30_000 });
    assert.equal(r.sent + r.retry, 0);
    mailUp = true;
    const both = await Promise.all([deliverAlerts({ pool, owner: o, send, now: t + 61_000 }), deliverAlerts({ pool, owner: o, send, now: t + 61_000 })]);
    assert.equal(both[0].sent + both[1].sent, 1);
    assert.equal(pushes, 1, "the push was never repeated");
    rows = await box();
    assert.equal(rows[1].status, "sent");

    // A delivery that keeps failing ends as «failed» after 6 attempts and is shown in the Reliability center.
    await raiseAlert({ pool, owner: o, key: "rel:fiscal:9", title: "myDATA 9", now: t, emails: ["x@y.gr"] });
    const bad = { push: async () => 0, email: async () => { throw new Error("550 mailbox unavailable"); } };
    let at = t;
    for (let i = 0; i < 8; i++) { await deliverAlerts({ pool, owner: o, send: bad, now: at }); at += 4 * 3_600_000; }
    const x = (await db.query<Row>(`SELECT o.channel,o.status,o.attempts,o.last_error FROM alert_outbox o JOIN alerts a ON a.id=o.alert_id WHERE a.alert_key='rel:fiscal:9' ORDER BY o.id`)).rows;
    assert.equal(x[0].status, "skipped", "no phone subscribed is not a failure");
    assert.equal(x[1].status, "failed");
    assert.equal(Number(x[1].attempts), 6);
    const issues = await alertDeliveryIssues(pool, o, at);
    assert.equal(issues.length, 1);
    assert.match(String(issues[0].last_error), /550/);

    // Escalation: critical and unacknowledged after 30 minutes → sent once more; acknowledged → not.
    assert.equal(await escalateAlerts({ pool, owner: o, now: t + 20 * 60_000, emails: ["boss@hotel.gr"] }), 0);
    assert.equal(await escalateAlerts({ pool, owner: o, now: t + 31 * 60_000, emails: ["boss@hotel.gr"] }), 2);
    assert.equal(await escalateAlerts({ pool, owner: o, now: t + 60 * 60_000, emails: ["boss@hotel.gr"] }), 0, "only once");
    const esc = (await db.query<Row>(`SELECT o.id,o.recipient FROM alert_outbox o JOIN alerts a ON a.id=o.alert_id WHERE o.purpose='escalation' AND a.alert_key='rel:cron:stopped'`)).rows;
    assert.deepEqual(esc.map((e) => e.recipient).sort(), ["boss@hotel.gr", "desk"]);
    assert.equal(await acknowledgeAlert({ pool, owner: o, id: first.id, by: "Maria", now: t + 32 * 60_000 }), true);
    assert.equal((await db.query<Row>(`SELECT count(*)::int n FROM alert_outbox WHERE alert_id=$1 AND purpose='escalation' AND status='cancelled'`, [first.id])).rows[0].n, 2, "acknowledging stops the pending escalation");

    // Resolved when it clears; told again (new notification and deliveries) when it returns.
    assert.equal(await resolveAlerts({ pool, owner: o, activeKeys: ["rel:fiscal:9"], now: t + 40 * 60_000 }), 1);
    const back = await raiseAlert({ pool, owner: o, key: "rel:cron:stopped", title: "Το cron σταμάτησε", now: t + 50 * 60_000, emails: ["maria@hotel.gr"] });
    assert.equal(back.fresh, true);
    assert.equal(back.id, first.id);
    assert.equal((await db.query<Row>(`SELECT occurrence,acknowledged_at FROM alerts WHERE id=$1`, [first.id])).rows[0].occurrence, 2);
    assert.equal((await db.query<Row>(`SELECT count(*)::int n FROM alert_outbox WHERE alert_id=$1 AND occurrence=2`, [first.id])).rows[0].n, 2);
    assert.equal((await db.query(`SELECT 1 FROM pms_notifications`)).rows.length, 3);
  } finally { await db.close(); }
});
