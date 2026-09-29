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

export { detectLanguage, suggestedReply } from "./social-reply.ts";
