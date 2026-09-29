import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadRuntimeEnvironment } from "../scripts/load-runtime-env.mjs";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "corali-runtime-loader-"));
const runtimeFile = path.join(directory, "runtime.env");
const original = {
  DATABASE_URL: process.env.DATABASE_URL,
  APP_ROLE: process.env.APP_ROLE,
  PMS_ORIGIN: process.env.PMS_ORIGIN,
};

try {
  process.env.DATABASE_URL = "postgresql://stale-passenger.invalid/stale";
  process.env.APP_ROLE = "stale-role";
  delete process.env.PMS_ORIGIN;
  await fs.writeFile(runtimeFile, [
    "# protected deployment settings",
    "DATABASE_URL=postgresql://runtime-user:runtime-pass@127.0.0.1:5432/corali",
    "APP_ROLE=booking",
    "PMS_ORIGIN=https://pms.hotelcorali.gr",
    "INVALID-KEY=ignored",
    "",
  ].join("\n"), { mode: 0o600 });

  const loaded = loadRuntimeEnvironment(runtimeFile);
  assert.deepEqual(loaded, ["DATABASE_URL", "APP_ROLE", "PMS_ORIGIN"]);
  assert.equal(process.env.DATABASE_URL, "postgresql://runtime-user:runtime-pass@127.0.0.1:5432/corali");
  assert.equal(process.env.APP_ROLE, "booking");
  assert.equal(process.env.PMS_ORIGIN, "https://pms.hotelcorali.gr");
  console.log("Protected runtime.env overrides stale Passenger variables: OK");
} finally {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(directory, { recursive: true, force: true });
}
