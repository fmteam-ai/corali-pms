// Daily birthday worker (PMS instance only). Sends a personal single-use 10% code to adult guests whose birthday is
// today and who consented to marketing by email and/or WhatsApp. Also applies the identity-data retention rule.
import process from "node:process";
import { createHash } from "node:crypto";
import pg from "pg";
import nodemailer from "nodemailer";
import { databaseSsl } from "./database-config.mjs";
import { purgeExpiredIdentityData } from "./retention-core.mjs";
import { BIRTHDAY_DISCOUNT_PERCENT, BIRTHDAY_MINIMUM_AGE, BIRTHDAY_VALID_DAYS, birthdayCode, birthdayLanguage, birthdayMessage } from "./birthday-core.mjs";

if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
const owner = process.env.PMS_OWNER_ID ?? "hotel-corali";
const athens = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const [year, month, day] = athens.split("-").map(Number);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl() });

async function email(to, message) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USERNAME || !process.env.SMTP_PASSWORD || !process.env.SMTP_FROM) return "not_configured";
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587), secure: Number(process.env.SMTP_PORT) === 465, auth: { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD } });
  await transport.sendMail({ from: process.env.SMTP_FROM, to, subject: message.subject, text: message.body });
  return "sent";
}
async function whatsapp(phone, language, code) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN, id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const template = process.env[language === "el" ? "WHATSAPP_BIRTHDAY_TEMPLATE_EL" : "WHATSAPP_BIRTHDAY_TEMPLATE_EN"];
  if (!token || !id || !template || !phone) return "not_configured";
  const r = await fetch(`https://graph.facebook.com/v22.0/${id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    // The approved template must contain one body variable for the personal code.
    body: JSON.stringify({ messaging_product: "whatsapp", to: phone.replace(/\D/g, ""), type: "template", template: { name: template, language: { code: language === "el" ? "el" : "en" }, components: [{ type: "body", parameters: [{ type: "text", text: code }] }] } }),
  });
  if (!r.ok) throw Error(`WhatsApp ${r.status}`);
  return "sent";
}

try {
  await purgeExpiredIdentityData((text, values) => pool.query(text, values), owner);
  const r = await pool.query(
    `SELECT DISTINCT ON (lower(g.email)) g.id,g.email,g.phone,g.first_name,g.preferred_language,g.email_marketing_consent,g.whatsapp_marketing_consent
       FROM guest_checkins g
      WHERE g.owner_id=$1 AND g.birth_month=$2 AND g.birth_day=$3 AND g.adult_at_submission=1 AND g.identity_purged_at IS NULL
        AND (g.email_marketing_consent=1 OR g.whatsapp_marketing_consent=1)
      ORDER BY lower(g.email), g.submitted_at DESC`,
    [owner, month, day],
  );
  let sent = 0;
  for (const g of r.rows) {
    const key = createHash("sha256").update(String(g.email).toLowerCase()).digest("hex");
    const claim = await pool.query(
      `INSERT INTO birthday_message_runs(owner_id,guest_checkin_id,recipient_key,birthday_year,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
      [owner, g.id, key, year, Date.now()],
    );
    if (!claim.rowCount) continue; // already handled this year
    const until = new Date(Date.UTC(year, month - 1, day + BIRTHDAY_VALID_DAYS)).toISOString().slice(0, 10);
    let code = "";
    let couponId = null;
    for (let attempt = 0; attempt < 5 && !couponId; attempt++) {
      code = birthdayCode();
      const c = await pool.query(
        `INSERT INTO coupons(owner_id,code,discount_type,discount_value,applies_to,valid_from,valid_to,max_uses,usage_count,active,created_at,combinable,purpose,restricted_email,minimum_age)
         VALUES($1,$2,'percentage',$3,'room_only',$4,$5,1,0,1,$6,0,'birthday',lower($7),$8) ON CONFLICT DO NOTHING RETURNING id`,
        [owner, code, BIRTHDAY_DISCOUNT_PERCENT, athens, until, Date.now(), g.email, BIRTHDAY_MINIMUM_AGE],
      );
      couponId = c.rows[0]?.id ?? null;
    }
    const language = birthdayLanguage(g.preferred_language);
    const message = birthdayMessage(language, { name: g.first_name || "", code, percent: BIRTHDAY_DISCOUNT_PERCENT, until: until.split("-").reverse().join("/") });
    let es = "skipped", ws = "skipped";
    try { if (Number(g.email_marketing_consent)) es = await email(g.email, message); } catch { es = "failed"; }
    try { if (Number(g.whatsapp_marketing_consent)) ws = await whatsapp(g.phone, language, code); } catch { ws = "failed"; }
    await pool.query(`UPDATE birthday_message_runs SET coupon_id=$1,email_status=$2,whatsapp_status=$3 WHERE id=$4`, [couponId, es, ws, claim.rows[0].id]);
    if (es === "sent" || ws === "sent") sent++;
  }
  console.log(`Birthday automation complete: ${r.rowCount} eligible guest(s), ${sent} message(s) sent.`);
} finally {
  await pool.end();
}
