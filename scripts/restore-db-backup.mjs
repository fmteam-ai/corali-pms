// Decrypts a backup made by run-db-backup.mjs into a pg_dump file for pg_restore (needs the same PMS_DOCUMENT_KEY).
// Usage: node --env-file=runtime.env scripts/restore-db-backup.mjs /path/corali-db-….dump.enc /path/restore.dump
import fs from "node:fs";
import process from "node:process";
import { decryptBuffer } from "./db-backup-core.mjs";

const [input, output] = process.argv.slice(2);
if (!input || !output || !process.env.PMS_DOCUMENT_KEY) throw Error("Usage: restore-db-backup.mjs BACKUP.dump.enc OUTPUT.dump (PMS_DOCUMENT_KEY required)");
if (fs.existsSync(output)) throw Error(`Output already exists: ${output}`);
fs.writeFileSync(output, decryptBuffer(fs.readFileSync(input), process.env.PMS_DOCUMENT_KEY), { mode: 0o600 });
console.log(`Decrypted to ${output}. Restore with: pg_restore --clean --no-owner --dbname=… ${output}`);
