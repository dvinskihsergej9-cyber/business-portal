import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import multer from "multer";
import crypto from "crypto";
import nodemailer from "nodemailer";
import QRCode from "qrcode";
import bwipjs from "bwip-js";
import { AsyncLocalStorage } from "node:async_hooks";
import { adminRoutes } from "./adminRoutes.js";
import { createWarehouseStockService } from "./services/warehouseStockService.js";
import {
  getPermissionCatalog,
  hasAnyPermission,
  hasPermission,
  normalizePermissionConfig,
  PERMISSION_KEYS,
  resolveUserPermissions,
  stringifyPermissionConfig,
} from "./permissions.js";

// ================== ИНИЦИАЛИЗАЦИЯ ==================

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const IS_PRODUCTION_RUNTIME =
  String(process.env.NODE_ENV || "").toLowerCase() === "production";

if (!DATABASE_URL) {
  console.error("[DB_CONFIG] DATABASE_URL не задан. Сервер остановлен.");
  process.exit(1);
}

if (IS_PRODUCTION_RUNTIME && DATABASE_URL.toLowerCase().startsWith("file:")) {
  console.error(
    "[DB_CONFIG] В production запрещена SQLite (file:). Подключите постоянную PostgreSQL базу."
  );
  process.exit(1);
}

const app = express();
const prismaBase = new PrismaClient();
let prisma = prismaBase;
const requestContext = new AsyncLocalStorage();

// для загрузки файлов в память (будем читать Excel из буфера)
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  requestContext.run(
    { orgId: null, isSystemOwner: false, skipTenantScope: false },
    () => next()
  );
});

// ================== JWT / АВТОРИЗАЦИЯ ==================

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key"; // в .env в бою
const JWT_EXPIRES_IN = "7d";

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId || null,
      tokenVersion: user.tokenVersion || 0,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function auth(req, res, next) {
  if (req.user?.id) {
    return next();
  }
  const header = req.headers["authorization"];
  if (!header) {
    return res.status(401).json({ message: "????????? ????? ???????????." });
  }

  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) {
    return res.status(401).json({ message: "Неверный формат токена" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) {
      return res.status(401).json({ message: "TOKEN_INVALID" });
    }
    if (user.isActive === false) {
      return res.status(401).json({ message: "USER_INACTIVE" });
    }
    if ((payload.tokenVersion || 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({ message: "TOKEN_INVALID" });
    }
    if (!user.orgId) {
      user.orgId = await ensureUserOrg(user.id, user.name || user.email);
    }
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId || null,
      isSystemOwner: String(user.email || "").trim().toLowerCase() === OWNER_PRIMARY_EMAIL,
      permissions: resolveUserPermissions({
        role: user.role,
        permissionsJson: user.permissionsJson,
        isSystemOwner:
          String(user.email || "").trim().toLowerCase() === OWNER_PRIMARY_EMAIL,
      }),
    };
    const store = requestContext.getStore();
    if (store) {
      store.orgId = req.user.orgId || null;
      store.isSystemOwner = req.user.isSystemOwner === true;
    }
    next();
  } catch (err) {
    console.error("auth error:", err);
    return res.status(401).json({ message: "Недействительный токен" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ message: "Нужны права администратора" });
  }
  next();
}

function requireSystemOwner(req, res, next) {
  if (!req.user?.isSystemOwner) {
    return res
      .status(403)
      .json({ message: "Доступно только владельцу приложения" });
  }
  next();
}

function requireHr(req, res, next) {
  if (!PORTAL_ALLOWED_ROLES.includes(req.user?.role)) {
    return res
      .status(403)
      .json({ message: "Требуются права сотрудника или администратора" });
  }
  next();
}

function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (hasPermission(req.user, permissionKey)) {
      return next();
    }
    return res.status(403).json({ message: "Нет доступа к разделу." });
  };
}

function requireAnyPermission(permissionKeys = []) {
  return (req, res, next) => {
    if (hasAnyPermission(req.user, permissionKeys)) {
      return next();
    }
    return res.status(403).json({ message: "Нет доступа к разделу." });
  };
}



const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const INVITE_EMAIL_COOLDOWN_MS = 60 * 1000;
const INVITE_GLOBAL_LIMIT = 20;

const RESET_TTL_MS = 45 * 60 * 1000;
const RESET_EMAIL_COOLDOWN_MS = 60 * 1000;
const RESET_GLOBAL_LIMIT = 30;

const resetEmailRate = new Map();
const resetGlobalRate = [];

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const OWNER_PRIMARY_EMAIL = "dvinskihsergej9@gmail.com";
const OWNER_PRIMARY_PASSWORD = "Sergo0998";
const PORTAL_ALLOWED_ROLES = Object.freeze(["EMPLOYEE", "ADMIN"]);
const OWNER_PRIMARY_NAME = "Сергей Двинских";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLogin(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase();
}

function isValidUsername(value) {
  return /^[\p{L}\p{N}._-]{3,32}$/u.test(String(value || ""));
}

function normalizePortalRole(value, fallback = "EMPLOYEE") {
  const normalized = String(value || "").trim().toUpperCase();
  return PORTAL_ALLOWED_ROLES.includes(normalized) ? normalized : fallback;
}

function buildTechnicalEmailByUsername(username) {
  const normalized = normalizeLogin(username);
  const hex = Buffer.from(normalized, "utf8").toString("hex").slice(0, 40);
  return `user-${hex || "unknown"}@users.local`;
}

function isOwnerEmail(email) {
  return normalizeEmail(email) === OWNER_PRIMARY_EMAIL;
}

function makeTenantCode(name) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`.slice(-9);
  return `КЛ-${stamp}`;
}

async function getOrCreateOrganizationByCode(code, name) {
  const normalizedCode = String(code || "").trim().toLowerCase();
  const normalizedName = String(name || "").trim() || "Организация";
  if (!normalizedCode) {
    throw new Error("ORG_CODE_REQUIRED");
  }

  const existing = await prisma.organization.findUnique({
    where: { code: normalizedCode },
  });
  if (existing) return existing;

  return prisma.organization.create({
    data: {
      code: normalizedCode,
      name: normalizedName,
      isActive: true,
    },
  });
}

async function ensureUserOrg(userId, fallbackName = "Организация") {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, orgId: true, email: true, name: true },
  });
  if (!user) return null;
  if (user.orgId) return user.orgId;

  const code = isOwnerEmail(user.email) ? "platform-owner" : "legacy-tenant";
  const orgName = isOwnerEmail(user.email)
    ? "Владелец платформы"
    : String(fallbackName || "Организация по умолчанию").trim();
  const org = await getOrCreateOrganizationByCode(code, orgName);
  await prisma.user.update({
    where: { id: user.id },
    data: { orgId: org.id },
  });
  return org.id;
}

const TENANT_SCOPED_MODELS = new Set([
  "User",
  "InviteToken",
  "Employee",
  "HrLeaveApplication",
  "SafetyInstruction",
  "SafetyAssignment",
  "LeaveRequest",
  "PaymentRequest",
  "Payment",
  "WarehouseRequest",
  "WarehouseRequestItem",
  "WarehouseTask",
  "PurchaseOrder",
  "PurchaseOrderItem",
  "Item",
  "WarehouseLocation",
  "WarehouseReceivingLine",
  "WarehousePlacement",
  "StockMovement",
  "BinAuditSession",
  "BinAuditEvent",
  "StockDiscrepancy",
  "StockRevision",
  "StockRevisionItem",
  "ReceivingDiscrepancy",
  "OrgProfile",
  "Supplier",
  "SupplierTruck",
  "SalesOrder",
  "SalesOrderLine",
]);

function withTenantWhere(where, orgId) {
  if (!where) return { orgId };
  return { AND: [where, { orgId }] };
}

async function runWithoutTenantScope(fn) {
  const store = requestContext.getStore();
  if (!store) return fn();
  const prev = store.skipTenantScope;
  store.skipTenantScope = true;
  try {
    return await fn();
  } finally {
    store.skipTenantScope = prev;
  }
}
async function getNextPurchaseOrderNumber(orgId) {
  const normalizedOrgId = orgId ? Number(orgId) : null;

  const recentOrders = await runWithoutTenantScope(() =>
    prismaBase.purchaseOrder.findMany({
      where: {
        orgId: normalizedOrgId,
        number: { startsWith: "PO-" },
      },
      orderBy: { id: "desc" },
      take: 50,
      select: { number: true },
    })
  );

  let lastSeq = 0;
  for (const row of recentOrders) {
    const match = /^PO-(\d+)$/i.exec(String(row?.number || "").trim());
    if (match) {
      lastSeq = Number(match[1]) || 0;
      break;
    }
  }

  return "PO-" + String(lastSeq + 1).padStart(5, "0");
}

prisma = prismaBase.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const store = requestContext.getStore();
        if (!store || store.skipTenantScope) return query(args);
        if (!model || !TENANT_SCOPED_MODELS.has(model)) return query(args);
        if (store.isSystemOwner || !store.orgId) return query(args);

        const orgId = store.orgId;
        const delegate = prismaBase[model[0].toLowerCase() + model.slice(1)];
        const safeArgs = args || {};

        if (operation === "findMany" || operation === "findFirst" || operation === "count" || operation === "aggregate" || operation === "groupBy") {
          safeArgs.where = withTenantWhere(safeArgs.where, orgId);
          return query(safeArgs);
        }

        if (operation === "findUnique") {
          return runWithoutTenantScope(() =>
            delegate.findFirst({
              ...safeArgs,
              where: withTenantWhere(safeArgs.where, orgId),
            })
          );
        }

        if (operation === "findUniqueOrThrow") {
          return runWithoutTenantScope(() =>
            delegate.findFirstOrThrow({
              ...safeArgs,
              where: withTenantWhere(safeArgs.where, orgId),
            })
          );
        }

        if (operation === "create") {
          safeArgs.data = { ...(safeArgs.data || {}), orgId };
          return query(safeArgs);
        }

        if (operation === "createMany") {
          if (Array.isArray(safeArgs.data)) {
            safeArgs.data = safeArgs.data.map((row) => ({ ...row, orgId }));
          } else {
            safeArgs.data = { ...(safeArgs.data || {}), orgId };
          }
          return query(safeArgs);
        }

        if (operation === "updateMany" || operation === "deleteMany") {
          safeArgs.where = withTenantWhere(safeArgs.where, orgId);
          return query(safeArgs);
        }

        if (operation === "update" || operation === "delete") {
          const found = await runWithoutTenantScope(() =>
            delegate.findFirst({
              where: withTenantWhere(safeArgs.where, orgId),
              select: { id: true },
            })
          );
          if (!found) {
            const err = new Error("TENANT_NOT_FOUND");
            err.code = "TENANT_NOT_FOUND";
            throw err;
          }
          safeArgs.where = { id: found.id };
          if (operation === "update") {
            safeArgs.data = { ...(safeArgs.data || {}), orgId };
          }
          return query(safeArgs);
        }

        if (operation === "upsert") {
          const existing = await runWithoutTenantScope(() =>
            delegate.findFirst({
              where: safeArgs.where,
              select: { id: true, orgId: true },
            })
          );
          if (existing && existing.orgId && existing.orgId !== orgId) {
            const err = new Error("TENANT_CONFLICT");
            err.code = "TENANT_CONFLICT";
            throw err;
          }
          safeArgs.create = { ...(safeArgs.create || {}), orgId };
          safeArgs.update = { ...(safeArgs.update || {}), orgId };
          if (existing && !existing.orgId) {
            await runWithoutTenantScope(() =>
              delegate.update({
                where: { id: existing.id },
                data: { orgId },
              })
            );
          }
          return query(safeArgs);
        }

        return query(safeArgs);
      },
    },
  },
});

const stockService = createWarehouseStockService(prisma);

let mailTransport = null;

function getMailTransport() {
  if (mailTransport) return mailTransport;
  const host = process.env.MAIL_HOST;
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;
  if (!host || !user || !pass) return null;

  const port = Number(process.env.MAIL_PORT || 465);
  const secure = String(process.env.MAIL_SECURE || "true") === "true";
  mailTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return mailTransport;
}

function hashInviteToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashApiKey(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildApiKeyHint(token) {
  const value = String(token || "");
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function createInviteToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function sendInviteEmail(email, token) {
  const link = `${FRONTEND_URL}/invite?token=${token}`;
  const transport = getMailTransport();
  if (!transport) {
    console.log(`[INVITE] ${email}: ${link}`);
    return { sent: false, link };
  }

  const from = process.env.MAIL_FROM || `����������� <${process.env.MAIL_USER}>`;
  const subject = "\u041f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435 \u0432 �����������";
  const text = `\u0412\u044b \u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u044b \u0432 �����������. \u041f\u0435\u0440\u0435\u0439\u0434\u0438\u0442\u0435 \u043f\u043e \u0441\u0441\u044b\u043b\u043a\u0435 \u0434\u043b\u044f \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0438\u044f \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438: ${link}`;
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;">
      <p>\u0412\u044b \u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u044b \u0432 �����������.</p>
      <p>\u0421\u0441\u044b\u043b\u043a\u0430 \u0434\u043b\u044f \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0438\u044f \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438:</p>
      <p><a href="${link}">${link}</a></p>
      <p>\u0415\u0441\u043b\u0438 \u0432\u044b \u043d\u0435 \u043e\u0436\u0438\u0434\u0430\u043b\u0438 \u044d\u0442\u043e \u043f\u0438\u0441\u044c\u043c\u043e, \u043f\u0440\u043e\u0441\u0442\u043e \u0438\u0433\u043d\u043e\u0440\u0438\u0440\u0443\u0439\u0442\u0435 \u0435\u0433\u043e.</p>
    </div>
  `;

  try {
    await transport.sendMail({ from, to: email, subject, text, html });
    return { sent: true, link };
  } catch (err) {
    console.error("Invite email send error:", err);
    console.log(`[INVITE] ${email}: ${link}`);
    return { sent: false, link, error: err.message };
  }
}



async function sendPasswordResetEmail(email, token) {
  const link = `${FRONTEND_URL}/reset-password?token=${token}`;
  const transport = getMailTransport();
  if (!transport) {
    console.log(`[RESET] ${email}: ${link}`);
    return { sent: false, link };
  }

  const from = process.env.MAIL_FROM || `����������� <${process.env.MAIL_USER}>`;
  const subject = "Сброс пароля в �����������";
  const text = `Для сброса пароля перейдите по ссылке: ${link}`;
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;">
      <p>Для сброса пароля перейдите по ссылке:</p>
      <p><a href="${link}">${link}</a></p>
      <p>Если вы не запрашивали сброс, просто игнорируйте это письмо.</p>
    </div>
  `;

  try {
    await transport.sendMail({ from, to: email, subject, text, html });
    return { sent: true, link };
  } catch (err) {
    console.error("Reset email send error:", err);
    console.log(`[RESET] ${email}: ${link}`);
    return { sent: false, link, error: err.message };
  }
}

async function sendPasswordChangedEmail(email) {
  const transport = getMailTransport();
  if (!transport) return { sent: false };

  const from = process.env.MAIL_FROM || `����������� <${process.env.MAIL_USER}>`;
  const subject = "Пароль изменён";
  const text = "Пароль в ����������� был изменён. Если это были не вы, свяжитесь с администратором.";
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;">
      <p>${text}</p>
    </div>
  `;

  try {
    await transport.sendMail({ from, to: email, subject, text, html });
    return { sent: true };
  } catch (err) {
    console.error("Password changed email error:", err);
    return { sent: false, error: err.message };
  }
}

async function sendAutoReorderEmail({ to, subject, text }) {
  const transport = getMailTransport();
  if (!transport) {
    console.log(`[AUTO-REORDER] ${to}: ${subject}\n${text}`);
    return { sent: false };
  }

  const from = process.env.MAIL_FROM || `����������� <${process.env.MAIL_USER}>`;
  try {
    await transport.sendMail({ from, to, subject, text });
    return { sent: true };
  } catch (err) {
    console.error("Auto reorder email send error:", err);
    return { sent: false, error: err.message };
  }
}


const APP_URL = process.env.APP_URL || FRONTEND_URL;
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

async function getReceivingLocationId(tx) {
  const existing = await tx.warehouseLocation.findFirst({
    where: {
      OR: [
        { code: "RECEIVING" },
        { name: "RECEIVING" },
        { name: "???????" },
        { name: "??????" },
      ],
    },
  });
  if (existing) return existing.id;
  const created = await tx.warehouseLocation.create({
    data: {
      name: "???????",
      code: "RECEIVING",
    },
  });
  return created.id;
}

const PLANS = {
  "basic-30": {
    id: "basic-30",
    title: "Basic 30 days",
    amount: 1990,
    currency: "RUB",
    days: 30,
  },
};

function getPlan(planId) {
  return PLANS[planId] || null;
}

function addDays(date, days) {
  const base = new Date(date);
  const value = Number(days || 0);
  if (!Number.isFinite(value)) return base;
  base.setDate(base.getDate() + value);
  return base;
}

function formatAmount(amount) {
  const value = Number(amount || 0);
  return value.toFixed(2);
}

function getYookassaAuthHeader() {
  if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) return null;
  const token = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString("base64");
  return `Basic ${token}`;
}

async function yookassaRequest(method, path, body, idempotenceKey) {
  const authHeader = getYookassaAuthHeader();
  if (!authHeader) {
    throw new Error("YOOKASSA_CONFIG_MISSING");
  }

  const headers = {
    Authorization: authHeader,
    "Content-Type": "application/json",
  };
  if (idempotenceKey) {
    headers["Idempotence-Key"] = idempotenceKey;
  }

  const res = await fetch(`https://api.yookassa.ru/v3${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(payload?.description || payload?.message || "YOOKASSA_REQUEST_FAILED");
    error.status = res.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function fetchYookassaPayment(providerPaymentId) {
  return yookassaRequest("GET", `/payments/${providerPaymentId}`);
}

function parseYookassaMetadata(metadata) {
  const userId = Number(metadata?.userId || 0);
  const planId = metadata?.planId ? String(metadata.planId) : null;
  const days = Number(metadata?.days || 0);
  const localPaymentId = Number(metadata?.localPaymentId || 0) || null;
  return {
    userId: Number.isFinite(userId) && userId > 0 ? userId : null,
    planId,
    days: Number.isFinite(days) && days > 0 ? days : null,
    localPaymentId,
  };
}

function validatePlanMetadata(plan, metadata) {
  if (!plan || !metadata.planId || !metadata.days) return false;
  return plan.id === metadata.planId && Number(plan.days) === Number(metadata.days);
}

async function getBillingUserIdForOrg(orgId, fallbackUserId = null) {
  if (!orgId) return fallbackUserId;
  const admin = await prisma.user.findFirst({
    where: {
      orgId,
      role: "ADMIN",
      isActive: true,
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return admin?.id || fallbackUserId;
}

async function getOrgSubscription(orgId, fallbackUserId = null) {
  if (orgId) {
    const byOrg = await prisma.subscription.findFirst({
      where: { user: { orgId } },
      orderBy: [{ paidUntil: "desc" }, { id: "desc" }],
    });
    if (byOrg) return byOrg;
  }
  if (!fallbackUserId) return null;
  return prisma.subscription.findFirst({ where: { userId: fallbackUserId } });
}

async function applyPaymentSuccess({ paymentRecord, providerPayment, plan }) {
  const userId = paymentRecord.userId;
  const now = new Date();
  const current = await prisma.subscription.findFirst({ where: { userId } });
  const baseDate = current?.paidUntil && new Date(current.paidUntil) > now
    ? new Date(current.paidUntil)
    : now;
  const nextPaidUntil = addDays(baseDate, plan.days);

  const existingMetadata = paymentRecord.metadata || {};
  const processedProviderPaymentIds = Array.isArray(existingMetadata.processedProviderPaymentIds)
    ? existingMetadata.processedProviderPaymentIds
    : [];
  const providerPaymentId = providerPayment?.id ? String(providerPayment.id) : null;
  const nextProcessedProviderPaymentIds = providerPaymentId
    ? Array.from(new Set([...processedProviderPaymentIds, providerPaymentId]))
    : processedProviderPaymentIds;

  await prisma.subscription.upsert({
    where: { userId },
    update: {
      plan: plan.id,
      status: "active",
      paidUntil: nextPaidUntil,
    },
    create: {
      userId,
      plan: plan.id,
      status: "active",
      paidUntil: nextPaidUntil,
    },
  });

  await prisma.payment.update({
    where: { id: paymentRecord.id },
    data: {
      status: "succeeded",
      metadata: {
        ...existingMetadata,
        providerStatus: providerPayment.status,
        providerPaid: providerPayment.paid,
        processedProviderPaymentIds: nextProcessedProviderPaymentIds,
      },
    },
  });

  return nextPaidUntil;
}

async function getUserPayload(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      name: true,
      role: true,
      permissionsJson: true,
      orgId: true,
      createdAt: true,
      organization: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
    },
  });

  if (!user) return null;
  const isSystemOwner = isOwnerEmail(user.email);
  const permissionConfig = normalizePermissionConfig(user.permissionsJson);
  const permissions = resolveUserPermissions({
    role: user.role,
    permissionsJson: user.permissionsJson,
    isSystemOwner,
  });

  const subscription = isSystemOwner
    ? null
    : await getOrgSubscription(user.orgId || null, userId);
  const now = new Date();
  const isActive =
    isSystemOwner ||
    (subscription &&
      ["active", "trialing"].includes(subscription.status) &&
      subscription.paidUntil &&
      new Date(subscription.paidUntil) > now);

  const { permissionsJson: _permissionsJson, ...userSafe } = user;

  return {
    ...userSafe,
    login: user.username || user.email,
    permissions,
    permissionTemplate: permissionConfig.template,
    permissionOverrides: {
      grants: permissionConfig.grants,
      revokes: permissionConfig.revokes,
    },
    isSystemOwner,
    roles: [user.role],
    subscription: isSystemOwner
      ? {
          plan: "platform-owner",
          status: "active",
          paidUntil: null,
          trialStartedAt: null,
          trialUsed: true,
          isActive: true,
        }
      : subscription
      ? {
          plan: subscription.plan,
          status: subscription.status,
          paidUntil: subscription.paidUntil,
          trialStartedAt: subscription.trialStartedAt,
          trialUsed: subscription.trialUsed,
          isActive: Boolean(isActive),
        }
      : { isActive: false, trialUsed: false },
  };
}

const WAREHOUSE_TSD_ANY = [
  PERMISSION_KEYS.TSD_RECEIVING,
  PERMISSION_KEYS.TSD_PUTAWAY,
  PERMISSION_KEYS.TSD_MOVE,
  PERMISSION_KEYS.TSD_COUNT,
  PERMISSION_KEYS.TSD_BIN,
  PERMISSION_KEYS.TSD_REPLENISH,
  PERMISSION_KEYS.TSD_PICK,
  PERMISSION_KEYS.TSD_DISCREPANCIES,
];

const WAREHOUSE_ROUTE_RULES = [
  { prefix: "/requests", key: PERMISSION_KEYS.WAREHOUSE_REQUESTS },
  { prefix: "/tasks", key: PERMISSION_KEYS.WAREHOUSE_TASKS },
  { prefix: "/locations", key: PERMISSION_KEYS.WAREHOUSE_LOCATIONS },
  { prefix: "/transactions", key: PERMISSION_KEYS.WAREHOUSE_TRANSACTIONS },
  { prefix: "/revisions", key: PERMISSION_KEYS.WAREHOUSE_REVISION },
  { prefix: "/discrepancies", key: PERMISSION_KEYS.TSD_DISCREPANCIES },
  { prefix: "/inventory/count", key: PERMISSION_KEYS.TSD_COUNT },
  { prefix: "/bin-audit", key: PERMISSION_KEYS.TSD_BIN },
  { prefix: "/receiving", key: PERMISSION_KEYS.TSD_RECEIVING },
  { prefix: "/putaway", key: PERMISSION_KEYS.TSD_PUTAWAY },
  { prefix: "/move", key: PERMISSION_KEYS.TSD_MOVE },
  { prefix: "/replen", key: PERMISSION_KEYS.TSD_REPLENISH },
  { prefix: "/pick", key: PERMISSION_KEYS.TSD_PICK },
  { prefix: "/scan/resolve", any: WAREHOUSE_TSD_ANY },
];

const denySectionAccess = (res) =>
  res.status(403).json({ message: "Нет доступа к разделу." });

function enforceOperationalTenantScope(req, res, next) {
  const store = requestContext.getStore();
  if (store && req.user?.isSystemOwner) {
    store.isSystemOwner = false;
  }
  if (!req.user?.orgId) {
    return res
      .status(403)
      .json({ message: "\u041e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u044f \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f \u043d\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0435\u043d\u0430." });
  }
  return next();
}

const isReadRequest = (req) =>
  req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";

app.use("/api/admin", auth, requirePermission(PERMISSION_KEYS.APP_ADMIN));
app.use("/api/users", auth, requirePermission(PERMISSION_KEYS.ADMIN_USERS));
app.use("/api/inventory", auth, enforceOperationalTenantScope, (req, res, next) => {
  if (hasPermission(req.user, PERMISSION_KEYS.WAREHOUSE_INVENTORY)) {
    return next();
  }

  // "Справочник ячеек" использует справочник товаров для привязки/печати QR.
  if (
    hasPermission(req.user, PERMISSION_KEYS.WAREHOUSE_LOCATIONS) &&
    isReadRequest(req) &&
    req.path.startsWith("/items")
  ) {
    return next();
  }

  return denySectionAccess(res);
});
app.use("/api/suppliers", auth, enforceOperationalTenantScope, (req, res, next) => {
  if (hasPermission(req.user, PERMISSION_KEYS.WAREHOUSE_SUPPLIERS)) {
    return next();
  }

  // "Очередь поставщиков" читает список поставщиков в регистрации авто.
  if (
    hasPermission(req.user, PERMISSION_KEYS.WAREHOUSE_QUEUE) &&
    isReadRequest(req) &&
    (req.path === "/" || req.path === "")
  ) {
    return next();
  }

  return denySectionAccess(res);
});
app.use("/api/purchase-orders", auth, enforceOperationalTenantScope, (req, res, next) => {
  if (hasPermission(req.user, PERMISSION_KEYS.WAREHOUSE_SUPPLIERS)) {
    return next();
  }

  // "??????? ???????????" ?????? ?????? ??????? ?????????? ??????????.
  if (
    hasPermission(req.user, PERMISSION_KEYS.WAREHOUSE_QUEUE) &&
    isReadRequest(req) &&
    (req.path === "/" || req.path === "")
  ) {
    return next();
  }

  // ???-???????: ?????? ? ?????? ???? ??????????? ?? ??????.
  if (
    hasAnyPermission(req.user, [
      PERMISSION_KEYS.TSD_RECEIVING,
      PERMISSION_KEYS.WAREHOUSE_TSD,
    ]) &&
    isReadRequest(req) &&
    req.path.endsWith("/print-receive-act") &&
    Number.isFinite(Number(String(req.path).split("/")[1]))
  ) {
    return next();
  }

  return denySectionAccess(res);
});
app.use("/api/supplier-trucks", auth, enforceOperationalTenantScope, requirePermission(PERMISSION_KEYS.WAREHOUSE_QUEUE));
app.use("/api/orders", auth, enforceOperationalTenantScope, requirePermission(PERMISSION_KEYS.WAREHOUSE_ORDERS));
app.use("/api/warehouse", (req, res, next) => {
  if (req.path.startsWith("/qr/render")) {
    return next();
  }
  return auth(req, res, () => {
    return enforceOperationalTenantScope(req, res, () => {
      if (!hasPermission(req.user, PERMISSION_KEYS.APP_WAREHOUSE)) {
        return denySectionAccess(res);
      }

      const match = WAREHOUSE_ROUTE_RULES.find((rule) =>
        req.path.startsWith(rule.prefix)
      );
      if (!match) {
        return next();
      }

      if (match.key && !hasPermission(req.user, match.key)) {
        if (
          match.key === PERMISSION_KEYS.WAREHOUSE_LOCATIONS &&
          isReadRequest(req) &&
          hasAnyPermission(req.user, WAREHOUSE_TSD_ANY)
        ) {
          return next();
        }
        return denySectionAccess(res);
      }
      if (match.any && !hasAnyPermission(req.user, match.any)) {
        return denySectionAccess(res);
      }
      return next();
    });
  });
});

app.use("/api/admin", adminRoutes({ prisma, auth, requireAdmin }));

function calcAccruedLeaveDays(hiredAt) {
  if (!hiredAt) return 0;
  const start = new Date(hiredAt);
  if (Number.isNaN(start.getTime())) return 0;

  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  // 28 дней в год ≈ 2.33 дня в месяц
  return Math.floor((diffDays / 365) * 28);
}

function daysBetweenInclusive(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  const diffMs = end.getTime() - start.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
  return days;
}

function formatDateRu(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ru-RU");
}

function formatDateBook(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "__.__.____";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `«${dd}» ${mm} ${yyyy} г.`;
}

function formatDateLong(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "«__» __________ ____";
  const dd = String(d.getDate()).padStart(2, "0");
  const monthNames = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ];
  const month = monthNames[d.getMonth()] || "";
  const yyyy = d.getFullYear();
  return `«${dd}» ${month} ${yyyy} года`;
}

function parseDateInput(value) {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;

  const ruMatch = String(value)
    .trim()
    .match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (ruMatch) {
    const [, dd, mm, yyyy] = ruMatch;
    const iso = `${yyyy}-${mm}-${dd}T00:00:00`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function buildLeaveDoc(employee, application) {
  const birth = employee.birthDate ? formatDateRu(employee.birthDate) : "___";
  const hired = employee.hiredAt ? formatDateRu(employee.hiredAt) : "___";
  const from = formatDateBook(application.startDate);
  const to = formatDateBook(application.endDate);
  const isUnpaid = application.type === "UNPAID";
  const isTermination = application.type === "TERMINATION";
  const fromLong = formatDateLong(application.startDate);
  const toLong = formatDateLong(application.endDate);
  const today = formatDateRu(new Date());

  const titleLine = "ЗАЯВЛЕНИЕ";

  const body = isTermination
    ? `Прошу уволить меня по собственному желанию ${fromLong}. Прошу произвести окончательный расчет, выдать трудовую книжку (или сведения о трудовой деятельности) и справки установленной формы в день увольнения.`
    : isUnpaid
      ? `В соответствии со статьей 128 Трудового кодекса РФ прошу предоставить мне отпуск без сохранения заработной платы с ${fromLong} по ${toLong} продолжительностью ${application.days} календарных дней.`
      : `В соответствии со статьей 115 Трудового кодекса РФ прошу предоставить мне ежегодный оплачиваемый отпуск с ${fromLong} по ${toLong} продолжительностью ${application.days} календарных дней.`;

  const reasonLine = application.reason
    ? `<div class="doc-reason">Основание / комментарий: ${application.reason}</div>`
    : "";

  const noteSpan = isUnpaid
    ? ""
    : isTermination
      ? ""
      : `<span class="doc-note">(подается за 14 календарных дней до первого дня отпуска)</span>`;

  return `
<div class="doc-header">
  <div>КОМУ: ________________________________________________</div>
  <div>_____________________________________________________</div>
  <div style="margin-top: 8px;">ОТ КОГО: ${employee.fullName}</div>
  <div>Должность: ${employee.position || ""}${employee.position ? ", " : ""}${employee.department || ""}</div>
</div>

<div class="doc-title">${titleLine}</div>

<div class="doc-body">${body}</div>
${reasonLine}

<div class="doc-meta">Дата приема: ${hired} &nbsp;&nbsp; Дата рождения: ${birth}</div>

<div class="doc-date">Дата заявления: «____» __________ 20____ года ${noteSpan}</div>
<div class="doc-sign">Подпись ________________</div>

<div class="doc-meta" style="margin-top: 8px;">Фактически: ${today}</div>
`.trim();
}


const DEFAULT_SAFETY_INSTRUCTIONS = [
  {
    title: "Вводный инструктаж для склада",
    description:
      "Общие требования по технике безопасности на складе, работа с тележками/погрузчиками, зоны и маршруты передвижения.",
    role: "WAREHOUSE",
  },
  {
    title: "Инструктаж для грузчиков",
    description:
      "Безопасное перемещение и штабелирование грузов, фиксация паллет, работа с стропами и захватами, отдых для спины.",
    role: "LOADER",
  },
  {
    title: "Повторный инструктаж по ОТ",
    description:
      "Напоминание про средства защиты, сигналы эвакуации, порядок действий при травмах и возгораниях.",
    role: "ALL",
  },
];

const SAFETY_PERIODICITY_DAYS = 180; // раз в полгода
const SAFETY_FIRST_DUE_DAYS = 3; // первичный контроль через 3 дня

function padNumber(value, size = 6) {
  return String(value).padStart(size, "0");
}

function buildProductCode(item) {
  return `PRD-${padNumber(item.id)}`;
}

function buildLocationCode(location) {
  const parts = [location.zone, location.aisle, location.rack, location.level]
    .map((v) => (v || "").trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return `LOC-${parts.join("-")}`;
  }
  return `LOC-${padNumber(location.id)}`;
}

async function ensureUniqueItemCodes({ barcode, qrCode }, itemId) {
  if (barcode) {
    const existing = await prisma.item.findFirst({
      where: { barcode, NOT: { id: itemId } },
    });
    if (existing) {
      throw new Error("Штрихкод уже используется другим товаром");
    }
  }
  if (qrCode) {
    const existing = await prisma.item.findFirst({
      where: { qrCode, NOT: { id: itemId } },
    });
    if (existing) {
      throw new Error("QR уже используется другим товаром");
    }
  }
}

async function ensureUniqueLocationCodes({ code, qrCode }, locationId) {
  if (code) {
    const existing = await prisma.warehouseLocation.findFirst({
      where: { code, NOT: { id: locationId } },
    });
    if (existing) {
      throw new Error("Код уже используется другой локацией");
    }
  }
  if (qrCode) {
    const existing = await prisma.warehouseLocation.findFirst({
      where: { qrCode, NOT: { id: locationId } },
    });
    if (existing) {
      throw new Error("QR уже используется другой локацией");
    }
  }
}

async function renderBarcodePng(value) {
  return bwipjs.toBuffer({
    bcid: "code128",
    text: value,
    scale: 3,
    height: 12,
    includetext: false,
  });
}

async function renderQrPng(value) {
  return QRCode.toBuffer(value, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 4,
  });
}

const SAFETY_RESOURCES = {
  instructions: [
    {
      title: "Инструкция ОТ: кладовщик (склад)",
      description: "Инструкция по охране труда для кладовщиков склада.",
      file: "/templates/Инструкция_ОТ_Кладовщик_Склад.docx",
    note: "",
    },
    {
      title: "Инструкция ОТ: грузчик (склад)",
      description: "Инструкция по охране труда для грузчиков склада.",
      file: "/templates/Инструкция_ОТ_Грузчик_Склад.docx",
    note: "",
    },
  ],
  journals: [
    {
      title: "Журнал регистрации вводного инструктажа",
      description: "Пустой журнал для фиксации вводного инструктажа (ФИО, дата, подписи).",
      file: "/templates/Журнал_Вводный_Инструктаж_ОТ.docx",
    note: "",
    },
    {
      title: "Журнал инструктажей на рабочем месте",
      description: "Учет первичных и повторных инструктажей на складе и в погрузочно-разгрузочной зоне.",
      file: "/templates/Журнал_Инструктаж_На_Рабочем_Месте_ОТ.docx",
    note: "",
    },
    {
      title: "Журнал регистрации целевых инструктажей",
      description: "Используется для целевых инструктажей при внеплановых работах и ПРР.",
      file: "/templates/Журнал_Целевой_Инструктаж_ОТ.docx",
    note: "",
    },
  ],
};

async function ensureSafetyInstructions() {
  const count = await prisma.safetyInstruction.count();
  if (count === 0) {
    for (const instr of DEFAULT_SAFETY_INSTRUCTIONS) {
      await prisma.safetyInstruction.create({ data: instr });
    }
  }
}

async function createSafetyAssignmentsForEmployee(employeeId) {
  const instructions = await prisma.safetyInstruction.findMany();

  for (const instr of instructions) {
    const due = addDays(new Date(), SAFETY_FIRST_DUE_DAYS); // первая дата контроля — через 3 дня
    await prisma.safetyAssignment.create({
      data: {
        employeeId,
        instructionId: instr.id,
        status: "PENDING",
        dueDate: due,
      },
    });
  }
}

// нормализуем dueDate у существующих инструктажей (после изменения периодичности)
async function normalizeSafetyAssignments() {
  const items = await prisma.safetyAssignment.findMany();
  for (const a of items) {
    let expectedDue = null;
    if (a.status === "DONE") {
      const base = a.completedAt || a.updatedAt || a.createdAt || new Date();
      expectedDue = addDays(base, SAFETY_PERIODICITY_DAYS);
    } else {
      const base = a.createdAt || new Date();
      expectedDue = addDays(base, SAFETY_FIRST_DUE_DAYS);
    }

    const current = a.dueDate ? new Date(a.dueDate) : null;
    const delta = current ? Math.abs(expectedDue - current) / (1000 * 60 * 60 * 24) : Infinity;

    if (delta > 1) {
      await prisma.safetyAssignment.update({
        where: { id: a.id },
        data: { dueDate: expectedDue },
      });
    }
  }
}

// ---------- ОХРАНА ТРУДА (инструкции) ----------
app.get("/api/safety/instructions", auth, requireHr, async (req, res) => {
  try {
    await ensureSafetyInstructions();
    const instructions = await prisma.safetyInstruction.findMany({
      orderBy: { id: "asc" },
    });

    // обогащаем полезными полями для фронта
    const mapped = instructions.map((i) => ({
      ...i,
      category: i.role || "ALL",
      periodicityDays: SAFETY_PERIODICITY_DAYS,
    }));

    res.json(mapped);
  } catch (err) {
    console.error("safety instructions error:", err);
    res.status(500).json({ message: "Failed to load safety instructions" });
  }
});

app.get("/api/safety/assignments", auth, requireHr, async (req, res) => {
  try {
    await normalizeSafetyAssignments();
    const items = await prisma.safetyAssignment.findMany({
      orderBy: { id: "desc" },
      include: { employee: true, instruction: true },
    });

    const mapped = items.map((a) => ({
      ...a,
      nextDue: a.dueDate,
    }));

    res.json(mapped);
  } catch (err) {
    console.error("safety assignments error:", err);
    res.status(500).json({ message: "Failed to load safety assignments" });
  }
});

app.get("/api/safety/resources", auth, requireHr, async (req, res) => {
  try {
    res.json(SAFETY_RESOURCES);
  } catch (err) {
    console.error("safety resources error:", err);
    res.status(500).json({ message: "Failed to load safety resources" });
  }
});

app.put(
  "/api/safety/assignments/:id/complete",
  auth,
  requireHr,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid assignment id" });
      }

      // тянем инструктаж, чтобы понять периодичность
      const assignment = await prisma.safetyAssignment.findUnique({
        where: { id },
        include: { instruction: true },
      });

      if (!assignment) {
        return res.status(404).json({ message: "Assignment not found" });
      }

      const periodicityDays = SAFETY_PERIODICITY_DAYS;
      const nextDue = addDays(new Date(), periodicityDays);

      const updated = await prisma.safetyAssignment.update({
        where: { id },
        data: {
          status: "DONE",
          completedAt: new Date(),
          dueDate: nextDue,
          lastReminderAt: null,
        },
      });

      res.json({
        id: updated.id,
        completedAt: updated.completedAt,
        status: updated.status,
        nextDue: updated.dueDate,
      });
    } catch (err) {
      console.error("complete assignment error:", err);
      if (err?.code === "P2025") {
        return res.status(404).json({ message: "Assignment not found" });
      }
      res.status(500).json({ message: "Failed to update assignment" });
    }
  }
);


app.post("/api/safety/assignments/:id/remind", auth, requireHr, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Invalid assignment id" });
    }

    const assignment = await prisma.safetyAssignment.findUnique({
      where: { id },
      include: { employee: true, instruction: true },
    });

    if (!assignment) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    if (!assignment.employee?.telegramChatId) {
      return res.status(400).json({ message: "? ?????????? ?? ?????? Telegram ID" });
    }
    if (!assignment.dueDate) {
      return res.status(400).json({ message: "?? ?????? ???? ???????????" });
    }

    await sendSafetyReminderForAssignment(assignment, true);
    return res.json({ message: "??????????? ??????????" });
  } catch (err) {
    console.error("manual remind error:", err);
    return res.status(500).json({ message: "Failed to send reminder" });
  }
});

function isWarehouseManager(user) {
  // кто имеет права управлять складом / закупками
  return (
    user?.role === "ADMIN" ||
    hasPermission(user, PERMISSION_KEYS.WAREHOUSE_MANAGE)
  );
}

function canUseReceivingByPo(user) {
  return (
    isWarehouseManager(user) ||
    hasAnyPermission(user, [
      PERMISSION_KEYS.TSD_RECEIVING,
      PERMISSION_KEYS.WAREHOUSE_TSD,
      PERMISSION_KEYS.WAREHOUSE_SUPPLIERS,
      PERMISSION_KEYS.WAREHOUSE_QUEUE,
    ])
  );
}

function normalizeComparableText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeLocationLookupToken(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9А-ЯЁ]/g, "");
}

function normalizeSkuToken(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9А-ЯЁ]/g, "");
}

function normalizeBarcodeToken(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeOrderNumber(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/№/g, "")
    .replace(/[\s\-_/\\.,]+/g, "");
}

function isSameOrderNumber(left, right) {
  const a = normalizeOrderNumber(left);
  const b = normalizeOrderNumber(right);
  return Boolean(a) && Boolean(b) && a === b;
}

async function findActiveTruckForOrder(orderNumber, statuses = ["IN_QUEUE", "UNLOADING"]) {
  if (!orderNumber) return null;
  const trucks = await prisma.supplierTruck.findMany({
    where: {
      status: { in: statuses },
      orderNumber: { not: null },
    },
    orderBy: [{ arrivalAt: "asc" }, { id: "asc" }],
  });
  const match = trucks.find((truck) => isSameOrderNumber(truck.orderNumber, orderNumber));
  return match || null;
}

async function findStockItemForOrderLine(db, raw = {}) {
  const itemId = raw.itemId ? Number(raw.itemId) : null;
  if (itemId && !Number.isNaN(itemId)) {
    const byId = await db.item.findUnique({ where: { id: itemId } });
    if (byId?.category === "STOCK") return byId;
  }

  const skuSource = raw.sku ?? raw.requestedSku ?? null;
  const sku = skuSource ? String(skuSource).trim() : "";
  if (sku) {
    const bySku = await db.item.findFirst({
      where: { sku, category: "STOCK" },
    });
    if (bySku) return bySku;

    const normalizedSku = normalizeSkuToken(sku);
    if (normalizedSku) {
      const skuCandidates = await db.item.findMany({
        where: {
          category: "STOCK",
          sku: { not: null },
        },
        take: 500,
      });
      const byNormalizedSku = skuCandidates.find(
        (item) => normalizeSkuToken(item.sku) === normalizedSku
      );
      if (byNormalizedSku) return byNormalizedSku;
    }
  }

  const barcodeSource = raw.barcode ?? raw.requestedBarcode ?? null;
  const barcode = barcodeSource ? String(barcodeSource).trim() : "";
  if (barcode) {
    const byBarcode = await db.item.findFirst({
      where: { barcode, category: "STOCK" },
    });
    if (byBarcode) return byBarcode;

    const normalizedBarcode = normalizeBarcodeToken(barcode);
    if (normalizedBarcode) {
      const barcodeCandidates = await db.item.findMany({
        where: {
          category: "STOCK",
          barcode: { not: null },
        },
        take: 500,
      });
      const byNormalizedBarcode = barcodeCandidates.find(
        (item) => normalizeBarcodeToken(item.barcode) === normalizedBarcode
      );
      if (byNormalizedBarcode) return byNormalizedBarcode;
    }
  }

  const nameSource = raw.name ?? raw.requestedName ?? null;
  const name = nameSource ? String(nameSource).trim() : "";
  if (name) {
    const byName = await db.item.findFirst({
      where: { name, category: "STOCK" },
    });
    if (byName) return byName;

    const normalizedName = normalizeComparableText(name);
    if (normalizedName) {
      const candidates = await db.item.findMany({
        where: {
          category: "STOCK",
          name: { contains: name.slice(0, 16) },
        },
        take: 60,
      });
      const byNormalized = candidates.find(
        (item) => normalizeComparableText(item.name) === normalizedName
      );
      if (byNormalized) return byNormalized;

      const broadCandidates = await db.item.findMany({
        where: { category: "STOCK" },
        take: 500,
      });
      const byBroadNormalized = broadCandidates.find(
        (item) => normalizeComparableText(item.name) === normalizedName
      );
      if (byBroadNormalized) return byBroadNormalized;
    }
  }

  return null;
}

async function getOrCreateReceivingLocation() {
  const code = "RECEIVING";
  const findByCode = () =>
    runWithoutTenantScope(() =>
      prismaBase.warehouseLocation.findFirst({
        where: { code },
      })
    );

  let location = await findByCode();
  if (!location) {
    try {
      location = await runWithoutTenantScope(() =>
        prismaBase.warehouseLocation.create({
          data: {
            code,
            name: "\u0417\u043e\u043d\u0430 \u043f\u0440\u0438\u0435\u043c\u043a\u0438",
          },
        })
      );
    } catch (err) {
      if (err?.code !== "P2002") throw err;
      location = await findByCode();
    }
  }
  if (!location) {
    const e = new Error("RECEIVING_LOCATION_CREATE_FAILED");
    e.code = "RECEIVING_LOCATION_CREATE_FAILED";
    throw e;
  }
  return location;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getItemLocationBalances(itemId) {
  const movements = await prisma.stockMovement.findMany({
    where: { itemId },
    orderBy: { createdAt: "asc" },
  });

  const byLocation = new Map();
  for (const movement of movements) {
    if (!movement.locationId) continue;
    const locationId = movement.locationId;
    const current = byLocation.get(locationId) || {
      locationId,
      location: movement.location || null,
      qty: 0,
    };
    if (movement.type === "INCOME" || movement.type === "ADJUSTMENT") {
      current.qty += Number(movement.quantity) || 0;
    } else if (movement.type === "ISSUE") {
      current.qty -= Number(movement.quantity) || 0;
    }
    byLocation.set(locationId, current);
  }

  const locationIds = Array.from(byLocation.keys());
  const locations = locationIds.length
    ? await prisma.warehouseLocation.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, name: true, code: true, zone: true, aisle: true, rack: true, level: true },
      })
    : [];
  const locationById = new Map(locations.map((location) => [location.id, location]));

  for (const row of byLocation.values()) {
    if (!row.location) {
      row.location = locationById.get(row.locationId) || null;
    }
  }

  return Array.from(byLocation.values())
    .filter((row) => row.qty > 0)
    .sort((a, b) => {
      const codeA = String(a.location?.code || a.location?.name || "");
      const codeB = String(b.location?.code || b.location?.name || "");
      return codeA.localeCompare(codeB, "ru");
    });
}

async function getReceivingLineLocationBalances(itemId) {
  const lines = await prisma.warehouseReceivingLine.findMany({
    where: {
      itemId,
      locationId: { not: null },
      remainingQty: { gt: 0 },
      status: { in: ["PLACED", "PENDING"] },
    },
    include: {
      location: {
        select: { id: true, name: true, code: true, zone: true, aisle: true, rack: true, level: true },
      },
    },
    orderBy: [{ locationId: "asc" }, { createdAt: "asc" }],
  });

  const byLocation = new Map();
  for (const line of lines) {
    if (!line.locationId) continue;
    const locationId = line.locationId;
    const current = byLocation.get(locationId) || {
      locationId,
      location: line.location || null,
      qty: 0,
    };
    current.qty += Number(line.remainingQty) || 0;
    byLocation.set(locationId, current);
  }

  return Array.from(byLocation.values())
    .filter((row) => row.qty > 0)
    .sort((a, b) => {
      const codeA = String(a.location?.code || a.location?.name || "");
      const codeB = String(b.location?.code || b.location?.name || "");
      return codeA.localeCompare(codeB, "ru");
    });
}

async function getPlacementLocationBalances(itemId) {
  const rows = await prisma.warehousePlacement.findMany({
    where: {
      itemId,
      qty: { gt: 0 },
    },
    include: {
      location: {
        select: { id: true, name: true, code: true, zone: true, aisle: true, rack: true, level: true },
      },
    },
    orderBy: [{ locationId: "asc" }, { id: "asc" }],
  });

  return rows
    .map((row) => ({
      locationId: row.locationId,
      location: row.location || null,
      qty: Number(row.qty) || 0,
    }))
    .filter((row) => row.locationId && row.qty > 0)
    .sort((a, b) => {
      const codeA = String(a.location?.code || a.location?.name || "");
      const codeB = String(b.location?.code || b.location?.name || "");
      return codeA.localeCompare(codeB, "ru");
    });
}

function mergeLocationBalances(movementBalances = [], receivingBalances = []) {
  const merged = new Map();

  const apply = (row) => {
    if (!row?.locationId) return;
    const current = merged.get(row.locationId) || {
      locationId: row.locationId,
      location: row.location || null,
      qty: 0,
    };
    current.location = current.location || row.location || null;
    current.qty = Math.max(Number(current.qty) || 0, Number(row.qty) || 0);
    merged.set(row.locationId, current);
  };

  movementBalances.forEach(apply);
  receivingBalances.forEach(apply);

  return Array.from(merged.values()).sort((a, b) => {
    const codeA = String(a.location?.code || a.location?.name || "");
    const codeB = String(b.location?.code || b.location?.name || "");
    return codeA.localeCompare(codeB, "ru");
  });
}

async function buildOrderPickPlan(orderId) {
  const order = await prisma.salesOrder.findUnique({
    where: { id: orderId },
    include: {
      lines: {
        include: { item: true },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!order) return null;

  const plan = [];
  for (const line of order.lines) {
    const totalQty = Number(line.qty) || 0;
    const pickedQty = Number(line.pickedQty) || 0;
    const remaining = Math.max(0, totalQty - pickedQty);
    if (remaining <= 0) continue;

    let resolvedItemId = line.itemId || null;
    let resolvedItem = line.item || null;
    if (!resolvedItemId) {
      const linkedItem = await findStockItemForOrderLine(prisma, {
        sku: line.requestedSku,
        name: line.requestedName,
      });
      if (linkedItem) {
        resolvedItemId = linkedItem.id;
        resolvedItem = linkedItem;
        await prisma.salesOrderLine.update({
          where: { id: line.id },
          data: { itemId: linkedItem.id },
        });
      }
    }

    if (!resolvedItemId) {
      plan.push({
        lineId: line.id,
        itemId: null,
        itemName: line.requestedName || "??????????? ?????",
        sku: line.requestedSku || null,
        totalQty,
        pickedQty,
        remainingQty: remaining,
        steps: [],
        shortageQty: remaining,
      });
      continue;
    }

    const movementBalances = await getItemLocationBalances(resolvedItemId);
    const receivingBalances = await getReceivingLineLocationBalances(resolvedItemId);
    const placementBalances = await getPlacementLocationBalances(resolvedItemId);
    const balances = mergeLocationBalances(
      mergeLocationBalances(movementBalances, receivingBalances),
      placementBalances
    );
    let need = remaining;
    const steps = [];

    for (const balance of balances) {
      if (need <= 0) break;
      const pickQty = Math.min(need, Math.floor(balance.qty));
      if (pickQty <= 0) continue;
      steps.push({
        locationId: balance.locationId,
        locationCode: balance.location?.code || null,
        locationName: balance.location?.name || null,
        qty: pickQty,
      });
      need -= pickQty;
    }

    plan.push({
      lineId: line.id,
      itemId: resolvedItemId,
      itemName: resolvedItem?.name || line.requestedName || `????? #${resolvedItemId}`,
      sku: resolvedItem?.sku || line.requestedSku || null,
      barcode: resolvedItem?.barcode || null,
      totalQty,
      pickedQty,
      remainingQty: remaining,
      steps,
      shortageQty: Math.max(0, need),
    });
  }

  return plan;
}

function buildOrderLabelHtml(order) {
  const createdAt = order?.createdAt
    ? new Date(order.createdAt).toLocaleString("ru-RU")
    : "";
  const linesHtml = (order?.lines || [])
    .map((line, idx) => {
      const name = line.item?.name || line.requestedName || `????? #${line.itemId || "?"}`;
      const sku = line.item?.sku || line.requestedSku || "";
      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(sku)}</td>
          <td>${Number(line.qty) || 0}</td>
        </tr>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>???????? ?????? ${escapeHtml(order.orderNumber)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 16px; color: #111; }
    .label { border: 1px solid #111; border-radius: 8px; padding: 14px; max-width: 860px; }
    h1 { font-size: 22px; margin: 0 0 8px 0; }
    .meta { margin: 6px 0; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #c7c7c7; padding: 6px; font-size: 13px; text-align: left; }
    .barcode { margin-top: 12px; font-family: monospace; font-size: 18px; font-weight: 700; }
    @media print { body { margin: 0; } .label { border: none; } }
  </style>
</head>
<body>
  <div class="label">
    <h1>????? ${escapeHtml(order.orderNumber)}</h1>
    <div class="meta"><b>??????????:</b> ${escapeHtml(order.customerName)}</div>
    <div class="meta"><b>???????:</b> ${escapeHtml(order.customerPhone || "")}</div>
    <div class="meta"><b>?????:</b> ${escapeHtml(order.shippingAddress)}</div>
    <div class="meta"><b>???????????:</b> ${escapeHtml(order.deliveryComment || "")}</div>
    <div class="meta"><b>???????:</b> ${escapeHtml(order.boxCode || "-")} (${escapeHtml(order.boxType || "-")})</div>
    <div class="meta"><b>??????:</b> ${escapeHtml(createdAt)}</div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>?????</th>
          <th>SKU</th>
          <th>???-??</th>
        </tr>
      </thead>
      <tbody>
        ${linesHtml}
      </tbody>
    </table>
    <div class="barcode">ORDER: ${escapeHtml(order.orderNumber)}</div>
  </div>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;
}


function buildReceiveActHtml(order, rows, orgInfo) {
  const safeOrg = {
    name: orgInfo?.orgName || orgInfo?.name || "\u041e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u044f",
    legalAddress: orgInfo?.legalAddress || "",
    actualAddress: orgInfo?.actualAddress || "",
    inn: orgInfo?.inn || "",
    kpp: orgInfo?.kpp || "",
    phone: orgInfo?.phone || "",
  };

  const isOrgProfileMissing = Boolean(orgInfo?.__profileMissing);

  const actDate = new Date();
  const actDateStr = actDate.toLocaleDateString("ru-RU");
  const orderDateStr = order?.date
    ? new Date(order.date).toLocaleDateString("ru-RU")
    : "";
  const safeOrderNumberForFile = String(order?.number || "PO")
    .replace(/[^0-9A-Za-z_-]+/g, "_")
    .slice(0, 64);

  let totalOrdered = 0;
  let totalReceived = 0;
  let totalDiff = 0;

  const rowsHtml = rows
    .map((row, idx) => {
      const ordered = Number(row.orderedQty) || 0;
      const received = Number(row.receivedQty) || 0;
      const diff = Math.max(0, ordered - received);

      totalOrdered += ordered;
      totalReceived += received;
      totalDiff += diff;

      return `
        <tr>
          <td style="text-align:center;">${idx + 1}</td>
          <td>${row.name || ""}</td>
          <td style="text-align:center;">${ordered}</td>
          <td style="text-align:center;">${received}</td>
          <td style="text-align:center;">${diff}</td>
          <td></td>
        </tr>
      `;
    })
    .join("");

  const phoneRow = safeOrg.phone
    ? `<tr><td>\u0422\u0435\u043b.: ${safeOrg.phone}</td></tr>`
    : "";
  const profileNotice = isOrgProfileMissing
    ? `<div class="small" style="margin-top:6px;color:#b91c1c;">&#1056;&#1077;&#1082;&#1074;&#1080;&#1079;&#1080;&#1090;&#1099; &#1086;&#1088;&#1075;&#1072;&#1085;&#1080;&#1079;&#1072;&#1094;&#1080;&#1080; &#1085;&#1077; &#1079;&#1072;&#1087;&#1086;&#1083;&#1085;&#1077;&#1085;&#1099;. &#1042;&#1083;&#1072;&#1076;&#1077;&#1083;&#1077;&#1094; &#1082;&#1083;&#1080;&#1077;&#1085;&#1090;&#1072; &#1076;&#1086;&#1083;&#1078;&#1077;&#1085; &#1079;&#1072;&#1087;&#1086;&#1083;&#1085;&#1080;&#1090;&#1100; &#1080;&#1093; &#1074; &#1088;&#1072;&#1079;&#1076;&#1077;&#1083;&#1077; &laquo;&#1053;&#1072;&#1089;&#1090;&#1088;&#1086;&#1081;&#1082;&#1080; &rarr; &#1056;&#1077;&#1082;&#1074;&#1080;&#1079;&#1080;&#1090;&#1099; &#1086;&#1088;&#1075;&#1072;&#1085;&#1080;&#1079;&#1072;&#1094;&#1080;&#1080;&raquo;.</div>`
    : "";

  return `
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>АКТ ВОЗВРАТА ТОВАРА № ${order?.number || ""} от ${actDateStr}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 20px;
      font-family: "Times New Roman", serif;
      font-size: 12px;
      color: #000;
    }
    .a4 {
      width: 190mm;
      margin: 0 auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    .no-border td {
      border: none;
      padding: 0;
    }
    .act-table th, .act-table td {
      border: 1px solid #000;
      padding: 3px 4px;
    }
    .title {
      text-align: center;
      font-size: 14px;
      font-weight: 600;
      margin: 14px 0 8px;
      text-transform: uppercase;
    }
    .small {
      font-size: 11px;
    }
    .signs {
      margin-top: 32px;
      display: flex;
      justify-content: space-between;
      gap: 24px;
    }
    .sign {
      flex: 1;
    }
    .sign .line {
      border-bottom: 1px solid #000;
      margin: 18px 0 4px;
    }
    .print-btn {
      margin-top: 24px;
      padding: 6px 16px;
      font-size: 13px;
    }
    @media print {
      .print-btn { display: none; }
      body { margin: 0; }
      .a4 { width: auto; margin: 0; }
    }
  </style>
</head>
<body>
  <div class="a4">
    <table class="no-border">
      <tr><td>${safeOrg.name}</td></tr>
      <tr><td>Юридический адрес: ${safeOrg.legalAddress}</td></tr>
      <tr><td>Фактический адрес: ${safeOrg.actualAddress}</td></tr>
      <tr><td>\u0418\u041d\u041d ${safeOrg.inn}&nbsp;&nbsp;&nbsp;&nbsp;\u041a\u041f\u041f ${safeOrg.kpp}</td></tr>
      ${phoneRow}
      ${profileNotice}
    </table>

    <div class="title">
      АКТ ВОЗВРАТА ТОВАРА № ${order?.number || ""} от ${actDateStr}
    </div>

    <div class="small" style="margin-bottom:4px;">
      Поставщик: ${order?.supplier?.name || ""}
    </div>
    <div class="small" style="margin-bottom:8px;">
      Документ: заказ поставщику № ${order?.number || ""} от ${orderDateStr}
    </div>

    <div class="small" style="margin-bottom:6px;">
      При оценке качества поставленного товара зафиксированы следующие недостатки:
    </div>

    <table class="act-table">
      <tr>
        <th style="width:30px;">№ п/п</th>
        <th>Наименование товара</th>
        <th style="width:140px;">Количество, шт. (по накладной)</th>
        <th style="width:120px;">Количество, шт. (фактически)</th>
        <th style="width:150px;">Количество товара с недостатками, шт.</th>
        <th style="width:140px;">Заключение, примечание</th>
      </tr>
      ${rowsHtml}
      <tr>
        <td colspan="2" style="text-align:right;font-weight:bold;">Итого:</td>
        <td style="text-align:center;font-weight:bold;">${totalOrdered}</td>
        <td style="text-align:center;font-weight:bold;">${totalReceived}</td>
        <td style="text-align:center;font-weight:bold;">${totalDiff}</td>
        <td></td>
      </tr>
    </table>

    <div class="small" style="margin-top:16px;">
      Причины недостачи товара могут быть выявлены после вскрытия тары и пересчета товара.
    </div>

    <div class="signs">
      <div class="sign">
        <div>Получатель</div>
        <div class="line"></div>
        <div class="small">должность / подпись / Ф.И.О.</div>
        <div class="small" style="margin-top:6px;">М.П.</div>
      </div>
      <div class="sign">
        <div>Представитель поставщика (экспедитор)</div>
        <div class="line"></div>
        <div class="small">должность / подпись / Ф.И.О.</div>
      </div>
    </div>

    <div style="margin-top:24px; display:flex; gap:8px; flex-wrap:wrap;">
      <button class="print-btn" onclick="window.print()">&#1055;&#1077;&#1095;&#1072;&#1090;&#1100;</button>
      <button class="print-btn" onclick="handleShareAct()">&#1055;&#1086;&#1076;&#1077;&#1083;&#1080;&#1090;&#1100;&#1089;&#1103;</button>
      <button class="print-btn" onclick="if (window.history.length > 1) { window.history.back(); } else { window.location.href = \"/warehouse/tsd\"; }">&#1042;&#1077;&#1088;&#1085;&#1091;&#1090;&#1100;&#1089;&#1103; &#1074; &#1087;&#1088;&#1080;&#1083;&#1086;&#1078;&#1077;&#1085;&#1080;&#1077;</button>
    </div>
  </div>
<script>
  async function handleShareAct() {
    if (!navigator.share) {
      alert("\u0424\u0443\u043d\u043a\u0446\u0438\u044f \"\u041f\u043e\u0434\u0435\u043b\u0438\u0442\u044c\u0441\u044f\" \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u0442\u043e\u043b\u044c\u043a\u043e \u043d\u0430 \u043c\u043e\u0431\u0438\u043b\u044c\u043d\u044b\u0445 \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u0430\u0445.");
      return;
    }
    try {
      const html = document.documentElement.outerHTML;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const fileName = "act_${safeOrderNumberForFile}.html";
      const file = new File([blob], fileName, {
        type: "text/html;charset=utf-8",
      });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: document.title || "\u0410\u043a\u0442 \u0440\u0430\u0441\u0445\u043e\u0436\u0434\u0435\u043d\u0438\u0439",
          text: "\u0410\u043a\u0442 \u0440\u0430\u0441\u0445\u043e\u0436\u0434\u0435\u043d\u0438\u0439 \u043f\u043e \u043f\u0440\u0438\u0451\u043c\u043a\u0435",
          files: [file],
        });
        return;
      }
      await navigator.share({
        title: document.title || "\u0410\u043a\u0442 \u0440\u0430\u0441\u0445\u043e\u0436\u0434\u0435\u043d\u0438\u0439",
        text: "\u0410\u043a\u0442 \u0440\u0430\u0441\u0445\u043e\u0436\u0434\u0435\u043d\u0438\u0439 \u043f\u043e \u043f\u0440\u0438\u0451\u043c\u043a\u0435",
      });
    } catch (err) {
      if (err && err.name === "AbortError") return;
      console.error(err);
      alert("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u043c\u0435\u043d\u044e \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438 \u043d\u0430 \u044d\u0442\u043e\u043c \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u0435.");
    }
  }
</script>
</body>
</html>
  `;
}

// ================== TELEGRAM БОТ (ТЕСТОВЫЙ) ==================

const TELEGRAM_BOT_TOKEN =
  "8254839296:AAGnAvL09dFoMyHzIyRqi2FZ11G6tJgDee4";
const TELEGRAM_GROUP_CHAT_ID = "-4974442288";
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// универсальная отправка сообщения
async function sendTelegramMessage(chatId, text, extra = {}) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !chatId) {
      console.log("[Telegram] TOKEN или chatId не указан, отправка пропущена");
      return;
    }

    const url = `${TELEGRAM_API}/sendMessage`;

    const body = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...extra,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.text();
      console.error("[Telegram] Ошибка отправки:", data);
    }
  } catch (err) {
    console.error("[Telegram] Ошибка:", err);
  }
}

// Удобная обёртка: отправить сообщение именно в складской групповой чат
function sendWarehouseGroupMessage(text, extra = {}) {
  return sendTelegramMessage(TELEGRAM_GROUP_CHAT_ID, text, extra);
}

async function sendSafetyReminderForAssignment(a, force = false) {
  if (!a?.employee?.telegramChatId || !a.dueDate) return false;
  const now = new Date();
  const due = new Date(a.dueDate);
  const diffDays = Math.floor((due - now) / (1000 * 60 * 60 * 24));
  if (!force && diffDays > 3) return false;

  if (!force && a.lastReminderAt) {
    const last = new Date(a.lastReminderAt);
    const hoursSince = (now - last) / (1000 * 60 * 60);
    if (hoursSince < 20) return false;
  }

  const title = a.instruction?.title || "??????????";
  const dueStr = due.toLocaleDateString("ru-RU");
  const lines = [
    "??????????? ?? ???????????",
    "",
    `??????????: ${title}`,
    `?????????: ${a.employee.fullName}`,
    `????: ${dueStr}`,
    diffDays >= 0
      ? `???????? ????: ${diffDays + 1}`
      : `?????????? ?? ${Math.abs(diffDays)} ??.`,
  ];

  const textMsg = lines.join("\n");
  await sendTelegramMessage(a.employee.telegramChatId, textMsg);
  await prisma.safetyAssignment.update({
    where: { id: a.id },
    data: { lastReminderAt: now },
  });
  return true;
}

async function sendSafetyReminders() {
  try {
    const now = new Date();
    const items = await prisma.safetyAssignment.findMany({
      where: { status: "PENDING", dueDate: { not: null } },
      include: { employee: true, instruction: true },
    });

    for (const a of items) {
      await sendSafetyReminderForAssignment(a);
    }
  } catch (err) {
    console.error("[Safety reminders] error:", err);
  }
}

// старт фоновых задач переносим после проверки готовности БД

// обработка callback_query (кнопка "✅ Выполнено")
async function isTmcIssueRequest(request) {
  if (!request || request.type !== "ISSUE") return false;
  const items = request.items || [];
  if (!items.length) return false;

  for (const it of items) {
    if (it.itemId) {
      const item = await prisma.item.findUnique({ where: { id: it.itemId } });
      if (item?.category === "TMC") return true;
      continue;
    }
    if (it.name) {
      const item = await prisma.item.findFirst({
        where: { name: it.name, category: "TMC" },
      });
      if (item) return true;
    }
  }

  return false;
}

function extractRequestIdFromTitle(title) {
  if (!title) return null;
  const match = String(title).match(/\u0417\u0430\u044f\u0432\u043a\u0430 \u0441\u043a\u043b\u0430\u0434\u0430 #(\d+)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

async function handleTelegramUpdate(update) {
  if (!update.callback_query) return;

  const { id: callbackId, data, from } = update.callback_query;

  if (!data) return;

  // admin approval for TMC issue
  if (data.startsWith("approve_issue:") || data.startsWith("reject_issue:")) {
    const reqId = Number(data.split(":")[1]);
    if (!reqId) return;

    try {
      const request = await prisma.warehouseRequest.findUnique({
        where: { id: reqId },
        include: { items: true },
      });

      if (!request) {
        await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: callbackId,
            text: "\u0417\u0430\u044f\u0432\u043a\u0430 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430.",
            show_alert: true,
          }),
        });
        return;
      }

      if (data.startsWith("reject_issue:")) {
        await prisma.warehouseRequest.update({
          where: { id: reqId },
          data: {
            status: "REJECTED",
            statusComment: "\u041e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u043e \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u043e\u043c",
          },
        });
        await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: callbackId,
            text: "\u041e\u0442\u043a\u043b\u043e\u043d\u0435\u043d\u043e. \u0421\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043d\u0435 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043e.",
            show_alert: false,
          }),
        });
        return;
      }

      await autoPostRequestToStock(reqId, request.createdById);
      await prisma.warehouseRequest.update({
        where: { id: reqId },
        data: {
          status: "DONE",
          statusComment: "\u0421\u043f\u0438\u0441\u0430\u043d\u043e \u043f\u043e \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044e \u0430\u0434\u043c\u0438\u043d\u0430",
        },
      });

      await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackId,
          text: "\u0421\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u043e. \u041e\u0441\u0442\u0430\u0442\u043a\u0438 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u044b.",
          show_alert: false,
        }),
      });
      return;
    } catch (err) {
      console.error("[Telegram] approve_issue error:", err);
      await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackId,
          text: "\u041e\u0448\u0438\u0431\u043a\u0430. \u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u0430\u0442\u044c \u0437\u0430\u043f\u0440\u043e\u0441.",
          show_alert: true,
        }),
      });
      return;
    }
  }

  const isIssueDone = data.startsWith("issue_done:");
  const isDone = data.startsWith("done:");
  if (!isIssueDone && !isDone) {
    return;
  }

  const taskId = parseInt(data.split(":")[1], 10);
  if (!taskId) return;

  try {
    const task = await prisma.warehouseTask.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackId,
          text: "\u0417\u0430\u0434\u0430\u0447\u0430 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430 \u0438\u043b\u0438 \u0443\u0434\u0430\u043b\u0435\u043d\u0430.",
          show_alert: false,
        }),
      });
      return;
    }

    if (
      task.executorChatId &&
      String(task.executorChatId) !== String(from.id)
    ) {
      await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackId,
          text: "\u042d\u0442\u0430 \u0437\u0430\u0434\u0430\u0447\u0430 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0430 \u0434\u0440\u0443\u0433\u043e\u043c\u0443 \u0438\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044e.",
          show_alert: true,
        }),
      });
      return;
    }

    await prisma.warehouseTask.update({
      where: { id: taskId },
      data: {
        status: "DONE",
        lastReminderAt: null,
      },
    });

    try {
      const requestId = extractRequestIdFromTitle(task.title);
      if (requestId) {
        const request = await prisma.warehouseRequest.findUnique({
          where: { id: requestId },
          include: { items: true },
        });

        if (isIssueDone && (await isTmcIssueRequest(request))) {
          const lines = [];
          lines.push("\u{1F9FE} \u0417\u0430\u043f\u0440\u043e\u0441 \u043d\u0430 \u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0422\u041c\u0426");
          lines.push(`\u0417\u0430\u044f\u0432\u043a\u0430 #${requestId}`);
          if (request?.items?.length) {
            lines.push("");
            lines.push("\u041f\u043e\u0437\u0438\u0446\u0438\u0438:");
            for (const it of request.items) {
              lines.push(`- ${it.name} \u2014 ${it.quantity} ${it.unit || ""}`.trim());
            }
          }
          const approvalText = lines.join("\n");

          await sendWarehouseGroupMessage(approvalText, {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "\u0421\u043f\u0438\u0441\u0430\u0442\u044c",
                    callback_data: `approve_issue:${requestId}`,
                  },
                  {
                    text: "\u041e\u0442\u043a\u043b\u043e\u043d\u0438\u0442\u044c",
                    callback_data: `reject_issue:${requestId}`,
                  },
                ],
              ],
            },
          });
        } else {
          await autoPostRequestToStock(requestId, task.assignerId);
        }
      }
    } catch (e) {
      console.error("[Telegram] autoPostRequestFromTask error:", e);
    }

    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackId,
        text: isIssueDone
          ? "\u041e\u0442\u043c\u0435\u0447\u0435\u043d\u043e \u00ab\u0412\u044b\u0434\u0430\u043d\u043e\u00bb. \u041e\u0436\u0438\u0434\u0430\u0435\u0442 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u044f \u0430\u0434\u043c\u0438\u043d\u0430."
          : "\u0417\u0430\u0434\u0430\u0447\u0430 \u043e\u0442\u043c\u0435\u0447\u0435\u043d\u0430 \u043a\u0430\u043a \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043d\u0430\u044f.",
        show_alert: false,
      }),
    });

    await sendTelegramMessage(
      from.id,
      `\u0417\u0430\u0434\u0430\u0447\u0430 <b>${task.title}</b> \u043e\u0442\u043c\u0435\u0447\u0435\u043d\u0430 \u043a\u0430\u043a \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043d\u0430\u044f.`
    );

    await sendWarehouseGroupMessage(
      `\u0417\u0430\u0434\u0430\u0447\u0430 <b>${task.title}</b> \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0430 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u043c ${from.first_name || from.username || from.id}.`
    );

    console.log(
      `[Telegram] \u0437\u0430\u0434\u0430\u0447\u0430 ${taskId} \u043e\u0442\u043c\u0435\u0447\u0435\u043d\u0430 \u043a\u0430\u043a \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043d\u0430\u044f \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u043c ${from.id}`
    );
  } catch (err) {
    console.error("[handleTelegramUpdate] error:", err);
  }
}

let telegramOffset = 0;




async function startTelegramPolling() {
  console.log("▶️ Запуск long polling Telegram...");

  while (true) {
    try {
      const url = `${TELEGRAM_API}/getUpdates?timeout=25&offset=${telegramOffset}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!data.ok) {
        console.error("[startTelegramPolling] Ответ Telegram с ошибкой:", data);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      if (Array.isArray(data.result) && data.result.length > 0) {
        for (const update of data.result) {
          telegramOffset = update.update_id + 1;
          await handleTelegramUpdate(update);
        }
      }
    } catch (err) {
      console.error("[startTelegramPolling] Ошибка:", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ================== НАПОМИНАНИЯ ПО ЗАДАЧАМ СКЛАДА ==================


function buildWarehouseTaskTelegramText({ task, dueStr, kind, isExecutor }) {
  const title = task?.title || "";
  const executor = task?.executorName || "";
  const lines = [];

  if (kind === "due_soon") {
    lines.push("\u26A0\uFE0F \u0421\u043A\u043E\u0440\u043E \u0438\u0441\u0442\u0435\u043A\u0430\u0435\u0442 \u0441\u0440\u043E\u043A" + (isExecutor ? " \u0432\u0430\u0448\u0435\u0439 \u0437\u0430\u0434\u0430\u0447\u0438" : " \u043F\u043E \u0437\u0430\u0434\u0430\u0447\u0435"));
  } else {
    lines.push("\u23F0 \u041F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u0430 \u0437\u0430\u0434\u0430\u0447\u0430" + (isExecutor ? "" : ""));
  }

  lines.push("");
  lines.push(`\u0417\u0430\u0434\u0430\u0447\u0430: ${title}`);
  if (!isExecutor && executor) {
    lines.push(`\u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C: ${executor}`);
  }
  lines.push(`\u0421\u0440\u043E\u043A: ${dueStr}`);

  return lines.join("\n");
}

function buildWarehouseTaskCreatedTelegramText(task) {
  const title = task?.title || "";
  const author = task?.assigner?.name || task?.assigner?.email || task?.assignerName || "";
  const details = task?.description || "";
  const due = task?.dueDate ? new Date(task.dueDate) : null;
  const dueStr = due && !Number.isNaN(due.getTime())
    ? due.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

  const lines = [];
  lines.push("\u{1F44B} \u041d\u043e\u0432\u0430\u044f \u0437\u0430\u0434\u0430\u0447\u0430 \u0441\u043a\u043b\u0430\u0434\u0430");
  lines.push("");
  lines.push(`\u{1F4DD} \u0417\u0430\u0434\u0430\u0447\u0430: ${title}`);
  if (details) {
    lines.push(`\u{1F4C4} \u0414\u0435\u0442\u0430\u043b\u0438: ${details}`);
  }
  if (dueStr) {
    lines.push(`\u23F0 \u0421\u0440\u043e\u043a: ${dueStr}`);
  }
  if (author) {
    lines.push("");
    lines.push(`\u{1F464} \u041d\u0430\u0437\u043d\u0430\u0447\u0438\u043b: ${author}`);
  }
  return lines.join("\n");
}
function buildWarehouseTaskAssignedTelegramText(task, { forExecutor }) {
  const title = task?.title || "";
  const details = task?.description || "";
  const due = task?.dueDate ? new Date(task.dueDate) : null;
  const dueStr = due && !Number.isNaN(due.getTime())
    ? due.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  const assigner = task?.assigner?.name || task?.assigner?.email || "";

  const lines = [];
  lines.push(forExecutor
    ? "\u{1F44B} \u0412\u0430\u043c \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0430 \u0437\u0430\u0434\u0430\u0447\u0430 \u0441\u043a\u043b\u0430\u0434\u0430"
    : "\u{1F44B} \u041d\u0430\u0437\u043d\u0430\u0447\u0435\u043d\u0430 \u0437\u0430\u0434\u0430\u0447\u0430 \u0441\u043a\u043b\u0430\u0434\u0430"
  );
  lines.push("");
  lines.push(`\u{1F4DD} \u0417\u0430\u0434\u0430\u0447\u0430: ${title}`);
  if (details) {
    lines.push(`\u{1F4C4} \u0414\u0435\u0442\u0430\u043b\u0438: ${details}`);
  }
  if (dueStr) {
    lines.push(`\u23F0 \u0421\u0440\u043e\u043a: ${dueStr}`);
  }
  if (assigner) {
    lines.push("");
    lines.push(`\u{1F464} \u041d\u0430\u0437\u043d\u0430\u0447\u0438\u043b: ${assigner}`);
  }
  return lines.join("\n");
}



async function checkWarehouseTaskNotifications() {
  try {
    const now = new Date();

    const tasks = await prisma.warehouseTask.findMany({
      where: {
        dueDate: { not: null },
        status: { in: ["NEW", "IN_PROGRESS"] },
      },
    });

    for (const task of tasks) {
      const due = new Date(task.dueDate);
      if (Number.isNaN(due.getTime())) continue;

      const diffMs = due.getTime() - now.getTime();
      const diffMinutes = diffMs / (1000 * 60);

      const last = task.lastReminderAt
        ? new Date(task.lastReminderAt)
        : null;
      const minutesSinceLast = last
        ? (now.getTime() - last.getTime()) / (1000 * 60)
        : Infinity;

      // 1) За 5 минут до срока — одно напоминание
      if (diffMinutes <= 5 && diffMinutes > 0 && !task.lastReminderAt) {
        const dueStr = due.toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        const baseText = buildWarehouseTaskTelegramText({ task, dueStr, kind: "due_soon", isExecutor: false });

        await sendWarehouseGroupMessage(baseText);

        if (task.executorChatId) {
          const execText = buildWarehouseTaskTelegramText({ task, dueStr, kind: "due_soon", isExecutor: true });
          await sendTelegramMessage(task.executorChatId, execText);
        }

        await prisma.warehouseTask.update({
          where: { id: task.id },
          data: { lastReminderAt: now },
        });

        continue;
      }

      // 2) Срок уже прошёл — напоминание раз в час
      if (diffMinutes < 0 && minutesSinceLast >= 60) {
        const dueStr = due.toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        const baseText = buildWarehouseTaskTelegramText({ task, dueStr, kind: "overdue", isExecutor: false });

        await sendWarehouseGroupMessage(baseText);

        if (task.executorChatId) {
          const execText = buildWarehouseTaskTelegramText({ task, dueStr, kind: "overdue", isExecutor: true });
          await sendTelegramMessage(task.executorChatId, execText);
        }

        await prisma.warehouseTask.update({
          where: { id: task.id },
          data: { lastReminderAt: now },
        });
      }
    }
  } catch (err) {
    console.error("[checkWarehouseTaskNotifications] Ошибка:", err);
  }
}

// ================== АВТОПРОВЕРКА ОСТАТКОВ (НОВАЯ ЧАСТЬ) ==================

// 1. Получить товары, где текущий остаток < minStock
async function getLowStockItems() {
  const items = await prisma.item.findMany({
    where: {
      minStock: { not: null },
      category: "STOCK",
    },
    orderBy: { name: "asc" },
    include: {
      movements: true,
    },
  });

  const result = [];

  for (const item of items) {
    let qty = 0;

    for (const m of item.movements) {
      if (!m.locationId) continue;
      if (m.type === "INCOME" || m.type === "ADJUSTMENT") {
        qty += Number(m.quantity);
      } else if (m.type === "ISSUE") {
        qty -= Number(m.quantity);
      }
    }

    const currentStock = Math.round(qty);

    if (currentStock < item.minStock) {
      result.push({
        id: item.id,
        name: item.name,
        unit: item.unit,
        minStock: item.minStock,
        currentStock,
      });
    }
  }

  return result;
}

// 2. Отправить один общий отчёт в складской чат
async function sendDailyLowStockSummary() {
  try {
    const lowItems = await getLowStockItems();
    const now = new Date();
    const dateStr = now.toLocaleDateString("ru-RU");

    if (lowItems.length === 0) {
      await sendWarehouseGroupMessage(
        `✅ На конец дня (${dateStr}) товаров ниже минимального остатка нет.`
      );
      return;
    }

    let text = `📦 Список товаров для дозаказа на ${dateStr}:\n\n`;

    for (const it of lowItems) {
      text += `• ${it.name} — сейчас ${it.currentStock} ${it.unit || ""
        }, минимум ${it.minStock}\n`;
    }

    await sendWarehouseGroupMessage(text);
  } catch (err) {
    console.error("[sendDailyLowStockSummary] Ошибка:", err);
  }
}

// ================== АУТЕНТИФИКАЦИЯ ==================

// регистрация
app.post("/api/register", async (req, res) => {

  if (process.env.DISABLE_PUBLIC_REGISTER !== "false") {
    return res.status(403).json({
      message: "\u041f\u0443\u0431\u043b\u0438\u0447\u043d\u0430\u044f \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f \u043e\u0442\u043a\u043b\u044e\u0447\u0435\u043d\u0430. \u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u0442\u043e\u043b\u044c\u043a\u043e \u043f\u043e \u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044e \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430."
    });
  }


  try {
    const { email, password, name } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = String(name || "").trim();

    if (!normalizedEmail || !password || !normalizedName) {
      return res
        .status(400)
        .json({ message: "email, пароль и имя обязательны" });
    }

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      return res
        .status(400)
        .json({ message: "Пользователь с таким email уже существует" });
    }

    const hash = await bcrypt.hash(password, 10);
    const org = await prisma.organization.create({
      data: {
        name: normalizedName || normalizedEmail,
        code: makeTenantCode(normalizedName || normalizedEmail),
        isActive: true,
      },
    });

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hash,
        passwordHash: hash,
        passwordVisible: String(password),
        name: normalizedName,
        role: "EMPLOYEE",
        orgId: org.id,
      },
    });

    const token = createToken(user);

      const userPayload = await getUserPayload(user.id);

      res.status(201).json({
        message: "??????????? ?????????",
        token,
        user: userPayload || {
          id: user.id,
          email: user.email,
          username: user.username || null,
          login: user.username || user.email,
          name: user.name,
          role: user.role,
          permissions: resolveUserPermissions({ role: user.role, permissionsJson: null }),
          permissionTemplate: "ROLE_DEFAULT",
          permissionOverrides: { grants: [], revokes: [] },
          roles: [user.role],
          subscription: { isActive: false },
        },
      });
  } catch (err) {
    console.error("register error:", err);
    res.status(500).json({ message: "Ошибка сервера при регистрации" });
  }
});

// логин
app.post("/api/login", async (req, res) => {
  try {
    const { login, email, password } = req.body || {};
    const normalizedLogin = normalizeLogin(login || email);

    if (!normalizedLogin || !password) {
      return res
        .status(400)
        .json({ message: "Логин и пароль обязательны" });
    }

    if (normalizedLogin === OWNER_PRIMARY_EMAIL) {
      await ensureOwnerAdminAccount();
    }

    let user = null;

    if (!normalizedLogin.includes("@")) {
      user = await prisma.user.findUnique({
        where: { username: normalizedLogin },
      });
    }

    if (!user) {
      const normalizedEmail = normalizeEmail(normalizedLogin);
      user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (!user) {
        const legacyRows = await prisma.$queryRaw`
          SELECT "id" FROM "User"
          WHERE LOWER(TRIM("email")) = LOWER(${normalizedEmail})
          LIMIT 1
        `;
        const legacyId = Number(legacyRows?.[0]?.id || 0);
        if (legacyId) {
          user = await prisma.user.findUnique({ where: { id: legacyId } });
          if (user && user.email !== normalizedEmail) {
            await prisma.user.update({
              where: { id: user.id },
              data: { email: normalizedEmail },
            });
            user.email = normalizedEmail;
          }
        }
      }
    }
    if (!user) {
      console.warn(`[LOGIN_FAIL] user not found: ${normalizedLogin}`);
      return res
        .status(401)
        .json({ message: "Неверный логин или пароль" });
    }

    if (!user.orgId) {
      const orgId = await ensureUserOrg(user.id, user.name || user.email);
      user.orgId = orgId || null;
    }

    if (user.isActive === false) {
      console.warn(`[LOGIN_FAIL] inactive user: ${normalizedLogin}`);
      return res.status(403).json({ message: "USER_INACTIVE" });
    }

    const storedHash = String(user.passwordHash || user.password || "");
    let ok = false;
    if (storedHash.startsWith("$2")) {
      ok = await bcrypt.compare(password, storedHash);
    } else if (storedHash) {
      ok = password === storedHash;
      if (ok) {
        const nextHash = await bcrypt.hash(password, 10);
        await prisma.user.update({
          where: { id: user.id },
          data: { password: nextHash, passwordHash: nextHash, passwordVisible: String(password) },
        });
      }
    }
    if (!ok) {
      console.warn(`[LOGIN_FAIL] wrong password: ${normalizedLogin}`);
      return res
        .status(401)
        .json({ message: "Неверный логин или пароль" });
    }

    const token = createToken(user);

      const userPayload = await getUserPayload(user.id);

      res.json({
        message: "???? ????????",
        token,
        user: userPayload || {
          id: user.id,
          email: user.email,
          username: user.username || null,
          login: user.username || user.email,
          name: user.name,
          role: user.role,
          permissions: resolveUserPermissions({ role: user.role, permissionsJson: null }),
          permissionTemplate: "ROLE_DEFAULT",
          permissionOverrides: { grants: [], revokes: [] },
          roles: [user.role],
          subscription: { isActive: false },
        },
      });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ message: "Ошибка сервера при входе" });
  }
});

// профиль текущего пользователя
app.get("/api/profile", auth, async (req, res) => {
    try {
      const userPayload = await getUserPayload(req.user.id);
      if (!userPayload) {
        return res.status(404).json({ message: "???????????? ?? ??????" });
      }
      res.json(userPayload);
    } catch (err) {
      console.error("profile error:", err);
      res.status(500).json({ message: "?? ??????? ????????? ??????? ????????????" });
    }
  });

  app.get("/api/me", auth, async (req, res) => {
    try {
      const userPayload = await getUserPayload(req.user.id);
      if (!userPayload) {
        return res.status(404).json({ message: "USER_NOT_FOUND" });
      }
      res.json(userPayload);
    } catch (err) {
      console.error("me error:", err);
      res.status(500).json({ message: "ME_LOAD_ERROR" });
    }
  });



  app.get("/api/billing/config", (req, res) => {
    const enabled = Boolean(YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY);
    return res.json({ yookassaEnabled: enabled });
  });

  app.post("/api/billing/start-trial", auth, async (req, res) => {
    try {
      if (!req.user?.isSystemOwner && req.user?.role !== "ADMIN") {
        return res.status(403).json({
          message: "Оплату может запускать только администратор клиента.",
        });
      }

      const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 30);
      if (!Number.isFinite(TRIAL_DAYS) || TRIAL_DAYS <= 0) {
        return res.status(500).json({ message: "TRIAL_CONFIG_INVALID" });
      }

      const targetOrgId = req.user.isSystemOwner ? null : req.user.orgId;
      if (!req.user.isSystemOwner && !targetOrgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const billingUserId = req.user.isSystemOwner
        ? req.user.id
        : await getBillingUserIdForOrg(targetOrgId, req.user.id);
      if (!billingUserId) {
        return res.status(400).json({ message: "BILLING_USER_REQUIRED" });
      }

      const existing = req.user.isSystemOwner
        ? await prisma.subscription.findFirst({
            where: { userId: billingUserId },
          })
        : await prisma.subscription.findFirst({
            where: { user: { orgId: targetOrgId } },
            orderBy: [{ paidUntil: "desc" }, { id: "desc" }],
          });
      if (existing?.trialUsed || existing?.trialStartedAt) {
        return res.status(400).json({ message: "TRIAL_ALREADY_USED" });
      }

      const now = new Date();
      const paidUntil = addDays(now, TRIAL_DAYS);

      await prisma.subscription.upsert({
        where: { userId: billingUserId },
        update: {
          plan: "trial-30",
          status: "trialing",
          paidUntil,
          trialStartedAt: now,
          trialUsed: true,
        },
        create: {
          userId: billingUserId,
          plan: "trial-30",
          status: "trialing",
          paidUntil,
          trialStartedAt: now,
          trialUsed: true,
        },
      });

      const userPayload = await getUserPayload(req.user.id);
      return res.json({ subscription: userPayload?.subscription || null });
    } catch (err) {
      console.error("start trial error:", err);
      return res.status(500).json({ message: "TRIAL_START_ERROR" });
    }
  });
  app.post("/api/billing/yookassa/create-payment", auth, async (req, res) => {
    try {
      if (!req.user?.isSystemOwner && req.user?.role !== "ADMIN") {
        return res.status(403).json({
          message: "Оплату может запускать только администратор клиента.",
        });
      }
      const targetOrgId = req.user.isSystemOwner ? null : req.user.orgId;
      if (!req.user.isSystemOwner && !targetOrgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }
      const billingUserId = req.user.isSystemOwner
        ? req.user.id
        : await getBillingUserIdForOrg(targetOrgId, req.user.id);
      if (!billingUserId) {
        return res.status(400).json({ message: "BILLING_USER_REQUIRED" });
      }

      const { planId, paymentMethod } = req.body || {};
      const plan = getPlan(planId);
      if (!plan) {
        return res.status(400).json({ message: "PLAN_NOT_FOUND" });
      }
      if (paymentMethod && paymentMethod !== "sbp" && paymentMethod !== "default") {
        return res.status(400).json({ message: "PAYMENT_METHOD_INVALID" });
      }
      const resolvedPaymentMethod = paymentMethod === "default" ? "default" : "sbp";

      const tempProviderId = `pending_${crypto.randomUUID()}`;
      const localPayment = await prisma.payment.create({
        data: {
          userId: billingUserId,
          provider: "yookassa",
          providerPaymentId: tempProviderId,
          amount: plan.amount,
          currency: plan.currency,
          status: "pending",
          metadata: {
            planId: plan.id,
            days: plan.days,
            paymentMethod: resolvedPaymentMethod,
          },
        },
      });

      const payload = {
        amount: {
          value: formatAmount(plan.amount),
          currency: plan.currency,
        },
        capture: true,
        confirmation: {
          type: "redirect",
          return_url: `${APP_URL}/subscribe/return?paymentId=${localPayment.id}`,
        },
        description: `Subscription ${plan.id}`,
        metadata: {
          userId: String(billingUserId),
          planId: plan.id,
          days: String(plan.days),
          localPaymentId: String(localPayment.id),
        },
      };

      if (resolvedPaymentMethod === "sbp") {
        payload.payment_method_data = { type: "sbp" };
      }

      const payment = await yookassaRequest(
        "POST",
        "/payments",
        payload,
        crypto.randomUUID()
      );

      await prisma.payment.update({
        where: { id: localPayment.id },
        data: {
          providerPaymentId: payment.id,
          status: payment.status || "pending",
          metadata: {
            ...(localPayment.metadata || {}),
            providerStatus: payment.status,
          },
        },
      });

      return res.json({
        confirmationUrl: payment.confirmation?.confirmation_url || null,
        paymentId: payment.id,
        localPaymentId: localPayment.id,
      });
    } catch (err) {
      console.error("create payment error:", err);
      return res.status(500).json({ message: "PAYMENT_CREATE_ERROR" });
    }
  });

  app.get("/api/billing/yookassa/payment-status", auth, async (req, res) => {
    try {
      if (!req.user?.isSystemOwner && req.user?.role !== "ADMIN") {
        return res.status(403).json({
          message: "Оплату может проверять только администратор клиента.",
        });
      }
      const paymentId = String(req.query.paymentId || "").trim();
      if (!paymentId) {
        return res.status(400).json({ message: "PAYMENT_ID_REQUIRED" });
      }

      let paymentRecord = null;
      if (/^\d+$/.test(paymentId)) {
        paymentRecord = await prisma.payment.findUnique({
          where: { id: Number(paymentId) },
          include: { user: { select: { orgId: true } } },
        });
      }
      if (!paymentRecord) {
        paymentRecord = await prisma.payment.findFirst({
          where: { providerPaymentId: paymentId },
          include: { user: { select: { orgId: true } } },
        });
      }
      if (!paymentRecord) {
        return res.status(404).json({ message: "PAYMENT_NOT_FOUND" });
      }
      if (
        !req.user.isSystemOwner &&
        (!req.user.orgId || paymentRecord.user?.orgId !== req.user.orgId)
      ) {
        return res.status(403).json({ message: "PAYMENT_FORBIDDEN" });
      }

      const providerPayment = await fetchYookassaPayment(paymentRecord.providerPaymentId);
      const metadata = parseYookassaMetadata(providerPayment.metadata || {});
      const plan = getPlan(metadata.planId || paymentRecord.metadata?.planId);
      if (!plan) {
        return res.status(400).json({ message: "PLAN_NOT_FOUND" });
      }

      if (providerPayment.status === "succeeded" && providerPayment.paid) {
        if (paymentRecord.status !== "succeeded") {
          await applyPaymentSuccess({ paymentRecord, providerPayment, plan });
        }
      } else if (providerPayment.status === "canceled") {
        await prisma.payment.update({
          where: { id: paymentRecord.id },
          data: { status: "canceled" },
        });
      } else {
        await prisma.payment.update({
          where: { id: paymentRecord.id },
          data: { status: providerPayment.status || "pending" },
        });
      }

      return res.json({
        status: providerPayment.status,
        paid: providerPayment.paid || false,
      });
    } catch (err) {
      console.error("payment status error:", err);
      return res.status(500).json({ message: "PAYMENT_STATUS_ERROR" });
    }
  });

  app.post("/api/billing/yookassa/webhook", async (req, res) => {
    try {
      const providerPaymentId =
        req.body?.object?.id || req.body?.payment?.id || req.body?.id;
      if (!providerPaymentId) {
        return res.status(400).json({ message: "PAYMENT_ID_REQUIRED" });
      }

      const providerPayment = await fetchYookassaPayment(providerPaymentId);
      const metadata = parseYookassaMetadata(providerPayment.metadata || {});
      const plan = getPlan(metadata.planId);
      if (!plan) {
        return res.status(400).json({ message: "PLAN_NOT_FOUND" });
      }
      if (!validatePlanMetadata(plan, metadata) || !metadata.userId) {
        return res.status(400).json({ message: "PAYMENT_METADATA_MISMATCH" });
      }

      const expectedAmount = formatAmount(plan.amount);
      if (providerPayment.amount?.currency !== plan.currency || providerPayment.amount?.value !== expectedAmount) {
        return res.status(400).json({ message: "PAYMENT_AMOUNT_MISMATCH" });
      }

      let paymentRecord = null;
      if (metadata.localPaymentId) {
        paymentRecord = await prisma.payment.findUnique({
          where: { id: metadata.localPaymentId },
        });
      }
      if (!paymentRecord) {
        paymentRecord = await prisma.payment.findFirst({
          where: { providerPaymentId },
        });
      }

      if (!paymentRecord) {
        paymentRecord = await prisma.payment.create({
          data: {
            userId: metadata.userId,
            provider: "yookassa",
            providerPaymentId,
            amount: Number(providerPayment.amount?.value || plan.amount),
            currency: providerPayment.amount?.currency || plan.currency,
            status: providerPayment.status || "pending",
            metadata: {
              planId: plan.id,
              days: plan.days,
              providerStatus: providerPayment.status,
              providerPaid: providerPayment.paid,
            },
          },
        });
      }

      if (paymentRecord.userId !== metadata.userId) {
        return res.status(400).json({ message: "PAYMENT_USER_MISMATCH" });
      }

      const processedProviderPaymentIds = Array.isArray(paymentRecord.metadata?.processedProviderPaymentIds)
        ? paymentRecord.metadata.processedProviderPaymentIds
        : [];
      if (processedProviderPaymentIds.includes(String(providerPaymentId))) {
        return res.json({ ok: true });
      }

      if (paymentRecord.status === "succeeded") {
        return res.json({ ok: true });
      }

      if (providerPayment.status === "succeeded" && providerPayment.paid) {
        await applyPaymentSuccess({ paymentRecord, providerPayment, plan });
      } else if (providerPayment.status === "canceled") {
        await prisma.payment.update({
          where: { id: paymentRecord.id },
          data: { status: "canceled" },
        });
      } else {
        await prisma.payment.update({
          where: { id: paymentRecord.id },
          data: { status: providerPayment.status || "pending" },
        });
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error("yookassa webhook error:", err);
      return res.status(500).json({ message: "WEBHOOK_ERROR" });
    }
  });
 
// ===== ORG PROFILE SETTINGS =====
app.get("/api/settings/org-profile", auth, async (req, res) => {
  try {
    if (req.user?.role != "ADMIN") {
      return res.status(403).json({ message: "NO_ACCESS" });
    }
    if (!hasPermission(req.user, PERMISSION_KEYS.APP_WAREHOUSE)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }
    const targetOrgId = req.user.isSystemOwner
      ? Number(req.query.orgId || req.user.orgId || 0)
      : req.user.orgId;
    if (!targetOrgId || Number.isNaN(targetOrgId)) {
      return res.status(400).json({ message: "ORG_REQUIRED" });
    }
    const profile = await prisma.orgProfile.findFirst({
      where: { orgId: targetOrgId },
    });
    res.json({ profile: profile || null });
  } catch (err) {
    console.error("org profile get error:", err);
    res.status(500).json({ message: "ORG_PROFILE_GET_ERROR" });
  }
});

app.put("/api/settings/org-profile", auth, async (req, res) => {
  try {
    if (req.user?.role != "ADMIN") {
      return res.status(403).json({ message: "NO_ACCESS" });
    }
    if (!hasPermission(req.user, PERMISSION_KEYS.APP_WAREHOUSE)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }
    const {
      orgName,
      legalAddress,
      actualAddress,
      inn,
      kpp,
      phone,
    } = req.body || {};

    if (!orgName || !legalAddress || !actualAddress || !inn || !kpp) {
      return res.status(400).json({ message: "BAD_ORG_PROFILE" });
    }

    const targetOrgId = req.user.isSystemOwner
      ? Number(req.body?.orgId || req.user.orgId || 0)
      : req.user.orgId;
    if (!targetOrgId || Number.isNaN(targetOrgId)) {
      return res.status(400).json({ message: "ORG_REQUIRED" });
    }
    const existing = await prisma.orgProfile.findFirst({
      where: { orgId: targetOrgId },
      select: { id: true },
    });

    const payload = {
      orgId: targetOrgId,
      orgName,
      legalAddress,
      actualAddress,
      inn,
      kpp,
      phone: phone || "",
    };

    const profile = existing
      ? await prisma.orgProfile.update({
          where: { id: existing.id },
          data: payload,
        })
      : await prisma.orgProfile.create({
          data: payload,
        });

    res.json({ profile });
  } catch (err) {
    console.error("org profile put error:", err);
    res.status(500).json({ message: "ORG_PROFILE_SAVE_ERROR" });
  }
});

// DEV: сделать текущего пользователя админом по email
app.post("/api/dev/make-me-admin", auth, async (req, res) => {
  try {
    if (!isOwnerEmail(req.user.email)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { role: "ADMIN" },
      select: { id: true, email: true, name: true, role: true },
    });

    res.json({ message: "Теперь вы ADMIN", user });
  } catch (err) {
    console.error("make-me-admin error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при назначении администратора" });
  }
});

// ================== АДМИНКА ПОЛЬЗОВАТЕЛЕЙ ==================

function toManagedUserPayload(user) {
  const isSystemOwner = isOwnerEmail(user.email);
  const config = normalizePermissionConfig(user.permissionsJson);
  const permissions = resolveUserPermissions({
    role: user.role,
    permissionsJson: user.permissionsJson,
    isSystemOwner,
  });
  return {
    id: user.id,
    email: user.email,
    username: user.username || null,
    login: user.username || user.email,
    name: user.name,
    passwordVisible: user.passwordVisible || null,
    role: user.role,
    orgId: user.orgId ?? null,
    organization: user.organization || null,
    createdAt: user.createdAt || null,
    isSystemOwner,
    permissions,
    permissionTemplate: config.template,
    permissionOverrides: {
      grants: config.grants,
      revokes: config.revokes,
    },
  };
}

app.get("/api/users", auth, requireAdmin, async (req, res) => {
  try {
    if (!req.user.isSystemOwner && !req.user.orgId) {
      return res
        .status(403)
        .json({ message: "Организация пользователя не настроена" });
    }

    const users = await prisma.user.findMany({
      where: req.user.isSystemOwner
        ? { isActive: true }
        : { orgId: req.user.orgId, isActive: true },
      orderBy: { id: "asc" },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        passwordVisible: true,
        role: true,
        permissionsJson: true,
        orgId: true,
        organization: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        createdAt: true,
      },
    });

    res.json(users.map((item) => toManagedUserPayload(item)));
  } catch (err) {
    console.error("users list error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при загрузке пользователей" });
  }
});

app.post("/api/users", auth, requireAdmin, async (req, res) => {
  try {
    if (!req.user.isSystemOwner && !req.user.orgId) {
      return res
        .status(403)
        .json({ message: "Организация пользователя не настроена" });
    }

    const {
      name,
      login,
      password,
      role,
      orgId,
      template,
      grants,
      revokes,
    } = req.body || {};

    const normalizedName = String(name || "").trim();
    const normalizedLogin = normalizeLogin(login);
    const normalizedPassword = String(password || "");
    const nextRole = normalizePortalRole(role, "");

    if (!isValidUsername(normalizedLogin)) {
      return res.status(400).json({
        message:
          "Логин должен быть 3-32 символа: буквы, цифры, точка, дефис или подчёркивание.",
      });
    }
    if (normalizedPassword.length < 8) {
      return res
        .status(400)
        .json({ message: "Пароль должен быть не короче 8 символов." });
    }
    if (!PORTAL_ALLOWED_ROLES.includes(nextRole)) {
      return res.status(400).json({ message: "Недопустимая роль" });
    }

    const targetOrgId = req.user.isSystemOwner
      ? Number(orgId || req.user.orgId || 0)
      : req.user.orgId;
    if (!targetOrgId || Number.isNaN(targetOrgId)) {
      return res.status(400).json({ message: "ORG_REQUIRED" });
    }

    const targetOrg = await prisma.organization.findUnique({
      where: { id: targetOrgId },
      select: { id: true },
    });
    if (!targetOrg) {
      return res.status(404).json({ message: "ORG_NOT_FOUND" });
    }

    const existingByUsername = await prisma.user.findUnique({
      where: { username: normalizedLogin },
      select: { id: true },
    });
    if (existingByUsername) {
      return res.status(400).json({ message: "USERNAME_ALREADY_EXISTS" });
    }

    const technicalEmail = buildTechnicalEmailByUsername(normalizedLogin);
    const existingByEmail = await prisma.user.findUnique({
      where: { email: technicalEmail },
      select: { id: true },
    });
    if (existingByEmail) {
      return res.status(400).json({ message: "USERNAME_ALREADY_EXISTS" });
    }

    const normalizedConfig = normalizePermissionConfig({
      template,
      grants,
      revokes,
    });

    const hash = await bcrypt.hash(normalizedPassword, 10);
    const created = await prisma.user.create({
      data: {
        email: technicalEmail,
        username: normalizedLogin,
        password: hash,
        passwordHash: hash,
        passwordVisible: normalizedPassword,
        name: normalizedName || normalizedLogin,
        role: nextRole,
        isActive: true,
        emailVerifiedAt: new Date(),
        orgId: targetOrgId,
        permissionsJson: stringifyPermissionConfig(normalizedConfig),
      },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        passwordVisible: true,
        role: true,
        permissionsJson: true,
        orgId: true,
        organization: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        createdAt: true,
      },
    });

    res.status(201).json({
      ok: true,
      user: {
        ...toManagedUserPayload(created),
        initialPassword: normalizedPassword,
      },
    });
  } catch (err) {
    if (String(err?.code || "") === "P2002") {
      return res.status(400).json({ message: "USERNAME_ALREADY_EXISTS" });
    }
    console.error("create user error:", err);
    res.status(500).json({ message: "Ошибка сервера при создании пользователя" });
  }
});

app.get("/api/users/permissions/catalog", auth, requireAdmin, async (req, res) => {
  try {
    res.json(getPermissionCatalog({ isSystemOwner: req.user?.isSystemOwner === true }));
  } catch (err) {
    console.error("permissions catalog error:", err);
    res.status(500).json({ message: "Ошибка загрузки каталога прав." });
  }
});

function parseDateTimeQuery(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

app.get("/api/admin/reports/picking", auth, requireAdmin, async (req, res) => {
  try {
    if (
      !hasAnyPermission(req.user, [
        PERMISSION_KEYS.ADMIN_WAREHOUSE,
        PERMISSION_KEYS.ADMIN_USERS,
      ])
    ) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }

    const to = parseDateTimeQuery(req.query.to) || new Date();
    const from =
      parseDateTimeQuery(req.query.from) ||
      new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

    if (from.getTime() > to.getTime()) {
      return res.status(400).json({ message: "BAD_RANGE" });
    }

    const userIdRaw = req.query.userId;
    let filterUserId = null;
    if (userIdRaw !== undefined && userIdRaw !== null && userIdRaw !== "") {
      const parsedUserId = Number(userIdRaw);
      if (!parsedUserId || Number.isNaN(parsedUserId)) {
        return res.status(400).json({ message: "BAD_USER_ID" });
      }
      filterUserId = parsedUserId;
    }

    const where = {
      status: { in: ["PICKED", "PACKED", "READY_TO_SHIP", "SHIPPED"] },
      assignedToUserId: filterUserId || { not: null },
      OR: [
        { pickedAt: { gte: from, lte: to } },
        {
          AND: [{ pickedAt: null }, { completedAt: { gte: from, lte: to } }],
        },
      ],
    };

    const orders = await prisma.salesOrder.findMany({
      where,
      include: {
        assignedToUser: {
          select: { id: true, name: true, username: true, email: true },
        },
        lines: {
          select: { id: true, qty: true, pickedQty: true },
          orderBy: { id: "asc" },
        },
      },
      orderBy: [{ pickedAt: "desc" }, { completedAt: "desc" }, { id: "desc" }],
      take: 5000,
    });

    const byUser = new Map();
    for (const order of orders) {
      if (!order.assignedToUserId) continue;

      const userId = order.assignedToUserId;
      const eventAt =
        order.pickedAt || order.completedAt || order.updatedAt || order.createdAt;
      const lines = Array.isArray(order.lines) ? order.lines : [];
      const linesCount = lines.length;
      const qtyOrdered = lines.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
      const qtyPicked = lines.reduce(
        (sum, row) => sum + Math.max(0, Number(row.pickedQty) || 0),
        0
      );

      if (!byUser.has(userId)) {
        byUser.set(userId, {
          userId,
          userName:
            order.assignedToUser?.name ||
            order.assignedToUser?.username ||
            order.assignedToUser?.email ||
            `user #${userId}`,
          userLogin:
            order.assignedToUser?.username || order.assignedToUser?.email || null,
          ordersCount: 0,
          linesCount: 0,
          qtyOrdered: 0,
          qtyPicked: 0,
          firstEventAt: eventAt || null,
          lastEventAt: eventAt || null,
          orders: [],
        });
      }

      const bucket = byUser.get(userId);
      bucket.ordersCount += 1;
      bucket.linesCount += linesCount;
      bucket.qtyOrdered += qtyOrdered;
      bucket.qtyPicked += qtyPicked;

      if (eventAt) {
        if (!bucket.firstEventAt || eventAt < bucket.firstEventAt) {
          bucket.firstEventAt = eventAt;
        }
        if (!bucket.lastEventAt || eventAt > bucket.lastEventAt) {
          bucket.lastEventAt = eventAt;
        }
      }

      bucket.orders.push({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        customerName: order.customerName || "",
        linesCount,
        qtyOrdered,
        qtyPicked,
        pickedAt: order.pickedAt,
        completedAt: order.completedAt,
        eventAt,
      });
    }

    const users = Array.from(byUser.values())
      .map((row) => ({
        ...row,
        firstEventAt: row.firstEventAt ? row.firstEventAt.toISOString() : null,
        lastEventAt: row.lastEventAt ? row.lastEventAt.toISOString() : null,
        orders: row.orders
          .sort((a, b) => {
            const aTs = a.eventAt ? new Date(a.eventAt).getTime() : 0;
            const bTs = b.eventAt ? new Date(b.eventAt).getTime() : 0;
            return bTs - aTs;
          })
          .map((item) => ({
            ...item,
            pickedAt: item.pickedAt ? new Date(item.pickedAt).toISOString() : null,
            completedAt: item.completedAt
              ? new Date(item.completedAt).toISOString()
              : null,
            eventAt: item.eventAt ? new Date(item.eventAt).toISOString() : null,
          })),
      }))
      .sort((a, b) => {
        if (b.ordersCount !== a.ordersCount) return b.ordersCount - a.ordersCount;
        if (b.qtyPicked !== a.qtyPicked) return b.qtyPicked - a.qtyPicked;
        return a.userName.localeCompare(b.userName, "ru");
      });

    const totals = users.reduce(
      (acc, row) => {
        acc.workers += 1;
        acc.orders += row.ordersCount;
        acc.lines += row.linesCount;
        acc.qtyOrdered += row.qtyOrdered;
        acc.qtyPicked += row.qtyPicked;
        return acc;
      },
      { workers: 0, orders: 0, lines: 0, qtyOrdered: 0, qtyPicked: 0 }
    );

    return res.json({
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      totals,
      users,
    });
  } catch (err) {
    console.error("admin picking report error:", err);
    return res.status(500).json({ message: "PICKING_REPORT_ERROR" });
  }
});

app.put("/api/users/:id/role", auth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const nextRole = normalizePortalRole(req.body?.role, "");

    if (!PORTAL_ALLOWED_ROLES.includes(nextRole)) {
      return res.status(400).json({ message: "Недопустимая роль" });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { email: true, orgId: true },
    });
    if (!target) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }
    if (String(target.email || "").trim().toLowerCase() === OWNER_PRIMARY_EMAIL) {
      return res.status(403).json({ message: "Системного владельца нельзя изменять" });
    }
    if (!req.user.isSystemOwner && target.orgId !== req.user.orgId) {
      return res.status(403).json({ message: "Нельзя менять роль пользователя из другой организации" });
    }

    await prisma.user.update({
      where: { id },
      data: { role: nextRole },
    });
    const fresh = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        passwordVisible: true,
        role: true,
        permissionsJson: true,
        orgId: true,
        organization: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        createdAt: true,
      },
    });
    if (!fresh) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }

    res.json({ user: toManagedUserPayload(fresh) });
  } catch (err) {
    console.error("change role error:", err);
    res.status(500).json({ message: "Ошибка сервера при смене роли" });
  }
});

app.put("/api/users/:id/permissions", auth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный идентификатор пользователя" });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { email: true, orgId: true },
    });
    if (!target) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }
    if (String(target.email || "").trim().toLowerCase() === OWNER_PRIMARY_EMAIL) {
      return res.status(403).json({ message: "Системного владельца нельзя изменять" });
    }
    if (!req.user.isSystemOwner && target.orgId !== req.user.orgId) {
      return res.status(403).json({ message: "Нельзя менять права пользователя из другой организации" });
    }

    const normalizedConfig = normalizePermissionConfig({
      template: req.body?.template,
      grants: req.body?.grants,
      revokes: req.body?.revokes,
    });

    await prisma.user.update({
      where: { id },
      data: {
        permissionsJson: stringifyPermissionConfig(normalizedConfig),
      },
    });

    const fresh = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        passwordVisible: true,
        role: true,
        permissionsJson: true,
        orgId: true,
        organization: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        createdAt: true,
      },
    });
    if (!fresh) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }

    res.json({ user: toManagedUserPayload(fresh) });
  } catch (err) {
    console.error("change permissions error:", err);
    res.status(500).json({ message: "Ошибка сервера при смене прав доступа" });
  }
});

app.delete("/api/users/:id", auth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({
        message: "\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 \u0438\u0434\u0435\u043d\u0442\u0438\u0444\u0438\u043a\u0430\u0442\u043e\u0440 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f",
      });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, username: true, orgId: true, isActive: true },
    });
    if (!target) {
      return res.status(404).json({
        message: "\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d",
      });
    }
    if (String(target.email || "").trim().toLowerCase() === OWNER_PRIMARY_EMAIL) {
      return res.status(403).json({
        message:
          "\u0421\u0438\u0441\u0442\u0435\u043c\u043d\u043e\u0433\u043e \u0432\u043b\u0430\u0434\u0435\u043b\u044c\u0446\u0430 \u043d\u0435\u043b\u044c\u0437\u044f \u0438\u0437\u043c\u0435\u043d\u044f\u0442\u044c",
      });
    }
    if (!req.user.isSystemOwner && target.orgId !== req.user.orgId) {
      return res.status(403).json({
        message:
          "\u041d\u0435\u043b\u044c\u0437\u044f \u0443\u0434\u0430\u043b\u0438\u0442\u044c \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430 \u0438\u0437 \u0434\u0440\u0443\u0433\u043e\u0439 \u043e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u0438.",
      });
    }
    if (req.user.id === id) {
      return res.status(403).json({
        message: "\u041d\u0435\u043b\u044c\u0437\u044f \u0443\u0434\u0430\u043b\u0438\u0442\u044c \u0442\u0435\u043a\u0443\u0449\u0435\u0433\u043e \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f.",
      });
    }
    if (target.isActive === false) {
      return res.json({ ok: true });
    }

    const tombstoneSuffix = String(Date.now()) + "_" + id + "_" + Math.floor(Math.random() * 1000000);
    const deletedEmail = "deleted_" + tombstoneSuffix + "@local.invalid";
    const deletedUsername = "deleted_" + tombstoneSuffix;
    await prisma.user.update({
      where: { id },
      data: {
        email: deletedEmail,
        username: deletedUsername,
        isActive: false,
        passwordVisible: null,
        permissionsJson: null,
        tokenVersion: { increment: 1 },
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("delete user error:", err);
    res.status(500).json({
      message:
        "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430 \u043f\u0440\u0438 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u0438 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430.",
    });
  }
});

app.get("/api/admin/tenants", auth, requireAdmin, requireSystemOwner, async (req, res) => {
  try {
    if (!hasPermission(req.user, PERMISSION_KEYS.ADMIN_TENANTS)) {
      return res.status(403).json({ message: "Нет доступа к разделу." });
    }
    const tenants = await prisma.organization.findMany({
      where: { isActive: true },
      orderBy: { id: "asc" },
      include: {
        _count: {
          select: { users: true, invites: true },
        },
        users: {
          where: { role: "ADMIN", isActive: true },
          orderBy: { id: "asc" },
          take: 1,
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            passwordVisible: true,
          },
        },
      },
    });
    const items = tenants.map(({ users, ...tenant }) => {
      const admin = Array.isArray(users) ? users[0] : null;
      return {
        ...tenant,
        adminUserId: admin?.id || null,
        adminName: admin?.name || null,
        adminLogin: admin?.username || admin?.email || null,
        adminPassword: admin?.passwordVisible || null,
      };
    });
    res.json({ items });
  } catch (err) {
    console.error("tenants list error:", err);
    res.status(500).json({ message: "TENANTS_LIST_ERROR" });
  }
});

app.delete("/api/admin/tenants/:id", auth, requireAdmin, requireSystemOwner, async (req, res) => {
  try {
    if (!hasPermission(req.user, PERMISSION_KEYS.ADMIN_TENANTS)) {
      return res.status(403).json({
        message: "\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u043a \u0440\u0430\u0437\u0434\u0435\u043b\u0443.",
      });
    }

    const tenantId = Number(req.params.id);
    if (!tenantId || Number.isNaN(tenantId)) {
      return res.status(400).json({
        message:
          "\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 \u0438\u0434\u0435\u043d\u0442\u0438\u0444\u0438\u043a\u0430\u0442\u043e\u0440 \u043a\u043b\u0438\u0435\u043d\u0442\u0430.",
      });
    }

    const tenant = await prisma.organization.findUnique({
      where: { id: tenantId },
      select: { id: true, code: true, name: true, isActive: true },
    });
    if (!tenant) {
      return res.status(404).json({
        message: "\u041a\u043b\u0438\u0435\u043d\u0442 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d.",
      });
    }
    if (tenant.code === "platform-owner" || req.user.orgId === tenant.id) {
      return res.status(403).json({
        message:
          "\u041d\u0435\u043b\u044c\u0437\u044f \u0443\u0434\u0430\u043b\u044f\u0442\u044c \u043e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u044e \u0432\u043b\u0430\u0434\u0435\u043b\u044c\u0446\u0430 \u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u044b.",
      });
    }
    if (tenant.isActive === false) {
      return res.json({ ok: true });
    }

    const users = await prisma.user.findMany({
      where: { orgId: tenant.id },
      select: { id: true, email: true },
      orderBy: { id: "asc" },
    });

    await prisma.$transaction(async (tx) => {
      for (const account of users) {
        if (isOwnerEmail(account.email)) {
          continue;
        }
        const suffix =
          String(Date.now()) +
          "_" +
          tenant.id +
          "_" +
          account.id +
          "_" +
          Math.floor(Math.random() * 1000000);
        await tx.user.update({
          where: { id: account.id },
          data: {
            email: "deleted_" + suffix + "@local.invalid",
            username: "deleted_" + suffix,
            isActive: false,
            passwordVisible: null,
            permissionsJson: null,
            tokenVersion: { increment: 1 },
          },
        });
      }

      await tx.inviteToken.updateMany({
        where: { orgId: tenant.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      await tx.organization.update({
        where: { id: tenant.id },
        data: { isActive: false },
      });
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("tenant delete error:", err);
    res.status(500).json({
      message:
        "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430 \u043f\u0440\u0438 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u0438 \u043a\u043b\u0438\u0435\u043d\u0442\u0430.",
    });
  }
});

app.post("/api/admin/tenants", auth, requireAdmin, requireSystemOwner, async (req, res) => {
  try {
    if (!hasPermission(req.user, PERMISSION_KEYS.ADMIN_TENANTS)) {
      return res.status(403).json({ message: "Нет доступа к разделу." });
    }
    const { name, ownerLogin, ownerName, ownerPassword } = req.body || {};
    const tenantName = String(name || "").trim();
    const normalizedLogin = normalizeLogin(ownerLogin);
    const adminName = String(ownerName || "").trim() || "Администратор";
    const password = String(ownerPassword || "");

    if (!tenantName || !normalizedLogin || !password || password.length < 8) {
      return res.status(400).json({ message: "BAD_TENANT_PAYLOAD" });
    }
    if (!isValidUsername(normalizedLogin)) {
      return res.status(400).json({
        message:
          "Логин должен быть 3-32 символа: буквы, цифры, точка, дефис или подчёркивание.",
      });
    }

    const existingByUsername = await prisma.user.findUnique({
      where: { username: normalizedLogin },
      select: { id: true },
    });
    if (existingByUsername) {
      return res.status(400).json({ message: "USERNAME_ALREADY_EXISTS" });
    }

    const technicalEmail = buildTechnicalEmailByUsername(normalizedLogin);
    if (isOwnerEmail(technicalEmail)) {
      return res.status(400).json({ message: "OWNER_EMAIL_RESERVED" });
    }

    const existingByEmail = await prisma.user.findUnique({
      where: { email: technicalEmail },
      select: { id: true },
    });
    if (existingByEmail) {
      return res.status(400).json({ message: "USERNAME_ALREADY_EXISTS" });
    }

    const tenant = await prisma.organization.create({
      data: {
        name: tenantName,
        code: makeTenantCode(tenantName),
        isActive: true,
      },
    });

    const hash = await bcrypt.hash(password, 10);
    const adminUser = await prisma.user.create({
      data: {
        email: technicalEmail,
        username: normalizedLogin,
        password: hash,
        passwordHash: hash,
        passwordVisible: password,
        name: adminName,
        role: "ADMIN",
        isActive: true,
        emailVerifiedAt: new Date(),
        orgId: tenant.id,
      },
      select: {
        id: true,
        email: true,
        username: true,
        passwordVisible: true,
        name: true,
        role: true,
        orgId: true,
      },
    });

    res.json({
      ok: true,
      tenant,
      user: {
        ...adminUser,
        login: adminUser.username || adminUser.email,
        adminPassword: adminUser.passwordVisible || password,
        initialPassword: password,
      },
    });
  } catch (err) {
    if (String(err?.code || "") === "P2002") {
      return res.status(400).json({ message: "USERNAME_ALREADY_EXISTS" });
    }
    console.error("tenant create error:", err);
    res.status(500).json({ message: "TENANT_CREATE_ERROR" });
  }
});

const INVITE_ROLES = PORTAL_ALLOWED_ROLES;

app.get("/api/admin/invites", auth, requireAdmin, async (req, res) => {
  try {
    if (!hasPermission(req.user, PERMISSION_KEYS.ADMIN_USERS)) {
      return res.status(403).json({ message: "Нет доступа к разделу." });
    }
    if (!req.user.isSystemOwner && !req.user.orgId) {
      return res.status(403).json({ message: "Организация пользователя не настроена" });
    }
    const filterOrgId = req.user.isSystemOwner
      ? (req.query.orgId ? Number(req.query.orgId) : null)
      : req.user.orgId;

    const items = await prisma.inviteToken.findMany({
      where:
        filterOrgId && Number.isFinite(filterOrgId)
          ? { orgId: filterOrgId }
          : req.user.isSystemOwner
            ? {}
            : { orgId: req.user.orgId },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();
    const response = items.map((inv) => {
      let status = "PENDING";
      if (inv.usedAt) status = "USED";
      else if (inv.expiresAt < now) status = "EXPIRED";
      return {
        id: inv.id,
        email: inv.email,
        orgId: inv.orgId,
        role: inv.role,
        expiresAt: inv.expiresAt,
        usedAt: inv.usedAt,
        createdAt: inv.createdAt,
        createdByUserId: inv.createdByUserId,
        status,
      };
    });

    res.json({ items: response });
  } catch (err) {
    console.error("admin invites list error:", err);
    res.status(500).json({ message: "INVITES_LIST_ERROR" });
  }
});

app.post("/api/admin/invites", auth, requireAdmin, async (req, res) => {
  try {
    if (!hasPermission(req.user, PERMISSION_KEYS.ADMIN_USERS)) {
      return res.status(403).json({ message: "Нет доступа к разделу." });
    }
    const { email, role, orgId } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    const normalizedRole = normalizePortalRole(role, "");
    if (!normalizedEmail || !normalizedRole || !INVITE_ROLES.includes(normalizedRole)) {
      return res.status(400).json({ message: "BAD_INVITE" });
    }
    const targetOrgId = req.user.isSystemOwner
      ? Number(orgId || req.user.orgId || 0)
      : req.user.orgId;
    if (!targetOrgId || Number.isNaN(targetOrgId)) {
      return res.status(400).json({ message: "ORG_REQUIRED" });
    }
    const targetOrg = await prisma.organization.findUnique({
      where: { id: targetOrgId },
      select: { id: true },
    });
    if (!targetOrg) {
      return res.status(404).json({ message: "ORG_NOT_FOUND" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return res.status(400).json({ message: "EMAIL_ALREADY_EXISTS" });
    }

    const now = new Date();
    const minuteAgo = new Date(now.getTime() - INVITE_EMAIL_COOLDOWN_MS);

    const recentForEmail = await prisma.inviteToken.count({
      where: {
        email: normalizedEmail,
        orgId: targetOrgId,
        createdAt: { gte: minuteAgo },
      },
    });
    if (recentForEmail > 0) {
      return res.status(429).json({ message: "INVITE_RATE_LIMIT" });
    }

    const recentGlobal = await prisma.inviteToken.count({
      where: { createdAt: { gte: minuteAgo } },
    });
    if (recentGlobal >= INVITE_GLOBAL_LIMIT) {
      return res.status(429).json({ message: "INVITE_GLOBAL_LIMIT" });
    }

    const rawToken = createInviteToken();
    const tokenHash = hashInviteToken(rawToken);
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

    const invite = await prisma.inviteToken.create({
      data: {
        email: normalizedEmail,
        orgId: targetOrgId,
        tokenHash,
        role: normalizedRole,
        expiresAt,
        createdByUserId: req.user.id,
      },
    });

    await sendInviteEmail(normalizedEmail, rawToken);

    res.json({
      ok: true,
      invite: {
        id: invite.id,
        email: invite.email,
        orgId: invite.orgId,
        role: invite.role,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
        status: "PENDING",
      },
    });
  } catch (err) {
    console.error("admin invite create error:", err);
    res.status(500).json({ message: "INVITE_CREATE_ERROR" });
  }
});

app.post("/api/admin/invites/:id/resend", auth, requireAdmin, async (req, res) => {
  try {
    if (!hasPermission(req.user, PERMISSION_KEYS.ADMIN_USERS)) {
      return res.status(403).json({ message: "Нет доступа к разделу." });
    }
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_INVITE_ID" });
    }

    const invite = await prisma.inviteToken.findUnique({ where: { id } });
    if (!invite) {
      return res.status(404).json({ message: "INVITE_NOT_FOUND" });
    }
    if (!req.user.isSystemOwner && invite.orgId !== req.user.orgId) {
      return res.status(403).json({ message: "Нет доступа к приглашению другой организации" });
    }

    const now = new Date();
    const minuteAgo = new Date(now.getTime() - INVITE_EMAIL_COOLDOWN_MS);

    const recentForEmail = await prisma.inviteToken.count({
      where: {
        email: invite.email,
        orgId: invite.orgId,
        createdAt: { gte: minuteAgo },
      },
    });
    if (recentForEmail > 0) {
      return res.status(429).json({ message: "INVITE_RATE_LIMIT" });
    }

    const recentGlobal = await prisma.inviteToken.count({
      where: { createdAt: { gte: minuteAgo } },
    });
    if (recentGlobal >= INVITE_GLOBAL_LIMIT) {
      return res.status(429).json({ message: "INVITE_GLOBAL_LIMIT" });
    }
    if (recentForEmail > 0) {
      return res.status(429).json({ message: "INVITE_RATE_LIMIT" });
    }

    const rawToken = createInviteToken();
    const tokenHash = hashInviteToken(rawToken);
    const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

    if (!invite.usedAt) {
      await prisma.inviteToken.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      });
    }

    const nextInvite = await prisma.inviteToken.create({
      data: {
        email: invite.email,
        orgId: invite.orgId,
        tokenHash,
        role: invite.role,
        expiresAt,
        createdByUserId: req.user.id,
      },
    });

    await sendInviteEmail(invite.email, rawToken);

    res.json({
      ok: true,
      invite: {
        id: nextInvite.id,
        email: nextInvite.email,
        orgId: nextInvite.orgId,
        role: nextInvite.role,
        expiresAt: nextInvite.expiresAt,
        createdAt: nextInvite.createdAt,
        status: "PENDING",
      },
    });
  } catch (err) {
    console.error("admin invite resend error:", err);
    res.status(500).json({ message: "INVITE_RESEND_ERROR" });
  }
});

app.get("/api/auth/invite-info", async (req, res) => {
  try {
    const token = String(req.query.token || "").trim();
    if (!token) {
      return res.status(400).json({ message: "BAD_TOKEN" });
    }
    const tokenHash = hashInviteToken(token);
    const invite = await prisma.inviteToken.findUnique({
      where: { tokenHash },
    });
    if (!invite) {
      return res.status(404).json({ message: "INVITE_NOT_FOUND" });
    }
    if (invite.usedAt) {
      return res.status(400).json({ message: "INVITE_USED" });
    }
    if (invite.expiresAt < new Date()) {
      return res.status(400).json({ message: "INVITE_EXPIRED" });
    }

    res.json({
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
    });
  } catch (err) {
    console.error("invite info error:", err);
    res.status(500).json({ message: "INVITE_INFO_ERROR" });
  }
});

app.post("/api/auth/accept-invite", async (req, res) => {
  try {
    const { token, password, name } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ message: "BAD_REQUEST" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: "WEAK_PASSWORD" });
    }

    const tokenHash = hashInviteToken(token);
    const invite = await prisma.inviteToken.findUnique({
      where: { tokenHash },
    });
    if (!invite) {
      return res.status(404).json({ message: "INVITE_NOT_FOUND" });
    }
    if (invite.usedAt) {
      return res.status(400).json({ message: "INVITE_USED" });
    }
    if (invite.expiresAt < new Date()) {
      return res.status(400).json({ message: "INVITE_EXPIRED" });
    }

    let inviteOrgId = invite.orgId || null;
    if (!inviteOrgId) {
      const inviter = await prisma.user.findUnique({
        where: { id: invite.createdByUserId },
        select: { orgId: true, name: true },
      });
      inviteOrgId =
        inviter?.orgId || (await ensureUserOrg(invite.createdByUserId, inviter?.name || "Клиент"));
      if (inviteOrgId) {
        await prisma.inviteToken.update({
          where: { id: invite.id },
          data: { orgId: inviteOrgId },
        });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date();

    const existingUser = await prisma.user.findUnique({
      where: { email: invite.email },
    });

    if (existingUser) {
      if (existingUser.isActive) {
        return res.status(400).json({ message: "EMAIL_ALREADY_EXISTS" });
      }
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name: name || existingUser.name,
          role: invite.role,
          password: passwordHash,
          passwordHash,
          passwordVisible: String(password),
          orgId: inviteOrgId || existingUser.orgId || null,
          isActive: true,
          emailVerifiedAt: now,
        },
      });
    } else {
      await prisma.user.create({
        data: {
          email: invite.email,
          name: name || invite.email,
          role: invite.role,
          password: passwordHash,
          passwordHash,
          passwordVisible: String(password),
          orgId: inviteOrgId || null,
          isActive: true,
          emailVerifiedAt: now,
        },
      });
    }

    await prisma.inviteToken.update({
      where: { id: invite.id },
      data: { usedAt: now },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("accept invite error:", err);
    res.status(500).json({ message: "INVITE_ACCEPT_ERROR" });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const responseMessage = "Если аккаунт существует — мы отправили письмо.";
  try {
    const { email } = req.body || {};
    const normalized = normalizeEmail(email);
    const now = Date.now();

    if (!normalized) {
      return res.json({ message: responseMessage });
    }

    const last = resetEmailRate.get(normalized) || 0;
    if (now - last < RESET_EMAIL_COOLDOWN_MS) {
      return res.json({ message: responseMessage });
    }

    const cutoff = now - RESET_EMAIL_COOLDOWN_MS;
    while (resetGlobalRate.length && resetGlobalRate[0] < cutoff) {
      resetGlobalRate.shift();
    }
    if (resetGlobalRate.length >= RESET_GLOBAL_LIMIT) {
      return res.json({ message: responseMessage });
    }

    resetEmailRate.set(normalized, now);
    resetGlobalRate.push(now);

    let user = await prisma.user.findUnique({ where: { email: normalized } });
    if (!user) {
      const legacyRows = await prisma.$queryRaw`
        SELECT "id" FROM "User"
        WHERE LOWER(TRIM("email")) = LOWER(${normalized})
        LIMIT 1
      `;
      const legacyId = Number(legacyRows?.[0]?.id || 0);
      if (legacyId) {
        user = await prisma.user.findUnique({ where: { id: legacyId } });
        if (user && user.email !== normalized) {
          await prisma.user.update({
            where: { id: user.id },
            data: { email: normalized },
          });
          user.email = normalized;
        }
      }
    }
    if (!user || user.isActive === false) {
      return res.json({ message: responseMessage });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(now + RESET_TTL_MS);

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    await sendPasswordResetEmail(user.email, rawToken);

    return res.json({ message: responseMessage });
  } catch (err) {
    console.error("forgot password error:", err);
    return res.json({ message: responseMessage });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword || String(newPassword).length < 8) {
      return res
        .status(400)
        .json({ message: "Ссылка недействительна или истекла." });
    }

    const tokenHash = hashResetToken(String(token));
    const now = new Date();

    const resetToken = await prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: now },
      },
      include: { user: true },
    });

    if (!resetToken || !resetToken.user) {
      return res
        .status(400)
        .json({ message: "Ссылка недействительна или истекла." });
    }

    const hash = await bcrypt.hash(String(newPassword), 10);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: resetToken.userId },
        data: {
          password: hash,
          passwordHash: hash,
          passwordVisible: String(newPassword),
          tokenVersion: { increment: 1 },
        },
      });

      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: now },
      });
    });

    await sendPasswordChangedEmail(resetToken.user.email);

    res.json({ ok: true });
  } catch (err) {
    console.error("reset password error:", err);
    res
      .status(500)
      .json({ message: "Ссылка недействительна или истекла." });
  }
});



// ================== СКЛАД: ЗАЯВКИ ==================

// создать заявку на склад

app.post("/api/warehouse/requests", auth, async (req, res) => {
  try {
    const {
      title,
      type,
      desiredDate,
      comment,
      items,
      relatedPaymentId,
      relatedDocument,
      targetEmployee,
    } = req.body;

    if (!title || !type) {
      return res
        .status(400)
        .json({ message: "Не указан тип или название заявки" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ message: "Нужно указать хотя бы одну позицию" });
    }

    // аккуратно разбираем номер платёжки: только число, иначе null
    let paymentId = null;
    if (
      relatedPaymentId !== undefined &&
      relatedPaymentId !== null &&
      relatedPaymentId !== ""
    ) {
      const parsed = Number(relatedPaymentId);
      if (!Number.isNaN(parsed)) {
        paymentId = parsed;
      }
    }

    // 1. Приводим позиции и проверяем количество
    const preparedItems = [];
    const validationItems = [];

    for (const it of items) {
      const q = Number(it.quantity);
      const name = String(it.name || "").trim();
      const rawItemId = it.itemId;
      const itemId =
        rawItemId !== undefined && rawItemId !== null && rawItemId !== ""
          ? Number(rawItemId)
          : null;

      if (!name) {
        return res.status(400).json({ message: "??????? ???????? ??????." });
      }

      if (!Number.isFinite(q) || !Number.isInteger(q) || q <= 0) {
        return res.status(400).json({
          message: `?????????? ??? ?????? "${name}" ?????? ???? ????????????? ????? ??????.`,
        });
      }

      preparedItems.push({
        name,
        quantity: q,
        unit: it.unit || null,
      });
      validationItems.push({
        itemId: Number.isFinite(itemId) ? itemId : null,
        name,
        quantity: q,
        unit: it.unit || null,
      });
    }

    if (type === "ISSUE") {
      for (const it of validationItems) {
        let invItem = null;

        if (it.itemId) {
          invItem = await prisma.item.findUnique({ where: { id: it.itemId } });
        }

        if (!invItem && it.name) {
          invItem = await prisma.item.findFirst({ where: { name: it.name } });
        }

        if (!invItem) continue;

        const currentStock =
          invItem.category === "TMC"
            ? await getTmcStockForItem(invItem.id)
            : await getCurrentStockForItem(invItem.id);
        const current = currentStock ?? 0;

        if (current < it.quantity) {
          return res.status(400).json({
            message: `???????????? ??????? ?? ?????? "${invItem.name}". ???????? ${current} ${invItem.unit || "??."}, ????????? ${it.quantity}.`,
          });
        }
      }
    }

    // 3. Создаём заявку
    const created = await prisma.warehouseRequest.create({
      data: {
        title,
        type,
        desiredDate: desiredDate ? new Date(desiredDate) : null,
        comment: comment || null,
        relatedPaymentId: paymentId,
        relatedDocument: relatedDocument || null,
        targetEmployee: targetEmployee || null,
        createdById: req.user.id,
        items: {
          create: preparedItems.map((row) => ({
            ...row,
            orgId: req.user.orgId || null,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    // 4. Создаём задачу и шлём в Telegram
    try {
      await createWarehouseTaskFromRequest(created, req.user.id);
    } catch (err) {
      console.error("Ошибка при создании задачи по заявке:", err);
    }

    res.status(201).json(created);
  } catch (err) {
    console.error("warehouse request create error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при создании заявки на склад" });
  }
});

// мои заявки
app.get("/api/warehouse/requests/my", auth, async (req, res) => {
  try {
    const list = await prisma.warehouseRequest.findMany({
      where: { createdById: req.user.id },
      orderBy: { createdAt: "desc" },
      include: {
        items: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.json(list);
  } catch (err) {
    console.error("warehouse my-requests error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при загрузке ваших заявок" });
  }
});

// все заявки (ADMIN/EMPLOYEE)
app.get("/api/warehouse/requests", auth, async (req, res) => {
  try {
    if (!PORTAL_ALLOWED_ROLES.includes(req.user.role)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const list = await prisma.warehouseRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        items: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.json(list);
  } catch (err) {
    console.error("warehouse all-requests error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при загрузке складских заявок" });
  }
});

// Автоматически провести заявку по складу (создать движения по номенклатуре)
async function autoPostRequestToStock(requestId, userId) {
  const id = Number(requestId);
  if (!id) return;

  // Уже есть движения по этой заявке? (ищем метку [REQ#id] в комментарии)
  const alreadyPosted = await prisma.stockMovement.findFirst({
    where: {
      comment: {
        contains: `[REQ#${id}]`,
      },
    },
  });

  if (alreadyPosted) {
    console.log(
      `[Warehouse] Заявка #${id} уже проведена по складу, авто-проведение пропущено`
    );
    return;
  }

  // Берём заявку и её позиции
  const request = await prisma.warehouseRequest.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!request) {
    console.warn(
      `[Warehouse] Заявка #${id} не найдена для авто-проведения по складу`
    );
    return;
  }

  if (!request.items || request.items.length === 0) {
    console.warn(
      `[Warehouse] Заявка #${id} не имеет позиций для авто-проведения`
    );
    return;
  }

  // Тип движения по складу по типу заявки
  const mapRequestTypeToMovementType = (reqType) => {
    if (reqType === "ISSUE") return "ISSUE"; // выдача → расход
    if (reqType === "RETURN" || reqType === "INCOME") return "INCOME"; // возврат/приход → приход
    return "ISSUE";
  };

  const movementType = mapRequestTypeToMovementType(request.type);

  let createdCount = 0;

  // идём по всем позициям заявки
  for (const item of request.items) {
    if (!item.name || !item.quantity) continue;

    const q = Number(item.quantity);
    if (!Number.isFinite(q) || !Number.isInteger(q) || q <= 0) {
      continue;
    }

    // Ищем товар в номенклатуре по точному имени
    let invItem = await prisma.item.findFirst({
      where: { name: item.name, category: "TMC" },
    });

    if (!invItem) {
      invItem = await prisma.item.findFirst({
        where: { name: item.name },
      });
    }

    if (!invItem) {
      console.warn(
        `[Warehouse] Товар "${item.name}" не найден в номенклатуре при авто-проведении заявки #${id}`
      );
      continue;
    }

    // Если это расход — проверяем, хватит ли остатка
    if (movementType === "ISSUE") {
      try {
        if (invItem.category === "TMC") {
          const current = await getTmcStockForItem(invItem.id);
          if (current < q) {
            console.warn(
              `[Warehouse] Insufficient stock for "${item.name}" in request #${id} (have ${current}, need ${q})`
            );
            continue;
          }
        } else {
          const stockInfo = await calculateStockAfterMovement(
            invItem.id,
            "ISSUE",
            q
          );

          if (stockInfo.newStock < 0) {
            console.warn(
              `[Warehouse] Insufficient stock for "${item.name}" in request #${id} (have ${stockInfo.current}, need ${q})`
            );
            continue;
          }
        }
      } catch (e) {
        console.error(
          `[Warehouse] Stock check error for request #${id}:`,
          e
        );
        continue;
      }
    }

    // Создаём движение по складу
    await prisma.stockMovement.create({
      data: {
        itemId: invItem.id,
        type: movementType, // "ISSUE" или "INCOME"
        quantity: q,
        comment: `Автодвижение по заявке склада #${request.id}: ${request.title} [REQ#${request.id}]`,
        createdById: userId,
      },
    });

    createdCount++;
  }

  console.log(
    `[Warehouse] Авто-проведение заявки #${id}: создано движений по складу: ${createdCount}`
  );

  return createdCount;
}

// смена статуса заявки + автопроведение по складу при DONE
app.put("/api/warehouse/requests/:id/status", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, statusComment } = req.body;

    if (!PORTAL_ALLOWED_ROLES.includes(req.user.role)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    if (!["NEW", "IN_PROGRESS", "DONE", "REJECTED"].includes(status)) {
      return res.status(400).json({ message: "Недопустимый статус" });
    }

    // 1. Меняем статус заявки
    const updated = await prisma.warehouseRequest.update({
      where: { id },
      data: {
        status,
        statusComment: statusComment || null,
      },
      include: {
        items: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    let stockResult = null;

    // 2. Если заявка переведена в DONE — проводим её по складу
    if (status === "DONE") {
      try {
        stockResult = await autoPostRequestToStock(id, req.user.id);
      } catch (e) {
        console.error(
          "[warehouse request status] autoPostRequestToStock error:",
          e
        );
        stockResult = {
          ok: false,
          createdCount: 0,
          skipped: [],
          message:
            "Ошибка при автосписании по складу. Проверьте журнал движений и остатки вручную.",
        };
      }
    }

    return res.json({
      ...updated,
      stockResult,
    });
  } catch (err) {
    console.error("warehouse request status error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при обновлении статуса заявки" });
  }
});

// ================== СКЛАД: ЗАДАЧИ ==================

// Вспомогательная функция: создать задачу склада по заявке
async function createWarehouseTaskFromRequest(request, assignerId) {
  try {
    const lines = [];

    if (request.comment) {
      lines.push(`\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439: ${request.comment}`);
    }

    if (request.items && request.items.length) {
      if (lines.length) lines.push("");
      lines.push("\u041f\u043e\u0437\u0438\u0446\u0438\u0438:");

      for (const it of request.items) {
        lines.push(`- ${it.name} \u2014 ${it.quantity} ${it.unit || ""}`.trim());
      }
    }

    const description = lines.join("\n");

    const task = await prisma.warehouseTask.create({
      data: {
        title: `\u0417\u0430\u044f\u0432\u043a\u0430 \u0441\u043a\u043b\u0430\u0434\u0430 #${request.id}: ${request.title || "\u0411\u0435\u0437 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f"}`,
        description,
        dueDate: null,
        executorName: "\u041d\u0435 \u043d\u0430\u0437\u043d\u0430\u0447\u0435\u043d",
        executorChatId: null,
        assignerId,
      },
      include: {
        assigner: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    console.log(
      `[Warehouse] \u0441\u043e\u0437\u0434\u0430\u043d\u0430 \u0437\u0430\u0434\u0430\u0447\u0430 ${task.id} \u043f\u043e \u0437\u0430\u044f\u0432\u043a\u0435 ${request.id}`
    );

    const groupText = buildWarehouseTaskCreatedTelegramText(task);

    await sendWarehouseGroupMessage(groupText);

    return task;
  } catch (err) {
    console.error("[createWarehouseTaskFromRequest] error:", err);
  }
}

app.post("/api/warehouse/tasks", auth, async (req, res) => {
  try {
    const { title, description, dueDate, executorName, executorChatId } =
      req.body;

    if (!title) {
      return res
        .status(400)
        .json({ message: "\u041d\u0443\u0436\u043d\u043e \u0443\u043a\u0430\u0437\u0430\u0442\u044c \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u0437\u0430\u0434\u0430\u0447\u0438." });
    }

    const task = await prisma.warehouseTask.create({
      data: {
        title,
        description: description || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        executorName: executorName || null,
        executorChatId: executorChatId || null,
        assignerId: req.user.id,
      },
      include: {
        assigner: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    const groupText = buildWarehouseTaskAssignedTelegramText(task, { forExecutor: false });

    sendWarehouseGroupMessage(groupText).catch((err) =>
      console.error("\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438 \u0432 Telegram (\u0433\u0440\u0443\u043f\u043f\u0430):", err)
    );

    if (task.executorChatId) {
      const execText = buildWarehouseTaskAssignedTelegramText(task, { forExecutor: true });
      let buttonText = "\u041e\u0442\u043c\u0435\u0442\u0438\u0442\u044c \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u043e";
      let callbackData = `done:${task.id}`;

      try {
        const requestId = extractRequestIdFromTitle(task.title);
        if (requestId) {
          const request = await prisma.warehouseRequest.findUnique({
            where: { id: requestId },
            include: { items: true },
          });
          if (await isTmcIssueRequest(request)) {
            buttonText = "\u0412\u044b\u0434\u0430\u043d\u043e";
            callbackData = `issue_done:${task.id}`;
          }
        }
      } catch (e) {
        console.error("[Telegram] cannot detect request for task:", e);
      }

      sendTelegramMessage(task.executorChatId, execText, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: buttonText,
                callback_data: callbackData,
              },
            ],
          ],
        },
      }).catch((err) =>
        console.error("\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438 \u0432 Telegram (\u0438\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c):", err)
      );
    }

    res.status(201).json(task);
  } catch (err) {
    console.error("warehouse task create error:", err);
    res
      .status(500)
      .json({ message: "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u0437\u0430\u0434\u0430\u0447\u0438 \u0441\u043a\u043b\u0430\u0434\u0430." });
  }
});

app.get("/api/warehouse/tasks/my", auth, async (req, res) => {
  try {
    const tasks = await prisma.warehouseTask.findMany({
      where: { assignerId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: {
        assigner: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.json(tasks);
  } catch (err) {
    console.error("warehouse tasks my error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при загрузке ваших задач" });
  }
});

// все задачи склада (ADMIN/EMPLOYEE)
app.get("/api/warehouse/tasks", auth, async (req, res) => {
  try {
    if (!PORTAL_ALLOWED_ROLES.includes(req.user.role)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const tasks = await prisma.warehouseTask.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        assigner: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.json(tasks);
  } catch (err) {
    console.error("warehouse tasks list error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при загрузке задач склада" });
  }
});

// смена статуса задачи (через портал, не через бота)
app.put("/api/warehouse/tasks/:id/status", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;

    if (!PORTAL_ALLOWED_ROLES.includes(req.user.role)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    if (!["NEW", "IN_PROGRESS", "DONE", "CANCELLED"].includes(status)) {
      return res.status(400).json({ message: "Недопустимый статус" });
    }

    const updated = await prisma.warehouseTask.update({
      where: { id },
      data: { status },
    });

    // Если задача создана по заявке на склад и мы поставили DONE —
    // автоматически проводим эту заявку по складу
    if (status === "DONE") {
      try {
        // title вида: "Заявка на склад #19: ..."
        const match = updated.title.match(/Заявка на склад #(\d+)/);
        if (match && updated.assignerId) {
          const requestId = Number(match[1]);
          if (requestId) {
            await autoPostRequestToStock(requestId, updated.assignerId);
          }
        }
      } catch (e) {
        console.error(
          "autoPostRequestFromTask (status endpoint) error:",
          e
        );
      }
    }

    res.json(updated);
  } catch (err) {
    console.error("warehouse task status error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при обновлении статуса задачи" });
  }
});

// ================== СКЛАД: НОМЕНКЛАТУРА И ОСТАТКИ ==================

// Создать товар (номенклатура)
app.post("/api/inventory/items", auth, async (req, res) => {
  try {
    const {
      name,
      sku,
      barcode,
      qrCode,
      unit,
      minStock,
      maxStock,
      defaultPrice,
    } = req.body;

    // 1) Проверяем, что строки не пустые
    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ message: "Наименование товара обязательно" });
    }

    if (!sku || !sku.trim()) {
      return res
        .status(400)
        .json({ message: "Артикул (SKU) обязателен" });
    }

    if (!unit || !unit.trim()) {
      return res
        .status(400)
        .json({ message: "Единица измерения обязательна" });
    }

    // 2) Числовые поля
    const minVal = Number(minStock);
    const maxVal = Number(maxStock);
    const priceVal = Number(
      String(defaultPrice).toString().replace(",", ".")
    );

    if (!Number.isFinite(minVal) || minVal <= 0) {
      return res.status(400).json({
        message: "Минимальный остаток должен быть положительным числом",
      });
    }

    if (!Number.isFinite(maxVal) || maxVal <= 0) {
      return res.status(400).json({
        message: "Максимальный остаток должен быть положительным числом",
      });
    }

    if (!Number.isFinite(priceVal) || priceVal <= 0) {
      return res.status(400).json({
        message: "Цена за единицу должна быть положительным числом",
      });
    }

    // 3) Создаём товар
    const item = await prisma.item.create({
      data: {
        name: name.trim(),
        sku: sku.trim(),
        barcode: barcode && barcode.trim() ? barcode.trim() : null,
        qrCode: qrCode && qrCode.trim() ? qrCode.trim() : null,
        unit: unit.trim(),
        minStock: minVal,
        maxStock: maxVal,
        defaultPrice: priceVal,
      },
    });

    return res.status(201).json(item);
  } catch (err) {
    console.error("create item error:", err);
    if (err.code === "P2002") {
      return res
        .status(400)
        .json({ message: "Артикул, штрихкод или QR уже используются" });
    }
    return res
      .status(500)
      .json({ message: "Ошибка сервера при создании товара" });
  }
});

// Список товаров (без расчёта остатков)
app.get("/api/inventory/items", auth, async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      where: { category: "STOCK" },
      orderBy: { name: "asc" },
    });
    res.json(items);
  } catch (err) {
    console.error("list items error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при загрузке товаров" });
  }
});

// Поиск товара по штрихкоду (для мобильного ТСД)
app.get("/api/inventory/items/by-barcode/:barcode", auth, async (req, res) => {
  try {
    const raw = req.params.barcode || "";
    const barcode = raw.trim();

    if (!barcode) {
      return res.status(400).json({ message: "Штрихкод обязателен" });
    }

    // ищем по штрихкоду, QR или SKU (на случай, если сканер посылает код артикула)
    const item = await prisma.item.findFirst({
      where: {
        category: "STOCK",
        OR: [
          { barcode },
          { qrCode: barcode },
          { sku: barcode },
        ],
      },
    });

    if (!item) {
      return res
        .status(404)
        .json({ message: "Товар с таким штрихкодом не найден" });
    }

    // считаем текущий остаток по этому товару
    const currentStock = await getCurrentStockForItem(item.id);

    return res.json({
      id: item.id,
      name: item.name,
      sku: item.sku,
      barcode: item.barcode,
      qrCode: item.qrCode,
      unit: item.unit,
      minStock: item.minStock,
      maxStock: item.maxStock,
      defaultPrice: item.defaultPrice,
      currentStock: currentStock ?? 0,
    });
  } catch (err) {
    console.error("get item by barcode error:", err);
    return res
      .status(500)
      .json({ message: "Ошибка сервера при поиске товара по штрихкоду" });
  }
});

// Удалить товар (номенклатура)
app.delete("/api/inventory/items/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id || Number.isNaN(id)) {
      return res
        .status(400)
        .json({ message: "Некорректный ID товара" });
    }

    const existing = await prisma.item.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({ message: "Товар не найден" });
    }

    // Сначала удаляем все движения по этому товару
    await prisma.stockMovement.deleteMany({
      where: { itemId: id },
    });

    // Потом сам товар
    await prisma.item.delete({
      where: { id },
    });

    return res.json({ message: "Товар и все движения по нему удалены" });
  } catch (err) {
    console.error("delete item error:", err);
    return res
      .status(500)
      .json({ message: "Ошибка сервера при удалении товара" });
  }
});

// ===== СКЛАД: ЛОКАЦИИ =====
app.get("/api/warehouse/locations", auth, async (req, res) => {
  try {
    const locations = await prisma.warehouseLocation.findMany({
      orderBy: { id: "asc" },
    });
    res.json(locations);
  } catch (err) {
    console.error("list locations error:", err);
    res.status(500).json({ message: "Ошибка сервера при загрузке локаций" });
  }
});

app.post("/api/warehouse/locations", auth, async (req, res) => {
  try {
    const { name, zone, aisle, rack, level } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Название локации обязательно" });
    }

    const location = await prisma.warehouseLocation.create({
      data: {
        name: name.trim(),
        zone: zone?.trim() || null,
        aisle: aisle?.trim() || null,
        rack: rack?.trim() || null,
        level: level?.trim() || null,
      },
    });

    res.status(201).json(location);
  } catch (err) {
    console.error("create location error:", err);
    if (err.code === "P2002") {
      return res.status(400).json({ message: "Код локации уже используется" });
    }
    res.status(500).json({ message: "Ошибка сервера при создании локации" });
  }
});

app.put("/api/warehouse/locations/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "INVALID_LOCATION_ID" });
    }

    const existing = await prisma.warehouseLocation.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
    }

    const { name, zone, aisle, rack, level } = req.body || {};
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ message: "NAME_REQUIRED" });
    }

    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (zone !== undefined) data.zone = String(zone).trim() || null;
    if (aisle !== undefined) data.aisle = String(aisle).trim() || null;
    if (rack !== undefined) data.rack = String(rack).trim() || null;
    if (level !== undefined) data.level = String(level).trim() || null;

    const updated = await prisma.warehouseLocation.update({
      where: { id },
      data,
    });

    res.json(updated);
  } catch (err) {
    console.error("update location error:", err);
    if (err.code === "P2002") {
      return res.status(400).json({ message: "LOCATION_EXISTS" });
    }
    res.status(500).json({ message: "UPDATE_LOCATION_ERROR" });
  }
});


app.delete("/api/warehouse/locations/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный ID локации" });
    }
    const existing = await prisma.warehouseLocation.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: "Локация не найдена" });
    }
    await prisma.warehouseLocation.delete({ where: { id } });
    res.json({ message: "Локация удалена" });
  } catch (err) {
    console.error("delete location error:", err);
    res.status(500).json({ message: "Ошибка сервера при удалении локации" });
  }
});

// ===== КОДЫ: ТОВАРЫ =====
app.post("/api/warehouse/products/:id/codes", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { type, mode = "auto", value, force = false } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный ID товара" });
    }
    if (!["barcode", "qr", "both"].includes(type)) {
      return res.status(400).json({ message: "Неверный тип кода" });
    }

    const item = await prisma.item.findUnique({ where: { id } });
    if (item && item.category === "TMC") {
      return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    }
    if (!item) {
      return res.status(404).json({ message: "Товар не найден" });
    }

    const next = { barcode: item.barcode, qrCode: item.qrCode };
    const manualValue = value ? String(value).trim() : "";

    if ((type === "barcode" || type === "both") && next.barcode && !force) {
      return res.status(400).json({ message: "Штрихкод уже задан, используйте перевыпуск" });
    }
    if ((type === "qr" || type === "both") && next.qrCode && !force) {
      return res.status(400).json({ message: "QR уже задан, используйте перевыпуск" });
    }

    if (type === "barcode" || type === "both") {
      if (mode === "manual") {
        if (!manualValue) return res.status(400).json({ message: "Укажите значение кода" });
        next.barcode = manualValue;
      } else {
        next.barcode = buildProductCode(item);
      }
    }

    if (type === "qr" || type === "both") {
      if (mode === "manual") {
        if (!manualValue) return res.status(400).json({ message: "Укажите значение кода" });
        next.qrCode = manualValue;
      } else {
        const base = next.barcode || buildProductCode(item);
        next.qrCode = `BP:PRODUCT:${base}`;
      }
    }

    await ensureUniqueItemCodes({ barcode: next.barcode, qrCode: next.qrCode }, id);

    const updated = await prisma.item.update({
      where: { id },
      data: { barcode: next.barcode, qrCode: next.qrCode },
    });

    res.json({ productId: id, barcode: updated.barcode, qrCode: updated.qrCode });
  } catch (err) {
    console.error("product codes error:", err);
    res.status(400).json({ message: err.message || "Ошибка генерации кода" });
  }
});

// ===== КОДЫ: ЛОКАЦИИ =====
app.post("/api/warehouse/locations/:id/codes", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { type, mode = "auto", value, force = false } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный ID локации" });
    }
    if (!["barcode", "qr", "both"].includes(type)) {
      return res.status(400).json({ message: "Неверный тип кода" });
    }

    const location = await prisma.warehouseLocation.findUnique({ where: { id } });
    if (!location) {
      return res.status(404).json({ message: "Локация не найдена" });
    }

    const next = { code: location.code, qrCode: location.qrCode };
    const manualValue = value ? String(value).trim() : "";

    if ((type === "barcode" || type === "both") && next.code && !force) {
      return res.status(400).json({ message: "Код уже задан, используйте перевыпуск" });
    }
    if ((type === "qr" || type === "both") && next.qrCode && !force) {
      return res.status(400).json({ message: "QR уже задан, используйте перевыпуск" });
    }

    if (type === "barcode" || type === "both") {
      if (mode === "manual") {
        if (!manualValue) return res.status(400).json({ message: "Укажите значение кода" });
        next.code = manualValue;
      } else {
        next.code = buildLocationCode(location);
      }
    }

    if (type === "qr" || type === "both") {
      if (mode === "manual") {
        if (!manualValue) return res.status(400).json({ message: "Укажите значение кода" });
        next.qrCode = manualValue;
      } else {
        const base = next.code || buildLocationCode(location);
        next.qrCode = `BP:LOCATION:${base}`;
      }
    }

    await ensureUniqueLocationCodes({ code: next.code, qrCode: next.qrCode }, id);

    const updated = await prisma.warehouseLocation.update({
      where: { id },
      data: { code: next.code, qrCode: next.qrCode },
    });

    res.json({ locationId: id, code: updated.code, qrCode: updated.qrCode });
  } catch (err) {
    console.error("location codes error:", err);
    res.status(400).json({ message: err.message || "Ошибка генерации кода" });
  }
});

// ===== QR: ТОВАРЫ =====
app.post("/api/warehouse/products/:id/qr", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { force = false } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный ID товара" });
    }
    const item = await prisma.item.findUnique({ where: { id } });
    if (item && item.category === "TMC") {
      return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    }
    if (!item) {
      return res.status(404).json({ message: "Товар не найден" });
    }
    if (item.qrCode && !force) {
      return res.status(400).json({ message: "QR уже задан, используйте перевыпуск" });
    }
    const qrCode = `BP:PRODUCT:${item.id}`;
    await ensureUniqueItemCodes({ qrCode }, id);
    const updated = await prisma.item.update({
      where: { id },
      data: { qrCode },
    });
    res.json({ id: updated.id, qrCode: updated.qrCode });
  } catch (err) {
    console.error("product qr error:", err);
    res.status(400).json({ message: err.message || "Ошибка генерации QR" });
  }
});

// ===== QR: ЛОКАЦИИ =====
app.post("/api/warehouse/locations/:id/qr", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { force = false } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный ID локации" });
    }
    const location = await prisma.warehouseLocation.findUnique({ where: { id } });
    if (!location) {
      return res.status(404).json({ message: "Локация не найдена" });
    }
    if (location.qrCode && !force) {
      return res.json({ id: location.id, qrCode: location.qrCode });
    }
    const qrCode = `BP:LOC:${location.id}`;
    await ensureUniqueLocationCodes({ qrCode }, id);
    const updated = await prisma.warehouseLocation.update({
      where: { id },
      data: { qrCode },
    });
    res.json({ id: updated.id, qrCode: updated.qrCode });
  } catch (err) {
    console.error("location qr error:", err);
    res.status(400).json({ message: err.message || "Ошибка генерации QR" });
  }
});

// ===== РЕЗОЛВ СКАНА =====
app.get("/api/warehouse/scan/resolve", auth, async (req, res) => {
  try {
    const raw = String(req.query.code || "").trim();
    if (!raw) {
      return res.status(400).json({ message: "CODE_REQUIRED" });
    }
    const rawId = Number(raw);
    const hasRawId = Number.isFinite(rawId) && rawId > 0;
    const rawNormalized = normalizeLocationLookupToken(raw);

    const isLoc = raw.startsWith("BP:LOC:") || raw.startsWith("BP:LOCATION:");
    const isItem =
      raw.startsWith("BP:ITEM:") ||
      raw.startsWith("BP:SKU:") ||
      raw.startsWith("BP:PRODUCT:");

    if (isLoc) {
      const payload = raw.replace(/^BP:(LOC|LOCATION):/, "");
      const id = Number(payload);
      const hasId = Number.isFinite(id) && id > 0;
      const payloadNormalized = normalizeLocationLookupToken(payload);
      const location = await prisma.warehouseLocation.findFirst({
        where: {
          OR: [
            { qrCode: raw },
            ...(hasId ? [{ id }] : []),
            { code: payload },
            { name: payload },
          ],
        },
      });
      if (location) {
        return res.json({
          type: "location",
          entity: {
            id: location.id,
            name: location.name,
            code: location.code,
            qrCode: location.qrCode,
          },
        });
      }

      if (payloadNormalized) {
        const candidates = await prisma.warehouseLocation.findMany({
          where: {
            OR: [{ code: { not: null } }, { name: { not: null } }, { qrCode: { not: null } }],
          },
          take: 500,
        });
        const normalizedMatch = candidates.find((entry) => {
          const codeToken = normalizeLocationLookupToken(entry.code);
          const nameToken = normalizeLocationLookupToken(entry.name);
          const qrToken = normalizeLocationLookupToken(entry.qrCode);
          return (
            (codeToken && codeToken === payloadNormalized) ||
            (nameToken && nameToken === payloadNormalized) ||
            (qrToken && qrToken === payloadNormalized)
          );
        });
        if (normalizedMatch) {
          return res.json({
            type: "location",
            entity: {
              id: normalizedMatch.id,
              name: normalizedMatch.name,
              code: normalizedMatch.code,
              qrCode: normalizedMatch.qrCode,
            },
          });
        }
      }

      return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
    }

    if (isItem) {
      const payload = raw.replace(/^BP:(ITEM|SKU|PRODUCT):/, "");
      const id = Number(payload);
      const hasId =
        (raw.startsWith("BP:ITEM:") || raw.startsWith("BP:PRODUCT:")) &&
        Number.isFinite(id) &&
        id > 0;
      const item = await prisma.item.findFirst({
        where: {
          OR: [
            { qrCode: raw },
            ...(hasId ? [{ id }] : []),
            { sku: payload },
            { barcode: payload },
          ],
        },
      });
      if (!item) {
        return res.status(404).json({ message: "ITEM_NOT_FOUND" });
      }
      return res.json({
        type: "item",
        entity: {
          id: item.id,
          name: item.name,
          sku: item.sku,
          barcode: item.barcode,
          qrCode: item.qrCode,
        },
      });
    }

    const item = await prisma.item.findFirst({
      where: { OR: [{ barcode: raw }, { sku: raw }] },
    });
    if (item) {
      return res.json({
        type: "item",
        entity: {
          id: item.id,
          name: item.name,
          sku: item.sku,
          barcode: item.barcode,
          qrCode: item.qrCode,
        },
      });
    }

    const location = await prisma.warehouseLocation.findFirst({
      where: {
        OR: [
          ...(hasRawId ? [{ id: rawId }] : []),
          { code: raw },
          { qrCode: raw },
          { name: raw },
          { code: { contains: raw } },
          { name: { contains: raw } },
        ],
      },
    });

    if (!location && rawNormalized) {
      const candidates = await prisma.warehouseLocation.findMany({
        where: {
          OR: [{ code: { not: null } }, { name: { not: null } }, { qrCode: { not: null } }],
        },
        take: 500,
      });
      const normalizedMatch = candidates.find((entry) => {
        const codeToken = normalizeLocationLookupToken(entry.code);
        const nameToken = normalizeLocationLookupToken(entry.name);
        const qrToken = normalizeLocationLookupToken(entry.qrCode);
        return (
          (codeToken && (codeToken === rawNormalized || codeToken.includes(rawNormalized))) ||
          (nameToken && (nameToken === rawNormalized || nameToken.includes(rawNormalized))) ||
          (qrToken && qrToken === rawNormalized)
        );
      });
      if (normalizedMatch) {
        return res.json({
          type: "location",
          entity: {
            id: normalizedMatch.id,
            name: normalizedMatch.name,
            code: normalizedMatch.code,
            qrCode: normalizedMatch.qrCode,
          },
        });
      }
    }
    if (location) {
      return res.json({
        type: "location",
        entity: {
          id: location.id,
          name: location.name,
          code: location.code,
          qrCode: location.qrCode,
        },
      });
    }

    return res.status(404).json({ message: "CODE_NOT_FOUND" });
  } catch (err) {
    console.error("scan resolve error:", err);
    res.status(500).json({ message: "SCAN_RESOLVE_ERROR" });
  }
});

// ===== BIN AUDIT: SESSIONS =====
app.post("/api/warehouse/bin-audit/session/start", auth, async (req, res) => {
  try {
    const session = await prisma.binAuditSession.create({
      data: {
        startedByUserId: req.user?.id || null,
        status: "ACTIVE",
      },
    });
    res.json({ sessionId: session.id });
  } catch (err) {
    console.error("bin audit session start error:", err);
    res.status(500).json({ message: "BIN_AUDIT_SESSION_START_ERROR" });
  }
});

app.post("/api/warehouse/bin-audit/session/:id/finish", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_SESSION_ID" });
    }
    await prisma.binAuditSession.update({
      where: { id },
      data: { status: "FINISHED", finishedAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("bin audit session finish error:", err);
    res.status(500).json({ message: "BIN_AUDIT_SESSION_FINISH_ERROR" });
  }
});

// ===== BIN AUDIT: EXPECTED STOCK =====
app.get(
  "/api/warehouse/bin-audit/location/:locationId/expected",
  auth,
  async (req, res) => {
    try {
      const locationId = Number(req.params.locationId);
      if (!locationId || Number.isNaN(locationId)) {
        return res.status(400).json({ message: "BAD_LOCATION_ID" });
      }

      const location = await prisma.warehouseLocation.findUnique({
        where: { id: locationId },
      });
      if (!location) {
        return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
      }

      const items = await stockService.getLocationStock(locationId);
      res.json({
        location: {
          id: location.id,
          name: location.name,
          code: location.code,
          qrCode: location.qrCode,
        },
        items: items.map((row) => ({
          item: row.item,
          expectedQty: row.qty,
        })),
      });
    } catch (err) {
      console.error("bin audit expected error:", err);
      res.status(500).json({ message: "BIN_AUDIT_EXPECTED_ERROR" });
    }
  }
);

// ===== BIN AUDIT: CONFIRM OK =====
app.post(
  "/api/warehouse/bin-audit/location/:locationId/confirm-ok",
  auth,
  async (req, res) => {
    try {
      const locationId = Number(req.params.locationId);
      const { sessionId, note } = req.body || {};
      const session = Number(sessionId);
      if (!locationId || Number.isNaN(locationId) || !session) {
        return res.status(400).json({ message: "BAD_REQUEST" });
      }

      const [location, sessionRow] = await Promise.all([
        prisma.warehouseLocation.findUnique({ where: { id: locationId } }),
        prisma.binAuditSession.findUnique({ where: { id: session } }),
      ]);
      if (!location) {
        return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
      }
      if (!sessionRow) {
        return res.status(404).json({ message: "SESSION_NOT_FOUND" });
      }

      await prisma.binAuditEvent.create({
        data: {
          sessionId: session,
          locationId,
          result: "OK",
          note: note || null,
        },
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("bin audit confirm ok error:", err);
      res.status(500).json({ message: "BIN_AUDIT_CONFIRM_OK_ERROR" });
    }
  }
);

// ===== BIN AUDIT: REPORT DISCREPANCY =====
app.post(
  "/api/warehouse/bin-audit/location/:locationId/report-discrepancy",
  auth,
  async (req, res) => {
    try {
      const locationId = Number(req.params.locationId);
      const { sessionId, lines = [], note } = req.body || {};
      const session = Number(sessionId);
      if (!locationId || Number.isNaN(locationId) || !session) {
        return res.status(400).json({ message: "BAD_REQUEST" });
      }
      if (!Array.isArray(lines)) {
        return res.status(400).json({ message: "BAD_LINES" });
      }

      const [location, sessionRow] = await Promise.all([
        prisma.warehouseLocation.findUnique({ where: { id: locationId } }),
        prisma.binAuditSession.findUnique({ where: { id: session } }),
      ]);
      if (!location) {
        return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
      }
      if (!sessionRow) {
        return res.status(404).json({ message: "SESSION_NOT_FOUND" });
      }

      const createdDiscrepancies = [];
      let adjustedCount = 0;

      await prisma.$transaction(async (tx) => {
        for (const line of lines) {
          const itemId = Number(line.itemId);
          const countedQty = Number(line.countedQty);
          if (!itemId || Number.isNaN(countedQty) || countedQty < 0) {
            continue;
          }

          const item = await tx.item.findUnique({ where: { id: itemId } });
          if (!item) continue;

          const expectedQty = await stockService.getItemLocationQty(
            tx,
            itemId,
            locationId
          );
          const delta = Math.trunc(countedQty) - Math.trunc(expectedQty);
          if (delta === 0) continue;

          const opId = `audit:${session}:${locationId}:${itemId}`;
          const existing = await tx.stockDiscrepancy.findFirst({
            where: { movementOpId: opId },
          });
          if (!existing) {
            const created = await tx.stockDiscrepancy.create({
              data: {
                sessionId: session,
                locationId,
                itemId,
                expectedQty: Math.trunc(expectedQty),
                countedQty: Math.trunc(countedQty),
                delta: Math.trunc(delta),
                status: "OPEN",
                movementOpId: opId,
              },
            });
            createdDiscrepancies.push(created.id);
            adjustedCount += 1;
          }
        }

        await tx.binAuditEvent.create({
          data: {
            sessionId: session,
            locationId,
            result: "DISCREPANCY",
            note: note || null,
          },
        });
      });

      res.json({ createdDiscrepancies, adjustedCount });
    } catch (err) {
      console.error("bin audit discrepancy error:", err);
      res.status(500).json({ message: "BIN_AUDIT_DISCREPANCY_ERROR" });
    }
  }
);

// ===== DISCREPANCIES LIST =====
app.get("/api/warehouse/discrepancies", auth, async (req, res) => {
  try {
    const status = String(req.query.status || "open").toUpperCase();
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    const locationId = req.query.locationId
      ? Number(req.query.locationId)
      : null;
    const itemId = req.query.itemId ? Number(req.query.itemId) : null;

    const where = {
      status: status === "CLOSED" ? "CLOSED" : "OPEN",
      ...(locationId ? { locationId } : {}),
      ...(itemId ? { itemId } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const items = await prisma.stockDiscrepancy.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { location: true, item: true, session: true },
    });

    const itemsWithMovements = await Promise.all(
      items.map(async (row) => {
        const movements = await prisma.stockMovement.findMany({
          where: {
            itemId: row.itemId,
            locationId: row.locationId,
            type: "ISSUE",
          },
          orderBy: { createdAt: "desc" },
          take: 5,
          include: { createdBy: true },
        });

        return {
          id: row.id,
          status: row.status,
          createdAt: row.createdAt,
          closedAt: row.closedAt,
          expectedQty: row.expectedQty,
          countedQty: row.countedQty,
          delta: row.delta,
          location: {
            id: row.location.id,
            code: row.location.code,
            name: row.location.name,
          },
          item: {
            id: row.item.id,
            name: row.item.name,
            sku: row.item.sku,
            barcode: row.item.barcode,
          },
          sessionId: row.sessionId,
          closeNote: row.closeNote,
          recentPickers: movements.map((m) => ({
            id: m.id,
            createdAt: m.createdAt,
            qty: m.quantity,
            opId: m.opId,
            user: m.createdBy
              ? { id: m.createdBy.id, name: m.createdBy.name }
              : null,
          })),
        };
      })
    );

    res.json({ items: itemsWithMovements });
  } catch (err) {
    console.error("discrepancies list error:", err);
    res.status(500).json({ message: "DISCREPANCIES_LIST_ERROR" });
  }
});

// ===== TRANSACTIONS =====
app.get("/api/warehouse/transactions", auth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Number(req.query.limit) || 300, 1000);

    const [movements, audits, discrepancies] = await Promise.all([
      prisma.stockMovement.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { item: true, createdBy: true },
      }),
      prisma.binAuditEvent.findMany({
        orderBy: { checkedAt: "desc" },
        take: limit,
        include: { location: true, session: { include: { startedBy: true } } },
      }),
      prisma.stockDiscrepancy.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          item: true,
          location: true,
          session: { include: { startedBy: true } },
        },
      }),
    ]);

    let movementItems = movements.map((m) => {
      const qty = m.type === "ISSUE" ? -Number(m.quantity) : Number(m.quantity);
      return {
        id: `mov-${m.id}`,
        type: m.type,
        createdAt: m.createdAt,
        item: m.item
          ? {
              id: m.item.id,
              name: m.item.name,
              sku: m.item.sku,
              barcode: m.item.barcode,
            }
          : null,
        location: m.locationId
          ? { id: m.locationId, name: String(m.locationId), code: null }
          : null,
        qty: Number.isFinite(qty) ? qty : null,
        user: m.createdBy ? { id: m.createdBy.id, name: m.createdBy.name } : null,
        comment: m.comment || null,
      };
    });

    const locationIds = Array.from(
      new Set(movements.map((m) => m.locationId).filter(Boolean))
    );
    if (locationIds.length) {
      const locs = await prisma.warehouseLocation.findMany({
        where: { id: { in: locationIds } },
      });
      const map = new Map(locs.map((l) => [l.id, l]));
      movementItems = movementItems.map((row) => {
        if (!row.location) return row;
        const loc = map.get(row.location.id);
        if (!loc) return row;
        return {
          ...row,
          location: { id: loc.id, name: loc.name, code: loc.code },
        };
      });
    }

    const auditItems = audits
      .filter((a) => a.result === "OK")
      .map((a) => ({
        id: `audit-${a.id}`,
        type: "BIN_AUDIT",
        result: a.result,
        createdAt: a.checkedAt,
        item: null,
        location: a.location
          ? { id: a.location.id, name: a.location.name, code: a.location.code }
          : null,
        qty: null,
        user: a.session?.startedBy
          ? { id: a.session.startedBy.id, name: a.session.startedBy.name }
          : null,
        comment: a.note || null,
      }));

    const discrepancyItems = discrepancies.map((d) => ({
      id: `disc-${d.id}`,
      type: "BIN_AUDIT",
      result: "DISCREPANCY",
      createdAt: d.createdAt,
      item: d.item
        ? {
            id: d.item.id,
            name: d.item.name,
            sku: d.item.sku,
            barcode: d.item.barcode,
          }
        : null,
      location: d.location
        ? { id: d.location.id, name: d.location.name, code: d.location.code }
        : null,
      qty: Number.isFinite(d.delta) ? d.delta : null,
      user: d.session?.startedBy
        ? { id: d.session.startedBy.id, name: d.session.startedBy.name }
        : null,
      comment: d.closeNote || null,
    }));

    let combined = [...movementItems, ...auditItems, ...discrepancyItems]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    if (q) {
      const qLower = q.toLowerCase();
      combined = combined.filter((row) => {
        const item = row.item || {};
        const loc = row.location || {};
        return (
          (item.name || "").toLowerCase().includes(qLower) ||
          (item.sku || "").toLowerCase().includes(qLower) ||
          (item.barcode || "").toLowerCase().includes(qLower) ||
          (loc.name || "").toLowerCase().includes(qLower) ||
          (loc.code || "").toLowerCase().includes(qLower) ||
          (row.comment || "").toLowerCase().includes(qLower)
        );
      });
    }

    res.json({ items: combined });
  } catch (err) {
    console.error("transactions list error:", err);
    res.status(500).json({ message: "TRANSACTIONS_LIST_ERROR", detail: String(err) });
  }
});

// ===== STOCK REVISIONS =====
app.get("/api/warehouse/revisions", auth, async (req, res) => {
  try {
    const revisions = await prisma.stockRevision.findMany({
      orderBy: { createdAt: "desc" },
      include: { createdBy: true, _count: { select: { items: true } } },
    });

    const grouped = await prisma.stockRevisionItem.groupBy({
      by: ["revisionId", "status"],
      _count: { _all: true },
    });

    const countMap = new Map();
    for (const row of grouped) {
      const key = `${row.revisionId}:${row.status}`;
      countMap.set(key, row._count._all || 0);
    }

    const items = revisions.map((rev) => {
      const applied = countMap.get(`${rev.id}:APPLIED`) || 0;
      const open = countMap.get(`${rev.id}:OPEN`) || 0;
      const skipped = countMap.get(`${rev.id}:SKIPPED`) || 0;
      return {
        id: rev.id,
        createdAt: rev.createdAt,
        createdBy: rev.createdBy
          ? { id: rev.createdBy.id, name: rev.createdBy.name }
          : null,
        itemsCount: rev._count?.items || 0,
        appliedCount: applied,
        openCount: open,
        skippedCount: skipped,
      };
    });

    res.json({ items });
  } catch (err) {
    console.error("revisions list error:", err);
    res.status(500).json({ message: "REVISIONS_LIST_ERROR" });
  }
});

app.get("/api/warehouse/revisions/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_REVISION_ID" });
    }
    const revision = await prisma.stockRevision.findUnique({
      where: { id },
      include: {
        createdBy: true,
        items: {
          orderBy: { id: "desc" },
          include: {
            item: true,
            location: true,
            discrepancy: {
              include: { session: { include: { startedBy: true } } },
            },
          },
        },
      },
    });
    if (!revision) {
      return res.status(404).json({ message: "REVISION_NOT_FOUND" });
    }

    const items = revision.items.map((row) => ({
      id: row.id,
      status: row.status,
      expectedQty: row.expectedQty,
      countedQty: row.countedQty,
      delta: row.delta,
      discrepancyId: row.discrepancyId,
      createdAt: row.discrepancy?.createdAt || null,
      checkedBy: row.discrepancy?.session?.startedBy
        ? {
            id: row.discrepancy.session.startedBy.id,
            name: row.discrepancy.session.startedBy.name,
          }
        : null,
      item: row.item
        ? { id: row.item.id, name: row.item.name, sku: row.item.sku }
        : null,
      location: row.location
        ? { id: row.location.id, name: row.location.name, code: row.location.code }
        : null,
    }));

    res.json({
      id: revision.id,
      createdAt: revision.createdAt,
      createdBy: revision.createdBy
        ? { id: revision.createdBy.id, name: revision.createdBy.name }
        : null,
      items,
    });
  } catch (err) {
    console.error("revision detail error:", err);
    res.status(500).json({ message: "REVISION_DETAIL_ERROR" });
  }
});

app.post("/api/warehouse/revisions", auth, requireAdmin, async (req, res) => {
  try {
    const discrepancies = await prisma.stockDiscrepancy.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
    });

    const revision = await prisma.stockRevision.create({
      data: { createdByUserId: req.user?.id || null },
    });

    if (discrepancies.length) {
      await prisma.stockRevisionItem.createMany({
        data: discrepancies.map((row) => ({
          revisionId: revision.id,
          discrepancyId: row.id,
          locationId: row.locationId,
          itemId: row.itemId,
          expectedQty: row.expectedQty,
          countedQty: row.countedQty,
          delta: row.delta,
          status: "OPEN",
        })),
      });
    }

    res.json({ id: revision.id, itemsCount: discrepancies.length });
  } catch (err) {
    console.error("revision create error:", err);
    res.status(500).json({ message: "REVISION_CREATE_ERROR" });
  }
});

app.post("/api/warehouse/revisions/:id/apply", auth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_REVISION_ID" });
    }
    const { itemIds, applyAll } = req.body || {};
    if (!applyAll && (!Array.isArray(itemIds) || itemIds.length === 0)) {
      return res.status(400).json({ message: "BAD_ITEMS" });
    }

    const targetIds = applyAll
      ? undefined
      : itemIds.map((value) => Number(value)).filter((value) => value && !Number.isNaN(value));

    const items = await prisma.stockRevisionItem.findMany({
      where: {
        revisionId: id,
        ...(applyAll ? {} : { id: { in: targetIds } }),
      },
    });

    const appliedIds = [];

    await prisma.$transaction(async (tx) => {
      for (const row of items) {
        if (row.status !== "OPEN") continue;
        const delta = Number(row.delta);
        if (!Number.isFinite(delta) || delta === 0) {
          await tx.stockRevisionItem.update({
            where: { id: row.id },
            data: { status: "SKIPPED" },
          });
          continue;
        }

        const opId = `revision:${id}:${row.id}`;
        const movement = await stockService.createMovementInTx(tx, {
          opId,
          type: "ADJUSTMENT",
          itemId: row.itemId,
          qty: delta,
          locationId: row.locationId,
          comment: `REVISION ${id}`,
          userId: req.user?.id || null,
        });

        await tx.stockRevisionItem.update({
          where: { id: row.id },
          data: {
            status: "APPLIED",
            appliedAt: new Date(),
            appliedByUserId: req.user?.id || null,
            appliedMovementOpId: movement.opId || opId,
          },
        });

        if (row.discrepancyId) {
          await tx.stockDiscrepancy.update({
            where: { id: row.discrepancyId },
            data: {
              status: "CLOSED",
              closedAt: new Date(),
              closedByUserId: req.user?.id || null,
              closeNote: `REVISION ${id}`,
              movementOpId: movement.opId || opId,
            },
          });
        }

        appliedIds.push(row.id);
      }
    });

    res.json({ ok: true, appliedIds });
  } catch (err) {
    console.error("revision apply error:", err);
    res.status(500).json({ message: "REVISION_APPLY_ERROR" });
  }
});

// ===== TMC (SUPPLIES) =====
const TMC_DEFAULTS = [
  { name: "?????? ?4", unit: "?????" },
  { name: "????? ?????????", unit: "??" },
  { name: "?????? ????????????", unit: "??" },
  { name: "????? ??????????", unit: "?????" },
  { name: "??????-?????", unit: "?????" },
  { name: "???????? ???????", unit: "????" },
  { name: "????????", unit: "??" },
  { name: "????? ??? ??????", unit: "??" },
  { name: "????????", unit: "??" },
  { name: "??????? ?????", unit: "?????" },
  { name: "????????", unit: "?????" },
  { name: "??? ????????????", unit: "??" },
  { name: "????? ????????????", unit: "?????" },
  { name: "?????? ???", unit: "??" },
  { name: "????????????? ????????", unit: "??" },
];


const getTmcStockForItem = async (itemId) => {
  const movements = await prisma.stockMovement.findMany({
    where: { itemId },
    orderBy: { createdAt: "asc" },
  });
  let qty = 0;
  for (const m of movements) {
    if (m.type === "INCOME" || m.type === "ADJUSTMENT") {
      qty += Number(m.quantity);
    } else if (m.type === "ISSUE") {
      qty -= Number(m.quantity);
    }
  }
  return Math.round(qty);
};

app.get("/api/tmc/items", auth, async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      where: { category: "TMC" },
      orderBy: { name: "asc" },
    });
    res.json(items);
  } catch (err) {
    console.error("tmc items error:", err);
    res.status(500).json({ message: "TMC_ITEMS_ERROR" });
  }
});

app.get("/api/tmc/stock", auth, async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      where: { category: "TMC" },
      orderBy: { name: "asc" },
    });
    const result = [];
    for (const item of items) {
      const currentStock = await getTmcStockForItem(item.id);
      result.push({
        id: item.id,
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        unit: item.unit,
        currentStock,
      });
    }
    res.json(result);
  } catch (err) {
    console.error("tmc stock error:", err);
    res.status(500).json({ message: "TMC_STOCK_ERROR" });
  }
});

app.get("/api/tmc/transactions", auth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const items = await prisma.stockMovement.findMany({
      where: { item: { category: "TMC" } },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { item: true, createdBy: true },
    });
    const result = items.map((m) => ({
      id: m.id,
      type: m.type,
      createdAt: m.createdAt,
      qty: m.type === "ISSUE" ? -Number(m.quantity) : Number(m.quantity),
      comment: m.comment || null,
      item: m.item
        ? { id: m.item.id, name: m.item.name, sku: m.item.sku }
        : null,
      user: m.createdBy ? { id: m.createdBy.id, name: m.createdBy.name } : null,
    }));
    res.json({ items: result });
  } catch (err) {
    console.error("tmc transactions error:", err);
    res.status(500).json({ message: "TMC_TRANSACTIONS_ERROR" });
  }
});

app.post("/api/tmc/items", auth, requireAdmin, async (req, res) => {
  try {
    const { name, unit, sku, barcode } = req.body || {};
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ message: "BAD_NAME" });
    }
    const item = await prisma.item.create({
      data: {
        name: String(name).trim(),
        unit: unit ? String(unit).trim() : "??",
        sku: sku ? String(sku).trim() : null,
        barcode: barcode ? String(barcode).trim() : null,
        category: "TMC",
      },
    });
    res.json(item);
  } catch (err) {
    console.error("tmc item create error:", err);
    res.status(500).json({ message: "TMC_ITEM_CREATE_ERROR" });
  }
});

app.put("/api/tmc/items/:id", auth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, unit, sku, barcode } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_ITEM_ID" });
    }
    const existing = await prisma.item.findUnique({ where: { id } });
    if (!existing || existing.category !== "TMC") {
      return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    }
    const item = await prisma.item.update({
      where: { id },
      data: {
        name: name ? String(name).trim() : existing.name,
        unit: unit ? String(unit).trim() : existing.unit,
        sku: sku ? String(sku).trim() : existing.sku,
        barcode: barcode ? String(barcode).trim() : existing.barcode,
      },
    });
    res.json(item);
  } catch (err) {
    console.error("tmc item update error:", err);
    res.status(500).json({ message: "TMC_ITEM_UPDATE_ERROR" });
  }
});

app.post("/api/tmc/receive", auth, requireAdmin, async (req, res) => {
  try {
    const { itemId, qty, comment, docNo } = req.body || {};
    const item = Number(itemId);
    const amount = Number(qty);
    if (!item || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "BAD_REQUEST" });
    }
    const itemRow = await prisma.item.findUnique({ where: { id: item } });
    if (!itemRow || itemRow.category !== "TMC") {
      return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    }
    const note = docNo ? `?????? ???: ${docNo}` : "?????? ???";
    const movement = await stockService.createMovement({
      type: "INCOME",
      itemId: item,
      qty: Math.trunc(amount),
      locationId: null,
      comment: comment ? `${note}. ${comment}` : note,
      userId: req.user?.id || null,
    });
    res.json({ ok: true, id: movement.id });
  } catch (err) {
    console.error("tmc receive error:", err);
    res.status(500).json({ message: "TMC_RECEIVE_ERROR" });
  }
});

app.post("/api/tmc/issue", auth, async (req, res) => {
  try {
    const { itemId, qty, department, employee, comment } = req.body || {};
    const item = Number(itemId);
    const amount = Number(qty);
    if (!item || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "BAD_REQUEST" });
    }
    const itemRow = await prisma.item.findUnique({ where: { id: item } });
    if (!itemRow || itemRow.category !== "TMC") {
      return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    }

    const current = await getTmcStockForItem(itemRow.id);
    if (current < amount) {
      return res.status(400).json({ message: "INSUFFICIENT_QTY" });
    }

    const target = [department, employee].filter(Boolean).join(" / ");
    const note = target ? `?????? ???: ${target}` : "?????? ???";
    const movement = await stockService.createMovement({
      type: "ISSUE",
      itemId: item,
      qty: Math.trunc(amount),
      locationId: null,
      comment: comment ? `${note}. ${comment}` : note,
      userId: req.user?.id || null,
    });
    res.json({ ok: true, id: movement.id });
  } catch (err) {
    console.error("tmc issue error:", err);
    res.status(500).json({ message: "TMC_ISSUE_ERROR" });
  }
});

app.post("/api/tmc/seed-defaults", auth, requireAdmin, async (req, res) => {
  try {
    const existing = await prisma.item.findMany({
      where: { category: "TMC" },
      select: { id: true, name: true },
    });
    const bad = existing.filter((row) => (row.name || "").includes(String.fromCharCode(0xFFFD)) || (row.name || "").includes("?"));
    if (bad.length) {
      await prisma.item.deleteMany({
        where: { id: { in: bad.map((row) => row.id) } },
      });
    }

    const existingAfter = await prisma.item.findMany({
      where: { category: "TMC" },
      select: { name: true },
    });

    const exists = new Set(existingAfter.map((i) => i.name.toLowerCase()));
    const toCreate = TMC_DEFAULTS.filter((row) => !exists.has(row.name.toLowerCase()))
      .map((row) => ({
        name: row.name,
        unit: row.unit || "\u0448\u0442",
        category: "TMC",
      }));

    if (toCreate.length) {
      await prisma.item.createMany({ data: toCreate });
    }

    res.json({ added: toCreate.length });
  } catch (err) {
    console.error("tmc seed error:", err);
    res.status(500).json({ message: "TMC_SEED_ERROR" });
  }
});

// ===== DISCREPANCY CLOSE =====
app.put("/api/warehouse/discrepancies/:id/close", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { closeNote } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "???????????? ????????????? ???????????." });
    }

    const discrepancy = await prisma.stockDiscrepancy.findUnique({
      where: { id },
      include: { item: true, location: true },
    });
    if (!discrepancy) {
      return res.status(404).json({ message: "??????????? ?? ???????." });
    }

    if (discrepancy.status === "CLOSED") {
      return res.json({ ok: true, alreadyClosed: true });
    }

    if (!["ADMIN", "EMPLOYEE"].includes(req.user?.role)) {
      return res.status(403).json({ message: "???????????? ????." });
    }

    if (discrepancy.delta < 0 && req.user?.role !== "ADMIN") {
      return res
        .status(403)
        .json({ message: "?????? ????????????? ????? ??????????? ????????." });
    }

    await prisma.$transaction(async (tx) => {
      if (discrepancy.delta < 0) {
        if (!discrepancy.locationId) {
          const err = new Error("NO_LOCATION");
          err.code = "NO_LOCATION";
          throw err;
        }
        await stockService.createMovementInTx(tx, {
          opId: `DISC:${discrepancy.id}:ADJ`,
          type: "ADJUSTMENT",
          itemId: discrepancy.itemId,
          qty: Math.trunc(discrepancy.delta),
          locationId: discrepancy.locationId,
          comment: "?????????????? - (???????????? ???????????????)",
          userId: req.user?.id || null,
        });
      }

      await tx.stockDiscrepancy.update({
        where: { id: discrepancy.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedByUserId: req.user?.id || null,
          closeNote: closeNote || null,
        },
      });
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("discrepancy close error:", err);
    if (err.code === "NO_LOCATION") {
      return res.status(400).json({ message: "??? ??????????? ?? ??????? ??????." });
    }
    res.status(500).json({ message: "?? ??????? ??????? ???????????." });
  }
});

// ===== TSD: LOCATION STOCK =====
app.get("/api/warehouse/locations/:id/stock", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_LOCATION_ID" });
    }

    const location = await prisma.warehouseLocation.findUnique({ where: { id } });
    if (!location) {
      return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
    }

    const items = await stockService.getLocationStock(id);

    res.json({
      location: {
        id: location.id,
        name: location.name,
        code: location.code,
        qrCode: location.qrCode,
      },
      items,
    });
  } catch (err) {
    console.error("location stock error:", err);
    res.status(500).json({ message: "LOCATION_STOCK_ERROR" });
  }
});

// ===== TSD: INVENTORY COUNT (CREATE DISCREPANCY ONLY) =====
app.post("/api/warehouse/inventory/count", auth, async (req, res) => {
  try {
    const {
      opId,
      locationId,
      itemId,
      qty,
      comment,
      inventoryType,
      manufacturedAt,
      expiresAt,
      allowDifferentDate,
      qtyIsDelta,
    } = req.body || {};
    const location = Number(locationId);
    const item = Number(itemId);
    const amount = Number(qty);
    const mode = String(inventoryType || "AUTO").toUpperCase();
    const allowDiffDate = Boolean(allowDifferentDate);
    const isDelta = Boolean(qtyIsDelta);

    if (!location || !item || !Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ message: "BAD_REQUEST" });
    }

    const [itemRow, locationRow] = await Promise.all([
      prisma.item.findUnique({ where: { id: item } }),
      prisma.warehouseLocation.findUnique({ where: { id: location } }),
    ]);

    if (!itemRow) return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    if (!locationRow)
      return res.status(404).json({ message: "LOCATION_NOT_FOUND" });

    const normalizedQty = Math.trunc(amount);

    let delta = 0;
    let discrepancyId = null;
    let receivingLineId = null;

    await prisma.$transaction(async (tx) => {
      const current = await stockService.getItemLocationQty(tx, item, location);
      if (isDelta && mode === "PLUS") {
        delta = Math.trunc(amount);
      } else {
        delta = normalizedQty - current;
      }

      const locationStock = await stockService.getLocationStock(location);
      const nonZeroStock = (locationStock || []).filter((row) => row.qty > 0);
      const sameItemStock = nonZeroStock.find(
        (row) => row.item?.id === item
      );
      const effectiveMode =
        mode === "AUTO"
          ? delta > 0
            ? "PLUS"
            : delta < 0
              ? "MINUS"
              : "AUTO"
          : mode;

      if (effectiveMode === "MINUS" && !sameItemStock) {
        const err = new Error("COUNT_ITEM_NOT_IN_LOCATION");
        err.code = "COUNT_ITEM_NOT_IN_LOCATION";
        throw err;
      }
      if (effectiveMode === "PLUS" && !sameItemStock && nonZeroStock.length > 0) {
        const err = new Error("COUNT_CELL_NOT_EMPTY");
        err.code = "COUNT_CELL_NOT_EMPTY";
        throw err;
      }

      let manufactured = null;
      let expires = null;
      if (effectiveMode === "PLUS") {
        if (!manufacturedAt) {
          const err = new Error("MANUFACTURED_AT_REQUIRED");
          err.code = "MANUFACTURED_AT_REQUIRED";
          throw err;
        }
        manufactured = new Date(manufacturedAt);
        expires = expiresAt ? new Date(expiresAt) : manufactured;
        if (!manufactured || Number.isNaN(manufactured.getTime())) {
          const err = new Error("MANUFACTURED_AT_REQUIRED");
          err.code = "MANUFACTURED_AT_REQUIRED";
          throw err;
        }
        if (expires && Number.isNaN(expires.getTime())) {
          expires = manufactured;
        }
      }

      if (effectiveMode === "PLUS" && sameItemStock && manufactured) {
        const lastPlaced = await tx.warehouseReceivingLine.findFirst({
          where: {
            status: "PLACED",
            locationId: location,
            itemId: item,
          },
          orderBy: { createdAt: "desc" },
        });
        if (!lastPlaced && !allowDiffDate) {
          const err = new Error("COUNT_DATE_MISMATCH");
          err.code = "COUNT_DATE_MISMATCH";
          throw err;
        }
        if (lastPlaced) {
          const lastManufactured = lastPlaced.manufacturedAt;
          const lastExpires = lastPlaced.expiresAt;
          const mismatch =
            (lastManufactured &&
              new Date(lastManufactured).toISOString().slice(0, 10) !==
                manufactured.toISOString().slice(0, 10)) ||
            (lastExpires &&
              new Date(lastExpires).toISOString().slice(0, 10) !==
                (expires || manufactured).toISOString().slice(0, 10));
          if (mismatch && !allowDiffDate) {
            const err = new Error("COUNT_DATE_MISMATCH");
            err.code = "COUNT_DATE_MISMATCH";
            throw err;
          }
        }
      }

      if (mode === "PLUS" && delta < 0) {
        const err = new Error("COUNT_PLUS_ONLY");
        err.code = "COUNT_PLUS_ONLY";
        throw err;
      }
      if (mode === "MINUS" && delta > 0) {
        const err = new Error("COUNT_MINUS_ONLY");
        err.code = "COUNT_MINUS_ONLY";
        throw err;
      }

      if (delta !== 0) {
        const opKey = opId || `count:${location}:${item}:${Date.now()}`;
        const existing = await tx.stockDiscrepancy.findFirst({
          where: { movementOpId: opKey },
        });

        if (!existing) {
          const created = await tx.stockDiscrepancy.create({
            data: {
              sessionId: null,
              locationId: location,
              itemId: item,
              expectedQty: Math.trunc(current),
              countedQty: Math.trunc(normalizedQty),
              delta: Math.trunc(delta),
              status: "OPEN",
              movementOpId: opKey,
              closeNote: comment || null,
            },
          });
          discrepancyId = created.id;

          if (delta > 0) {
            const now = manufactured || new Date();
            const normalizedExpires = expires || now;
            const line = await tx.warehouseReceivingLine.create({
              data: {
                itemId: item,
                qty: Math.trunc(delta),
                remainingQty: Math.trunc(delta),
                manufacturedAt: now,
                expiresAt: normalizedExpires,
                status: "PENDING",
                sourceType: "INVENTORY_PLUS",
                discrepancyId: created.id,
                locationId: location,
                createdById: req.user?.id || null,
              },
            });
            receivingLineId = line.id;
          }
        } else {
          discrepancyId = existing.id;
          if (delta > 0) {
            const line = await tx.warehouseReceivingLine.findFirst({
              where: {
                discrepancyId: existing.id,
                status: "PENDING",
                remainingQty: { gt: 0 },
              },
              orderBy: { createdAt: "desc" },
            });
            receivingLineId = line?.id || null;
          }
        }
      }
    });

    res.json({
      locationId: location,
      itemId: item,
      qty: normalizedQty,
      delta,
      discrepancyId,
      receivingLineId,
    });
  } catch (err) {
    console.error("inventory count error:", err);
    if (err.code === "BAD_QTY") {
      return res.status(400).json({ message: "BAD_QTY" });
    }
    if (err.code === "COUNT_ITEM_NOT_IN_LOCATION") {
      return res.status(400).json({ message: "COUNT_ITEM_NOT_IN_LOCATION", code: "COUNT_ITEM_NOT_IN_LOCATION" });
    }
    if (err.code === "COUNT_CELL_NOT_EMPTY") {
      return res.status(400).json({ message: "COUNT_CELL_NOT_EMPTY", code: "COUNT_CELL_NOT_EMPTY" });
    }
    if (err.code === "COUNT_DATE_MISMATCH") {
      return res.status(400).json({ message: "COUNT_DATE_MISMATCH", code: "COUNT_DATE_MISMATCH" });
    }
    if (err.code === "MANUFACTURED_AT_REQUIRED") {
      return res.status(400).json({ message: "MANUFACTURED_AT_REQUIRED" });
    }
    if (err.code === "COUNT_PLUS_ONLY") {
      return res.status(400).json({ message: "COUNT_PLUS_ONLY", code: "COUNT_PLUS_ONLY" });
    }
    if (err.code === "COUNT_MINUS_ONLY") {
      return res.status(400).json({ message: "COUNT_MINUS_ONLY", code: "COUNT_MINUS_ONLY" });
    }
    res.status(500).json({ message: "?????? ??????????????. ????????? ???????." });
  }
});

// ===== TSD: RECEIVING =====
app.post("/api/warehouse/receiving", auth, async (req, res) => {
  try {
    const {
      opId,
      locationId: rawLocationId,
      itemId,
      qty,
      supplierName,
      docNo,
      comment,
      lines,
      defaultLocationId,
      manufacturedAt,
      expiresAt,
    } = req.body || {};
    const locationId = Number(rawLocationId ?? defaultLocationId);

    const hasLines = Array.isArray(lines) && lines.length > 0;
    if (
      (!hasLines && (!itemId || !Number.isFinite(Number(qty)) || Number(qty) <= 0))
    ) {
      return res.status(400).json({ message: "BAD_REQUEST" });
    }

    const commentParts = [
      "??????? (???)",
      locationId ? `??????=${locationId}` : "",
      supplierName ? `?????????=${String(supplierName).trim()}` : "",
      docNo ? `???=${String(docNo).trim()}` : "",
    ].filter(Boolean);
    const baseComment = commentParts.join(" ");

    const linesToPost = hasLines ? lines : [{ itemId, qty, manufacturedAt, expiresAt }];

    await prisma.$transaction(async (tx) => {
      const receivingLocationId = await getReceivingLocationId(tx);
      const effectiveLocationId = locationId || receivingLocationId;

      const location = await tx.warehouseLocation.findUnique({
        where: { id: effectiveLocationId },
      });
      if (!location) {
        const err = new Error("LOCATION_NOT_FOUND");
        err.code = "LOCATION_NOT_FOUND";
        throw err;
      }

      for (const line of linesToPost) {
        const lineItemId = Number(line.itemId);
        const amount = Number(line.qty);
        if (!lineItemId || !Number.isFinite(amount) || amount <= 0) continue;

        const manufactured = line.manufacturedAt ? new Date(line.manufacturedAt) : null;
        const expires = line.expiresAt ? new Date(line.expiresAt) : null;
        if (!manufactured || Number.isNaN(manufactured.getTime())) {
          const err = new Error("MANUFACTURED_AT_REQUIRED");
          err.code = "MANUFACTURED_AT_REQUIRED";
          throw err;
        }
        const normalizedExpires = expires && !Number.isNaN(expires.getTime())
          ? expires
          : manufactured;

        const itemRow = await tx.item.findUnique({ where: { id: lineItemId } });
        if (!itemRow) continue;

        const lineOpId = opId
          ? `${opId}:IN:${lineItemId}`
          : null;

        await stockService.createMovementInTx(tx, {
          opId: lineOpId,
          type: "INCOME",
          itemId: lineItemId,
          qty: Math.trunc(amount),
          locationId: effectiveLocationId,
          comment: comment || baseComment,
          userId: req.user?.id || null,
          refType: supplierName ? "SUPPLIER" : null,
          refId: docNo || null,
        });

        await tx.warehouseReceivingLine.create({
          data: {
            itemId: lineItemId,
            qty: Math.trunc(amount),
            remainingQty: Math.trunc(amount),
            manufacturedAt: manufactured,
            expiresAt: normalizedExpires,
            status: "PENDING",
            locationId: effectiveLocationId,
            createdById: req.user?.id || null,
          },
        });
      }
    });

    res.json({ ok: true, locationId: locationId || null, lines: linesToPost.length });
  } catch (err) {
    console.error("receiving error:", err);
    if (err.code === "MANUFACTURED_AT_REQUIRED") {
      return res.status(400).json({ message: "MANUFACTURED_AT_REQUIRED" });
    }
    if (err.code === "BAD_QTY") {
      return res.status(400).json({ message: "BAD_QTY" });
    }
    if (err.code === "LOCATION_NOT_FOUND") {
      return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
    }
    res.status(500).json({ message: "RECEIVING_ERROR" });
  }
});

// ===== TSD: MOVE =====
app.post("/api/warehouse/move", auth, async (req, res) => {
  try {
    const { opId, fromLocationId, toLocationId, itemId, qty, comment } =
      req.body || {};
    const from = Number(fromLocationId);
    const to = Number(toLocationId);
    const item = Number(itemId);
    const amount = Number(qty);

    if (!from || !to || !item || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "BAD_REQUEST" });
    }

    if (from === to) {
      return res.status(400).json({ message: "SAME_LOCATION" });
    }

    await prisma.$transaction(async (tx) => {
      const itemRow = await tx.item.findUnique({ where: { id: item } });
      const fromLoc = await tx.warehouseLocation.findUnique({ where: { id: from } });
      const toLoc = await tx.warehouseLocation.findUnique({ where: { id: to } });
      if (!itemRow) {
        const err = new Error("ITEM_NOT_FOUND");
        err.code = "ITEM_NOT_FOUND";
        throw err;
      }
      if (!fromLoc || !toLoc) {
        const err = new Error("LOCATION_NOT_FOUND");
        err.code = "LOCATION_NOT_FOUND";
        throw err;
      }

      const moveComment = comment || `??????????? (???) ${from} > ${to}`;

      await stockService.createMovementInTx(tx, {
        opId: opId ? `${opId}:OUT` : null,
        type: "ISSUE",
        itemId: item,
        qty: Math.trunc(amount),
        locationId: from,
        fromLocationId: from,
        toLocationId: to,
        comment: moveComment,
        userId: req.user?.id || null,
      });

      await stockService.createMovementInTx(tx, {
        opId: opId ? `${opId}:IN` : null,
        type: "INCOME",
        itemId: item,
        qty: Math.trunc(amount),
        locationId: to,
        fromLocationId: from,
        toLocationId: to,
        comment: moveComment,
        userId: req.user?.id || null,
      });
    });

    res.json({ ok: true, fromLocationId: from, toLocationId: to, itemId: item });
  } catch (err) {
    if (err.code === "INSUFFICIENT_QTY") {
      return res.status(400).json({ message: "INSUFFICIENT_QTY" });
    }
    if (err.code === "ITEM_NOT_FOUND") {
      return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    }
    if (err.code === "LOCATION_NOT_FOUND") {
      return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
    }
    console.error("move error:", err);
    res.status(500).json({ message: "MOVE_ERROR" });
  }
});

// ===== TSD: PUTAWAY =====
app.post("/api/warehouse/putaway", auth, async (req, res) => {
  try {
    const { opId, fromLocationId, toLocationId, itemId, qty, comment } =
      req.body || {};
    const from = Number(fromLocationId);
    const to = Number(toLocationId);
    const item = Number(itemId);
    const amount = Number(qty);

    if (!from || !to || !item || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "BAD_REQUEST" });
    }

    if (from === to) {
      return res.status(400).json({ message: "SAME_LOCATION" });
    }

    await prisma.$transaction(async (tx) => {
      const itemRow = await tx.item.findUnique({ where: { id: item } });
      const fromLoc = await tx.warehouseLocation.findUnique({ where: { id: from } });
      const toLoc = await tx.warehouseLocation.findUnique({ where: { id: to } });
      if (!itemRow) {
        const err = new Error("ITEM_NOT_FOUND");
        err.code = "ITEM_NOT_FOUND";
        throw err;
      }
      if (!fromLoc || !toLoc) {
        const err = new Error("LOCATION_NOT_FOUND");
        err.code = "LOCATION_NOT_FOUND";
        throw err;
      }

      const moveComment = comment || `?????????? (???) ${from} > ${to}`;

      await stockService.createMovementInTx(tx, {
        opId: opId ? `${opId}:OUT` : null,
        type: "ISSUE",
        itemId: item,
        qty: Math.trunc(amount),
        locationId: from,
        fromLocationId: from,
        toLocationId: to,
        comment: moveComment,
        userId: req.user?.id || null,
      });

      await stockService.createMovementInTx(tx, {
        opId: opId ? `${opId}:IN` : null,
        type: "INCOME",
        itemId: item,
        qty: Math.trunc(amount),
        locationId: to,
        fromLocationId: from,
        toLocationId: to,
        comment: moveComment,
        userId: req.user?.id || null,
      });
    });

    res.json({ ok: true, fromLocationId: from, toLocationId: to, itemId: item });
  } catch (err) {
    if (err.code === "INSUFFICIENT_QTY") {
      return res.status(400).json({ message: "INSUFFICIENT_QTY" });
    }
    if (err.code === "ITEM_NOT_FOUND") {
      return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    }
    if (err.code === "LOCATION_NOT_FOUND") {
      return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
    }
    console.error("putaway error:", err);
    res.status(500).json({ message: "PUTAWAY_ERROR" });
  }
});

// ===== TSD: PUTAWAY FROM RECEIVING =====
app.get("/api/warehouse/putaway/pending", auth, async (req, res) => {
  try {
    const items = await prisma.warehouseReceivingLine.findMany({
      where: {
        status: "PENDING",
        remainingQty: { gt: 0 },
      },
      orderBy: { createdAt: "desc" },
      include: {
        item: true,
        location: true,
        createdBy: true,
      },
    });
    res.json({
      items: items.map((row) => ({
        id: row.id,
        qty: row.qty,
        remainingQty: row.remainingQty,
        manufacturedAt: row.manufacturedAt,
        expiresAt: row.expiresAt,
        sourceType: row.sourceType,
        item: row.item,
        location: row.location,
      })),
    });
  } catch (err) {
    console.error("putaway pending error:", err);
    res.status(500).json({ message: "PUTAWAY_PENDING_ERROR" });
  }
});

app.post("/api/warehouse/putaway/from-receiving", auth, async (req, res) => {
  try {
    const { receiptId, receivingLineId, toLocationId, locationId, qty } =
      req.body || {};
    const receipt = Number(receiptId ?? receivingLineId);
    const to = Number(toLocationId ?? locationId);
    const amount = qty == null ? null : Number(qty);

    if (!receipt || !to) {
      return res.status(400).json({ message: "BAD_REQUEST" });
    }

    await prisma.$transaction(async (tx) => {
      const line = await tx.warehouseReceivingLine.findUnique({
        where: { id: receipt },
      });
      if (!line || line.status !== "PENDING" || line.remainingQty <= 0) {
        const err = new Error("RECEIVING_LINE_NOT_FOUND");
        err.code = "RECEIVING_LINE_NOT_FOUND";
        throw err;
      }

      const toLoc = await tx.warehouseLocation.findUnique({ where: { id: to } });
      if (!toLoc) {
        const err = new Error("LOCATION_NOT_FOUND");
        err.code = "LOCATION_NOT_FOUND";
        throw err;
      }

      const receivingLocationId =
        line.locationId || (await getReceivingLocationId(tx));
      const moveQty =
        amount && Number.isFinite(amount)
          ? Math.trunc(amount)
          : line.remainingQty;
      if (moveQty <= 0 || moveQty > line.remainingQty) {
        const err = new Error("BAD_QTY");
        err.code = "BAD_QTY";
        throw err;
      }

      const locationStock = await stockService.getLocationStock(to);
      const nonZeroStock = locationStock.filter((row) => row.qty > 0);
      const foreignStock = nonZeroStock.find(
        (row) => row.item?.id && row.item.id !== line.itemId
      );
      if (foreignStock) {
        const err = new Error("LOCATION_OCCUPIED");
        err.code = "LOCATION_OCCUPIED";
        err.details = {
          existingItemId: foreignStock.item?.id || null,
          existingManufacturedAt: null,
          existingExpiresAt: null,
        };
        throw err;
      }

      const existing = await tx.warehouseReceivingLine.findFirst({
        where: {
          status: "PLACED",
          locationId: to,
          itemId: line.itemId,
          remainingQty: { gt: 0 },
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        const sameDate =
          existing.manufacturedAt?.getTime?.() ===
            line.manufacturedAt?.getTime?.() &&
          existing.expiresAt?.getTime?.() === line.expiresAt?.getTime?.();
        if (!sameDate && !req.body?.allowMix) {
          const err = new Error("LOCATION_CONFLICT_CONFIRM");
          err.code = "LOCATION_CONFLICT_CONFIRM";
          err.details = {
            existingItemId: existing.itemId,
            existingManufacturedAt: existing.manufacturedAt,
            existingExpiresAt: existing.expiresAt,
          };
          throw err;
        }
      } else if (nonZeroStock.length > 0 && !req.body?.allowMix) {
        const err = new Error("LOCATION_CONFLICT_CONFIRM");
        err.code = "LOCATION_CONFLICT_CONFIRM";
        err.details = {
          existingItemId: nonZeroStock[0]?.item?.id || null,
          existingManufacturedAt: null,
          existingExpiresAt: null,
        };
        throw err;
      }

      const moveComment = `?????????? (???) ${receivingLocationId} > ${to}`;

      if (line.sourceType === "INVENTORY_PLUS") {
        await stockService.createMovementInTx(tx, {
          opId: null,
          type: "ADJUSTMENT",
          itemId: line.itemId,
          qty: moveQty,
          locationId: to,
          fromLocationId: null,
          toLocationId: to,
          comment: "?????????????? +",
          userId: req.user?.id || null,
        });
      } else {
        await stockService.createMovementInTx(tx, {
          opId: null,
          type: "ISSUE",
          itemId: line.itemId,
          qty: moveQty,
          locationId: receivingLocationId,
          fromLocationId: receivingLocationId,
          toLocationId: to,
          comment: moveComment,
          userId: req.user?.id || null,
        });

        await stockService.createMovementInTx(tx, {
          opId: null,
          type: "INCOME",
          itemId: line.itemId,
          qty: moveQty,
          locationId: to,
          fromLocationId: receivingLocationId,
          toLocationId: to,
          comment: moveComment,
          userId: req.user?.id || null,
        });
      }

      if (moveQty < line.remainingQty) {
        await tx.warehouseReceivingLine.update({
          where: { id: line.id },
          data: {
            remainingQty: line.remainingQty - moveQty,
          },
        });
        await tx.warehouseReceivingLine.create({
          data: {
            itemId: line.itemId,
            qty: moveQty,
            remainingQty: moveQty,
            manufacturedAt: line.manufacturedAt,
            expiresAt: line.expiresAt,
            status: "PLACED",
            sourceType: line.sourceType,
            discrepancyId: line.discrepancyId,
            locationId: to,
            createdById: line.createdById,
            placedAt: new Date(),
            placedById: req.user?.id || null,
          },
        });
      } else {
        await tx.warehouseReceivingLine.update({
          where: { id: line.id },
          data: {
            status: "PLACED",
            sourceType: line.sourceType,
            locationId: to,
            placedAt: new Date(),
            placedById: req.user?.id || null,
          },
        });
      }

      if (line.discrepancyId && moveQty === line.remainingQty) {
        await tx.stockDiscrepancy.update({
          where: { id: line.discrepancyId },
          data: {
            status: "CLOSED",
            closedAt: new Date(),
            closedByUserId: req.user?.id || null,
            closeNote: "INVENTORY_PLUS_PLACED",
          },
        });
      }
    });

    res.json({ ok: true });
  } catch (err) {
    if (err.code === "BAD_QTY") {
      return res.status(400).json({ message: "BAD_QTY" });
    }
    if (err.code === "LOCATION_OCCUPIED") {
      return res.status(409).json({
        message: "LOCATION_OCCUPIED",
        details: err.details || null,
      });
    }
    if (err.code === "LOCATION_CONFLICT_CONFIRM") {
      return res.status(409).json({
        message: "LOCATION_CONFLICT_CONFIRM",
        details: err.details || null,
      });
    }
    if (err.code === "LOCATION_NOT_FOUND") {
      return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
    }
    if (err.code === "RECEIVING_LINE_NOT_FOUND") {
      return res.status(404).json({ message: "RECEIVING_LINE_NOT_FOUND" });
    }
    console.error("putaway from receiving error:", err);
    res.status(500).json({ message: "PUTAWAY_FROM_RECEIVING_ERROR" });
  }
});

// ===== TSD: PICK =====
app.post("/api/warehouse/pick", auth, async (req, res) => {
  try {
    const { opId, fromLocationId, itemId, qty, refType, refId, comment } =
      req.body || {};
    const from = Number(fromLocationId);
    const item = Number(itemId);
    const amount = Number(qty);

    if (!from || !item || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "BAD_REQUEST" });
    }

    const itemRow = await prisma.item.findUnique({ where: { id: item } });
    const fromLoc = await prisma.warehouseLocation.findUnique({ where: { id: from } });
    if (!itemRow) return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    if (!fromLoc) return res.status(404).json({ message: "LOCATION_NOT_FOUND" });

    const pickComment = comment || `????? (???) ?? ${from}`;
    const movement = await prisma.$transaction(async (tx) => {
      const created = await stockService.createMovementInTx(tx, {
        opId: opId || null,
        type: "ISSUE",
        itemId: item,
        qty: Math.trunc(amount),
        locationId: from,
        fromLocationId: from,
        comment: pickComment,
        refType: refType || "PICK",
        refId: refId || null,
        userId: req.user?.id || null,
      });

      let remaining = Math.trunc(amount);
      const lots = await tx.warehouseReceivingLine.findMany({
        where: {
          status: "PLACED",
          itemId: item,
          locationId: from,
          remainingQty: { gt: 0 },
        },
        orderBy: [
          { expiresAt: "asc" },
          { manufacturedAt: "asc" },
          { createdAt: "asc" },
        ],
      });

      for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, lot.remainingQty);
        await tx.warehouseReceivingLine.update({
          where: { id: lot.id },
          data: { remainingQty: lot.remainingQty - take },
        });
        remaining -= take;
      }

      return created;
    });

    res.json({ ok: true, movementId: movement.id });
  } catch (err) {
    if (err.code === "INSUFFICIENT_QTY") {
      return res.status(400).json({ message: "INSUFFICIENT_QTY" });
    }
    if (err.code === "BAD_QTY") {
      return res.status(400).json({ message: "BAD_QTY" });
    }
    console.error("pick error:", err);
    res.status(500).json({ message: "PICK_ERROR" });
  }
});

// ===== TSD: REPLENISH (MVP) =====
app.get("/api/warehouse/replen/tasks", auth, async (req, res) => {
  res.json({ tasks: [] });
});

app.post("/api/warehouse/replen/execute", auth, async (req, res) => {
  try {
    const { opId, fromLocationId, toLocationId, itemId, qty, comment } =
      req.body || {};
    const from = Number(fromLocationId);
    const to = Number(toLocationId);
    const item = Number(itemId);
    const amount = Number(qty);

    if (!from || !to || !item || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "BAD_REQUEST" });
    }

    await prisma.$transaction(async (tx) => {
      const itemRow = await tx.item.findUnique({ where: { id: item } });
      const fromLoc = await tx.warehouseLocation.findUnique({ where: { id: from } });
      const toLoc = await tx.warehouseLocation.findUnique({ where: { id: to } });
      if (!itemRow) {
        const err = new Error("ITEM_NOT_FOUND");
        err.code = "ITEM_NOT_FOUND";
        throw err;
      }
      if (!fromLoc || !toLoc) {
        const err = new Error("LOCATION_NOT_FOUND");
        err.code = "LOCATION_NOT_FOUND";
        throw err;
      }

      const replComment = comment || `?????????? (???) ${from} > ${to}`;

      await stockService.createMovementInTx(tx, {
        opId: opId ? `${opId}:OUT` : null,
        type: "ISSUE",
        itemId: item,
        qty: Math.trunc(amount),
        locationId: from,
        fromLocationId: from,
        toLocationId: to,
        comment: replComment,
        userId: req.user?.id || null,
      });

      await stockService.createMovementInTx(tx, {
        opId: opId ? `${opId}:IN` : null,
        type: "INCOME",
        itemId: item,
        qty: Math.trunc(amount),
        locationId: to,
        fromLocationId: from,
        toLocationId: to,
        comment: replComment,
        userId: req.user?.id || null,
      });
    });

    res.json({ ok: true, fromLocationId: from, toLocationId: to, itemId: item });
  } catch (err) {
    if (err.code === "INSUFFICIENT_QTY") {
      return res.status(400).json({ message: "INSUFFICIENT_QTY" });
    }
    if (err.code === "ITEM_NOT_FOUND") {
      return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    }
    if (err.code === "LOCATION_NOT_FOUND") {
      return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
    }
    console.error("replenish error:", err);
    res.status(500).json({ message: "REPLENISH_ERROR" });
  }
});
// ===== TSD: PRINT LABELS =====
app.post("/api/warehouse/print/labels", auth, async (req, res) => {
  try {
    const { kind, ids, qtyPerId = 1, layout = "A4" } = req.body || {};
    if (!kind || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "BAD_REQUEST" });
    }

    if (!["item", "location"].includes(kind)) {
      return res.status(400).json({ message: "BAD_KIND" });
    }

    const count = Math.max(1, Number(qtyPerId || 1));
    const isLabel = String(layout).toLowerCase() === "label";

    const labels = [];

    for (const entry of ids) {
      const id = Number(entry);
      if (!id) continue;

      if (kind === "item") {
        const item = await prisma.item.findUnique({ where: { id } });
    if (item && item.category === "TMC") {
      return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    }
        if (!item) continue;
        labels.push({
          kind: "item",
          title: item.name,
          subtitle: item.sku
            ? `SKU: ${item.sku}`
            : item.barcode
              ? `BARCODE: ${item.barcode}`
              : "",
          qrValue: `BP:ITEM:${item.id}`,
        });
      } else {
        const location = await prisma.warehouseLocation.findUnique({ where: { id } });
        if (!location) continue;
        let qrValue = location.qrCode;
        if (!qrValue) {
          qrValue = `BP:LOC:${location.id}`;
          await ensureUniqueLocationCodes({ qrCode: qrValue }, location.id);
          await prisma.warehouseLocation.update({
            where: { id: location.id },
            data: { qrCode: qrValue },
          });
        }
        const meta = [location.code, location.zone, location.aisle, location.rack, location.level]
          .filter(Boolean)
          .join(" / ");
        labels.push({
          kind: "location",
          title: location.name || `LOCATION ${location.id}`,
          subtitle: meta,
          qrValue,
        });
      }
    }

    if (!labels.length) {
      return res.status(404).json({ message: "NOTHING_TO_PRINT" });
    }

    const rendered = [];
    for (const label of labels) {
      const qrBuf = await renderQrPng(label.qrValue);
      rendered.push({
        ...label,
        qrImg: `data:image/png;base64,${qrBuf.toString("base64")}`,
      });
    }

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Print Labels</title>
          <style>
            @page { size: ${isLabel ? "58mm 40mm" : "A4"}; margin: ${isLabel ? "0" : "10mm"}; }
            body { font-family: Arial, sans-serif; margin: 0; color: #0f172a; }
            .grid {
              display: grid;
              grid-template-columns: ${isLabel ? "repeat(3, 1fr)" : "1fr"};
              gap: ${isLabel ? "8px" : "12mm"};
              padding: ${isLabel ? "8px" : "0"};
              justify-items: ${isLabel ? "stretch" : "center"};
            }
            .label {
              border: 1px solid #e5e7eb;
              border-radius: ${isLabel ? "6px" : "12px"};
              padding: ${isLabel ? "8px" : "10mm"};
              display: grid;
              gap: ${isLabel ? "6px" : "8mm"};
              width: ${isLabel ? "auto" : "170mm"};
              min-height: ${isLabel ? "auto" : "90mm"};
            }
            .title { font-weight: 700; font-size: ${isLabel ? "12px" : "18px"}; line-height: 1.2; }
            .subtitle { font-size: ${isLabel ? "10px" : "13px"}; color: #475569; }
            .qr { width: ${isLabel ? "90px" : "60mm"}; height: ${isLabel ? "90px" : "60mm"}; }
            .code { font-size: ${isLabel ? "11px" : "14px"}; letter-spacing: 0.4px; text-align: center; }
            .label--location .qr { width: ${isLabel ? "110px" : "70mm"}; height: ${isLabel ? "110px" : "70mm"}; }
          </style>
        </head>
        <body>
          <div class="${isLabel ? "" : "grid"}">
            ${rendered
              .map((r) => {
                return Array.from({ length: count })
                  .map(
                    () => `
                <div class="label ${r.kind === "location" ? "label--location" : ""}">
                  <div class="title">${r.title}</div>
                  ${r.subtitle ? `<div class="subtitle">${r.subtitle}</div>` : ""}
                  <img class="qr" src="${r.qrImg}" />
                  <div class="code">${r.qrValue}</div>
                </div>
              `
                  )
                  .join("");
              })
              .join("")}
          </div>
          <script>
            (function () {
              const images = Array.from(document.images || []);
              const finish = () => setTimeout(() => window.print(), 200);
              if (!images.length) return finish();
              let pending = images.length;
              const done = () => {
                pending -= 1;
                if (pending <= 0) finish();
              };
              images.forEach((img) => {
                if (img.complete) {
                  done();
                } else {
                  img.addEventListener("load", done, { once: true });
                  img.addEventListener("error", done, { once: true });
                }
              });
            })();
          </script>
        </body>
      </html>
    `;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("print labels error:", err);
    res.status(500).json({ message: "PRINT_LABELS_ERROR" });
  }
});


// ===== РЕНДЕР QR =====
app.get("/api/warehouse/qr/render", async (req, res) => {
  try {
    const value = String(req.query.value || "").trim();
    if (!value) {
      return res.status(400).json({ message: "Неверные параметры" });
    }
    const buffer = await renderQrPng(value);
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  } catch (err) {
    console.error("render code error:", err);
    res.status(500).json({ message: "Ошибка генерации изображения" });
  }
});

// ===== ПЕЧАТЬ QR =====
app.post("/api/warehouse/qr/print", auth, async (req, res) => {
  try {
    const { kind, id, qty = 1, layout = "A4" } = req.body || {};
    if (!id || !["product", "location"].includes(kind)) {
      return res.status(400).json({ message: "Неверные параметры печати" });
    }
    const count = Math.max(1, Number(qty || 1));
    let title = "";
    let subtitle = "";
    let qrValue = "";
    if (kind === "product") {
      const item = await prisma.item.findUnique({ where: { id: Number(id) } });
      if (!item) return res.status(404).json({ message: "Товар не найден" });
      title = item.name;
      subtitle = item.sku ? `SKU: ${item.sku}` : "";
      qrValue = item.qrCode || `BP:PRODUCT:${item.id}`;
    } else {
      const location = await prisma.warehouseLocation.findUnique({ where: { id: Number(id) } });
      if (!location) return res.status(404).json({ message: "Локация не найдена" });
      title = `ЛОКАЦИЯ: ${location.name}`;
      subtitle = [location.zone, location.aisle, location.rack, location.level].filter(Boolean).join(" / ");
      qrValue = location.qrCode || `BP:LOCATION:${location.id}`;
    }

    const qrBuf = await renderQrPng(qrValue);
    const qrImg = `data:image/png;base64,${qrBuf.toString("base64")}`;
    const isLabel = String(layout).toLowerCase() === "label";

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>QR печать</title>
          <style>
            @page { size: ${isLabel ? "58mm 40mm" : "A4"}; margin: ${isLabel ? "0" : "8mm"}; }
            body { font-family: Arial, sans-serif; margin: 0; color: #0f172a; }
            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 8px; }
            .label { border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; display: grid; gap: 6px; }
            .title { font-weight: 700; font-size: 12px; line-height: 1.2; }
            .subtitle { font-size: 10px; color: #475569; }
            .qr { width: ${isLabel ? "90px" : "80px"}; height: ${isLabel ? "90px" : "80px"}; }
            .code { font-size: 11px; letter-spacing: 0.4px; text-align: center; }
            .label--location .qr { width: ${isLabel ? "110px" : "90px"}; height: ${isLabel ? "110px" : "90px"}; }
          </style>
        </head>
        <body>
          <div class="${isLabel ? "" : "grid"}">
            ${Array.from({ length: count })
              .map(
                () => `
              <div class="label ${kind === "location" ? "label--location" : ""}">
                <div class="title">${title}</div>
                ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ""}
                <img class="qr" src="${qrImg}" />
                <div class="code">${qrValue}</div>
              </div>
            `
              )
              .join("")}
          </div>
          <script>window.print();</script>
        </body>
      </html>
    `;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("qr print error:", err);
    res.status(500).json({ message: "Ошибка печати QR" });
  }
});

// ===== РАЗМЕЩЕНИЯ =====
app.post("/api/warehouse/placements", auth, async (req, res) => {
  try {
    const { itemId, locationId, qty } = req.body || {};
    const item = Number(itemId);
    const location = Number(locationId);
    const amount = Number(qty);
    if (!item || !location || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Неверные данные размещения" });
    }

    const existing = await prisma.warehousePlacement.findUnique({
      where: { itemId_locationId: { itemId: item, locationId: location } },
    });

    let updated;
    if (existing) {
      updated = await prisma.warehousePlacement.update({
        where: { itemId_locationId: { itemId: item, locationId: location } },
        data: { qty: existing.qty + Math.trunc(amount) },
      });
    } else {
      updated = await prisma.warehousePlacement.create({
        data: { itemId: item, locationId: location, qty: Math.trunc(amount) },
      });
    }
    res.json({ itemId: updated.itemId, locationId: updated.locationId, qty: updated.qty });
  } catch (err) {
    console.error("placements create error:", err);
    res.status(500).json({ message: "Ошибка сервера при размещении" });
  }
});

app.get("/api/warehouse/products/:id/placements", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный ID товара" });
    }
    const placements = await prisma.warehousePlacement.findMany({
      where: { itemId: id },
      include: { location: true },
      orderBy: { qty: "desc" },
    });
    res.json(
      placements.map((p) => ({
        id: p.id,
        qty: p.qty,
        location: {
          id: p.location.id,
          name: p.location.name,
          qrCode: p.location.qrCode,
          code: p.location.code,
        },
      }))
    );
  } catch (err) {
    console.error("placements list error:", err);
    res.status(500).json({ message: "Ошибка сервера при загрузке размещений" });
  }
});

app.put("/api/warehouse/placements/pick", auth, async (req, res) => {
  try {
    const { itemId, locationId, qty } = req.body || {};
    const item = Number(itemId);
    const location = Number(locationId);
    const amount = Number(qty);
    if (!item || !location || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Неверные данные отбора" });
    }

    const existing = await prisma.warehousePlacement.findUnique({
      where: { itemId_locationId: { itemId: item, locationId: location } },
    });
    if (!existing || existing.qty < amount) {
      return res.status(400).json({ message: "Недостаточно товара в локации" });
    }

    const nextQty = existing.qty - Math.trunc(amount);
    if (nextQty === 0) {
      await prisma.warehousePlacement.delete({
        where: { itemId_locationId: { itemId: item, locationId: location } },
      });
      return res.json({ itemId: item, locationId: location, qty: 0 });
    }

    const updated = await prisma.warehousePlacement.update({
      where: { itemId_locationId: { itemId: item, locationId: location } },
      data: { qty: nextQty },
    });

    res.json({ itemId: updated.itemId, locationId: updated.locationId, qty: updated.qty });
  } catch (err) {
    console.error("placements pick error:", err);
    res.status(500).json({ message: "Ошибка сервера при отборе" });
  }
});

// ===== ПЕЧАТЬ ЭТИКЕТОК =====
app.post("/api/warehouse/labels/print", auth, async (req, res) => {
  try {
    const { items = [], format = "A4", labelSize = "58x40" } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Список этикеток пуст" });
    }

    const labels = [];
    for (const entry of items) {
      const qty = Math.max(1, Number(entry.qty || 1));
      if (entry.kind === "product") {
        const item = await prisma.item.findUnique({ where: { id: Number(entry.id) } });
        if (!item) continue;
        const codeValue = item.barcode || item.sku || buildProductCode(item);
        const qrValue = `BP:ITEM:${item.id}`;
        for (let i = 0; i < qty; i += 1) {
          labels.push({
            title: item.name,
            sku: item.sku || "",
            code: codeValue,
            qr: qrValue,
            kind: "product",
          });
        }
      } else if (entry.kind === "location") {
        const location = await prisma.warehouseLocation.findUnique({ where: { id: Number(entry.id) } });
        if (!location) continue;
        const codeValue = location.code || buildLocationCode(location);
        let qrValue = location.qrCode;
        if (!qrValue) {
          qrValue = `BP:LOC:${location.id}`;
          await ensureUniqueLocationCodes({ qrCode: qrValue }, location.id);
          await prisma.warehouseLocation.update({
            where: { id: location.id },
            data: { qrCode: qrValue },
          });
        }
        const meta = [location.zone, location.aisle, location.rack, location.level].filter(Boolean).join(" / ");
        for (let i = 0; i < qty; i += 1) {
          labels.push({
            title: location.name,
            sku: "",
            code: codeValue,
            qr: qrValue,
            kind: "location",
            meta,
          });
        }
      }
    }

    const rows = [];
    for (const label of labels) {
      const barcodeValue = label.code || "";
      const qrValue = label.qr || "";
      let barcodeImg = "";
      let qrImg = "";
      if (barcodeValue) {
        const png = await renderBarcodePng(barcodeValue);
        barcodeImg = `data:image/png;base64,${png.toString("base64")}`;
      }
      if (qrValue) {
        const qrBuf = await renderQrPng(qrValue);
        qrImg = `data:image/png;base64,${qrBuf.toString("base64")}`;
      }
      rows.push({ ...label, barcodeImg, qrImg });
    }

    const labelSizes = {
      "58x40": { width: "58mm", height: "40mm" },
      "70x50": { width: "70mm", height: "50mm" },
    };
    const size = labelSizes[labelSize] || labelSizes["58x40"];
    const isLabel = String(format).toLowerCase() === "label";

    const pageRule = isLabel ? `@page { size: ${size.width} ${size.height}; margin: 0; }` : "@page { size: A4; margin: 8mm; }";
    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Этикетки</title>
          <style>
            ${pageRule}
            @media print {
              body { margin: 0; }
              .label { break-inside: avoid; page-break-inside: avoid; }
            }
            body { font-family: Arial, sans-serif; margin: 12px; color: #0f172a; }
            .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
            .label {
              border: 1px solid #e5e7eb;
              padding: 8px;
              border-radius: 6px;
              display: grid;
              gap: 6px;
            }
            .label--label {
              width: ${size.width};
              height: ${size.height};
              padding: 6px;
            }
            .label--location .content { display: grid; grid-template-columns: 1fr; gap: 6px; }
            .title {
              font-weight: 700;
              font-size: 12px;
              line-height: 1.2;
              max-height: 30px;
              overflow: hidden;
            }
            .sku { font-size: 11px; color: #475569; }
            .code { font-size: 11px; color: #0f172a; }
            .meta { font-size: 10px; color: #64748b; }
            .barcode { height: 36px; object-fit: contain; }
            .barcode-label { font-size: 10px; text-align: center; letter-spacing: 0.5px; }
            .qr { width: 70px; height: 70px; }
            .qr--big { width: 90px; height: 90px; }
            .content { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; }
            .print-date { font-size: 9px; color: #94a3b8; margin-top: 2px; }
          </style>
        </head>
        <body>
          <div class="${isLabel ? "" : "grid"}">
            ${rows
              .map((r) => {
                if (r.kind === "location") {
                  return `
                    <div class="label ${isLabel ? "label--label" : ""} label--location">
                      <div class="title">${r.title}</div>
                      ${r.meta ? `<div class="meta">${r.meta}</div>` : ""}
                      <div class="content">
                        ${r.qrImg ? `<img class="qr qr--big" src="${r.qrImg}" />` : ""}
                        ${r.code ? `<div class="barcode-label">${r.code}</div>` : ""}
                      </div>
                      <div class="print-date">Печать: ${new Date().toLocaleDateString("ru-RU")}</div>
                    </div>
                  `;
                }
                return `
                  <div class="label ${isLabel ? "label--label" : ""}">
                    <div class="title">${r.title}</div>
                    ${r.sku ? `<div class="sku">SKU: ${r.sku}</div>` : ""}
                    <div class="content">
                      <div>
                        ${r.barcodeImg ? `<img class="barcode" src="${r.barcodeImg}" />` : ""}
                        ${r.code ? `<div class="barcode-label">${r.code}</div>` : ""}
                      </div>
                      ${r.qrImg ? `<img class="qr" src="${r.qrImg}" />` : ""}
                    </div>
                    <div class="print-date">Печать: ${new Date().toLocaleDateString("ru-RU")}</div>
                  </div>
                `;
              })
              .join("")}
          </div>
          <script>window.print();</script>
        </body>
      </html>
    `;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("labels print error:", err);
    res.status(500).json({ message: "Ошибка генерации этикеток" });
  }
});

// Список товаров с текущими остатками
app.get("/api/inventory/stock", auth, async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      where: { category: "STOCK" },
      orderBy: { name: "asc" },
      include: {
        movements: true,
      },
    });

    const result = items.map((item) => {
      let qty = 0;
      for (const m of item.movements) {
        if (!m.locationId) continue;
        if (m.type === "INCOME" || m.type === "ADJUSTMENT") {
          qty += Number(m.quantity);
        } else if (m.type === "ISSUE") {
          qty -= Number(m.quantity);
        }
      }

      return {
        id: item.id,
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        unit: item.unit,
        minStock: item.minStock,
        maxStock: item.maxStock,
        currentStock: Math.round(qty),
      };
    });

    res.json(result);
  } catch (err) {
    console.error("stock list error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при расчёте остатков" });
  }
});

// ===== WAREHOUSE: STOCK SUMMARY =====
app.get("/api/warehouse/stock/summary", auth, async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      where: { category: "STOCK" },
      orderBy: { name: "asc" },
      include: { movements: true },
    });

    const result = items.map((item) => {
      let qty = 0;
      for (const m of item.movements) {
        if (!m.locationId) continue;
        if (m.type === "INCOME" || m.type === "ADJUSTMENT") {
          qty += Number(m.quantity);
        } else if (m.type === "ISSUE") {
          qty -= Number(m.quantity);
        }
      }

      return {
        id: item.id,
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        unit: item.unit,
        currentStock: Math.round(qty),
      };
    });

    res.json(result);
  } catch (err) {
    console.error("warehouse stock summary error:", err);
    res.status(500).json({ message: "WAREHOUSE_STOCK_SUMMARY_ERROR" });
  }
});

app.get("/api/warehouse/stock/item/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_ITEM_ID" });
    }

    const item = await prisma.item.findUnique({ where: { id } });
    if (item && item.category === "TMC") {
      return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    }
    if (!item) {
      return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    }

    const currentStock = await getCurrentStockForItem(id);
    return res.json({
      item: {
        id: item.id,
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        unit: item.unit,
      },
      currentStock: currentStock ?? 0,
    });
  } catch (err) {
    console.error("warehouse stock item error:", err);
    res.status(500).json({ message: "WAREHOUSE_STOCK_ITEM_ERROR" });
  }
});

// Готовый заказ по товарам ниже минимального остатка (Excel .xlsx)
app.get("/api/inventory/low-stock-order-file", auth, async (req, res) => {
  try {
    // 1. Берём все товары с движениями
    const items = await prisma.item.findMany({
      where: { category: "STOCK" },
      orderBy: { name: "asc" },
      include: { movements: true },
    });

    const lowItems = [];

    for (const item of items) {
      // считаем текущий остаток так же, как в /api/inventory/stock
      let qty = 0;
      for (const m of item.movements) {
        if (!m.locationId) continue;
        if (m.type === "INCOME" || m.type === "ADJUSTMENT") {
          qty += Number(m.quantity);
        } else if (m.type === "ISSUE") {
          qty -= Number(m.quantity);
        }
      }

      const currentStock = Math.round(qty);
      const min = item.minStock != null ? Number(item.minStock) : null;
      const max = item.maxStock != null ? Number(item.maxStock) : null;

      // Логика "товар к заказу" делаем такой же, как подсветка в интерфейсе:
      // 1) если остаток <= 0 и есть min или max
      // 2) или если есть min и остаток < min
      const shouldOrder =
        (currentStock <= 0 && ((min != null && min > 0) || (max != null && max > 0))) ||
        (min != null && currentStock < min);

      if (!shouldOrder) continue;

      // Сколько заказывать:
      // - если задан min и >0 — добиваем до min
      // - иначе, если есть max — добиваем до max
      let orderQty = 0;

      if (min != null && min > 0) {
        orderQty = Math.max(0, min - currentStock);
      } else if (max != null && max > 0) {
        orderQty = Math.max(0, max - currentStock);
      }

      if (orderQty <= 0) continue;

      lowItems.push({
        name: item.name,
        unit: item.unit,
        orderQty,
        price: item.defaultPrice ? Number(item.defaultPrice) : null,
      });
    }

    if (lowItems.length === 0) {
      return res
        .status(400)
        .json({ message: "Нет товаров ниже минимального остатка" });
    }

    // 2. Создаём Excel-книгу и лист
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Заказ");

    // Строка 1: Заголовок "ЗАКАЗ № ____ от [Дата]"
    const now = new Date();
    const dateStr = now.toLocaleDateString("ru-RU");
    worksheet.mergeCells("A1:F1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `ЗАКАЗ № ____ от ${dateStr}`;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };

    // Строка 2: Шапка таблицы
    // Колонки: №, Номенклатура, Кол-во, Ед., Цена за шт, Сумма
    worksheet.getRow(2).values = ["№", "Номенклатура", "Кол-во", "Ед.", "Цена за шт", "Сумма"];

    // Настройка колонок (ширина)
    worksheet.columns = [
      { key: "position", width: 8 },
      { key: "name", width: 40 },
      { key: "qty", width: 15 },
      { key: "unit", width: 10 },
      { key: "price", width: 15 },
      { key: "sum", width: 15 },
    ];

    // 4. Заполняем строки данными
    const firstDataRow = 3; // данные начинаются с 3-й строки

    lowItems.forEach((it, index) => {
      const rowIndex = firstDataRow + index;
      const row = worksheet.getRow(rowIndex);

      row.values = [
        index + 1,          // A: №
        it.name,            // B: Номенклатура
        it.orderQty,        // C: Кол-во
        it.unit || "шт",    // D: Ед.
        it.price ?? 0,      // E: Цена
        // F: Сумма (формула)
      ];

      // Формула суммы: C*E
      row.getCell(6).value = {
        formula: `C${rowIndex}*E${rowIndex}`,
      };
    });

    const lastDataRow = firstDataRow + lowItems.length - 1;

    // 5. Строка с итогом под таблицей
    const totalRowIndex = lastDataRow + 1;
    const totalRow = worksheet.getRow(totalRowIndex);

    totalRow.getCell(5).value = "ИТОГО:";
    totalRow.getCell(5).font = { bold: true };
    totalRow.getCell(5).alignment = { horizontal: "right", vertical: "middle" };

    // Сумма по столбцу F
    totalRow.getCell(6).value = {
      formula: `SUM(F${firstDataRow}:F${lastDataRow})`,
    };
    totalRow.getCell(6).font = { bold: true };

    // 6. Оформление границ и выравнивание
    // Шапка (строка 2)
    const headerRow = worksheet.getRow(2);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // Данные
    for (let r = firstDataRow; r <= lastDataRow; r++) {
      const row = worksheet.getRow(r);
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        // Выравнивание: текст слева, числа справа/центр
        if (cell.col === 2) { // Номенклатура
          cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
        } else {
          cell.alignment = { horizontal: "center", vertical: "middle" };
        }
      });
    }

    // Итоговая строка (границы для суммы)
    totalRow.getCell(6).border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };

    // 7. Отдаём файл
    const filename = `order_${now.toISOString().slice(0, 10)}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("/api/inventory/low-stock-order-file error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при формировании заказа" });
  }
});

// Импорт товаров из Excel (шаблон "Импорт.xlsx")
app.post(
  "/api/inventory/items/import",
  auth,
  upload.single("file"), // ждём файл в поле "file"
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ message: "Файл не передан" });
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        return res
          .status(400)
          .json({ message: "Не удалось прочитать первый лист файла" });
      }

      // Предполагаем структуру файла "Импорт.xlsx":
      // 1-я строка — заголовки, дальше — данные
      // A: Наименование
      // B: Артикул (SKU)
      // C: Штрихкод
      // D: Ед. изм.
      // E: Мин. остаток
      // F: Макс. остаток
      // G: Цена за единицу
      const lastRow = worksheet.lastRow?.number || 0;

      let created = 0;
      let updated = 0;
      let skipped = 0;

      const toNumber = (raw) => {
        if (raw == null) return 0;
        if (typeof raw === "number") return raw;
        const n = Number(String(raw).replace(",", "."));
        return Number.isFinite(n) ? n : 0;
      };

      for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
        const row = worksheet.getRow(rowNumber);

        const name = String(row.getCell(1).value || "").trim();
        const sku = String(row.getCell(2).value || "").trim();
        const barcode = String(row.getCell(3).value || "").trim();
        const unit = String(row.getCell(4).value || "").trim();

        // Числовые значения
        // F=6 (Min), I=9 (Max), J=10 (Price)
        let minStock = Math.round(toNumber(row.getCell(6).value));
        let maxStock = Math.round(toNumber(row.getCell(9).value));
        let defaultPrice = toNumber(row.getCell(10).value);

        console.log(`Row ${rowNumber}: SKU=${sku}, Min=${minStock}, Max=${maxStock}, Price=${defaultPrice}`);

        // Если строка совсем пустая — пропускаем
        if (!name && !sku && !barcode) {
          skipped++;
          continue;
        }

        // Без имени или SKU — пропускаем (как и в API создания товара)
        if (!name || !sku) {
          skipped++;
          continue;
        }

        // Нормализуем: не допускаем отрицательных
        if (!Number.isFinite(minStock) || minStock < 0) {
          skipped++;
          continue;
        }
        if (!Number.isFinite(maxStock) || maxStock < 0) {
          skipped++;
          continue;
        }
        if (!Number.isFinite(defaultPrice) || defaultPrice < 0) {
          skipped++;
          continue;
        }

        const data = {
          name,
          sku,
          barcode: barcode || null,
          unit: unit || "",
          minStock,
          maxStock,
          defaultPrice,
        };

        try {
          // Ищем по SKU (он у тебя уникальный)
          const existing = await prisma.item.findFirst({
            where: { sku, category: "STOCK" },
          });

          if (existing) {
            await prisma.item.update({
              where: { id: existing.id },
              data,
            });
            updated++;
          } else {
            await prisma.item.create({ data });
            created++;
          }
        } catch (err) {
          console.error(
            "Ошибка при импорте строки",
            rowNumber,
            err
          );
          skipped++;
        }
      }

      return res.json({
        message: "Импорт завершён",
        created,
        updated,
        skipped,
      });
    } catch (err) {
      console.error("import file error:", err);
      res.status(500).json({ message: "Ошибка сервера при импорте файла" });
    }
  }
);

// Пакетное создание товаров (JSON) — для ImportItemsModal
app.post("/api/inventory/items/batch", auth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ message: "Ожидается массив items" });
    }

    let created = 0;
    let updated = 0;
    let errors = [];

    for (const item of items) {
      // Валидация
      if (!item.name || !item.sku) {
        errors.push({ row: item.row, error: "Нет имени или SKU" });
        continue;
      }

      const data = {
        name: String(item.name).trim(),
        sku: String(item.sku).trim(),
        barcode: item.barcode ? String(item.barcode).trim() : null,
        unit: item.unit ? String(item.unit).trim() : "шт",
        minStock: item.minStock ? Number(item.minStock) : 0,
        maxStock: item.maxStock ? Number(item.maxStock) : 0,
        defaultPrice: item.defaultPrice ? Number(item.defaultPrice) : 0,
      };

      try {
        const existing = await prisma.item.findFirst({
          where: { sku: data.sku, category: "STOCK" },
        });

        if (existing) {
          await prisma.item.update({
            where: { id: existing.id },
            data,
          });
          updated++;
        } else {
          await prisma.item.create({ data });
          created++;
        }
      } catch (e) {
        console.error("batch item error:", e);
        errors.push({ row: item.row, error: "Ошибка БД (возможно дубль)" });
      }
    }

    res.json({
      message: "Пакетная обработка завершена",
      created,
      updated,
      errors,
    });
  } catch (err) {
    console.error("batch import error:", err);
    res.status(500).json({ message: "Ошибка сервера при пакетном импорте" });
  }
});

// ====== СКЛАД: ХЕЛПЕРЫ ДЛЯ ОСТАТКОВ ======

// текущий остаток по товару
async function getCurrentStockForItem(itemId) {
  const id = Number(itemId);

  const item = await prisma.item.findUnique({
    where: { id },
  });

  if (!item) return null;

  const movements = await prisma.stockMovement.findMany({
    where: { itemId: id, locationId: { not: null } },
  });

  let total = 0;

  for (const m of movements) {
    const q = Number(m.quantity) || 0;

    if (m.type === "INCOME") {
      total += Math.abs(q);
    } else if (m.type === "ISSUE") {
      total -= Math.abs(q);
    } else if (m.type === "ADJUSTMENT") {
      // корректировка может быть и плюс, и минус
      total += q;
    }
  }

  return total;
}

// расчёт, какой остаток будет после движения
async function calculateStockAfterMovement(itemId, type, qty) {
  const current = await getCurrentStockForItem(itemId);
  if (current === null) {
    const err = new Error("ITEM_NOT_FOUND");
    err.code = "ITEM_NOT_FOUND";
    throw err;
  }

  let delta = 0;

  if (type === "INCOME") {
    delta = Math.abs(qty);
  } else if (type === "ISSUE") {
    delta = -Math.abs(qty);
  } else if (type === "ADJUSTMENT") {
    delta = qty;
  } else {
    const err = new Error("BAD_MOVEMENT_TYPE");
    err.code = "BAD_MOVEMENT_TYPE";
    throw err;
  }

  return {
    current,
    newStock: current + delta,
  };
}

// Создать движение (приход / расход / корректировка) с проверкой остатка
app.post("/api/inventory/movements", auth, async (req, res) => {
  try {
    const { itemId, type, quantity, comment, pricePerUnit } = req.body;

    if (!itemId || !type || quantity === undefined) {
      return res
        .status(400)
        .json({ message: "Нужно указать товар, тип и количество" });
    }

    if (!["INCOME", "ISSUE", "ADJUSTMENT"].includes(type)) {
      return res.status(400).json({ message: "Недопустимый тип движения" });
    }

    const itemIdNum = Number(itemId);
    const qtyNum = Number(quantity);

    // только целые числа и не 0
    if (!Number.isFinite(qtyNum) || !Number.isInteger(qtyNum) || qtyNum === 0) {
      return res.status(400).json({
        message: "Количество должно быть ненулевым целым числом",
      });
    }

    let normalizedQty = qtyNum;

    // для INCOME/ISSUE — только положительные целые
    if (type === "INCOME" || type === "ISSUE") {
      if (qtyNum < 0) {
        return res.status(400).json({
          message:
            "Для прихода и расхода количество должно быть положительным целым числом",
        });
      }
      normalizedQty = qtyNum; // > 0
    }

    // Для ПРИХОДА нужна цена за единицу
    let priceValue = null;
    if (type === "INCOME") {
      if (
        pricePerUnit === undefined ||
        pricePerUnit === null ||
        pricePerUnit === ""
      ) {
        return res
          .status(400)
          .json({ message: "Для прихода нужно указать цену за единицу" });
      }

      const p = Number(String(pricePerUnit).replace(",", "."));

      if (!Number.isFinite(p) || p <= 0) {
        return res.status(400).json({
          message: "Цена за единицу должна быть положительным числом",
        });
      }

      priceValue = p;
    }

    // ===== ПРОВЕРКА ОСТАТКА ПЕРЕД СОЗДАНИЕМ ДВИЖЕНИЯ =====
    let stockInfo;
    try {
      stockInfo = await calculateStockAfterMovement(
        itemIdNum,
        type,
        normalizedQty
      );
    } catch (e) {
      if (e.code === "ITEM_NOT_FOUND") {
        return res.status(404).json({ message: "Товар не найден" });
      }
      console.error("calculateStockAfterMovement error:", e);
      return res
        .status(500)
        .json({ message: "Ошибка при расчёте остатка по товару" });
    }

    if (stockInfo.newStock < 0) {
      return res.status(400).json({
        message: `Недостаточно остатка. На складе ${stockInfo.current} шт., вы пытаетесь списать ${normalizedQty} шт.`,
      });
    }
    // ===== КОНЕЦ ПРОВЕРКИ ОСТАТКА =====

    const movement = await prisma.stockMovement.create({
      data: {
        itemId: itemIdNum,
        type,
        quantity: normalizedQty,
        comment: comment?.trim() || null,
        pricePerUnit: priceValue,
        createdById: req.user.id,
      },
      include: {
        item: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.status(201).json(movement);
  } catch (err) {
    console.error("create movement error:", err);
    res.status(500).json({
      message: "Ошибка сервера при создании движения по складу",
    });
  }
});

// Журнал движений по складу
app.get("/api/inventory/movements", auth, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;

    const movements = await prisma.stockMovement.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        item: true,
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.json(movements);
  } catch (err) {
    console.error("list movements error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при загрузке движений" });
  }
});

// ================== ПОСТАВЩИКИ ==================

// Список поставщиков
app.get("/api/suppliers", auth, async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
    });
    res.json(suppliers);
  } catch (err) {
    console.error("suppliers list error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при загрузке поставщиков" });
  }
});

// Создать поставщика
app.post("/api/suppliers", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const { name, inn, phone, email, comment } = req.body;

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ message: "Название поставщика обязательно" });
    }

    const supplier = await prisma.supplier.create({
      data: {
        name: name.trim(),
        inn: inn?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        comment: comment || null,
      },
    });

    res.status(201).json(supplier);
  } catch (err) {
    console.error("create supplier error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при создании поставщика" });
  }
});

// Обновить поставщика
app.put("/api/suppliers/:id", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const id = Number(req.params.id);
    const { name, inn, phone, email, comment } = req.body;

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный ID поставщика" });
    }

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ message: "Название поставщика обязательно" });
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        name: name.trim(),
        inn: inn?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        comment: comment || null,
      },
    });

    res.json(supplier);
  } catch (err) {
    console.error("update supplier error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при обновлении поставщика" });
  }
});

// Удалить поставщика (если по нему нет заказов)
app.delete("/api/suppliers/:id", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный ID поставщика" });
    }

    const ordersCount = await prisma.purchaseOrder.count({
      where: { supplierId: id },
    });

    if (ordersCount > 0) {
      return res.status(400).json({
        message: "Нельзя удалить поставщика, по нему есть заказы",
      });
    }

    await prisma.supplier.delete({ where: { id } });
    res.json({ message: "Поставщик удалён" });
  } catch (err) {
    console.error("delete supplier error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при удалении поставщика" });
  }
});

// ================== ЗАКАЗЫ ПОСТАВЩИКУ ==================

// Создать заказ поставщику (запись в БД)
app.post("/api/purchase-orders", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const { supplierId, plannedDate, comment, items } = req.body;

    const supplierIdNum = Number(supplierId);
    if (!supplierIdNum || Number.isNaN(supplierIdNum)) {
      return res
        .status(400)
        .json({ message: "Нужно указать корректного поставщика" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ message: "Нужно указать хотя бы одну позицию заказа" });
    }

    // Проверяем, что поставщик существует
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierIdNum },
    });

    if (!supplier) {
      return res.status(404).json({ message: "Поставщик не найден" });
    }

    // Готовим позиции
    const preparedItems = [];
    for (const row of items) {
      const itemId = Number(row.itemId);
      const qty = Number(row.quantity);
      const price = Number(String(row.price).replace(",", "."));

      if (!itemId || Number.isNaN(itemId)) {
        return res
          .status(400)
          .json({ message: "Некорректный товар в списке позиций" });
      }

      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({
          message: "Количество по каждой позиции должно быть > 0",
        });
      }

      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({
          message:
            "Цена по каждой позиции должна быть числом (может быть 0, но не меньше)",
        });
      }

      preparedItems.push({
        itemId,
        quantity: qty,
        price,
      });
    }

    // Генерируем номер заказа: PO-00001, PO-00002, ...
    const nextNumber = await getNextPurchaseOrderNumber(req.user.orgId || null);

    const order = await prisma.purchaseOrder.create({
      data: {
        number: nextNumber,
        date: new Date(),
        plannedDate: plannedDate ? new Date(plannedDate) : null,
        comment: comment || null,
        supplierId: supplierIdNum,
        createdById: req.user.id,
        items: {
          create: preparedItems.map((p) => ({
            orgId: req.user.orgId || null,
            itemId: p.itemId,
            quantity: p.quantity,
            price: p.price,
          })),
        },
      },
      include: {
        supplier: true,
        items: {
          include: { item: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.status(201).json(order);
  } catch (err) {
    console.error("create purchase order error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при создании заказа поставщику" });
  }
});

// Список заказов поставщику
app.get("/api/purchase-orders", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const { status } = req.query;

    const where = {};
    if (status) {
      where.status = status;
    }

    const orders = await prisma.purchaseOrder.findMany({
      where,
      orderBy: { date: "desc" },
      include: {
        supplier: true,
        items: {
          include: { item: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    res.json(orders);
  } catch (err) {
    console.error("list purchase orders error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при загрузке заказов поставщику" });
  }
});

// ===== WAREHOUSE RECEIVING: OPEN POs =====
app.get("/api/warehouse/receiving/open-pos", auth, async (req, res) => {
  try {
    if (!canUseReceivingByPo(req.user)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }

    const orders = await prisma.purchaseOrder.findMany({
      where: { status: { in: ["DRAFT", "SENT", "PARTIAL"] } },
      orderBy: { date: "desc" },
      include: {
        supplier: true,
        items: {
          include: { item: true },
        },
      },
    });

    const activeTrucks = await prisma.supplierTruck.findMany({
      where: {
        status: { in: ["IN_QUEUE", "UNLOADING"] },
        orderNumber: { not: null },
      },
      orderBy: [{ arrivalAt: "asc" }, { id: "asc" }],
    });
    const trucksByNormalizedOrder = new Map();
    activeTrucks.forEach((truck) => {
      const key = normalizeOrderNumber(truck.orderNumber);
      if (!key || trucksByNormalizedOrder.has(key)) return;
      trucksByNormalizedOrder.set(key, truck);
    });

    const list = orders
      .map((order) => {
        const normalizedOrderNumber = normalizeOrderNumber(order.number);
        const linkedTruck = normalizedOrderNumber
          ? trucksByNormalizedOrder.get(normalizedOrderNumber)
          : null;
        if (!linkedTruck) return null;

        const totals = order.items.reduce(
          (acc, row) => {
            acc.ordered += Number(row.quantity) || 0;
            acc.received += Number(row.receivedQty) || 0;
            return acc;
          },
          { ordered: 0, received: 0 }
        );
        const progress =
          totals.ordered > 0 ? totals.received / totals.ordered : 0;
        return {
          id: order.id,
          number: order.number,
          date: order.date,
          status: order.status,
          supplier: order.supplier
            ? { id: order.supplier.id, name: order.supplier.name }
            : null,
          progress,
          queue: {
            truckId: linkedTruck.id,
            status: linkedTruck.status,
            arrivalAt: linkedTruck.arrivalAt,
            gate: linkedTruck.gate || null,
            truckNumber: linkedTruck.truckNumber || null,
            driverName: linkedTruck.driverName || null,
          },
          items: order.items.map((row) => ({
            id: row.id,
            itemId: row.itemId,
            sku: row.item?.sku,
            barcode: row.item?.barcode,
            name: row.item?.name,
            unit: row.item?.unit,
            orderedQty: row.quantity,
            receivedQty: row.receivedQty,
          })),
        };
      })
      .filter(Boolean);

    res.json(list);
  } catch (err) {
    console.error("open pos error:", err);
    res.status(500).json({ message: "OPEN_POS_ERROR" });
  }
});

app.post("/api/warehouse/receiving/:poId/take", auth, async (req, res) => {
  try {
    if (!canUseReceivingByPo(req.user)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }

    const poId = Number(req.params.poId);
    if (!poId || Number.isNaN(poId)) {
      return res.status(400).json({ message: "BAD_PO_ID" });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { supplier: true },
    });
    if (!order) {
      return res.status(404).json({ message: "PO_NOT_FOUND" });
    }
    if (order.status === "RECEIVED" || order.status === "CLOSED") {
      return res.status(400).json({ message: "PO_ALREADY_RECEIVED" });
    }
    const linkedTruck = await findActiveTruckForOrder(order.number, [
      "IN_QUEUE",
      "UNLOADING",
    ]);
    if (!linkedTruck) {
      return res.status(409).json({
        message:
          "Заказ не зарегистрирован в очереди поставщиков или уже закрыт в очереди.",
      });
    }

    const now = new Date();
    const updatedTruck =
      linkedTruck.status === "IN_QUEUE"
        ? await prisma.supplierTruck.update({
            where: { id: linkedTruck.id },
            data: {
              status: "UNLOADING",
              unloadStartAt: linkedTruck.unloadStartAt || now,
            },
          })
        : linkedTruck;

    res.json({
      ok: true,
      order: {
        id: order.id,
        number: order.number,
        status: order.status,
        supplier: order.supplier
          ? { id: order.supplier.id, name: order.supplier.name }
          : null,
      },
      queue: {
        truckId: updatedTruck.id,
        status: updatedTruck.status,
        arrivalAt: updatedTruck.arrivalAt,
        unloadStartAt: updatedTruck.unloadStartAt,
      },
    });
  } catch (err) {
    console.error("take receiving order error:", err);
    res.status(500).json({ message: "TAKE_RECEIVING_ORDER_ERROR" });
  }
});


// Получить один заказ
app.get("/api/purchase-orders/:id", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный ID заказа" });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: {
          include: { item: true },
        },
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Заказ не найден" });
    }

    res.json(order);
  } catch (err) {
    console.error("get purchase order error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при загрузке заказа поставщику" });
  }
});

// Excel-файл по уже сохранённому заказу поставщику

// ===== Purchase Order: RECEIVE ACT (PRINT) =====
app.get("/api/purchase-orders/:id/print-receive-act", auth, async (req, res) => {
  try {
    if (!canUseReceivingByPo(req.user)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }

    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_PO_ID" });
    }

    const order = await runWithoutTenantScope(() =>
      prismaBase.purchaseOrder.findFirst({
        where: {
          id,
          orgId: req.user?.orgId || null,
        },
        include: {
          supplier: true,
          items: {
            include: { item: true },
          },
        },
      })
    );

    if (!order) {
      return res.status(404).json({ message: "PO_NOT_FOUND" });
    }

    const rows = order.items.map((row) => ({
      name: row.item?.name || row.name || "",
      orderedQty: row.quantity,
      receivedQty: row.receivedQty ?? 0,
    }));

    let shortageRows = rows.filter(
      (row) => Number(row.orderedQty) > Number(row.receivedQty)
    );

    if (
      shortageRows.length === 0 &&
      String(order.status || "").toUpperCase() === "PARTIAL"
    ) {
      const orderItemNameById = new Map();
      order.items.forEach((row) => {
        const itemId = Number(row.itemId);
        if (!itemId || Number.isNaN(itemId)) return;
        orderItemNameById.set(itemId, row.item?.name || row.name || `\u0422\u043e\u0432\u0430\u0440 #${itemId}`);
      });

      const finalShortages = await prisma.receivingDiscrepancy.findMany({
        where: {
          purchaseOrderId: id,
          note: "FINAL_SHORTAGE",
          delta: { lt: 0 },
        },
        include: { item: true },
        orderBy: { id: "asc" },
      });

      const fallbackRows = finalShortages
        .map((disc) => {
          const itemId = disc.itemId ? Number(disc.itemId) : null;
          const name =
            disc.item?.name ||
            (itemId ? orderItemNameById.get(itemId) : null) ||
            (itemId ? `\u0422\u043e\u0432\u0430\u0440 #${itemId}` : "\u0422\u043e\u0432\u0430\u0440");
          return {
            name,
            orderedQty: Number(disc.expectedQty) || 0,
            receivedQty: Number(disc.receivedQty) || 0,
          };
        })
        .filter((row) => Number(row.orderedQty) > Number(row.receivedQty));

      if (fallbackRows.length > 0) {
        shortageRows = fallbackRows;
      }
    }

    if (shortageRows.length === 0) {
      return res.status(204).end();
    }

    const profile = await prisma.orgProfile.findFirst({
      where: { orgId: req.user.orgId || null },
    });
    const profileForAct = profile
      ? { ...profile, __profileMissing: false }
      : {
          orgName: "\u041e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u044f",
          legalAddress: "",
          actualAddress: "",
          inn: "",
          kpp: "",
          phone: "",
          __profileMissing: true,
        };

    const html = buildReceiveActHtml(order, shortageRows, profileForAct);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("print receive act error:", err);
    res.status(500).json({ message: "PRINT_RECEIVE_ACT_ERROR" });
  }
});

app.get("/api/purchase-orders/:id/excel-file", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res
        .status(400)
        .json({ message: "Некорректный ID заказа" });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: {
          include: { item: true },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Заказ не найден" });
    }

    // ---------- Excel ----------
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Заказ поставщику");

    const dateStr = new Date(order.date).toLocaleDateString("ru-RU");
    worksheet.mergeCells("A1:F1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `ЗАКАЗ ${order.number} от ${dateStr}`;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };

    // Подпись поставщика под заголовком (по желанию)
    worksheet.mergeCells("A2:F2");
    const supCell = worksheet.getCell("A2");
    supCell.value = `Поставщик: ${order.supplier?.name || ""}`;
    supCell.alignment = { horizontal: "left", vertical: "middle" };

    // Шапка таблицы
    const headerRowIndex = 4;
    worksheet.getRow(headerRowIndex).values = [
      "№",
      "Номенклатура",
      "Кол-во",
      "Ед.",
      "Цена за шт",
      "Сумма",
    ];

    worksheet.columns = [
      { key: "position", width: 6 },
      { key: "name", width: 45 },
      { key: "qty", width: 12 },
      { key: "unit", width: 10 },
      { key: "price", width: 14 },
      { key: "sum", width: 14 },
    ];

    const firstDataRow = headerRowIndex + 1;

    order.items.forEach((row, index) => {
      const rIndex = firstDataRow + index;
      const r = worksheet.getRow(rIndex);

      const name = row.item?.name || "";
      const unit = row.item?.unit || "шт";
      const qty = Number(row.quantity) || 0;
      const price = Number(row.price) || 0;

      r.values = [
        index + 1,
        name,
        qty,
        unit,
        price,
      ];

      r.getCell(6).value = {
        formula: `C${rIndex}*E${rIndex}`,
      };
    });

    const lastDataRow = firstDataRow + order.items.length - 1;

    // Итог
    const totalRowIndex = lastDataRow + 1;
    const totalRow = worksheet.getRow(totalRowIndex);
    totalRow.getCell(5).value = "ИТОГО:";
    totalRow.getCell(5).font = { bold: true };
    totalRow.getCell(5).alignment = {
      horizontal: "right",
      vertical: "middle",
    };
    totalRow.getCell(6).value = {
      formula: `SUM(F${firstDataRow}:F${lastDataRow})`,
    };
    totalRow.getCell(6).font = { bold: true };

    // Оформление
    const headerRow = worksheet.getRow(headerRowIndex);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    for (let r = firstDataRow; r <= lastDataRow; r++) {
      const row = worksheet.getRow(r);
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        if (cell.col === 2) {
          cell.alignment = {
            horizontal: "left",
            vertical: "middle",
            wrapText: true,
          };
        } else {
          cell.alignment = { horizontal: "center", vertical: "middle" };
        }
      });
    }

    totalRow.getCell(6).border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };

    const filename = `order_${order.number}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("/api/purchase-orders/:id/excel-file error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при формировании Excel заказа" });
  }
});

// Смена статуса заказа (и при RECEIVED — автоматический приход на склад)
app.put("/api/purchase-orders/:id/status", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const id = Number(req.params.id);
    const { status } = req.body;

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный ID заказа" });
    }

    const allowedStatuses = ["DRAFT", "SENT", "PARTIAL", "RECEIVED", "CLOSED"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Недопустимый статус заказа" });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Заказ не найден" });
    }

    if (status === "RECEIVED") {
      const alreadyPosted = await prisma.stockMovement.findFirst({
        where: {
          comment: {
            contains: `[PO#${order.id}]`,
          },
        },
      });

      if (alreadyPosted) {
        return res.status(400).json({
          message: "Этот заказ уже проведён по складу",
        });
      }

      for (const row of order.items) {
        if (!row.itemId || !row.quantity) continue;

        await prisma.stockMovement.create({
          data: {
            itemId: row.itemId,
            type: "INCOME",
            quantity: row.quantity,
            pricePerUnit: row.price,
            comment: `Приход по заказу поставщику ${order.number} [PO#${order.id}]`,
            createdById: req.user.id,
          },
        });
      }
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: { status },
      include: {
        supplier: true,
        items: {
          include: { item: true },
        },
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("update purchase order status error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при смене статуса заказа" });
  }
});

// Приёмка заказа поставщику (с актом расхождений)
app.post("/api/purchase-orders/:id/receive", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const id = Number(req.params.id);
    const { items } = req.body || {};

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный ID заказа" });
    }

    if (!Array.isArray(items)) {
      return res
        .status(400)
        .json({ message: "Нужно передать массив позиций для приёмки" });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: {
          include: { item: true },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Заказ не найден" });
    }

    // если статус уже получен/закрыт — не даём провести ещё раз
    if (order.status === "RECEIVED" || order.status === "CLOSED") {
      return res
        .status(400)
        .json({ message: "Этот заказ уже был проведён по складу" });
    }

    // Проверка на уже созданные движения по этому заказу
    const alreadyPosted = await prisma.stockMovement.findFirst({
      where: {
        comment: {
          contains: `[PO#${order.id}]`,
        },
      },
    });

    if (alreadyPosted) {
      return res
        .status(400)
        .json({ message: "Этот заказ уже проведён по складу" });
    }

    // payload: orderItemId -> receivedQuantity
    const qtyByOrderItemId = new Map();
    for (const row of items) {
      const orderItemId = Number(row.orderItemId);
      const received = Number(row.receivedQuantity);

      if (
        !orderItemId ||
        Number.isNaN(orderItemId) ||
        !Number.isFinite(received) ||
        received < 0
      ) {
        continue;
      }

      qtyByOrderItemId.set(orderItemId, received);
    }

    const movementsData = [];
    const discrepancies = [];
    const receivedByOrderItemId = new Map();
    const userId = req.user.id;

    for (const row of order.items) {
      const ordered = Number(row.quantity) || 0;
      const received = qtyByOrderItemId.has(row.id)
        ? Number(qtyByOrderItemId.get(row.id)) || 0
        : ordered; // по умолчанию считаем, что пришло столько же, сколько заказано

      // движение по складу — только если реально что-то пришло
      receivedByOrderItemId.set(row.id, received);
      if (received > 0) {
        movementsData.push({
          itemId: row.itemId,
          type: "INCOME",
          quantity: Math.round(received),
          pricePerUnit: row.price,
          comment: `Приход по заказу ${order.number} [PO#${order.id}] (заказано ${ordered}, получено ${received})`,
          createdById: userId,
        });
      }

      const diff = received - ordered;
      if (diff !== 0) {
        discrepancies.push({
          itemName: row.item?.name || "",
          unit: row.item?.unit || "шт",
          orderedQty: ordered,
          receivedQty: received,
          diffQty: diff,
          price: row.price,
        });
      }
    }

    // создаём движения
    if (movementsData.length > 0) {
      await prisma.stockMovement.createMany({ data: movementsData });
    }

    // обновляем статус заказа
    for (const row of order.items) {
      const received = receivedByOrderItemId.get(row.id) || 0;
      await prisma.purchaseOrderItem.update({
        where: { id: row.id },
        data: { receivedQty: received },
      });
    }

    const allReceived = order.items.every((row) => {
      const received = receivedByOrderItemId.get(row.id) || 0;
      return Number(received) >= Number(row.quantity || 0);
    });
    const anyReceived = order.items.some((row) => {
      const received = receivedByOrderItemId.get(row.id) || 0;
      return Number(received) > 0;
    });

    const nextStatus = allReceived
      ? "RECEIVED"
      : anyReceived
        ? "PARTIAL"
        : order.status;

    await prisma.purchaseOrder.update({
      where: { id: order.id },
      data: { status: nextStatus },
    });

    return res.json({
      success: true,
      order: {
        id: order.id,
        number: order.number,
        date: order.date,
        supplierName: order.supplier?.name || null,
      },
      discrepancies,
    });
  } catch (err) {
    console.error("purchase-order receive error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при приёмке заказа" });
  }
});

// ===== WAREHOUSE RECEIVING: CONFIRM PO =====
app.post("/api/warehouse/receiving/:poId/confirm", auth, async (req, res) => {
  try {
    if (!canUseReceivingByPo(req.user)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }

    const poId = Number(req.params.poId);
    const { stagingLocationId, lines, opId } = req.body || {};
    const locationId = stagingLocationId ? Number(stagingLocationId) : null;

    if (!poId || Number.isNaN(poId)) {
      return res.status(400).json({ message: "BAD_PO_ID" });
    }
    if (stagingLocationId && (!locationId || Number.isNaN(locationId))) {
      return res.status(400).json({ message: "BAD_LOCATION_ID" });
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ message: "BAD_LINES" });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        supplier: true,
        items: { include: { item: true } },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "PO_NOT_FOUND" });
    }

    if (order.status === "RECEIVED" || order.status === "CLOSED") {
      return res.status(400).json({ message: "PO_ALREADY_RECEIVED" });
    }
    const effectiveOrgId = order.orgId || req.user?.orgId || null;
    const fullOrderItems = await runWithoutTenantScope(() =>
      prismaBase.purchaseOrderItem.findMany({
        where: { orderId: poId },
        include: { item: true },
      })
    );

    const linkedTruck = await findActiveTruckForOrder(order.number, [
      "IN_QUEUE",
      "UNLOADING",
    ]);
    if (!linkedTruck) {
      return res.status(409).json({
        message:
          "Заказ не зарегистрирован в очереди поставщиков или уже закрыт в очереди.",
      });
    }
    if (linkedTruck.status !== "UNLOADING") {
      return res.status(409).json({
        message: "Сначала возьмите заказ в работу на приёмку.",
      });
    }

    let location = null;
    if (locationId) {
      location = await prisma.warehouseLocation.findUnique({
        where: { id: locationId },
      });
      if (!location) {
        return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
      }
    } else {
      location = await getOrCreateReceivingLocation();
    }

    const orderItemsByItemId = new Map();
    (fullOrderItems.length ? fullOrderItems : order.items).forEach((row) => {
      orderItemsByItemId.set(row.itemId, row);
    });

    const createdDiscrepancies = [];
    const movementIds = [];

    await prisma.$transaction(async (tx) => {
      for (const line of lines) {
        const itemId = Number(line.productId ?? line.itemId);
        const qty = Number(line.qty);
        const qtyInt = Math.trunc(qty);
        if (!itemId || !Number.isFinite(qty) || qtyInt <= 0) continue;

        const lineOpId = opId ? `${opId}:${itemId}` : null;
        if (lineOpId) {
          const existing = await tx.stockMovement.findUnique({
            where: { opId: lineOpId },
          });
          if (existing) {
            continue;
          }
        }

        const item = await tx.item.findUnique({ where: { id: itemId } });
        if (!item) continue;

        const movement = await stockService.createMovementInTx(tx, {
          opId: lineOpId,
          type: "INCOME",
          itemId,
          qty: qtyInt,
          locationId: location.id,
          comment: `??????? ?? ?????? ${order.number} [PO#${order.id}]`,
          refType: "PO",
          refId: String(order.id),
          userId: req.user?.id || null,
        });

        movementIds.push(movement.id);

        const now = new Date();
        const manufacturedAtRaw = line?.manufacturedAt ? new Date(line.manufacturedAt) : now;
        const manufacturedAt = Number.isNaN(manufacturedAtRaw.getTime()) ? now : manufacturedAtRaw;
        const expiresAtRaw = line?.expiresAt ? new Date(line.expiresAt) : manufacturedAt;
        const expiresAt = Number.isNaN(expiresAtRaw.getTime()) ? manufacturedAt : expiresAtRaw;

        await tx.warehouseReceivingLine.create({
          data: {
            itemId,
            qty: qtyInt,
            remainingQty: qtyInt,
            manufacturedAt,
            expiresAt,
            status: "PENDING",
            sourceType: "RECEIVING",
            locationId: location.id,
            createdById: req.user?.id || null,
          },
        });

        const orderRow = orderItemsByItemId.get(itemId);
        if (orderRow) {
          const ordered = Number(orderRow.quantity) || 0;
          const prevReceived = Number(orderRow.receivedQty) || 0;
          const expectedRemaining = Math.max(0, ordered - prevReceived);
          const nextReceived = prevReceived + qtyInt;

          await runWithoutTenantScope(() =>
            tx.purchaseOrderItem.updateMany({
              where: { id: orderRow.id },
              data: { receivedQty: nextReceived, orgId: effectiveOrgId },
            })
          );

          if (qtyInt !== expectedRemaining) {
            const delta = Math.trunc(qtyInt - expectedRemaining);
            const movementOpId = lineOpId || `po:${poId}:${itemId}:${Date.now()}`;
            const existingDisc = await tx.receivingDiscrepancy.findFirst({
              where: { movementOpId },
            });
            if (!existingDisc) {
              const created = await tx.receivingDiscrepancy.create({
                data: {
                  purchaseOrderId: poId,
                  itemId,
                  expectedQty: Math.trunc(expectedRemaining),
                  receivedQty: qtyInt,
                  delta: delta,
                  status: "OPEN",
                  movementOpId,
                },
              });
              createdDiscrepancies.push(created.id);
            }
          }
        } else {
          const movementOpId = lineOpId || `po:${poId}:${itemId}:${Date.now()}`;
          const existingDisc = await tx.receivingDiscrepancy.findFirst({
            where: { movementOpId },
          });
          if (!existingDisc) {
            const created = await tx.receivingDiscrepancy.create({
              data: {
                purchaseOrderId: poId,
                itemId,
                expectedQty: 0,
                receivedQty: qtyInt,
                delta: qtyInt,
                status: "OPEN",
                movementOpId,
                note: "UNPLANNED_ITEM",
              },
            });
            createdDiscrepancies.push(created.id);
          }
        }
      }

      if (createdDiscrepancies.length > 0) {
        await tx.receivingDiscrepancy.findMany({
          where: { id: { in: createdDiscrepancies } },
        });
      }
    });
    let updatedOrder = null;
    try {
      updatedOrder = await runWithoutTenantScope(() =>
        prismaBase.purchaseOrder.findUnique({
          where: { id: poId },
          include: {
            supplier: true,
            items: { include: { item: true } },
          },
        })
      );
    } catch (postReadErr) {
      console.error("po receiving confirm post-read error:", postReadErr);
    }

    res.json({
      ok: true,
      movementIds,
      discrepancies: createdDiscrepancies,
      order: updatedOrder || { id: poId },
    });
  } catch (err) {
    console.error("po receiving confirm error:", err);
    if (err.code === "INSUFFICIENT_QTY") {
      return res.status(400).json({ message: "INSUFFICIENT_QTY" });
    }
    if (err.code === "BAD_QTY") {
      return res.status(400).json({ message: "BAD_QTY" });
    }
    if (err.code === "TENANT_NOT_FOUND") {
      return res.status(409).json({ message: "TENANT_NOT_FOUND" });
    }
    if (err.code === "P2002") {
      return res.status(409).json({
        message: "ALREADY_PROCESSED",
      });
    }
    if (err.code === "P2025") {
      return res.status(409).json({
        message: "RECORD_CHANGED",
      });
    }
    res.status(500).json({
      message: "PO_RECEIVING_CONFIRM_ERROR",
      detail: String(err?.message || ""),
    });
  }
});

app.post("/api/warehouse/receiving/:poId/finalize", auth, async (req, res) => {
  try {
    if (!canUseReceivingByPo(req.user)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }

    const poId = Number(req.params.poId);
    if (!poId || Number.isNaN(poId)) {
      return res.status(400).json({ message: "BAD_PO_ID" });
    }

    const order = await runWithoutTenantScope(() =>
      prismaBase.purchaseOrder.findUnique({
        where: { id: poId },
        include: {
          supplier: true,
          items: { include: { item: true } },
        },
      })
    );

    if (!order) {
      return res.status(404).json({ message: "PO_NOT_FOUND" });
    }

    const effectiveOrgId = order.orgId || req.user?.orgId || null;
    const linkedTruck = await findActiveTruckForOrder(order.number, [
      "IN_QUEUE",
      "UNLOADING",
      "DONE",
    ]);

    if (!linkedTruck) {
      return res.status(409).json({ message: "NO_ACTIVE_TRUCK" });
    }
    if (linkedTruck.status === "IN_QUEUE") {
      return res.status(409).json({ message: "TAKE_ORDER_FIRST" });
    }

    await prisma.$transaction(async (tx) => {
      const refreshed = await runWithoutTenantScope(() =>
        tx.purchaseOrder.findUnique({
          where: { id: poId },
          include: { items: true },
        })
      );
      if (!refreshed) return;

      for (const row of refreshed.items || []) {
        const ordered = Number(row.quantity) || 0;
        const received = Number(row.receivedQty) || 0;
        if (ordered === received) continue;

        const delta = Math.trunc(received - ordered);
        const existingFinal = await tx.receivingDiscrepancy.findFirst({
          where: {
            purchaseOrderId: poId,
            itemId: row.itemId,
            status: "OPEN",
            delta,
            note: { in: ["FINAL_SHORTAGE", "FINAL_OVERAGE"] },
          },
        });
        if (!existingFinal) {
          await tx.receivingDiscrepancy.create({
            data: {
              purchaseOrderId: poId,
              itemId: row.itemId,
              expectedQty: Math.trunc(ordered),
              receivedQty: Math.trunc(received),
              delta,
              status: "OPEN",
              note: delta < 0 ? "FINAL_SHORTAGE" : "FINAL_OVERAGE",
            },
          });
        }
      }

      const allReceived = refreshed.items.every(
        (row) => Number(row.receivedQty) >= Number(row.quantity)
      );
      const anyReceived = refreshed.items.some(
        (row) => Number(row.receivedQty) > 0
      );
      const nextStatus = allReceived
        ? "RECEIVED"
        : anyReceived
          ? "PARTIAL"
          : refreshed.status;

      if (nextStatus !== refreshed.status || !refreshed.orgId) {
        await runWithoutTenantScope(() =>
          tx.purchaseOrder.updateMany({
            where: { id: poId },
            data: { status: nextStatus, orgId: effectiveOrgId },
          })
        );
      }
    });

    const now = new Date();
    if (linkedTruck.status !== "DONE") {
      try {
        await runWithoutTenantScope(() =>
          prismaBase.supplierTruck.updateMany({
            where: { id: linkedTruck.id, status: { not: "DONE" } },
            data: {
              status: "DONE",
              unloadEndAt: linkedTruck.unloadEndAt || now,
              orgId: linkedTruck.orgId || effectiveOrgId,
            },
          })
        );
      } catch (truckCloseErr) {
        console.error("po receiving finalize truck close error:", truckCloseErr);
      }
    }

    const updatedOrder = await runWithoutTenantScope(() =>
      prismaBase.purchaseOrder.findUnique({
        where: { id: poId },
        include: {
          supplier: true,
          items: { include: { item: true } },
        },
      })
    );

    res.json({ ok: true, order: updatedOrder || { id: poId } });
  } catch (err) {
    console.error("po receiving finalize error:", err);
    if (err.code === "TENANT_NOT_FOUND") {
      return res.status(409).json({ message: "TENANT_NOT_FOUND" });
    }
    if (err.code === "P2002") {
      return res.status(409).json({ message: "ALREADY_PROCESSED" });
    }
    if (err.code === "P2025") {
      return res.status(409).json({ message: "RECORD_CHANGED" });
    }
    res.status(500).json({
      message: "PO_RECEIVING_FINALIZE_ERROR",
      detail: String(err?.message || ""),
    });
  }
});

// ===== RECEIVING DISCREPANCIES =====
app.get("/api/warehouse/receiving/:poId/discrepancies", auth, async (req, res) => {
  try {
    if (!canUseReceivingByPo(req.user)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }
    const poId = Number(req.params.poId);
    if (!poId || Number.isNaN(poId)) {
      return res.status(400).json({ message: "BAD_PO_ID" });
    }
    const items = await prisma.receivingDiscrepancy.findMany({
      where: { purchaseOrderId: poId },
      orderBy: { createdAt: "desc" },
      include: { item: true },
    });
    res.json({ items });
  } catch (err) {
    console.error("po receiving discrepancies error:", err);
    res.status(500).json({ message: "PO_RECEIVING_DISCREPANCIES_ERROR" });
  }
});

app.post("/api/warehouse/receiving/:poId/discrepancies", auth, async (req, res) => {
  try {
    if (!canUseReceivingByPo(req.user)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }
    const poId = Number(req.params.poId);
    const { itemId, expectedQty, receivedQty, note } = req.body || {};
    if (!poId || Number.isNaN(poId)) {
      return res.status(400).json({ message: "BAD_PO_ID" });
    }

    const created = await prisma.receivingDiscrepancy.create({
      data: {
        purchaseOrderId: poId,
        itemId: itemId ? Number(itemId) : null,
        expectedQty: Number(expectedQty) || 0,
        receivedQty: Number(receivedQty) || 0,
        delta: Number(receivedQty || 0) - Number(expectedQty || 0),
        note: note || null,
        status: "OPEN",
      },
    });

    res.json({ id: created.id });
  } catch (err) {
    console.error("po receiving discrepancy create error:", err);
    res.status(500).json({ message: "PO_RECEIVING_DISCREPANCY_CREATE_ERROR" });
  }
});

app.patch("/api/warehouse/receiving/discrepancies/:id/close", auth, async (req, res) => {
  try {
    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({ message: "FORBIDDEN" });
    }
    const id = Number(req.params.id);
    const { closeNote } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_ID" });
    }
    await prisma.receivingDiscrepancy.update({
      where: { id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closedByUserId: req.user?.id || null,
        closeNote: closeNote || null,
      },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("po receiving discrepancy close error:", err);
    res.status(500).json({ message: "PO_RECEIVING_DISCREPANCY_CLOSE_ERROR" });
  }
});


// ===== Excel-файл заказа поставщику (без сохранения в БД) =====
app.post("/api/purchase-orders/excel-file", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const { supplierId, plannedDate, comment, items } = req.body;

    const supplierIdNum = Number(supplierId);
    if (!supplierIdNum || Number.isNaN(supplierIdNum)) {
      return res
        .status(400)
        .json({ message: "Некорректный поставщик" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "Нужно указать хотя бы одну позицию заказа",
      });
    }

    // Пытаемся узнать имя поставщика (если не получится – просто будет "Поставщик")
    let supplierName = "Поставщик";
    try {
      const supplier = await prisma.supplier.findUnique({
        where: { id: supplierIdNum },
      });
      if (supplier?.name) supplierName = supplier.name;
    } catch (e) {
      console.error("[excel-file] Ошибка чтения поставщика:", e);
    }

    // Чистим и валидируем позиции
    const cleanedItems = [];
    for (const raw of items) {
      const name = String(raw.name || "").trim();
      const unit = String(raw.unit || "шт").trim();
      const qty = Number(raw.quantity);
      const price = Number(
        String(raw.price ?? "")
          .toString()
          .replace(",", ".")
      );

      if (!name) continue;
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (!Number.isFinite(price) || price < 0) continue;

      cleanedItems.push({ name, unit, qty, price });
    }

    if (cleanedItems.length === 0) {
      return res.status(400).json({
        message: "Нет валидных позиций для формирования заказа",
      });
    }

    // === Формируем Excel ===
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Заказ");

    const now = new Date();
    const orderDateStr = now.toLocaleDateString("ru-RU");
    const plannedDateStr = plannedDate
      ? new Date(plannedDate).toLocaleDateString("ru-RU")
      : null;

    // Строка 1 — заголовок
    worksheet.mergeCells("A1:F1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `Заказ поставщику: ${supplierName}`;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };

    // Строка 2 — дата заказа / план. приёмка
    worksheet.mergeCells("A2:F2");
    const metaCell = worksheet.getCell("A2");
    metaCell.value =
      `Дата заказа: ${orderDateStr}` +
      (plannedDateStr ? ` / План. приёмка: ${plannedDateStr}` : "");
    metaCell.alignment = { horizontal: "right", vertical: "middle" };
    metaCell.font = { size: 11, color: { argb: "FF555555" } };

    // Строка 3 — пустая
    worksheet.getRow(3).height = 4;

    // Строка 4 — шапка таблицы
    const headerRowIndex = 4;
    const headerRow = worksheet.getRow(headerRowIndex);
    headerRow.values = ["№", "Номенклатура", "Кол-во", "Ед.", "Цена", "Сумма"];

    worksheet.columns = [
      { key: "position", width: 6 },
      { key: "name", width: 45 },
      { key: "qty", width: 12 },
      { key: "unit", width: 8 },
      { key: "price", width: 14 },
      { key: "sum", width: 16 },
    ];

    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F4F6" },
      };
    });

    // Данные
    const firstDataRow = headerRowIndex + 1;

    cleanedItems.forEach((it, index) => {
      const rowIndex = firstDataRow + index;
      const row = worksheet.getRow(rowIndex);

      row.values = [
        index + 1,
        it.name,
        it.qty,
        it.unit,
        it.price,
        undefined, // формула будет ниже
      ];

      row.getCell(6).value = { formula: `C${rowIndex}*E${rowIndex}` };

      row.eachCell((cell, col) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };

        if (col === 2) {
          cell.alignment = {
            horizontal: "left",
            vertical: "middle",
            wrapText: true,
          };
        } else {
          cell.alignment = { horizontal: "center", vertical: "middle" };
        }
      });
    });

    const lastDataRow = firstDataRow + cleanedItems.length - 1;

    // Итоговая строка
    const totalRowIndex = lastDataRow + 1;
    const totalRow = worksheet.getRow(totalRowIndex);

    totalRow.getCell(5).value = "Итого:";
    totalRow.getCell(5).font = { bold: true };
    totalRow.getCell(5).alignment = {
      horizontal: "right",
      vertical: "middle",
    };

    totalRow.getCell(6).value = {
      formula: `SUM(F${firstDataRow}:F${lastDataRow})`,
    };
    totalRow.getCell(6).font = { bold: true };
    totalRow.getCell(6).border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };

    // Комментарий (если есть)
    if (comment) {
      const commentRowIndex = totalRowIndex + 2;
      worksheet.mergeCells(`A${commentRowIndex}:F${commentRowIndex}`);
      const cCell = worksheet.getCell(`A${commentRowIndex}`);
      cCell.value = `Комментарий: ${comment}`;
      cCell.alignment = {
        horizontal: "left",
        vertical: "middle",
        wrapText: true,
      };
      cCell.font = { italic: true, size: 11 };
    }

    const filename = `order_supplier_${supplierIdNum}_${now
      .toISOString()
      .slice(0, 10)}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );

    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("/api/purchase-orders/excel-file error:", err);
    return res.status(500).json({
      message: "Ошибка сервера при формировании Excel-заказа поставщику",
      error: String(err),
    });
  }
});

// ================== ORDER FULFILLMENT (SMB) ==================
app.post("/api/orders/inbound", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "??? ???????." });
    }

    const {
      externalOrderId,
      source,
      orderNumber,
      customerName,
      customerPhone,
      shippingAddress,
      deliveryComment,
      items,
    } = req.body || {};

    if (!orderNumber || !customerName || !shippingAddress) {
      return res.status(400).json({ message: "????????? ????? ??????, ?????????? ? ?????." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "???????? ??????? ??????." });
    }

    const linesPayload = [];
    for (const raw of items) {
      const qty = Math.trunc(Number(raw.qty));
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const item = await findStockItemForOrderLine(prisma, raw);
      linesPayload.push({
        itemId: item?.id || null,
        requestedSku: raw.sku ? String(raw.sku) : item?.sku || null,
        requestedName: raw.name ? String(raw.name) : item?.name || null,
        qty,
      });
    }

    if (linesPayload.length === 0) {
      return res.status(400).json({ message: "???????? ??????? ??????." });
    }

    const result = await prisma.$transaction(async (tx) => {
      if (externalOrderId) {
        const existing = await tx.salesOrder.findUnique({
          where: { externalOrderId: String(externalOrderId) },
          include: { lines: true },
        });
        if (existing) {
          if (!["NEW", "IN_PICKING"].includes(existing.status)) {
            const err = new Error("ORDER_LOCKED");
            err.code = "ORDER_LOCKED";
            throw err;
          }

          await tx.salesOrderLine.deleteMany({ where: { orderId: existing.id } });
          await tx.salesOrderLine.createMany({
            data: linesPayload.map((row) => ({
              orgId: req.user.orgId || null,
              orderId: existing.id,
              itemId: row.itemId,
              requestedSku: row.requestedSku,
              requestedName: row.requestedName,
              qty: row.qty,
            })),
          });

          return tx.salesOrder.update({
            where: { id: existing.id },
            data: {
              source: source ? String(source) : existing.source,
              orderNumber: String(orderNumber),
              customerName: String(customerName),
              customerPhone: customerPhone ? String(customerPhone) : null,
              shippingAddress: String(shippingAddress),
              deliveryComment: deliveryComment ? String(deliveryComment) : null,
            },
            include: {
              assignedToUser: { select: { id: true, name: true, email: true } },
              lines: { include: { item: true }, orderBy: { id: "asc" } },
            },
          });
        }
      }

      return tx.salesOrder.create({
        data: {
          externalOrderId: externalOrderId ? String(externalOrderId) : null,
          source: source ? String(source) : "MANUAL",
          orderNumber: String(orderNumber),
          customerName: String(customerName),
          customerPhone: customerPhone ? String(customerPhone) : null,
          shippingAddress: String(shippingAddress),
          deliveryComment: deliveryComment ? String(deliveryComment) : null,
          lines: {
            create: linesPayload.map((row) => ({
              ...row,
              orgId: req.user.orgId || null,
            })),
          },
        },
        include: {
          assignedToUser: { select: { id: true, name: true, email: true } },
          lines: { include: { item: true }, orderBy: { id: "asc" } },
        },
      });
    });

    res.status(201).json({ ok: true, order: result });
  } catch (err) {
    if (err.code === "ORDER_LOCKED") {
      return res.status(409).json({ message: "????? ??? ? ?????? ??? ??????." });
    }
    console.error("orders inbound error:", err);
    res.status(500).json({ message: "?????? ???????? ??????." });
  }
});

// ===== INTEGRATION: ORDERS INBOUND (API KEY) =====
app.post("/api/integrations/orders/inbound", async (req, res) => {
  try {
    const apiKey = req.headers["x-api-key"] || req.headers["X-Api-Key"];
    if (!apiKey) {
      return res.status(401).json({ message: "????????? ???? ??????????." });
    }
    const hash = hashApiKey(String(apiKey));
    const profile = await prisma.orgProfile.findFirst({
      where: {
        apiKeyHash: hash,
        orgId: { not: null },
      },
      select: {
        orgId: true,
      },
    });
    if (!profile?.orgId) {
      return res.status(401).json({ message: "???? ?????????? ?? ????????." });
    }
    const store = requestContext.getStore();
    if (store) {
      store.orgId = profile.orgId;
      store.isSystemOwner = false;
    }

    const {
      externalOrderId,
      source,
      orderNumber,
      customerName,
      customerPhone,
      shippingAddress,
      deliveryComment,
      items,
    } = req.body || {};

    if (!orderNumber || !customerName || !shippingAddress) {
      return res.status(400).json({ message: "????????? ????? ??????, ?????????? ? ?????." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "???????? ??????? ??????." });
    }

    const linesPayload = [];
    for (const raw of items) {
      const qty = Math.trunc(Number(raw.qty));
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const item = await findStockItemForOrderLine(prisma, raw);
      linesPayload.push({
        itemId: item?.id || null,
        requestedSku: raw.sku ? String(raw.sku) : item?.sku || null,
        requestedName: raw.name ? String(raw.name) : item?.name || null,
        qty,
      });
    }

    if (linesPayload.length === 0) {
      return res.status(400).json({ message: "???????? ??????? ??????." });
    }

    const result = await prisma.$transaction(async (tx) => {
      if (externalOrderId) {
        const existing = await tx.salesOrder.findUnique({
          where: { externalOrderId: String(externalOrderId) },
          include: { lines: true },
        });
        if (existing) {
          if (!["NEW", "IN_PICKING"].includes(existing.status)) {
            const err = new Error("ORDER_LOCKED");
            err.code = "ORDER_LOCKED";
            throw err;
          }

          await tx.salesOrderLine.deleteMany({ where: { orderId: existing.id } });
          await tx.salesOrderLine.createMany({
            data: linesPayload.map((row) => ({
              orgId: profile.orgId || null,
              orderId: existing.id,
              itemId: row.itemId,
              requestedSku: row.requestedSku,
              requestedName: row.requestedName,
              qty: row.qty,
            })),
          });

          return tx.salesOrder.update({
            where: { id: existing.id },
            data: {
              source: source ? String(source) : existing.source,
              orderNumber: String(orderNumber),
              customerName: String(customerName),
              customerPhone: customerPhone ? String(customerPhone) : null,
              shippingAddress: String(shippingAddress),
              deliveryComment: deliveryComment ? String(deliveryComment) : null,
            },
            include: {
              assignedToUser: { select: { id: true, name: true, email: true } },
              lines: { include: { item: true }, orderBy: { id: "asc" } },
            },
          });
        }
      }

      return tx.salesOrder.create({
        data: {
          externalOrderId: externalOrderId ? String(externalOrderId) : null,
          source: source ? String(source) : "INTEGRATION",
          orderNumber: String(orderNumber),
          customerName: String(customerName),
          customerPhone: customerPhone ? String(customerPhone) : null,
          shippingAddress: String(shippingAddress),
          deliveryComment: deliveryComment ? String(deliveryComment) : null,
          lines: {
            create: linesPayload.map((row) => ({
              ...row,
              orgId: profile.orgId || null,
            })),
          },
        },
        include: {
          assignedToUser: { select: { id: true, name: true, email: true } },
          lines: { include: { item: true }, orderBy: { id: "asc" } },
        },
      });
    });

    res.status(201).json({ ok: true, order: result });
  } catch (err) {
    if (err.code === "ORDER_LOCKED") {
      return res.status(409).json({ message: "????? ??? ? ?????? ??? ??????." });
    }
    console.error("integration inbound error:", err);
    res.status(500).json({ message: "?????? ???????? ??????." });
  }
});

// ===== ADMIN: ORDERS IMPORT (JSON BATCH) =====
app.post("/api/orders/import-batch", auth, requireAdmin, async (req, res) => {
  try {
    const { orders } = req.body || {};
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ message: "???????? ?????? ??? ???????." });
    }

    let created = 0;
    let updated = 0;
    const errors = [];

    for (let i = 0; i < orders.length; i += 1) {
      const row = orders[i] || {};
      const {
        externalOrderId,
        source,
        orderNumber,
        customerName,
        customerPhone,
        shippingAddress,
        deliveryComment,
        items,
      } = row;

      if (!orderNumber || !customerName || !shippingAddress) {
        errors.push({ row: i + 1, error: "????????? ????? ??????, ?????????? ? ?????." });
        continue;
      }
      if (!Array.isArray(items) || items.length === 0) {
        errors.push({ row: i + 1, error: "???????? ??????? ??????." });
        continue;
      }

      const linesPayload = [];
      for (const raw of items) {
        const qty = Math.trunc(Number(raw.qty));
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const item = await findStockItemForOrderLine(prisma, raw);
        linesPayload.push({
          itemId: item?.id || null,
          requestedSku: raw.sku ? String(raw.sku) : item?.sku || null,
          requestedName: raw.name ? String(raw.name) : item?.name || null,
          qty,
        });
      }

      if (linesPayload.length === 0) {
        errors.push({ row: i + 1, error: "??? ???????? ????? ??????." });
        continue;
      }

      try {
        const result = await prisma.$transaction(async (tx) => {
          if (externalOrderId) {
            const existing = await tx.salesOrder.findUnique({
              where: { externalOrderId: String(externalOrderId) },
              include: { lines: true },
            });
            if (existing) {
              if (!["NEW", "IN_PICKING"].includes(existing.status)) {
                const err = new Error("ORDER_LOCKED");
                err.code = "ORDER_LOCKED";
                throw err;
              }

              await tx.salesOrderLine.deleteMany({ where: { orderId: existing.id } });
              await tx.salesOrderLine.createMany({
                data: linesPayload.map((line) => ({
                  orgId: req.user.orgId || null,
                  orderId: existing.id,
                  itemId: line.itemId,
                  requestedSku: line.requestedSku,
                  requestedName: line.requestedName,
                  qty: line.qty,
                })),
              });

              const updatedOrder = await tx.salesOrder.update({
                where: { id: existing.id },
                data: {
                  source: source ? String(source) : existing.source,
                  orderNumber: String(orderNumber),
                  customerName: String(customerName),
                  customerPhone: customerPhone ? String(customerPhone) : null,
                  shippingAddress: String(shippingAddress),
                  deliveryComment: deliveryComment ? String(deliveryComment) : null,
                },
              });
              return { mode: "updated", order: updatedOrder };
            }
          }

          const createdOrder = await tx.salesOrder.create({
            data: {
              externalOrderId: externalOrderId ? String(externalOrderId) : null,
              source: source ? String(source) : "IMPORT",
              orderNumber: String(orderNumber),
              customerName: String(customerName),
              customerPhone: customerPhone ? String(customerPhone) : null,
              shippingAddress: String(shippingAddress),
              deliveryComment: deliveryComment ? String(deliveryComment) : null,
              lines: {
                create: linesPayload.map((line) => ({
                  ...line,
                  orgId: req.user.orgId || null,
                })),
              },
            },
          });
          return { mode: "created", order: createdOrder };
        });

        if (result.mode === "created") created += 1;
        if (result.mode === "updated") updated += 1;
      } catch (err) {
        if (err.code === "ORDER_LOCKED") {
          errors.push({ row: i + 1, error: "????? ??? ? ?????? ??? ??????." });
        } else {
          errors.push({ row: i + 1, error: "?????? ??????? ??????." });
          console.error("orders import row error:", err);
        }
      }
    }

    res.json({ created, updated, errors });
  } catch (err) {
    console.error("orders import error:", err);
    res.status(500).json({ message: "?????? ??????? ???????." });
  }
});

// ===== ADMIN: CREATE TEST ORDER =====
app.post("/api/orders/test", auth, requireAdmin, async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      take: 3,
      orderBy: { id: "asc" },
    });
    if (!items.length) {
      return res.status(400).json({ message: "??? ??????? ??? ????????? ??????." });
    }

    const orderNumber = `TEST-${Date.now()}`;
    const created = await prisma.salesOrder.create({
      data: {
        source: "TEST",
        orderNumber,
        customerName: "???????? ??????????",
        customerPhone: null,
        shippingAddress: "???????? ?????",
        deliveryComment: "???????? ?????",
        lines: {
          create: items.map((item) => ({
            orgId: req.user.orgId || null,
            itemId: item.id,
            requestedSku: item.sku || null,
            requestedName: item.name || null,
            qty: 1,
          })),
        },
      },
      include: {
        assignedToUser: { select: { id: true, name: true, email: true } },
        lines: { include: { item: true }, orderBy: { id: "asc" } },
      },
    });

    res.status(201).json({ ok: true, order: created });
  } catch (err) {
    console.error("orders test error:", err);
    res.status(500).json({ message: "?????? ???????? ????????? ??????." });
  }
});

// ===== INTEGRATION API KEY (ORG-LEVEL) =====
app.get("/api/integrations/api-key", auth, requireAdmin, async (req, res) => {
  try {
    const profile = await prisma.orgProfile.findFirst({
      where: { orgId: req.user.orgId || null },
    });
    res.json({
      hasKey: Boolean(profile?.apiKeyHash),
      hint: profile?.apiKeyHint || null,
      lastRotatedAt: profile?.apiKeyLastRotatedAt || null,
    });
  } catch (err) {
    console.error("get api key error:", err);
    res.status(500).json({ message: "?????? ????????? ????? ??????????." });
  }
});

app.post("/api/integrations/api-key/rotate", auth, requireAdmin, async (req, res) => {
  try {
    if (!req.user.orgId) {
      return res.status(400).json({ message: "ORG_REQUIRED" });
    }
    const rawKey = `bp_${crypto.randomBytes(24).toString("hex")}`;
    const hash = hashApiKey(rawKey);
    const hint = buildApiKeyHint(rawKey);

    const existing = await prisma.orgProfile.findFirst({
      where: { orgId: req.user.orgId },
      select: { id: true },
    });

    const updated = existing
      ? await prisma.orgProfile.update({
          where: { id: existing.id },
          data: {
            apiKeyHash: hash,
            apiKeyHint: hint,
            apiKeyLastRotatedAt: new Date(),
          },
        })
      : await prisma.orgProfile.create({
          data: {
            orgId: req.user.orgId,
            orgName: "",
            legalAddress: "",
            actualAddress: "",
            inn: "",
            kpp: "",
            phone: "",
            apiKeyHash: hash,
            apiKeyHint: hint,
            apiKeyLastRotatedAt: new Date(),
          },
        });

    res.json({
      apiKey: rawKey,
      hint: updated.apiKeyHint,
      lastRotatedAt: updated.apiKeyLastRotatedAt,
    });
  } catch (err) {
    console.error("rotate api key error:", err);
    res.status(500).json({ message: "?????? ????????? ????? ??????????." });
  }
});

app.get("/api/orders/queue", auth, async (req, res) => {
  try {
    const mineOnly = req.query.mine === "1";
    const statusList = String(req.query.status || "NEW,IN_PICKING,PICKED,PACKED")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const where = mineOnly
      ? {
          status: { in: statusList },
          assignedToUserId: req.user.id,
        }
      : {
          status: { in: statusList },
        };

    const orders = await prisma.salesOrder.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      include: {
        assignedToUser: { select: { id: true, name: true, email: true } },
        lines: { include: { item: true }, orderBy: { id: "asc" } },
      },
      take: 100,
    });

    res.json({ items: orders });
  } catch (err) {
    console.error("orders queue error:", err);
    res.status(500).json({ message: "?????? ???????? ??????? ???????." });
  }
});

app.get("/api/orders/:id/pick-skips", auth, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    if (!orderId || Number.isNaN(orderId)) {
      return res.status(400).json({ message: "������������ ID ������." });
    }

    const order = await prisma.salesOrder.findUnique({
      where: { id: orderId },
      select: { id: true, assignedToUserId: true },
    });
    if (!order) {
      return res.status(404).json({ message: "����� �� ������." });
    }

    if (
      order.assignedToUserId &&
      order.assignedToUserId !== req.user.id &&
      !isWarehouseManager(req.user)
    ) {
      return res.status(403).json({ message: "����� ��������� �� ������ �����������." });
    }

    const items = await prisma.salesOrderPickSkip.findMany({
      where: {
        orderId,
        status: "ACTIVE",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        skippedBy: { select: { id: true, name: true, email: true } },
      },
    });

    res.json({ items });
  } catch (err) {
    console.error("orders pick skips list error:", err);
    res.status(500).json({ message: "������ �������� ��������� ������." });
  }
});

app.post("/api/orders/:id/pick-skips", auth, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const lineId = Number(req.body?.lineId);
    const locationRaw = req.body?.locationId;
    const itemRaw = req.body?.itemId;
    const qty = Math.max(0, Math.trunc(Number(req.body?.qty) || 0));
    const reason = String(req.body?.reason || "").trim();
    const comment = String(req.body?.comment || "").trim();

    if (!orderId || Number.isNaN(orderId)) {
      return res.status(400).json({ message: "������������ ID ������." });
    }
    if (!lineId || Number.isNaN(lineId)) {
      return res.status(400).json({ message: "������������ ������ ������." });
    }
    if (!reason) {
      return res.status(400).json({ message: "������� ������� ��������." });
    }
    if (reason.length > 180) {
      return res.status(400).json({ message: "������� �������� ������� ������� (�������� 180 ��������)." });
    }
    if (comment.length > 500) {
      return res.status(400).json({ message: "����������� ������� ������� (�������� 500 ��������)." });
    }

    const locationId =
      locationRaw === null || locationRaw === undefined || locationRaw === ""
        ? null
        : Number(locationRaw);
    const itemId =
      itemRaw === null || itemRaw === undefined || itemRaw === ""
        ? null
        : Number(itemRaw);

    if (locationId !== null && (!locationId || Number.isNaN(locationId))) {
      return res.status(400).json({ message: "������������ ������." });
    }
    if (itemId !== null && (!itemId || Number.isNaN(itemId))) {
      return res.status(400).json({ message: "������������ �����." });
    }

    const item = await prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUnique({
        where: { id: orderId },
        include: {
          lines: { select: { id: true, itemId: true } },
        },
      });
      if (!order) {
        const err = new Error("ORDER_NOT_FOUND");
        err.code = "ORDER_NOT_FOUND";
        throw err;
      }
      if (!["IN_PICKING", "PICKED", "PACKED"].includes(order.status)) {
        const err = new Error("BAD_STATUS");
        err.code = "BAD_STATUS";
        throw err;
      }
      if (
        order.assignedToUserId &&
        order.assignedToUserId !== req.user.id &&
        !isWarehouseManager(req.user)
      ) {
        const err = new Error("NOT_ASSIGNED_TO_YOU");
        err.code = "NOT_ASSIGNED_TO_YOU";
        throw err;
      }

      const orderLine = (order.lines || []).find((row) => row.id === lineId);
      if (!orderLine) {
        const err = new Error("LINE_NOT_FOUND");
        err.code = "LINE_NOT_FOUND";
        throw err;
      }

      const finalItemId = orderLine.itemId || itemId || null;
      if (itemId && orderLine.itemId && Number(orderLine.itemId) !== Number(itemId)) {
        const err = new Error("ITEM_MISMATCH");
        err.code = "ITEM_MISMATCH";
        throw err;
      }

      const existing = await tx.salesOrderPickSkip.findFirst({
        where: {
          orderId,
          lineId,
          itemId: finalItemId,
          locationId,
          status: "ACTIVE",
        },
        orderBy: { id: "desc" },
      });

      const payload = {
        orgId: order.orgId || req.user?.orgId || null,
        orderId,
        lineId,
        itemId: finalItemId,
        locationId,
        qty,
        reason,
        comment: comment || null,
        skippedById: req.user?.id || null,
        restoredById: null,
        restoredAt: null,
        status: "ACTIVE",
      };

      if (existing) {
        return tx.salesOrderPickSkip.update({
          where: { id: existing.id },
          data: payload,
          include: {
            skippedBy: { select: { id: true, name: true, email: true } },
          },
        });
      }

      return tx.salesOrderPickSkip.create({
        data: payload,
        include: {
          skippedBy: { select: { id: true, name: true, email: true } },
        },
      });
    });

    res.json({ ok: true, item });
  } catch (err) {
    if (err.code === "ORDER_NOT_FOUND") {
      return res.status(404).json({ message: "����� �� ������." });
    }
    if (err.code === "LINE_NOT_FOUND") {
      return res.status(404).json({ message: "������ ������ �� �������." });
    }
    if (err.code === "ITEM_MISMATCH") {
      return res.status(400).json({ message: "����� �� ��������� �� ������� ������." });
    }
    if (err.code === "NOT_ASSIGNED_TO_YOU") {
      return res.status(403).json({ message: "����� ��������� �� ������ �����������." });
    }
    if (err.code === "BAD_STATUS") {
      return res.status(400).json({ message: "������� �������� ������ ��� ������� � ������." });
    }
    console.error("orders pick skip create error:", err);
    res.status(500).json({ message: "������ ���������� ��������." });
  }
});

app.post("/api/orders/:id/pick-skips/:skipId/restore", auth, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const skipId = Number(req.params.skipId);
    if (!orderId || Number.isNaN(orderId) || !skipId || Number.isNaN(skipId)) {
      return res.status(400).json({ message: "������������ ���������." });
    }

    const item = await prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUnique({
        where: { id: orderId },
        select: { id: true, assignedToUserId: true },
      });
      if (!order) {
        const err = new Error("ORDER_NOT_FOUND");
        err.code = "ORDER_NOT_FOUND";
        throw err;
      }
      if (
        order.assignedToUserId &&
        order.assignedToUserId !== req.user.id &&
        !isWarehouseManager(req.user)
      ) {
        const err = new Error("NOT_ASSIGNED_TO_YOU");
        err.code = "NOT_ASSIGNED_TO_YOU";
        throw err;
      }

      const skip = await tx.salesOrderPickSkip.findFirst({
        where: {
          id: skipId,
          orderId,
          status: "ACTIVE",
        },
      });
      if (!skip) {
        const err = new Error("SKIP_NOT_FOUND");
        err.code = "SKIP_NOT_FOUND";
        throw err;
      }

      return tx.salesOrderPickSkip.update({
        where: { id: skip.id },
        data: {
          status: "RESTORED",
          restoredAt: new Date(),
          restoredById: req.user?.id || null,
        },
      });
    });

    res.json({ ok: true, item });
  } catch (err) {
    if (err.code === "ORDER_NOT_FOUND") {
      return res.status(404).json({ message: "����� �� ������." });
    }
    if (err.code === "SKIP_NOT_FOUND") {
      return res.status(404).json({ message: "������� �� ������." });
    }
    if (err.code === "NOT_ASSIGNED_TO_YOU") {
      return res.status(403).json({ message: "����� ��������� �� ������ �����������." });
    }
    console.error("orders pick skip restore error:", err);
    res.status(500).json({ message: "������ �������������� ��������." });
  }
});

app.post("/api/orders/:id/pick-skips/restore-all", auth, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    if (!orderId || Number.isNaN(orderId)) {
      return res.status(400).json({ message: "������������ ID ������." });
    }

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUnique({
        where: { id: orderId },
        select: { id: true, assignedToUserId: true },
      });
      if (!order) {
        const err = new Error("ORDER_NOT_FOUND");
        err.code = "ORDER_NOT_FOUND";
        throw err;
      }
      if (
        order.assignedToUserId &&
        order.assignedToUserId !== req.user.id &&
        !isWarehouseManager(req.user)
      ) {
        const err = new Error("NOT_ASSIGNED_TO_YOU");
        err.code = "NOT_ASSIGNED_TO_YOU";
        throw err;
      }

      return tx.salesOrderPickSkip.updateMany({
        where: {
          orderId,
          status: "ACTIVE",
        },
        data: {
          status: "RESTORED",
          restoredAt: new Date(),
          restoredById: req.user?.id || null,
        },
      });
    });

    res.json({ ok: true, count: result.count || 0 });
  } catch (err) {
    if (err.code === "ORDER_NOT_FOUND") {
      return res.status(404).json({ message: "����� �� ������." });
    }
    if (err.code === "NOT_ASSIGNED_TO_YOU") {
      return res.status(403).json({ message: "����� ��������� �� ������ �����������." });
    }
    console.error("orders pick skip restore all error:", err);
    res.status(500).json({ message: "������ �������������� ���������." });
  }
});


app.post("/api/orders/:id/take", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 ID \u0437\u0430\u043a\u0430\u0437\u0430." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUnique({
        where: { id },
        include: {
          assignedToUser: { select: { id: true, name: true, email: true } },
          lines: { select: { pickedQty: true } },
        },
      });
      if (!order) {
        const err = new Error("ORDER_NOT_FOUND");
        err.code = "ORDER_NOT_FOUND";
        throw err;
      }
      if (!["NEW", "IN_PICKING", "PICKED", "PACKED"].includes(order.status)) {
        const err = new Error("ORDER_BAD_STATUS");
        err.code = "ORDER_BAD_STATUS";
        throw err;
      }

      const pickedStarted = (order.lines || []).some((line) => Number(line.pickedQty) > 0);
      if (order.assignedToUserId && order.assignedToUserId !== req.user.id && pickedStarted) {
        const err = new Error("ORDER_ALREADY_TAKEN");
        err.code = "ORDER_ALREADY_TAKEN";
        err.assigneeName =
          order.assignedToUser?.name || order.assignedToUser?.email || "\u0434\u0440\u0443\u0433\u0438\u043c \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u043e\u043c";
        throw err;
      }

      return tx.salesOrder.update({
        where: { id },
        data: {
          assignedToUserId: req.user.id,
          status:
            order.status === "NEW" || order.status === "IN_PICKING"
              ? "IN_PICKING"
              : order.status,
          takenAt: order.takenAt || new Date(),
        },
        include: {
          assignedToUser: { select: { id: true, name: true, email: true } },
          lines: { include: { item: true }, orderBy: { id: "asc" } },
        },
      });
    });

    res.json({ ok: true, order: updated });
  } catch (err) {
    if (err.code === "ORDER_NOT_FOUND") {
      return res.status(404).json({ message: "\u0417\u0430\u043a\u0430\u0437 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d." });
    }
    if (err.code === "ORDER_BAD_STATUS") {
      return res.status(400).json({ message: "\u0417\u0430\u043a\u0430\u0437 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u0434\u043b\u044f \u043e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0438." });
    }
    if (err.code === "ORDER_ALREADY_TAKEN") {
      return res.status(409).json({
        message: `\u0417\u0430\u043a\u0430\u0437 \u0443\u0436\u0435 \u0432 \u0440\u0430\u0431\u043e\u0442\u0435 \u0443 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430: ${err.assigneeName}.`,
      });
    }
    console.error("orders take error:", err);
    res.status(500).json({ message: "\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0440\u0438 \u0432\u0437\u044f\u0442\u0438\u0438 \u0437\u0430\u043a\u0430\u0437\u0430." });
  }
});

app.post("/api/orders/:id/release", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 ID \u0437\u0430\u043a\u0430\u0437\u0430." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUnique({
        where: { id },
        include: {
          lines: { select: { pickedQty: true } },
        },
      });
      if (!order) {
        const err = new Error("ORDER_NOT_FOUND");
        err.code = "ORDER_NOT_FOUND";
        throw err;
      }
      if (!["NEW", "IN_PICKING", "PICKED", "PACKED"].includes(order.status)) {
        const err = new Error("ORDER_BAD_STATUS");
        err.code = "ORDER_BAD_STATUS";
        throw err;
      }

      if (!order.assignedToUserId) {
        return tx.salesOrder.findUnique({
          where: { id },
          include: {
            assignedToUser: { select: { id: true, name: true, email: true } },
            lines: { include: { item: true }, orderBy: { id: "asc" } },
          },
        });
      }

      const canManage =
        order.assignedToUserId === req.user.id || isWarehouseManager(req.user);
      if (!canManage) {
        const err = new Error("NOT_ALLOWED");
        err.code = "NOT_ALLOWED";
        throw err;
      }

      const pickedStarted = (order.lines || []).some((line) => Number(line.pickedQty) > 0);
      const nextStatus =
        order.status === "IN_PICKING" && !pickedStarted ? "NEW" : order.status;

      return tx.salesOrder.update({
        where: { id },
        data: {
          assignedToUserId: null,
          status: nextStatus,
        },
        include: {
          assignedToUser: { select: { id: true, name: true, email: true } },
          lines: { include: { item: true }, orderBy: { id: "asc" } },
        },
      });
    });

    res.json({ ok: true, order: updated });
  } catch (err) {
    if (err.code === "ORDER_NOT_FOUND") {
      return res.status(404).json({ message: "\u0417\u0430\u043a\u0430\u0437 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d." });
    }
    if (err.code === "ORDER_BAD_STATUS") {
      return res.status(400).json({ message: "\u0417\u0430\u043a\u0430\u0437 \u043d\u0435\u043b\u044c\u0437\u044f \u0432\u0435\u0440\u043d\u0443\u0442\u044c \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u044c \u0432 \u0442\u0435\u043a\u0443\u0449\u0435\u043c \u0441\u0442\u0430\u0442\u0443\u0441\u0435." });
    }
    if (err.code === "NOT_ALLOWED") {
      return res.status(403).json({ message: "\u042d\u0442\u043e\u0442 \u0437\u0430\u043a\u0430\u0437 \u0437\u0430\u043a\u0440\u0435\u043f\u043b\u0435\u043d \u0437\u0430 \u0434\u0440\u0443\u0433\u0438\u043c \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u043e\u043c." });
    }
    console.error("orders release error:", err);
    res.status(500).json({ message: "\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0440\u0438 \u0432\u043e\u0437\u0432\u0440\u0430\u0442\u0435 \u0437\u0430\u043a\u0430\u0437\u0430 \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u044c." });
  }
});

app.get("/api/orders/:id/pick-plan", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "???????????? ID ??????." });
    }
    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: { assignedToUser: { select: { id: true } } },
    });
    if (!order) return res.status(404).json({ message: "????? ?? ??????." });
    if (order.assignedToUserId && order.assignedToUserId !== req.user.id) {
      return res.status(403).json({ message: "????? ????????? ?? ?????? ???????????." });
    }

    const plan = await buildOrderPickPlan(id);
    res.json({ items: plan || [] });
  } catch (err) {
    console.error("orders pick plan error:", err);
    res.status(500).json({ message: "?????? ?????????? ???????? ??????." });
  }
});

app.post("/api/orders/:id/pick-confirm", auth, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const { lineId, locationId, qty } = req.body || {};
    const line = Number(lineId);
    const location = Number(locationId);
    const amount = Math.trunc(Number(qty));

    if (!orderId || !line || !location || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "������������ ��������� �������������." });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUnique({
        where: { id: orderId },
        include: { lines: true },
      });
      if (!order) {
        const err = new Error("ORDER_NOT_FOUND");
        err.code = "ORDER_NOT_FOUND";
        throw err;
      }
      if (order.assignedToUserId && order.assignedToUserId !== req.user.id) {
        const err = new Error("NOT_ASSIGNED_TO_YOU");
        err.code = "NOT_ASSIGNED_TO_YOU";
        throw err;
      }
      if (!["IN_PICKING", "PICKED"].includes(order.status)) {
        const err = new Error("BAD_STATUS");
        err.code = "BAD_STATUS";
        throw err;
      }

      const orderLine = order.lines.find((row) => row.id === line);
      if (!orderLine) {
        const err = new Error("LINE_NOT_FOUND");
        err.code = "LINE_NOT_FOUND";
        throw err;
      }
      let actualItemId = orderLine.itemId;
      if (!actualItemId) {
        const linkedItem = await findStockItemForOrderLine(tx, {
          sku: orderLine.requestedSku,
          name: orderLine.requestedName,
        });
        if (linkedItem) {
          actualItemId = linkedItem.id;
          await tx.salesOrderLine.update({
            where: { id: orderLine.id },
            data: { itemId: linkedItem.id },
          });
        }
      }
      if (!actualItemId) {
        const err = new Error("LINE_ITEM_NOT_LINKED");
        err.code = "LINE_ITEM_NOT_LINKED";
        throw err;
      }

      const remaining = Math.max(0, (Number(orderLine.qty) || 0) - (Number(orderLine.pickedQty) || 0));
      if (amount > remaining) {
        const err = new Error("QTY_EXCEEDS_REMAINING");
        err.code = "QTY_EXCEEDS_REMAINING";
        throw err;
      }

      const currentLocationQty = await stockService.getItemLocationQty(
        tx,
        actualItemId,
        location
      );
      if (currentLocationQty < amount) {
        const lotsAgg = await tx.warehouseReceivingLine.aggregate({
          where: {
            itemId: actualItemId,
            locationId: location,
            remainingQty: { gt: 0 },
            status: { in: ["PLACED", "PENDING"] },
          },
          _sum: { remainingQty: true },
        });
        const lotsQty = Number(lotsAgg?._sum?.remainingQty) || 0;
        const placement = await tx.warehousePlacement.findUnique({
          where: { itemId_locationId: { itemId: actualItemId, locationId: location } },
          select: { qty: true },
        });
        const placementQty = Number(placement?.qty) || 0;
        const expectedQty = Math.max(lotsQty, placementQty);
        const syncDelta = Math.max(0, expectedQty - currentLocationQty);
        if (syncDelta > 0) {
          await stockService.createMovementInTx(tx, {
            type: "ADJUSTMENT",
            itemId: actualItemId,
            qty: syncDelta,
            locationId: location,
            comment: `������������� �������� ����� ������� ������ ${order.orderNumber}`,
            refType: "ORDER",
            refId: String(orderId),
            userId: req.user?.id || null,
          });
        }
      }

      await stockService.createMovementInTx(tx, {
        opId: `ORDER:${orderId}:LINE:${line}:${Date.now()}`,
        type: "ISSUE",
        itemId: actualItemId,
        qty: amount,
        locationId: location,
        fromLocationId: location,
        comment: `����� �� ������ ${order.orderNumber}`,
        refType: "ORDER",
        refId: String(orderId),
        userId: req.user?.id || null,
      });

      await tx.salesOrderLine.update({
        where: { id: line },
        data: { pickedQty: (Number(orderLine.pickedQty) || 0) + amount },
      });

      await tx.salesOrderPickSkip.updateMany({
        where: {
          orderId,
          lineId: line,
          status: "ACTIVE",
          AND: [
            {
              OR: [{ locationId: null }, { locationId: location }],
            },
            {
              OR: [{ itemId: null }, { itemId: actualItemId }],
            },
          ],
        },
        data: {
          status: "RESTORED",
          restoredAt: new Date(),
          restoredById: req.user?.id || null,
        },
      });

      const freshLines = await tx.salesOrderLine.findMany({
        where: { orderId },
        orderBy: { id: "asc" },
      });
      const fullyPicked = freshLines.every((row) => Number(row.pickedQty) >= Number(row.qty));
      if (fullyPicked) {
        await tx.salesOrder.update({
          where: { id: orderId },
          data: { status: "PICKED", pickedAt: new Date() },
        });
      }

      return tx.salesOrder.findUnique({
        where: { id: orderId },
        include: {
          assignedToUser: { select: { id: true, name: true, email: true } },
          lines: { include: { item: true }, orderBy: { id: "asc" } },
        },
      });
    });

    res.json({ ok: true, order: updated });
  } catch (err) {
    if (err.code === "ORDER_NOT_FOUND") return res.status(404).json({ message: "����� �� ������." });
    if (err.code === "LINE_NOT_FOUND") return res.status(404).json({ message: "������ ������ �� �������." });
    if (err.code === "NOT_ASSIGNED_TO_YOU") return res.status(403).json({ message: "����� ��������� �� ������ �����������." });
    if (err.code === "BAD_STATUS") return res.status(400).json({ message: "����� �� � ������� ������." });
    if (err.code === "QTY_EXCEEDS_REMAINING") return res.status(400).json({ message: "���������� ��������� ������� �� ������." });
    if (err.code === "LINE_ITEM_NOT_LINKED") return res.status(400).json({ message: "������ ������ �� ������� � �������." });
    if (err.code === "INSUFFICIENT_QTY") return res.status(400).json({ message: "������������ ������� � ������." });
    console.error("orders pick confirm error:", err);
    res.status(500).json({ message: "������ ������������� ������." });
  }
});


app.post("/api/orders/:id/pack", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { boxCode, boxType } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "???????????? ID ??????." });
    }
    if (!boxCode) {
      return res.status(400).json({ message: "??????? ????? ???????." });
    }

    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!order) return res.status(404).json({ message: "????? ?? ??????." });
    if (order.assignedToUserId && order.assignedToUserId !== req.user.id) {
      return res.status(403).json({ message: "????? ????????? ?? ?????? ???????????." });
    }

    const allPicked = order.lines.every((row) => Number(row.pickedQty) >= Number(row.qty));
    if (!allPicked) {
      return res.status(400).json({ message: "??????? ????????? ?????." });
    }

    const updated = await prisma.salesOrder.update({
      where: { id },
      data: {
        status: "PACKED",
        boxCode: String(boxCode),
        boxType: boxType ? String(boxType) : null,
        packedAt: new Date(),
      },
      include: {
        assignedToUser: { select: { id: true, name: true, email: true } },
        lines: { include: { item: true }, orderBy: { id: "asc" } },
      },
    });

    res.json({ ok: true, order: updated });
  } catch (err) {
    console.error("orders pack error:", err);
    res.status(500).json({ message: "?????? ???????? ??????." });
  }
});

app.get("/api/orders/:id/label", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "???????????? ID ??????." });
    }
    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: {
        lines: { include: { item: true }, orderBy: { id: "asc" } },
      },
    });
    if (!order) return res.status(404).json({ message: "????? ?? ??????." });
    if (order.assignedToUserId && order.assignedToUserId !== req.user.id && !isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "????? ????????? ?? ?????? ???????????." });
    }

    const html = buildOrderLabelHtml(order);
    await prisma.salesOrder.update({
      where: { id },
      data: { labelPrintedAt: new Date() },
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error("orders label error:", err);
    res.status(500).json({ message: "?????? ?????? ????????." });
  }
});

app.post("/api/orders/:id/complete", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "������������ ID ������." });
    }

    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!order) return res.status(404).json({ message: "����� �� ������." });
    if (order.assignedToUserId && order.assignedToUserId !== req.user.id) {
      return res.status(403).json({ message: "����� ��������� �� ������ �����������." });
    }
    if (!["PICKED", "PACKED", "READY_TO_SHIP"].includes(order.status)) {
      return res.status(400).json({ message: "������� ��������� �����." });
    }

    const updated = await prisma.salesOrder.update({
      where: { id },
      data: {
        status: "READY_TO_SHIP",
        completedAt: new Date(),
      },
      include: {
        assignedToUser: { select: { id: true, name: true, email: true } },
        lines: { include: { item: true }, orderBy: { id: "asc" } },
      },
    });

    await prisma.salesOrderPickSkip.updateMany({
      where: {
        orderId: id,
        status: "ACTIVE",
      },
      data: {
        status: "RESTORED",
        restoredAt: new Date(),
        restoredById: req.user?.id || null,
      },
    });

    res.json({ ok: true, order: updated });
  } catch (err) {
    console.error("orders complete error:", err);
    res.status(500).json({ message: "������ ���������� ������." });
  }
});


app.post("/api/orders/:id/passport-printed", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "������������ ID ������." });
    }

    const order = await prisma.salesOrder.findUnique({
      where: { id },
    });
    if (!order) return res.status(404).json({ message: "����� �� ������." });
    if (order.assignedToUserId && order.assignedToUserId !== req.user.id && !isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "����� ��������� �� ������ �����������." });
    }
    if (!["PICKED", "PACKED", "READY_TO_SHIP", "SHIPPED"].includes(order.status)) {
      return res.status(400).json({ message: "������ �������� �������� ����� ������." });
    }

    const now = new Date();
    const updated = await prisma.salesOrder.update({
      where: { id },
      data: {
        labelPrintedAt: now,
        passportPrintedAt: now,
        passportPrintedById: req.user?.id || null,
        passportPrintCount: { increment: 1 },
      },
      include: {
        assignedToUser: { select: { id: true, name: true, email: true } },
        lines: { include: { item: true }, orderBy: { id: "asc" } },
      },
    });

    res.json({ ok: true, order: updated });
  } catch (err) {
    console.error("orders passport printed error:", err);
    res.status(500).json({ message: "������ �������� ������ ��������." });
  }
});


app.get("/api/supplier-trucks", auth, async (req, res) => {
  try {
    const onlyActive = req.query.onlyActive === "1";
    const { dateFrom, dateTo } = req.query;

    const where = {};

    // фильтр по статусу
    if (onlyActive) {
      where.status = { in: ["IN_QUEUE", "UNLOADING"] };
    }

    // фильтр по дате прибытия (колонка "Прибытие")
    // dateFrom и dateTo приходят в формате "YYYY-MM-DD"
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (!Number.isNaN(from.getTime())) {
        // начало дня
        from.setHours(0, 0, 0, 0);
        where.arrivalAt = { ...(where.arrivalAt || {}), gte: from };
      }
    }

    if (dateTo) {
      const to = new Date(dateTo);
      if (!Number.isNaN(to.getTime())) {
        // конец дня
        to.setHours(23, 59, 59, 999);
        where.arrivalAt = { ...(where.arrivalAt || {}), lte: to };
      }
    }

    const list = await prisma.supplierTruck.findMany({
      where,
      orderBy: [
        { status: "asc" },
        { arrivalAt: "asc" },
      ],
    });

    res.json(list);
  } catch (err) {
    console.error("supplier trucks list error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при загрузке очереди машин" });
  }
});

// регистрация машины в очереди
app.post("/api/supplier-trucks", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const {
      supplier,
      orderNumber,
      deliveryDate,
      vehicleBrand,
      truckNumber,
      driverName,
      driverPhone,
      cargo,
      note,
      directImport,
    } = req.body || {};

    if (!supplier && !truckNumber && !driverName) {
      return res.status(400).json({
        message:
          "Укажите хотя бы поставщика, номер машины или водителя для регистрации в очереди",
      });
    }

    const truck = await prisma.supplierTruck.create({
      data: {
        supplier: supplier?.trim() || null,
        orderNumber: orderNumber?.trim() || null,
        deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
        vehicleBrand: vehicleBrand?.trim() || null,
        truckNumber: truckNumber?.trim() || null,
        driverName: driverName?.trim() || null,
        driverPhone: driverPhone?.trim() || null,
        cargo: cargo?.trim() || null,
        note: note || null,
        directImport: Boolean(directImport),
        // arrivalAt и status поставятся сами (дефолты)
      },
    });

    res.status(201).json(truck);
  } catch (err) {
    console.error("create supplier truck error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при регистрации машины в очереди" });
  }
});

// смена статуса (в очереди -> на разгрузке -> выехал)
app.put("/api/supplier-trucks/:id/status", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Нет прав" });
    }

    const id = Number(req.params.id);
    const { status, gate } = req.body || {};

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный ID записи" });
    }

    if (!["IN_QUEUE", "UNLOADING", "DONE"].includes(status)) {
      return res.status(400).json({ message: "Недопустимый статус" });
    }

    const truck = await prisma.supplierTruck.findUnique({
      where: { id },
    });

    if (!truck) {
      return res.status(404).json({ message: "Запись не найдена" });
    }

    const data = { status };
    const now = new Date();

    // когда ставим на разгрузку — фиксируем время и ворота
    if (status === "UNLOADING" && !truck.unloadStartAt) {
      data.unloadStartAt = now;
      if (gate) data.gate = gate;
    }

    // когда выехал — фиксируем время выезда
    if (status === "DONE" && !truck.unloadEndAt) {
      data.unloadEndAt = now;
    }

    const updated = await prisma.supplierTruck.update({
      where: { id },
      data,
    });

    res.json(updated);
  } catch (err) {
    console.error("update supplier truck status error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при смене статуса машины" });
  }
});

// ================== ПЕРИОДИЧЕСКИЕ ЗАДАЧИ ==================

// дата, за которую уже отправлен ежедневный отчёт по остаткам (формат "YYYY-MM-DD")
let lastLowStockReportDate = null;

// проверка каждые 60 секунд
let backgroundTasksStarted = false;

async function checkDbReadyForBackground() {
  try {
    await prisma.$queryRaw`SELECT "orgId" FROM "SafetyAssignment" LIMIT 1`;
    await prisma.$queryRaw`SELECT "orgId" FROM "WarehouseTask" LIMIT 1`;
    return true;
  } catch (err) {
    console.error("[DB ready check] ??????:", err?.message || err);
    return false;
  }
}

const AUTO_REORDER_INTERVAL_MS = Number(
  process.env.AUTO_REORDER_INTERVAL_MS || 5 * 60 * 1000
);
const AUTO_REORDER_REMINDER_MS = Number(
  process.env.AUTO_REORDER_REMINDER_MS || 24 * 60 * 60 * 1000
);

async function getItemTotalQty(itemId) {
  const movements = await prisma.stockMovement.findMany({
    where: { itemId },
    select: { type: true, quantity: true },
  });
  let qty = 0;
  for (const m of movements) {
    if (m.type === "INCOME" || m.type === "ADJUSTMENT") {
      qty += Number(m.quantity);
    } else if (m.type === "ISSUE") {
      qty -= Number(m.quantity);
    }
  }
  return Math.round(qty);
}

async function ensureOwnerAdminAccount() {
  const normalizedEmail = OWNER_PRIMARY_EMAIL.trim().toLowerCase();
  const ownerName = OWNER_PRIMARY_NAME;
  const ownerHash = await bcrypt.hash(OWNER_PRIMARY_PASSWORD, 10);
  const ownerOrg = await getOrCreateOrganizationByCode(
    "platform-owner",
    "Владелец платформы"
  );

  const rows = await prisma.$queryRaw`
    SELECT "id", "email" FROM "User"
    WHERE LOWER(TRIM("email")) = LOWER(${normalizedEmail})
    LIMIT 1
  `;
  const ownerId = Number(rows?.[0]?.id || 0);

  if (ownerId) {
    await prisma.user.update({
      where: { id: ownerId },
      data: {
        email: normalizedEmail,
        password: ownerHash,
        passwordHash: ownerHash,
        passwordVisible: OWNER_PRIMARY_PASSWORD,
        name: ownerName,
        role: "ADMIN",
        isActive: true,
        orgId: ownerOrg.id,
        emailVerifiedAt: new Date(),
      },
    });
    console.log(
      `[OWNER_RECOVERY] owner account ensured: ${normalizedEmail} (fixed credentials applied)`
    );
    return;
  }

  await prisma.user.create({
    data: {
      email: normalizedEmail,
      password: ownerHash,
      passwordHash: ownerHash,
      passwordVisible: OWNER_PRIMARY_PASSWORD,
      name: ownerName,
      role: "ADMIN",
      isActive: true,
      orgId: ownerOrg.id,
      emailVerifiedAt: new Date(),
    },
  });
  console.warn(`[OWNER_RECOVERY] created owner account ${normalizedEmail}`);
}

async function ensureLegacyTenantBackfill() {
  const legacyOrg = await getOrCreateOrganizationByCode(
    "legacy-tenant",
    "Основной клиент"
  );

  await prisma.user.updateMany({
    where: {
      orgId: null,
      email: { not: OWNER_PRIMARY_EMAIL },
    },
    data: { orgId: legacyOrg.id },
  });

  const delegates = [
    "inviteToken",
    "employee",
    "hrLeaveApplication",
    "safetyInstruction",
    "safetyAssignment",
    "leaveRequest",
    "paymentRequest",
    "payment",
    "warehouseRequest",
    "warehouseRequestItem",
    "warehouseTask",
    "purchaseOrder",
    "purchaseOrderItem",
    "item",
    "warehouseLocation",
    "warehouseReceivingLine",
    "warehousePlacement",
    "stockMovement",
    "binAuditSession",
    "binAuditEvent",
    "stockDiscrepancy",
    "stockRevision",
    "stockRevisionItem",
    "receivingDiscrepancy",
    "supplier",
    "supplierTruck",
    "salesOrder",
    "salesOrderLine",
  ];

  for (const delegate of delegates) {
    if (typeof prisma[delegate]?.updateMany === "function") {
      await prisma[delegate].updateMany({
        where: { orgId: null },
        data: { orgId: legacyOrg.id },
      });
    }
  }

  const unboundProfiles = await prisma.orgProfile.findMany({
    where: {
      orgId: null,
      warehouseBootstrapKey: null,
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (unboundProfiles.length > 0) {
    await prisma.orgProfile.update({
      where: { id: unboundProfiles[0].id },
      data: { orgId: legacyOrg.id },
    });
    if (unboundProfiles.length > 1) {
      await prisma.orgProfile.deleteMany({
        where: {
          id: { in: unboundProfiles.slice(1).map((row) => row.id) },
        },
      });
    }
  }
}

const DEPLOY_REVISION_KEY =
  process.env.RENDER_GIT_COMMIT ||
  process.env.SOURCE_VERSION ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  "local-dev";
const RESET_INVENTORY_ON_DEPLOY =
  String(process.env.RESET_INVENTORY_ON_DEPLOY || "").toLowerCase() ===
  "true";
const ALLOW_PRODUCTION_DEPLOY_RESET =
  String(process.env.ALLOW_PRODUCTION_DEPLOY_RESET || "").toLowerCase() ===
  "true";
const IS_PRODUCTION_ENV =
  String(process.env.NODE_ENV || "").toLowerCase() === "production";

async function ensureWarehouseItemsResetForCurrentRevision() {
  console.log(
    "[WAREHOUSE_BOOTSTRAP] auto-reset on deploy is disabled in SaaS mode."
  );
  return;

  if (
    IS_PRODUCTION_ENV &&
    RESET_INVENTORY_ON_DEPLOY &&
    !ALLOW_PRODUCTION_DEPLOY_RESET
  ) {
    console.warn(
      "[WAREHOUSE_BOOTSTRAP] blocked in production (set ALLOW_PRODUCTION_DEPLOY_RESET=true only for one-time maintenance)"
    );
    return;
  }

  if (!RESET_INVENTORY_ON_DEPLOY) {
    console.log(
      `[WAREHOUSE_BOOTSTRAP] skipped (set RESET_INVENTORY_ON_DEPLOY=true to enable reset on deploy)`
    );
    return;
  }

  const profile = await prisma.orgProfile.findFirst({
    where: { orgId: null },
    select: { id: true, warehouseBootstrapKey: true },
  });

  if (profile?.warehouseBootstrapKey === DEPLOY_REVISION_KEY) return;

  const result = await prisma.$transaction(async (tx) => {
    await tx.salesOrderLine.updateMany({
      where: { itemId: { not: null } },
      data: { itemId: null },
    });

    await tx.receivingDiscrepancy.updateMany({
      where: { itemId: { not: null } },
      data: { itemId: null },
    });

    await tx.stockRevisionItem.deleteMany({});
    await tx.stockDiscrepancy.deleteMany({});
    await tx.warehousePlacement.deleteMany({});
    await tx.warehouseReceivingLine.deleteMany({});
    await tx.stockMovement.deleteMany({});
    await tx.purchaseOrderItem.deleteMany({});
    const deletedItems = await tx.item.deleteMany({});

    if (profile?.id) {
      await tx.orgProfile.update({
        where: { id: profile.id },
        data: { warehouseBootstrapKey: DEPLOY_REVISION_KEY },
      });
    } else {
      await tx.orgProfile.create({
        data: {
          orgId: null,
          orgName: "",
          legalAddress: "",
          actualAddress: "",
          inn: "",
          kpp: "",
          phone: "",
          warehouseBootstrapKey: DEPLOY_REVISION_KEY,
        },
      });
    }

    return { deletedItems: deletedItems.count };
  });

  console.log(
    `[WAREHOUSE_BOOTSTRAP] inventory reset for revision "${DEPLOY_REVISION_KEY}", deleted items: ${result.deletedItems}`
  );
}

async function checkAutoReorders() {
  try {
    const items = await prisma.item.findMany({
      where: {
        autoReorderEnabled: true,
        autoReorderMin: { not: null },
        autoReorderSupplierId: { not: null },
      },
      include: {
        autoReorderSupplier: true,
      },
    });
    if (!items.length) return;

    const adminUsers = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      select: { email: true, name: true },
    });
    const adminEmails = adminUsers
      .map((u) => u.email)
      .filter(Boolean);

    for (const item of items) {
      const totalQty = await getItemTotalQty(item.id);
      const minQty = Number(item.autoReorderMin);

      if (item.autoReorderActive && totalQty > minQty) {
        await prisma.item.update({
          where: { id: item.id },
          data: {
            autoReorderActive: false,
            autoReorderLastReminderAt: null,
          },
        });
        continue;
      }

      if (item.autoReorderActive && totalQty <= minQty) {
        const lastReminder = item.autoReorderLastReminderAt
          ? new Date(item.autoReorderLastReminderAt).getTime()
          : 0;
        if (Date.now() - lastReminder >= AUTO_REORDER_REMINDER_MS) {
          const subject = `?????????: ??????????? ?? ?????? "${item.name}"`;
          const text =
            `??????? ?????? "${item.name}" ??-???????? ???? ????????.\n` +
            `??????? ???????: ${totalQty}\n???????: ${minQty}\n` +
            `????????? ???????. ????????? ????? ??????????.`;
          for (const email of adminEmails) {
            await sendAutoReorderEmail({ to: email, subject, text });
          }
          await prisma.item.update({
            where: { id: item.id },
            data: { autoReorderLastReminderAt: new Date() },
          });
        }
        continue;
      }

      if (totalQty > minQty) continue;

      const supplier = item.autoReorderSupplier;
      if (!supplier) continue;

      const targetMax = Number(item.maxStock || item.autoReorderMin || 0);
      const orderQty = Math.max(targetMax - totalQty, 1);

      const adminUser = await prisma.user.findFirst({
        where: { role: "ADMIN", isActive: true },
        select: { id: true },
      });
      if (!adminUser) {
        console.error("AUTO_REORDER: admin user not found");
        continue;
      }

      const nextNumber = await getNextPurchaseOrderNumber(item.orgId || null);

      const order = await prisma.purchaseOrder.create({
        data: {
          orgId: item.orgId || null,
          number: nextNumber,
          date: new Date(),
          status: "DRAFT",
          comment: `????????? ?? ?????? "${item.name}"`,
          supplierId: supplier.id,
          createdById: adminUser.id,
          items: {
            create: [
              {
                orgId: item.orgId || null,
                itemId: item.id,
                quantity: orderQty,
                price: item.defaultPrice || 0,
              },
            ],
          },
        },
      });

      await prisma.item.update({
        where: { id: item.id },
        data: {
          autoReorderActive: true,
          autoReorderLastTriggeredAt: new Date(),
          autoReorderLastReminderAt: null,
          autoReorderLastOrderId: order.id,
        },
      });

      const supplierEmail =
        item.autoReorderContactEmail || supplier.email || null;
      const subject = `?????????: ${item.name}`;
      const text =
        item.autoReorderMessage ||
        `?????? ???????? ???????? ?????? "${item.name}".\n` +
          `??????????: ${orderQty}\n` +
          `??????? ???????: ${totalQty}\n` +
          `???????: ${minQty}\n` +
          `???????: ${item.autoReorderContactName || "?????????????"}\n`;

      if (supplierEmail) {
        await sendAutoReorderEmail({ to: supplierEmail, subject, text });
      }

      for (const email of adminEmails) {
        await sendAutoReorderEmail({
          to: email,
          subject,
          text:
            `?????? ????????? ?? ????? "${item.name}".\n` +
            `??????????: ${orderQty}\n` +
            `?????????: ${supplier.name}\n` +
            `?????: ${nextNumber}`,
        });
      }
    }
  } catch (err) {
    console.error("AUTO_REORDER_CHECK_ERROR:", err);
  }
}

async function startBackgroundTasks() {
  if (backgroundTasksStarted) return;
  const ready = await checkDbReadyForBackground();
  if (!ready) {
    console.error(
      "[DB ready check] ???? ?? ??????, ??????? ?????? ?? ??????????? (????????? db:deploy)."
    );
    return;
  }

  backgroundTasksStarted = true;
  console.log("[DB ready check] OK, ???? ??????.");

  setInterval(sendSafetyReminders, 1000 * 60 * 60); // ??? ? ???
  sendSafetyReminders();

  setInterval(checkAutoReorders, AUTO_REORDER_INTERVAL_MS);
  checkAutoReorders();

  setInterval(() => {
    // 1) ??????????? ?? ??????? ??????
    checkWarehouseTaskNotifications().catch((err) =>
      console.error("?????? ? checkWarehouseTaskNotifications:", err)
    );

    // 2) ? 09:00 ? 18:00 ?????????? ?????? ?? ?????? ????????
    const now = new Date();
    const hours = now.getHours(); // 0..23
    const minutes = now.getMinutes(); // 0..59
    const todayKey = now.toISOString().slice(0, 10); // "YYYY-MM-DD"

    if (hours === 18 && minutes === 0 && lastLowStockReportDate !== todayKey) {
      lastLowStockReportDate = todayKey;

      sendDailyLowStockSummary().catch((err) =>
        console.error("?????? ? sendDailyLowStockSummary:", err)
      );
    }
  }, 60 * 1000);
}

app.post("/api/warehouse/stock/adjustment", requireAdmin, async (req, res) => {
  try {
    const itemId = Number(req.body?.itemId);
    const delta = Math.trunc(Number(req.body?.delta));
    const reason = String(req.body?.reason || "").trim();

    if (!itemId || Number.isNaN(itemId)) {
      return res.status(400).json({ message: "Укажите товар для корректировки." });
    }
    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({
        message: "Количество корректировки должно быть ненулевым целым числом.",
      });
    }
    if (!reason) {
      return res.status(400).json({ message: "Укажите причину корректировки." });
    }

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.item.findUnique({
        where: { id: itemId },
        select: { id: true, name: true, sku: true, unit: true, category: true },
      });

      if (!item || item.category !== "STOCK") {
        const err = new Error("ITEM_NOT_FOUND");
        err.code = "ITEM_NOT_FOUND";
        throw err;
      }

      const rows = await tx.stockMovement.findMany({
        where: { itemId, locationId: { not: null } },
        select: { locationId: true, type: true, quantity: true },
        orderBy: [{ locationId: "asc" }, { createdAt: "asc" }],
      });

      const byLocation = new Map();
      for (const row of rows) {
        const locationId = Number(row.locationId);
        if (!locationId) continue;
        const qty = Number(row.quantity) || 0;
        const prev = byLocation.get(locationId) || 0;
        if (row.type === "INCOME" || row.type === "ADJUSTMENT") {
          byLocation.set(locationId, prev + qty);
        } else if (row.type === "ISSUE") {
          byLocation.set(locationId, prev - qty);
        }
      }

      const balances = Array.from(byLocation.entries()).map(([locationId, qty]) => ({
        locationId: Number(locationId),
        qty: Number(qty) || 0,
      }));
      const totalBefore = balances.reduce((sum, row) => sum + row.qty, 0);
      const positiveBalances = balances
        .filter((row) => row.qty > 0)
        .sort((a, b) => b.qty - a.qty);

      if (delta < 0 && Math.abs(delta) > totalBefore) {
        const err = new Error("INSUFFICIENT_STOCK");
        err.code = "INSUFFICIENT_STOCK";
        err.current = Math.max(0, Math.round(totalBefore));
        throw err;
      }

      let affectedLocations = 0;

      if (delta > 0) {
        const receivingLocationId = await getReceivingLocationId(tx);
        await stockService.createMovementInTx(tx, {
          opId: `ADMIN_ADJ:${itemId}:${Date.now()}:PLUS`,
          type: "ADJUSTMENT",
          itemId,
          qty: delta,
          locationId: receivingLocationId,
          comment: `Служебная корректировка (+): ${reason}`,
          refType: "ADMIN_ADJUSTMENT",
          refId: String(itemId),
          userId: req.user?.id || null,
        });
        affectedLocations = 1;
      } else {
        let remaining = Math.abs(delta);
        for (const row of positiveBalances) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, Math.trunc(row.qty));
          if (take <= 0) continue;
          await stockService.createMovementInTx(tx, {
            opId: `ADMIN_ADJ:${itemId}:${row.locationId}:${Date.now()}:${remaining}`,
            type: "ADJUSTMENT",
            itemId,
            qty: -take,
            locationId: row.locationId,
            comment: `Служебная корректировка (-): ${reason}`,
            refType: "ADMIN_ADJUSTMENT",
            refId: String(itemId),
            userId: req.user?.id || null,
          });
          remaining -= take;
          affectedLocations += 1;
        }

        if (remaining > 0) {
          const err = new Error("INSUFFICIENT_STOCK");
          err.code = "INSUFFICIENT_STOCK";
          err.current = Math.max(
            0,
            Math.round(totalBefore - Math.abs(delta) + remaining)
          );
          throw err;
        }
      }

      return {
        item,
        totalBefore: Math.round(totalBefore),
        totalAfter: Math.round(totalBefore + delta),
        delta,
        affectedLocations,
      };
    });

    return res.json({
      ok: true,
      message: "Корректировка проведена.",
      item: result.item,
      delta: result.delta,
      stockBefore: result.totalBefore,
      stockAfter: result.totalAfter,
      affectedLocations: result.affectedLocations,
    });
  } catch (err) {
    if (err.code === "ITEM_NOT_FOUND") {
      return res.status(404).json({ message: "Товар не найден." });
    }
    if (err.code === "INSUFFICIENT_STOCK") {
      return res.status(400).json({
        message: `Недостаточно остатка для списания. Доступно: ${Number(err.current) || 0}.`,
      });
    }
    console.error("warehouse stock adjustment error:", err);
    return res
      .status(500)
      .json({ message: "Ошибка сервера при корректировке остатков." });
  }
});

// запуск long polling Telegram (один экземпляр)
startTelegramPolling().catch((err) =>
  console.error("Ошибка при запуске startTelegramPolling:", err)
);

// ================== ЗАПУСК СЕРВЕРА ==================

const PORT = process.env.PORT || 3001;

async function bootstrapServer() {
  try {
    await ensureOwnerAdminAccount();
  } catch (err) {
    console.error("[OWNER_RECOVERY] error:", err);
  }

  try {
    await ensureLegacyTenantBackfill();
  } catch (err) {
    console.error("[TENANT_BACKFILL] error:", err);
  }

  try {
    await ensureWarehouseItemsResetForCurrentRevision();
  } catch (err) {
    console.error("[WAREHOUSE_BOOTSTRAP] reset error:", err);
  }

  app.listen(PORT, () => {
    console.log(`🚀 API запущен: http://localhost:${PORT}`);
  });

  startBackgroundTasks().catch((err) =>
    console.error("[DB ready check] ошибка запуска фоновых задач:", err)
  );
}

bootstrapServer().catch((err) =>
  console.error("Ошибка запуска bootstrapServer:", err)
);
