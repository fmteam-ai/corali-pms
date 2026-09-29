import type { PoolClient } from "pg";
import { db, withTransaction } from "@/lib/db";
import { providerCredentials } from "@/lib/provider-connections";
import { ensureFolio, loadFolio } from "@/lib/folio-db";
import { pushNotification } from "@/lib/pms-notifications";
import { hotelToday } from "@/lib/tape-chart";
import { buildDocument, cancelInvoice, invoiceXml, nextAttemptAt, sendInvoice, type MydataDocument } from "../scripts/mydata-core.mjs";
import { payerBuckets, remainingBuckets, remainingPayments } from "@/lib/fiscal-core";
export type { Buckets } from "@/lib/fiscal-core";

const bucketKeys = ["accommodation", "extras", "fees", "climate"] as const;

type Queryable = Pick<PoolClient, "query">;
async function settings(ownerId: string) {
  const c = await providerCredentials(ownerId, "mydata");
  if (!c || !c.active) throw Error("MYDATA_NOT_CONFIGURED");
  if (!c.secrets.username || !c.secrets.subscriptionKey) throw Error("MYDATA_NOT_CONFIGURED");
  if (!/^\d{9}$/.test(c.settings.issuerVat ?? "")) throw Error("ISSUER_VAT_REQUIRED");
  return c;
}

