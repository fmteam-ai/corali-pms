// Social media helpers (pure; unit tested).
import { createHmac, timingSafeEqual } from "node:crypto";

export const socialChannels = ["facebook", "instagram", "tiktok"] as const;
export type SocialChannel = (typeof socialChannels)[number];
export type PostStatus = "draft" | "pending_approval" | "approved" | "published" | "partially_published" | "failed" | "rejected";

/** Allowed workflow moves. Publishing is only done by the worker for approved posts. */
export function postTransition(status: string, action: "submit" | "approve" | "reject" | "edit" | "withdraw"): PostStatus | null {
  if (action === "submit" && (status === "draft" || status === "rejected")) return "pending_approval";
  if ((action === "approve" || action === "reject") && status === "pending_approval") return action === "approve" ? "approved" : "rejected";
  if (action === "edit" && ["draft", "rejected", "pending_approval"].includes(status)) return "draft";
  if (action === "withdraw" && (status === "approved" || status === "pending_approval")) return "draft";
  return null;
}

/** Strict gate: someone other than the author approves, except the owner who may approve their own post. */
export function canApprove(authorId: number, approverId: number, approverRole: string) {
  return authorId !== approverId || approverRole === "owner";
}

/** Meta webhook signature (X-Hub-Signature-256: sha256=<hex HMAC of raw body with the app secret>). */
export function validMetaSignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const given = header.slice(7);
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** TikTok webhook signature (TikTok-Signature: t=<unix seconds>,s=<hex HMAC of "t.body" with the client secret>). */
export function validTikTokSignature(rawBody: string, header: string | null, clientSecret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!header || !clientSecret) return false;
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.trim().split("=") as [string, string]));
  const t = Number(parts.t), given = parts.s ?? "";
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > 300) return false;
  const expected = createHmac("sha256", clientSecret).update(`${parts.t}.${rawBody}`).digest("hex");
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

type TikTokEvent = { event?: string; content?: unknown };
/** Incoming TikTok direct message from a webhook event (content may be a JSON string), or null for other events. */
export function tiktokMessage(event: TikTokEvent): { senderId: string; text: string; id: string | null; at: number } | null {
  if (!event?.event || !/message|msg/i.test(event.event)) return null;
  let c: Record<string, unknown> = {};
  try { c = typeof event.content === "string" ? JSON.parse(event.content) : ((event.content ?? {}) as Record<string, unknown>); } catch { return null; }
  const msg = (c.message ?? c) as Record<string, unknown>;
  const text = String((msg.text as string | undefined) ?? ((msg.content as Record<string, unknown> | undefined)?.text as string | undefined) ?? "").trim();
  const senderId = String(c.from_user_id ?? c.sender_id ?? (c.sender as Record<string, unknown> | undefined)?.id ?? "");
  if (!text || !senderId || c.is_echo === true) return null;
  return { senderId: senderId.slice(0, 100), text: text.slice(0, 2000), id: (c.message_id ?? msg.message_id ?? null) as string | null, at: Number(c.create_time ?? c.timestamp) ? Number(c.create_time ?? c.timestamp) * (Number(c.create_time ?? c.timestamp) < 1e12 ? 1000 : 1) : Date.now() };
}

export { detectLanguage, suggestedReply } from "./social-reply.ts";
