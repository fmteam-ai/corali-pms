import assert from "node:assert/strict";
import test from "node:test";
import { buildDocument, invoiceXml, nextAttemptAt, parseResponse, sendInvoice, splitGross } from "../scripts/mydata-core.mjs";

const settings = { issuerVat: "123456789", accommodationVatCategory: "2", extrasVatCategory: "1", climateTaxCategory: "19" };

test("VAT-inclusive amounts split exactly", () => {
  assert.deepEqual(splitGross(45000, 2), { net: 39823, vat: 5177 });
  assert.deepEqual(splitGross(1240, 1), { net: 1000, vat: 240 });
  assert.throws(() => splitGross(100, 99));
});

test("receipt with accommodation, extras and the climate fee as other tax", () => {
  const doc = buildDocument({ invoiceType: "11.2", series: "A", aa: 17, issueDate: "2026-10-05", settings, buckets: { accommodation: 45000, extras: 2480, fees: 0, climate: 1000 }, payments: [{ method: "stripe", amountCents: 20000 }, { method: "cash", amountCents: 10000 }] });
  assert.equal(doc.lines.length, 2);
  assert.equal(doc.lines[0].otherTaxesAmount, 1000);
  assert.equal(doc.totals.gross, 45000 + 2480 + 1000);
  assert.deepEqual(doc.paymentMethods, [{ type: 7, amount: 20000 }, { type: 3, amount: 10000 }, { type: 5, amount: 18480 }], "unpaid remainder reported on credit");
  assert.equal(doc.paymentMethods.reduce((s, p) => s + p.amount, 0), doc.totals.gross);
  const xml = invoiceXml(doc);
  assert.match(xml, /<invoiceType>11\.2<\/invoiceType>/);
  assert.match(xml, /<series>A<\/series><aa>17<\/aa>/);
  assert.match(xml, /<otherTaxesPercentCategory>19<\/otherTaxesPercentCategory><otherTaxesAmount>10\.00<\/otherTaxesAmount>/);
  assert.match(xml, /<totalGrossValue>484\.80<\/totalGrossValue>/);
  assert.doesNotMatch(xml, /<counterpart>/);
  assert.match(xml, /E3_561_003/);
});

test("company invoice carries the counterpart VAT number", () => {
  const doc = buildDocument({ invoiceType: "2.1", series: "T", aa: 1, issueDate: "2026-10-05", settings, counterpart: { vatNumber: "987654321" }, buckets: { accommodation: 10000, extras: 0, fees: 0, climate: 0 } });
  const xml = invoiceXml(doc);
  assert.match(xml, /<counterpart><vatNumber>987654321<\/vatNumber><country>GR<\/country><branch>0<\/branch><\/counterpart>/);
  assert.match(xml, /E3_561_001/);
});

test("unsafe or incomplete documents are refused", () => {
  assert.throws(() => buildDocument({ invoiceType: "11.2", series: "A", aa: 1, issueDate: "2026-10-05", settings: { ...settings, climateTaxCategory: "" }, buckets: { accommodation: 10000, extras: 0, fees: 0, climate: 400 } }), /CLIMATE_TAX_CATEGORY_REQUIRED/);
  assert.throws(() => buildDocument({ invoiceType: "11.2", series: "A", aa: 1, issueDate: "2026-10-05", settings, buckets: { accommodation: 0, extras: 0, fees: 0, climate: 0 } }), /NOTHING_TO_ISSUE/);
  const doc = buildDocument({ invoiceType: "11.2", series: "A<&>", aa: 1, issueDate: "2026-10-05", settings: { ...settings, issuerVat: "" }, buckets: { accommodation: 100, extras: 0, fees: 0, climate: 0 } });
  assert.throws(() => invoiceXml(doc), /ISSUER_VAT_REQUIRED/);
  assert.match(invoiceXml({ ...doc, issuer: { vatNumber: "123456789", branch: 0 } }), /<series>A&lt;&amp;&gt;<\/series>/);
});

