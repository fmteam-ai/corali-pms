// E-mail notifications in the automation cron (every minute): new messages in the hotel's mailbox (PMS → Συνδέσεις →
// «Εισερχόμενα email», IMAP) become entries in Social → Μηνύματα and a PMS notification with sound. Read-only: the
// mailbox is never changed and messages stay unread. Automatic mail (bounces, newsletters, auto-replies) is skipped.
import { decodeMimeWords, isAutomatic, openImap, parseAddress } from "./imap-core.mjs";

const MAX_PER_RUN = 20;

/** Runs one check; `credentials(key)` is the automation runner's provider reader. */
export async function runMailInbox({ pool, owner, credentials, open = openImap, now = Date.now() }) {
  const c = await credentials("imap").catch(() => null);
  if (!c || c.disabled) return { checked: false };
  const host = String(c.settings?.host ?? "").trim(), username = String(c.settings?.username ?? "").trim(), password = String(c.secrets?.password ?? "");
  if (!host || !username || !password) return { checked: false };
  const port = Number(c.settings?.port) || 993, mailbox = String(c.settings?.mailbox ?? "").trim() || "INBOX";
  const state = (await pool.query(`SELECT uid_validity,last_uid FROM mail_inbox_state WHERE owner_id=$1`, [owner])).rows[0];
  let session;
  try {
    session = await open({ host, port, secure: port !== 143, username, password });
    const box = await session.examine(mailbox);
    // First check, or the mailbox was rebuilt (new UIDVALIDITY): start from now, so old mail does not ring.
    if (!state || Number(state.uid_validity) !== box.uidValidity) {
      await saveState(pool, owner, box.uidValidity, Math.max(0, box.uidNext - 1), now, null);
      return { checked: true, stored: 0, started: true };
    }
    const lastUid = Number(state.last_uid);
    if (box.uidNext && box.uidNext <= lastUid + 1) { await saveState(pool, owner, box.uidValidity, lastUid, now, null); return { checked: true, stored: 0 }; }
    const items = await session.headersSince(lastUid + 1, MAX_PER_RUN);
    const own = new Set([username.toLowerCase(), String(c.settings?.from ?? "").toLowerCase()].filter(Boolean));
    let stored = 0, maxUid = lastUid;
    for (const { uid, headers } of items) {
      maxUid = Math.max(maxUid, uid);
      const from = parseAddress(headers["reply-to"] || headers.from || "");
      const sender = parseAddress(headers.from || "");
      if (!from.address || own.has(sender.address) || isAutomatic(headers, sender.address)) continue;
      const subject = decodeMimeWords(headers.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || "(χωρίς θέμα)";
      const sentAt = Date.parse(headers.date ?? "");
      const externalId = `imap:${box.uidValidity}:${uid}`;
      const r = await pool.query(
        `INSERT INTO social_messages(owner_id,platform,sender_id,sender_name,direction,body,external_id,status,created_at) VALUES($1,'email',$2,$3,'in',$4,$5,'new',$6) ON CONFLICT DO NOTHING RETURNING id`,
        [owner, from.address.slice(0, 200), (from.name || sender.name || "").slice(0, 120) || null, subject, externalId, Number.isFinite(sentAt) && sentAt > 0 && sentAt <= now + 3_600_000 ? sentAt : now],
      );
      if (!r.rowCount) continue;
      stored++;
      const who = from.name || from.address;
      await pool.query(`INSERT INTO pms_notifications(owner_id,kind,title_el,title_en,link,created_at) VALUES($1,'guest_message',$2,$3,'/pms/social',$4)`, [owner, `Νέο email από ${who}: ${subject}`.slice(0, 300), `New e-mail from ${who}: ${subject}`.slice(0, 300), now]);
    }
    await saveState(pool, owner, box.uidValidity, maxUid, now, null);
    return { checked: true, stored };
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 120) : "IMAP_FAILED";
    await saveState(pool, owner, state ? Number(state.uid_validity) : 0, state ? Number(state.last_uid) : 0, now, message);
    throw e;
  } finally {
    await session?.close();
  }
}

async function saveState(pool, owner, uidValidity, lastUid, at, error) {
  await pool.query(
    `INSERT INTO mail_inbox_state(owner_id,uid_validity,last_uid,checked_at,last_error) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(owner_id) DO UPDATE SET uid_validity=$2,last_uid=$3,checked_at=$4,last_error=$5`,
    [owner, uidValidity, lastUid, at, error],
  );
}
