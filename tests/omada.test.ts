import { test } from "node:test";
import assert from "node:assert/strict";
import { guestPassword, omadaCheck, omadaClient, omadaUrl, pskName, validOmadacId, wifiPlan, wifiQr } from "../scripts/omada-core.mjs";
import { runGuestWifi } from "../scripts/guest-wifi-worker.mjs";

test("Omada settings: https origin only, Omada ID, PSK name and an easy-to-type password", () => {
  assert.equal(omadaUrl("euw1-omada-northbound.tplinkcloud.com/"), "https://euw1-omada-northbound.tplinkcloud.com");
  assert.equal(omadaUrl("https://192.168.10.2:443/openapi"), "https://192.168.10.2");
  assert.equal(omadaUrl("http://192.168.10.2"), "");
  assert.equal(validOmadacId("d7a2b74a3acaf62af37e3230d4865ae3"), true);
  assert.equal(validOmadacId("bad id"), false);
  assert.equal(pskName("CR-2026/0012"), "PMS-CR-20260012");
  const p = guestPassword();
  assert.match(p, /^[a-hjkmnp-z2-9]{10}$/);
  assert.equal(wifiQr("Corali;Guests", "abc"), String.raw`WIFI:T:WPA;S:Corali\;Guests;P:abc;;`);
});

test("Wi-Fi plan: add for checked-in stays without a password, remove when the stay ended", () => {
  const stays = [{ id: 1, status: "checked_in", check_out: "2026-07-05" }, { id: 2, status: "checked_in", check_out: "2026-07-03" }];
  const entries = [{ booking_id: 2, status: "active", psk_name: "PMS-B" }, { booking_id: 9, status: "active", psk_name: "PMS-OLD" }];
  const plan = wifiPlan(stays, entries, "2026-07-03");
  assert.deepEqual(plan.add.map((s) => s.id), [1]);
  assert.deepEqual(plan.remove.map((e) => e.booking_id), [9]);
  assert.deepEqual(wifiPlan(stays, entries, "2026-07-04").remove.map((e) => e.booking_id), [2, 9], "past its check-out day");
});

function fakeOmada(log: string[]) {
  return (async (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
    log.push(`${init.method} ${new URL(url).pathname}${init.body ? ` ${init.body}` : ""}`);
    const ok = (result: unknown) => new Response(JSON.stringify({ errorCode: 0, msg: "", result }), { status: 200 });
    if (url.includes("/authorize/token")) return ok({ accessToken: "AT-1", expiresIn: 7200 });
    assert.equal(init.headers.Authorization, "AccessToken=AT-1");
    if (url.endsWith("/sites?page=1&pageSize=100")) return ok({ data: [{ siteId: "S1", name: "Corali" }] });
    if (url.endsWith("/ppsk-profiles")) return ok([{ id: "P1", profileName: "Guests", ssid: ["Corali Guests"] }]);
    if (url.endsWith("/ppsk-profile/P1")) return ok({ ppsk: [{ name: "PMS-OLD", psk: "x" }] });
    return ok(null);
  }) as unknown as typeof fetch;
}

test("Omada client: token, site, profile; check reports SSIDs and count; wrong profile name is clear", async () => {
  const log: string[] = [];
  const conn = { url: "https://euw1-omada-northbound.tplinkcloud.com", omadacId: "d7a2b74a3acaf62af37e3230d4865ae3", clientId: "c", clientSecret: "s" };
  assert.deepEqual(await omadaCheck({ ...conn, profile: "guests" }, fakeOmada(log)), { siteId: "S1", profileId: "P1", ssids: ["Corali Guests"], count: 1 });
  assert.match(log[0], /^POST \/openapi\/authorize\/token/);
  await assert.rejects(omadaCheck({ ...conn, profile: "Nope" }, fakeOmada([])), /OMADA_PROFILE_NOT_FOUND/);
  assert.throws(() => omadaClient({ ...conn, url: "http://x" }), /OMADA_NOT_CONFIGURED/);
});

