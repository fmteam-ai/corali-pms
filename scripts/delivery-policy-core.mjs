// v190: after a failed send, was the message definitely NOT delivered, or is the result unknown? A timeout, a reset
// connection or a cancelled step can happen after the provider already accepted the message (SMTP after DATA, a
// WhatsApp request the API processed but whose answer was lost). Retrying those would send the guest the same
// message twice, so they become «uncertain» and wait for a person's decision instead of an automatic retry.
// Push notifications are the exception: a repeated push carries the same tag and replaces the first on the phone.

/** Never reached the provider, or the provider answered «refused»: safe to retry. */
const NOT_SENT_CODES = new Set(["ECONNECTION", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EDNS", "EAUTH", "EENVELOPE", "ETLS", "EHOSTUNREACH", "ENETUNREACH", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT"]);
/** The connection was open (or the request sent) when it broke: the message may have gone. */
const UNCERTAIN = /TIMEOUT|TIMEDOUT|ETIMEDOUT|ESOCKET|ECONNRESET|EPIPE|UND_ERR_SOCKET|UND_ERR_CLOSED|socket hang up|AbortError|TimeoutError|aborted|CANCELLED/i;

export function sendOutcome(err) {
  if (!err) return "uncertain";
  const e = /** @type {any} */ (err);
  const msg = String(e.message ?? e);
  const code = String(e.code ?? e.cause?.code ?? "");
  if (UNCERTAIN.test(msg) || UNCERTAIN.test(code) || UNCERTAIN.test(String(e.name ?? ""))) return "uncertain";
  if (NOT_SENT_CODES.has(code)) return "not_sent";
  // SMTP reply 4xx / 5xx: the server answered and refused the message.
  if (Number(e.responseCode) >= 400) return "not_sent";
  // Our own checks before anything is sent (SMTP_NOT_CONFIGURED, WHATSAPP_HTTP_400 = an answer from Meta, …).
  if (/^[A-Z][A-Z0-9_]+$/.test(msg)) return "not_sent";
  if (/^fetch failed$/i.test(msg) && NOT_SENT_CODES.has(String(e.cause?.code ?? ""))) return "not_sent";
  return "uncertain";
}

/** Whether a channel retries an uncertain send by itself. */
export const RETRY_UNCERTAIN = { email: false, whatsapp: false, sms: false, push: true };

export function failedStatus(err, channel) {
  return sendOutcome(err) === "not_sent" || RETRY_UNCERTAIN[channel] ? "failed" : "uncertain";
}
