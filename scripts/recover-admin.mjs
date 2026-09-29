import fs from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import { hash } from "@node-rs/argon2";
import { applyAdministratorRecovery, validateRecoveryInput } from "./admin-recovery-core.mjs";
import { databaseSsl } from "./database-config.mjs";

const inputFile = process.argv[2];
if (!inputFile || !process.env.DATABASE_URL) throw new Error("Recovery input and DATABASE_URL are required");

const input = validateRecoveryInput(JSON.parse(await fs.readFile(inputFile, "utf8")));

const ownerId = process.env.PMS_OWNER_ID ?? "hotel-corali";
const now = Date.now();
const passwordHash = await hash(input.password, { algorithm: 2, memoryCost: 65536, timeCost: 3, parallelism: 1, outputLen: 32 });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl() });
const client = await pool.connect();

try {
  await applyAdministratorRecovery(client, { ownerId, input, passwordHash, now });
  console.log("PMS administrator access recovered successfully.");
} finally {
  client.release();
  await pool.end();
}
