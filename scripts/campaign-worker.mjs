// Bulk messages worker (run every minute by run-message-automations.mjs): starts scheduled campaigns (takes the
// audience snapshot), then sends at most `rate_per_minute` e-mails and WhatsApp messages per campaign per run.
// The unsubscribe list and consent are checked again right before each message.
import { audienceQuery, batchSize, renderCampaignEmail, unsubscribeToken, whatsappLanguage, firstName } from "./campaign-core.mjs";

const hotelToday = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" }).format(new Date(now));

/** Takes the audience snapshot of a campaign (both channels) and marks it as sending. */
export async function startCampaign(pool, owner, c, now = Date.now()) {
  const audience = JSON.parse(c.audience_json || "{}");
  for (const channel of ["email", "whatsapp"]) {
    if (!Number(channel === "email" ? c.send_email : c.send_whatsapp)) continue;
    const q = audienceQuery(owner, audience, channel, hotelToday(now));
    const rows = (await pool.query(q.sql, q.params)).rows;
    for (let i = 0; i < rows.length; i += 500) {
      const part = rows.slice(i, i + 500);
      const values = part.map((_, j) => `($1,$2,$3,$${4 + j * 3},$${5 + j * 3},$${6 + j * 3},$${4 + part.length * 3})`).join(",");
      await pool.query(`INSERT INTO campaign_recipients(owner_id,campaign_id,channel,address,name,lang,updated_at) VALUES ${values} ON CONFLICT DO NOTHING`, [owner, c.id, channel, ...part.flatMap((r) => [r.address, r.name ?? "", r.lang ?? "en"]), now]);
    }
  }
  await pool.query(`UPDATE campaigns SET status='sending',started_at=$3,updated_at=$3 WHERE owner_id=$1 AND id=$2 AND status='scheduled'`, [owner, c.id, now]);
}

export async function runCampaigns({ pool, owner, secret, origin, email, whatsappTemplate, now = Date.now() }) {
  const due = (await pool.query(`SELECT * FROM campaigns WHERE owner_id=$1 AND (status='scheduled' AND scheduled_at<=$2::bigint OR status='sending') ORDER BY scheduled_at,id LIMIT 5`, [owner, now])).rows;
  const out = { campaigns: due.length, sent: 0, failed: 0 };
  for (const c of due) {
    if (c.status === "scheduled") await startCampaign(pool, owner, c, now);
    const content = JSON.parse(c.content_json || "{}"), n = batchSize(c.rate_per_minute);
    const imageUrl = c.image_data ? `${origin}/api/public/campaigns/image/${c.id}?v=${c.updated_at}` : "";
    for (const channel of ["email", "whatsapp"]) {
      const batch = (await pool.query(
        `UPDATE campaign_recipients SET status='sending',attempts=attempts+1,updated_at=$4 WHERE id IN (SELECT id FROM campaign_recipients WHERE owner_id=$1 AND campaign_id=$2 AND channel=$3 AND (status='pending' OR status='sending' AND updated_at<$4::bigint-600000 AND attempts<3) ORDER BY id LIMIT $5 FOR UPDATE SKIP LOCKED) RETURNING *`,
        [owner, c.id, channel, now, n],
      )).rows;
      for (const r of batch) {
        try {
          const gone = await pool.query(`SELECT 1 FROM marketing_unsubscribes WHERE owner_id=$1 AND channel=$2 AND address=$3`, [owner, channel, r.address]);
          if (gone.rowCount) throw Object.assign(Error("UNSUBSCRIBED"), { skip: true });
          let ref;
          if (channel === "email") {
            const unsubscribeUrl = `${origin}/unsubscribe?r=${r.id}&t=${unsubscribeToken(secret, r.id)}&lang=${r.lang}`;
            const m = renderCampaignEmail({ content, lang: r.lang, name: r.name, imageUrl, unsubscribeUrl, logoUrl: `${origin}/hotel-corali-logo.png` });
            if (!m) throw Object.assign(Error("NO_CONTENT"), { skip: true });
            ref = await email(r.address, m.subject, m.text, { html: m.html, headers: { "List-Unsubscribe": `<${origin}/api/public/unsubscribe?r=${r.id}&t=${unsubscribeToken(secret, r.id)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
          } else {
            const code = whatsappLanguage(c.whatsapp_languages, r.lang);
            if (!c.whatsapp_template || !code) throw Object.assign(Error("WHATSAPP_NO_TEMPLATE"), { skip: true });
            ref = await whatsappTemplate(r.address, c.whatsapp_template, code, [firstName(r.name) || "—"]);
          }
          await pool.query(`UPDATE campaign_recipients SET status='sent',provider_reference=$2,sent_at=$3,error='',updated_at=$3 WHERE id=$1`, [r.id, String(ref ?? "accepted").slice(0, 200), Date.now()]);
          out.sent++;
        } catch (e) {
          const skip = Boolean(e?.skip);
          await pool.query(`UPDATE campaign_recipients SET status=$2,error=$3,updated_at=$4 WHERE id=$1`, [r.id, skip ? "skipped" : r.attempts >= 3 ? "failed" : "pending", String(e?.message ?? "SEND_FAILED").slice(0, 250), Date.now()]);
          if (!skip) out.failed++;
        }
      }
    }
    const left = await pool.query(`SELECT 1 FROM campaign_recipients WHERE owner_id=$1 AND campaign_id=$2 AND status IN ('pending','sending') LIMIT 1`, [owner, c.id]);
    if (!left.rowCount) await pool.query(`UPDATE campaigns SET status='sent',finished_at=$3,updated_at=$3 WHERE owner_id=$1 AND id=$2 AND status='sending'`, [owner, c.id, Date.now()]);
  }
  return out;
}
