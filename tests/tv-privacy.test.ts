// v161 — guest app data clearing at check-out: the kit's own tests (tests/logic + tests/inventory of the
// "Unified Staging" package) plus the PMS integration's additions (guest apps, Cast probe, shared copy).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  APPROVED_PACKAGES, PROTECTED_PACKAGES, PILOT_VERIFIED_PACKAGES, parseThirdPartyPackages, addedThirdPartyPackages,
  normalizeAppResult, classifyResults, containsNewGuest, isSafeJob, isRemovableGuestPackage, normalizeUninstallResult, TV_CAPABILITIES,
  agentOutcome, agentRetryDelayMs,
} from "../scripts/tv-privacy-core.mjs";
// @ts-expect-error plain .mjs from the on-prem gateway (no type declarations)
import { createAdbAdapter } from "../tools/tv-privacy-gateway/gateway/adb-adapter.mjs";
// @ts-expect-error plain .mjs from the on-prem gateway (no type declarations)
import { castMessage, readPayloads } from "../tools/tv-privacy-gateway/gateway/cast-wake.mjs";

// --- kit: inventory.test.mjs
test("all five identified app package names are present", () => {
  assert.deepEqual(new Set(APPROVED_PACKAGES), new Set(["com.google.android.youtube.tv", "com.netflix.ninja", "com.amazon.amazonvideo.livingroom", "com.disney.disneyplus", "com.google.android.youtube.tvmusic"]));
});
test("no protected package is in the clear allowlist", () => { for (const p of PROTECTED_PACKAGES) assert.equal(APPROVED_PACKAGES.includes(p), false); });
test("pilot default only clears packages actually verified on the TV", () => {
  assert.deepEqual(PILOT_VERIFIED_PACKAGES, ["com.google.android.youtube.tv", "com.netflix.ninja", "com.amazon.amazonvideo.livingroom"]);
});
test("baseline comparison uses package names and flags additions", () => {
  const baseline = parseThirdPartyPackages("package:gr.hotelcorali.tv\npackage:com.disney.disneyplus\npackage:com.amazon.amazonvideo.livingroom\n");
  const current = parseThirdPartyPackages("package:com.spotify.tv.android\npackage:com.amazon.amazonvideo.livingroom\npackage:gr.hotelcorali.tv\npackage:com.disney.disneyplus\n");
  assert.deepEqual(addedThirdPartyPackages(baseline, current), ["com.spotify.tv.android"]);
  assert.deepEqual(addedThirdPartyPackages(current, current), []);
});

// --- kit: logic.test.mjs
test("allowlist rejects protected Google / agent packages and command injection", () => {
  assert.throws(() => normalizeAppResult({ package: "com.google.android.gms", status: "CLEARED_LOCAL" }));
  assert.throws(() => normalizeAppResult({ package: "com.netflix.ninja;rm", status: "CLEARED_LOCAL" }));
});
test("success is never account-verified; manual review required", () => {
  assert.equal(classifyResults(APPROVED_PACKAGES.map((p) => ({ package: p, status: "CLEARED_LOCAL", code: "" })), false), "CLEARED_LOCAL_NEEDS_REVIEW");
});
test("an unreported app refuses the cleared status", () => {
  assert.equal(classifyResults([{ package: APPROVED_PACKAGES[0], status: "CLEARED_LOCAL", code: "" }], false), "UNVERIFIED");
});
test("a new guest blocks the old queued clearing", () => {
  assert.equal(containsNewGuest([{ id: 2, status: "checked_in" }], { booking_id: 1, checkout_at_ms: 100 }), true);
  assert.equal(containsNewGuest([{ id: 1, status: "checked_out" }], { booking_id: 1, checkout_at_ms: 100 }), false);
  assert.equal(containsNewGuest([{ id: 2, status: "checked_out", checked_in_at: 105 }], { booking_id: 1, checkout_at_ms: 100 }), true);
});
test("a claim must match the approved packages and the exact physical TV identity", () => {
  const job = { id: 1, roomId: 42, leaseToken: "b".repeat(64), packages: [...APPROVED_PACKAGES] };
  assert.equal(isSafeJob(job, { serial: "192.168.10.120:5555", androidId: "0123456789abcdef" }), true);
  assert.equal(isSafeJob(job, { serial: "192.168.10.120:5555", androidId: "not_known" }), false);
});
test("ADB gets fixed arguments, never a shell-interpolated package id", async () => {
  const calls: string[][] = [];
  const mock = async (_f: string, args: string[]) => { calls.push(args); return { stdout: args[3] === "settings" ? "0123456789abcdef" : args[2] === "get-state" ? "device" : args[4] === "path" ? "package:/system/app/Netflix.apk" : "Success" }; };
  const adapter = createAdbAdapter({ adbPath: "adb", serial: "192.168.10.120:5555", androidId: "0123456789abcdef", execFileAsync: mock });
  const answer = await adapter.clearPackage("com.netflix.ninja", { dryRun: false });
  assert.equal(answer.status, "CLEARED_LOCAL");
  assert.deepEqual(calls.at(-1), ["-s", "192.168.10.120:5555", "shell", "pm", "clear", "com.netflix.ninja"]);
});
test("identity mismatch fails closed before pm clear", async () => {
  const calls: string[][] = [];
  const mock = async (_f: string, args: string[]) => { calls.push(args); return { stdout: "abcdef0123456789" }; };
  const adapter = createAdbAdapter({ adbPath: "adb", serial: "192.168.10.120:5555", androidId: "0123456789abcdef", execFileAsync: mock });
  await assert.rejects(() => adapter.clearPackage("com.netflix.ninja", { dryRun: false }), /ANDROID_ID_MISMATCH/);
  assert.equal(calls.some((a) => a.includes("clear")), false);
});

