import assert from "node:assert/strict";
import test from "node:test";
import { buttonLabel, normalizeBrand, renderBrandedEmail, stayDate, whatsappSignature, whatsappTemplateSuggestions, withFallbacks, whatsappTemplatePayload, whatsappTemplateProblems, WHATSAPP_TEMPLATE_LANGS } from "../scripts/email-brand-core.mjs";
import { whatsappVariables } from "../scripts/automation-core.mjs";

test("brand: defaults, cleaned website / e-mail, fallbacks from the PMS", () => {
  const b = normalizeBrand({ name: " Hotel Corali ", website: "hotelcorali.gr", email: "not-an-email", accent: "red" });
  assert.equal(b.name, "Hotel Corali");
  assert.equal(b.website, "https://hotelcorali.gr");
  assert.equal(b.email, "");
  assert.equal(b.accent, "#c9a227");
  assert.equal(b.address, "Πίσω Λιβάδι, Πάρος 844 00");
  const f = withFallbacks(b, { phone: "+30 22840 41000", email: "Hotel Corali <corali@hotelcorali.gr>" });
  assert.equal(f.phone, "+30 22840 41000");
  assert.equal(f.email, "corali@hotelcorali.gr");
});

test("branded e-mail: logo, escaped text, bold, button for links, contact details", () => {
  const html = renderBrandedEmail({ subject: "Άφιξη", lang: "el", logoUrl: "https://b.example/logo.png", brand: { phone: "+30 1", email: "a@b.gr" }, text: "Γεια σας <b>Maria</b>,\n\nσας περιμένουμε την **Παρασκευή**.\n\nOnline check-in: https://b.example/check-in/x?a=1&b=2\n\n- Wi-Fi\n- Πρωινό" });
  assert.match(html, /<img src="https:\/\/b\.example\/logo\.png"/);
  assert.match(html, /&lt;b&gt;Maria&lt;\/b&gt;/);
  assert.match(html, /<strong>Παρασκευή<\/strong>/);
  assert.match(html, /href="https:\/\/b\.example\/check-in\/x\?a=1&amp;b=2"[^>]*>Online check-in →/);
  assert.match(html, /<li[^>]*>Wi-Fi<\/li>/);
  assert.match(html, /mailto:a@b\.gr/);
  assert.match(html, /tel:\+301/);
  assert.match(html, /🌐 hotelcorali\.gr/);
  assert.equal(buttonLabel("https://x/pay-balance/1", "de"), "Jetzt bezahlen");
});

test("dates in the guest's language; WhatsApp signature and Meta templates", () => {
  assert.equal(stayDate("2026-06-12", "el"), "Παρασκευή 12 Ιουνίου 2026");
  assert.match(stayDate("2026-06-12", "en"), /^Friday,? 12 June 2026$/);
  assert.equal(stayDate("soon", "en"), "soon");
  assert.match(whatsappSignature({ phone: "+30 1" }), /\*Hotel Corali\*\n📍 Πίσω Λιβάδι, Πάρος 844 00\n☎ \+30 1\n🌐 hotelcorali\.gr$/);
  assert.equal(whatsappSignature({ whatsappSignature: false }), "");
  const t = whatsappTemplateSuggestions({});
  assert.ok(t.find((x) => x.event === "confirmation")?.el.includes("{{3}}"));
  assert.ok(t.every((x) => x.footer.length <= 60));
});

test("WhatsApp templates for Meta: six languages, Meta's rules, same variable count the PMS sends", () => {
  const t = whatsappTemplateSuggestions({ name: "Hotel Corali ✨", website: "https://hotelcorali.gr/" });
  assert.equal(t.length, 9);
  for (const s of t) {
    assert.match(s.name, /^[a-z0-9_]+$/);
    assert.equal(s.headerText, "Hotel Corali");
    const sent = whatsappVariables(s.event, { name: "a", reference: "b", checkIn: "c", checkOut: "d", amount: "e", link: "f", deadline: "g", reason: "h", refund: "i" });
    assert.equal(s.samples.length, sent.length, s.event);
    for (const lang of WHATSAPP_TEMPLATE_LANGS) {
      assert.deepEqual(whatsappTemplateProblems(s.texts[lang], s.samples.length), [], `${s.name} ${lang}`);
      const p = whatsappTemplatePayload(s, lang);
      assert.equal(p.language, lang);
      assert.equal(p.category, "UTILITY");
      assert.deepEqual(p.components.map((c) => c.type), ["HEADER", "BODY", "FOOTER"]);
    }
  }
  assert.deepEqual(whatsappTemplateProblems("{{1}} hello", 1), ["STARTS_WITH_VARIABLE"]);
  assert.deepEqual(whatsappTemplateProblems("Hello {{1}}", 1), ["ENDS_WITH_VARIABLE"]);
  assert.deepEqual(whatsappTemplateProblems("Hi {{1}}{{2}} ok", 2), ["ADJACENT_VARIABLES"]);
  assert.deepEqual(whatsappTemplateProblems("Hi {{1}} and {{3}} ok", 2), ["VARIABLES_NOT_SEQUENTIAL"]);
  assert.deepEqual(whatsappTemplateProblems("Hello {{1}}, your reservation {{2}} is confirmed for {{3}} to {{4}}. Bye", 3), ["SAMPLE_COUNT"]);
});
