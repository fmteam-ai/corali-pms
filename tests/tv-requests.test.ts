import assert from "node:assert/strict";
import test from "node:test";
import { initialStatus, isTvRequestKind, tvRequestKinds, tvRequestLabels, tvRequestTexts } from "../lib/tv-requests-core.ts";

test("TV requests: only known kinds are accepted", () => {
  assert.ok(isTvRequestKind("towels"));
  assert.ok(!isTvRequestKind("dnd"));
  assert.ok(!isTvRequestKind("drop table"));
});

test("TV requests: do not disturb is information, other requests wait for staff", () => {
  assert.equal(initialStatus("dnd_on"), "info");
  assert.equal(initialStatus("dnd_off"), "info");
  for (const k of tvRequestKinds) assert.equal(initialStatus(k), "open");
});

test("TV requests: every kind has PMS labels and TV texts in all six languages", () => {
  for (const k of [...tvRequestKinds, "dnd_on", "dnd_off"] as const) assert.ok(tvRequestLabels[k].el && tvRequestLabels[k].en && tvRequestLabels[k].icon);
  for (const lang of ["el", "en", "fr", "de", "it", "es"] as const) {
    const t = tvRequestTexts[lang];
    for (const k of tvRequestKinds) assert.ok(t[k], `${lang}.${k}`);
    for (const k of ["tab", "intro", "sent", "already", "failed", "dnd", "dndHint", "dndOn", "dndOff", "mine", "stOpen", "stDone", "stCancelled", "cancel", "confirmCancel"] as const) assert.ok(t[k], `${lang}.${k}`);
  }
});