// --- PMS integration additions
test("guest apps: only plain, non-protected, non-hotel package ids can be removed", () => {
  assert.equal(isRemovableGuestPackage("com.spotify.tv.android"), true);
  for (const p of [...PROTECTED_PACKAGES, ...APPROVED_PACKAGES, "com.google.android.youtube", "com.android.vending", "com.realtek.tv", "com.expressluck.tvfactory", "gr.hotelcorali.tv", "a;rm -rf", "nodots", ""]) assert.equal(isRemovableGuestPackage(p), false, p);
  assert.equal(isRemovableGuestPackage("com.spotify.tv.android", ["com.spotify.tv.android"]), false);
  assert.deepEqual(normalizeUninstallResult({ status: "REMOVED", code: "x-y" }), { status: "REMOVED", code: "" });
  assert.equal(normalizeUninstallResult({ status: "WHATEVER" }).status, "FAILED");
});
test("guest app removal: identity first, third-party only, pm uninstall --user 0 with fixed arguments", async () => {
  const calls: string[][] = [];
  const mock = async (_f: string, args: string[]) => {
    calls.push(args);
    if (args[3] === "settings") return { stdout: "0123456789abcdef" };
    if (args[2] === "get-state") return { stdout: "device" };
    if (args.includes("list")) return { stdout: "package:gr.hotelcorali.tv\npackage:com.spotify.tv.android" };
    return { stdout: "Success" };
  };
  const adapter = createAdbAdapter({ adbPath: "adb", serial: "10.0.0.5:5555", androidId: "0123456789abcdef", execFileAsync: mock });
  assert.deepEqual(await adapter.uninstallPackage("com.spotify.tv.android"), { status: "REMOVED", code: "ADB_PM_UNINSTALL_SUCCESS" });
  assert.deepEqual(calls.at(-1), ["-s", "10.0.0.5:5555", "shell", "pm", "uninstall", "--user", "0", "com.spotify.tv.android"]);
  assert.equal((await adapter.uninstallPackage("com.other.app")).status, "NOT_INSTALLED");
  const before = calls.length;
  assert.equal((await adapter.uninstallPackage("gr.hotelcorali.tv")).status, "BLOCKED_PROTECTED");
  assert.equal(calls.length, before, "a protected package never reaches ADB");
});
test("Cast wake probe: CASTV2 framing (length prefix + protobuf fields) round-trips", () => {
  const m = castMessage("sender-corali", "receiver-0", "urn:x-cast:com.google.cast.receiver", { type: "LAUNCH", appId: "CC1AD845", requestId: 1 });
  assert.equal(m.readUInt32BE(0), m.length - 4);
  assert.equal(m[4], 0x08);
  const { payloads, rest } = readPayloads(m);
  assert.deepEqual(JSON.parse(payloads[0]), { type: "LAUNCH", appId: "CC1AD845", requestId: 1 });
  assert.equal(rest.length, 0);
});
test("capabilities never claim Power ON or remote locks as working", () => {
  assert.equal(TV_CAPABILITIES.powerOn.status, "UNSUPPORTED");
  assert.equal(TV_CAPABILITIES.menuLock.status, "OEM_BRIDGE_REQUIRED");
  assert.equal(TV_CAPABILITIES.channelScanLock.status, "OEM_BRIDGE_REQUIRED");
});
test("the gateway's shared copy is identical to the PMS core", () => {
  assert.equal(fs.readFileSync("tools/tv-privacy-gateway/shared/privacy-core.mjs", "utf8"), fs.readFileSync("scripts/tv-privacy-core.mjs", "utf8"));
});

