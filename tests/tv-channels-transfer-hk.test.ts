import assert from "node:assert/strict";
import test from "node:test";
import { dueServices, nextServiceDate, normalizeHkServiceSettings } from "../lib/hk-services-core.ts";
import { channelSource, normalizeTvChannels } from "../lib/tv-channels-core.ts";
import { defaultTransferTime, transferDays, transferProblem, transferSummary } from "../lib/tv-requests-core.ts";

test("TV channels: YouTube, HLS and video links; only https", () => {
  assert.equal(channelSource("https://www.youtube.com/watch?v=abcdefghijk")?.kind, "youtube");
  assert.match((channelSource("https://youtu.be/abcdefghijk") as { embedUrl: string }).embedUrl, /^https:\/\/www\.youtube\.com\/embed\/abcdefghijk\?autoplay=1/);
  assert.match((channelSource("https://www.youtube.com/channel/UCSrZ3UV4jOidv8ppoVuvW9Q/live") as { embedUrl: string }).embedUrl, /live_stream\?channel=UCSrZ3UV4jOidv8ppoVuvW9Q/);
  assert.deepEqual(channelSource("https://cdn.example.com/live/index.m3u8"), { kind: "hls", url: "https://cdn.example.com/live/index.m3u8" });
  assert.equal(channelSource("http://cdn.example.com/live/index.m3u8"), null);
  assert.equal(channelSource("https://www.youtube.com/watch?v=short"), null);
  const list = normalizeTvChannels([{ name: "A", url: "https://youtu.be/abcdefghijk", category: "news" }, { name: "", url: "https://youtu.be/abcdefghijk" }, { name: "B", url: "javascript:alert(1)" }, { name: "C", url: "https://x.example/v.mp4", category: "bogus" }]);
  assert.deepEqual(list.map((c) => [c.name, c.category]), [["A", "news"], ["C", "other"]]);
});

test("TV transfer: days, time limits and the reception summary", () => {
  assert.deepEqual(transferDays("2026-10-26", "2026-10-29"), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]);
  assert.deepEqual(transferDays("2026-10-26", null), ["2026-10-26", "2026-10-27"]);
  const ok = { destination: "port" as const, date: "2026-10-26", time: "10:30", people: 2 };
  assert.equal(transferProblem(ok, "2026-10-26", "10:00", "2026-10-29"), null);
  assert.equal(transferProblem({ ...ok, time: "10:10" }, "2026-10-26", "10:00", "2026-10-29"), "TIME");
  assert.equal(transferProblem({ ...ok, date: "2026-11-30" }, "2026-10-26", "10:00", "2026-10-29"), "DATE");
  assert.equal(transferProblem({ ...ok, people: 0 }, "2026-10-26", "10:00", "2026-10-29"), "PEOPLE");
  assert.deepEqual(defaultTransferTime("08:50"), { dayOffset: 0, time: "09:30" });
  assert.deepEqual(defaultTransferTime("23:30"), { dayOffset: 1, time: "09:00" });
  assert.match(transferSummary({ ...ok, destination: "airport" }, "el"), /^→ Αεροδρόμιο · .* 10:30 · 2 άτομα$/);
});

test("Housekeeping: sheets / towels every N nights, never on arrival or departure day", () => {
  const s = normalizeHkServiceSettings({ sheetsEvery: 3, towelsEvery: 2, reminderHour: 9 });
  const stay = ["2026-10-20", "2026-10-27"] as const;
  assert.deepEqual(dueServices(...stay, "2026-10-20", s), []);
  assert.deepEqual(dueServices(...stay, "2026-10-22", s), ["towels"]);
  assert.deepEqual(dueServices(...stay, "2026-10-23", s), ["sheets"]);
  assert.deepEqual(dueServices(...stay, "2026-10-26", s), ["sheets", "towels"]);
  assert.deepEqual(dueServices(...stay, "2026-10-27", s), []);
  assert.equal(nextServiceDate(...stay, "2026-10-23", s, "sheets"), "2026-10-26");
  assert.equal(nextServiceDate(...stay, "2026-10-26", s, "sheets"), null);
  assert.deepEqual(dueServices(...stay, "2026-10-22", { ...s, towelsEvery: 0 }), []);
  assert.deepEqual(normalizeHkServiceSettings({ sheetsEvery: -1, towelsEvery: "x", reminderHour: 40 }), { sheetsEvery: 3, towelsEvery: 2, reminderHour: 9 });
});

test("TV technical problem: every problem has labels and a reception summary", async () => {
  const { problemSummary, requestDetailsSummary, tvProblemLabels, tvProblemTexts, tvProblems } = await import("../lib/tv-requests-core.ts");
  for (const p of tvProblems) {
    assert.ok(tvProblemLabels[p].el && tvProblemLabels[p].en);
    for (const lang of ["el", "en", "fr", "de", "it", "es"] as const) assert.ok(tvProblemTexts[lang][p], `${lang}.${p}`);
  }
  assert.equal(problemSummary({ problem: "ac" }, "el"), "→ Κλιματιστικό");
  assert.equal(requestDetailsSummary({ problem: "safe" }, "en"), "→ Safe");
  assert.equal(requestDetailsSummary(null, "el"), "");
});

test("TV apps: catalog apps by key, custom apps need a valid package; departure clean adds the sign-out step", async () => {
  const { normalizeTvApps } = await import("../lib/tv-apps-core.ts");
  const { checklistFor, validChecklist, housekeepingChecklist } = await import("../lib/housekeeping.ts");
  const apps = normalizeTvApps([{ key: "netflix" }, { key: "netflix" }, { name: "ERTFLIX", packages: "gr.ert.ertflix", color: "#0055a4" }, { name: "Bad", packages: ["not a package"] }, { key: "youtube", name: "YouTube TV" }]);
  assert.deepEqual(apps.map((a) => [a.key, a.name, a.packages[0]]), [["netflix", "Netflix", "com.netflix.ninja"], ["custom:gr.ert.ertflix", "ERTFLIX", "gr.ert.ertflix"], ["youtube", "YouTube TV", "com.google.android.youtube.tv"]]);
  assert.equal(checklistFor("departure_clean").length, housekeepingChecklist.length + 1);
  assert.equal(checklistFor("stayover_clean").length, housekeepingChecklist.length);
  const twelve = Object.fromEntries(housekeepingChecklist.map((k) => [k, true]));
  assert.equal(validChecklist(twelve, "stayover_clean"), true);
  assert.equal(validChecklist(twelve, "departure_clean"), false);
  assert.equal(validChecklist({ ...twelve, tv_apps_logout: true }, "departure_clean"), true);
});
