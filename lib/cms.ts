// Small DER / PKCS toolkit on Node's crypto (no third-party code): an RSA key with its certificate signing request for
// Apple's Pass Type ID certificate, and the detached CMS (PKCS #7) signature Apple Wallet requires on a pass manifest.
import { createHash, createPublicKey, generateKeyPairSync, sign, X509Certificate, type KeyObject } from "node:crypto";

const len = (n: number) => { if (n < 0x80) return Buffer.from([n]); const b: number[] = []; while (n > 0) { b.unshift(n & 0xff); n >>= 8; } return Buffer.from([0x80 | b.length, ...b]); };
const tlv = (tag: number, body: Buffer) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
export const der = {
  seq: (...x: Buffer[]) => tlv(0x30, Buffer.concat(x)),
  set: (...x: Buffer[]) => tlv(0x31, Buffer.concat(x)),
  /** SET OF in DER order (sorted by encoding), as signed attributes require. */
  setOf: (...x: Buffer[]) => tlv(0x31, Buffer.concat([...x].sort(Buffer.compare))),
  int: (n: number | Buffer) => { let b = typeof n === "number" ? Buffer.from([n]) : n; if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return tlv(0x02, b); },
  nul: () => Buffer.from([0x05, 0x00]),
  oct: (b: Buffer) => tlv(0x04, b),
  bits: (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b])),
  utf8: (s: string) => tlv(0x0c, Buffer.from(s, "utf8")),
  utc: (d: Date) => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z", "ascii")),
  ctx: (n: number, body: Buffer, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, body),
  oid: (s: string) => { const p = s.split(".").map(Number), out = [40 * p[0] + p[1]]; for (const v of p.slice(2)) { const b = [v & 0x7f]; let x = v >>> 7; while (x) { b.unshift(0x80 | (x & 0x7f)); x >>>= 7; } out.push(...b); } return tlv(0x06, Buffer.from(out)); },
};

const OID = { rsa: "1.2.840.113549.1.1.1", sha256Rsa: "1.2.840.113549.1.1.11", sha256: "2.16.840.1.101.3.4.2.1", data: "1.2.840.113549.1.7.1", signedData: "1.2.840.113549.1.7.2", contentType: "1.2.840.113549.1.9.3", messageDigest: "1.2.840.113549.1.9.4", signingTime: "1.2.840.113549.1.9.5", cn: "2.5.4.3", o: "2.5.4.10", c: "2.5.4.6", email: "1.2.840.113549.1.9.1" };

/** Read one TLV at `at`: tag, where its body starts and ends, where the next element starts. */
function read(b: Buffer, at: number) {
  const tag = b[at];
  let n = b[at + 1], start = at + 2;
  if (n & 0x80) { const k = n & 0x7f; n = 0; for (let i = 0; i < k; i++) n = (n << 8) | b[at + 2 + i]; start = at + 2 + k; }
  return { tag, start, end: start + n, next: start + n };
}
const children = (b: Buffer, el: { start: number; end: number }) => { const out = []; for (let at = el.start; at < el.end;) { const c = read(b, at); out.push({ ...c, raw: b.subarray(at, c.end) }); at = c.end; } return out; };

/** The issuer name (DER) and serial number of a certificate, as a CMS signer identifies it. */
function issuerAndSerial(certDer: Buffer) {
  const tbs = children(certDer, read(certDer, 0))[0];
  const f = children(certDer, tbs);
  const i = f[0].tag === 0xa0 ? 1 : 0; // optional [0] version
  return der.seq(f[i + 2].raw, f[i].raw); // issuer, serialNumber (raw INTEGER TLV)
}

/** PEM, base64 DER or raw DER → DER. */
export function certificateDer(input: string | Buffer): Buffer {
  if (Buffer.isBuffer(input)) return input;
  const t = input.trim();
  return Buffer.from(t.includes("BEGIN CERTIFICATE") ? t.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "") : t.replace(/\s+/g, ""), "base64");
}

/** A new RSA key and the certificate signing request to upload to Apple (Certificates → Pass Type ID). */
export function newKeyAndCsr(commonName: string, email: string, country = "GR"): { privateKeyPem: string; csrPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const name = der.seq(
    der.set(der.seq(der.oid(OID.email), tlv(0x16, Buffer.from(email, "ascii")))),
    der.set(der.seq(der.oid(OID.cn), der.utf8(commonName))),
    der.set(der.seq(der.oid(OID.c), tlv(0x13, Buffer.from(country, "ascii")))),
  );
  const info = der.seq(der.int(0), name, publicKey.export({ type: "spki", format: "der" }), der.ctx(0, Buffer.alloc(0)));
  const csr = der.seq(info, der.seq(der.oid(OID.sha256Rsa), der.nul()), der.bits(sign("sha256", info, privateKey)));
  const pem = (label: string, b: Buffer) => `-----BEGIN ${label}-----\n${b.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;
  return { privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), csrPem: pem("CERTIFICATE REQUEST", csr) };
}

/** Does the certificate belong to this key? (The uploaded Apple certificate must match the key the PMS made.) */
export function certificateMatchesKey(certDer: Buffer, key: KeyObject): boolean {
  const pub = new X509Certificate(certDer).publicKey.export({ type: "spki", format: "der" });
  return Buffer.compare(pub, createPublicKey(key).export({ type: "spki", format: "der" })) === 0;
}

/** Detached CMS SignedData over `content` (SHA-256 with RSA), carrying the signer and the intermediate certificates. */
export function cmsSignDetached(content: Buffer, signerCertDer: Buffer, chainDer: Buffer[], key: KeyObject, at = new Date()): Buffer {
  const attrs = [
    der.seq(der.oid(OID.contentType), der.set(der.oid(OID.data))),
    der.seq(der.oid(OID.signingTime), der.set(der.utc(at))),
    der.seq(der.oid(OID.messageDigest), der.set(der.oct(createHash("sha256").update(content).digest()))),
  ];
  const signedAttrs = der.setOf(...attrs);
  const signature = sign("sha256", signedAttrs, key);
  const signerInfo = der.seq(der.int(1), issuerAndSerial(signerCertDer), der.seq(der.oid(OID.sha256), der.nul()), Buffer.concat([Buffer.from([0xa0]), signedAttrs.subarray(1)]), der.seq(der.oid(OID.rsa), der.nul()), der.oct(signature));
  const signedData = der.seq(der.int(1), der.set(der.seq(der.oid(OID.sha256), der.nul())), der.seq(der.oid(OID.data)), der.ctx(0, Buffer.concat([signerCertDer, ...chainDer])), der.set(signerInfo));
  return der.seq(der.oid(OID.signedData), der.ctx(0, signedData));
}