// ---- v162: the TV clears itself (Corali TV 1.13)
const allApps = (status = "CLEARED_LOCAL") => APPROVED_PACKAGES.map((p) => ({ package: p, status }));
const clean = { adb: "PASS", baseline: true, results: allApps(), guestApps: [], cache: true, accounts: 0, profiles: 0, profilesRemoved: 0, bluetooth: 0, welcome: true };

test("v162: READY only with evidence for every step", () => {
  assert.equal(agentOutcome(clean).status, "READY");
  assert.equal(agentOutcome({ ...clean, results: [...allApps().slice(0, 4), { package: APPROVED_PACKAGES[4], status: "NOT_INSTALLED" }] }).status, "READY");
  for (const missing of ["cache", "welcome"]) assert.equal(agentOutcome({ ...clean, [missing]: undefined }).status, "RETRY_PENDING", missing);
  for (const missing of ["accounts", "profiles", "bluetooth"]) assert.equal(agentOutcome({ ...clean, [missing]: undefined }).status, "RETRY_PENDING", missing);
  assert.equal(agentOutcome({ ...clean, results: allApps().slice(0, 4) }).status, "RETRY_PENDING");
  assert.equal(agentOutcome({}).status, "RETRY_PENDING");
  assert.equal(agentOutcome(null).status, "RETRY_PENDING");
});

test("v162: failures retry, ADB unavailable retries, missing baseline needs staff", () => {
  const f = agentOutcome({ ...clean, results: [...allApps().slice(0, 4), { package: APPROVED_PACKAGES[4], status: "FAILED" }] });
  assert.equal(f.status, "RETRY_PENDING"); assert.deepEqual(f.pending, ["APPS"]);
  assert.equal(agentOutcome({ ...clean, adb: "PORT_CLOSED" }).code, "ADB_PORT_CLOSED");
  assert.equal(agentOutcome({ ...clean, guestApps: [{ package: "com.spotify.tv.android", status: "FAILED" }] }).status, "RETRY_PENDING");
  assert.equal(agentOutcome({ ...clean, baseline: false }).status, "NEEDS_STAFF");
});

test("v162: guest Google account / profile / Bluetooth pairing keep the room pending for staff", () => {
  const r = agentOutcome({ ...clean, accounts: 1, bluetooth: 2 });
  assert.equal(r.status, "NEEDS_STAFF");
  assert.deepEqual(r.pending, ["GUEST_GOOGLE_ACCOUNT", "GUEST_BLUETOOTH"]);
  assert.equal(agentOutcome({ ...clean, profiles: 1, profilesRemoved: 1 }).status, "NEEDS_STAFF");
  assert.equal(agentOutcome({ ...clean, profiles: 0, profilesRemoved: 1 }).status, "READY");
});

test("v162: protected packages are never accepted as guest apps; counts are bounded; retries never stop", () => {
  const r = agentOutcome({ ...clean, guestApps: [{ package: "com.google.android.gms", status: "CLEARED_LOCAL" }, { package: "gr.hotelcorali.tv", status: "CLEARED_LOCAL" }, { package: "x; rm -rf /", status: "CLEARED_LOCAL" }, { package: "com.spotify.tv.android", status: "CLEARED_LOCAL" }] });
  assert.deepEqual(r.checks.guestApps.map((g) => g.package), ["com.spotify.tv.android"]);
  assert.equal(agentOutcome({ ...clean, accounts: -1 }).status, "RETRY_PENDING");
  assert.equal(agentOutcome({ ...clean, accounts: "1e9" }).status, "RETRY_PENDING");
  assert.deepEqual([1, 2, 3, 4, 5, 50].map((n) => agentRetryDelayMs(n) / 60_000), [2, 5, 10, 20, 30, 30]);
});
