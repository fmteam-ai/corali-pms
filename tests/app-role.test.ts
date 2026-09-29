import assert from "node:assert/strict";
import test from "node:test";
import { routeForRole } from "../lib/app-role.ts";

test("booking role never exposes PMS pages or APIs", () => {
  assert.deepEqual(routeForRole("booking", "/"), { action: "redirect", destination: "/book" });
  assert.deepEqual(routeForRole("booking", "/login"), { action: "redirect", destination: "/book" });
  assert.deepEqual(routeForRole("booking", "/pms/reservations"), { action: "redirect", destination: "/book" });
  assert.deepEqual(routeForRole("booking", "/api/auth/login"), { action: "not-found" });
  assert.deepEqual(routeForRole("booking", "/api/pms/users"), { action: "not-found" });
  assert.deepEqual(routeForRole("booking", "/book"), { action: "allow" });
  assert.deepEqual(routeForRole("booking", "/pay-balance"), { action: "allow" });
  assert.deepEqual(routeForRole("booking", "/api/public/availability"), { action: "allow" });
});

test("PMS role never serves booking pages or public booking APIs", () => {
  assert.deepEqual(routeForRole("pms", "/"), { action: "redirect", destination: "/login" });
  assert.deepEqual(routeForRole("pms", "/book"), { action: "redirect", destination: "/book" });
  assert.deepEqual(routeForRole("pms", "/check-in"), { action: "redirect", destination: "/check-in" });
  assert.deepEqual(routeForRole("pms", "/review"), { action: "redirect", destination: "/review" });
  assert.deepEqual(routeForRole("booking", "/review"), { action: "allow" });
  assert.deepEqual(routeForRole("pms", "/pay-balance"), { action: "redirect", destination: "/pay-balance" });
  assert.deepEqual(routeForRole("pms", "/api/public/checkout"), { action: "not-found" });
  assert.deepEqual(routeForRole("pms", "/api/webhooks/stripe"), { action: "not-found" });
  assert.deepEqual(routeForRole("pms", "/login"), { action: "allow" });
  assert.deepEqual(routeForRole("pms", "/api/auth/login"), { action: "allow" });
});
