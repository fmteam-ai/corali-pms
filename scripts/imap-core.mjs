// A small read-only IMAP client for the PMS e-mail notifications (PMS → Συνδέσεις → «Εισερχόμενα email»): it logs in,
// selects the mailbox and reads only the header fields of new messages (BODY.PEEK, so nothing is marked as read).
import net from "node:net";
import tls from "node:tls";

/** Quoted IMAP string ("…" with \ and " escaped); null for values a quoted string cannot carry. */
export function imapQuote(value) {
  const s = String(value ?? "");
  if (/[\r\n\0]/.test(s)) return null;
  return `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/**
 * Splits raw server output into complete responses. A response line ending in {n} is followed by n bytes of literal
 * data and continues after it, so one response = text parts + literals. Returns the responses and the unused rest.
 */
export function splitResponses(buffer) {
  const responses = [];
  let pos = 0;
  outer: while (pos < buffer.length) {
    const parts = [], literals = [];
    let p = pos;
    for (;;) {
      const end = buffer.indexOf("\r\n", p, "latin1");
      if (end < 0) break outer;
      const line = buffer.subarray(p, end).toString("utf8");
      const m = /\{(\d+)\}$/.exec(line);
      if (!m) { parts.push(line); p = end + 2; break; }
      const size = Number(m[1]), start = end + 2;
      if (buffer.length < start + size) break outer;
      parts.push(line);
      literals.push(buffer.subarray(start, start + size));
      p = start + size;
    }
    responses.push({ text: parts.join(""), literals });
    pos = p;
  }
  return { responses, rest: buffer.subarray(pos) };
}

/** Header fields from raw header text (folded lines joined), lower-case names → raw values. */
export function parseHeaderBlock(raw) {
  const out = {};
  const text = Buffer.isBuffer(raw) ? raw.toString("latin1") : String(raw ?? "");
  for (const line of text.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if (!(name in out)) out[name] = line.slice(i + 1).trim();
  }
  return out;
}

const decoderFor = (charset) => {
  const c = String(charset || "utf-8").toLowerCase();
  try { return new TextDecoder(c === "utf8" ? "utf-8" : c); } catch { return new TextDecoder("utf-8"); }
};

/** RFC 2047 encoded words (=?UTF-8?B?…?= / =?ISO-8859-7?Q?…?=) in a header value → text; raw 8-bit bytes read as UTF-8. */
export function decodeMimeWords(value) {
  const latin = String(value ?? "");
  // Header bytes arrived as latin1: give unencoded 8-bit text back to UTF-8 first.
  const raw = /[\x80-\xff]/.test(latin) ? Buffer.from(latin, "latin1").toString("utf8") : latin;
  return raw.replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)(\s+(?==\?[^?]+\?[bBqQ]\?[^?]*\?=))?/g, "$1").replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, charset, enc, data) => {
    try {
      const bytes = enc.toUpperCase() === "B" ? Buffer.from(data, "base64") : Buffer.from(data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))), "latin1");
      return decoderFor(charset.split("*")[0]).decode(bytes);
    } catch { return data; }
  });
}

/** "Name" <a@b> / a@b (Name) / a@b → { name, address } (address lower-case, "" when none). */
export function parseAddress(value) {
  const v = decodeMimeWords(value).trim();
  const angle = /^(.*)<([^<>@\s]+@[^<>\s]+)>\s*$/.exec(v);
  if (angle) return { name: angle[1].trim().replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1").trim(), address: angle[2].toLowerCase() };
  const plain = /([^\s<>"(),;]+@[^\s<>"(),;]+)/.exec(v);
  return { name: (/\(([^)]*)\)/.exec(v)?.[1] ?? "").trim(), address: plain ? plain[1].toLowerCase() : "" };
}

/** Whether a message is automatic (bounces, newsletters, auto-replies): no guest notification for those. */
export function isAutomatic(h, from) {
  const auto = String(h["auto-submitted"] ?? "").toLowerCase();
  if (auto && auto !== "no") return true;
  if (h["list-id"] || h["list-unsubscribe"]) return true;
  if (/^(bulk|junk|list|auto_reply)$/i.test(String(h.precedence ?? "").trim())) return true;
  return /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce[s]?)[@+._-]/i.test(from);
}

/** One logged-in IMAP session over TLS (or plain TCP for local tests). */
export async function openImap({ host, port = 993, secure = true, username, password, timeoutMs = 20_000, servername }) {
  const socket = await new Promise((resolve, reject) => {
    const s = secure ? tls.connect({ host, port, servername: servername ?? host }) : net.connect({ host, port });
    s.setTimeout(timeoutMs, () => s.destroy(Error("IMAP_TIMEOUT")));
    s.once(secure ? "secureConnect" : "connect", () => resolve(s));
    s.once("error", reject);
  });
  let buffer = Buffer.alloc(0), waiting = null, pending = [], seq = 0, closed = false;
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { responses, rest } = splitResponses(buffer);
    buffer = rest;
    pending.push(...responses);
    waiting?.();
  });
  socket.on("close", () => { closed = true; waiting?.(); });
  socket.on("error", () => { closed = true; waiting?.(); });
  const next = async () => {
    while (!pending.length) {
      if (closed) throw Error("IMAP_CLOSED");
      await new Promise((r) => { waiting = r; });
      waiting = null;
    }
    return pending.shift();
  };
  const greeting = await next();
  if (!/^\* (OK|PREAUTH)/i.test(greeting.text)) { socket.destroy(); throw Error("IMAP_GREETING"); }
  async function command(text) {
    const tag = `C${++seq}`;
    socket.write(`${tag} ${text}\r\n`);
    const untagged = [];
    for (;;) {
      const r = await next();
      if (r.text.startsWith(`${tag} `)) {
        const ok = /^\S+ OK/i.test(r.text);
        if (!ok) { const e = Error(`IMAP_${(/^\S+ (NO|BAD)/i.exec(r.text)?.[1] ?? "ERROR").toUpperCase()}`); e.detail = r.text.slice(tag.length + 1, 200); throw e; }
        return untagged;
      }
      untagged.push(r);
    }
  }
  const user = imapQuote(username), pass = imapQuote(password);
  if (!user || !pass) { socket.destroy(); throw Error("IMAP_BAD_CREDENTIALS_FORMAT"); }
  try { await command(`LOGIN ${user} ${pass}`); } catch (e) { socket.destroy(); throw e.message === "IMAP_NO" ? Error("IMAP_LOGIN_FAILED") : e; }
  return {
    command,
    /** SELECT (read-only EXAMINE) the mailbox → { uidValidity, uidNext, exists }. */
    async examine(mailbox = "INBOX") {
      const name = imapQuote(mailbox);
      if (!name) throw Error("IMAP_BAD_MAILBOX");
      const lines = await command(`EXAMINE ${name}`);
      const num = (re) => { for (const l of lines) { const m = re.exec(l.text); if (m) return Number(m[1]); } return 0; };
      return { uidValidity: num(/\[UIDVALIDITY (\d+)\]/i), uidNext: num(/\[UIDNEXT (\d+)\]/i), exists: num(/^\* (\d+) EXISTS/i) };
    },
    /** Header fields of messages with UID ≥ fromUid (at most `limit`, lowest first). */
    async headersSince(fromUid, limit = 20) {
      const fields = "FROM REPLY-TO SUBJECT DATE MESSAGE-ID AUTO-SUBMITTED LIST-ID LIST-UNSUBSCRIBE PRECEDENCE";
      const lines = await command(`UID FETCH ${Math.max(1, Math.floor(fromUid))}:* (UID BODY.PEEK[HEADER.FIELDS (${fields})])`);
      const out = [];
      for (const l of lines) {
        const uid = Number(/\bUID (\d+)/i.exec(l.text)?.[1] ?? 0);
        if (!uid || uid < fromUid || !l.literals.length) continue;
        out.push({ uid, headers: parseHeaderBlock(l.literals[0]) });
      }
      return out.sort((a, b) => a.uid - b.uid).slice(0, limit);
    },
    async close() {
      try { await Promise.race([command("LOGOUT"), new Promise((r) => setTimeout(r, 2000))]); } catch { /* already closing */ }
      socket.destroy();
    },
  };
}
