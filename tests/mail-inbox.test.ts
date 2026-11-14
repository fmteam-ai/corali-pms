import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { decodeMimeWords, imapQuote, isAutomatic, openImap, parseAddress, parseHeaderBlock, splitResponses } from "../scripts/imap-core.mjs";
import { runMailInbox } from "../scripts/mail-inbox-worker.mjs";

test("IMAP responses with literals are split whole, partial data waits", () => {
  const head = "From: a@b.gr\r\nSubject: Hi\r\n\r\n";
  const raw = Buffer.from(`* 3 FETCH (UID 41 BODY[HEADER.FIELDS (FROM SUBJECT)] {${Buffer.byteLength(head)}}\r\n${head})\r\nC2 OK done\r\n* 4 FETCH (UID 4`);
  const { responses, rest } = splitResponses(raw);
  assert.equal(responses.length, 2);
  assert.match(responses[0].text, /UID 41/);
  assert.equal(responses[0].literals[0].toString(), head);
  assert.equal(responses[1].text, "C2 OK done");
  assert.equal(rest.toString(), "* 4 FETCH (UID 4");
});

test("headers: folded lines, encoded words in Greek, addresses", () => {
  const h = parseHeaderBlock("Subject: =?UTF-8?B?zprPgc6sz4TOt8+Dzrc=?=\r\n =?UTF-8?Q?_=CE=99=CE=BF=CF=85=CE=BD=CE=AF=CE=BF=CF=85?=\r\nFrom: =?iso-8859-7?Q?=CC=E1=F1=DF=E1?= <Maria@Example.com>\r\n");
  assert.equal(decodeMimeWords(h.subject), "Κράτηση Ιουνίου");
  assert.deepEqual(parseAddress(h.from), { name: "Μαρία", address: "maria@example.com" });
  assert.deepEqual(parseAddress('"Smith, John" <JOHN@x.co.uk>'), { name: "Smith, John", address: "john@x.co.uk" });
  assert.deepEqual(parseAddress("anna@example.de (Anna S.)"), { name: "Anna S.", address: "anna@example.de" });
  assert.equal(decodeMimeWords(Buffer.from("Καλημέρα", "utf8").toString("latin1")), "Καλημέρα");
  assert.equal(imapQuote('pa"ss\\w'), '"pa\\"ss\\\\w"');
  assert.equal(imapQuote("a\r\nb"), null);
});

test("automatic mail is recognised (no guest notification)", () => {
  assert.equal(isAutomatic({ "auto-submitted": "auto-replied" }, "x@y.gr"), true);
  assert.equal(isAutomatic({ "list-id": "<news.example.com>" }, "x@y.gr"), true);
  assert.equal(isAutomatic({ precedence: "bulk" }, "x@y.gr"), true);
  assert.equal(isAutomatic({}, "mailer-daemon@host.gr"), true);
  assert.equal(isAutomatic({}, "noreply@booking.com"), true);
  assert.equal(isAutomatic({ "auto-submitted": "no" }, "maria@example.com"), false);
});

/** A tiny IMAP server: one mailbox, messages by UID, records the commands it got. */
function fakeImap(messages: { uid: number; headers: string }[], opts: { uidValidity?: number; password?: string } = {}) {
  const commands: string[] = [];
  const server = net.createServer((sock) => {
    sock.write("* OK fake IMAP ready\r\n");
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const [tag, cmd, ...rest] = line.split(" ");
        commands.push(`${cmd} ${rest.join(" ")}`.replace(/"[^"]*"\s*$/, '"***"'));
        if (cmd === "LOGIN") sock.write(rest.join(" ").endsWith(`"${opts.password ?? "secret"}"`) ? `${tag} OK logged in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] bad\r\n`);
        else if (cmd === "EXAMINE") sock.write(`* ${messages.length} EXISTS\r\n* OK [UIDVALIDITY ${opts.uidValidity ?? 7}] ok\r\n* OK [UIDNEXT ${Math.max(0, ...messages.map((m) => m.uid)) + 1}] next\r\n${tag} OK [READ-ONLY] done\r\n`);
        else if (cmd === "UID" && rest[0] === "FETCH") {
          const from = Number(rest[1].split(":")[0]);
          const list = messages.filter((m) => m.uid >= from);
          const send = list.length ? list : messages.slice(-1); // "n:*" always returns the last message
          for (const [n, m] of send.entries()) sock.write(`* ${n + 1} FETCH (UID ${m.uid} BODY[HEADER.FIELDS (FROM)] {${Buffer.byteLength(m.headers)}}\r\n${m.headers})\r\n`);
          sock.write(`${tag} OK fetched\r\n`);
        } else if (cmd === "LOGOUT") { sock.write(`* BYE\r\n${tag} OK bye\r\n`); sock.end(); }
        else sock.write(`${tag} BAD unknown\r\n`);
      }
    });
  });
  return new Promise<{ port: number; commands: string[]; close: () => void }>((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as net.AddressInfo).port, commands, close: () => server.close() })));
}