test("worker: adds a password for the checked-in stay and removes the ended stay's, with the right API calls", async () => {
  const log: string[] = [], sql: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeOmada(log);
  const pool = { async query(q: string) {
    sql.push(q);
    if (q.includes("FROM bookings")) return { rows: [{ id: 1, reference: "R1", status: "checked_in", check_in: "2026-07-01", check_out: "2026-07-05", room_id: 12 }] };
    if (q.includes("FROM guest_wifi")) return { rows: [{ booking_id: 9, psk_name: "PMS-OLD", status: "active" }] };
    return { rows: [] };
  } };
  try {
    const credentials = async () => ({ settings: { interfaceUrl: "https://euw1-omada-northbound.tplinkcloud.com", omadacId: "d7a2b74a3acaf62af37e3230d4865ae3", profile: "Guests", ssid: "Corali Guests" }, secrets: { clientId: "c", clientSecret: "s" } });
    const r = await runGuestWifi({ pool, owner: "o", credentials, seal: (v: string) => `sealed:${v}`, today: "2026-07-02" });
    assert.deepEqual(r, { added: 1, removed: 1, failed: 0 });
    assert.ok(log.some((l) => l.includes("/add-psk") && l.includes('"name":"PMS-R1"')));
    assert.ok(log.some((l) => l.includes("/delete-psk") && l.includes('"ppskNameList":["PMS-OLD"]')));
    assert.ok(sql.some((q) => q.startsWith("INSERT INTO guest_wifi")));
  } finally { globalThis.fetch = realFetch; }
});

test("bridge mode (v179): a private controller address is reached by the hotel's bridge; plan from pending / removing", async () => {
  const { privateController, bridgeWork } = await import("../scripts/omada-core.mjs");
  assert.equal(privateController("https://192.168.10.2:443"), true);
  assert.equal(privateController("10.0.0.5"), true);
  assert.equal(privateController("https://euw1-omada-northbound.tplinkcloud.com"), false);
  assert.deepEqual(bridgeWork([{ booking_id: 1, psk_name: "PMS-A", status: "pending" }, { booking_id: 2, psk_name: "PMS-B", status: "removing" }, { booking_id: 3, psk_name: "PMS-C", status: "active" }]),
    { add: [{ bookingId: 1, name: "PMS-A" }], remove: [{ bookingId: 2, name: "PMS-B" }] });
});

test("worker in bridge mode: no Omada calls — new passwords wait as pending, ended stays as removing", async () => {
  const sql: { q: string; p: unknown[] }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("no direct call in bridge mode"); }) as unknown as typeof fetch;
  const pool = { async query(q: string, p: unknown[] = []) {
    sql.push({ q, p });
    if (q.includes("FROM bookings")) return { rows: [{ id: 1, reference: "R1", status: "checked_in", check_in: "2026-07-01", check_out: "2026-07-05", room_id: 12 }] };
    if (q.includes("FROM guest_wifi")) return { rows: [{ booking_id: 9, psk_name: "PMS-OLD", status: "active" }] };
    return { rows: [] };
  } };
  try {
    const credentials = async () => ({ settings: { interfaceUrl: "https://192.168.10.2:443", omadacId: "d7a2b74a3acaf62af37e3230d4865ae3", profile: "Corali Guests", ssid: "CORALI_ROOMS" }, secrets: { clientId: "c", clientSecret: "s" } });
    const r = await runGuestWifi({ pool, owner: "o", credentials, seal: (v: string) => `sealed:${v}`, today: "2026-07-02" });
    assert.equal(r?.queued, 2);
    assert.ok(sql.some((x) => x.q.includes("'pending'") && x.p.includes("PMS-R1")));
    assert.ok(sql.some((x) => x.q.includes("SET status='removing'")));
  } finally { globalThis.fetch = realFetch; }
});
