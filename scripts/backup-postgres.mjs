import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const outputArgument = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
if (!outputArgument || !path.isAbsolute(outputArgument)) {
  throw new Error("Usage: node --env-file=runtime.env backup-postgres.mjs /absolute/backup.dump");
}
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const url = new URL(databaseUrl);
if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
  throw new Error("DATABASE_URL must be PostgreSQL");
}

const output = path.resolve(outputArgument);
if (fs.existsSync(output)) throw new Error(`Backup already exists: ${output}`);
fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });

const username = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
const executable = process.env.PG_DUMP_BIN?.trim() || "pg_dump";
const child = spawnSync(
  executable,
  [
    `--host=${url.hostname}`,
    `--port=${url.port || "5432"}`,
    `--username=${username}`,
    `--dbname=${database}`,
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    `--file=${output}`,
  ],
  {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      PGPASSWORD: password,
      PGSSLMODE: process.env.DATABASE_SSL === "true" ? "verify-full" : "disable",
      ...(process.env.DATABASE_SSL_CA ? { PGSSLROOTCERT: process.env.DATABASE_SSL_CA } : {}),
    },
  },
);

if (child.error?.code === "ENOENT") {
  throw new Error("pg_dump is not installed or PG_DUMP_BIN is invalid");
}
if (child.error) throw child.error;
if (child.status !== 0) throw new Error(`pg_dump failed with status ${child.status}`);
const stats = fs.statSync(output);
if (stats.size < 1) throw new Error("PostgreSQL backup is empty");
fs.chmodSync(output, 0o600);
console.log(`PostgreSQL backup: OK (${stats.size} bytes)`);
