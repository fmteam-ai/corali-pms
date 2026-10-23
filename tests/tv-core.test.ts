import assert from "node:assert/strict";
import test from "node:test";
import { beaufort, currentStay, defaultTvSettings, firstName, normalizeTvSettings, pickText, tvLanguage, tvTexts, weatherIcon, wifiQrPayload, type TvStay } from "../lib/tv-core.ts";

const stay = (ref: string, checkIn: string, checkOut: string, status = "confirmed"): TvStay => ({ reference: ref, guest_name: `Maria ${ref} Papadopoulou`, guest_language: "el", check_in: checkIn, check_out: checkOut, status, adults: 2, children: 0 });

test("a room shows the guest in house, the departing guest until check-out time, then the arriving guest", () => {
  const leaving = stay("A", "2027-05-01", "2027-05-05", "checked_in"), arriving = stay("B", "2027-05-05", "2027-05-09");
  assert.deepEqual(currentStay([leaving], "2027-05-03", "20:00", "11:00"), { mode: "stay", stay: leaving, departureToday: false });
  assert.deepEqual(currentStay([leaving, arriving], "2027-05-05", "09:30", "11:00"), { mode: "stay", stay: leaving, departureToday: true });
  assert.deepEqual(currentStay([leaving, arriving], "2027-05-05", "11:00", "11:00"), { mode: "stay", stay: arriving, departureToday: false });
  assert.deepEqual(currentStay([leaving], "2027-05-05", "12:00", "11:00"), { mode: "idle" });
  assert.deepEqual(currentStay([stay("C", "2027-05-01", "2027-05-05", "cancelled")], "2027-05-03", "12:00", "11:00"), { mode: "idle" });
  assert.deepEqual(currentStay([stay("D", "2027-05-04", "2027-05-06")], "2027-05-03", "23:00", "11:00"), { mode: "idle" });
});

test("only the first name is shown", () => {
  assert.equal(firstName("  Maria   Papadopoulou "), "Maria");
  assert.equal(firstName(""), "");
});

test("Wi-Fi QR payload escapes special characters and supports open networks", () => {
  assert.equal(wifiQrPayload("Corali Guests", "sea;sun:2027"), "WIFI:T:WPA;S:Corali Guests;P:sea\\;sun\\:2027;;");
  assert.equal(wifiQrPayload("Open", ""), "WIFI:T:nopass;S:Open;P:;;");
});

test("settings are normalised with defaults and limits", () => {
  const s = normalizeTvSettings({ wifiSsid: " Corali ", checkOutTime: "25:00", checkInTime: "14:30", welcome: { en: "Hi", xx: "no" }, showWeather: false, tips: "bad" });
  assert.equal(s.wifiSsid, "Corali");
  assert.equal(s.checkOutTime, "11:00");
  assert.equal(s.checkInTime, "14:30");
  assert.deepEqual(s.welcome, { en: "Hi" });
  assert.deepEqual(s.tips, defaultTvSettings.tips);
  assert.equal(s.showWeather, false);
  assert.equal(s.showExtras, true);
  assert.deepEqual(normalizeTvSettings(null), defaultTvSettings);
});

test("texts fall back to English and every language has every screen text", () => {
  assert.equal(pickText({ en: "Hello", el: "Γεια" }, "de"), "Hello");
  assert.equal(pickText({ el: "Γεια" }, "fr"), "Γεια");
  assert.equal(tvLanguage("de-AT"), "de");
  assert.equal(tvLanguage("ru"), "en");
  const keys = Object.keys(tvTexts.en).sort();
  for (const lang of Object.keys(tvTexts) as (keyof typeof tvTexts)[]) assert.deepEqual(Object.keys(tvTexts[lang]).sort(), keys, lang);
});

test("weather icons and Beaufort scale", () => {
  assert.equal(weatherIcon(0), "☀️");
  assert.equal(weatherIcon(61), "🌧️");
  assert.equal(beaufort(0), 0);
  assert.equal(beaufort(25), 4);
  assert.equal(beaufort(45), 6);
  assert.equal(beaufort(130), 12);
});
