import { z } from "zod";
import { requestJson, requestRaw } from "@/lib/http";
import {
  authResultSchema,
  marketingPreferencesSchema,
  notificationsPayloadSchema,
  orderHistoryPayloadSchema,
  orderQueuePayloadSchema,
  orgProfileSchema,
  pickingReportSchema,
  purchaseOrderSchema,
  stockSummaryItemSchema,
  taskSchema,
  userSchema,
  usersPayloadSchema,
  warehouseTransactionsPayloadSchema,
} from "@/types/contracts";

const successSchema = z.object({ ok: z.boolean().optional(), message: z.string().optional() }).passthrough();

export async function login(login: string, password: string) {
  return requestJson("/api/auth/login", authResultSchema, {
    method: "POST",
    body: { login, password },
  });
}

export async function register(payload: {
  email: string;
  password: string;
  name: string;
  phone: string;
  companyName: string;
  privacyAccepted: boolean;
  marketingAccepted: boolean;
}) {
  return requestJson(
    "/api/auth/register",
    z.object({ ok: z.boolean().optional(), requiresVerification: z.boolean(), email: z.string(), message: z.string() }),
    {
      method: "POST",
      body: payload,
    }
  );
}

export async function verifyEmailCode(email: string, code: string) {
  return requestJson("/api/auth/verify-email", authResultSchema, {
    method: "POST",
    body: { email, code },
  });
}

export async function resendVerificationCode(email: string) {
  return requestJson(
    "/api/auth/resend-code",
    z.object({ message: z.string() }),
    { method: "POST", body: { email } }
  );
}

export async function forgotPassword(email: string) {
  return requestJson(
    "/api/auth/forgot-password",
    z.object({ message: z.string() }),
    { method: "POST", body: { email } }
  );
}

export async function resetPassword(token: string, password: string) {
  return requestJson(
    "/api/auth/reset-password",
    z.object({ message: z.string() }),
    { method: "POST", body: { token, password } }
  );
}

export async function logout() {
  return requestJson("/api/auth/logout", z.object({ ok: z.boolean() }), { method: "POST" });
}

export async function fetchMe() {
  return requestJson("/api/proxy/me", userSchema);
}

export async function fetchStockSummary() {
  return requestJson("/api/proxy/warehouse/stock/summary", z.array(stockSummaryItemSchema));
}

export async function fetchOrdersQueue() {
  return requestJson("/api/proxy/orders/queue", orderQueuePayloadSchema);
}

export async function fetchOrderHistory(limit = 50) {
  return requestJson(`/api/proxy/orders/status-history?limit=${limit}`, orderHistoryPayloadSchema);
}

export async function fetchTasksAll() {
  return requestJson("/api/proxy/warehouse/tasks", z.array(taskSchema));
}

export async function fetchTasksMy() {
  return requestJson("/api/proxy/warehouse/tasks/my", z.array(taskSchema));
}

export async function updateTaskStatus(taskId: number, status: string) {
  return requestJson(`/api/proxy/warehouse/tasks/${taskId}/status`, taskSchema, {
    method: "PUT",
    body: { status },
  });
}

export async function submitTaskResponse(taskId: number, responseText: string) {
  return requestJson(`/api/proxy/warehouse/tasks/${taskId}/response`, taskSchema, {
    method: "PUT",
    body: { responseText },
  });
}

export async function fetchNotifications(limit = 50) {
  return requestJson(`/api/proxy/notifications?limit=${limit}`, notificationsPayloadSchema);
}

export async function markNotificationRead(id: number) {
  return requestJson(`/api/proxy/notifications/${id}/read`, successSchema, { method: "POST" });
}

export async function markAllNotificationsRead() {
  return requestJson("/api/proxy/notifications/read-all", successSchema, { method: "POST" });
}

export async function fetchPurchaseOrders() {
  return requestJson("/api/proxy/purchase-orders", z.array(purchaseOrderSchema));
}

export async function fetchWarehouseTransactions(limit = 200) {
  return requestJson(`/api/proxy/warehouse/transactions?limit=${limit}`, warehouseTransactionsPayloadSchema);
}

export async function fetchUsers() {
  return requestJson("/api/proxy/users", usersPayloadSchema);
}

export async function changeUserRole(userId: number, role: string) {
  return requestJson(
    `/api/proxy/users/${userId}/role`,
    z.object({ user: usersPayloadSchema.element }),
    {
      method: "PUT",
      body: { role },
    }
  );
}

export async function fetchPickingReport(rangeDays = 7) {
  const to = new Date();
  const from = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return requestJson(`/api/proxy/admin/reports/picking?${query.toString()}`, pickingReportSchema);
}

export async function fetchOrgProfile() {
  return requestJson("/api/proxy/settings/org-profile", orgProfileSchema);
}

export async function saveOrgProfile(payload: {
  orgName: string;
  legalAddress: string;
  actualAddress: string;
  inn: string;
  kpp: string;
  phone: string;
  purchaseOrderEmailTemplate?: string;
}) {
  return requestJson("/api/proxy/settings/org-profile", orgProfileSchema, {
    method: "PUT",
    body: payload,
  });
}

export async function fetchMarketingPreferences() {
  return requestJson("/api/proxy/settings/marketing-preferences", marketingPreferencesSchema);
}

export async function updateMarketingPreferences(enabled: boolean) {
  return requestJson("/api/proxy/settings/marketing-preferences", marketingPreferencesSchema, {
    method: "PUT",
    body: { enabled },
  });
}

export async function downloadViaProxy(path: string) {
  return requestRaw(`/api/proxy/${path.replace(/^\/+/, "")}`);
}
