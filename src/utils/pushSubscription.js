import { API_BASE } from "../apiConfig";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export async function ensurePushSubscription({ token, interactive = false } = {}) {
  if (!token) return { enabled: false, subscribed: false };
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { enabled: false, subscribed: false };
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { enabled: false, subscribed: false };
  }
  if (typeof Notification === "undefined") {
    return { enabled: false, subscribed: false };
  }

  try {
    if (Notification.permission === "default" && interactive) {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        return { enabled: true, subscribed: false };
      }
    }

    const keyRes = await fetch(`${API_BASE}/notifications/push/public-key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const keyData = await keyRes.json().catch(() => ({}));
    const enabled = Boolean(keyRes.ok && keyData?.enabled && keyData?.publicKey);

    if (!enabled) {
      return { enabled: false, subscribed: false };
    }

    if (Notification.permission !== "granted") {
      return { enabled: true, subscribed: false };
    }

    const registration = await navigator.serviceWorker.register("/push-sw.js");
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
      });
    }

    const saveRes = await fetch(`${API_BASE}/notifications/push/subscribe`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(subscription),
    });

    return { enabled: true, subscribed: saveRes.ok };
  } catch {
    return { enabled: true, subscribed: false };
  }
}

export async function requestPushPermissionIfNeeded() {
  if (typeof window === "undefined") return;
  if (typeof Notification === "undefined") return;
  if (!("PushManager" in window)) return;
  if (Notification.permission !== "default") return;
  try {
    await Notification.requestPermission();
  } catch {
    // ignore permission request errors
  }
}
