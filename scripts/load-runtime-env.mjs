import fs from "node:fs";

export function loadRuntimeEnvironment(file) {
  if (!fs.existsSync(file)) return [];

  const loaded = [];
  for (const sourceLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;

    // runtime.env is the protected, deployment-verified source of truth.
    // Passenger/cPanel can retain stale application variables across a swap,
    // so every key present here must replace an inherited process value.
    process.env[key] = value;
    loaded.push(key);
  }
  return loaded;
}
