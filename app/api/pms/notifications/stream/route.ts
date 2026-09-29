import { requireApiUser } from "@/lib/auth";
import { notificationSignature } from "@/lib/pms-notification-feed";

export const dynamic = "force-dynamic";

const CHECK_MS = 5_000;
const HEARTBEAT_MS = 25_000;
const LIFETIME_MS = 5 * 60_000; // EventSource reconnects automatically; recycling keeps proxies and pool connections healthy.

/** Server-sent events: emits "changed" whenever the notification feed changes. Works behind Passenger/Apache where WebSockets are unavailable. */
export async function GET(request: Request) {
  const user = await requireApiUser("dashboard.read");
  if (user instanceof Response) return user;
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now();
      let last = "";
      let lastBeat = started;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };
      const send = (text: string) => { if (!closed) controller.enqueue(encoder.encode(text)); };
      const check = async () => {
        try {
          const signature = await notificationSignature(user.ownerId);
          if (signature !== last) {
            last = signature;
            send(`event: changed\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
          } else if (Date.now() - lastBeat > HEARTBEAT_MS) {
            send(`: keep-alive\n\n`);
          }
          lastBeat = Date.now();
          if (Date.now() - started > LIFETIME_MS) close();
        } catch {
          close();
        }
      };
      send(`retry: 5000\n\n`);
      await check();
      timer = setInterval(check, CHECK_MS);
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
