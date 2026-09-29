// AADE myDATA (REST, InvoicesDoc v1.0) document building and transmission. Plain ESM so both the PMS and the
// cron retry worker use the same code. Codes that depend on the hotel's tax setup (VAT categories, the climate
// resilience fee "other taxes" category) come from PMS settings and must be confirmed by the accountant.

export const VAT_RATES = { 1: 24, 2: 13, 3: 6, 4: 17, 5: 9, 6: 4, 7: 0, 8: 0 };

/** Payment method codes (myDATA): 3 cash, 5 on credit, 6 web banking, 7 POS / e-POS. */
export function paymentMethodType(method) {
  switch (method) {
    case "cash": return 3;
    case "bank": return 6;
    case "pos":
    case "stripe":
    case "viva":
    case "prior": return 7;
    default: return 5;
  }
}

export const ENDPOINTS = {
  dev: "https://mydataapidev.aade.gr",
  prod: "https://mydatapi.aade.gr/myDATA",
};

/** Split a VAT-inclusive amount (cents) into net and VAT for a myDATA VAT category. */
export function splitGross(grossCents, vatCategory) {
  const rate = VAT_RATES[vatCategory];
  if (rate === undefined) throw Error("INVALID_VAT_CATEGORY");
  const gross = Math.trunc(grossCents);
  const net = Math.round((gross * 100) / (100 + rate));
  return { net, vat: gross - net };
}

const cents = (value) => (Math.trunc(value) / 100).toFixed(2);
const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/**
 * Normalised document from gross amounts per bucket. `buckets`: { accommodation, extras, fees, climate } in cents (VAT-inclusive,
 * climate fee outside VAT). Returns lines, other taxes, payment methods and totals, all in cents.
 */
export function buildDocument(input) {
  const { settings, buckets } = input;
  const retail = input.invoiceType === "11.2";
  const classificationType = retail ? "E3_561_003" : "E3_561_001";
  const accVat = Number(settings.accommodationVatCategory || 2);
  const extrasVat = Number(settings.extrasVatCategory || accVat);
  if (Number(buckets.climate) > 0 && !String(settings.climateTaxCategory || "").match(/^\d{1,3}$/)) throw Error("CLIMATE_TAX_CATEGORY_REQUIRED");
  const lines = [];
  const add = (gross, vatCategory, description) => {
    if (!(gross > 0)) return;
    const { net, vat } = splitGross(gross, vatCategory);
    lines.push({ lineNumber: lines.length + 1, description, netValue: net, vatCategory, vatAmount: vat, classificationType, classificationCategory: "category1_3", otherTaxesCategory: null, otherTaxesAmount: 0 });
  };
  add(Number(buckets.accommodation), accVat, "accommodation");
  add(Number(buckets.extras), extrasVat, "extras");
  add(Number(buckets.fees), accVat, "fees");
  if (!lines.length) throw Error("NOTHING_TO_ISSUE");
  if (Number(buckets.climate) > 0) {
    // The climate resilience fee is reported as an "other tax" on the first (accommodation) line.
    lines[0].otherTaxesCategory = Number(settings.climateTaxCategory);
    lines[0].otherTaxesAmount = Math.trunc(Number(buckets.climate));
  }
  const totalNet = lines.reduce((s, l) => s + l.netValue, 0);
  const totalVat = lines.reduce((s, l) => s + l.vatAmount, 0);
  const totalOther = lines.reduce((s, l) => s + l.otherTaxesAmount, 0);
  const totalGross = totalNet + totalVat + totalOther;
  // Payment methods must add up to the gross value; anything not yet paid is reported "on credit".
  const methods = [];
  let remaining = totalGross;
  for (const p of input.payments ?? []) {
    const amount = Math.min(remaining, Math.trunc(p.amountCents));
    if (amount <= 0) continue;
    const type = paymentMethodType(p.method);
    const existing = methods.find((m) => m.type === type);
    if (existing) existing.amount += amount; else methods.push({ type, amount });
    remaining -= amount;
  }
  if (remaining > 0) methods.push({ type: 5, amount: remaining });
  return {
    invoiceType: input.invoiceType,
    series: input.series,
    aa: input.aa,
    issueDate: input.issueDate,
    issuer: { vatNumber: settings.issuerVat, branch: Number(settings.branch || 0) },
    counterpart: retail ? null : input.counterpart,
    lines,
    paymentMethods: methods,
    totals: { net: totalNet, vat: totalVat, otherTaxes: totalOther, gross: totalGross },
  };
}

