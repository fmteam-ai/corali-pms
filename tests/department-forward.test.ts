import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { forwardConfirmation, forwardSummary, guestLang, nextStatus } from "../lib/department-forward-core.ts";

test("guest confirmation in the guest's language, with the department and the item", () => {
  assert.match(forwardConfirmation("el", "message", { el: "Spa", en: "Spa" }), /Λάβαμε το μήνυμά σας και το προωθήσαμε στο τμήμα «Spa»/);
  assert.match(forwardConfirmation("de-DE", "dept_order", { el: "Μπαρ", en: "Bar" }, "Mojito × 2"), /„Mojito × 2“.*„Bar“/);
  assert.match(forwardConfirmation("en", "seen", { el: "Εστιατόριο", en: "" }), /Εστιατόριο team/);
  assert.equal(guestLang("pt"), "en");
});

test("department line: room, first name, one line", () => {
  assert.equal(forwardSummary({ room: "112", reference: "CR-1", guest: "Anna Müller", text: "Can we have\n two towels?" }), "Δωμ. 112 · Anna: Can we have two towels?");
  assert.match(forwardSummary({ room: null, reference: "CR-9", guest: "X", text: "a".repeat(900) }), /^CR-9 · X: a+$/);
  assert.ok(forwardSummary({ room: null, reference: "CR-9", guest: "X", text: "a".repeat(900) }).length <= 600);
});

test("status only moves forward", () => {
  assert.equal(nextStatus("sent", "seen"), "seen");
  assert.equal(nextStatus("seen", "seen"), null);
  assert.equal(nextStatus("seen", "done"), "done");
  assert.equal(nextStatus("sent", "done"), "done");
  assert.equal(nextStatus("done", "done"), null);
});

test("forwarding is wired: app orders auto-forward, staff always get department alerts, the staff app has the section", async () => {
  const portal = await readFile(new URL("../lib/guest-portal.ts", import.meta.url), "utf8");
  assert.match(portal, /await autoForwardDeptOrder\(ownerId, orderId\)/);
  const push = await readFile(new URL("../lib/staff-push.ts", import.meta.url), "utf8");
  assert.match(push, /msg\.kind === "department" \|\|/);
  const staff = await readFile(new URL("../app/api/pms/staff-app/route.ts", import.meta.url), "utf8");
  assert.match(staff, /department: depts\.length > 0/);
  for (const f of ["../app/pms/messages/messages-manager.tsx", "../app/pms/guest-orders/orders-manager.tsx", "../app/pms/departments/departments-manager.tsx"]) {
    assert.match(await readFile(new URL(f, import.meta.url), "utf8"), /<ForwardToDepartment /, f);
  }
});
