import assert from "node:assert/strict";
import test from "node:test";
import { defaultInfoSections, fillInfo, MAX_INFO_SECTIONS, normalizeInfoSections } from "../lib/tv-info.ts";
import { normalizeTvSettings } from "../lib/tv-core.ts";

test("welcome letter tabs are the default and every default has English and Greek", () => {
  assert.deepEqual(normalizeTvSettings({}).info.map((x) => x.key), ["checkin", "rates", "housekeeping", "reception", "important", "checkout"]);
  for (const s of defaultInfoSections) assert.ok(s.title.en && s.title.el && s.body.en && s.body.el, s.key);
});

test("saved tabs are cleaned: limits, unique keys, an empty list stays empty", () => {
  assert.deepEqual(normalizeInfoSections([]), []);
  const many = Array.from({ length: 15 }, () => ({ key: "dup", icon: "", title: { en: "T", xx: "no" }, body: { en: "B".repeat(3000) } }));
  const out = normalizeInfoSections(many);
  assert.equal(out.length, MAX_INFO_SECTIONS);
  assert.equal(new Set(out.map((x) => x.key)).size, MAX_INFO_SECTIONS);
  assert.equal(out[0].icon, "ℹ️");
  assert.deepEqual(Object.keys(out[0].title), ["en"]);
  assert.equal(out[0].body.en?.length, 2500);
});

test("placeholders are filled from the TV settings", () => {
  assert.equal(fillInfo("In {checkIn}, out {checkOut}, {wifi} / {password}", { checkIn: "13:00", checkOut: "11:00", wifi: "Corali", password: "" }), "In 13:00, out 11:00, Corali / —");
});

test("accepted cards live under room rates; saved untouched defaults are upgraded, edited texts are kept", () => {
  const rates = defaultInfoSections.find((s) => s.key === "rates")!, important = defaultInfoSections.find((s) => s.key === "important")!;
  assert.match(rates.body.en!, /^Room rates include VAT[^\n]*\n\*\*Accepted cards:\*\* Visa, Mastercard, Maestro\n/);
  assert.doesNotMatch(important.body.en!, /Accepted cards/);
  assert.doesNotMatch(important.body.el!, /Κάρτες/);
  const oldRates = rates.body.en!.replace("\n**Accepted cards:** Visa, Mastercard, Maestro", "");
  const oldImportant = important.body.en! + "\n**Accepted cards:** Visa, Mastercard, Maestro";
  const saved = normalizeInfoSections([{ ...rates, body: { en: oldRates } }, { ...important, body: { en: oldImportant, el: "My own text" } }]);
  assert.equal(saved[0].body.en, rates.body.en);
  assert.equal(saved[1].body.en, important.body.en);
  assert.equal(saved[1].body.el, "My own text");
});

test("v93: the untouched Wi-Fi tab is dropped and Reception gains rentals, trips and the library; edited texts stay", () => {
  const oldWifi = { key: "wifi", icon: "📶", title: { en: "Wi-Fi & facilities", el: "Wi-Fi & παροχές" }, body: {
    en: "Hotel Corali provides **high-speed internet access up to 350 Mbps with Starlink**.\nWi-Fi is available throughout the hotel.\n- Network: **{wifi}**\n- Password: **{password}**\nGuests may also use our lending library and computer/printer facilities.",
    el: "Το Hotel Corali προσφέρει **γρήγορο internet έως 350 Mbps μέσω Starlink**.\nΤο Wi-Fi είναι διαθέσιμο σε όλο το ξενοδοχείο.\n- Δίκτυο: **{wifi}**\n- Κωδικός: **{password}**\nΜπορείτε επίσης να χρησιμοποιήσετε τη δανειστική μας βιβλιοθήκη και τον υπολογιστή/εκτυπωτή.",
  } };
  const oldReception = { key: "reception", icon: "🛎️", title: { en: "Reception", el: "Ρεσεψιόν" }, body: {
    en: "Reception is open daily: **07:30 – 21:00**\nPlease do not hesitate to contact us if you need assistance or experience any problem during your stay. We will be happy to help.",
    el: "Η ρεσεψιόν είναι ανοιχτή καθημερινά: **07:30 – 21:00**\nΜη διστάσετε να επικοινωνήσετε μαζί μας αν χρειάζεστε βοήθεια ή αντιμετωπίσετε οποιοδήποτε πρόβλημα κατά τη διαμονή σας. Θα χαρούμε να βοηθήσουμε.",
  } };
  const out = normalizeInfoSections([oldWifi, oldReception]);
  assert.deepEqual(out.map((x) => x.key), ["reception"]);
  assert.match(out[0].body.el!, /ενοικιάσεις αυτοκινήτων ή μηχανακιών/);
  assert.match(out[0].body.el!, /δανειστική μας βιβλιοθήκη/);
  assert.ok(out[0].body.fr && out[0].title.de);
  const edited = normalizeInfoSections([{ ...oldWifi, body: { ...oldWifi.body, en: "Our own text" } }, { ...oldReception, body: { el: "Δικό μας" } }]);
  assert.deepEqual(edited.map((x) => [x.key, x.body.el]), [["wifi", oldWifi.body.el], ["reception", "Δικό μας"]]);
  assert.match(normalizeTvSettings({}).wifiNote.el!, /350 Mbps μέσω Starlink/);
});
