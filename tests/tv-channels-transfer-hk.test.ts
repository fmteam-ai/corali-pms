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