test("responses and transmission", async () => {
  const ok = `<ResponseDoc><response><index>1</index><invoiceUid>ABC</invoiceUid><invoiceMark>400001234567890</invoiceMark><qrUrl>https://mydata.aade.gr/qr/x</qrUrl><statusCode>Success</statusCode></response></ResponseDoc>`;
  assert.deepEqual(parseResponse(ok), { statusCode: "Success", mark: "400001234567890", uid: "ABC", qrUrl: "https://mydata.aade.gr/qr/x", cancellationMark: null, errors: [] });
  const bad = parseResponse(`<ResponseDoc><response><statusCode>ValidationError</statusCode><errors><error><message>Wrong VAT</message><code>101</code></error></errors></response></ResponseDoc>`);
  assert.deepEqual([bad.statusCode, bad.errors], ["ValidationError", ["101 Wrong VAT"]]);
  let seen: { url?: string; headers?: Record<string, string> } = {};
  const fake = (async (url: string, init: { headers: Record<string, string> }) => { seen = { url, headers: init.headers }; return new Response(ok, { status: 200 }); }) as unknown as typeof fetch;
  const result = await sendInvoice("<x/>", { username: "user", subscriptionKey: "key" }, "dev", fake);
  assert.equal(result.mark, "400001234567890");
  assert.equal(seen.url, "https://mydataapidev.aade.gr/SendInvoices");
  assert.equal(seen.headers?.["aade-user-id"], "user");
  const failed = await sendInvoice("<x/>", { username: "u", subscriptionKey: "k" }, "prod", (async () => new Response("down", { status: 503 })) as unknown as typeof fetch);
  assert.equal(failed.statusCode, "HTTP_503");
  assert.equal(nextAttemptAt(1, 0), 5 * 60_000);
  assert.equal(nextAttemptAt(20, 0), 12 * 3_600_000);
});

test("documents cover only what is not yet documented for the payer", async () => {
  const { payerBuckets, remainingBuckets, remainingPayments } = await import("../lib/fiscal-core.ts");
  const nights = [{ amount_cents: 10000, payer: "guest" }, { amount_cents: 10000, payer: "company" }];
  const entries = [
    { entry_type: "charge", category: "extra", amount_cents: 2000, payer: "guest", payment_method: null },
    { entry_type: "charge", category: "tax", amount_cents: 400, payer: "guest", payment_method: null },
    { entry_type: "discount", category: "other", amount_cents: -1000, payer: "guest", payment_method: null },
    { entry_type: "payment", category: "other", amount_cents: -5000, payer: "guest", payment_method: "stripe" },
    { entry_type: "payment", category: "other", amount_cents: -3000, payer: "guest", payment_method: "cash" },
    { entry_type: "refund", category: "other", amount_cents: 1000, payer: "guest", payment_method: "cash" },
  ];
  const guest = payerBuckets(nights, entries, "guest");
  assert.deepEqual(guest, { accommodation: 9000, extras: 2000, fees: 0, climate: 400 });
  assert.deepEqual(payerBuckets(nights, entries, "company"), { accommodation: 10000, extras: 0, fees: 0, climate: 0 });
  assert.deepEqual(remainingBuckets(guest, [{ accommodation: 9000, extras: 0, fees: 0, climate: 400 }]), { accommodation: 0, extras: 2000, fees: 0, climate: 0 });
  assert.deepEqual(remainingPayments(entries, "guest", []), [{ method: "stripe", amountCents: 5000 }, { method: "cash", amountCents: 2000 }]);
  assert.deepEqual(remainingPayments(entries, "guest", [[{ type: 7, amount: 5000 }, { type: 5, amount: 999 }]]), [{ method: "cash", amountCents: 2000 }], "declared payments are not declared twice; on-credit parts are ignored");
});
