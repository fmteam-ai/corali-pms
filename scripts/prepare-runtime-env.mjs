import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [pmsFile, bookingFile, requestedPmsOrigin, requestedBookingOrigin] = process.argv.slice(2);
if (!pmsFile || !bookingFile || !requestedPmsOrigin || !requestedBookingOrigin) {
  throw new Error("Usage: prepare-runtime-env.mjs PMS_ENV BOOKING_ENV PMS_ORIGIN BOOKING_ORIGIN");
}

function canonicalOrigin(value, label) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be an HTTPS origin without path, credentials, query or fragment`);
  }
  return url.origin;
}

function readEnvironment(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const values = new Map();
  for (const source of lines) {
    const line = source.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    if (values.has(key)) throw new Error(`Duplicate ${key} in ${path.basename(file)}`);
    values.set(key, line.slice(separator + 1).trim());
  }
  return { lines, values };
}

function upsert(lines, key, value) {
  const expression = new RegExp(`^\\s*${key}=`);
  const index = lines.findIndex((line) => expression.test(line));
  if (index >= 0) lines[index] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
}

function prepare(file, role, pmsOrigin, bookingOrigin, ownerId) {
  const environment = readEnvironment(file);
  const documentKey = environment.values.get("PMS_DOCUMENT_KEY") ?? "";
  const databaseUrl = environment.values.get("DATABASE_URL") ?? "";
  if (documentKey.length < 32) throw new Error(`PMS_DOCUMENT_KEY in ${path.basename(file)} must contain at least 32 characters`);
  if (!databaseUrl) throw new Error(`DATABASE_URL is missing from ${path.basename(file)}`);
  new URL(databaseUrl);

  const databaseSsl = environment.values.get("DATABASE_SSL") || "false";
  if (databaseSsl !== "true" && databaseSsl !== "false") {
    throw new Error(`DATABASE_SSL in ${path.basename(file)} must be true or false`);
  }
  const currentSecret = environment.values.get("SESSION_SECRET") ?? "";
  const sessionSecret = currentSecret.length >= 32 ? currentSecret : randomBytes(48).toString("base64url");
  const lines = [...environment.lines];
  upsert(lines, "NODE_ENV", "production");
  upsert(lines, "DATABASE_SSL", databaseSsl);
  upsert(lines, "SESSION_SECRET", sessionSecret);
  upsert(lines, "PMS_ORIGIN", pmsOrigin);
  upsert(lines, "BOOKING_ORIGIN", bookingOrigin);
  upsert(lines, "PMS_OWNER_ID", ownerId);
  upsert(lines, "APP_ROLE", role);

  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${lines.filter((line, index, all) => line !== "" || index < all.length - 1).join("\n")}\n`, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
}

const pmsOrigin = canonicalOrigin(requestedPmsOrigin, "PMS origin");
const bookingOrigin = canonicalOrigin(requestedBookingOrigin, "Booking origin");
const pms = readEnvironment(pmsFile);
const booking = readEnvironment(bookingFile);
const pmsKey = pms.values.get("PMS_DOCUMENT_KEY") ?? "";
const bookingKey = booking.values.get("PMS_DOCUMENT_KEY") ?? "";
if (!pmsKey || pmsKey !== bookingKey) throw new Error("PMS and booking PMS_DOCUMENT_KEY values do not match");
const ownerId = pms.values.get("PMS_OWNER_ID") || booking.values.get("PMS_OWNER_ID") || "hotel-corali";
if (ownerId.length < 3) throw new Error("PMS_OWNER_ID must contain at least 3 characters");

prepare(pmsFile, "pms", pmsOrigin, bookingOrigin, ownerId);
prepare(bookingFile, "booking", pmsOrigin, bookingOrigin, ownerId);
console.log("PMS and booking runtime configuration: OK");
