import { API_BASE } from "../apiConfig";

const RETRY_DELAYS_MS = [0, 700, 1800];

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export async function ensurePushSubscription({
  token,
  interactive = false,
  forceRebind = false,
} = {}) {
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

  if (Notification.permission === "default" && interactive) {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        return { enabled: true, subscribed: false };
      }
    } catch {
      return { enabled: true, subscribed: false };
    }
  }

  let keyData = null;
  try {
    const keyRes = await fetch(`${API_BASE}/notifications/push/public-key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    keyData = await keyRes.json().catch(() => ({}));
    const enabled = Boolean(keyRes.ok && keyData?.enabled && keyData?.publicKey);
    if (!enabled) {
      return { enabled: false, subscribed: false };
    }
  } catch {
    return { enabled: true, subscribed: false };
  }

  if (Notification.permission !== "granted") {
    return { enabled: true, subscribed: false };
  }

  for (const delayMs of RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      const registration = await navigator.serviceWorker.register("/push-sw.js");
      const readyRegistration = await navigator.serviceWorker.ready.catch(() => registration);

      let subscription = await readyRegistration.pushManager.getSubscription();
      // На входе под другим пользователем на том же устройстве принудительно
      // отвязываем старую локальную подписку и создаем новую для текущего аккаунта.
      if (subscription && forceRebind) {
        try {
          await fetch(`${API_BASE}/notifications/push/unsubscribe`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
        } catch {
          // no-op
        }
        try {
          await subscription.unsubscribe();
        } catch {
          // no-op
        }
        subscription = null;
      }

      if (!subscription) {
        subscription = await readyRegistration.pushManager.subscribe({
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

      if (saveRes.ok) {
        return { enabled: true, subscribed: true };
      }
    } catch {
      // retry
    }
  }

  return { enabled: true, subscribed: false };
}

export async function requestPushPermissionIfNeeded() {
  if (typeof window === "undefined") {
    return { ok: false, permission: "default", reason: "NO_WINDOW" };
  }
  if (typeof Notification === "undefined") {
    return { ok: false, permission: "default", reason: "NO_NOTIFICATION_API" };
  }
  if (window.isSecureContext === false) {
    return { ok: false, permission: Notification.permission, reason: "INSECURE_CONTEXT" };
  }

  const ua = String(window.navigator?.userAgent || "").toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    window.navigator?.standalone === true;

  if (isIos && !isStandalone) {
    return { ok: false, permission: Notification.permission, reason: "IOS_NOT_STANDALONE" };
  }

  if (!("PushManager" in window)) {
    return { ok: false, permission: Notification.permission, reason: "NO_PUSH_MANAGER" };
  }

  if (Notification.permission !== "default") {
    return {
      ok: Notification.permission === "granted",
      permission: Notification.permission,
      reason: Notification.permission === "denied" ? "DENIED" : undefined,
    };
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission === "default") {
      return { ok: false, permission, reason: "PERMISSION_NOT_CHOSEN" };
    }
    return {
      ok: permission === "granted",
      permission,
      reason: permission === "denied" ? "DENIED" : undefined,
    };
  } catch {
    return { ok: false, permission: Notification.permission, reason: "REQUEST_FAILED" };
  }
}
