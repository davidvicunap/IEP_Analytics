// IEP Analytics service worker: shows live-thesis alerts sent by the server (Web Push) and opens
// the thesis when one is tapped. It caches nothing: every page still comes from the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let m = {};
  try {
    m = event.data ? event.data.json() : {};
  } catch {
    m = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(m.title || "IEP Analytics", {
      body: m.body || "",
      tag: m.tag || undefined,
      renotify: Boolean(m.tag),
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: m.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only pages of this site.
  let url = new URL("/", self.location.origin).href;
  try {
    const u = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : "/", self.location.origin);
    if (u.origin === self.location.origin) url = u.href;
  } catch {
    /* keep the home page */
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => w.url === url);
      if (open) return open.focus();
      const ours = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (ours && "navigate" in ours) {
        await ours.navigate(url).catch(() => undefined);
        return ours.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