/** Create the next document for a payer (numbered, stored as pending) and try to transmit it immediately. */
export async function issueDocument(ownerId: string, bookingId: number, payer: "guest" | "company" | "agency", actor: string) {
  const mydata = await settings(ownerId);
  const docId = await withTransaction(async (c) => {
    const booking = (await c.query(`SELECT id,total_cents,balance_cents,check_in,check_out,folio_initialized_at,created_at FROM bookings WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [ownerId, bookingId])).rows[0];
    if (!booking) throw Error("NOT_FOUND");
    await ensureFolio(c, ownerId, booking);
    const folio = await loadFolio(c, ownerId, bookingId);
    const previous = (await c.query(`SELECT buckets_json,payments_json FROM fiscal_documents WHERE owner_id=$1 AND booking_id=$2 AND payer=$3 AND status<>'cancelled'`, [ownerId, bookingId, payer])).rows;
    const remaining = remainingBuckets(payerBuckets(folio.nights, folio.entries, payer), previous.map((p) => JSON.parse(p.buckets_json)));
    if (bucketKeys.some((k) => remaining[k] < 0)) throw Error("NEEDS_CREDIT_NOTE");
    if (bucketKeys.every((k) => remaining[k] === 0)) throw Error("NOTHING_TO_ISSUE");
    let counterpart: { vatNumber: string; name?: string } | null = null;
    const invoiceType = payer === "guest" ? "11.2" : "2.1";
    if (invoiceType === "2.1") {
      const details = (await c.query(`SELECT name,vat_number FROM booking_payers WHERE owner_id=$1 AND booking_id=$2 AND payer_type=$3`, [ownerId, bookingId, payer])).rows[0];
      const vat = String(details?.vat_number ?? "").replace(/^EL|^GR/i, "").trim();
      if (!/^\d{9}$/.test(vat)) throw Error("COUNTERPART_VAT_REQUIRED");
      counterpart = { vatNumber: vat, name: details?.name };
    }
    const series = (invoiceType === "11.2" ? mydata.settings.receiptSeries : mydata.settings.invoiceSeries) || (invoiceType === "11.2" ? "A" : "T");
    const counter = await c.query(
      `INSERT INTO fiscal_series(owner_id,series,invoice_type,last_number) VALUES($1,$2,$3,1) ON CONFLICT(owner_id,series,invoice_type) DO UPDATE SET last_number=fiscal_series.last_number+1 RETURNING last_number`,
      [ownerId, series, invoiceType],
    );
    const payments = remainingPayments(folio.entries, payer, previous.map((p) => JSON.parse(p.payments_json)));
    const document: MydataDocument = buildDocument({ invoiceType, series, aa: Number(counter.rows[0].last_number), issueDate: hotelToday(), settings: mydata.settings as never, counterpart, buckets: remaining, payments });
    invoiceXml(document); // validate before storing
    const now = Date.now();
    const r = await c.query(
      `INSERT INTO fiscal_documents(owner_id,booking_id,payer,invoice_type,series,aa,issue_date,buckets_json,payments_json,document_json,total_cents,status,environment,created_by,created_at,updated_at,next_attempt_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13,$14,$14,$14) RETURNING id`,
      [ownerId, bookingId, payer, invoiceType, series, document.aa, document.issueDate, JSON.stringify(remaining), JSON.stringify(document.paymentMethods), JSON.stringify(document), document.totals.gross, mydata.settings.environment === "prod" ? "prod" : "dev", actor, now],
    );
    return Number(r.rows[0].id);
  });
  await transmit(ownerId, docId);
  return docId;
}

/** Send one pending/failed document; on failure schedule a retry with back-off. Safe to call repeatedly. */
export async function transmit(ownerId: string, docId: number) {
  const mydata = await settings(ownerId);
  const row = (await db().query(`SELECT * FROM fiscal_documents WHERE owner_id=$1 AND id=$2`, [ownerId, docId])).rows[0];
  if (!row || !["pending", "failed"].includes(row.status)) return row;
  const document = JSON.parse(row.document_json) as MydataDocument;
  const now = Date.now();
  let result;
  try {
    result = await sendInvoice(invoiceXml(document), { username: mydata.secrets.username, subscriptionKey: mydata.secrets.subscriptionKey }, row.environment);
  } catch (error) {
    result = { statusCode: "NETWORK", mark: null, uid: null, qrUrl: null, errors: [String(error).slice(0, 300)] };
  }
  const attempts = Number(row.attempts) + 1;
  if (result.statusCode === "Success" && result.mark) {
    await db().query(`UPDATE fiscal_documents SET status='sent',mark=$1,uid=$2,qr_url=$3,attempts=$4,last_error=NULL,next_attempt_at=NULL,updated_at=$5 WHERE id=$6`, [result.mark, result.uid, result.qrUrl, attempts, now, docId]);
    await db().query(`UPDATE folio_entries SET receipt_reference=COALESCE(receipt_reference,$1) WHERE owner_id=$2 AND booking_id=$3 AND payer=$4 AND entry_type='payment' AND receipt_reference IS NULL`, [`${row.series}-${row.aa}`, ownerId, row.booking_id, row.payer]).catch(() => undefined);
  } else {
    const error = `${result.statusCode ?? "ERROR"}: ${result.errors.join("; ")}`.slice(0, 1000);
    await db().query(`UPDATE fiscal_documents SET status='failed',attempts=$1,last_error=$2,next_attempt_at=$3,updated_at=$4 WHERE id=$5`, [attempts, error, nextAttemptAt(attempts, now), now, docId]);
    if (attempts === 1) await pushNotification(db(), ownerId, { kind: "system", titleEl: `myDATA: αποτυχία αποστολής ${row.series}-${row.aa} (${result.statusCode}) · νέα προσπάθεια αυτόματα`, titleEn: `myDATA: sending ${row.series}-${row.aa} failed (${result.statusCode}) · retrying automatically`, link: `/pms/reservations/${row.booking_id}` });
  }
  return (await db().query(`SELECT * FROM fiscal_documents WHERE id=$1`, [docId])).rows[0];
}

export async function cancelDocument(ownerId: string, docId: number) {
  const mydata = await settings(ownerId);
  const row = (await db().query(`SELECT * FROM fiscal_documents WHERE owner_id=$1 AND id=$2`, [ownerId, docId])).rows[0];
  if (!row) throw Error("NOT_FOUND");
  if (row.status === "cancelled") return row;
  if (row.status !== "sent") {
    // Never accepted by AADE: withdraw it locally (the number stays used and visible).
    await db().query(`UPDATE fiscal_documents SET status='cancelled',updated_at=$1 WHERE id=$2`, [Date.now(), docId]);
    return row;
  }
  const result = await cancelInvoice(row.mark, { username: mydata.secrets.username, subscriptionKey: mydata.secrets.subscriptionKey }, row.environment);
  if (result.statusCode !== "Success") throw Error(`CANCEL_FAILED: ${result.errors.join("; ")}`.slice(0, 300));
  await db().query(`UPDATE fiscal_documents SET status='cancelled',cancellation_mark=$1,updated_at=$2 WHERE id=$3`, [result.cancellationMark ?? null, Date.now(), docId]);
  return row;
}

export async function listDocuments(q: Queryable, ownerId: string, bookingId: number) {
  return (await q.query(`SELECT id,payer,invoice_type,series,aa,issue_date,total_cents,status,mark,uid,qr_url,attempts,last_error,environment,created_at FROM fiscal_documents WHERE owner_id=$1 AND booking_id=$2 ORDER BY id`, [ownerId, bookingId])).rows;
}
