// Corali TV and A/C power worker (PMS instance only, cPanel cron every 5 minutes). Room A/C relays first (see
// room-ac-worker.mjs), then the room plugs (TV or fridge, see tv-plug-worker.mjs). Since v174 the per-minute automation
// cron also runs the room plugs every 5 minutes, so this cron is optional.
import process from "node:process";
import { createDecipheriv, createHash } from "node:crypto";
import pg from "pg";
import { databaseSsl } from "./database-config.mjs";
import { runTvPlugs } from "./tv-plug-worker.mjs";
import { runRoomAc } from "./room-ac-worker.mjs";

if (!process.env.DATABASE_URL || !process.env.PMS_DOCUMENT_KEY) throw Error("TV power requires DATABASE_URL and PMS_DOCUMENT_KEY");
const owner = process.env.PMS_OWNER_ID ?? "hotel-corali";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl() });

function unseal(value) {
  const [version, iv, tag, data] = value.split(".");
  if (version !== "v1") throw Error("INVALID_CIPHERTEXT");
  const d = createDecipheriv("aes-256-gcm", createHash("sha256").update(process.env.PMS_DOCUMENT_KEY).digest(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

try {
  // Room air conditioners: power only while a guest is checked in / present (see room-ac-worker.mjs).
  const ac = await runRoomAc({ pool, owner, unseal }).catch((e) => { console.error("A/C power failed", e); return null; });
  if (ac) console.log(`A/C power: ${ac.rooms} rooms checked, ${ac.switched} switched${ac.failed ? `, ${ac.failed} failed` : ""}`);
  const plugs = await runTvPlugs({ pool, owner, unseal });
  console.log(plugs.off ? `${plugs.label} power: automation off or Shelly not configured` : `${plugs.label} power: ${plugs.rooms} rooms checked, ${plugs.switched} switched`);
} finally {
  await pool.end();
}
