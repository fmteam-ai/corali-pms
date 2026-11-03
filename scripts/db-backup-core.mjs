// Encrypted database backups (pure parts; unit tested): file names, which old backups to delete, and the AES-256-GCM
// envelope "CRLB1" + 12-byte IV + ciphertext + 16-byte tag, keyed from PMS_DOCUMENT_KEY.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const MAGIC = Buffer.from("CRLB1");
export const backupKey = (documentKey) => createHash("sha256").update(`corali-db-backup:${documentKey}`).digest();
export const backupName = (date) => `corali-db-${date.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.dump.enc`;

/** Backups to delete: everything but the newest `keep` (names sort by time). */
export function expiredBackups(names, keep = 14) {
  return names.filter((n) => /^corali-db-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.dump\.enc$/.test(n)).sort().reverse().slice(keep);
}

export function encryptBuffer(plain, documentKey) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", backupKey(documentKey), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
}

export function decryptBuffer(file, documentKey) {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("NOT_A_CORALI_BACKUP");
  const iv = file.subarray(MAGIC.length, MAGIC.length + 12), tag = file.subarray(file.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", backupKey(documentKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(file.subarray(MAGIC.length + 12, file.length - 16)), decipher.final()]);
}