function fakePool(state: { uid_validity: number; last_uid: number } | null) {
  const stored: unknown[][] = [], notes: unknown[][] = [];
  let saved: unknown[] | null = null;
  return {
    stored, notes, get saved() { return saved; },
    async query(sql: string, params: unknown[] = []) {
      if (sql.startsWith("SELECT uid_validity")) return { rows: state ? [state] : [], rowCount: state ? 1 : 0 };
      if (sql.includes("INTO social_messages")) { stored.push(params); return { rows: [{ id: stored.length }], rowCount: 1 }; }
      if (sql.includes("INTO pms_notifications")) { notes.push(params); return { rows: [], rowCount: 1 }; }
      if (sql.includes("INTO mail_inbox_state")) { saved = params; return { rows: [], rowCount: 1 }; }
      throw Error(`unexpected SQL ${sql.slice(0, 40)}`);
    },
  };
}

const creds = (port: number, extra: Record<string, string> = {}) => async (key: string) => key === "imap" ? { settings: { host: "127.0.0.1", port: String(port), username: "corali@hotelcorali.gr", ...extra }, secrets: { password: "secret" } } : null;
const msg = (uid: number, from: string, subject: string, extra = "") => ({ uid, headers: `From: ${from}\r\nSubject: ${subject}\r\nDate: Sat, 14 Nov 2026 10:00:00 +0200\r\n${extra}\r\n` });
const open = (x: Parameters<typeof openImap>[0]) => openImap({ ...x, secure: false, timeoutMs: 3000 });

test("mail inbox: first check only remembers where it is; next ones notify new guest mail", async () => {
  const srv = await fakeImap([msg(10, "Old <old@x.gr>", "old")]);
  try {
    const first = fakePool(null);
    assert.deepEqual(await runMailInbox({ pool: first, owner: "o", credentials: creds(srv.port), open }), { checked: true, stored: 0, started: true });
    assert.deepEqual(first.saved?.slice(0, 3), ["o", 7, 10]);
    assert.equal(first.stored.length, 0);
    assert.ok(srv.commands.some((c) => c.startsWith("EXAMINE")), "read-only EXAMINE, never SELECT");
    assert.ok(!srv.commands.some((c) => /STORE|SELECT|EXPUNGE|COPY|MOVE/.test(c)));
  } finally { srv.close(); }

  const srv2 = await fakeImap([
    msg(10, "Old <old@x.gr>", "old"),
    msg(11, "=?UTF-8?B?zpzOsc+Bzq/OsQ==?= <maria@example.com>", "=?UTF-8?Q?Er=CF=8E=CF=84=CE=B7=CF=83=CE=B7?="),
    msg(12, "MAILER-DAEMON@ded5552.inmotionhosting.com", "Undelivered"),
    msg(13, "News <news@shop.gr>", "Sale", "List-Id: <news.shop.gr>\r\n"),
    msg(14, "Corali <corali@hotelcorali.gr>", "copy of our own mail"),
    msg(15, "Form <web@hotelcorali.gr>", "Contact form", "Reply-To: John <John@x.co.uk>\r\n"),
  ]);
  try {
    const pool = fakePool({ uid_validity: 7, last_uid: 10 });
    assert.deepEqual(await runMailInbox({ pool, owner: "o", credentials: creds(srv2.port), open, now: Date.parse("2026-11-14T09:00:00Z") }), { checked: true, stored: 2 });
    assert.deepEqual(pool.stored.map((p) => p.slice(1, 5)), [["maria@example.com", "Μαρία", "Erώτηση", "imap:7:11"], ["john@x.co.uk", "John", "Contact form", "imap:7:15"]]);
    assert.match(String(pool.notes[0][1]), /^Νέο email από Μαρία: Erώτηση$/);
    assert.equal(pool.saved?.[2], 15);
  } finally { srv2.close(); }
});

test("mail inbox: nothing new, wrong password, not configured", async () => {
  const srv = await fakeImap([msg(20, "a@b.gr", "x")]);
  try {
    const pool = fakePool({ uid_validity: 7, last_uid: 20 });
    assert.deepEqual(await runMailInbox({ pool, owner: "o", credentials: creds(srv.port), open }), { checked: true, stored: 0 });
    assert.ok(!srv.commands.some((c) => c.startsWith("UID FETCH")), "no fetch when UIDNEXT shows nothing new");
    const bad = fakePool({ uid_validity: 7, last_uid: 1 });
    await assert.rejects(runMailInbox({ pool: bad, owner: "o", credentials: async () => ({ settings: { host: "127.0.0.1", port: String(srv.port), username: "u" }, secrets: { password: "wrong" } }), open }), /IMAP_LOGIN_FAILED/);
    assert.equal(bad.saved?.[4], "IMAP_LOGIN_FAILED");
  } finally { srv.close(); }
  assert.deepEqual(await runMailInbox({ pool: fakePool(null), owner: "o", credentials: async () => null, open }), { checked: false });
  assert.deepEqual(await runMailInbox({ pool: fakePool(null), owner: "o", credentials: async () => ({ disabled: true }), open }), { checked: false });
});
