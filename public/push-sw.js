self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "СкладОнлайн";
  const body = payload.body || "Новое уведомление";
  const url = payload.url || "/warehouse";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url },
      renotify: true,
      tag: String(payload.notificationId || `${title}-${Date.now()}`),
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetPath = event.notification?.data?.url || "/warehouse";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const appClient = clients.find((client) =>
        String(client.url || "").startsWith(self.location.origin)
      );

      if (appClient) {
        if ("navigate" in appClient) {
          try {
            await appClient.navigate(targetUrl);
          } catch {
            // ignore and try focus/open fallback
          }
        }
        if ("focus" in appClient) {
          return appClient.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return null;
    })
  );
});
