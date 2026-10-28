// Hotel Corali partner app service worker: new orders and offer decisions (Web Push), also when the app is closed.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil((async () => {
    await self.registration.showNotification(d.title || "Hotel Corali", {
      body: d.body || "", tag: d.tag || undefined, renotify: Boolean(d.tag), icon: "/partner-icon-192.png", badge: "/partner-icon-192.png",
      vibrate: [120, 60, 120], data: { url: d.url || "/partner" },
    });
    // An open app reloads its messages at once.
    for (const c of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) c.postMessage({ type: "corali-refresh" });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/partner", self.location.origin).href;
  event.waitUntil((async () => {
    for (const c of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      if (new URL(c.url).pathname.startsWith("/partner") && "focus" in c) { c.postMessage({ type: "corali-refresh" }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