export function invoiceXml(doc) {
  if (!/^\d{9}$/.test(String(doc.issuer.vatNumber || ""))) throw Error("ISSUER_VAT_REQUIRED");
  const counterpart = doc.counterpart
    ? `<counterpart><vatNumber>${esc(doc.counterpart.vatNumber)}</vatNumber><country>GR</country><branch>0</branch></counterpart>`
    : "";
  const lines = doc.lines.map((l) =>
    `<invoiceDetails><lineNumber>${l.lineNumber}</lineNumber><netValue>${cents(l.netValue)}</netValue><vatCategory>${l.vatCategory}</vatCategory><vatAmount>${cents(l.vatAmount)}</vatAmount>` +
    (l.otherTaxesCategory ? `<otherTaxesPercentCategory>${l.otherTaxesCategory}</otherTaxesPercentCategory><otherTaxesAmount>${cents(l.otherTaxesAmount)}</otherTaxesAmount>` : "") +
    `<incomeClassification><icls:classificationType>${l.classificationType}</icls:classificationType><icls:classificationCategory>${l.classificationCategory}</icls:classificationCategory><icls:amount>${cents(l.netValue)}</icls:amount></incomeClassification></invoiceDetails>`,
  ).join("");
  const summaryClassification = Object.values(doc.lines.reduce((acc, l) => {
    const key = `${l.classificationType}|${l.classificationCategory}`;
    acc[key] ??= { type: l.classificationType, category: l.classificationCategory, amount: 0 };
    acc[key].amount += l.netValue;
    return acc;
  }, {})).map((c) => `<incomeClassification><icls:classificationType>${c.type}</icls:classificationType><icls:classificationCategory>${c.category}</icls:classificationCategory><icls:amount>${cents(c.amount)}</icls:amount></incomeClassification>`).join("");
  const payments = doc.paymentMethods.map((p) => `<paymentMethodDetails><type>${p.type}</type><amount>${cents(p.amount)}</amount></paymentMethodDetails>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<InvoicesDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0" xmlns:icls="https://www.aade.gr/myDATA/incomeClassificaton/v1.0" xmlns:ecls="https://www.aade.gr/myDATA/expensesClassificaton/v1.0">` +
    `<invoice><issuer><vatNumber>${esc(doc.issuer.vatNumber)}</vatNumber><country>GR</country><branch>${doc.issuer.branch}</branch></issuer>${counterpart}` +
    `<invoiceHeader><series>${esc(doc.series)}</series><aa>${doc.aa}</aa><issueDate>${doc.issueDate}</issueDate><invoiceType>${doc.invoiceType}</invoiceType><currency>EUR</currency></invoiceHeader>` +
    `<paymentMethods>${payments}</paymentMethods>${lines}` +
    `<invoiceSummary><totalNetValue>${cents(doc.totals.net)}</totalNetValue><totalVatAmount>${cents(doc.totals.vat)}</totalVatAmount><totalWithheldAmount>0.00</totalWithheldAmount><totalFeesAmount>0.00</totalFeesAmount><totalStampDutyAmount>0.00</totalStampDutyAmount><totalOtherTaxesAmount>${cents(doc.totals.otherTaxes)}</totalOtherTaxesAmount><totalDeductionsAmount>0.00</totalDeductionsAmount><totalGrossValue>${cents(doc.totals.gross)}</totalGrossValue>${summaryClassification}</invoiceSummary>` +
    `</invoice></InvoicesDoc>`;
}

function tag(xml, name) {
  const match = new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml);
  return match ? match[1].trim() : null;
}

/** First <response> of a myDATA ResponseDoc. */
export function parseResponse(xml) {
  const response = tag(xml, "response") ?? xml;
  const errors = [...response.matchAll(/<(?:\w+:)?error>([\s\S]*?)<\/(?:\w+:)?error>/g)].map((m) => `${tag(m[1], "code") ?? ""} ${tag(m[1], "message") ?? ""}`.trim());
  return { statusCode: tag(response, "statusCode"), mark: tag(response, "invoiceMark"), uid: tag(response, "invoiceUid"), qrUrl: tag(response, "qrUrl"), cancellationMark: tag(response, "cancellationMark"), errors };
}

function headers(credentials) {
  return { "aade-user-id": credentials.username, "Ocp-Apim-Subscription-Key": credentials.subscriptionKey, "Content-Type": "application/xml" };
}

export async function sendInvoice(xml, credentials, environment, request = fetch) {
  const base = ENDPOINTS[environment === "prod" ? "prod" : "dev"];
  const response = await request(`${base}/SendInvoices`, { method: "POST", headers: headers(credentials), body: xml, signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  if (!response.ok) return { statusCode: `HTTP_${response.status}`, mark: null, uid: null, qrUrl: null, errors: [text.slice(0, 500)] };
  return parseResponse(text);
}

export async function cancelInvoice(mark, credentials, environment, request = fetch) {
  const base = ENDPOINTS[environment === "prod" ? "prod" : "dev"];
  const response = await request(`${base}/CancelInvoice?mark=${encodeURIComponent(mark)}`, { method: "POST", headers: headers(credentials), signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  if (!response.ok) return { statusCode: `HTTP_${response.status}`, cancellationMark: null, errors: [text.slice(0, 500)] };
  return parseResponse(text);
}

/** Exponential back-off for failed transmissions: 5 min, 10, 20 … capped at 12 h. */
export function nextAttemptAt(attempts, now) {
  return now + Math.min(12 * 60, 5 * 2 ** Math.max(0, attempts - 1)) * 60_000;
}
