import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { after } from "next/server";
import { acceptChannexWebhook } from "@/lib/channel-sync";
import { env } from "@/lib/env";

let lastRun = 0;

/** Start the channel sync now (the script's own lock prevents two runs at once). At most every 10 seconds. */
function syncNow() {
  if (Date.now() - lastRun < 10_000) return;
  lastRun = Date.now();
  const script = path.join(process.cwd(), "scripts", "run-channel-sync.mjs");
  if (!existsSync(script)) return;
  const child = spawn(process.execPath, [script], { cwd: process.cwd(), env: process.env, stdio: "ignore", detached: true });
  child.on("error", (e) => console.error("Channel sync from webhook failed to start", e));
  child.unref();
}

/**
 * Channex webhook (Settings → Webhooks, event "booking"): any booking event makes the PMS import it now. The link
 * carries a secret token made in PMS → Integrations → Channel Manager.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token) || !(await acceptChannexWebhook(env().PMS_OWNER_ID, token))) return Response.json({ ok: false }, { status: 401 });
  await request.text().catch(() => "");
  after(syncNow);
  return Response.json({ ok: true });
}
