import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import multer from "multer";
import crypto from "crypto";
import nodemailer from "nodemailer";
import webpush from "web-push";
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
app.use(express.json({ limit: "6mb" }));
app.use((req, res, next) => {
  requestContext.run(
    { orgId: null, isSystemOwner: false, skipTenantScope: false },
    () => next()
  );
});

// ================== JWT / АВТОРИЗАЦИЯ ==================

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key"; // в .env в бою
const JWT_EXPIRES_IN = "7d";
const MARKETING_UNSUBSCRIBE_SECRET =
  process.env.MARKETING_UNSUBSCRIBE_SECRET || JWT_SECRET;

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
    return res.status(401).json({ message: "Требуется токен авторизации." });
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
    const isSystemOwner =
      String(user.email || "").trim().toLowerCase() === OWNER_PRIMARY_EMAIL;
    const subscription = isSystemOwner
      ? null
      : await getOrgSubscription(user.orgId || null, user.id);
    const subscriptionPlan = subscription?.plan ? String(subscription.plan) : null;
    const basePermissions = resolveUserPermissions({
      role: user.role,
      permissionsJson: user.permissionsJson,
      isSystemOwner,
    });

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId || null,
      isSystemOwner,
      subscriptionPlan,
      permissions: applyPlanPermissionCap(basePermissions, subscriptionPlan),
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

async function requireCompanyOwnerSupport(req, res, next) {
  try {
    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({ message: "NO_ACCESS" });
    }
    if (req.user?.isSystemOwner) {
      return res.status(403).json({ message: "OWNER_ONLY_COMPANY" });
    }
    const targetOrgId = Number(req.user?.orgId || 0);
    if (!targetOrgId) {
      return res.status(400).json({ message: "ORG_REQUIRED" });
    }
    const isOwner = await isCompanyOwnerAccount(req.user.id, targetOrgId);
    if (!isOwner) {
      return res.status(403).json({ message: "OWNER_ONLY_COMPANY" });
    }
    return next();
  } catch (err) {
    console.error("support owner access check error:", err);
    return res.status(500).json({ message: "NO_ACCESS" });
  }
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
const EMAIL_VERIFY_TTL_MS = 10 * 60 * 1000;
const EMAIL_VERIFY_RESEND_COOLDOWN_MS = 60 * 1000;
const EMAIL_VERIFY_GLOBAL_LIMIT = 50;
const EMAIL_VERIFY_MAX_ATTEMPTS = 5;

const resetEmailRate = new Map();
const resetGlobalRate = [];
const emailVerifyResendRate = new Map();
const emailVerifyGlobalRate = [];

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const OWNER_PRIMARY_EMAIL = "dvinskihsergej9@gmail.com";
const OWNER_PRIMARY_PASSWORD = "Sergo0998";
const PORTAL_ALLOWED_ROLES = Object.freeze(["EMPLOYEE", "ADMIN"]);
const OWNER_PRIMARY_NAME = "Сергей Двинских";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function findUserByEmailInsensitive(email, tx = prisma) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  let user = await tx.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (!user) {
    user = await tx.user.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: "insensitive",
        },
      },
    });
  }
  if (!user) return null;

  if (normalizeEmail(user.email) !== normalizedEmail) {
    try {
      user = await tx.user.update({
        where: { id: user.id },
        data: { email: normalizedEmail },
      });
    } catch (err) {
      if (err?.code !== "P2002") throw err;
    }
  }
  return user;
}

function isValidRegistrationEmail(value) {
  const normalized = normalizeEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(normalized)) return false;
  const domain = String(normalized.split("@")[1] || "");
  if (!domain || domain.startsWith(".") || domain.endsWith(".")) return false;
  return true;
}

function normalizeFullName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isValidFullName(value) {
  const normalized = normalizeFullName(value);
  if (!normalized) return false;
  const parts = normalized.split(" ").filter(Boolean);
  return parts.length >= 2 && parts.every((part) => part.length >= 2);
}

function isValidPhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (!/^[0-9+\-()\s]+$/u.test(raw)) return false;
  const digits = raw.replace(/\D+/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function getClientIp(req) {
  const forwarded = String(req?.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  const realIp = String(req?.headers?.["x-real-ip"] || "").trim();
  const raw = forwarded || realIp || String(req?.ip || req?.socket?.remoteAddress || "").trim();
  return raw.replace(/^::ffff:/, "").slice(0, 64);
}

function buildRegistrationConsentSnapshot(req, {
  privacyAccepted = false,
  marketingAccepted = false,
  consentVersion = "",
} = {}) {
  const now = new Date().toISOString();
  const normalizedVersion = String(consentVersion || "register-2026-03-18")
    .trim()
    .slice(0, 64);
  return {
    version: normalizedVersion || "register-2026-03-18",
    privacyAccepted: Boolean(privacyAccepted),
    privacyAcceptedAt: privacyAccepted ? now : null,
    marketingAccepted: Boolean(marketingAccepted),
    marketingAcceptedAt: marketingAccepted ? now : null,
    ip: getClientIp(req) || null,
    userAgent: String(req?.headers?.["user-agent"] || "").slice(0, 255) || null,
  };
}

function parseRegistrationConsentSnapshot(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      version: String(parsed.version || "").trim() || null,
      privacyAccepted: Boolean(parsed.privacyAccepted),
      privacyAcceptedAt: parsed.privacyAcceptedAt || null,
      marketingAccepted: Boolean(parsed.marketingAccepted),
      marketingAcceptedAt: parsed.marketingAcceptedAt || null,
      ip: String(parsed.ip || "").trim() || null,
      userAgent: String(parsed.userAgent || "").trim() || null,
    };
  } catch {
    return null;
  }
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

async function isCompanyOwnerAccount(userId, orgId) {
  const normalizedUserId = Number(userId || 0);
  const normalizedOrgId = Number(orgId || 0);
  if (!normalizedUserId || !normalizedOrgId) return false;

  const owner = await prisma.user.findFirst({
    where: {
      orgId: normalizedOrgId,
      role: "ADMIN",
      isActive: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  return Number(owner?.id || 0) === normalizedUserId;
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
  "WarehouseNotification",
  "PushSubscription",
  "PurchaseOrder",
  "PurchaseOrderItem",
  "Item",
  "WarehouseLocation",
  "WarehouseReceivingLine",
  "WarehousePlacement",
  "StockMovement",
  "StockHold",
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
  "SalesOrderPickSkip",
  "OrderStatusHistory",
  "SupportTicket",
  "SupportMessage",
  "PalletRouteSheet",
  "PalletRouteSheetItem",
  "PalletRouteSheetEvent",
  "Pallet",
  "PalletLocation",
  "PalletEvent",
  "PalletDispatch",
  "PalletDiscrepancy",
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

const stockService = createWarehouseStockService(prisma, {
  onMovementCreated: ({ itemId }) => {
    scheduleAutoReorderCheck(itemId);
  },
});

const mailTransportCache = new Map();
const MAIL_SEND_TIMEOUT_MS = Number(process.env.MAIL_SEND_TIMEOUT_MS || 12000);
const WEB_PUSH_PUBLIC_KEY = String(process.env.WEB_PUSH_PUBLIC_KEY || "").trim();
const WEB_PUSH_PRIVATE_KEY = String(process.env.WEB_PUSH_PRIVATE_KEY || "").trim();
const WEB_PUSH_SUBJECT = String(
  process.env.WEB_PUSH_SUBJECT || process.env.APP_URL || "mailto:noreply@sklad-online.local"
).trim();
const WEB_PUSH_ENABLED = Boolean(WEB_PUSH_PUBLIC_KEY && WEB_PUSH_PRIVATE_KEY);

function parseEnvBoolean(value, fallback = false) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePortList(value) {
  return String(value || "")
    .split(",")
    .map((item) => Number(String(item || "").trim()))
    .filter((port) => Number.isFinite(port) && port > 0);
}

function dedupeMailTransportConfigs(configs) {
  const seen = new Set();
  const unique = [];
  for (const config of configs) {
    if (!config?.host || !config?.user || !config?.pass || !config?.port) continue;
    const key = `${config.host}|${config.port}|${config.secure ? "1" : "0"}|${config.user}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(config);
  }
  return unique;
}

function buildMailTransportConfigs() {
  const host = String(process.env.MAIL_HOST || "").trim();
  const user = String(process.env.MAIL_USER || "").trim();
  const pass = String(process.env.MAIL_PASS || "").trim();
  if (!host || !user || !pass) return [];

  const parsedPrimaryPort = Number(process.env.MAIL_PORT || 465);
  const primaryPort =
    Number.isFinite(parsedPrimaryPort) && parsedPrimaryPort > 0 ? parsedPrimaryPort : 465;
  const primarySecure = parseEnvBoolean(
    process.env.MAIL_SECURE,
    primaryPort === 465
  );
  const configs = [{ host, user, pass, port: primaryPort, secure: primarySecure }];

  const failoverPorts = parsePortList(process.env.MAIL_FAILOVER_PORTS);
  for (const port of failoverPorts) {
    configs.push({
      host,
      user,
      pass,
      port,
      secure: parseEnvBoolean("", port === 465),
    });
  }

  return dedupeMailTransportConfigs(configs);
}

function getOrCreateMailTransport(config) {
  const key = `${config.host}|${config.port}|${config.secure ? "1" : "0"}|${config.user}`;
  if (mailTransportCache.has(key)) {
    return mailTransportCache.get(key);
  }
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    connectionTimeout: MAIL_SEND_TIMEOUT_MS,
    greetingTimeout: MAIL_SEND_TIMEOUT_MS,
    socketTimeout: MAIL_SEND_TIMEOUT_MS,
    auth: { user: config.user, pass: config.pass },
  });
  mailTransportCache.set(key, transport);
  return transport;
}

if (WEB_PUSH_ENABLED) {
  try {
    webpush.setVapidDetails(
      WEB_PUSH_SUBJECT,
      WEB_PUSH_PUBLIC_KEY,
      WEB_PUSH_PRIVATE_KEY
    );
  } catch (err) {
    console.error("[PUSH] Невозможно инициализировать VAPID:", err);
  }
}

function getMailTransport() {
  const configs = buildMailTransportConfigs();
  if (!configs.length) return null;
  return getOrCreateMailTransport(configs[0]);
}

function getMailTransportAttemptPlan(primaryTransport = null) {
  const configs = buildMailTransportConfigs();
  const attempts = [];

  if (primaryTransport) {
    attempts.push({
      transport: primaryTransport,
      label: "primary",
    });
  }

  for (const config of configs) {
    attempts.push({
      transport: getOrCreateMailTransport(config),
      label: `${config.host}:${config.port} secure=${config.secure ? "true" : "false"}`,
    });
  }

  const unique = [];
  const seen = new Set();
  for (const attempt of attempts) {
    if (!attempt?.transport) continue;
    if (seen.has(attempt.transport)) continue;
    seen.add(attempt.transport);
    unique.push(attempt);
  }
  return unique;
}

async function sendMailWithTimeout(transport, payload) {
  const attempts = getMailTransportAttemptPlan(transport);
  if (!attempts.length) {
    throw new Error("MAIL_NOT_CONFIGURED");
  }

  let lastError = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    try {
      return await Promise.race([
        attempt.transport.sendMail(payload),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("MAIL_TIMEOUT")), MAIL_SEND_TIMEOUT_MS)
        ),
      ]);
    } catch (err) {
      lastError = err;
      if (attempts.length > 1) {
        console.error(
          `[MAIL_SEND] attempt ${index + 1}/${attempts.length} failed (${attempt.label}):`,
          err?.message || err
        );
      }
    }
  }

  throw lastError || new Error("MAIL_TIMEOUT");
}

function parsePushSubscription(input) {
  const endpoint = String(input?.endpoint || "").trim();
  const p256dh = String(input?.keys?.p256dh || "").trim();
  const auth = String(input?.keys?.auth || "").trim();
  if (!endpoint || !p256dh || !auth) {
    return null;
  }
  return { endpoint, p256dh, auth };
}

async function sendWebPushToUser(orgId, userId, payload) {
  if (!WEB_PUSH_ENABLED) return;
  if (!userId) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
    take: 20,
  });
  if (!subscriptions.length) return;

  const message = JSON.stringify(payload || {});
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        message,
        { TTL: 60 * 60 }
      );
      await prisma.pushSubscription.update({
        where: { id: sub.id },
        data: {
          lastSuccessAt: new Date(),
          lastErrorAt: null,
          lastErrorMessage: null,
        },
      });
    } catch (err) {
      const statusCode = Number(err?.statusCode || 0);
      const messageText = String(err?.message || "PUSH_SEND_FAILED");
      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => null);
      } else {
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: {
            lastErrorAt: new Date(),
            lastErrorMessage: messageText.slice(0, 500),
          },
        }).catch(() => null);
      }
    }
  }
}

async function createWarehouseNotification({
  orgId,
  userId,
  type = "TASK",
  title,
  message,
  linkUrl = null,
  payloadJson = null,
  sendWebPush = true,
}) {
  if (!userId || !title || !message) return null;
  const normalizedOrgId = orgId || null;

  const notification = await prisma.warehouseNotification.create({
    data: {
      orgId: normalizedOrgId,
      userId,
      type,
      title,
      message,
      linkUrl,
      payloadJson,
      isRead: false,
    },
  });

  if (sendWebPush) {
    await sendWebPushToUser(normalizedOrgId, userId, {
      title,
      body: message,
      url: linkUrl || "/warehouse",
      notificationId: notification.id,
      type,
    }).catch((err) => {
      console.error("[PUSH] Ошибка отправки:", err);
    });
  }

  return notification;
}

const TASKS_JOURNAL_LINK = "/warehouse?section=tasks&taskView=journal";
const CROSSDOCK_DISCREPANCIES_LINK = "/warehouse?section=crossdock&crossdockTab=discrepancies";
const PLATFORM_NEWS_ADMIN_LINK = "/admin/platform-news";
const PLATFORM_NEWS_TYPE = "PLATFORM_NEWS";
const PLATFORM_NEWS_BROADCAST_TYPE = "PLATFORM_NEWS_BROADCAST";
const SUPPORT_TICKETS_LINK = "/support";
const SUPPORT_TICKETS_ADMIN_LINK = "/admin";
const SUPPORT_TICKET_STATUSES = new Set([
  "OPEN",
  "IN_PROGRESS",
  "WAITING_USER",
  "RESOLVED",
]);
const SUPPORT_TICKET_PRIORITIES = new Set(["LOW", "NORMAL", "HIGH", "URGENT"]);
const SUPPORT_TICKET_CATEGORIES = new Set([
  "ACCESS",
  "BILLING",
  "TECHNICAL",
  "INTEGRATION",
  "OTHER",
]);
const SUPPORT_TICKET_STATUS_LABELS = {
  OPEN: "Открыта",
  IN_PROGRESS: "В работе",
  WAITING_USER: "Ждёт ответа",
  RESOLVED: "Решена",
};

function normalizeSupportTicketStatus(value, fallback = "OPEN") {
  const normalized = String(value || "").trim().toUpperCase();
  return SUPPORT_TICKET_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeSupportTicketPriority(value, fallback = "NORMAL") {
  const normalized = String(value || "").trim().toUpperCase();
  return SUPPORT_TICKET_PRIORITIES.has(normalized) ? normalized : fallback;
}

function normalizeSupportTicketCategory(value, fallback = "OTHER") {
  const normalized = String(value || "").trim().toUpperCase();
  return SUPPORT_TICKET_CATEGORIES.has(normalized) ? normalized : fallback;
}

function supportTicketStatusLabel(value) {
  const normalized = normalizeSupportTicketStatus(value, "OPEN");
  return SUPPORT_TICKET_STATUS_LABELS[normalized] || "Открыта";
}

function normalizeSupportText(value, maxLength = 4000) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function supportTicketToResponse(ticket) {
  const lastMessage = Array.isArray(ticket?.messages) ? ticket.messages[0] : null;
  return {
    id: ticket?.id,
    orgId: ticket?.orgId || null,
    subject: ticket?.subject || "",
    category: ticket?.category || "OTHER",
    priority: ticket?.priority || "NORMAL",
    status: ticket?.status || "OPEN",
    createdAt: ticket?.createdAt || null,
    updatedAt: ticket?.updatedAt || null,
    lastMessageAt: ticket?.lastMessageAt || ticket?.updatedAt || null,
    closedAt: ticket?.closedAt || null,
    messagesCount: Number(ticket?._count?.messages || 0),
    createdBy: ticket?.createdBy
      ? {
          id: ticket.createdBy.id,
          name: ticket.createdBy.name || "",
          email: ticket.createdBy.email || "",
        }
      : null,
    organization: ticket?.organization
      ? {
          id: ticket.organization.id,
          name: ticket.organization.name || "",
          code: ticket.organization.code || "",
        }
      : null,
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          body: lastMessage.body || "",
          createdAt: lastMessage.createdAt || null,
          isStaff: Boolean(lastMessage.isStaff),
          author: lastMessage.author
            ? {
                id: lastMessage.author.id,
                name: lastMessage.author.name || "",
                email: lastMessage.author.email || "",
              }
            : null,
        }
      : null,
  };
}

const PALLET_STATUSES = new Set(["RECEIVED", "STORED", "DISPATCHED", "CANCELLED"]);
const PALLET_EVENT_TYPES = new Set([
  "CREATE",
  "RECEIVE",
  "STORE",
  "MOVE",
  "DISPATCH",
  "CANCEL",
  "DISCREPANCY_OPEN",
  "DISCREPANCY_CLOSE",
]);
const ROUTE_SHEET_STATUSES = new Set(["DRAFT", "PUBLISHED", "LOADING", "COMPLETED", "CANCELLED"]);
const ROUTE_SHEET_ITEM_STATUSES = new Set(["PLANNED", "LOADED", "CANCELLED"]);
const PALLET_DISCREPANCY_STATUSES = new Set(["OPEN", "CLOSED"]);
const PALLET_DISCREPANCY_WRITEOFF_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);
const ROUTE_SHEET_EVENT_TYPES = new Set([
  "CREATE",
  "ADD_ITEM",
  "REMOVE_ITEM",
  "PUBLISH",
  "START_LOADING",
  "LOAD_PALLET",
  "COMPLETE",
  "CANCEL",
]);

function normalizePalletStatus(value, fallback = "") {
  const normalized = String(value || "").trim().toUpperCase();
  return PALLET_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizePalletGate(value, maxLength = 40) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  return normalized.slice(0, maxLength);
}

function parsePalletStatuses(rawValue) {
  const raw = String(rawValue || "")
    .split(",")
    .map((item) => normalizePalletStatus(item, ""))
    .filter(Boolean);
  return Array.from(new Set(raw));
}

function normalizeRouteSheetStatus(value, fallback = "") {
  const normalized = String(value || "").trim().toUpperCase();
  return ROUTE_SHEET_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeRouteSheetItemStatus(value, fallback = "") {
  const normalized = String(value || "").trim().toUpperCase();
  return ROUTE_SHEET_ITEM_STATUSES.has(normalized) ? normalized : fallback;
}

function parseRouteSheetStatuses(rawValue) {
  const raw = String(rawValue || "")
    .split(",")
    .map((item) => normalizeRouteSheetStatus(item, ""))
    .filter(Boolean);
  return Array.from(new Set(raw));
}

function normalizePalletCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .slice(0, 96);
}

function normalizeLocationCodeAlias(value) {
  const normalized = normalizePalletCode(value);
  if (!normalized) return "";
  const map = {
    А: "A",
    В: "B",
    Е: "E",
    К: "K",
    М: "M",
    Н: "H",
    О: "O",
    Р: "P",
    С: "C",
    Т: "T",
    У: "Y",
    Х: "X",
  };
  return normalized
    .split("")
    .map((char) => map[char] || char)
    .join("");
}

function toCyrillicLocationAlias(value) {
  const normalized = normalizePalletCode(value);
  if (!normalized) return "";
  const map = {
    A: "А",
    B: "В",
    C: "С",
    E: "Е",
    H: "Н",
    K: "К",
    M: "М",
    O: "О",
    P: "Р",
    T: "Т",
    X: "Х",
    Y: "У",
  };
  return normalized
    .split("")
    .map((char) => map[char] || char)
    .join("");
}

function parsePalletLocationInput(rawValue) {
  const raw = String(rawValue || "").trim();
  const normalizedRaw = normalizePalletCode(raw);
  const hasLegacyLocPrefix = /^BP:LOC:/i.test(normalizedRaw);
  const normalizedRawAlias = normalizeLocationCodeAlias(raw);
  const normalizedRawCyrAlias = toCyrillicLocationAlias(normalizedRaw || raw);
  const payload = normalizedRaw.replace(/^BP:(LOC|LOCATION):/i, "");
  const normalizedPayload = normalizePalletCode(payload);
  const normalizedPayloadAlias = normalizeLocationCodeAlias(payload);
  const normalizedPayloadCyrAlias = toCyrillicLocationAlias(normalizedPayload || payload);
  const numericPayload = Number(payload);
  const payloadId =
    Number.isFinite(numericPayload) && numericPayload > 0 ? Math.trunc(numericPayload) : null;
  const lookupTokens = Array.from(
    new Set(
      [
        raw,
        normalizedRaw,
        normalizedRawAlias,
        normalizedRawCyrAlias,
        payload,
        normalizedPayload,
        normalizedPayloadAlias,
        normalizedPayloadCyrAlias,
      ]
        .map((entry) => normalizeLocationLookupToken(entry))
        .filter(Boolean)
    )
  );
  return {
    raw,
    normalizedRaw,
    normalizedRawAlias,
    normalizedRawCyrAlias,
    payload,
    normalizedPayload,
    normalizedPayloadAlias,
    normalizedPayloadCyrAlias,
    payloadId,
    hasLegacyLocPrefix,
    lookupTokens,
  };
}

async function resolveWarehouseLocationByInput(orgId, rawValue, tx = prisma) {
  const orgIdValue = Number(orgId || 0) || null;
  if (!orgIdValue) return null;

  const parsed = parsePalletLocationInput(rawValue);
  if (!parsed.normalizedRaw) return null;

  const directOr = [
    { code: parsed.normalizedRaw },
    { code: parsed.normalizedRawAlias },
    { code: parsed.normalizedRawCyrAlias },
    { qrCode: parsed.normalizedRaw },
    { name: parsed.raw },
  ];
  if (parsed.normalizedPayload && parsed.normalizedPayload !== parsed.normalizedRaw) {
    directOr.push({ code: parsed.normalizedPayload });
    directOr.push({ code: parsed.normalizedPayloadAlias });
    directOr.push({ code: parsed.normalizedPayloadCyrAlias });
    directOr.push({ qrCode: parsed.normalizedPayload });
    directOr.push({ name: parsed.payload });
  }
  if (parsed.payloadId) {
    directOr.push({ id: parsed.payloadId });
  }
  const directMatch = await tx.warehouseLocation.findFirst({
    where: {
      orgId: orgIdValue,
      OR: directOr,
    },
    select: { id: true, code: true, name: true, qrCode: true },
  });
  if (directMatch) return directMatch;

  if (!parsed.lookupTokens.length) return null;

  const candidates = await tx.warehouseLocation.findMany({
    where: {
      orgId: orgIdValue,
    },
    select: { id: true, code: true, name: true, qrCode: true },
    take: 1200,
  });

  return (
    candidates.find((entry) => {
      const codeToken = normalizeLocationLookupToken(entry.code);
      const nameToken = normalizeLocationLookupToken(entry.name);
      const qrToken = normalizeLocationLookupToken(entry.qrCode);
      return (
        (codeToken && parsed.lookupTokens.includes(codeToken)) ||
        (nameToken && parsed.lookupTokens.includes(nameToken)) ||
        (qrToken && parsed.lookupTokens.includes(qrToken))
      );
    }) || null
  );
}

function buildPalletLocationCandidates(rawValue, warehouseLocation = null) {
  const parsed = parsePalletLocationInput(rawValue);
  const codeCandidates = new Set();
  const nameCandidates = new Set();

  const addCode = (value) => {
    const normalized = normalizePalletCode(value);
    if (normalized) codeCandidates.add(normalized);
  };
  const addName = (value) => {
    const normalized = normalizePalletText(value, 120);
    if (normalized) nameCandidates.add(normalized);
  };

  addCode(parsed.normalizedRaw);
  addCode(parsed.normalizedRawAlias);
  addCode(parsed.normalizedRawCyrAlias);
  addCode(parsed.normalizedPayload);
  addCode(parsed.normalizedPayloadAlias);
  addCode(parsed.normalizedPayloadCyrAlias);
  addName(parsed.raw);
  addName(parsed.payload);

  if (warehouseLocation) {
    addCode(warehouseLocation.code);
    addCode(warehouseLocation.name);
    addCode(warehouseLocation.qrCode);
    addName(warehouseLocation.name);
  }

  return {
    codeCandidates: Array.from(codeCandidates),
    nameCandidates: Array.from(nameCandidates),
    lookupTokens: parsed.lookupTokens,
  };
}

async function findPalletLocationsByInput(orgId, rawValue, tx = prisma) {
  const orgIdValue = Number(orgId || 0) || null;
  if (!orgIdValue) {
    return { warehouseLocation: null, palletLocations: [] };
  }

  const warehouseLocation = await resolveWarehouseLocationByInput(orgIdValue, rawValue, tx);
  const candidates = buildPalletLocationCandidates(rawValue, warehouseLocation);

  const whereOr = [];
  if (candidates.codeCandidates.length) {
    whereOr.push({ code: { in: candidates.codeCandidates } });
  }
  if (candidates.nameCandidates.length) {
    whereOr.push({ name: { in: candidates.nameCandidates } });
  }

  let palletLocations = whereOr.length
    ? await tx.palletLocation.findMany({
        where: {
          orgId: orgIdValue,
          OR: whereOr,
        },
        select: { id: true, code: true, name: true },
        take: 120,
      })
    : [];

  if (!palletLocations.length && candidates.lookupTokens.length) {
    const fallback = await tx.palletLocation.findMany({
      where: {
        orgId: orgIdValue,
      },
      select: { id: true, code: true, name: true },
      take: 1200,
    });
    palletLocations = fallback.filter((entry) => {
      const codeToken = normalizeLocationLookupToken(entry.code);
      const nameToken = normalizeLocationLookupToken(entry.name);
      return (
        (codeToken && candidates.lookupTokens.includes(codeToken)) ||
        (nameToken && candidates.lookupTokens.includes(nameToken))
      );
    });
  }

  return { warehouseLocation, palletLocations };
}

function doesLocationInputMatchPalletLocation(rawValue, warehouseLocation, palletLocation) {
  if (!palletLocation) return false;

  const candidates = buildPalletLocationCandidates(rawValue, warehouseLocation);
  const tokenSet = new Set(
    [
      ...candidates.codeCandidates,
      ...candidates.nameCandidates.map((entry) => normalizePalletCode(entry)),
    ].filter(Boolean)
  );
  if (!tokenSet.size) return false;

  const palletCode = normalizePalletCode(palletLocation.code);
  const palletName = normalizePalletCode(palletLocation.name);
  return Boolean((palletCode && tokenSet.has(palletCode)) || (palletName && tokenSet.has(palletName)));
}

function normalizePalletText(value, maxLength = 240) {
  return String(value || "").replace(/\r\n?/g, "\n").trim().slice(0, maxLength);
}

function toIsoDateOrNull(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function isPermissionDeniedForTable(err, tableName) {
  const joined = [
    String(err?.message || ""),
    String(err?.stack || ""),
    String(err?.cause?.message || ""),
    String(err?.meta?.cause || ""),
    (() => {
      try {
        return JSON.stringify(err || {});
      } catch {
        return "";
      }
    })(),
  ]
    .join(" ")
    .toLowerCase();
  const table = String(tableName || "").trim().toLowerCase();
  if (!table) return joined.includes("permission denied for table");
  return joined.includes(`permission denied for table ${table}`);
}

function isMissingRelationError(err, relationName = "") {
  const joined = [
    String(err?.message || ""),
    String(err?.stack || ""),
    String(err?.cause?.message || ""),
    String(err?.meta?.cause || ""),
  ]
    .join(" ")
    .toLowerCase();
  if (!joined.includes("does not exist")) return false;
  if (!relationName) return joined.includes("relation");
  const target = String(relationName || "").replace(/"/g, "").toLowerCase();
  return joined.includes(target);
}

function toErrorDetails(err) {
  const details = {
    name: String(err?.name || ""),
    code: String(err?.code || ""),
    clientVersion: String(err?.clientVersion || ""),
    message: String(err?.message || ""),
  };
  const causeMessage = String(err?.cause?.message || err?.meta?.cause || "").trim();
  if (causeMessage) {
    details.cause = causeMessage;
  }
  return details;
}

async function generateUniquePalletCode(orgId, tx = prisma) {
  const targetOrgId = Number(orgId || 0) || null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const now = new Date();
    const dateToken = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(
      now.getUTCDate()
    ).padStart(2, "0")}`;
    const randomPart = crypto.randomBytes(3).toString("hex").toUpperCase();
    const candidate = `PLT-${dateToken}-${randomPart}`;
    const exists = await tx.pallet.findFirst({
      where: {
        orgId: targetOrgId,
        palletCode: candidate,
      },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  throw new Error("PALLET_CODE_GENERATION_FAILED");
}

async function generateUniqueRouteSheetNumber(orgId, plannedDate = null, tx = prisma) {
  const targetOrgId = Number(orgId || 0) || null;
  const validPlannedDate =
    plannedDate instanceof Date && !Number.isNaN(plannedDate.getTime()) ? plannedDate : new Date();
  const counterYear = validPlannedDate.getUTCFullYear();
  const prefix = `ML-${counterYear}-`;

  const existingRows = await tx.palletRouteSheet.findMany({
    where: {
      orgId: targetOrgId,
      sheetNumber: { startsWith: prefix },
    },
    select: { sheetNumber: true },
    orderBy: [{ id: "desc" }],
    take: 5000,
  });

  let maxSequence = 0;
  for (const row of existingRows) {
    const value = String(row?.sheetNumber || "").trim();
    const match = /^ML-(\d{4})-(\d{1,6})$/i.exec(value);
    if (!match) continue;
    if (Number(match[1]) !== counterYear) continue;
    const sequence = Number(match[2]);
    if (Number.isFinite(sequence) && sequence > maxSequence) {
      maxSequence = sequence;
    }
  }

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const nextSequence = maxSequence + 1 + attempt;
    const candidate = `ML-${counterYear}-${String(nextSequence).padStart(6, "0")}`;
    const exists = await tx.palletRouteSheet.findFirst({
      where: {
        orgId: targetOrgId,
        sheetNumber: candidate,
      },
      select: { id: true },
    });
    if (!exists) return candidate;
  }

  throw new Error("ROUTE_SHEET_NUMBER_GENERATION_FAILED");
}

function normalizePalletDiscrepancyStatus(value, fallback = "") {
  const normalized = String(value || "").trim().toUpperCase();
  return PALLET_DISCREPANCY_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizePalletDiscrepancyWriteoffStatus(value, fallback = "") {
  const normalized = String(value || "").trim().toUpperCase();
  return PALLET_DISCREPANCY_WRITEOFF_STATUSES.has(normalized) ? normalized : fallback;
}

async function getOrCreatePalletLocationByCode(orgId, rawCode, tx = prisma) {
  const orgIdValue = Number(orgId || 0) || null;
  const parsedInput = parsePalletLocationInput(rawCode);
  if (!parsedInput.normalizedRaw) {
    const error = new Error("LOCATION_CODE_REQUIRED");
    error.code = "LOCATION_CODE_REQUIRED";
    throw error;
  }

  const linkedWarehouseLocation = await resolveWarehouseLocationByInput(orgIdValue, rawCode, tx);
  const resolvedCode = normalizePalletCode(
    linkedWarehouseLocation?.code ||
      linkedWarehouseLocation?.name ||
      parsedInput.normalizedPayloadAlias ||
      parsedInput.normalizedPayload ||
      parsedInput.normalizedRawAlias ||
      parsedInput.normalizedRaw
  );
  if (!resolvedCode) {
    const error = new Error("LOCATION_CODE_REQUIRED");
    error.code = "LOCATION_CODE_REQUIRED";
    throw error;
  }
  const resolvedName = normalizePalletText(linkedWarehouseLocation?.name, 120) || resolvedCode;

  const existing = await tx.palletLocation.findFirst({
    where: {
      orgId: orgIdValue,
      code: resolvedCode,
    },
  });
  if (existing) {
    if (existing.name !== resolvedName) {
      return tx.palletLocation.update({
        where: { id: existing.id },
        data: { name: resolvedName },
      });
    }
    return existing;
  }

  try {
    return await tx.palletLocation.create({
      data: {
        orgId: orgIdValue,
        code: resolvedCode,
        name: resolvedName,
      },
    });
  } catch (err) {
    if (err?.code !== "P2002") throw err;
    return tx.palletLocation.findFirst({
      where: {
        orgId: orgIdValue,
        code: resolvedCode,
      },
    });
  }
}

function palletToResponse(pallet) {
  return {
    id: pallet?.id,
    orgId: pallet?.orgId || null,
    palletCode: pallet?.palletCode || "",
    status: pallet?.status || "RECEIVED",
    supplierName: pallet?.supplierName || null,
    inboundRef: pallet?.inboundRef || null,
    currentLocation: pallet?.currentLocation
      ? {
          id: pallet.currentLocation.id,
          code: pallet.currentLocation.code || "",
          name: pallet.currentLocation.name || "",
        }
      : null,
    createdBy: pallet?.createdBy
      ? {
          id: pallet.createdBy.id,
          name: pallet.createdBy.name || "",
          email: pallet.createdBy.email || "",
        }
      : null,
    receivedAt: pallet?.receivedAt || null,
    storedAt: pallet?.storedAt || null,
    dispatchedAt: pallet?.dispatchedAt || null,
    createdAt: pallet?.createdAt || null,
    updatedAt: pallet?.updatedAt || null,
    dispatch: pallet?.dispatch
      ? {
          id: pallet.dispatch.id,
          routeSheetId: pallet.dispatch.routeSheetId || null,
          routeSheetItemId: pallet.dispatch.routeSheetItemId || null,
          destinationRc: pallet.dispatch.destinationRc || "",
          route: pallet.dispatch.route || null,
          vehicle: pallet.dispatch.vehicle || null,
          driver: pallet.dispatch.driver || null,
          notes: pallet.dispatch.notes || null,
          dispatchedByUserId: pallet.dispatch.dispatchedByUserId || null,
          dispatchedAt: pallet.dispatch.dispatchedAt || null,
        }
      : null,
  };
}

function palletEventToResponse(event) {
  return {
    id: event?.id,
    palletId: event?.palletId || null,
    type: event?.type || "",
    fromStatus: event?.fromStatus || null,
    toStatus: event?.toStatus || null,
    metaJson: event?.metaJson || null,
    createdAt: event?.createdAt || null,
    user: event?.user
      ? {
          id: event.user.id,
          name: event.user.name || "",
          email: event.user.email || "",
        }
      : null,
  };
}

function parsePalletDiscrepancyNote(note) {
  const raw = typeof note === "string" ? note.trim() : "";
  if (!raw) {
    return { legacyText: "", writeoffRequest: null, raw };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { legacyText: raw, writeoffRequest: null, raw };
    }
    const legacyText = String(parsed?.legacyText || "").trim();
    const request = parsed?.writeoffRequest;
    const normalizedRequest =
      request && typeof request === "object"
        ? {
            status: normalizePalletDiscrepancyWriteoffStatus(request?.status, ""),
            requestedAt: request?.requestedAt || null,
            requestedByUserId: Number(request?.requestedByUserId || 0) || null,
            requestedByName: String(request?.requestedByName || "").trim() || null,
            decidedAt: request?.decidedAt || null,
            decidedByUserId: Number(request?.decidedByUserId || 0) || null,
            decidedByName: String(request?.decidedByName || "").trim() || null,
            reason: String(request?.reason || "").trim() || null,
          }
        : null;
    return {
      legacyText,
      writeoffRequest: normalizedRequest?.status ? normalizedRequest : null,
      raw,
    };
  } catch {
    return { legacyText: raw, writeoffRequest: null, raw };
  }
}

function serializePalletDiscrepancyNote({ legacyText = "", writeoffRequest = null } = {}) {
  const payload = {};
  const normalizedLegacyText = String(legacyText || "").trim();
  if (normalizedLegacyText) {
    payload.legacyText = normalizedLegacyText;
  }

  if (writeoffRequest && typeof writeoffRequest === "object") {
    const status = normalizePalletDiscrepancyWriteoffStatus(writeoffRequest?.status, "");
    if (status) {
      payload.writeoffRequest = {
        status,
        requestedAt: writeoffRequest?.requestedAt || null,
        requestedByUserId: Number(writeoffRequest?.requestedByUserId || 0) || null,
        requestedByName: String(writeoffRequest?.requestedByName || "").trim() || null,
        decidedAt: writeoffRequest?.decidedAt || null,
        decidedByUserId: Number(writeoffRequest?.decidedByUserId || 0) || null,
        decidedByName: String(writeoffRequest?.decidedByName || "").trim() || null,
        reason: String(writeoffRequest?.reason || "").trim() || null,
      };
    }
  }

  if (!Object.keys(payload).length) return null;
  return JSON.stringify(payload);
}

function normalizeDiscrepancyWriteoffForResponse(request) {
  const status = normalizePalletDiscrepancyWriteoffStatus(request?.status, "");
  if (!status) return null;
  return {
    status,
    requestedAt: request?.requestedAt || null,
    requestedByUserId: Number(request?.requestedByUserId || 0) || null,
    requestedByName: String(request?.requestedByName || "").trim() || null,
    decidedAt: request?.decidedAt || null,
    decidedByUserId: Number(request?.decidedByUserId || 0) || null,
    decidedByName: String(request?.decidedByName || "").trim() || null,
    reason: String(request?.reason || "").trim() || null,
  };
}

function extractDiscrepancyWriteoffFromMeta(metaJson) {
  const meta = metaJson && typeof metaJson === "object" ? metaJson : null;
  if (!meta) return null;
  const status = normalizePalletDiscrepancyWriteoffStatus(
    meta?.writeoffRequestStatus || meta?.writeoffStatus,
    ""
  );
  if (!status) return null;
  return normalizeDiscrepancyWriteoffForResponse({
    status,
    requestedAt: meta?.writeoffRequestedAt || null,
    requestedByUserId: Number(meta?.writeoffRequestedByUserId || 0) || null,
    requestedByName: String(meta?.writeoffRequestedByName || "").trim() || null,
    decidedAt: meta?.writeoffDecidedAt || null,
    decidedByUserId: Number(meta?.writeoffDecidedByUserId || 0) || null,
    decidedByName: String(meta?.writeoffDecidedByName || "").trim() || null,
    reason: String(meta?.writeoffReason || "").trim() || null,
  });
}

function palletDiscrepancyToResponse(row) {
  const parsedNote = parsePalletDiscrepancyNote(row?.note);
  const palletCode = String(row?.pallet?.palletCode || "").trim();
  const locationCode =
    String(row?.location?.code || "").trim() ||
    String(row?.pallet?.currentLocation?.code || "").trim();
  const locationName =
    String(row?.location?.name || "").trim() ||
    String(row?.pallet?.currentLocation?.name || "").trim();
  return {
    id: row?.id || null,
    status: normalizePalletDiscrepancyStatus(row?.status, "OPEN"),
    palletId: row?.palletId || null,
    palletCode: palletCode || null,
    location: {
      id: row?.location?.id || row?.pallet?.currentLocation?.id || null,
      code: locationCode || null,
      name: locationName || null,
    },
    detectedAt: row?.detectedAt || row?.createdAt || null,
    detectedBy: row?.detectedByUser
      ? {
          id: row.detectedByUser.id,
          name: row.detectedByUser.name || "",
          email: row.detectedByUser.email || "",
        }
      : null,
    closedAt: row?.closedAt || null,
    closedBy: row?.closedByUser
      ? {
          id: row.closedByUser.id,
          name: row.closedByUser.name || "",
          email: row.closedByUser.email || "",
        }
      : null,
    note: parsedNote.legacyText || null,
    writeoffRequest: normalizeDiscrepancyWriteoffForResponse(parsedNote.writeoffRequest),
    lastCheckedAt: row?.lastCheckedAt || null,
    createdAt: row?.createdAt || null,
    updatedAt: row?.updatedAt || null,
  };
}

function isDiscrepancyPalletEventType(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "DISCREPANCY_OPEN" || normalized === "DISCREPANCY_CLOSE";
}

function isPalletEventTypeEnumValueMissing(err) {
  const joined = [
    String(err?.message || ""),
    String(err?.stack || ""),
    String(err?.cause?.message || ""),
    String(err?.meta?.cause || ""),
  ]
    .join(" ")
    .toLowerCase();
  return (
    joined.includes("invalid input value for enum") &&
    joined.includes("palleteventtype")
  );
}

function buildDiscrepancyFallbackMeta(metaJson, eventType) {
  const base = metaJson && typeof metaJson === "object" ? { ...metaJson } : {};
  const normalizedType = String(eventType || "").trim().toUpperCase();
  if (!base.discrepancyType) {
    base.discrepancyType = normalizedType;
  }
  if (!base.discrepancyStatus) {
    base.discrepancyStatus = normalizedType === "DISCREPANCY_CLOSE" ? "CLOSED" : "OPEN";
  }
  if (!base.source) {
    base.source = "LOCATION_CONTROL";
  }
  return base;
}

function extractDiscrepancyStatusFromPalletEvent(event) {
  const type = String(event?.type || "").trim().toUpperCase();
  if (type === "DISCREPANCY_OPEN") return "OPEN";
  if (type === "DISCREPANCY_CLOSE") return "CLOSED";

  const meta = event?.metaJson && typeof event.metaJson === "object" ? event.metaJson : null;
  if (!meta) return "";

  const metaType = String(meta?.discrepancyType || "").trim().toUpperCase();
  if (metaType === "DISCREPANCY_OPEN") return "OPEN";
  if (metaType === "DISCREPANCY_CLOSE") return "CLOSED";

  const metaStatus = normalizePalletDiscrepancyStatus(meta?.discrepancyStatus, "");
  if (metaStatus) return metaStatus;

  const source = String(meta?.source || "").trim().toUpperCase();
  const result = String(meta?.result || "").trim().toUpperCase();
  if (source === "LOCATION_CONTROL" && result === "MISSING") return "OPEN";
  if (source === "LOCATION_CONTROL" && result === "FOUND") return "CLOSED";

  return "";
}

function palletDiscrepancyEventToResponse(event, status) {
  const normalizedStatus = normalizePalletDiscrepancyStatus(status, "OPEN");
  const palletCode = String(event?.pallet?.palletCode || "").trim();
  const locationCode =
    String(event?.metaJson?.locationCode || "").trim() ||
    String(event?.pallet?.currentLocation?.code || "").trim();
  const locationName =
    String(event?.metaJson?.locationName || "").trim() ||
    String(event?.pallet?.currentLocation?.name || "").trim();

  return {
    id: `event-${event?.id || `${event?.palletId || "x"}-${event?.createdAt || Date.now()}`}`,
    status: normalizedStatus,
    palletId: event?.palletId || null,
    palletCode: palletCode || null,
    location: {
      id: event?.pallet?.currentLocation?.id || null,
      code: locationCode || null,
      name: locationName || null,
    },
    detectedAt: event?.createdAt || null,
    detectedBy: event?.user
      ? {
          id: event.user.id,
          name: event.user.name || "",
          email: event.user.email || "",
        }
      : null,
    closedAt: normalizedStatus === "CLOSED" ? event?.createdAt || null : null,
    closedBy:
      normalizedStatus === "CLOSED" && event?.user
        ? {
            id: event.user.id,
            name: event.user.name || "",
            email: event.user.email || "",
          }
        : null,
    note: null,
    writeoffRequest: extractDiscrepancyWriteoffFromMeta(event?.metaJson),
    lastCheckedAt: event?.createdAt || null,
    createdAt: event?.createdAt || null,
    updatedAt: event?.createdAt || null,
  };
}

async function loadLatestDiscrepancyStatesByPalletIdsFromEvents(orgId, palletIds, tx = prisma) {
  const normalizedOrgId = Number(orgId || 0) || null;
  const ids = Array.from(
    new Set(
      (Array.isArray(palletIds) ? palletIds : [])
        .map((value) => Number(value || 0))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
  if (!normalizedOrgId || !ids.length) {
    return new Map();
  }

  const rows = await tx.palletEvent.findMany({
    where: {
      orgId: normalizedOrgId,
      palletId: { in: ids },
      type: { in: ["DISCREPANCY_OPEN", "DISCREPANCY_CLOSE", "MOVE"] },
    },
    include: {
      pallet: {
        include: {
          currentLocation: true,
        },
      },
      user: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.max(1500, ids.length * 24),
  });

  const byPalletId = new Map();
  for (const row of rows) {
    const palletId = Number(row?.palletId || 0);
    if (!palletId) continue;

    const status = extractDiscrepancyStatusFromPalletEvent(row);
    const writeoffRequest = extractDiscrepancyWriteoffFromMeta(row?.metaJson);
    if (!status && !writeoffRequest) continue;

    const prev = byPalletId.get(palletId) || null;
    const next = {
      status: prev?.status || status || "",
      writeoffRequest: prev?.writeoffRequest || writeoffRequest || null,
      event: prev?.event || null,
    };
    if (status && !next.event) {
      next.event = row;
    }

    byPalletId.set(palletId, next);
  }

  for (const [key, value] of byPalletId.entries()) {
    if (!value?.status) {
      byPalletId.delete(key);
    }
  }

  return byPalletId;
}

async function loadLatestDiscrepancyItemsFromEvents(orgId, limit = 250, status = "", tx = prisma) {
  const normalizedOrgId = Number(orgId || 0) || null;
  if (!normalizedOrgId) return [];

  const safeLimit = Math.max(1, Math.min(500, Number(limit || 250)));
  const rows = await tx.palletEvent.findMany({
    where: {
      orgId: normalizedOrgId,
      type: { in: ["DISCREPANCY_OPEN", "DISCREPANCY_CLOSE", "MOVE"] },
    },
    include: {
      pallet: {
        include: {
          currentLocation: true,
        },
      },
      user: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.max(2000, safeLimit * 40),
  });

  const snapshots = new Map();
  for (const row of rows) {
    const palletId = Number(row?.palletId || 0);
    if (!palletId) continue;

    const rowStatus = extractDiscrepancyStatusFromPalletEvent(row);
    const rowWriteoff = extractDiscrepancyWriteoffFromMeta(row?.metaJson);
    if (!rowStatus && !rowWriteoff) continue;

    const prev = snapshots.get(palletId) || null;
    const next = {
      status: prev?.status || rowStatus || "",
      baseEvent: prev?.baseEvent || null,
      writeoffRequest: prev?.writeoffRequest || rowWriteoff || null,
    };
    if (rowStatus && !next.baseEvent) {
      next.baseEvent = row;
    }
    snapshots.set(palletId, next);
  }

  const items = [];
  for (const [, snapshot] of snapshots.entries()) {
    if (!snapshot?.status || !snapshot?.baseEvent) continue;
    if (status && snapshot.status !== status) continue;
    const item = palletDiscrepancyEventToResponse(snapshot.baseEvent, snapshot.status);
    item.writeoffRequest = normalizeDiscrepancyWriteoffForResponse(snapshot.writeoffRequest);
    items.push(item);
  }

  items.sort((a, b) => {
    const ta = new Date(a?.detectedAt || a?.createdAt || 0).getTime();
    const tb = new Date(b?.detectedAt || b?.createdAt || 0).getTime();
    return tb - ta;
  });

  return items.slice(0, safeLimit);
}

function isDiscrepancyWriteoffPending(request) {
  return normalizePalletDiscrepancyWriteoffStatus(request?.status, "") === "PENDING";
}

async function getOpenDiscrepancyByPalletIdTx(orgId, palletId, tx = prisma) {
  const normalizedOrgId = Number(orgId || 0);
  const normalizedPalletId = Number(palletId || 0);
  if (!normalizedOrgId || !normalizedPalletId) return null;

  const discrepancyStorageReady = await ensurePalletDiscrepancyStorageReadyForRuntime();
  if (discrepancyStorageReady) {
    const row = await tx.palletDiscrepancy.findFirst({
      where: {
        orgId: normalizedOrgId,
        palletId: normalizedPalletId,
        status: "OPEN",
      },
      include: {
        pallet: {
          include: {
            currentLocation: true,
          },
        },
        location: true,
        detectedByUser: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
    });
    if (!row) return null;
    const parsedNote = parsePalletDiscrepancyNote(row?.note);
    return {
      source: "table",
      discrepancyStorageReady: true,
      row,
      status: "OPEN",
      writeoffRequest: normalizeDiscrepancyWriteoffForResponse(parsedNote.writeoffRequest),
      noteParsed: parsedNote,
      locationCode:
        String(row?.location?.code || "").trim() ||
        String(row?.pallet?.currentLocation?.code || "").trim() ||
        "",
      locationName:
        String(row?.location?.name || "").trim() ||
        String(row?.pallet?.currentLocation?.name || "").trim() ||
        "",
    };
  }

  const snapshotByPallet = await loadLatestDiscrepancyStatesByPalletIdsFromEvents(
    normalizedOrgId,
    [normalizedPalletId],
    tx
  );
  const snapshot = snapshotByPallet.get(normalizedPalletId) || null;
  if (!snapshot || snapshot.status !== "OPEN") return null;
  const pallet = await tx.pallet.findFirst({
    where: {
      orgId: normalizedOrgId,
      id: normalizedPalletId,
    },
    include: {
      currentLocation: true,
    },
  });
  if (!pallet) return null;
  return {
    source: "events",
    discrepancyStorageReady: false,
    row: null,
    status: snapshot.status,
    writeoffRequest: normalizeDiscrepancyWriteoffForResponse(snapshot.writeoffRequest),
    noteParsed: null,
    pallet,
    locationCode:
      String(snapshot?.event?.metaJson?.locationCode || "").trim() ||
      String(snapshot?.event?.metaJson?.fromLocationCode || "").trim() ||
      String(pallet?.currentLocation?.code || "").trim() ||
      "",
    locationName:
      String(snapshot?.event?.metaJson?.locationName || "").trim() ||
      String(snapshot?.event?.metaJson?.fromLocationName || "").trim() ||
      String(pallet?.currentLocation?.name || "").trim() ||
      "",
  };
}

function routeSheetItemToResponse(item) {
  return {
    id: item?.id,
    routeSheetId: item?.routeSheetId || null,
    status: item?.status || "PLANNED",
    plannedAt: item?.plannedAt || null,
    loadedAt: item?.loadedAt || null,
    createdAt: item?.createdAt || null,
    updatedAt: item?.updatedAt || null,
    loadedBy: item?.loadedBy
      ? {
          id: item.loadedBy.id,
          name: item.loadedBy.name || "",
          email: item.loadedBy.email || "",
        }
      : null,
    pallet: item?.pallet ? palletToResponse(item.pallet) : null,
  };
}

function routeSheetToResponse(routeSheet) {
  return {
    id: routeSheet?.id,
    orgId: routeSheet?.orgId || null,
    sheetNumber: routeSheet?.sheetNumber || "",
    clientName: routeSheet?.clientName || "",
    destinationRc: routeSheet?.destinationRc || "",
    route: routeSheet?.route || null,
    vehicle: routeSheet?.vehicle || null,
    driver: routeSheet?.driver || null,
    plannedDate: routeSheet?.plannedDate || null,
    notes: routeSheet?.notes || null,
    status: routeSheet?.status || "DRAFT",
    createdAt: routeSheet?.createdAt || null,
    updatedAt: routeSheet?.updatedAt || null,
    publishedAt: routeSheet?.publishedAt || null,
    startedAt: routeSheet?.startedAt || null,
    completedAt: routeSheet?.completedAt || null,
    createdBy: routeSheet?.createdBy
      ? {
          id: routeSheet.createdBy.id,
          name: routeSheet.createdBy.name || "",
          email: routeSheet.createdBy.email || "",
        }
      : null,
    publishedBy: routeSheet?.publishedBy
      ? {
          id: routeSheet.publishedBy.id,
          name: routeSheet.publishedBy.name || "",
          email: routeSheet.publishedBy.email || "",
        }
      : null,
    startedBy: routeSheet?.startedBy
      ? {
          id: routeSheet.startedBy.id,
          name: routeSheet.startedBy.name || "",
          email: routeSheet.startedBy.email || "",
        }
      : null,
    completedBy: routeSheet?.completedBy
      ? {
          id: routeSheet.completedBy.id,
          name: routeSheet.completedBy.name || "",
          email: routeSheet.completedBy.email || "",
        }
      : null,
    items: Array.isArray(routeSheet?.items) ? routeSheet.items.map((item) => routeSheetItemToResponse(item)) : [],
    summary: routeSheet?.summary || null,
  };
}

function routeSheetEventToResponse(event) {
  return {
    id: event?.id,
    routeSheetId: event?.routeSheetId || null,
    itemId: event?.itemId || null,
    type: event?.type || "",
    metaJson: event?.metaJson || null,
    createdAt: event?.createdAt || null,
    user: event?.user
      ? {
          id: event.user.id,
          name: event.user.name || "",
          email: event.user.email || "",
        }
      : null,
  };
}

function summarizeRouteSheetItems(items) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const byStatus = normalizedItems.reduce(
    (acc, item) => {
      const status = normalizeRouteSheetItemStatus(item?.status, "PLANNED");
      if (!acc[status]) acc[status] = 0;
      acc[status] += 1;
      return acc;
    },
    { PLANNED: 0, LOADED: 0, CANCELLED: 0 }
  );
  return {
    total: normalizedItems.length,
    planned: Number(byStatus.PLANNED || 0),
    loaded: Number(byStatus.LOADED || 0),
    cancelled: Number(byStatus.CANCELLED || 0),
    remainingToLoad: Number(byStatus.PLANNED || 0),
  };
}

async function createPalletEventTx(
  tx,
  { orgId, palletId, type, fromStatus = null, toStatus = null, userId = null, metaJson = null }
) {
  const normalizedType = String(type || "").trim().toUpperCase();
  if (!PALLET_EVENT_TYPES.has(normalizedType)) {
    throw new Error("PALLET_EVENT_TYPE_INVALID");
  }
  const normalizedFromStatus = normalizePalletStatus(fromStatus, null);
  const normalizedToStatus = normalizePalletStatus(toStatus, null);
  const normalizedOrgId = Number(orgId || 0) || null;
  const normalizedUserId = Number(userId || 0) || null;
  const normalizedMetaJson = metaJson && typeof metaJson === "object" ? metaJson : null;
  const isDiscrepancyType = isDiscrepancyPalletEventType(normalizedType);

  const createByPrisma = async (eventType, eventMeta) =>
    tx.palletEvent.create({
      data: {
        orgId: normalizedOrgId,
        palletId,
        type: eventType,
        fromStatus: normalizedFromStatus,
        toStatus: normalizedToStatus,
        userId: normalizedUserId,
        metaJson: eventMeta,
      },
    });

  const createByRaw = async (eventType, eventMeta) => {
    const inserted = await tx.$queryRaw`
      INSERT INTO "PalletEvent"
        ("orgId", "palletId", "type", "fromStatus", "toStatus", "userId", "metaJson", "createdAt")
      VALUES
        (${normalizedOrgId}, ${palletId}, ${eventType}, ${normalizedFromStatus}, ${normalizedToStatus}, ${normalizedUserId}, CAST(${eventMeta ? JSON.stringify(eventMeta) : null} AS jsonb), NOW())
      RETURNING "id", "orgId", "palletId", "type", "fromStatus", "toStatus", "userId", "metaJson", "createdAt"
    `;
    return Array.isArray(inserted) && inserted.length ? inserted[0] : null;
  };

  try {
    return await createByPrisma(normalizedType, normalizedMetaJson);
  } catch (err) {
    if (isDiscrepancyType && isPalletEventTypeEnumValueMissing(err)) {
      const fallbackMeta = buildDiscrepancyFallbackMeta(normalizedMetaJson, normalizedType);
      try {
        return await createByPrisma("MOVE", fallbackMeta);
      } catch (fallbackErr) {
        if (!isPermissionDeniedForTable(fallbackErr, "User")) {
          throw fallbackErr;
        }
        return createByRaw("MOVE", fallbackMeta);
      }
    }

    if (!isPermissionDeniedForTable(err, "User")) {
      throw err;
    }

    try {
      return await createByRaw(normalizedType, normalizedMetaJson);
    } catch (rawErr) {
      if (isDiscrepancyType && isPalletEventTypeEnumValueMissing(rawErr)) {
        const fallbackMeta = buildDiscrepancyFallbackMeta(normalizedMetaJson, normalizedType);
        return createByRaw("MOVE", fallbackMeta);
      }
      throw rawErr;
    }
  }
}

async function createRouteSheetEventTx(
  tx,
  { orgId, routeSheetId, itemId = null, type, userId = null, metaJson = null }
) {
  const normalizedType = String(type || "").trim().toUpperCase();
  if (!ROUTE_SHEET_EVENT_TYPES.has(normalizedType)) {
    throw new Error("ROUTE_SHEET_EVENT_TYPE_INVALID");
  }
  const normalizedOrgId = Number(orgId || 0) || null;
  const normalizedUserId = Number(userId || 0) || null;
  const normalizedItemId = Number(itemId || 0) || null;
  const normalizedMetaJson = metaJson && typeof metaJson === "object" ? metaJson : null;

  return tx.palletRouteSheetEvent.create({
    data: {
      orgId: normalizedOrgId,
      routeSheetId,
      itemId: normalizedItemId,
      type: normalizedType,
      userId: normalizedUserId,
      metaJson: normalizedMetaJson,
    },
  });
}

async function loadSupportTicketForAccess(ticketId) {
  return prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      orgId: true,
      createdById: true,
      status: true,
      subject: true,
      priority: true,
      category: true,
    },
  });
}

function canAccessSupportTicketAsUser(ticket, user) {
  if (!ticket || !user?.id) return false;
  if (user.isSystemOwner) return true;
  if (ticket.createdById === user.id) return true;
  if (user.role === "ADMIN" && user.orgId && ticket.orgId === user.orgId) return true;
  return false;
}

async function notifySupportOperators(actorUserId, payload) {
  const admins = await prisma.user.findMany({
    where: {
      role: "ADMIN",
      isActive: true,
      id: actorUserId ? { not: actorUserId } : undefined,
    },
    select: { id: true, orgId: true, email: true },
    take: 20,
  });
  const supportOperators = admins.filter((admin) => isOwnerEmail(admin.email));
  for (const admin of supportOperators) {
    await createWarehouseNotification({
      orgId: admin.orgId || null,
      userId: admin.id,
      type: "SUPPORT",
      title: payload?.title || "Поддержка",
      message: payload?.message || "",
      linkUrl: payload?.linkUrl || SUPPORT_TICKETS_ADMIN_LINK,
      payloadJson: payload?.payloadJson || null,
    }).catch(() => null);
  }
}

async function getCrossdockDiscrepancyRecipients(orgId) {
  const normalizedOrgId = Number(orgId || 0);
  if (!normalizedOrgId) return [];

  const admins = await prisma.user.findMany({
    where: {
      orgId: normalizedOrgId,
      role: "ADMIN",
      isActive: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, orgId: true },
    take: 200,
  });
  if (!admins.length) return [];

  const ownerId = Number(admins[0]?.id || 0);
  const unique = new Map();
  for (const admin of admins) {
    const userId = Number(admin?.id || 0);
    if (!userId) continue;
    unique.set(userId, {
      id: userId,
      orgId: Number(admin?.orgId || 0) || null,
      isOwner: userId === ownerId,
    });
  }
  return Array.from(unique.values());
}

async function getCrossdockBusinessOwnerId(orgId) {
  const normalizedOrgId = Number(orgId || 0);
  if (!normalizedOrgId) return 0;
  const ownerCandidate = await prisma.user.findFirst({
    where: {
      orgId: normalizedOrgId,
      role: "ADMIN",
      isActive: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  return Number(ownerCandidate?.id || 0);
}

async function notifyCrossdockDiscrepancies({
  orgId,
  actorName = "",
  locationCode = "",
  locationName = "",
  missingCodes = [],
}) {
  const recipients = await getCrossdockDiscrepancyRecipients(orgId);
  if (!recipients.length) return;

  const normalizedMissingCodes = Array.from(
    new Set(
      (Array.isArray(missingCodes) ? missingCodes : [])
        .map((item) => normalizePalletCode(item))
        .filter(Boolean)
    )
  ).slice(0, 80);
  const missingCount = normalizedMissingCodes.length;
  if (!missingCount) return;

  const locationLabel = String(locationName || "").trim() || String(locationCode || "").trim() || "-";
  const actorLabel = String(actorName || "").trim();
  const title = "Расхождение кросс-докинга";
  const message = actorLabel
    ? `Ячейка ${locationLabel}: не найдено паллет — ${missingCount}. Проверил: ${actorLabel}.`
    : `Ячейка ${locationLabel}: не найдено паллет — ${missingCount}.`;
  const payloadJson = {
    scope: "crossdock_discrepancy",
    locationCode: String(locationCode || "").trim() || null,
    locationName: String(locationName || "").trim() || null,
    missingCount,
    missingCodes: normalizedMissingCodes,
  };

  for (const recipient of recipients) {
    await createWarehouseNotification({
      orgId: recipient.orgId,
      userId: recipient.id,
      type: "CROSSDOCK_DISCREPANCY",
      title,
      message,
      linkUrl: CROSSDOCK_DISCREPANCIES_LINK,
      payloadJson,
      sendWebPush: false,
    }).catch(() => null);
  }
}

async function notifyCrossdockWriteoffRequested({
  orgId,
  discrepancyId = null,
  palletCode = "",
  locationCode = "",
  locationName = "",
  actorName = "",
  reason = "",
}) {
  const recipients = await getCrossdockDiscrepancyRecipients(orgId);
  if (!recipients.length) return;

  const palletLabel = String(palletCode || "").trim() || "-";
  const locationLabel = String(locationName || "").trim() || String(locationCode || "").trim() || "-";
  const actorLabel = String(actorName || "").trim() || "Сотрудник";
  const reasonText = String(reason || "").trim();

  const title = "Запрос на списание паллеты";
  const message = reasonText
    ? `${actorLabel} запросил списание паллеты ${palletLabel} (ячейка ${locationLabel}). Причина: ${reasonText}.`
    : `${actorLabel} запросил списание паллеты ${palletLabel} (ячейка ${locationLabel}).`;

  const payloadJson = {
    scope: "crossdock_discrepancy_writeoff",
    discrepancyId: Number(discrepancyId || 0) || null,
    palletCode: palletLabel,
    locationCode: String(locationCode || "").trim() || null,
    locationName: String(locationName || "").trim() || null,
    reason: reasonText || null,
  };

  for (const recipient of recipients) {
    await createWarehouseNotification({
      orgId: recipient.orgId,
      userId: recipient.id,
      type: "CROSSDOCK_DISCREPANCY_WRITEOFF",
      title,
      message,
      linkUrl: CROSSDOCK_DISCREPANCIES_LINK,
      payloadJson,
      sendWebPush: true,
    }).catch(() => null);
  }
}

async function notifyCrossdockWriteoffDecision({
  orgId,
  targetUserId = null,
  decision = "",
  palletCode = "",
  actorName = "",
  reason = "",
}) {
  const recipientId = Number(targetUserId || 0);
  if (!recipientId) return;

  const normalizedDecision = String(decision || "").trim().toUpperCase();
  const isApproved = normalizedDecision === "APPROVE";
  const palletLabel = String(palletCode || "").trim() || "-";
  const actorLabel = String(actorName || "").trim() || "Владелец";
  const reasonText = String(reason || "").trim();

  const title = isApproved ? "Списание одобрено" : "Списание отклонено";
  const message = isApproved
    ? `${actorLabel} одобрил списание паллеты ${palletLabel}.`
    : reasonText
      ? `${actorLabel} отклонил списание паллеты ${palletLabel}. Причина: ${reasonText}.`
      : `${actorLabel} отклонил списание паллеты ${palletLabel}.`;

  await createWarehouseNotification({
    orgId: Number(orgId || 0) || null,
    userId: recipientId,
    type: "CROSSDOCK_DISCREPANCY_WRITEOFF_DECISION",
    title,
    message,
    linkUrl: CROSSDOCK_DISCREPANCIES_LINK,
    payloadJson: {
      scope: "crossdock_discrepancy_writeoff_decision",
      decision: isApproved ? "APPROVED" : "REJECTED",
      palletCode: palletLabel,
      reason: reasonText || null,
    },
    sendWebPush: true,
  }).catch(() => null);
}

function hashInviteToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashEmailVerificationCode(code) {
  return crypto.createHash("sha256").update(String(code || "")).digest("hex");
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

function createEmailVerificationCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function createMarketingUnsubscribeToken(user) {
  return jwt.sign(
    {
      purpose: "marketing_unsubscribe",
      userId: Number(user?.id || 0),
      email: normalizeEmail(user?.email || ""),
    },
    MARKETING_UNSUBSCRIBE_SECRET
  );
}

function parseMarketingUnsubscribeToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return null;
  try {
    const payload = jwt.verify(token, MARKETING_UNSUBSCRIBE_SECRET);
    if (payload?.purpose !== "marketing_unsubscribe") return null;
    const userId = Number(payload?.userId || 0);
    if (!userId) return null;
    return {
      userId,
      email: normalizeEmail(payload?.email || ""),
    };
  } catch {
    return null;
  }
}

function buildMarketingUnsubscribeLink(user) {
  const token = createMarketingUnsubscribeToken(user);
  return `${FRONTEND_URL}/unsubscribe?token=${encodeURIComponent(token)}`;
}

function getNewClientNotificationRecipients() {
  const raw = String(
    process.env.NEW_CLIENT_NOTIFY_EMAILS ||
      process.env.NEW_CLIENT_NOTIFY_EMAIL ||
      OWNER_PRIMARY_EMAIL
  );
  return Array.from(
    new Set(
      raw
        .split(/[,;\s]+/g)
        .map((entry) => normalizeEmail(entry))
        .filter(Boolean)
    )
  );
}

async function sendInviteEmail(email, token) {
  const link = `${FRONTEND_URL}/invite?token=${token}`;
  const transport = getMailTransport();
  if (!transport) {
    console.log(`[INVITE] ${email}: ${link}`);
    return { sent: false, link };
  }

  const from = process.env.MAIL_FROM || `СкладОнлайн <${process.env.MAIL_USER}>`;
  const subject = "Приглашение в СкладОнлайн";
  const text = `Вы приглашены в СкладОнлайн. Перейдите по ссылке для завершения регистрации: ${link}`;
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;">
      <p>Вы приглашены в СкладОнлайн.</p>
      <p>\u0421\u0441\u044b\u043b\u043a\u0430 \u0434\u043b\u044f \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0438\u044f \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438:</p>
      <p><a href="${link}">${link}</a></p>
      <p>\u0415\u0441\u043b\u0438 \u0432\u044b \u043d\u0435 \u043e\u0436\u0438\u0434\u0430\u043b\u0438 \u044d\u0442\u043e \u043f\u0438\u0441\u044c\u043c\u043e, \u043f\u0440\u043e\u0441\u0442\u043e \u0438\u0433\u043d\u043e\u0440\u0438\u0440\u0443\u0439\u0442\u0435 \u0435\u0433\u043e.</p>
    </div>
  `;

  try {
    await sendMailWithTimeout(transport, { from, to: email, subject, text, html });
    return { sent: true, link };
  } catch (err) {
    console.error("Invite email send error:", err);
    console.log(`[INVITE] ${email}: ${link}`);
    return { sent: false, link, error: err.message };
  }
}

async function sendEmailVerificationCode(email, code) {
  const transport = getMailTransport();
  const text = `Код подтверждения регистрации: ${code}. Код действует 10 минут.`;

  if (!transport) {
    console.error("[EMAIL_VERIFY] Mail transport unavailable: MAIL_HOST/MAIL_USER/MAIL_PASS not configured.");
    console.log(`[EMAIL_VERIFY] ${email}: ${code}`);
    return { sent: false, error: "MAIL_NOT_CONFIGURED" };
  }

  const from = process.env.MAIL_FROM || `СкладОнлайн <${process.env.MAIL_USER}>`;
  const subject = "Подтверждение регистрации";
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;">
      <p>Код подтверждения регистрации:</p>
      <p style="font-size:24px;font-weight:700;letter-spacing:3px;">${code}</p>
      <p>Код действует 10 минут.</p>
      <p>Если вы не регистрировались, просто игнорируйте это письмо.</p>
    </div>
  `;

  try {
    await sendMailWithTimeout(transport, { from, to: email, subject, text, html });
    return { sent: true };
  } catch (err) {
    console.error("Email verification send error:", err);
    console.log(`[EMAIL_VERIFY] ${email}: ${code}`);
    return { sent: false, error: err.message };
  }
}

async function ensureEmailVerificationCodeDelivered(email, code) {
  const result = await sendEmailVerificationCode(email, code);
  if (result?.sent) {
    return result;
  }

  const normalizedError = String(result?.error || "").trim().toUpperCase();
  if (normalizedError === "MAIL_TIMEOUT") {
    const timeoutError = new Error("MAIL_TIMEOUT");
    timeoutError.status = 503;
    throw timeoutError;
  }

  const deliveryError = new Error("EMAIL_VERIFY_DELIVERY_FAILED");
  deliveryError.status = 503;
  throw deliveryError;
}

async function sendNewClientNotification({
  email,
  name,
  phone,
  companyName,
  consent,
  verifiedAt,
}) {
  const recipients = getNewClientNotificationRecipients();
  if (!recipients.length) {
    return { sent: false };
  }

  const verifiedAtText = new Date(verifiedAt || Date.now()).toLocaleString("ru-RU");
  const consentVersion = String(consent?.version || "").trim() || "-";
  const privacyAcceptedText = consent?.privacyAccepted ? "Да" : "Нет";
  const privacyAcceptedAt = consent?.privacyAcceptedAt
    ? new Date(consent.privacyAcceptedAt).toLocaleString("ru-RU")
    : "-";
  const marketingAcceptedText = consent?.marketingAccepted ? "Да" : "Нет";
  const marketingAcceptedAt = consent?.marketingAcceptedAt
    ? new Date(consent.marketingAcceptedAt).toLocaleString("ru-RU")
    : "-";
  const consentIp = consent?.ip || "-";
  const consentUserAgent = consent?.userAgent || "-";

  const lines = [
    "Новый клиент подтвердил регистрацию.",
    "",
    `Почта: ${email || "-"}`,
    `ФИО: ${name || "-"}`,
    `Телефон: ${phone || "-"}`,
    `Компания: ${companyName || "-"}`,
    "",
    "Согласия:",
    `- Обработка ПД: ${privacyAcceptedText} (версия: ${consentVersion}, время: ${privacyAcceptedAt})`,
    `- Рассылка: ${marketingAcceptedText} (время: ${marketingAcceptedAt})`,
    `IP при регистрации: ${consentIp}`,
    `User-Agent: ${consentUserAgent}`,
    `Время подтверждения: ${verifiedAtText}`,
  ];
  const text = lines.join("\n");

  const transport = getMailTransport();
  if (!transport) {
    console.log(`[NEW_CLIENT] recipients=${recipients.join(",")} \n${text}`);
    return { sent: false };
  }

  const from = process.env.MAIL_FROM || `СкладОнлайн <${process.env.MAIL_USER}>`;
  const subject = "Новая регистрация клиента";
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;">
      <p><strong>Новый клиент подтвердил регистрацию.</strong></p>
      <p>Почта: ${email || "-"}</p>
      <p>ФИО: ${name || "-"}</p>
      <p>Телефон: ${phone || "-"}</p>
      <p>Компания: ${companyName || "-"}</p>
      <p><strong>Согласия:</strong></p>
      <p>Обработка ПД: ${privacyAcceptedText} (версия: ${consentVersion}, время: ${privacyAcceptedAt})</p>
      <p>Рассылка: ${marketingAcceptedText} (время: ${marketingAcceptedAt})</p>
      <p>IP при регистрации: ${consentIp}</p>
      <p>User-Agent: ${consentUserAgent}</p>
      <p>Время подтверждения: ${verifiedAtText}</p>
    </div>
  `;

  try {
    await sendMailWithTimeout(transport, {
      from,
      to: recipients.join(","),
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error("New client notification send error:", err);
    console.log(`[NEW_CLIENT] recipients=${recipients.join(",")} \n${text}`);
    return { sent: false, error: err.message };
  }
}

async function sendMarketingWelcomeEmail(user) {
  if (!user?.id || !user?.email || user.marketingEmailsEnabled !== true) {
    return { sent: false, skipped: true };
  }

  const transport = getMailTransport();
  const subject = "Полезные материалы по работе со складом";
  const text = [
    `Здравствуйте, ${user.name || "коллега"}!`,
    "",
    "Спасибо за регистрацию в СкладОнлайн.",
    "Вы подписались на полезные материалы сервиса.",
    "",
    "Отключить рассылку можно в приложении:",
    "Администрирование -> Рассылка.",
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;">
      <p>Здравствуйте, ${user.name || "коллега"}!</p>
      <p>Спасибо за регистрацию в <strong>СкладОнлайн</strong>.</p>
      <p>Вы подписались на полезные материалы сервиса.</p>
      <p>
        Отключить рассылку можно в разделе <strong>Администрирование -> Рассылка</strong>.
      </p>
    </div>
  `;

  if (!transport) {
    console.log(`[MARKETING_WELCOME] ${user.email}: sent-without-unsubscribe-link`);
    return { sent: false };
  }

  const from = process.env.MAIL_FROM || `СкладОнлайн <${process.env.MAIL_USER}>`;
  try {
    await sendMailWithTimeout(transport, {
      from,
      to: user.email,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error("Marketing welcome email send error:", err);
    console.log(`[MARKETING_WELCOME] ${user.email}: failed`);
    return { sent: false, error: err.message };
  }
}



async function sendPasswordResetEmail(email, token) {
  const link = `${FRONTEND_URL}/reset-password?token=${token}`;
  const transport = getMailTransport();
  if (!transport) {
    console.log(`[RESET] ${email}: ${link}`);
    return { sent: false, link };
  }

  const from = process.env.MAIL_FROM || `СкладОнлайн <${process.env.MAIL_USER}>`;
  const subject = "Сброс пароля в СкладОнлайн";
  const text = `Для сброса пароля перейдите по ссылке: ${link}`;
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;">
      <p>Для сброса пароля перейдите по ссылке:</p>
      <p><a href="${link}">${link}</a></p>
      <p>Если вы не запрашивали сброс, просто игнорируйте это письмо.</p>
    </div>
  `;

  try {
    await sendMailWithTimeout(transport, { from, to: email, subject, text, html });
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

  const from = process.env.MAIL_FROM || `СкладОнлайн <${process.env.MAIL_USER}>`;
  const subject = "Пароль изменён";
  const text = "Пароль в СкладОнлайн был изменён. Если это были не вы, свяжитесь с администратором.";
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;">
      <p>${text}</p>
    </div>
  `;

  try {
    await sendMailWithTimeout(transport, { from, to: email, subject, text, html });
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

  const from = process.env.MAIL_FROM || `СкладОнлайн <${process.env.MAIL_USER}>`;
  try {
    await sendMailWithTimeout(transport, { from, to, subject, text });
    return { sent: true };
  } catch (err) {
    console.error("Auto reorder email send error:", err);
    return { sent: false, error: err.message };
  }
}

function buildPurchaseOrderEmailText(order, templateText = null) {
  const number = order?.number || `PO-${order?.id || "?"}`;
  const date = order?.date
    ? new Date(order.date).toLocaleDateString("ru-RU")
    : new Date().toLocaleDateString("ru-RU");
  const supplierName = order?.supplier?.name || "поставщик";

  const lines = Array.isArray(order?.items) ? order.items : [];
  const linesText = lines
    .map((row, index) => {
      const name = row?.item?.name || "Товар";
      const sku = row?.item?.sku ? ` (Артикул: ${row.item.sku})` : "";
      const qty = Number(row?.quantity) || 0;
      const unit = row?.item?.unit || "шт";
      const price = Number(row?.price) || 0;
      return `${index + 1}. ${name}${sku} - ${qty} ${unit}, цена ${price.toLocaleString("ru-RU")} ₽`;
    })
    .join("\n");

  const totalAmount = lines.reduce((sum, row) => {
    const qty = Number(row?.quantity) || 0;
    const price = Number(row?.price) || 0;
    return sum + qty * price;
  }, 0);

  const cleanTemplate = String(templateText || "").trim();
  if (cleanTemplate) {
    const hasLinesToken =
      /\{\{\s*lines\s*\}\}/i.test(cleanTemplate) ||
      /\{\{\s*позиции\s*\}\}/i.test(cleanTemplate);
    const placeholders = {
      supplierName,
      orderNumber: number,
      orderDate: date,
      lines: linesText || "-",
      totalAmount: totalAmount.toLocaleString("ru-RU"),
      поставщик: supplierName,
      номерЗаказа: number,
      датаЗаказа: date,
      позиции: linesText || "-",
      итого: totalAmount.toLocaleString("ru-RU"),
    };

    let rendered = cleanTemplate.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_, key) => {
      return placeholders[key] ?? "";
    });

    if (!hasLinesToken) {
      rendered = [
        rendered.trim(),
        "",
        "Позиции заказа:",
        linesText || "-",
      ]
        .filter(Boolean)
        .join("\n");
    }

    return rendered.trim();
  }

  return [
    `Здравствуйте, ${supplierName}!`,
    "",
    `Просим обработать заказ поставщику № ${number} от ${date}.`,
    "",
    "Позиции заказа:",
    linesText || "-",
    "",
    "Просим подтвердить получение заказа и плановую дату поставки.",
    "",
    "С уважением,",
    "СкладОнлайн",
  ].join("\n");
}

const APP_URL = process.env.APP_URL || FRONTEND_URL;
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

async function getReceivingLocationId(tx, orgIdInput = null) {
  const normalizedOrgId = Number.isFinite(Number(orgIdInput))
    ? Number(orgIdInput)
    : null;
  const where = {
    orgId: normalizedOrgId,
    OR: [
      { code: "RECEIVING" },
      { name: "RECEIVING" },
      { name: "\u0417\u043e\u043d\u0430 \u043f\u0440\u0438\u0435\u043c\u043a\u0438" },
      { name: "\u041f\u0440\u0438\u0435\u043c\u043a\u0430" },
    ],
  };

  const existing = await tx.warehouseLocation.findFirst({ where });
  if (existing) return existing.id;

  const created = await tx.warehouseLocation.create({
    data: {
      orgId: normalizedOrgId,
      name: "\u0417\u043e\u043d\u0430 \u043f\u0440\u0438\u0435\u043c\u043a\u0438",
      code: "RECEIVING",
    },
  });
  return created.id;
}
const PLANS = {
  "start-30": {
    id: "start-30",
    title: "Start 30 days",
    amount: 1,
    currency: "RUB",
    days: 30,
  },
  "basic-30": {
    id: "basic-30",
    title: "Basic 30 days",
    amount: 2990,
    currency: "RUB",
    days: 30,
  },
  "pro-30": {
    id: "pro-30",
    title: "Pro 30 days",
    amount: 6990,
    currency: "RUB",
    days: 30,
  },
};

const START_PLAN_ALLOWED_PERMISSIONS = Object.freeze([
  PERMISSION_KEYS.APP_WAREHOUSE,
  PERMISSION_KEYS.APP_ADMIN,
  PERMISSION_KEYS.ADMIN_USERS,
  PERMISSION_KEYS.ADMIN_WAREHOUSE,
  PERMISSION_KEYS.WAREHOUSE_REQUESTS,
  PERMISSION_KEYS.WAREHOUSE_TASKS,
  PERMISSION_KEYS.WAREHOUSE_INVENTORY,
  PERMISSION_KEYS.WAREHOUSE_MOVEMENT,
  PERMISSION_KEYS.WAREHOUSE_TRANSACTIONS,
  PERMISSION_KEYS.WAREHOUSE_REVISION,
  PERMISSION_KEYS.WAREHOUSE_LOCATIONS,
  PERMISSION_KEYS.WAREHOUSE_TSD,
  PERMISSION_KEYS.WAREHOUSE_ORDERS,
  PERMISSION_KEYS.TSD_RECEIVING,
  PERMISSION_KEYS.TSD_PUTAWAY,
  PERMISSION_KEYS.TSD_MOVE,
  PERMISSION_KEYS.TSD_COUNT,
  PERMISSION_KEYS.TSD_BIN,
  PERMISSION_KEYS.TSD_REPLENISH,
  PERMISSION_KEYS.TSD_PICK,
  PERMISSION_KEYS.TSD_SHIP,
  PERMISSION_KEYS.TSD_PALLETS,
]);

const PLAN_PERMISSION_CAPS = Object.freeze({
  "start-30": START_PLAN_ALLOWED_PERMISSIONS,
});

const PLAN_PERMISSION_CAP_SETS = Object.freeze(
  Object.fromEntries(
    Object.entries(PLAN_PERMISSION_CAPS).map(([planId, keys]) => [planId, new Set(keys)])
  )
);

function getPlanPermissionCapSet(planId) {
  const normalizedPlanId = String(planId || "").trim().toLowerCase();
  return PLAN_PERMISSION_CAP_SETS[normalizedPlanId] || null;
}

function applyPlanPermissionCap(permissionKeys = [], planId = null) {
  const normalized = Array.from(
    new Set(
      (Array.isArray(permissionKeys) ? permissionKeys : [])
        .map((key) => String(key || "").trim())
        .filter(Boolean)
    )
  );
  const capSet = getPlanPermissionCapSet(planId);
  if (!capSet) return normalized;
  return normalized.filter((key) => capSet.has(key));
}

function filterPermissionCatalogByPlan(catalog, planId = null) {
  const capSet = getPlanPermissionCapSet(planId);
  if (!capSet || !catalog || typeof catalog !== "object") return catalog;

  const filterKeys = (keys) =>
    (Array.isArray(keys) ? keys : []).filter((key) => capSet.has(key));

  const roleDefaults = Object.fromEntries(
    Object.entries(catalog.roleDefaults || {}).map(([role, keys]) => [
      role,
      filterKeys(keys),
    ])
  );

  const groups = (Array.isArray(catalog.groups) ? catalog.groups : []).map((group) => ({
    ...group,
    keys: filterKeys(group.keys),
  }));

  const templates = (Array.isArray(catalog.templates) ? catalog.templates : []).map(
    (template) => ({
      ...template,
      permissions: filterKeys(template.permissions),
    })
  );

  return {
    ...catalog,
    permissions: filterKeys(catalog.permissions),
    roleDefaults,
    groups,
    templates,
  };
}

const PLAN_ACTIVE_USER_LIMITS = Object.freeze({
  "start-30": 2,
  "basic-30": 5,
  "pro-30": 30,
});
const DEFAULT_ACTIVE_USER_LIMIT = 30;

function getPlanActiveUserLimit(planId) {
  const normalizedPlanId = String(planId || "").trim().toLowerCase();
  return Number(PLAN_ACTIVE_USER_LIMITS[normalizedPlanId] || DEFAULT_ACTIVE_USER_LIMIT);
}

async function getOrgPlanAndUserLimit(orgId, fallbackUserId = null) {
  const orgSubscription = await getOrgSubscription(orgId, fallbackUserId);
  const currentPlanId = String(orgSubscription?.plan || "start-30");
  const maxActiveUsers = getPlanActiveUserLimit(currentPlanId);
  return { currentPlanId, maxActiveUsers };
}

function getPlan(planId) {
  return PLANS[planId] || null;
}

const BILLING_PERIODS = {
  "1m": { id: "1m", months: 1, discountPct: 0 },
  "6m": { id: "6m", months: 6, discountPct: 10 },
  "12m": { id: "12m", months: 12, discountPct: 30 },
};

function getBillingPeriod(periodId) {
  const normalized = String(periodId || "1m").trim().toLowerCase();
  return BILLING_PERIODS[normalized] || null;
}

function resolveBillingPeriodIdByDays(plan, days, fallbackPeriodId = "1m") {
  const normalizedDays = Number(days || 0);
  if (!plan || !Number.isFinite(normalizedDays) || normalizedDays <= 0) {
    return fallbackPeriodId;
  }
  if (normalizedDays === Number(plan.days || 0) * 12) return "12m";
  if (normalizedDays === Number(plan.days || 0) * 6) return "6m";
  return fallbackPeriodId;
}

function getResolvedPlanCharge(plan, periodIdInput = "1m") {
  if (!plan) return null;
  const period = getBillingPeriod(periodIdInput);
  if (!period) return null;
  if (plan.id === "start-30" && period.id !== "1m") return null;

  const monthlyAmount = Number(plan.amount || 0);
  if (!Number.isFinite(monthlyAmount) || monthlyAmount < 0) return null;
  const grossAmount = monthlyAmount * period.months;
  const discountMultiplier = Math.max(0, 1 - Number(period.discountPct || 0) / 100);
  const amount = Math.round(grossAmount * discountMultiplier);
  const days = Number(plan.days || 0) * period.months;
  if (!Number.isFinite(days) || days <= 0) return null;

  return {
    id: plan.id,
    planId: plan.id,
    title: plan.title,
    currency: plan.currency,
    amount,
    days,
    periodId: period.id,
    months: period.months,
    discountPct: period.discountPct,
  };
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
  const periodId = metadata?.periodId ? String(metadata.periodId).trim().toLowerCase() : null;
  const days = Number(metadata?.days || 0);
  const amount = Number(metadata?.amount || 0);
  const currency = metadata?.currency ? String(metadata.currency).trim().toUpperCase() : null;
  const localPaymentId = Number(metadata?.localPaymentId || 0) || null;
  return {
    userId: Number.isFinite(userId) && userId > 0 ? userId : null,
    planId,
    periodId,
    days: Number.isFinite(days) && days > 0 ? days : null,
    amount: Number.isFinite(amount) && amount >= 0 ? amount : null,
    currency,
    localPaymentId,
  };
}

function validatePlanMetadata(resolvedPlan, metadata) {
  if (!resolvedPlan || !metadata.planId || !metadata.days) return false;
  if (resolvedPlan.planId !== metadata.planId) return false;
  if (Number(resolvedPlan.days) !== Number(metadata.days)) return false;
  if (metadata.periodId && resolvedPlan.periodId !== metadata.periodId) return false;
  if (metadata.amount !== null && Number(resolvedPlan.amount) !== Number(metadata.amount)) return false;
  if (metadata.currency && String(resolvedPlan.currency).toUpperCase() !== String(metadata.currency).toUpperCase()) {
    return false;
  }
  return true;
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

function hasStartPlanInMetadata(metadata) {
  return String(metadata?.planId || "").trim().toLowerCase() === "start-30";
}

async function hasUsedStartPlanForBillingScope({ orgId = null, userId = null }) {
  const where = orgId
    ? {
        status: "succeeded",
        user: { orgId },
      }
    : {
        status: "succeeded",
        userId: Number(userId || 0),
      };

  const payments = await prisma.payment.findMany({
    where,
    select: {
      metadata: true,
    },
  });

  return payments.some((entry) => hasStartPlanInMetadata(entry?.metadata));
}

async function applyPaymentSuccess({ paymentRecord, providerPayment, plan }) {
  const userId = paymentRecord.userId;
  const now = new Date();
  const current = await prisma.subscription.findFirst({ where: { userId } });
  const canExtendFromCurrent =
    Boolean(current) &&
    ["active", "trialing"].includes(String(current?.status || "").toLowerCase()) &&
    current?.paidUntil &&
    new Date(current.paidUntil) > now;
  const baseDate = canExtendFromCurrent ? new Date(current.paidUntil) : now;
  const nextPaidUntil = addDays(baseDate, plan.days);

  const existingMetadata = paymentRecord.metadata || {};
  const processedProviderPaymentIds = Array.isArray(existingMetadata.processedProviderPaymentIds)
    ? existingMetadata.processedProviderPaymentIds
    : [];
  const providerPaymentId = providerPayment?.id ? String(providerPayment.id) : null;
  const nextProcessedProviderPaymentIds = providerPaymentId
    ? Array.from(new Set([...processedProviderPaymentIds, providerPaymentId]))
    : processedProviderPaymentIds;

  const isTrialPlan = plan.id === "trial-1";

  await prisma.subscription.upsert({
    where: { userId },
    update: {
      plan: plan.id,
      status: isTrialPlan ? "trialing" : "active",
      paidUntil: nextPaidUntil,
      trialStartedAt: isTrialPlan ? current?.trialStartedAt || now : current?.trialStartedAt || null,
      trialUsed: isTrialPlan ? true : Boolean(current?.trialUsed),
    },
    create: {
      userId,
      plan: plan.id,
      status: isTrialPlan ? "trialing" : "active",
      paidUntil: nextPaidUntil,
      trialStartedAt: isTrialPlan ? now : null,
      trialUsed: isTrialPlan,
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
  const subscription = isSystemOwner
    ? null
    : await getOrgSubscription(user.orgId || null, userId);
  const subscriptionPlan = subscription?.plan ? String(subscription.plan) : null;
  const permissions = applyPlanPermissionCap(
    resolveUserPermissions({
      role: user.role,
      permissionsJson: user.permissionsJson,
      isSystemOwner,
    }),
    subscriptionPlan
  );
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
  PERMISSION_KEYS.TSD_SHIP,
  PERMISSION_KEYS.TSD_PALLETS,
  PERMISSION_KEYS.TSD_DISCREPANCIES,
];

const WAREHOUSE_ROUTE_RULES = [
  { prefix: "/requests", key: PERMISSION_KEYS.WAREHOUSE_REQUESTS },
  { prefix: "/tasks", key: PERMISSION_KEYS.WAREHOUSE_TASKS },
  { prefix: "/locations", key: PERMISSION_KEYS.WAREHOUSE_LOCATIONS },
  { prefix: "/print", key: PERMISSION_KEYS.WAREHOUSE_LOCATIONS },
  { prefix: "/qr/print", key: PERMISSION_KEYS.WAREHOUSE_LOCATIONS },
  { prefix: "/labels", key: PERMISSION_KEYS.WAREHOUSE_LOCATIONS },
  { prefix: "/transactions", key: PERMISSION_KEYS.WAREHOUSE_TRANSACTIONS },
  { prefix: "/revisions", key: PERMISSION_KEYS.WAREHOUSE_REVISION },
  { prefix: "/stock", key: PERMISSION_KEYS.WAREHOUSE_INVENTORY },
  { prefix: "/placements", key: PERMISSION_KEYS.WAREHOUSE_ORDERS },
  { prefix: "/holds", key: PERMISSION_KEYS.WAREHOUSE_MANAGE },
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
app.use("/api/support", auth, enforceOperationalTenantScope, requireCompanyOwnerSupport);
app.use(
  "/api/pallets",
  auth,
  enforceOperationalTenantScope,
  requireAnyPermission([PERMISSION_KEYS.WAREHOUSE_TSD, PERMISSION_KEYS.TSD_PALLETS])
);
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

  // "Внутренний мессенджер" скрывает только внешний режим интеграции.
  if (
    hasPermission(req.user, PERMISSION_KEYS.WAREHOUSE_QUEUE) &&
    isReadRequest(req) &&
    (req.path === "/" || req.path === "")
  ) {
    return next();
  }

  // SaaS-режим: доступ в раздел даём только по ролям.
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
app.use("/api/orders", auth, enforceOperationalTenantScope, (req, res, next) => {
  if (hasPermission(req.user, PERMISSION_KEYS.WAREHOUSE_ORDERS)) {
    return next();
  }
  const isStatusHistoryEndpoint =
    isReadRequest(req) &&
    (req.path === "/status-history" || /^\/\d+\/status-history$/.test(req.path));
  if (
    isStatusHistoryEndpoint &&
    hasPermission(req.user, PERMISSION_KEYS.ADMIN_WAREHOUSE)
  ) {
    return next();
  }
  return denySectionAccess(res);
});
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

      const isOwnTasksRead =
        isReadRequest(req) && req.path === "/tasks/my";
      const isOwnTaskStatusUpdate =
        req.method === "PUT" && /^\/tasks\/\d+\/status$/.test(req.path);
      const isOwnTaskResponseUpdate =
        req.method === "PUT" && /^\/tasks\/\d+\/response$/.test(req.path);
      const canUseOwnTaskEndpointsWithoutPermission =
        (isOwnTasksRead || isOwnTaskStatusUpdate || isOwnTaskResponseUpdate) &&
        !hasPermission(req.user, PERMISSION_KEYS.WAREHOUSE_TASKS);
      if (canUseOwnTaskEndpointsWithoutPermission) {
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

app.use(
  "/api/admin",
  adminRoutes({
    prisma,
    auth,
    requireAdmin,
    enforceOperationalTenantScope,
    getOrgPlanAndUserLimit,
  })
);

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

function buildLocationQrCode(location) {
  if (!location) return "";
  const fallbackCode = buildLocationCode(location);
  const base = normalizePalletCode(location.code || location.name || fallbackCode);
  if (!base) return "";
  return `BP:LOCATION:${base}`;
}

function isLegacyLocationQrCode(value) {
  const normalized = normalizePalletCode(value);
  if (!normalized) return false;
  if (normalized.startsWith("BP:LOC:")) return true;
  return /^BP:LOCATION:\d+$/i.test(normalized);
}

async function ensureBusinessLocationQrCode(location, tx = prisma) {
  if (!location?.id) return "";
  const nextQrCode = buildLocationQrCode(location);
  if (!nextQrCode) return "";

  const currentQrCode = normalizePalletCode(location.qrCode);
  if (currentQrCode === nextQrCode && !isLegacyLocationQrCode(currentQrCode)) {
    return currentQrCode;
  }

  await ensureUniqueLocationCodes({ qrCode: nextQrCode }, location.id);
  const updated = await tx.warehouseLocation.update({
    where: { id: location.id },
    data: { qrCode: nextQrCode },
    select: { qrCode: true },
  });
  return normalizePalletCode(updated?.qrCode) || nextQrCode;
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
app.use("/api/safety", auth, enforceOperationalTenantScope, requireHr);

app.get("/api/safety/instructions", async (req, res) => {
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

app.get("/api/safety/assignments", async (req, res) => {
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

app.get("/api/safety/resources", async (req, res) => {
  try {
    res.json(SAFETY_RESOURCES);
  } catch (err) {
    console.error("safety resources error:", err);
    res.status(500).json({ message: "Failed to load safety resources" });
  }
});

app.put(
  "/api/safety/assignments/:id/complete",
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


app.post("/api/safety/assignments/:id/remind", async (req, res) => {
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

    if (!assignment.dueDate) {
      return res.status(400).json({ message: "Не задан срок инструктажа." });
    }

    await sendSafetyReminderForAssignment(assignment, true);
    return res.json({ message: "Уведомление отправлено." });
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
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9А-ЯЁ]/g, "");
  if (!normalized) return "";
  return normalizeLocationCodeAlias(normalized);
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

async function getOrCreateReceivingLocation(orgIdInput = null) {
  const code = "RECEIVING";
  const normalizedOrgId = Number.isFinite(Number(orgIdInput))
    ? Number(orgIdInput)
    : null;
  const where = {
    orgId: normalizedOrgId,
    OR: [{ code }, { name: "\u0417\u043e\u043d\u0430 \u043f\u0440\u0438\u0435\u043c\u043a\u0438" }, { name: "RECEIVING" }],
  };

  let location = await prisma.warehouseLocation.findFirst({ where });
  if (!location) {
    try {
      location = await prisma.warehouseLocation.create({
        data: {
          orgId: normalizedOrgId,
          code,
          name: "\u0417\u043e\u043d\u0430 \u043f\u0440\u0438\u0435\u043c\u043a\u0438",
        },
      });
    } catch (err) {
      if (err?.code !== "P2002") throw err;
      location = await prisma.warehouseLocation.findFirst({ where });
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
  // NOTE: legacy datasets may contain placement rows that reference deleted
  // locations. Avoid relation include here, then map locations safely.
  const rows = await prisma.warehousePlacement.findMany({
    where: {
      itemId,
      qty: { gt: 0 },
    },
    select: {
      locationId: true,
      qty: true,
    },
    orderBy: [{ locationId: "asc" }, { id: "asc" }],
  });

  const locationIds = Array.from(
    new Set(
      (rows || [])
        .map((row) => Number(row.locationId))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );

  const locations = locationIds.length
    ? await prisma.warehouseLocation.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, name: true, code: true, zone: true, aisle: true, rack: true, level: true },
      })
    : [];
  const locationById = new Map(locations.map((location) => [location.id, location]));

  return rows
    .map((row) => {
      const locationId = Number(row.locationId);
      return {
        locationId,
        location: locationById.get(locationId) || null,
        qty: Number(row.qty) || 0,
      };
    })
    .filter((row) => row.locationId && row.qty > 0 && row.location)
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

async function getActiveHoldQtyForLocation(tx, itemId, locationId) {
  const item = Number(itemId);
  const location = Number(locationId);
  if (!item || !location) return 0;
  const result = await tx.stockHold.aggregate({
    where: {
      itemId: item,
      locationId: location,
      status: "ACTIVE",
    },
    _sum: { qty: true },
  });
  return Math.max(0, Number(result?._sum?.qty) || 0);
}

async function getActiveHoldQtyByLocation(tx, itemId) {
  const item = Number(itemId);
  if (!item) return new Map();
  const rows = await tx.stockHold.groupBy({
    by: ["locationId"],
    where: {
      itemId: item,
      status: "ACTIVE",
      locationId: { not: null },
    },
    _sum: { qty: true },
  });

  const map = new Map();
  for (const row of rows || []) {
    const locationId = Number(row.locationId);
    const qty = Math.max(0, Number(row?._sum?.qty) || 0);
    if (locationId && qty > 0) {
      map.set(locationId, qty);
    }
  }
  return map;
}

async function applyActiveHoldsToBalances(tx, itemId, balances = []) {
  if (!Array.isArray(balances) || balances.length === 0) {
    return [];
  }
  const holdByLocation = await getActiveHoldQtyByLocation(tx, itemId);
  return balances
    .map((row) => {
      const heldQty = Math.max(0, Number(holdByLocation.get(row.locationId)) || 0);
      const qty = Math.max(0, (Number(row.qty) || 0) - heldQty);
      return {
        ...row,
        qty,
        heldQty,
      };
    })
    .filter((row) => row.qty > 0);
}

async function loadPickBalancesSafe(label, loader) {
  try {
    const rows = await loader();
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    console.error("pick plan source error:", {
      source: label,
      error: String(err?.message || err || "unknown"),
    });
    return [];
  }
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
    try {
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
          itemName: line.requestedName || "Неизвестный товар",
          sku: line.requestedSku || null,
          totalQty,
          pickedQty,
          remainingQty: remaining,
          steps: [],
          shortageQty: remaining,
          availableQty: 0,
          onHandQty: 0,
          heldQty: 0,
          shortageReason: "ITEM_NOT_LINKED",
        });
        continue;
      }

      const movementBalances = await loadPickBalancesSafe("movements", () =>
        getItemLocationBalances(resolvedItemId)
      );
      const receivingBalances = await loadPickBalancesSafe("receiving-lines", () =>
        getReceivingLineLocationBalances(resolvedItemId)
      );
      const placementBalances = await loadPickBalancesSafe("placements", () =>
        getPlacementLocationBalances(resolvedItemId)
      );
      // Source priority for pick-plan:
      // 1) stock movements (authoritative actual stock state)
      // 2) receiving lines fallback (legacy/in-flight data)
      // 3) placements fallback (can be stale after old/manual operations)
      const balancesBase =
        movementBalances.length > 0
          ? movementBalances
          : receivingBalances.length > 0
            ? receivingBalances
            : placementBalances;
      let balances = [];
      let holdsApplyFailed = false;
      try {
        balances = await applyActiveHoldsToBalances(prisma, resolvedItemId, balancesBase);
      } catch (holdErr) {
        holdsApplyFailed = true;
        console.error("pick plan holds apply error:", {
          itemId: resolvedItemId,
          error: String(holdErr?.message || holdErr || "unknown"),
        });
        balances = (balancesBase || []).filter((row) => Number(row?.qty) > 0);
      }
      const onHandQty = balancesBase.reduce(
        (sum, row) => sum + Math.max(0, Number(row?.qty) || 0),
        0
      );
      const availableQty = balances.reduce(
        (sum, row) => sum + Math.max(0, Number(row?.qty) || 0),
        0
      );
      const heldQty = Math.max(0, onHandQty - availableQty);
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
        itemName: resolvedItem?.name || line.requestedName || `Товар #${resolvedItemId}`,
        sku: resolvedItem?.sku || line.requestedSku || null,
        barcode: resolvedItem?.barcode || null,
        totalQty,
        pickedQty,
        remainingQty: remaining,
        steps,
        shortageQty: Math.max(0, need),
        availableQty: Math.max(0, Math.trunc(availableQty)),
        onHandQty: Math.max(0, Math.trunc(onHandQty)),
        heldQty: Math.max(0, Math.trunc(heldQty)),
        shortageReason:
          need <= 0
            ? null
            : holdsApplyFailed
              ? "HOLDS_CALC_ERROR"
              : movementBalances.length === 0 &&
                  receivingBalances.length === 0 &&
                  placementBalances.length === 0
                ? "BALANCE_SOURCE_ERROR"
                : availableQty <= 0 && onHandQty > 0 && heldQty > 0
                  ? "HELD_STOCK"
                  : onHandQty <= 0
                    ? "NO_STOCK_ON_HAND"
                    : "INSUFFICIENT_AVAILABLE",
      });
    } catch (lineErr) {
      const totalQty = Number(line?.qty) || 0;
      const pickedQty = Number(line?.pickedQty) || 0;
      const remainingQty = Math.max(0, totalQty - pickedQty);
      console.error("build order pick plan line error:", {
        orderId,
        lineId: line?.id || null,
        itemId: line?.itemId || null,
        error: String(lineErr?.message || lineErr || "unknown"),
      });
      plan.push({
        lineId: line?.id || null,
        itemId: line?.itemId || null,
        itemName: line?.item?.name || line?.requestedName || "Товар",
        sku: line?.item?.sku || line?.requestedSku || null,
        barcode: line?.item?.barcode || null,
        totalQty,
        pickedQty,
        remainingQty,
        steps: [],
        shortageQty: remainingQty,
        availableQty: 0,
        onHandQty: 0,
        heldQty: 0,
        shortageReason: "PLAN_BUILD_ERROR",
      });
    }
  }

  return plan;
}

function buildOrderLabelHtml(order) {
  const createdAt = order?.createdAt
    ? new Date(order.createdAt).toLocaleString("ru-RU")
    : "";
  const linesHtml = (order?.lines || [])
    .map((line, idx) => {
      const name = line.item?.name || line.requestedName || `Товар #${line.itemId || "?"}`;
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
  <title>Этикетка заказа ${escapeHtml(order.orderNumber)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 16px; color: #111; }
    .label { border: 1px solid #111; border-radius: 8px; padding: 14px; max-width: 860px; }
    h1 { font-size: 22px; margin: 0 0 8px 0; }
    .meta { margin: 6px 0; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #c7c7c7; padding: 6px; font-size: 13px; text-align: left; }
    .barcode { margin-top: 12px; font-family: monospace; font-size: 18px; font-weight: 700; }
    .print-actions { margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; }
    .print-btn { padding: 6px 14px; font-size: 13px; cursor: pointer; }
    @media print {
      body { margin: 0; }
      .label { border: none; }
      .print-actions { display: none; }
    }
  </style>
</head>
<body>
  <div class="label">
    <h1>Заказ ${escapeHtml(order.orderNumber)}</h1>
    <div class="meta"><b>Покупатель:</b> ${escapeHtml(order.customerName)}</div>
    <div class="meta"><b>Телефон:</b> ${escapeHtml(order.customerPhone || "")}</div>
    <div class="meta"><b>Адрес:</b> ${escapeHtml(order.shippingAddress)}</div>
    <div class="meta"><b>Комментарий:</b> ${escapeHtml(order.deliveryComment || "")}</div>
    <div class="meta"><b>Коробка:</b> ${escapeHtml(order.boxCode || "-")} (${escapeHtml(order.boxType || "-")})</div>
    <div class="meta"><b>Создан:</b> ${escapeHtml(createdAt)}</div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Товар</th>
          <th>Артикул</th>
          <th>Кол-во</th>
        </tr>
      </thead>
      <tbody>
        ${linesHtml}
      </tbody>
    </table>
    <div class="barcode">ORDER: ${escapeHtml(order.orderNumber)}</div>
    <div class="print-actions">
      <button class="print-btn" onclick="window.print()">Печать</button>
      <button class="print-btn" onclick="returnToApp()">Назад</button>
    </div>
  </div>
  <script>
    function returnToApp() {
      try {
        if (window.opener && !window.opener.closed) {
          window.close();
          return;
        }
      } catch (e) {}
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
      window.location.href = "/warehouse";
    }
    window.onload = () => window.print();
  </script>
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
      <button class="print-btn" onclick="returnToApp()">&#1053;&#1072;&#1079;&#1072;&#1076;</button>
    </div>
  </div>
<script>
  function returnToApp() {
    try {
      if (window.opener && !window.opener.closed) {
        window.close();
        return;
      }
    } catch (e) {}
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = "/warehouse/tsd";
  }

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

async function sendSafetyReminderForAssignment(a, force = false) {
  if (!a?.dueDate) return false;
  const orgId = Number(a?.orgId || a?.employee?.orgId || 0);
  if (!orgId) return false;

  const now = new Date();
  const due = new Date(a.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const diffDays = Math.floor((due - now) / (1000 * 60 * 60 * 24));
  if (!force && diffDays > 3) return false;

  if (!force && a.lastReminderAt) {
    const last = new Date(a.lastReminderAt);
    const hoursSince = (now - last) / (1000 * 60 * 60);
    if (hoursSince < 20) return false;
  }

  const instructionTitle = String(a?.instruction?.title || "").trim() || "Инструкция";
  const employeeName = String(a?.employee?.fullName || "").trim() || "Сотрудник";
  const dueStr = due.toLocaleDateString("ru-RU");
  const statusText =
    diffDays >= 0
      ? `Осталось дней: ${diffDays + 1}`
      : `Просрочено на ${Math.abs(diffDays)} дн.`;
  const title = "Напоминание по инструктажу";
  const message = `Инструкция: ${instructionTitle}. Сотрудник: ${employeeName}. Срок: ${dueStr}. ${statusText}`;

  const recipients = await getCrossdockDiscrepancyRecipients(orgId);
  if (!recipients.length) return false;
  for (const recipient of recipients) {
    await createWarehouseNotification({
      orgId: recipient.orgId,
      userId: recipient.id,
      type: "SAFETY_REMINDER",
      title,
      message,
      linkUrl: "/hr",
      payloadJson: {
        scope: "safety_reminder",
        assignmentId: Number(a?.id || 0) || null,
        employeeName,
        instructionTitle,
        dueDate: due.toISOString(),
        diffDays,
      },
      sendWebPush: true,
    }).catch(() => null);
  }

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

// ================== НАПОМИНАНИЯ ПО ЗАДАЧАМ СКЛАДА ==================

async function checkWarehouseTaskNotifications() {
  try {
    const now = new Date();

    const tasks = await prisma.warehouseTask.findMany({
      where: {
        dueDate: { not: null },
        status: { in: ["NEW", "IN_PROGRESS"] },
      },
      select: {
        id: true,
        orgId: true,
        title: true,
        dueDate: true,
        lastReminderAt: true,
        executorUserId: true,
        assignerId: true,
      },
    });

    for (const task of tasks) {
      if (!task.orgId) continue;
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

      const dueStr = due.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      // 1) За 10 минут до срока — одно напоминание (только исполнителю).
      if (diffMinutes <= 10 && diffMinutes > 0 && !task.lastReminderAt) {
        if (task.executorUserId) {
          await createWarehouseNotification({
            orgId: task.orgId,
            userId: task.executorUserId,
            type: "TASK_DUE_SOON",
            title: "Срок задачи скоро истекает",
            message: `Задача "${task.title}" до ${dueStr}.`,
            linkUrl: TASKS_JOURNAL_LINK,
            payloadJson: { taskId: task.id, dueDate: task.dueDate },
          });
        }

        await prisma.warehouseTask.update({
          where: { id: task.id },
          data: { lastReminderAt: now },
        });
        continue;
      }

      // 2) Просрочка:
      // - первое уведомление сразу после наступления срока;
      // - затем повтор раз в час;
      // - исполнителю и руководителю (назначившему), если это разные люди.
      const hadDueSoonReminder = Boolean(last && last.getTime() < due.getTime());
      const shouldSendOverdue =
        diffMinutes < 0 &&
        (!last || hadDueSoonReminder || minutesSinceLast >= 60);

      if (shouldSendOverdue) {
        if (task.executorUserId) {
          await createWarehouseNotification({
            orgId: task.orgId,
            userId: task.executorUserId,
            type: "TASK_OVERDUE",
            title: "Задача просрочена",
            message: `Задача "${task.title}" просрочена (срок: ${dueStr}).`,
            linkUrl: TASKS_JOURNAL_LINK,
            payloadJson: { taskId: task.id, dueDate: task.dueDate },
          });
        }

        if (task.assignerId && task.assignerId !== task.executorUserId) {
          await createWarehouseNotification({
            orgId: task.orgId,
            userId: task.assignerId,
            type: "TASK_OVERDUE",
            title: "Просрочена назначенная задача",
            message: `Задача "${task.title}" просрочена (срок: ${dueStr}).`,
            linkUrl: TASKS_JOURNAL_LINK,
            payloadJson: { taskId: task.id, dueDate: task.dueDate },
          });
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
        orgId: Number(item.orgId || 0) || null,
        name: item.name,
        unit: item.unit,
        minStock: item.minStock,
        currentStock,
      });
    }
  }

  return result;
}

// 2. Отправить сводку по низким остаткам во внутренние уведомления (админы/владелец)
async function sendDailyLowStockSummary() {
  try {
    const lowItems = await getLowStockItems();
    const now = new Date();
    const dateStr = now.toLocaleDateString("ru-RU");

    if (!lowItems.length) return;

    const byOrg = new Map();
    for (const item of lowItems) {
      const orgId = Number(item?.orgId || 0);
      if (!orgId) continue;
      if (!byOrg.has(orgId)) byOrg.set(orgId, []);
      byOrg.get(orgId).push(item);
    }
    if (!byOrg.size) return;

    for (const [orgId, orgItems] of byOrg.entries()) {
      const recipients = await getCrossdockDiscrepancyRecipients(orgId);
      if (!recipients.length) continue;

      const preview = orgItems
        .slice(0, 8)
        .map((it) => `• ${it.name}: ${it.currentStock} ${it.unit || "шт."} (мин. ${it.minStock})`)
        .join("; ");
      const tail = orgItems.length > 8 ? `; +ещё ${orgItems.length - 8}` : "";

      const title = "Низкий остаток товаров";
      const message = `На ${dateStr} ниже минимума: ${orgItems.length}. ${preview}${tail}`;
      const payloadJson = {
        scope: "low_stock_summary",
        date: dateStr,
        total: orgItems.length,
        items: orgItems.slice(0, 30).map((it) => ({
          id: Number(it?.id || 0) || null,
          name: String(it?.name || "").trim(),
          currentStock: Number(it?.currentStock || 0),
          minStock: Number(it?.minStock || 0),
          unit: String(it?.unit || "").trim() || null,
        })),
      };

      for (const recipient of recipients) {
        await createWarehouseNotification({
          orgId: recipient.orgId,
          userId: recipient.id,
          type: "LOW_STOCK_SUMMARY",
          title,
          message,
          linkUrl: "/warehouse",
          payloadJson,
          sendWebPush: true,
        }).catch(() => null);
      }
    }
  } catch (err) {
    console.error("[sendDailyLowStockSummary] Ошибка:", err);
  }
}

// ================== АУТЕНТИФИКАЦИЯ ==================

// регистрация
app.post("/api/register", async (req, res) => {

  if (String(process.env.DISABLE_PUBLIC_REGISTER || "false") === "true") {
    return res.status(403).json({
      message: "\u041f\u0443\u0431\u043b\u0438\u0447\u043d\u0430\u044f \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f \u043e\u0442\u043a\u043b\u044e\u0447\u0435\u043d\u0430. \u0420\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u0442\u043e\u043b\u044c\u043a\u043e \u043f\u043e \u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044e \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0430."
    });
  }


  try {
    const {
      email,
      password,
      name,
      phone,
      company,
      companyName,
      privacyAccepted,
      marketingAccepted,
      consentVersion,
    } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = normalizeFullName(name);
    const normalizedPhone = String(phone || "").trim().slice(0, 40);
    const normalizedCompanyName = String(companyName || company || "")
      .trim()
      .slice(0, 120);

    if (!normalizedEmail || !password || !normalizedName || !normalizedPhone || !normalizedCompanyName) {
      return res
        .status(400)
        .json({ message: "Заполните все обязательные поля." });
    }

    const isPrivacyAccepted = toBoolean(privacyAccepted);
    const isMarketingAccepted = toBoolean(marketingAccepted);
    const marketingConsentAt = isMarketingAccepted ? new Date() : null;
    if (!isPrivacyAccepted) {
      return res.status(400).json({ message: "PRIVACY_CONSENT_REQUIRED" });
    }

    if (!isValidFullName(normalizedName)) {
      return res.status(400).json({ message: "FULL_NAME_INVALID" });
    }

    if (!isValidRegistrationEmail(normalizedEmail)) {
      return res.status(400).json({ message: "EMAIL_INVALID" });
    }

    if (!isValidPhone(normalizedPhone)) {
      return res.status(400).json({ message: "PHONE_INVALID" });
    }

    if (normalizedCompanyName.length < 2) {
      return res.status(400).json({ message: "COMPANY_INVALID" });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ message: "WEAK_PASSWORD" });
    }

    if (isOwnerEmail(normalizedEmail)) {
      return res.status(400).json({ message: "OWNER_EMAIL_RESERVED" });
    }

    const hash = await bcrypt.hash(password, 10);
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (existing?.emailVerifiedAt) {
      return res.status(400).json({ message: "EMAIL_ALREADY_EXISTS" });
    }

    let user = null;

    if (existing) {
      let orgId = existing.orgId || null;
      if (!orgId) {
        const createdOrg = await prisma.organization.create({
          data: {
            name: normalizedCompanyName || normalizedName || normalizedEmail,
            code: makeTenantCode(normalizedCompanyName || normalizedName || normalizedEmail),
            isActive: true,
          },
        });
        orgId = createdOrg.id;
      }

      user = await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: normalizedName,
          password: hash,
          passwordHash: hash,
          passwordVisible: String(password),
          role: "EMPLOYEE",
          orgId,
          isActive: true,
          emailVerifiedAt: null,
          marketingEmailsEnabled: isMarketingAccepted,
          marketingConsentAt,
          marketingUnsubscribedAt: null,
        },
      });
    } else {
      const org = await prisma.organization.create({
        data: {
          name: normalizedCompanyName || normalizedName || normalizedEmail,
          code: makeTenantCode(normalizedCompanyName || normalizedName || normalizedEmail),
          isActive: true,
        },
      });

      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          password: hash,
          passwordHash: hash,
          passwordVisible: String(password),
          name: normalizedName,
          role: "EMPLOYEE",
          orgId: org.id,
          isActive: true,
          emailVerifiedAt: null,
          marketingEmailsEnabled: isMarketingAccepted,
          marketingConsentAt,
          marketingUnsubscribedAt: null,
        },
      });
    }

    const code = createEmailVerificationCode();
    const now = new Date();
    const consentSnapshot = buildRegistrationConsentSnapshot(req, {
      privacyAccepted: isPrivacyAccepted,
      marketingAccepted: isMarketingAccepted,
      consentVersion,
    });
    await prisma.emailVerificationCode.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    });
    await prisma.emailVerificationCode.create({
      data: {
        userId: user.id,
        codeHash: hashEmailVerificationCode(code),
        expiresAt: new Date(now.getTime() + EMAIL_VERIFY_TTL_MS),
        phone: normalizedPhone || null,
        companyName: normalizedCompanyName || null,
        note: JSON.stringify(consentSnapshot),
      },
    });
    await ensureEmailVerificationCodeDelivered(normalizedEmail, code);

    res.status(200).json({
      ok: true,
      requiresVerification: true,
      email: normalizedEmail,
      message: "Код подтверждения отправлен на почту.",
    });
  } catch (err) {
    if (err?.status && err?.message) {
      return res.status(err.status).json({ message: err.message });
    }
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
      try {
        await ensureOwnerAdminAccount();
      } catch (ownerRecoveryError) {
        console.error("[OWNER_RECOVERY] login-time ensure failed:", ownerRecoveryError);
        // Не блокируем вход, если автопочинка owner-аккаунта временно недоступна.
      }
    }

    let user = null;

    if (!normalizedLogin.includes("@")) {
      user = await prisma.user.findUnique({
        where: { username: normalizedLogin },
      });
    }

    if (!user) {
      user = await findUserByEmailInsensitive(normalizedLogin);
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

    if (!user.emailVerifiedAt) {
      return res.status(403).json({
        message: "EMAIL_NOT_VERIFIED",
      });
    }

    const token = createToken(user);

    let userPayload = null;
    try {
      userPayload = await getUserPayload(user.id);
    } catch (payloadError) {
      console.error("[LOGIN_PAYLOAD] failed, fallback response used:", payloadError);
    }

    res.json({
      message: "Вход выполнен",
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
    if (isPermissionDeniedForTable(err, "User")) {
      return res.status(500).json({ message: "AUTH_DB_PERMISSION_USER_TABLE" });
    }
    if (isPermissionDeniedForTable(err, "Organization")) {
      return res.status(500).json({ message: "AUTH_DB_PERMISSION_ORG_TABLE" });
    }
    if (String(err?.name || "").includes("PrismaClientUnknownRequestError")) {
      return res.status(500).json({ message: "AUTH_DB_QUERY_ERROR" });
    }
    console.error("login error:", err);
    res.status(500).json({ message: "Ошибка сервера при входе" });
  }
});

app.post("/api/auth/verify-email-code", async (req, res) => {
  try {
    const { email, code } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    const normalizedCode = String(code || "").trim();

    if (!normalizedEmail || !/^\d{6}$/.test(normalizedCode)) {
      return res.status(400).json({ message: "BAD_REQUEST" });
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: { organization: true },
    });
    if (!user) {
      return res.status(400).json({ message: "EMAIL_VERIFY_CODE_INVALID" });
    }
    if (user.emailVerifiedAt) {
      return res.status(400).json({ message: "EMAIL_ALREADY_VERIFIED" });
    }

    const latestCode = await prisma.emailVerificationCode.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: "desc" },
    });
    const now = new Date();

    if (!latestCode || latestCode.expiresAt <= now) {
      return res.status(400).json({ message: "EMAIL_VERIFY_CODE_EXPIRED" });
    }
    if ((latestCode.attempts || 0) >= EMAIL_VERIFY_MAX_ATTEMPTS) {
      return res.status(429).json({ message: "EMAIL_VERIFY_TOO_MANY_ATTEMPTS" });
    }

    const incomingHash = hashEmailVerificationCode(normalizedCode);
    if (incomingHash !== latestCode.codeHash) {
      await prisma.emailVerificationCode.update({
        where: { id: latestCode.id },
        data: { attempts: { increment: 1 } },
      });
      return res.status(400).json({ message: "EMAIL_VERIFY_CODE_INVALID" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.emailVerificationCode.update({
        where: { id: latestCode.id },
        data: { usedAt: now },
      });
      await tx.emailVerificationCode.updateMany({
        where: { userId: user.id, usedAt: null, id: { not: latestCode.id } },
        data: { usedAt: now },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: now, isActive: true },
      });
    });

    const consentSnapshot = parseRegistrationConsentSnapshot(latestCode.note);
    await sendNewClientNotification({
      email: user.email,
      name: user.name,
      phone: latestCode.phone,
      companyName: latestCode.companyName || user.organization?.name || null,
      consent: consentSnapshot,
      verifiedAt: now,
    }).catch((err) => {
      console.error("new client notify error:", err);
    });

    const verifiedUser = await prisma.user.findUnique({ where: { id: user.id } });
    await sendMarketingWelcomeEmail(verifiedUser).catch((err) => {
      console.error("marketing welcome email error:", err);
    });
    const token = createToken(verifiedUser);
    const userPayload = await getUserPayload(user.id);

    return res.json({
      ok: true,
      token,
      user: userPayload || {
        id: verifiedUser.id,
        email: verifiedUser.email,
        username: verifiedUser.username || null,
        login: verifiedUser.username || verifiedUser.email,
        name: verifiedUser.name,
        role: verifiedUser.role,
        permissions: resolveUserPermissions({
          role: verifiedUser.role,
          permissionsJson: null,
        }),
        permissionTemplate: "ROLE_DEFAULT",
        permissionOverrides: { grants: [], revokes: [] },
        roles: [verifiedUser.role],
        subscription: { isActive: false },
      },
    });
  } catch (err) {
    console.error("verify email code error:", err);
    return res.status(500).json({ message: "EMAIL_VERIFY_ERROR" });
  }
});

app.post("/api/auth/resend-email-code", async (req, res) => {
  const publicMessage = "Если аккаунт ожидает подтверждения, код отправлен.";
  try {
    const { email } = req.body || {};
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return res.json({ message: publicMessage });
    }

    const nowMs = Date.now();
    const lastSendMs = emailVerifyResendRate.get(normalizedEmail) || 0;
    if (nowMs - lastSendMs < EMAIL_VERIFY_RESEND_COOLDOWN_MS) {
      return res.status(429).json({ message: "EMAIL_VERIFY_RATE_LIMIT" });
    }

    const cutoff = nowMs - EMAIL_VERIFY_RESEND_COOLDOWN_MS;
    while (emailVerifyGlobalRate.length && emailVerifyGlobalRate[0] < cutoff) {
      emailVerifyGlobalRate.shift();
    }
    if (emailVerifyGlobalRate.length >= EMAIL_VERIFY_GLOBAL_LIMIT) {
      return res.status(429).json({ message: "EMAIL_VERIFY_RATE_LIMIT" });
    }
    emailVerifyResendRate.set(normalizedEmail, nowMs);
    emailVerifyGlobalRate.push(nowMs);

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (!user || user.isActive === false || user.emailVerifiedAt) {
      return res.json({ message: publicMessage });
    }

    const lastCode = await prisma.emailVerificationCode.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: "desc" },
    });

    const code = createEmailVerificationCode();
    const now = new Date();
    await prisma.emailVerificationCode.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    });
    await prisma.emailVerificationCode.create({
      data: {
        userId: user.id,
        codeHash: hashEmailVerificationCode(code),
        expiresAt: new Date(now.getTime() + EMAIL_VERIFY_TTL_MS),
        phone: lastCode?.phone || null,
        companyName: lastCode?.companyName || null,
        note: lastCode?.note || null,
      },
    });
    await ensureEmailVerificationCodeDelivered(user.email, code);

    return res.json({ message: "Код подтверждения отправлен повторно." });
  } catch (err) {
    if (err?.status && err?.message) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error("resend email code error:", err);
    return res.status(500).json({ message: "EMAIL_VERIFY_ERROR" });
  }
});

app.post("/api/public/marketing/unsubscribe", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const payload = parseMarketingUnsubscribeToken(token);
    if (!payload?.userId) {
      return res.status(400).json({ message: "BAD_TOKEN" });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, marketingEmailsEnabled: true },
    });
    if (!user) {
      return res.status(400).json({ message: "BAD_TOKEN" });
    }

    const userEmail = normalizeEmail(user.email);
    if (payload.email && payload.email !== userEmail) {
      return res.status(400).json({ message: "BAD_TOKEN" });
    }

    if (user.marketingEmailsEnabled !== false) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          marketingEmailsEnabled: false,
          marketingUnsubscribedAt: new Date(),
        },
      });
    }

    return res.json({
      ok: true,
      message: "Вы успешно отписались от рассылки.",
    });
  } catch (err) {
    console.error("marketing unsubscribe error:", err);
    return res.status(500).json({ message: "UNSUBSCRIBE_ERROR" });
  }
});

// профиль текущего пользователя
app.get("/api/profile", auth, async (req, res) => {
    try {
      const userPayload = await getUserPayload(req.user.id);
      if (!userPayload) {
        return res.status(404).json({ message: "Пользователь не найден." });
      }
      res.json(userPayload);
    } catch (err) {
      console.error("profile error:", err);
      res.status(500).json({ message: "Не удалось загрузить профиль пользователя." });
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

  app.post("/api/pallets/receive", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const inboundRef = normalizePalletText(req.body?.inboundRef, 120) || null;
      const supplierName = normalizePalletText(req.body?.supplierName, 160) || null;
      const receiveGate = normalizePalletGate(req.body?.receiveGate ?? req.body?.gate, 40) || null;
      if (!supplierName) {
        return res.status(400).json({ message: "PALLET_SUPPLIER_REQUIRED" });
      }
      if (!inboundRef) {
        return res.status(400).json({ message: "PALLET_INBOUND_REF_REQUIRED" });
      }
      if (!receiveGate) {
        return res.status(400).json({ message: "PALLET_GATE_REQUIRED" });
      }

      let createdBase = null;
      let conflictError = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          createdBase = await prisma.$transaction(async (tx) => {
            const now = new Date();
            const palletCode = await generateUniquePalletCode(orgId, tx);
            const externalCompatCode = crypto.randomBytes(4).toString("hex").toUpperCase();
            let pallet = null;
            try {
              pallet = await tx.pallet.create({
                data: {
                  orgId,
                  palletCode,
                  // Compatibility fallback for deployments where externalCode remains constrained in DB.
                  // Business flow still uses only internal palletCode.
                  externalCode: externalCompatCode,
                  status: "RECEIVED",
                  supplierName,
                  inboundRef,
                  createdByUserId: req.user.id,
                  receivedAt: now,
                },
              });
            } catch (palletCreateErr) {
              if (!isPermissionDeniedForTable(palletCreateErr, "User")) {
                throw palletCreateErr;
              }

              const insertedRows = await tx.$queryRaw`
                INSERT INTO "Pallet"
                  ("orgId", "palletCode", "externalCode", "status", "supplierName", "inboundRef", "createdByUserId", "receivedAt", "createdAt", "updatedAt")
                VALUES
                  (${orgId}, ${palletCode}, ${externalCompatCode}, 'RECEIVED'::"PalletStatus", ${supplierName}, ${inboundRef}, ${req.user.id}, ${now}, ${now}, ${now})
                RETURNING
                  "id", "orgId", "palletCode", "externalCode", "status", "supplierName", "inboundRef",
                  "currentLocationId", "createdByUserId", "receivedAt", "storedAt", "dispatchedAt", "createdAt", "updatedAt"
              `;
              if (!Array.isArray(insertedRows) || !insertedRows.length) {
                const fallbackError = new Error("PALLET_CREATE_FAILED");
                fallbackError.code = "PALLET_CREATE_FAILED";
                throw fallbackError;
              }
              pallet = insertedRows[0];
            }

            const baseMeta = {
              supplierName,
              inboundRef,
              receiveGate,
              gate: receiveGate,
            };

            await createPalletEventTx(tx, {
              orgId,
              palletId: pallet.id,
              type: "CREATE",
              fromStatus: null,
              toStatus: "RECEIVED",
              userId: req.user.id,
              metaJson: baseMeta,
            });

            await createPalletEventTx(tx, {
              orgId,
              palletId: pallet.id,
              type: "RECEIVE",
              fromStatus: null,
              toStatus: "RECEIVED",
              userId: req.user.id,
              metaJson: baseMeta,
            });

            return pallet;
          });
          conflictError = null;
          break;
        } catch (txErr) {
          if (txErr?.code === "P2002") {
            conflictError = txErr;
            continue;
          }
          throw txErr;
        }
      }

      if (!createdBase) {
        if (conflictError) {
          return res.status(409).json({ message: "PALLET_CONFLICT" });
        }
        return res.status(500).json({ message: "PALLET_CREATE_FAILED" });
      }

      const created =
        (await prisma.pallet.findFirst({
          where: {
            orgId,
            id: createdBase?.id,
          },
          include: {
            currentLocation: true,
            dispatch: true,
          },
        })) || createdBase;

      if (!created || !created.id) {
        return res.status(500).json({ message: "PALLET_CREATE_FAILED" });
      }

      return res.status(201).json({
        pallet: palletToResponse(created),
        label: {
          palletCode: created.palletCode,
          payload: `bp:pallet:${created.palletCode}`,
          layout: "A4_PASSPORT",
        },
      });
    } catch (err) {
      console.error("pallet receive error details:", toErrorDetails(err));
      if (err?.code === "P2002") {
        return res.status(409).json({ message: "PALLET_CONFLICT" });
      }
      if (err?.code === "P2003") {
        return res.status(500).json({ message: "PALLET_USER_FK_ERROR" });
      }
      if (isPermissionDeniedForTable(err, "User")) {
        return res.status(500).json({ message: "PALLET_DB_PERMISSION_USER_TABLE" });
      }
      if (String(err?.name || "").includes("PrismaClientUnknownRequestError")) {
        return res.status(500).json({ message: "PALLET_DB_QUERY_ERROR" });
      }
      console.error("pallet receive error:", err);
      return res.status(500).json({ message: "PALLET_RECEIVE_ERROR" });
    }
  });

  app.post("/api/pallets/store", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const palletCode = normalizePalletCode(req.body?.palletCode);
      const locationCode = normalizePalletCode(req.body?.locationCode);
      if (!palletCode) {
        return res.status(400).json({ message: "PALLET_CODE_REQUIRED" });
      }
      if (!locationCode) {
        return res.status(400).json({ message: "PALLET_LOCATION_REQUIRED" });
      }

      const storeResult = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const maxStoreAgeMs = 24 * 60 * 60 * 1000;
        const pallet = await tx.pallet.findFirst({
          where: {
            orgId,
            palletCode,
          },
          include: {
            currentLocation: true,
          },
        });

        if (!pallet) {
          const error = new Error("PALLET_NOT_FOUND");
          error.code = "PALLET_NOT_FOUND";
          throw error;
        }
        const targetLocation = await getOrCreatePalletLocationByCode(orgId, locationCode, tx);
        if (!targetLocation) {
          const error = new Error("PALLET_LOCATION_NOT_FOUND");
          error.code = "PALLET_LOCATION_NOT_FOUND";
          throw error;
        }

        const receivedAtMs = pallet.receivedAt ? new Date(pallet.receivedAt).getTime() : NaN;
        if (!Number.isFinite(receivedAtMs) || now.getTime() - receivedAtMs > maxStoreAgeMs) {
          const error = new Error("PALLET_STORE_RECEIVE_EXPIRED");
          error.code = "PALLET_STORE_RECEIVE_EXPIRED";
          throw error;
        }

        if (String(pallet.status || "") === "STORED") {
          if (pallet.currentLocationId === targetLocation.id) {
            return { palletId: pallet.id, idempotent: true };
          }
          const error = new Error("PALLET_ALREADY_STORED");
          error.code = "PALLET_ALREADY_STORED";
          throw error;
        }

        if (String(pallet.status || "") !== "RECEIVED") {
          const error = new Error("PALLET_STORE_STATUS_INVALID");
          error.code = "PALLET_STORE_STATUS_INVALID";
          throw error;
        }

        const updateResult = await tx.pallet.updateMany({
          where: {
            id: pallet.id,
            status: "RECEIVED",
          },
          data: {
            currentLocationId: targetLocation.id,
            status: "STORED",
            storedAt: now,
          },
        });
        if (updateResult.count !== 1) {
          const error = new Error("PALLET_STATE_CHANGED");
          error.code = "PALLET_STATE_CHANGED";
          throw error;
        }

        await createPalletEventTx(tx, {
          orgId,
          palletId: pallet.id,
          type: "STORE",
          fromStatus: pallet.status,
          toStatus: "STORED",
          userId: req.user.id,
          metaJson: {
            fromLocationCode: pallet.currentLocation?.code || null,
            toLocationCode: targetLocation.code,
            toLocationName: targetLocation.name,
          },
        });

        return { palletId: pallet.id, idempotent: false };
      });

      const updatedPallet = storeResult?.palletId
        ? await prisma.pallet.findFirst({
            where: {
              orgId,
              id: storeResult.palletId,
            },
            include: {
              currentLocation: true,
              dispatch: true,
            },
          })
        : null;

      if (!updatedPallet) {
        return res.status(500).json({ message: "PALLET_STORE_FAILED" });
      }
      return res.json({
        pallet: palletToResponse(updatedPallet),
        idempotent: Boolean(storeResult?.idempotent),
      });
    } catch (err) {
      if (err?.code === "PALLET_NOT_FOUND") {
        return res.status(404).json({ message: "PALLET_NOT_FOUND" });
      }
      if (err?.code === "PALLET_STORE_STATUS_INVALID") {
        return res.status(409).json({ message: "PALLET_STORE_STATUS_INVALID" });
      }
      if (err?.code === "PALLET_STORE_RECEIVE_EXPIRED") {
        return res.status(409).json({ message: "PALLET_STORE_RECEIVE_EXPIRED" });
      }
      if (err?.code === "PALLET_ALREADY_STORED") {
        return res.status(409).json({ message: "PALLET_ALREADY_STORED" });
      }
      if (err?.code === "PALLET_LOCATION_REQUIRED") {
        return res.status(400).json({ message: "PALLET_LOCATION_REQUIRED" });
      }
      if (err?.code === "PALLET_STATE_CHANGED") {
        return res.status(409).json({ message: "PALLET_STATE_CHANGED" });
      }
      console.error("pallet store error:", err);
      return res.status(500).json({ message: "PALLET_STORE_ERROR" });
    }
  });

  app.post("/api/pallets/print-label", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const palletCode = normalizePalletCode(req.body?.palletCode);
      const qty = Math.max(1, Math.min(20, Number(req.body?.qty || 1)));
      const layout = String(req.body?.layout || "A4_PASSPORT")
        .trim()
        .toUpperCase();

      if (!palletCode) {
        return res.status(400).json({ message: "PALLET_CODE_REQUIRED" });
      }

      let pallet = null;
      try {
        pallet = await prisma.pallet.findFirst({
          where: {
            orgId,
            palletCode,
          },
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
          },
        });
      } catch (palletFindErr) {
        if (!isPermissionDeniedForTable(palletFindErr, "User")) {
          throw palletFindErr;
        }
        pallet = await prisma.pallet.findFirst({
          where: {
            orgId,
            palletCode,
          },
        });
      }
      if (!pallet) {
        return res.status(404).json({ message: "PALLET_NOT_FOUND" });
      }

      const labelPayload = `bp:pallet:${pallet.palletCode}`;
      const qrBuffer = await renderQrPng(labelPayload);
      const qrImg = `data:image/png;base64,${qrBuffer.toString("base64")}`;

      const isA4Passport = layout === "A4_PASSPORT" || layout === "A4";
      const subtitleParts = [pallet.supplierName, pallet.inboundRef].filter(Boolean);
      const subtitle = subtitleParts.join(" • ");
      const receivedAtText = pallet.receivedAt
        ? new Date(pallet.receivedAt).toLocaleString("ru-RU")
        : "-";
      const receivedByText =
        String(pallet?.createdBy?.name || pallet?.createdBy?.email || "").trim() ||
        (pallet?.createdByUserId ? `ID ${pallet.createdByUserId}` : "-");

      const html = isA4Passport
        ? `
          <html>
            <head>
              <meta charset="utf-8" />
              <title>Паспорт паллеты ${escapeHtml(pallet.palletCode)}</title>
              <style>
                @page { size: A4; margin: 10mm; }
                * { box-sizing: border-box; }
                body { margin: 0; font-family: Arial, sans-serif; color: #0f172a; background: #fff; }
                .page {
                  border: 2px solid #0f3f7a;
                  border-radius: 8px;
                  padding: 8mm;
                  break-inside: avoid;
                  page-break-inside: avoid;
                }
                .page-break { break-after: page; page-break-after: always; }
                .header { display: grid; gap: 3mm; border-bottom: 2px solid #bfdbfe; padding-bottom: 4mm; }
                .title { font-size: 32px; font-weight: 700; letter-spacing: 0.4px; color: #0f3f7a; }
                .subtitle { font-size: 16px; color: #334155; }
                .code-box {
                  display: grid;
                  grid-template-columns: 1fr auto;
                  gap: 8mm;
                  align-items: center;
                  border: 1px solid #bfdbfe;
                  border-radius: 8px;
                  padding: 5mm;
                  margin-top: 5mm;
                }
                .code { font-size: 34px; font-weight: 700; letter-spacing: 1.2px; line-height: 1.1; }
                .payload { margin-top: 2mm; font-size: 13px; color: #334155; word-break: break-all; }
                .qr { width: 54mm; height: 54mm; border: 1px solid #cbd5e1; }
                .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 8mm; align-content: start; margin-top: 5mm; }
                .cell { border-bottom: 1px solid #e2e8f0; padding-bottom: 3mm; }
                .label { font-size: 12px; color: #475569; margin-bottom: 1mm; }
                .value { font-size: 18px; font-weight: 600; color: #0f172a; word-break: break-word; }
                .print-actions {
                  position: fixed;
                  left: 10px;
                  right: 10px;
                  bottom: calc(env(safe-area-inset-bottom, 0px) + 10px);
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: 10px;
                  z-index: 1000;
                }
                .print-btn {
                  min-height: 60px;
                  font-size: 20px;
                  font-weight: 700;
                  border: none;
                  border-radius: 16px;
                  cursor: pointer;
                  background: #0ea5e9;
                  color: #fff;
                }
                @media print {
                  html, body { margin: 0; padding: 0; height: auto; }
                  .page { min-height: auto !important; height: auto !important; }
                  .print-actions { display: none; }
                }
              </style>
            </head>
            <body>
              ${Array.from({ length: qty })
                .map(
                  (_, index) => `
                    <section class="page ${index < qty - 1 ? "page-break" : ""}">
                      <div class="header">
                        <div class="title">Паспорт паллеты</div>
                        <div class="subtitle">Внутренний складской идентификатор LPN</div>
                      </div>

                      <div class="code-box">
                        <div>
                          <div class="code">${escapeHtml(pallet.palletCode)}</div>
                          <div class="payload">${escapeHtml(labelPayload)}</div>
                        </div>
                        <img class="qr" src="${qrImg}" alt="QR ${escapeHtml(pallet.palletCode)}" />
                      </div>

                      <div class="grid">
                        <div class="cell">
                          <div class="label">Поставщик</div>
                          <div class="value">${escapeHtml(pallet.supplierName || "-")}</div>
                        </div>
                        <div class="cell">
                          <div class="label">Машина / ТТН</div>
                          <div class="value">${escapeHtml(pallet.inboundRef || "-")}</div>
                        </div>
                        <div class="cell">
                          <div class="label">Дата приемки</div>
                          <div class="value">${escapeHtml(receivedAtText)}</div>
                        </div>
                        <div class="cell">
                          <div class="label">Принял</div>
                          <div class="value">${escapeHtml(receivedByText)}</div>
                        </div>
                        <div class="cell">
                          <div class="label">Партия</div>
                          <div class="value">${escapeHtml(subtitle || "-")}</div>
                        </div>
                      </div>

                    </section>
                  `
                )
                .join("")}
              <div class="print-actions">
                <button class="print-btn" onclick="window.print()">Печать</button>
                <button class="print-btn" onclick="returnToApp()">Закрыть</button>
              </div>
              <script>
                function returnToApp() {
                  try {
                    if (window.opener && !window.opener.closed) {
                      window.close();
                      return;
                    }
                  } catch (e) {}
                  if (window.history.length > 1) {
                    window.history.back();
                    return;
                  }
                  window.location.href = "/warehouse?section=tsd";
                }
                (function () {
                  const images = Array.from(document.images || []);
                  const finish = () => setTimeout(() => window.print(), 180);
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
        `
        : `
          <html>
            <head>
              <meta charset="utf-8" />
              <title>Паллетная этикетка ${escapeHtml(pallet.palletCode)}</title>
              <style>
                @page { size: ${layout === "A6" ? "A6" : "75mm 50mm"}; margin: ${layout === "A6" ? "6mm" : "0"}; }
                body { font-family: Arial, sans-serif; margin: 0; color: #0f172a; }
                .grid { display: grid; grid-template-columns: 1fr; justify-items: center; gap: 10mm; padding: 6mm; }
                .label {
                  border: 1px solid #dbeafe;
                  background: #ffffff;
                  border-radius: ${layout === "A6" ? "10px" : "0"};
                  width: ${layout === "A6" ? "136mm" : "75mm"};
                  min-height: ${layout === "A6" ? "86mm" : "50mm"};
                  box-sizing: border-box;
                  padding: 3mm;
                  display: grid;
                  align-content: space-between;
                  gap: 2mm;
                }
                .label--page-break {
                  break-after: page;
                  page-break-after: always;
                }
                .label--page-break:last-child {
                  break-after: auto;
                  page-break-after: auto;
                }
                .title {
                  font-size: ${layout === "A6" ? "22px" : "13px"};
                  font-weight: 700;
                  line-height: 1.2;
                  color: #0f3f7a;
                }
                .subtitle {
                  font-size: ${layout === "A6" ? "13px" : "9px"};
                  color: #475569;
                  min-height: 12px;
                }
                .row { display: grid; grid-template-columns: 1fr auto; gap: 3mm; align-items: center; }
                .qr {
                  width: ${layout === "A6" ? "46mm" : "30mm"};
                  height: ${layout === "A6" ? "46mm" : "30mm"};
                  justify-self: end;
                }
                .code {
                  font-size: ${layout === "A6" ? "15px" : "11px"};
                  letter-spacing: 0.3px;
                  font-weight: 700;
                  word-break: break-all;
                }
                .payload {
                  font-size: 8px;
                  color: #64748b;
                  word-break: break-all;
                }
                .print-actions {
                  position: fixed;
                  left: 10px;
                  right: 10px;
                  bottom: calc(env(safe-area-inset-bottom, 0px) + 10px);
                  display: grid;
                  grid-template-columns: 1fr 1fr;
                  gap: 10px;
                  z-index: 1000;
                }
                .print-btn {
                  min-height: 60px;
                  font-size: 20px;
                  font-weight: 700;
                  border: none;
                  border-radius: 16px;
                  cursor: pointer;
                  background: #0ea5e9;
                  color: #fff;
                }
                @media print { .print-actions { display: none; } }
              </style>
            </head>
            <body>
              <div class="${layout === "A6" ? "grid" : ""}">
                ${Array.from({ length: qty })
                  .map(
                    () => `
                      <div class="label ${layout === "A6" ? "" : "label--page-break"}">
                        <div class="title">Паллета</div>
                        <div class="subtitle">${escapeHtml(subtitle || "Внутренний код паллеты")}</div>
                        <div class="row">
                          <div>
                            <div class="code">${escapeHtml(pallet.palletCode)}</div>
                            <div class="payload">${escapeHtml(labelPayload)}</div>
                          </div>
                          <img class="qr" src="${qrImg}" alt="QR ${escapeHtml(pallet.palletCode)}" />
                        </div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
              <div class="print-actions">
                <button class="print-btn" onclick="window.print()">Печать</button>
                <button class="print-btn" onclick="returnToApp()">Закрыть</button>
              </div>
              <script>
                function returnToApp() {
                  try {
                    if (window.opener && !window.opener.closed) {
                      window.close();
                      return;
                    }
                  } catch (e) {}
                  if (window.history.length > 1) {
                    window.history.back();
                    return;
                  }
                  window.location.href = "/warehouse?section=tsd";
                }
                (function () {
                  const images = Array.from(document.images || []);
                  const finish = () => setTimeout(() => window.print(), 180);
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
      return res.send(html);
    } catch (err) {
      console.error("pallet print label error:", err);
      return res.status(500).json({ message: "PALLET_PRINT_LABEL_ERROR" });
    }
  });

  app.get("/api/pallets/route-sheets", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const statusesRaw = String(req.query?.statuses || req.query?.status || "").trim();
      const statuses = statusesRaw
        ? parseRouteSheetStatuses(statusesRaw)
        : ["DRAFT", "PUBLISHED", "LOADING"];
      if (!statuses.length) {
        return res.status(400).json({ message: "ROUTE_SHEET_STATUS_INVALID" });
      }
      const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 80)));

      const sheets = await prisma.palletRouteSheet.findMany({
        where: {
          orgId,
          status: { in: statuses },
        },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          publishedBy: { select: { id: true, name: true, email: true } },
          startedBy: { select: { id: true, name: true, email: true } },
          completedBy: { select: { id: true, name: true, email: true } },
          items: {
            select: {
              id: true,
              status: true,
            },
          },
        },
        orderBy: [{ plannedDate: "asc" }, { createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });

      const items = sheets.map((sheet) =>
        routeSheetToResponse({
          ...sheet,
          summary: summarizeRouteSheetItems(sheet.items),
          items: [],
        })
      );
      return res.json({ items });
    } catch (err) {
      console.error("route-sheet list error:", err);
      return res.status(500).json({ message: "ROUTE_SHEET_LIST_ERROR" });
    }
  });

  app.get("/api/pallets/route-sheets/next-number", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const plannedDate =
        toIsoDateOrNull(req.query?.plannedDate || req.query?.date || null) || new Date();
      const sheetNumber = await generateUniqueRouteSheetNumber(orgId, plannedDate, prisma);

      return res.json({
        sheetNumber,
        year: plannedDate.getUTCFullYear(),
      });
    } catch (err) {
      console.error("route-sheet next-number error:", err);
      return res.status(500).json({ message: "ROUTE_SHEET_NEXT_NUMBER_ERROR" });
    }
  });

  app.post("/api/pallets/route-sheets", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const clientName = normalizePalletText(req.body?.clientName, 160);
      const destinationRc = normalizePalletText(req.body?.destinationRc, 120);
      const route = normalizePalletText(req.body?.route, 120) || null;
      const vehicle = normalizePalletText(req.body?.vehicle, 120);
      const driver = normalizePalletText(req.body?.driver, 160);
      const plannedDate = toIsoDateOrNull(req.body?.plannedDate);
      const notes = normalizePalletText(req.body?.notes, 600) || null;

      if (!clientName) {
        return res.status(400).json({ message: "ROUTE_SHEET_CLIENT_REQUIRED" });
      }
      if (!destinationRc) {
        return res.status(400).json({ message: "PALLET_DESTINATION_REQUIRED" });
      }
      if (!vehicle) {
        return res.status(400).json({ message: "ROUTE_SHEET_VEHICLE_REQUIRED" });
      }
      if (!driver) {
        return res.status(400).json({ message: "ROUTE_SHEET_DRIVER_REQUIRED" });
      }
      if (!plannedDate) {
        return res.status(400).json({ message: "ROUTE_SHEET_DATE_REQUIRED" });
      }

      const createdId = await prisma.$transaction(async (tx) => {
        const sheetNumber = await generateUniqueRouteSheetNumber(orgId, plannedDate, tx);
        const created = await tx.palletRouteSheet.create({
          data: {
            orgId,
            sheetNumber,
            clientName,
            destinationRc,
            route,
            vehicle,
            driver,
            plannedDate,
            notes,
            status: "DRAFT",
            createdByUserId: req.user.id,
          },
          select: { id: true },
        });
        await createRouteSheetEventTx(tx, {
          orgId,
          routeSheetId: created.id,
          type: "CREATE",
          userId: req.user.id,
          metaJson: {
            clientName,
            destinationRc,
            route,
            vehicle,
            driver,
            plannedDate: plannedDate.toISOString(),
          },
        });
        return created.id;
      });

      const routeSheet = await prisma.palletRouteSheet.findFirst({
        where: {
          orgId,
          id: createdId,
        },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          publishedBy: { select: { id: true, name: true, email: true } },
          startedBy: { select: { id: true, name: true, email: true } },
          completedBy: { select: { id: true, name: true, email: true } },
          items: {
            include: {
              pallet: { include: { currentLocation: true, dispatch: true, createdBy: true } },
              loadedBy: { select: { id: true, name: true, email: true } },
            },
            orderBy: [{ plannedAt: "asc" }, { id: "asc" }],
          },
        },
      });
      if (!routeSheet) {
        return res.status(500).json({ message: "ROUTE_SHEET_CREATE_FAILED" });
      }

      return res.json({
        routeSheet: routeSheetToResponse({
          ...routeSheet,
          summary: summarizeRouteSheetItems(routeSheet.items),
        }),
      });
    } catch (err) {
      if (err?.code === "P2002") {
        return res.status(409).json({ message: "ROUTE_SHEET_CONFLICT" });
      }
      console.error("route-sheet create error:", err);
      return res.status(500).json({ message: "ROUTE_SHEET_CREATE_ERROR" });
    }
  });

  app.get("/api/pallets/route-sheets/:routeSheetId", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }
      const routeSheetId = Number(req.params?.routeSheetId || 0);
      if (!routeSheetId) {
        return res.status(400).json({ message: "ROUTE_SHEET_ID_REQUIRED" });
      }

      const routeSheet = await prisma.palletRouteSheet.findFirst({
        where: {
          orgId,
          id: routeSheetId,
        },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          publishedBy: { select: { id: true, name: true, email: true } },
          startedBy: { select: { id: true, name: true, email: true } },
          completedBy: { select: { id: true, name: true, email: true } },
          items: {
            include: {
              pallet: { include: { currentLocation: true, dispatch: true, createdBy: true } },
              loadedBy: { select: { id: true, name: true, email: true } },
            },
            orderBy: [{ plannedAt: "asc" }, { id: "asc" }],
          },
          events: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 120,
          },
        },
      });
      if (!routeSheet) {
        return res.status(404).json({ message: "ROUTE_SHEET_NOT_FOUND" });
      }

      return res.json({
        routeSheet: routeSheetToResponse({
          ...routeSheet,
          summary: summarizeRouteSheetItems(routeSheet.items),
        }),
        events: Array.isArray(routeSheet.events)
          ? routeSheet.events.map((event) => routeSheetEventToResponse(event))
          : [],
      });
    } catch (err) {
      console.error("route-sheet detail error:", err);
      return res.status(500).json({ message: "ROUTE_SHEET_DETAIL_ERROR" });
    }
  });

  app.post("/api/pallets/route-sheets/:routeSheetId/items", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }
      const routeSheetId = Number(req.params?.routeSheetId || 0);
      if (!routeSheetId) {
        return res.status(400).json({ message: "ROUTE_SHEET_ID_REQUIRED" });
      }

      const rawCodes = Array.isArray(req.body?.palletCodes)
        ? req.body.palletCodes
        : req.body?.palletCode != null
          ? [req.body.palletCode]
          : [];
      const palletCodes = Array.from(
        new Set(rawCodes.map((item) => normalizePalletCode(item)).filter(Boolean))
      ).slice(0, 200);
      if (!palletCodes.length) {
        return res.status(400).json({ message: "PALLET_CODE_REQUIRED" });
      }

      await prisma.$transaction(async (tx) => {
        const sheet = await tx.palletRouteSheet.findFirst({
          where: {
            orgId,
            id: routeSheetId,
          },
          select: { id: true, status: true },
        });
        if (!sheet) {
          const error = new Error("ROUTE_SHEET_NOT_FOUND");
          error.code = "ROUTE_SHEET_NOT_FOUND";
          throw error;
        }
        if (sheet.status !== "DRAFT") {
          const error = new Error("ROUTE_SHEET_STATUS_INVALID");
          error.code = "ROUTE_SHEET_STATUS_INVALID";
          throw error;
        }

        const pallets = await tx.pallet.findMany({
          where: {
            orgId,
            palletCode: { in: palletCodes },
            status: "STORED",
          },
          select: { id: true, palletCode: true, currentLocationId: true },
        });
        if (pallets.length !== palletCodes.length) {
          const foundCodes = new Set(pallets.map((item) => item.palletCode));
          const missingCodes = palletCodes.filter((code) => !foundCodes.has(code));
          const error = new Error("ROUTE_SHEET_PALLET_NOT_STORED");
          error.code = "ROUTE_SHEET_PALLET_NOT_STORED";
          error.meta = { missingCodes };
          throw error;
        }

        const palletIds = pallets.map((item) => item.id);
        const reserved = await tx.palletRouteSheetItem.findMany({
          where: {
            orgId,
            palletId: { in: palletIds },
            status: "PLANNED",
            routeSheetId: { not: routeSheetId },
            routeSheet: {
              status: { in: ["DRAFT", "PUBLISHED", "LOADING"] },
            },
          },
          include: {
            pallet: { select: { palletCode: true } },
            routeSheet: { select: { sheetNumber: true, status: true } },
          },
          take: 20,
        });
        if (reserved.length) {
          const error = new Error("ROUTE_SHEET_PALLET_ALREADY_PLANNED");
          error.code = "ROUTE_SHEET_PALLET_ALREADY_PLANNED";
          error.meta = {
            conflicts: reserved.map((item) => ({
              palletCode: item.pallet?.palletCode || null,
              sheetNumber: item.routeSheet?.sheetNumber || null,
              status: item.routeSheet?.status || null,
            })),
          };
          throw error;
        }

        for (const pallet of pallets) {
          const existing = await tx.palletRouteSheetItem.findFirst({
            where: {
              orgId,
              routeSheetId,
              palletId: pallet.id,
            },
            select: { id: true, status: true },
          });
          if (existing?.status === "PLANNED") {
            continue;
          }
          if (existing && existing.status !== "PLANNED") {
            await tx.palletRouteSheetItem.update({
              where: { id: existing.id },
              data: {
                status: "PLANNED",
                loadedAt: null,
                loadedByUserId: null,
              },
            });
            await createRouteSheetEventTx(tx, {
              orgId,
              routeSheetId,
              itemId: existing.id,
              type: "ADD_ITEM",
              userId: req.user.id,
              metaJson: {
                palletCode: pallet.palletCode,
                restored: true,
              },
            });
            continue;
          }
          const createdItem = await tx.palletRouteSheetItem.create({
            data: {
              orgId,
              routeSheetId,
              palletId: pallet.id,
              status: "PLANNED",
            },
            select: { id: true },
          });
          await createRouteSheetEventTx(tx, {
            orgId,
            routeSheetId,
            itemId: createdItem.id,
            type: "ADD_ITEM",
            userId: req.user.id,
            metaJson: {
              palletCode: pallet.palletCode,
            },
          });
        }
      });

      const routeSheet = await prisma.palletRouteSheet.findFirst({
        where: {
          orgId,
          id: routeSheetId,
        },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          publishedBy: { select: { id: true, name: true, email: true } },
          startedBy: { select: { id: true, name: true, email: true } },
          completedBy: { select: { id: true, name: true, email: true } },
          items: {
            include: {
              pallet: { include: { currentLocation: true, dispatch: true, createdBy: true } },
              loadedBy: { select: { id: true, name: true, email: true } },
            },
            orderBy: [{ plannedAt: "asc" }, { id: "asc" }],
          },
        },
      });
      if (!routeSheet) {
        return res.status(404).json({ message: "ROUTE_SHEET_NOT_FOUND" });
      }

      return res.json({
        routeSheet: routeSheetToResponse({
          ...routeSheet,
          summary: summarizeRouteSheetItems(routeSheet.items),
        }),
      });
    } catch (err) {
      if (err?.code === "ROUTE_SHEET_NOT_FOUND") {
        return res.status(404).json({ message: "ROUTE_SHEET_NOT_FOUND" });
      }
      if (err?.code === "ROUTE_SHEET_STATUS_INVALID") {
        return res.status(409).json({ message: "ROUTE_SHEET_STATUS_INVALID" });
      }
      if (err?.code === "ROUTE_SHEET_PALLET_NOT_STORED") {
        return res.status(409).json({
          message: "ROUTE_SHEET_PALLET_NOT_STORED",
          meta: err?.meta || null,
        });
      }
      if (err?.code === "ROUTE_SHEET_PALLET_ALREADY_PLANNED") {
        return res.status(409).json({
          message: "ROUTE_SHEET_PALLET_ALREADY_PLANNED",
          meta: err?.meta || null,
        });
      }
      if (err?.code === "P2002") {
        return res.status(409).json({ message: "ROUTE_SHEET_CONFLICT" });
      }
      console.error("route-sheet add-items error:", err);
      return res.status(500).json({ message: "ROUTE_SHEET_ADD_ITEMS_ERROR" });
    }
  });

  app.delete("/api/pallets/route-sheets/:routeSheetId/items/:itemId", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }
      const routeSheetId = Number(req.params?.routeSheetId || 0);
      const itemId = Number(req.params?.itemId || 0);
      if (!routeSheetId || !itemId) {
        return res.status(400).json({ message: "ROUTE_SHEET_ITEM_ID_REQUIRED" });
      }

      await prisma.$transaction(async (tx) => {
        const sheet = await tx.palletRouteSheet.findFirst({
          where: {
            orgId,
            id: routeSheetId,
          },
          select: { id: true, status: true },
        });
        if (!sheet) {
          const error = new Error("ROUTE_SHEET_NOT_FOUND");
          error.code = "ROUTE_SHEET_NOT_FOUND";
          throw error;
        }
        if (sheet.status !== "DRAFT") {
          const error = new Error("ROUTE_SHEET_STATUS_INVALID");
          error.code = "ROUTE_SHEET_STATUS_INVALID";
          throw error;
        }

        const item = await tx.palletRouteSheetItem.findFirst({
          where: {
            orgId,
            id: itemId,
            routeSheetId,
          },
          include: {
            pallet: { select: { palletCode: true } },
          },
        });
        if (!item) {
          const error = new Error("ROUTE_SHEET_ITEM_NOT_FOUND");
          error.code = "ROUTE_SHEET_ITEM_NOT_FOUND";
          throw error;
        }
        if (item.status !== "PLANNED") {
          const error = new Error("ROUTE_SHEET_ITEM_STATUS_INVALID");
          error.code = "ROUTE_SHEET_ITEM_STATUS_INVALID";
          throw error;
        }

        await tx.palletRouteSheetItem.update({
          where: { id: item.id },
          data: {
            status: "CANCELLED",
            loadedAt: null,
            loadedByUserId: null,
          },
        });
        await createRouteSheetEventTx(tx, {
          orgId,
          routeSheetId,
          itemId: item.id,
          type: "REMOVE_ITEM",
          userId: req.user.id,
          metaJson: {
            palletCode: item.pallet?.palletCode || null,
          },
        });
      });

      return res.json({ ok: true });
    } catch (err) {
      if (err?.code === "ROUTE_SHEET_NOT_FOUND") {
        return res.status(404).json({ message: "ROUTE_SHEET_NOT_FOUND" });
      }
      if (err?.code === "ROUTE_SHEET_ITEM_NOT_FOUND") {
        return res.status(404).json({ message: "ROUTE_SHEET_ITEM_NOT_FOUND" });
      }
      if (err?.code === "ROUTE_SHEET_STATUS_INVALID") {
        return res.status(409).json({ message: "ROUTE_SHEET_STATUS_INVALID" });
      }
      if (err?.code === "ROUTE_SHEET_ITEM_STATUS_INVALID") {
        return res.status(409).json({ message: "ROUTE_SHEET_ITEM_STATUS_INVALID" });
      }
      console.error("route-sheet remove-item error:", err);
      return res.status(500).json({ message: "ROUTE_SHEET_REMOVE_ITEM_ERROR" });
    }
  });

  app.post("/api/pallets/route-sheets/:routeSheetId/publish", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }
      const routeSheetId = Number(req.params?.routeSheetId || 0);
      if (!routeSheetId) {
        return res.status(400).json({ message: "ROUTE_SHEET_ID_REQUIRED" });
      }

      await prisma.$transaction(async (tx) => {
        const sheet = await tx.palletRouteSheet.findFirst({
          where: {
            orgId,
            id: routeSheetId,
          },
          select: { id: true, status: true, sheetNumber: true },
        });
        if (!sheet) {
          const error = new Error("ROUTE_SHEET_NOT_FOUND");
          error.code = "ROUTE_SHEET_NOT_FOUND";
          throw error;
        }
        if (sheet.status !== "DRAFT") {
          const error = new Error("ROUTE_SHEET_STATUS_INVALID");
          error.code = "ROUTE_SHEET_STATUS_INVALID";
          throw error;
        }

        const plannedCount = await tx.palletRouteSheetItem.count({
          where: {
            orgId,
            routeSheetId,
            status: "PLANNED",
          },
        });
        if (plannedCount < 1) {
          const error = new Error("ROUTE_SHEET_EMPTY");
          error.code = "ROUTE_SHEET_EMPTY";
          throw error;
        }

        await tx.palletRouteSheet.update({
          where: {
            id: routeSheetId,
          },
          data: {
            status: "PUBLISHED",
            publishedByUserId: req.user.id,
            publishedAt: new Date(),
          },
        });
        await createRouteSheetEventTx(tx, {
          orgId,
          routeSheetId,
          type: "PUBLISH",
          userId: req.user.id,
          metaJson: {
            plannedCount,
            sheetNumber: sheet.sheetNumber,
          },
        });
      });

      const routeSheet = await prisma.palletRouteSheet.findFirst({
        where: {
          orgId,
          id: routeSheetId,
        },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          publishedBy: { select: { id: true, name: true, email: true } },
          startedBy: { select: { id: true, name: true, email: true } },
          completedBy: { select: { id: true, name: true, email: true } },
          items: {
            include: {
              pallet: { include: { currentLocation: true, dispatch: true, createdBy: true } },
              loadedBy: { select: { id: true, name: true, email: true } },
            },
            orderBy: [{ plannedAt: "asc" }, { id: "asc" }],
          },
        },
      });
      if (!routeSheet) {
        return res.status(404).json({ message: "ROUTE_SHEET_NOT_FOUND" });
      }
      return res.json({
        routeSheet: routeSheetToResponse({
          ...routeSheet,
          summary: summarizeRouteSheetItems(routeSheet.items),
        }),
      });
    } catch (err) {
      if (err?.code === "ROUTE_SHEET_NOT_FOUND") {
        return res.status(404).json({ message: "ROUTE_SHEET_NOT_FOUND" });
      }
      if (err?.code === "ROUTE_SHEET_STATUS_INVALID") {
        return res.status(409).json({ message: "ROUTE_SHEET_STATUS_INVALID" });
      }
      if (err?.code === "ROUTE_SHEET_EMPTY") {
        return res.status(409).json({ message: "ROUTE_SHEET_EMPTY" });
      }
      console.error("route-sheet publish error:", err);
      return res.status(500).json({ message: "ROUTE_SHEET_PUBLISH_ERROR" });
    }
  });

  app.post("/api/pallets/route-sheets/:routeSheetId/dispatch", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }
      const routeSheetId = Number(req.params?.routeSheetId || 0);
      if (!routeSheetId) {
        return res.status(400).json({ message: "ROUTE_SHEET_ID_REQUIRED" });
      }

      const palletCode = normalizePalletCode(req.body?.palletCode);
      const locationInput = normalizePalletCode(req.body?.locationCode);
      const dispatchGate = normalizePalletGate(req.body?.dispatchGate ?? req.body?.gate, 40) || null;
      if (!palletCode) {
        return res.status(400).json({ message: "PALLET_CODE_REQUIRED" });
      }
      if (!locationInput) {
        return res.status(400).json({ message: "PALLET_LOCATION_REQUIRED" });
      }
      if (!dispatchGate) {
        return res.status(400).json({ message: "PALLET_GATE_REQUIRED" });
      }

      const dispatchedResult = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const routeSheet = await tx.palletRouteSheet.findFirst({
          where: {
            orgId,
            id: routeSheetId,
          },
        });
        if (!routeSheet) {
          const error = new Error("ROUTE_SHEET_NOT_FOUND");
          error.code = "ROUTE_SHEET_NOT_FOUND";
          throw error;
        }
        if (!["PUBLISHED", "LOADING"].includes(String(routeSheet.status || ""))) {
          const error = new Error("ROUTE_SHEET_STATUS_INVALID");
          error.code = "ROUTE_SHEET_STATUS_INVALID";
          throw error;
        }

        const pallet = await tx.pallet.findFirst({
          where: {
            orgId,
            palletCode,
          },
          include: {
            currentLocation: true,
          },
        });
        if (!pallet) {
          const error = new Error("PALLET_NOT_FOUND");
          error.code = "PALLET_NOT_FOUND";
          throw error;
        }
        if (pallet.status !== "STORED") {
          const error = new Error("PALLET_DISPATCH_STATUS_INVALID");
          error.code = "PALLET_DISPATCH_STATUS_INVALID";
          throw error;
        }
        const resolvedWarehouseLocation = await resolveWarehouseLocationByInput(
          orgId,
          locationInput,
          tx
        );
        const resolvedLocationCode =
          normalizePalletCode(resolvedWarehouseLocation?.code || locationInput) || locationInput;
        if (
          !doesLocationInputMatchPalletLocation(
            locationInput,
            resolvedWarehouseLocation,
            pallet.currentLocation
          )
        ) {
          const error = new Error("PALLET_LOCATION_MISMATCH");
          error.code = "PALLET_LOCATION_MISMATCH";
          throw error;
        }

        const routeItem = await tx.palletRouteSheetItem.findFirst({
          where: {
            orgId,
            routeSheetId,
            palletId: pallet.id,
          },
        });
        if (!routeItem) {
          const error = new Error("ROUTE_SHEET_PALLET_NOT_IN_SHEET");
          error.code = "ROUTE_SHEET_PALLET_NOT_IN_SHEET";
          throw error;
        }
        if (routeItem.status === "LOADED") {
          const error = new Error("ROUTE_SHEET_PALLET_ALREADY_LOADED");
          error.code = "ROUTE_SHEET_PALLET_ALREADY_LOADED";
          throw error;
        }
        if (routeItem.status !== "PLANNED") {
          const error = new Error("ROUTE_SHEET_ITEM_STATUS_INVALID");
          error.code = "ROUTE_SHEET_ITEM_STATUS_INVALID";
          throw error;
        }

        if (routeSheet.status === "PUBLISHED") {
          await tx.palletRouteSheet.update({
            where: { id: routeSheetId },
            data: {
              status: "LOADING",
              startedByUserId: req.user.id,
              startedAt: now,
            },
          });
          await createRouteSheetEventTx(tx, {
            orgId,
            routeSheetId,
            type: "START_LOADING",
            userId: req.user.id,
          });
        }

        const palletUpdate = await tx.pallet.updateMany({
          where: {
            id: pallet.id,
            status: "STORED",
          },
          data: {
            status: "DISPATCHED",
            dispatchedAt: now,
          },
        });
        if (palletUpdate.count !== 1) {
          const error = new Error("PALLET_STATE_CHANGED");
          error.code = "PALLET_STATE_CHANGED";
          throw error;
        }

        await tx.palletDispatch.create({
          data: {
            orgId,
            palletId: pallet.id,
            routeSheetId,
            routeSheetItemId: routeItem.id,
            destinationRc: routeSheet.destinationRc,
            route: routeSheet.route || null,
            vehicle: routeSheet.vehicle || null,
            driver: routeSheet.driver || null,
            notes: routeSheet.notes || null,
            dispatchedByUserId: req.user.id,
            dispatchedAt: now,
          },
        });

        await tx.palletRouteSheetItem.update({
          where: {
            id: routeItem.id,
          },
          data: {
            status: "LOADED",
            loadedAt: now,
            loadedByUserId: req.user.id,
          },
        });
        await createRouteSheetEventTx(tx, {
          orgId,
          routeSheetId,
          itemId: routeItem.id,
          type: "LOAD_PALLET",
          userId: req.user.id,
          metaJson: {
            palletCode,
            locationCode: resolvedLocationCode,
            dispatchGate,
            gate: dispatchGate,
          },
        });

        await createPalletEventTx(tx, {
          orgId,
          palletId: pallet.id,
          type: "DISPATCH",
          fromStatus: "STORED",
          toStatus: "DISPATCHED",
          userId: req.user.id,
          metaJson: {
            destinationRc: routeSheet.destinationRc,
            route: routeSheet.route || null,
            vehicle: routeSheet.vehicle || null,
            driver: routeSheet.driver || null,
            notes: routeSheet.notes || null,
            fromLocationCode: pallet.currentLocation?.code || null,
            scanLocationCode: resolvedLocationCode,
            dispatchGate,
            gate: dispatchGate,
            routeSheetId,
            routeSheetNumber: routeSheet.sheetNumber || null,
          },
        });

        const remaining = await tx.palletRouteSheetItem.count({
          where: {
            orgId,
            routeSheetId,
            status: "PLANNED",
          },
        });
        if (remaining < 1) {
          await tx.palletRouteSheet.update({
            where: { id: routeSheetId },
            data: {
              status: "COMPLETED",
              completedAt: now,
              completedByUserId: req.user.id,
            },
          });
          await createRouteSheetEventTx(tx, {
            orgId,
            routeSheetId,
            type: "COMPLETE",
            userId: req.user.id,
          });
        }

        return {
          palletId: pallet.id,
          remaining,
        };
      });

      const pallet = await prisma.pallet.findFirst({
        where: {
          orgId,
          id: dispatchedResult.palletId,
        },
        include: {
          currentLocation: true,
          dispatch: true,
          createdBy: true,
        },
      });
      const routeSheet = await prisma.palletRouteSheet.findFirst({
        where: {
          orgId,
          id: routeSheetId,
        },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          publishedBy: { select: { id: true, name: true, email: true } },
          startedBy: { select: { id: true, name: true, email: true } },
          completedBy: { select: { id: true, name: true, email: true } },
          items: {
            include: {
              pallet: { include: { currentLocation: true, dispatch: true, createdBy: true } },
              loadedBy: { select: { id: true, name: true, email: true } },
            },
            orderBy: [{ plannedAt: "asc" }, { id: "asc" }],
          },
        },
      });
      if (!pallet || !routeSheet) {
        return res.status(500).json({ message: "ROUTE_SHEET_DISPATCH_FAILED" });
      }

      return res.json({
        pallet: palletToResponse(pallet),
        routeSheet: routeSheetToResponse({
          ...routeSheet,
          summary: summarizeRouteSheetItems(routeSheet.items),
        }),
      });
    } catch (err) {
      if (err?.code === "PALLET_GATE_REQUIRED") {
        return res.status(400).json({ message: "PALLET_GATE_REQUIRED" });
      }
      if (err?.code === "ROUTE_SHEET_NOT_FOUND") {
        return res.status(404).json({ message: "ROUTE_SHEET_NOT_FOUND" });
      }
      if (err?.code === "ROUTE_SHEET_STATUS_INVALID") {
        return res.status(409).json({ message: "ROUTE_SHEET_STATUS_INVALID" });
      }
      if (err?.code === "ROUTE_SHEET_PALLET_NOT_IN_SHEET") {
        return res.status(409).json({ message: "ROUTE_SHEET_PALLET_NOT_IN_SHEET" });
      }
      if (err?.code === "ROUTE_SHEET_PALLET_ALREADY_LOADED") {
        return res.status(409).json({ message: "ROUTE_SHEET_PALLET_ALREADY_LOADED" });
      }
      if (err?.code === "ROUTE_SHEET_ITEM_STATUS_INVALID") {
        return res.status(409).json({ message: "ROUTE_SHEET_ITEM_STATUS_INVALID" });
      }
      if (err?.code === "PALLET_NOT_FOUND") {
        return res.status(404).json({ message: "PALLET_NOT_FOUND" });
      }
      if (err?.code === "PALLET_DISPATCH_STATUS_INVALID") {
        return res.status(409).json({ message: "PALLET_DISPATCH_STATUS_INVALID" });
      }
      if (err?.code === "PALLET_LOCATION_MISMATCH") {
        return res.status(409).json({ message: "PALLET_LOCATION_MISMATCH" });
      }
      if (err?.code === "PALLET_STATE_CHANGED" || err?.code === "P2002") {
        return res.status(409).json({ message: "PALLET_STATE_CHANGED" });
      }
      console.error("route-sheet dispatch error:", err);
      return res.status(500).json({ message: "ROUTE_SHEET_DISPATCH_ERROR" });
    }
  });

  app.post("/api/pallets/dispatch", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const palletCode = normalizePalletCode(req.body?.palletCode);
      const locationInput = normalizePalletCode(req.body?.locationCode);
      const destinationRc = normalizePalletText(req.body?.destinationRc, 120);
      const dispatchGate = normalizePalletGate(req.body?.dispatchGate ?? req.body?.gate, 40) || null;
      const route = normalizePalletText(req.body?.route, 120) || null;
      const vehicle = normalizePalletText(req.body?.vehicle, 120) || null;
      const driver = normalizePalletText(req.body?.driver, 120) || null;
      const notes = normalizePalletText(req.body?.notes, 500) || null;

      if (!palletCode) {
        return res.status(400).json({ message: "PALLET_CODE_REQUIRED" });
      }
      if (!locationInput) {
        return res.status(400).json({ message: "PALLET_LOCATION_REQUIRED" });
      }
      if (!destinationRc) {
        return res.status(400).json({ message: "PALLET_DESTINATION_REQUIRED" });
      }
      if (!dispatchGate) {
        return res.status(400).json({ message: "PALLET_GATE_REQUIRED" });
      }

      const dispatchedId = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const pallet = await tx.pallet.findFirst({
          where: {
            orgId,
            palletCode,
          },
          include: {
            currentLocation: true,
          },
        });
        if (!pallet) {
          const error = new Error("PALLET_NOT_FOUND");
          error.code = "PALLET_NOT_FOUND";
          throw error;
        }
        if (pallet.status !== "STORED") {
          const error = new Error("PALLET_DISPATCH_STATUS_INVALID");
          error.code = "PALLET_DISPATCH_STATUS_INVALID";
          throw error;
        }
        const resolvedWarehouseLocation = await resolveWarehouseLocationByInput(
          orgId,
          locationInput,
          tx
        );
        const resolvedLocationCode =
          normalizePalletCode(resolvedWarehouseLocation?.code || locationInput) || locationInput;
        if (
          !doesLocationInputMatchPalletLocation(
            locationInput,
            resolvedWarehouseLocation,
            pallet.currentLocation
          )
        ) {
          const error = new Error("PALLET_LOCATION_MISMATCH");
          error.code = "PALLET_LOCATION_MISMATCH";
          throw error;
        }

        const updateResult = await tx.pallet.updateMany({
          where: {
            id: pallet.id,
            status: "STORED",
          },
          data: {
            status: "DISPATCHED",
            dispatchedAt: now,
          },
        });
        if (updateResult.count !== 1) {
          const error = new Error("PALLET_STATE_CHANGED");
          error.code = "PALLET_STATE_CHANGED";
          throw error;
        }

        await tx.palletDispatch.create({
          data: {
            orgId,
            palletId: pallet.id,
            destinationRc,
            route,
            vehicle,
            driver,
            notes,
            dispatchedByUserId: req.user.id,
            dispatchedAt: now,
          },
        });

        await createPalletEventTx(tx, {
          orgId,
          palletId: pallet.id,
          type: "DISPATCH",
          fromStatus: "STORED",
          toStatus: "DISPATCHED",
          userId: req.user.id,
          metaJson: {
            destinationRc,
            route,
            vehicle,
            driver,
            notes,
            fromLocationCode: pallet.currentLocation?.code || null,
            scanLocationCode: resolvedLocationCode,
            dispatchGate,
            gate: dispatchGate,
          },
        });

        return pallet.id;
      });

      const dispatched = dispatchedId
        ? await prisma.pallet.findFirst({
            where: {
              orgId,
              id: dispatchedId,
            },
            include: {
              currentLocation: true,
              dispatch: true,
            },
          })
        : null;

      if (!dispatched) {
        return res.status(500).json({ message: "PALLET_DISPATCH_FAILED" });
      }

      return res.json({ pallet: palletToResponse(dispatched) });
    } catch (err) {
      if (err?.code === "PALLET_GATE_REQUIRED") {
        return res.status(400).json({ message: "PALLET_GATE_REQUIRED" });
      }
      if (err?.code === "PALLET_NOT_FOUND") {
        return res.status(404).json({ message: "PALLET_NOT_FOUND" });
      }
      if (err?.code === "PALLET_DISPATCH_STATUS_INVALID") {
        return res.status(409).json({ message: "PALLET_DISPATCH_STATUS_INVALID" });
      }
      if (err?.code === "PALLET_LOCATION_MISMATCH") {
        return res.status(409).json({ message: "PALLET_LOCATION_MISMATCH" });
      }
      if (err?.code === "PALLET_STATE_CHANGED" || err?.code === "P2002") {
        return res.status(409).json({ message: "PALLET_STATE_CHANGED" });
      }
      console.error("pallet dispatch error:", err);
      return res.status(500).json({ message: "PALLET_DISPATCH_ERROR" });
    }
  });

  app.get("/api/pallets/dispatch-sheet", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const destinationRc = normalizePalletText(req.query?.destinationRc, 120);
      const route = normalizePalletText(req.query?.route, 120) || null;
      const supplierName = normalizePalletText(req.query?.supplierName, 160);
      const inboundRef = normalizePalletText(req.query?.inboundRef, 120);
      const locationCode = normalizePalletCode(req.query?.locationCode);
      const limit = Math.max(1, Math.min(300, Number(req.query?.limit || 120)));

      if (!destinationRc) {
        return res.status(400).json({ message: "PALLET_DESTINATION_REQUIRED" });
      }

      let currentLocationId = null;
      if (locationCode) {
        const location = await prisma.palletLocation.findFirst({
          where: {
            orgId,
            code: locationCode,
          },
          select: { id: true },
        });
        if (!location) {
          return res.status(404).json({ message: "PALLET_LOCATION_NOT_FOUND" });
        }
        currentLocationId = location.id;
      }

      const where = {
        orgId,
        status: "STORED",
        ...(currentLocationId ? { currentLocationId } : {}),
        ...(supplierName
          ? { supplierName: { contains: supplierName, mode: "insensitive" } }
          : {}),
        ...(inboundRef
          ? { inboundRef: { contains: inboundRef, mode: "insensitive" } }
          : {}),
      };

      const items = await prisma.pallet.findMany({
        where,
        include: {
          currentLocation: true,
          dispatch: true,
        },
        orderBy: [{ currentLocationId: "asc" }, { receivedAt: "asc" }, { id: "asc" }],
        take: limit,
      });

      const locationMap = new Map();
      for (const item of items) {
        const code = item?.currentLocation?.code || "БЕЗ_ЯЧЕЙКИ";
        locationMap.set(code, (locationMap.get(code) || 0) + 1);
      }
      const byLocation = Array.from(locationMap.entries())
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => {
          if (a.code < b.code) return -1;
          if (a.code > b.code) return 1;
          return 0;
        });

      return res.json({
        destinationRc,
        route,
        summary: {
          total: items.length,
          byLocation,
        },
        items: items.map((item) => palletToResponse(item)),
      });
    } catch (err) {
      console.error("pallet dispatch-sheet error:", err);
      return res.status(500).json({ message: "PALLET_DISPATCH_SHEET_ERROR" });
    }
  });

  app.get("/api/pallets", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const requestedStatus = String(req.query?.status || "").trim();
      const requestedStatuses = String(req.query?.statuses || "").trim();
      const status = requestedStatus ? normalizePalletStatus(requestedStatus, "") : "";
      const statuses = requestedStatuses ? parsePalletStatuses(requestedStatuses) : [];
      if (requestedStatus && !status) {
        return res.status(400).json({ message: "PALLET_STATUS_INVALID" });
      }
      if (requestedStatuses && !statuses.length) {
        return res.status(400).json({ message: "PALLET_STATUS_INVALID" });
      }
      const statusFilter = statuses.length ? { in: statuses } : status || null;

      const qText = normalizePalletText(req.query?.q, 160);
      const qCode = normalizePalletCode(req.query?.q);
      const inboundRef = normalizePalletText(req.query?.inboundRef, 120);
      const supplierName = normalizePalletText(req.query?.supplierName, 160);
      const locationCode = normalizePalletCode(req.query?.locationCode);
      const excludeTest = toBoolean(req.query?.excludeTest);
      const dateFromRaw = String(req.query?.dateFrom || "").trim();
      const dateToRaw = String(req.query?.dateTo || "").trim();
      const dateFrom = toIsoDateOrNull(dateFromRaw);
      const dateTo = toIsoDateOrNull(dateToRaw);
      if (dateFromRaw && !dateFrom) {
        return res.status(400).json({ message: "DATE_FROM_INVALID" });
      }
      if (dateToRaw && !dateTo) {
        return res.status(400).json({ message: "DATE_TO_INVALID" });
      }

      let currentLocationId = null;
      if (locationCode) {
        const location = await prisma.palletLocation.findFirst({
          where: {
            orgId,
            code: locationCode,
          },
          select: { id: true },
        });
        if (!location) {
          return res.status(404).json({ message: "PALLET_LOCATION_NOT_FOUND" });
        }
        currentLocationId = location.id;
      }

      const andFilters = [];
      if (qText || qCode) {
        andFilters.push({
          OR: [
            ...(qCode ? [{ palletCode: { contains: qCode, mode: "insensitive" } }] : []),
            ...(qText
              ? [
                  { supplierName: { contains: qText, mode: "insensitive" } },
                  { inboundRef: { contains: qText, mode: "insensitive" } },
                ]
              : []),
          ],
        });
      }
      if (excludeTest) {
        andFilters.push({
          NOT: [
            { supplierName: { contains: "test", mode: "insensitive" } },
            { supplierName: { contains: "тест", mode: "insensitive" } },
            { supplierName: { contains: "demo", mode: "insensitive" } },
            { inboundRef: { contains: "test", mode: "insensitive" } },
            { inboundRef: { contains: "тест", mode: "insensitive" } },
            { inboundRef: { contains: "demo", mode: "insensitive" } },
          ],
        });
      }

      const where = {
        orgId,
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(currentLocationId ? { currentLocationId } : {}),
        ...(inboundRef
          ? { inboundRef: { contains: inboundRef, mode: "insensitive" } }
          : {}),
        ...(supplierName
          ? { supplierName: { contains: supplierName, mode: "insensitive" } }
          : {}),
        ...((dateFrom || dateTo)
          ? {
              receivedAt: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
        ...(andFilters.length ? { AND: andFilters } : {}),
      };

      const items = await prisma.pallet.findMany({
        where,
        include: {
          currentLocation: true,
          dispatch: true,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 400,
      });

      return res.json({ items: items.map((item) => palletToResponse(item)) });
    } catch (err) {
      console.error("pallet list error:", err);
      return res.status(500).json({ message: "PALLET_LIST_ERROR" });
    }
  });

  app.post("/api/pallets/:palletCode/archive", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }
      const canArchive = req.user?.isSystemOwner === true || req.user?.role === "ADMIN";
      if (!canArchive) {
        return res.status(403).json({ message: "PALLET_ARCHIVE_OWNER_ONLY" });
      }

      const palletCode = normalizePalletCode(req.params?.palletCode);
      if (!palletCode) {
        return res.status(400).json({ message: "PALLET_CODE_REQUIRED" });
      }
      const reason = normalizePalletText(req.body?.reason, 240) || null;

      const archivedId = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const pallet = await tx.pallet.findFirst({
          where: { orgId, palletCode },
          include: { currentLocation: true },
        });
        if (!pallet) {
          const error = new Error("PALLET_NOT_FOUND");
          error.code = "PALLET_NOT_FOUND";
          throw error;
        }
        if (pallet.status === "CANCELLED") {
          return { palletId: pallet.id, idempotent: true };
        }
        if (pallet.status === "DISPATCHED") {
          const error = new Error("PALLET_ARCHIVE_STATUS_INVALID");
          error.code = "PALLET_ARCHIVE_STATUS_INVALID";
          throw error;
        }

        const updateResult = await tx.pallet.updateMany({
          where: {
            id: pallet.id,
            status: pallet.status,
          },
          data: {
            status: "CANCELLED",
            currentLocationId: null,
          },
        });
        if (updateResult.count !== 1) {
          const error = new Error("PALLET_STATE_CHANGED");
          error.code = "PALLET_STATE_CHANGED";
          throw error;
        }

        await createPalletEventTx(tx, {
          orgId,
          palletId: pallet.id,
          type: "CANCEL",
          fromStatus: pallet.status,
          toStatus: "CANCELLED",
          userId: req.user.id,
          metaJson: {
            source: "SEARCH_TAB",
            action: "ARCHIVE",
            reason,
            fromLocationCode: pallet.currentLocation?.code || null,
            fromLocationName: pallet.currentLocation?.name || null,
          },
        });

        return { palletId: pallet.id, idempotent: false };
      });

      const updated = archivedId?.palletId
        ? await prisma.pallet.findFirst({
            where: { orgId, id: archivedId.palletId },
            include: {
              currentLocation: true,
              dispatch: true,
            },
          })
        : null;

      if (!updated) {
        return res.status(500).json({ message: "PALLET_ARCHIVE_ERROR" });
      }
      return res.json({
        pallet: palletToResponse(updated),
        idempotent: Boolean(archivedId?.idempotent),
      });
    } catch (err) {
      if (err?.code === "PALLET_NOT_FOUND") {
        return res.status(404).json({ message: "PALLET_NOT_FOUND" });
      }
      if (err?.code === "PALLET_ARCHIVE_STATUS_INVALID") {
        return res.status(409).json({ message: "PALLET_ARCHIVE_STATUS_INVALID" });
      }
      if (err?.code === "PALLET_STATE_CHANGED") {
        return res.status(409).json({ message: "PALLET_STATE_CHANGED" });
      }
      console.error("pallet archive error:", err);
      return res.status(500).json({ message: "PALLET_ARCHIVE_ERROR" });
    }
  });

  app.get("/api/pallets/location-control/:locationCode/expected", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const locationInput = normalizePalletCode(req.params?.locationCode);
      if (!locationInput) {
        return res.status(400).json({ message: "PALLET_LOCATION_REQUIRED" });
      }

      const { warehouseLocation, palletLocations } = await findPalletLocationsByInput(
        orgId,
        locationInput
      );
      if (!warehouseLocation) {
        return res.status(404).json({ message: "PALLET_LOCATION_NOT_FOUND" });
      }
      const knownLocation = palletLocations[0] || null;
      const locationIds = palletLocations.map((location) => location.id).filter(Boolean);
      const expected = await prisma.pallet.findMany({
        where: {
          orgId,
          status: "STORED",
          ...(locationIds.length
            ? { currentLocationId: { in: locationIds } }
            : {
                currentLocation: {
                  is: { code: locationInput },
                },
              }),
        },
        include: {
          currentLocation: true,
        },
        orderBy: [{ palletCode: "asc" }, { id: "asc" }],
        take: 800,
      });
      const locationExists = Boolean(warehouseLocation || knownLocation || expected.length > 0);
      if (!locationExists) {
        return res.status(404).json({ message: "PALLET_LOCATION_NOT_FOUND" });
      }

      const resolvedLocationCode =
        normalizePalletCode(warehouseLocation?.code || knownLocation?.code || locationInput) ||
        locationInput;
      const locationName =
        String(warehouseLocation?.name || "").trim() ||
        String(knownLocation?.name || "").trim() ||
        String(expected[0]?.currentLocation?.name || "").trim() ||
        resolvedLocationCode;
      const palletIds = expected.map((item) => item.id).filter(Boolean);
      const discrepancyStorageReady = await ensurePalletDiscrepancyStorageReadyForRuntime();
      let openDiscrepanciesCount = 0;
      if (palletIds.length) {
        if (discrepancyStorageReady) {
          openDiscrepanciesCount = await prisma.palletDiscrepancy.count({
            where: {
              orgId,
              palletId: { in: palletIds },
              status: "OPEN",
            },
          });
        } else {
          const byPalletId = await loadLatestDiscrepancyStatesByPalletIdsFromEvents(orgId, palletIds, prisma);
          openDiscrepanciesCount = Array.from(byPalletId.values()).filter(
            (entry) => entry?.status === "OPEN"
          ).length;
        }
      }

      return res.json({
        location: {
          id: knownLocation?.id || null,
          code: resolvedLocationCode,
          name: locationName,
        },
        expectedPallets: expected.map((item) => palletToResponse(item)),
        summary: {
          expectedCount: expected.length,
          openDiscrepanciesCount,
          discrepancyEnabled: true,
        },
      });
    } catch (err) {
      console.error("pallet location-control expected error:", err);
      return res.status(500).json({ message: "PALLET_LOCATION_CONTROL_EXPECTED_ERROR" });
    }
  });

  app.post("/api/pallets/location-control/:locationCode/reconcile", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const locationInput = normalizePalletCode(req.params?.locationCode);
      if (!locationInput) {
        return res.status(400).json({ message: "PALLET_LOCATION_REQUIRED" });
      }

      const rawFoundCodes = Array.isArray(req.body?.foundPalletCodes)
        ? req.body.foundPalletCodes
        : [];
      const foundPalletCodes = Array.from(
        new Set(
          rawFoundCodes
            .map((entry) => {
              if (typeof entry === "string") return normalizePalletCode(entry);
              return normalizePalletCode(entry?.palletCode);
            })
            .filter(Boolean)
        )
      ).slice(0, 1200);
      const discrepancyStorageReady = await ensurePalletDiscrepancyStorageReadyForRuntime();

      const reconcileResult = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const { warehouseLocation, palletLocations } = await findPalletLocationsByInput(
          orgId,
          locationInput,
          tx
        );
        if (!warehouseLocation) {
          const error = new Error("PALLET_LOCATION_NOT_FOUND");
          error.code = "PALLET_LOCATION_NOT_FOUND";
          throw error;
        }
        const knownLocation = palletLocations[0] || null;
        const locationIds = palletLocations.map((location) => location.id).filter(Boolean);
        const expected = await tx.pallet.findMany({
          where: {
            orgId,
            status: "STORED",
            ...(locationIds.length
              ? { currentLocationId: { in: locationIds } }
              : {
                  currentLocation: {
                    is: { code: locationInput },
                  },
                }),
          },
          include: {
            currentLocation: true,
          },
          orderBy: [{ palletCode: "asc" }, { id: "asc" }],
          take: 800,
        });
        const locationExists = Boolean(warehouseLocation || knownLocation || expected.length > 0);
        if (!locationExists) {
          const error = new Error("PALLET_LOCATION_NOT_FOUND");
          error.code = "PALLET_LOCATION_NOT_FOUND";
          throw error;
        }
        const resolvedLocationCode =
          normalizePalletCode(warehouseLocation?.code || knownLocation?.code || locationInput) ||
          locationInput;

        const expectedByCode = new Map();
        for (const pallet of expected) {
          const code = normalizePalletCode(pallet?.palletCode);
          if (!code) continue;
          expectedByCode.set(code, pallet);
        }

        const foundSet = new Set(foundPalletCodes.filter((code) => expectedByCode.has(code)));
        const missingPallets = expected.filter(
          (pallet) => !foundSet.has(normalizePalletCode(pallet?.palletCode))
        );
        const foundPallets = expected.filter((pallet) =>
          foundSet.has(normalizePalletCode(pallet?.palletCode))
        );

        const locationName =
          String(warehouseLocation?.name || "").trim() ||
          String(knownLocation?.name || "").trim() ||
          String(expected[0]?.currentLocation?.name || "").trim() ||
          resolvedLocationCode;

        const createdMissingCodes = [];
        const openMissingCodes = [];
        const knownPalletIds = expected.map((item) => item.id).filter(Boolean);
        const eventStatesByPalletId = !discrepancyStorageReady
          ? await loadLatestDiscrepancyStatesByPalletIdsFromEvents(orgId, knownPalletIds, tx)
          : new Map();
        if (discrepancyStorageReady) {
          for (const pallet of missingPallets) {
            const openDiscrepancy = await tx.palletDiscrepancy.findFirst({
              where: {
                orgId,
                palletId: pallet.id,
                status: "OPEN",
              },
              select: { id: true },
            });
            const palletCode = normalizePalletCode(pallet?.palletCode);
            if (openDiscrepancy) {
              openMissingCodes.push(palletCode);
              await tx.palletDiscrepancy.update({
                where: { id: openDiscrepancy.id },
                data: {
                  lastCheckedAt: now,
                  locationId: pallet.currentLocationId || knownLocation?.id || null,
                },
              });
              if (pallet.currentLocationId != null) {
                await tx.pallet.update({
                  where: { id: pallet.id },
                  data: {
                    currentLocationId: null,
                  },
                });
              }
              continue;
            }

            await tx.palletDiscrepancy.create({
              data: {
                orgId,
                palletId: pallet.id,
                locationId: pallet.currentLocationId || knownLocation?.id || null,
                status: "OPEN",
                detectedAt: now,
                detectedByUserId: req.user?.id || null,
                lastCheckedAt: now,
              },
            });
            createdMissingCodes.push(palletCode);

            await tx.pallet.update({
              where: { id: pallet.id },
              data: {
                currentLocationId: null,
              },
            });

            await createPalletEventTx(tx, {
              orgId,
              palletId: pallet.id,
              type: "DISCREPANCY_OPEN",
              fromStatus: pallet.status,
              toStatus: pallet.status,
              userId: req.user.id,
              metaJson: {
                fromLocationCode:
                  String(pallet?.currentLocation?.code || "").trim() || resolvedLocationCode,
                fromLocationName:
                  String(pallet?.currentLocation?.name || "").trim() || locationName,
                locationCode: resolvedLocationCode,
                locationName,
                source: "LOCATION_CONTROL",
                result: "MISSING",
                discrepancyStatus: "OPEN",
              },
            });
          }
        } else {
          for (const pallet of missingPallets) {
            const palletCode = normalizePalletCode(pallet?.palletCode);
            const latestState = eventStatesByPalletId.get(pallet.id)?.status || "";
            if (latestState === "OPEN") {
              if (pallet.currentLocationId != null) {
                await tx.pallet.update({
                  where: { id: pallet.id },
                  data: {
                    currentLocationId: null,
                  },
                });
              }
              openMissingCodes.push(palletCode);
              continue;
            }
            await createPalletEventTx(tx, {
              orgId,
              palletId: pallet.id,
              type: "DISCREPANCY_OPEN",
              fromStatus: pallet.status,
              toStatus: pallet.status,
              userId: req.user.id,
              metaJson: {
                fromLocationCode:
                  String(pallet?.currentLocation?.code || "").trim() || resolvedLocationCode,
                fromLocationName:
                  String(pallet?.currentLocation?.name || "").trim() || locationName,
                locationCode: resolvedLocationCode,
                locationName,
                source: "LOCATION_CONTROL",
                result: "MISSING",
                discrepancyStatus: "OPEN",
              },
            });
            await tx.pallet.update({
              where: { id: pallet.id },
              data: {
                currentLocationId: null,
              },
            });
            createdMissingCodes.push(palletCode);
          }
        }

        let closedCount = 0;
        if (foundPallets.length) {
          if (discrepancyStorageReady) {
            const foundPalletIds = foundPallets.map((item) => item.id);
            const openToClose = await tx.palletDiscrepancy.findMany({
              where: {
                orgId,
                palletId: { in: foundPalletIds },
                status: "OPEN",
              },
              select: { id: true, palletId: true },
            });
            for (const discrepancy of openToClose) {
              await tx.palletDiscrepancy.update({
                where: { id: discrepancy.id },
                data: {
                  status: "CLOSED",
                  closedAt: now,
                  closedByUserId: req.user?.id || null,
                  lastCheckedAt: now,
                },
              });
              closedCount += 1;
              const pallet = foundPallets.find((item) => item.id === discrepancy.palletId);
              if (pallet) {
                await createPalletEventTx(tx, {
                  orgId,
                  palletId: pallet.id,
                  type: "DISCREPANCY_CLOSE",
                  fromStatus: pallet.status,
                  toStatus: pallet.status,
                  userId: req.user.id,
                  metaJson: {
                    locationCode: resolvedLocationCode,
                    locationName,
                    source: "LOCATION_CONTROL",
                    result: "FOUND",
                    discrepancyStatus: "CLOSED",
                  },
                });
              }
            }
          } else {
            for (const pallet of foundPallets) {
              const latestState = eventStatesByPalletId.get(pallet.id)?.status || "";
              if (latestState !== "OPEN") continue;
              await createPalletEventTx(tx, {
                orgId,
                palletId: pallet.id,
                type: "DISCREPANCY_CLOSE",
                fromStatus: pallet.status,
                toStatus: pallet.status,
                userId: req.user.id,
                metaJson: {
                  locationCode: resolvedLocationCode,
                  locationName,
                  source: "LOCATION_CONTROL",
                  result: "FOUND",
                  discrepancyStatus: "CLOSED",
                },
              });
              closedCount += 1;
            }
          }
        }

        return {
          locationCode: resolvedLocationCode,
          locationName,
          expectedCount: expected.length,
          actualCount: foundPallets.length,
          missingPalletCodes: missingPallets
            .map((item) => normalizePalletCode(item?.palletCode))
            .filter(Boolean),
          createdMissingCodes,
          openMissingCodes,
          closedCount,
        };
      });

      if (reconcileResult.createdMissingCodes.length) {
        await notifyCrossdockDiscrepancies({
          orgId,
          actorName: req.user?.name || "",
          locationCode: reconcileResult.locationCode,
          locationName: reconcileResult.locationName,
          missingCodes: reconcileResult.createdMissingCodes,
        }).catch(() => null);
      }

      return res.json({
        location: {
          code: reconcileResult.locationCode,
          name: reconcileResult.locationName,
        },
        expectedCount: reconcileResult.expectedCount,
        actualCount: reconcileResult.actualCount,
        missingPalletCodes: reconcileResult.missingPalletCodes,
        openedCount: reconcileResult.createdMissingCodes.length,
        alreadyOpenCount: reconcileResult.openMissingCodes.length,
        closedCount: reconcileResult.closedCount,
        discrepancyEnabled: true,
      });
    } catch (err) {
      if (String(err?.code || err?.message || "").trim().toUpperCase() === "PALLET_LOCATION_NOT_FOUND") {
        return res.status(404).json({ message: "PALLET_LOCATION_NOT_FOUND" });
      }
      console.error("pallet location-control reconcile error:", err);
      return res.status(500).json({ message: "PALLET_LOCATION_CONTROL_RECONCILE_ERROR" });
    }
  });

  app.get("/api/pallets/discrepancies", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }
      const canApproveWriteoff = req.user?.isSystemOwner === true || req.user?.role === "ADMIN";

      const statusQuery = String(req.query?.status || req.query?.statuses || "ALL")
        .trim()
        .toUpperCase();
      const status =
        statusQuery === "ALL" ? "" : normalizePalletDiscrepancyStatus(statusQuery, "");
      if (statusQuery !== "ALL" && !status) {
        return res.status(400).json({ message: "PALLET_DISCREPANCY_STATUS_INVALID" });
      }
      const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 250)));
      const discrepancyStorageReady = await ensurePalletDiscrepancyStorageReadyForRuntime();
      if (!discrepancyStorageReady) {
        const fallbackItems = await loadLatestDiscrepancyItemsFromEvents(orgId, limit, status, prisma);
        return res.json({
          items: fallbackItems,
          discrepancyEnabled: true,
          fallback: "events",
          permissions: { canApproveWriteoff },
        });
      }

      const rows = await prisma.palletDiscrepancy.findMany({
        where: {
          orgId,
          ...(status ? { status } : {}),
        },
        include: {
          pallet: {
            include: {
              currentLocation: true,
            },
          },
          location: true,
          detectedByUser: {
            select: { id: true, name: true, email: true },
          },
          closedByUser: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: [{ status: "asc" }, { detectedAt: "desc" }, { id: "desc" }],
        take: limit,
      });

      return res.json({
        items: rows.map((row) => palletDiscrepancyToResponse(row)),
        discrepancyEnabled: true,
        permissions: { canApproveWriteoff },
      });
    } catch (err) {
      console.error("pallet discrepancies list error:", err);
      return res.status(500).json({ message: "PALLET_DISCREPANCIES_LIST_ERROR" });
    }
  });

  app.post("/api/pallets/discrepancies/:palletId/mark-found", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const palletId = Number(req.params?.palletId || 0);
      if (!palletId) {
        return res.status(400).json({ message: "PALLET_ID_REQUIRED" });
      }

      const result = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const open = await getOpenDiscrepancyByPalletIdTx(orgId, palletId, tx);
        if (!open) return { error: "PALLET_DISCREPANCY_NOT_FOUND" };

        const pallet = open?.source === "table" ? open?.row?.pallet : open?.pallet;
        if (!pallet) return { error: "PALLET_NOT_FOUND" };

        const requestedLocationCode = normalizePalletCode(req.body?.locationCode);
        const fallbackLocationCode =
          String(open?.locationCode || "").trim() ||
          String(open?.row?.location?.code || "").trim() ||
          String(open?.row?.pallet?.currentLocation?.code || "").trim() ||
          "";
        const effectiveLocationCode = requestedLocationCode || fallbackLocationCode;
        if (!effectiveLocationCode) return { error: "PALLET_LOCATION_REQUIRED" };

        let linkedWarehouseLocation = null;
        let fallbackPalletLocation = null;
        try {
          const locationLookup = await findPalletLocationsByInput(orgId, effectiveLocationCode, tx);
          linkedWarehouseLocation = locationLookup?.warehouseLocation || null;
          const locationCandidates = Array.isArray(locationLookup?.palletLocations)
            ? locationLookup.palletLocations
            : [];
          const normalizedRequestedCode = normalizePalletCode(effectiveLocationCode);
          fallbackPalletLocation =
            locationCandidates.find(
              (entry) => normalizePalletCode(entry?.code) === normalizedRequestedCode
            ) ||
            locationCandidates[0] ||
            null;
        } catch (err) {
          // In degraded DB-permission mode fallback to existing pallet-location code.
          if (!isPermissionDeniedForTable(err, "WarehouseLocation")) {
            throw err;
          }
          const normalizedRequestedCode = normalizePalletCode(effectiveLocationCode);
          if (normalizedRequestedCode) {
            fallbackPalletLocation = await tx.palletLocation.findFirst({
              where: { orgId, code: normalizedRequestedCode },
              select: { id: true, code: true, name: true },
            });
          }
        }

        let targetLocation = null;
        if (linkedWarehouseLocation?.code) {
          targetLocation = await getOrCreatePalletLocationByCode(orgId, linkedWarehouseLocation.code, tx);
        }
        if (!targetLocation?.id && fallbackPalletLocation?.id) {
          targetLocation = fallbackPalletLocation;
        }
        if (!targetLocation?.id) return { error: "PALLET_LOCATION_NOT_FOUND" };
        const locationId = targetLocation.id;
        const locationCode =
          String(targetLocation?.code || "").trim() || normalizePalletCode(effectiveLocationCode) || null;
        const locationName =
          String(targetLocation?.name || "").trim() ||
          locationCode ||
          null;

        if (pallet.status !== "STORED" || pallet.currentLocationId !== locationId) {
          await tx.pallet.update({
            where: { id: pallet.id },
            data: {
              status: "STORED",
              currentLocationId: locationId,
              storedAt: pallet.storedAt || now,
            },
          });
        }

        let nextWriteoffRequest = open?.writeoffRequest || null;
        if (isDiscrepancyWriteoffPending(nextWriteoffRequest)) {
          nextWriteoffRequest = {
            ...nextWriteoffRequest,
            status: "CANCELLED",
            decidedAt: now.toISOString(),
            decidedByUserId: Number(req.user?.id || 0) || null,
            decidedByName: String(req.user?.name || "").trim() || null,
            reason: "Найдена при повторной проверке",
          };
        }

        if (open.source === "table" && open.row?.id) {
          await tx.palletDiscrepancy.update({
            where: { id: open.row.id },
            data: {
              status: "CLOSED",
              locationId,
              closedAt: now,
              closedByUserId: req.user?.id || null,
              lastCheckedAt: now,
              note: serializePalletDiscrepancyNote({
                legacyText: open?.noteParsed?.legacyText || "",
                writeoffRequest: nextWriteoffRequest,
              }),
            },
          });
        }

        await createPalletEventTx(tx, {
          orgId,
          palletId: pallet.id,
          type: "DISCREPANCY_CLOSE",
          fromStatus: pallet.status,
          toStatus: "STORED",
          userId: req.user.id,
          metaJson: {
            locationCode,
            locationName,
            source: "DISCREPANCIES_TAB",
            result: "FOUND",
            discrepancyStatus: "CLOSED",
            writeoffRequestStatus:
              normalizePalletDiscrepancyWriteoffStatus(nextWriteoffRequest?.status, "") || null,
            writeoffRequestedByUserId: Number(nextWriteoffRequest?.requestedByUserId || 0) || null,
            writeoffRequestedByName: String(nextWriteoffRequest?.requestedByName || "").trim() || null,
          },
        });

        return { ok: true, palletId: pallet.id };
      });

      if (result?.error) {
        const code = String(result.error || "");
        if (code === "PALLET_DISCREPANCY_NOT_FOUND" || code === "PALLET_NOT_FOUND") {
          return res.status(404).json({ message: code });
        }
        return res.status(400).json({ message: code });
      }

      return res.json({ ok: true, palletId: result?.palletId || null });
    } catch (err) {
      if (String(err?.code || "").trim().toUpperCase() === "LOCATION_CODE_REQUIRED") {
        return res.status(400).json({ message: "PALLET_LOCATION_REQUIRED" });
      }
      if (String(err?.code || "").trim().toUpperCase() === "P2025") {
        return res.status(404).json({ message: "PALLET_DISCREPANCY_NOT_FOUND" });
      }
      console.error("pallet discrepancy mark-found error:", err);
      return res.status(500).json({ message: "PALLET_DISCREPANCY_MARK_FOUND_ERROR" });
    }
  });

  app.post("/api/pallets/discrepancies/:palletId/request-writeoff", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const palletId = Number(req.params?.palletId || 0);
      if (!palletId) {
        return res.status(400).json({ message: "PALLET_ID_REQUIRED" });
      }

      const reason = normalizePalletText(req.body?.reason, 240);
      const txResult = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const open = await getOpenDiscrepancyByPalletIdTx(orgId, palletId, tx);
        if (!open) return { error: "PALLET_DISCREPANCY_NOT_FOUND" };
        if (isDiscrepancyWriteoffPending(open?.writeoffRequest)) {
          return { error: "PALLET_DISCREPANCY_WRITEOFF_ALREADY_PENDING" };
        }

        const pallet = open?.source === "table" ? open?.row?.pallet : open?.pallet;
        if (!pallet) return { error: "PALLET_NOT_FOUND" };

        const locationCode =
          String(open?.locationCode || "").trim() ||
          String(pallet?.currentLocation?.code || "").trim() ||
          null;
        const locationName =
          String(open?.locationName || "").trim() ||
          String(pallet?.currentLocation?.name || "").trim() ||
          locationCode ||
          null;

        const writeoffRequest = {
          status: "PENDING",
          requestedAt: now.toISOString(),
          requestedByUserId: Number(req.user?.id || 0) || null,
          requestedByName: String(req.user?.name || "").trim() || null,
          decidedAt: null,
          decidedByUserId: null,
          decidedByName: null,
          reason: reason || null,
        };

        if (open.source === "table" && open.row?.id) {
          await tx.palletDiscrepancy.update({
            where: { id: open.row.id },
            data: {
              lastCheckedAt: now,
              note: serializePalletDiscrepancyNote({
                legacyText: open?.noteParsed?.legacyText || "",
                writeoffRequest,
              }),
            },
          });
        }

        await createPalletEventTx(tx, {
          orgId,
          palletId: pallet.id,
          type: "MOVE",
          fromStatus: pallet.status,
          toStatus: pallet.status,
          userId: req.user.id,
          metaJson: {
            source: "DISCREPANCIES_TAB",
            action: "WRITEOFF_REQUEST",
            discrepancyStatus: "OPEN",
            locationCode,
            locationName,
            writeoffRequestStatus: "PENDING",
            writeoffRequestedAt: writeoffRequest.requestedAt,
            writeoffRequestedByUserId: writeoffRequest.requestedByUserId,
            writeoffRequestedByName: writeoffRequest.requestedByName,
            writeoffReason: writeoffRequest.reason,
          },
        });

        return {
          ok: true,
          discrepancyId: open?.row?.id || null,
          palletCode: String(pallet?.palletCode || "").trim() || null,
          locationCode,
          locationName,
          reason: writeoffRequest.reason,
        };
      });

      if (txResult?.error) {
        const code = String(txResult.error || "");
        if (code === "PALLET_DISCREPANCY_NOT_FOUND" || code === "PALLET_NOT_FOUND") {
          return res.status(404).json({ message: code });
        }
        if (code === "PALLET_DISCREPANCY_WRITEOFF_ALREADY_PENDING") {
          return res.status(409).json({ message: code });
        }
        return res.status(400).json({ message: code });
      }

      await notifyCrossdockWriteoffRequested({
        orgId,
        discrepancyId: txResult?.discrepancyId || null,
        palletCode: txResult?.palletCode || "",
        locationCode: txResult?.locationCode || "",
        locationName: txResult?.locationName || "",
        actorName: req.user?.name || "",
        reason: txResult?.reason || "",
      }).catch(() => null);

      return res.json({ ok: true, palletCode: txResult?.palletCode || null });
    } catch (err) {
      console.error("pallet discrepancy request-writeoff error:", err);
      return res.status(500).json({ message: "PALLET_DISCREPANCY_WRITEOFF_REQUEST_ERROR" });
    }
  });

  app.post("/api/pallets/discrepancies/:palletId/owner-decision", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const palletId = Number(req.params?.palletId || 0);
      if (!palletId) {
        return res.status(400).json({ message: "PALLET_ID_REQUIRED" });
      }

      const decision = String(req.body?.decision || "").trim().toUpperCase();
      if (!["APPROVE", "REJECT"].includes(decision)) {
        return res.status(400).json({ message: "PALLET_DISCREPANCY_WRITEOFF_DECISION_INVALID" });
      }
      const reason = normalizePalletText(req.body?.reason, 240);

      const canApprove = req.user?.isSystemOwner === true || req.user?.role === "ADMIN";
      if (!canApprove) {
        return res.status(403).json({ message: "PALLET_DISCREPANCY_WRITEOFF_OWNER_ONLY" });
      }

      const txResult = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const open = await getOpenDiscrepancyByPalletIdTx(orgId, palletId, tx);
        if (!open) return { error: "PALLET_DISCREPANCY_NOT_FOUND" };
        if (!isDiscrepancyWriteoffPending(open?.writeoffRequest)) {
          return { error: "PALLET_DISCREPANCY_WRITEOFF_NOT_PENDING" };
        }

        const pallet = open?.source === "table" ? open?.row?.pallet : open?.pallet;
        if (!pallet) return { error: "PALLET_NOT_FOUND" };

        const locationCode =
          String(open?.locationCode || "").trim() ||
          String(pallet?.currentLocation?.code || "").trim() ||
          null;
        const locationName =
          String(open?.locationName || "").trim() ||
          String(pallet?.currentLocation?.name || "").trim() ||
          locationCode ||
          null;

        const writeoffRequest = {
          ...(open?.writeoffRequest || {}),
          status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
          decidedAt: now.toISOString(),
          decidedByUserId: Number(req.user?.id || 0) || null,
          decidedByName: String(req.user?.name || "").trim() || null,
          reason: reason || open?.writeoffRequest?.reason || null,
        };

        if (open.source === "table" && open.row?.id) {
          await tx.palletDiscrepancy.update({
            where: { id: open.row.id },
            data:
              decision === "APPROVE"
                ? {
                    status: "CLOSED",
                    closedAt: now,
                    closedByUserId: req.user?.id || null,
                    lastCheckedAt: now,
                    note: serializePalletDiscrepancyNote({
                      legacyText: open?.noteParsed?.legacyText || "",
                      writeoffRequest,
                    }),
                  }
                : {
                    lastCheckedAt: now,
                    note: serializePalletDiscrepancyNote({
                      legacyText: open?.noteParsed?.legacyText || "",
                      writeoffRequest,
                    }),
                  },
          });
        }

        if (decision === "APPROVE") {
          await tx.pallet.update({
            where: { id: pallet.id },
            data: {
              status: "CANCELLED",
              currentLocationId: null,
            },
          });

          await createPalletEventTx(tx, {
            orgId,
            palletId: pallet.id,
            type: "CANCEL",
            fromStatus: pallet.status,
            toStatus: "CANCELLED",
            userId: req.user.id,
            metaJson: {
              source: "DISCREPANCIES_TAB",
              action: "WRITEOFF_APPROVE",
              locationCode,
              locationName,
              writeoffRequestStatus: "APPROVED",
              writeoffRequestedAt: open?.writeoffRequest?.requestedAt || null,
              writeoffRequestedByUserId: open?.writeoffRequest?.requestedByUserId || null,
              writeoffRequestedByName: open?.writeoffRequest?.requestedByName || null,
              writeoffDecidedAt: writeoffRequest.decidedAt,
              writeoffDecidedByUserId: writeoffRequest.decidedByUserId,
              writeoffDecidedByName: writeoffRequest.decidedByName,
              writeoffReason: writeoffRequest.reason,
            },
          });

          await createPalletEventTx(tx, {
            orgId,
            palletId: pallet.id,
            type: "DISCREPANCY_CLOSE",
            fromStatus: pallet.status,
            toStatus: "CANCELLED",
            userId: req.user.id,
            metaJson: {
              source: "DISCREPANCIES_TAB",
              result: "WRITEOFF",
              discrepancyStatus: "CLOSED",
              locationCode,
              locationName,
              writeoffRequestStatus: "APPROVED",
              writeoffRequestedAt: open?.writeoffRequest?.requestedAt || null,
              writeoffRequestedByUserId: open?.writeoffRequest?.requestedByUserId || null,
              writeoffRequestedByName: open?.writeoffRequest?.requestedByName || null,
              writeoffDecidedAt: writeoffRequest.decidedAt,
              writeoffDecidedByUserId: writeoffRequest.decidedByUserId,
              writeoffDecidedByName: writeoffRequest.decidedByName,
              writeoffReason: writeoffRequest.reason,
            },
          });
        } else {
          await createPalletEventTx(tx, {
            orgId,
            palletId: pallet.id,
            type: "MOVE",
            fromStatus: pallet.status,
            toStatus: pallet.status,
            userId: req.user.id,
            metaJson: {
              source: "DISCREPANCIES_TAB",
              action: "WRITEOFF_REJECT",
              discrepancyStatus: "OPEN",
              locationCode,
              locationName,
              writeoffRequestStatus: "REJECTED",
              writeoffRequestedAt: open?.writeoffRequest?.requestedAt || null,
              writeoffRequestedByUserId: open?.writeoffRequest?.requestedByUserId || null,
              writeoffRequestedByName: open?.writeoffRequest?.requestedByName || null,
              writeoffDecidedAt: writeoffRequest.decidedAt,
              writeoffDecidedByUserId: writeoffRequest.decidedByUserId,
              writeoffDecidedByName: writeoffRequest.decidedByName,
              writeoffReason: writeoffRequest.reason,
            },
          });
        }

        return {
          ok: true,
          decision,
          requestedByUserId: Number(open?.writeoffRequest?.requestedByUserId || 0) || null,
          palletCode: String(pallet?.palletCode || "").trim() || null,
          reason: writeoffRequest.reason,
        };
      });

      if (txResult?.error) {
        const code = String(txResult.error || "");
        if (code === "PALLET_DISCREPANCY_NOT_FOUND" || code === "PALLET_NOT_FOUND") {
          return res.status(404).json({ message: code });
        }
        if (code === "PALLET_DISCREPANCY_WRITEOFF_NOT_PENDING") {
          return res.status(409).json({ message: code });
        }
        return res.status(400).json({ message: code });
      }

      await notifyCrossdockWriteoffDecision({
        orgId,
        targetUserId: txResult?.requestedByUserId || null,
        decision: txResult?.decision || "",
        palletCode: txResult?.palletCode || "",
        actorName: req.user?.name || "",
        reason: txResult?.reason || "",
      }).catch(() => null);

      return res.json({
        ok: true,
        decision: txResult?.decision || null,
        palletCode: txResult?.palletCode || null,
      });
    } catch (err) {
      console.error("pallet discrepancy owner-decision error:", err);
      return res.status(500).json({ message: "PALLET_DISCREPANCY_WRITEOFF_DECISION_ERROR" });
    }
  });

  app.get("/api/pallets/suppliers", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const query = normalizePalletText(req.query?.q, 160);
      const limit = Math.max(1, Math.min(300, Number(req.query?.limit || 120)));

      const rows = await prisma.pallet.findMany({
        where: {
          orgId,
          ...(query
            ? { supplierName: { contains: query, mode: "insensitive" } }
            : {}),
        },
        select: {
          supplierName: true,
        },
        orderBy: [{ supplierName: "asc" }],
        distinct: ["supplierName"],
        take: Math.max(limit * 3, 120),
      });

      const seen = new Set();
      const items = [];
      for (const row of rows) {
        const name = String(row?.supplierName || "").trim();
        if (!name) continue;
        const normalized = name.toLowerCase();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        items.push(name);
        if (items.length >= limit) break;
      }

      return res.json({ items });
    } catch (err) {
      console.error("pallet suppliers list error:", err);
      return res.status(500).json({ message: "PALLET_SUPPLIER_LIST_ERROR" });
    }
  });

  app.get("/api/pallets/:palletCode/history", auth, async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const palletCode = normalizePalletCode(req.params?.palletCode);
      if (!palletCode) {
        return res.status(400).json({ message: "PALLET_CODE_REQUIRED" });
      }

      const pallet = await prisma.pallet.findFirst({
        where: {
          orgId,
          palletCode,
        },
        include: {
          currentLocation: true,
          dispatch: true,
          createdBy: {
            select: { id: true, name: true, email: true },
          },
        },
      });
      if (!pallet) {
        return res.status(404).json({ message: "PALLET_NOT_FOUND" });
      }

      const events = await prisma.palletEvent.findMany({
        where: {
          orgId,
          palletId: pallet.id,
        },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });

      return res.json({
        pallet: palletToResponse(pallet),
        events: events.map((event) => palletEventToResponse(event)),
      });
    } catch (err) {
      console.error("pallet history error:", err);
      return res.status(500).json({ message: "PALLET_HISTORY_ERROR" });
    }
  });

  app.get("/api/debug/db-permissions", auth, async (req, res) => {
    try {
      if (!(req.user?.isSystemOwner || req.user?.role === "ADMIN")) {
        return res.status(403).json({ message: "FORBIDDEN" });
      }

      const sessionInfoRows = await prisma.$queryRawUnsafe(`
        SELECT
          current_user AS "currentUser",
          current_database() AS "currentDatabase",
          current_schema() AS "currentSchema",
          current_setting('search_path') AS "searchPath"
      `);

      const tablePrivileges = await prisma.$queryRawUnsafe(`
        SELECT
          n.nspname AS "schema",
          c.relname AS "table",
          has_table_privilege(current_user, format('%I.%I', n.nspname, c.relname), 'SELECT') AS "canSelect",
          has_table_privilege(current_user, format('%I.%I', n.nspname, c.relname), 'INSERT') AS "canInsert",
          has_table_privilege(current_user, format('%I.%I', n.nspname, c.relname), 'UPDATE') AS "canUpdate",
          has_table_privilege(current_user, format('%I.%I', n.nspname, c.relname), 'DELETE') AS "canDelete",
          has_table_privilege(current_user, format('%I.%I', n.nspname, c.relname), 'REFERENCES') AS "canReferences"
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p')
          AND c.relname IN ('User', 'Organization', 'Pallet', 'PalletEvent', 'PalletDispatch', 'PalletLocation')
        ORDER BY n.nspname, c.relname
      `);

      return res.json({
        session: Array.isArray(sessionInfoRows) && sessionInfoRows.length ? sessionInfoRows[0] : null,
        tables: Array.isArray(tablePrivileges) ? tablePrivileges : [],
      });
    } catch (err) {
      console.error("debug db permissions error:", err);
      return res.status(500).json({ message: "DEBUG_DB_PERMISSIONS_ERROR" });
    }
  });

  app.post("/api/debug/pallet-receive-probe", auth, async (req, res) => {
    if (!(req.user?.isSystemOwner || req.user?.role === "ADMIN")) {
      return res.status(403).json({ message: "FORBIDDEN" });
    }

    const orgId = Number(req.user?.orgId || 0);
    if (!orgId) {
      return res.status(400).json({ message: "ORG_REQUIRED" });
    }

    const supplierName = normalizePalletText(req.body?.supplierName, 160) || "PROBE_SUPPLIER";
    const inboundRef = normalizePalletText(req.body?.inboundRef, 120) || "PROBE_INBOUND";
    const probe = {
      orgId,
      userId: Number(req.user?.id || 0),
      currentUser: null,
      steps: [],
      dbChecks: null,
    };

    try {
      await prisma.$transaction(async (tx) => {
        const sessionRows = await tx.$queryRaw`
          SELECT current_user AS "currentUser"
        `;
        probe.currentUser = Array.isArray(sessionRows) && sessionRows.length
          ? String(sessionRows[0]?.currentUser || "")
          : "";

        const privilegeRows = await tx.$queryRawUnsafe(`
          SELECT
            current_user AS "currentUser",
            has_table_privilege(current_user, 'public."User"', 'SELECT') AS "userTableSelect",
            has_table_privilege(current_user, 'public."User"', 'INSERT') AS "userTableInsert",
            has_table_privilege(current_user, 'public."User"', 'UPDATE') AS "userTableUpdate",
            has_table_privilege(current_user, 'public."User"', 'DELETE') AS "userTableDelete",
            has_table_privilege(current_user, 'public."User"', 'REFERENCES') AS "userTableReferences",
            has_table_privilege(current_user, 'public."User"', 'TRIGGER') AS "userTableTrigger",
            has_column_privilege(current_user, 'public."User"', 'id', 'SELECT') AS "userIdColumnSelect",
            has_column_privilege(current_user, 'public."User"', 'id', 'REFERENCES') AS "userIdColumnReferences",
            has_table_privilege(current_user, 'public."Pallet"', 'INSERT') AS "palletTableInsert",
            has_table_privilege(current_user, 'public."PalletEvent"', 'INSERT') AS "palletEventTableInsert"
        `);

        const palletCustomTriggers = await tx.$queryRawUnsafe(`
          SELECT
            t.tgname AS "name",
            pg_get_triggerdef(t.oid, true) AS "definition",
            pn.nspname AS "functionSchema",
            p.proname AS "functionName"
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_proc p ON p.oid = t.tgfoid
          JOIN pg_namespace pn ON pn.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND c.relname = 'Pallet'
            AND NOT t.tgisinternal
          ORDER BY t.tgname
        `);

        const userRlsRows = await tx.$queryRawUnsafe(`
          SELECT
            c.relrowsecurity AS "rlsEnabled",
            c.relforcerowsecurity AS "forceRls"
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'User'
          LIMIT 1
        `);

        const userPolicies = await tx.$queryRawUnsafe(`
          SELECT
            p.polname AS "policyName",
            p.polpermissive AS "permissive",
            pg_get_expr(p.polqual, p.polrelid) AS "usingExpr",
            pg_get_expr(p.polwithcheck, p.polrelid) AS "withCheckExpr"
          FROM pg_policy p
          JOIN pg_class c ON c.oid = p.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'User'
          ORDER BY p.polname
        `);

        const userTablesBySchema = await tx.$queryRawUnsafe(`
          SELECT
            n.nspname AS "schema",
            c.relname AS "table",
            has_table_privilege(current_user, format('%I.%I', n.nspname, c.relname), 'SELECT') AS "canSelect",
            has_table_privilege(current_user, format('%I.%I', n.nspname, c.relname), 'REFERENCES') AS "canReferences"
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r', 'p')
            AND c.relname = 'User'
          ORDER BY n.nspname
        `);

        const palletForeignKeys = await tx.$queryRawUnsafe(`
          SELECT
            con.conname AS "constraintName",
            src_ns.nspname AS "sourceSchema",
            src.relname AS "sourceTable",
            ref_ns.nspname AS "refSchema",
            ref.relname AS "refTable",
            pg_get_constraintdef(con.oid, true) AS "definition"
          FROM pg_constraint con
          JOIN pg_class src ON src.oid = con.conrelid
          JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
          JOIN pg_class ref ON ref.oid = con.confrelid
          JOIN pg_namespace ref_ns ON ref_ns.oid = ref.relnamespace
          WHERE con.contype = 'f'
            AND src_ns.nspname = 'public'
            AND src.relname = 'Pallet'
          ORDER BY con.conname
        `);

        probe.dbChecks = {
          privileges:
            Array.isArray(privilegeRows) && privilegeRows.length ? privilegeRows[0] : null,
          palletCustomTriggers: Array.isArray(palletCustomTriggers) ? palletCustomTriggers : [],
          userRls:
            Array.isArray(userRlsRows) && userRlsRows.length ? userRlsRows[0] : null,
          userPolicies: Array.isArray(userPolicies) ? userPolicies : [],
          userTablesBySchema: Array.isArray(userTablesBySchema) ? userTablesBySchema : [],
          palletForeignKeys: Array.isArray(palletForeignKeys) ? palletForeignKeys : [],
        };

        const userSelect = await tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${probe.userId} LIMIT 1
        `;
        probe.steps.push({
          step: "user_select",
          ok: true,
          rows: Array.isArray(userSelect) ? userSelect.length : 0,
        });

        const userKeyShare = await tx.$queryRaw`
          SELECT id FROM "User" WHERE id = ${probe.userId} FOR KEY SHARE
        `;
        probe.steps.push({
          step: "user_select_for_key_share",
          ok: true,
          rows: Array.isArray(userKeyShare) ? userKeyShare.length : 0,
        });

        const rawPalletCode = await generateUniquePalletCode(orgId, tx);
        const rawExternalCompatCode = crypto.randomBytes(4).toString("hex").toUpperCase();
        const now = new Date();
        await tx.$executeRaw`
          INSERT INTO "Pallet"
            ("orgId", "palletCode", "externalCode", "status", "supplierName", "inboundRef", "createdByUserId", "receivedAt", "createdAt", "updatedAt")
          VALUES
            (${orgId}, ${rawPalletCode}, ${rawExternalCompatCode}, 'RECEIVED'::"PalletStatus", ${supplierName}, ${inboundRef}, ${probe.userId}, ${now}, ${now}, ${now})
        `;
        probe.steps.push({
          step: "pallet_raw_insert",
          ok: true,
          palletCode: rawPalletCode,
        });

        const palletCode = await generateUniquePalletCode(orgId, tx);
        const externalCompatCode = crypto.randomBytes(4).toString("hex").toUpperCase();
        const pallet = await tx.pallet.create({
          data: {
            orgId,
            palletCode,
            externalCode: externalCompatCode,
            status: "RECEIVED",
            supplierName,
            inboundRef,
            createdByUserId: probe.userId,
            receivedAt: now,
          },
        });
        probe.steps.push({
          step: "pallet_create",
          ok: true,
          palletId: pallet.id,
          palletCode: pallet.palletCode,
        });

        await createPalletEventTx(tx, {
          orgId,
          palletId: pallet.id,
          type: "CREATE",
          fromStatus: null,
          toStatus: "RECEIVED",
          userId: probe.userId,
          metaJson: { supplierName, inboundRef, probe: true },
        });
        probe.steps.push({
          step: "pallet_event_create",
          ok: true,
        });

        const rollback = new Error("PROBE_ROLLBACK");
        rollback.code = "PROBE_ROLLBACK";
        throw rollback;
      });
      return res.json({ ok: true, probe });
    } catch (err) {
      if (err?.code === "PROBE_ROLLBACK") {
        return res.json({ ok: true, probe });
      }
      return res.status(500).json({
        ok: false,
        probe,
        error: toErrorDetails(err),
      });
    }
  });

  app.get("/api/support/tickets/my", async (req, res) => {
    try {
      const requestedStatus = String(req.query?.status || "").trim();
      const status = requestedStatus
        ? normalizeSupportTicketStatus(requestedStatus, "")
        : "";
      const where = {
        createdById: req.user.id,
        ...(status ? { status } : {}),
      };

      const items = await prisma.supportTicket.findMany({
        where,
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              body: true,
              isStaff: true,
              createdAt: true,
              author: { select: { id: true, name: true, email: true } },
            },
          },
          _count: { select: { messages: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 200,
      });

      return res.json({
        items: items.map((item) => supportTicketToResponse(item)),
      });
    } catch (err) {
      console.error("support my tickets error:", err);
      return res.status(500).json({ message: "Не удалось загрузить заявки в поддержку." });
    }
  });

  app.post("/api/support/tickets", async (req, res) => {
    try {
      const orgId = Number(req.user?.orgId || 0);
      if (!orgId) {
        return res.status(400).json({ message: "ORG_REQUIRED" });
      }

      const subject = normalizeSupportText(req.body?.subject, 160);
      const body = normalizeSupportText(req.body?.message, 4000);
      const category = normalizeSupportTicketCategory(req.body?.category, "OTHER");
      // Приоритет заявки выставляет только поддержка/владелец в админке.
      const priority = "NORMAL";

      if (!subject) {
        return res.status(400).json({ message: "Укажите тему обращения." });
      }
      if (!body) {
        return res.status(400).json({ message: "Опишите проблему в сообщении." });
      }

      // Защита от дублей при повторной отправке после сетевой/серверной ошибки:
      // если в коротком окне уже создано такое же обращение от того же пользователя,
      // возвращаем его вместо создания нового.
      const dedupeWindowStart = new Date(Date.now() - 90 * 1000);
      const duplicateTicket = await prisma.supportTicket.findFirst({
        where: {
          orgId,
          createdById: req.user.id,
          subject,
          category,
          createdAt: { gte: dedupeWindowStart },
          messages: {
            some: {
              authorId: req.user.id,
              isStaff: false,
              body,
              createdAt: { gte: dedupeWindowStart },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          createdBy: {
            select: { id: true, name: true, email: true },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              body: true,
              isStaff: true,
              createdAt: true,
              author: { select: { id: true, name: true, email: true } },
            },
          },
          _count: { select: { messages: true } },
        },
      });
      if (duplicateTicket) {
        return res.status(200).json({
          ticket: supportTicketToResponse(duplicateTicket),
          deduped: true,
        });
      }

      const now = new Date();
      const created = await prisma.$transaction(async (tx) => {
        const ticket = await tx.supportTicket.create({
          data: {
            orgId,
            createdById: req.user.id,
            subject,
            category,
            priority,
            status: "OPEN",
            lastMessageAt: now,
          },
        });

        await tx.supportMessage.create({
          data: {
            orgId,
            ticketId: ticket.id,
            authorId: req.user.id,
            isStaff: false,
            body,
          },
        });

        return tx.supportTicket.findUnique({
          where: { id: ticket.id },
          include: {
            createdBy: {
              select: { id: true, name: true, email: true },
            },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                body: true,
                isStaff: true,
                createdAt: true,
                author: { select: { id: true, name: true, email: true } },
              },
            },
            _count: { select: { messages: true } },
          },
        });
      });

      if (!created) {
        return res.status(500).json({ message: "SUPPORT_TICKET_CREATE_ERROR" });
      }

      notifySupportOperators(req.user.id, {
        title: "Новое обращение в поддержку",
        message: subject,
        linkUrl: SUPPORT_TICKETS_ADMIN_LINK,
        payloadJson: { ticketId: created.id },
      }).catch((notifyErr) => {
        console.error("support create ticket notify error:", notifyErr);
      });

      return res.status(201).json({
        ticket: supportTicketToResponse(created),
      });
    } catch (err) {
      console.error("support create ticket error:", err);
      return res.status(500).json({ message: "Не удалось создать обращение в поддержку." });
    }
  });

  app.get("/api/support/tickets/:id/messages", async (req, res) => {
    try {
      const ticketId = Number(req.params.id);
      if (!ticketId || Number.isNaN(ticketId)) {
        return res.status(400).json({ message: "BAD_ID" });
      }

      const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          _count: { select: { messages: true } },
        },
      });
      if (!ticket) {
        return res.status(404).json({ message: "Заявка не найдена." });
      }
      if (!canAccessSupportTicketAsUser(ticket, req.user)) {
        return res.status(403).json({ message: "Нет доступа к заявке." });
      }

      const messages = await prisma.supportMessage.findMany({
        where: { ticketId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          author: { select: { id: true, name: true, email: true } },
        },
      });

      return res.json({
        ticket: supportTicketToResponse(ticket),
        messages: messages.map((message) => ({
          id: message.id,
          body: message.body || "",
          isStaff: Boolean(message.isStaff),
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
          author: message.author
            ? {
                id: message.author.id,
                name: message.author.name || "",
                email: message.author.email || "",
              }
            : null,
        })),
      });
    } catch (err) {
      console.error("support ticket messages error:", err);
      return res.status(500).json({ message: "Не удалось загрузить переписку." });
    }
  });

  app.post("/api/support/tickets/:id/messages", async (req, res) => {
    try {
      const ticketId = Number(req.params.id);
      if (!ticketId || Number.isNaN(ticketId)) {
        return res.status(400).json({ message: "BAD_ID" });
      }

      const body = normalizeSupportText(req.body?.message, 4000);
      if (!body) {
        return res.status(400).json({ message: "Введите сообщение." });
      }

      const ticket = await loadSupportTicketForAccess(ticketId);
      if (!ticket) {
        return res.status(404).json({ message: "Заявка не найдена." });
      }
      if (!canAccessSupportTicketAsUser(ticket, req.user)) {
        return res.status(403).json({ message: "Нет доступа к заявке." });
      }
      if (ticket.status === "RESOLVED") {
        return res.status(409).json({
          message: "Обращение закрыто. Создайте новое обращение.",
        });
      }

      const now = new Date();
      const status = ticket.status === "WAITING_USER" ? "OPEN" : ticket.status;

      const message = await prisma.$transaction(async (tx) => {
        const created = await tx.supportMessage.create({
          data: {
            orgId: ticket.orgId || req.user.orgId || null,
            ticketId: ticket.id,
            authorId: req.user.id,
            isStaff: false,
            body,
          },
          include: {
            author: { select: { id: true, name: true, email: true } },
          },
        });
        await tx.supportTicket.update({
          where: { id: ticket.id },
          data: {
            status,
            lastMessageAt: now,
            closedAt: status === "RESOLVED" ? ticket.closedAt : null,
          },
        });
        return created;
      });

      notifySupportOperators(req.user.id, {
        title: "Новое сообщение в обращении",
        message: ticket.subject || "Обращение в поддержку",
        linkUrl: SUPPORT_TICKETS_ADMIN_LINK,
        payloadJson: { ticketId: ticket.id },
      }).catch((notifyErr) => {
        console.error("support add message notify error:", notifyErr);
      });

      return res.status(201).json({
        message: {
          id: message.id,
          body: message.body || "",
          isStaff: Boolean(message.isStaff),
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
          author: message.author
            ? {
                id: message.author.id,
                name: message.author.name || "",
                email: message.author.email || "",
              }
            : null,
        },
        ticketStatus: status,
      });
    } catch (err) {
      console.error("support add message error:", err);
      return res.status(500).json({ message: "Не удалось отправить сообщение." });
    }
  });

  app.get("/api/admin/support/tickets", auth, requireAdmin, async (req, res) => {
    try {
      const requestedStatus = String(req.query?.status || "").trim();
      const requestedPriority = String(req.query?.priority || "").trim();
      const requestedCategory = String(req.query?.category || "").trim();
      const search = normalizeSupportText(req.query?.search, 160);
      const page = Math.max(1, Number(req.query?.page || 1));
      const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 20)));
      const skip = (page - 1) * limit;

      const status = requestedStatus
        ? normalizeSupportTicketStatus(requestedStatus, "")
        : "";
      const priority = requestedPriority
        ? normalizeSupportTicketPriority(requestedPriority, "")
        : "";
      const category = requestedCategory
        ? normalizeSupportTicketCategory(requestedCategory, "")
        : "";

      const where = {
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
        ...(category ? { category } : {}),
        ...(search
          ? {
              OR: [
                { subject: { contains: search, mode: "insensitive" } },
                { createdBy: { name: { contains: search, mode: "insensitive" } } },
                { createdBy: { email: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {}),
      };

      if (req.user.isSystemOwner) {
        const filterOrgId = Number(req.query?.orgId || 0);
        if (filterOrgId) {
          where.orgId = filterOrgId;
        }
      }

      const [items, total] = await prisma.$transaction([
        prisma.supportTicket.findMany({
          where,
          include: {
            createdBy: {
              select: { id: true, name: true, email: true },
            },
            organization: {
              select: { id: true, name: true, code: true },
            },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                body: true,
                isStaff: true,
                createdAt: true,
                author: { select: { id: true, name: true, email: true } },
              },
            },
            _count: { select: { messages: true } },
          },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          skip,
          take: limit,
        }),
        prisma.supportTicket.count({ where }),
      ]);

      return res.json({
        items: items.map((item) => supportTicketToResponse(item)),
        total,
        page,
        limit,
      });
    } catch (err) {
      console.error("admin support tickets error:", err);
      return res.status(500).json({ message: "Не удалось загрузить обращения." });
    }
  });

  app.get("/api/admin/support/tickets/:id/messages", auth, requireAdmin, async (req, res) => {
    try {
      const ticketId = Number(req.params.id);
      if (!ticketId || Number.isNaN(ticketId)) {
        return res.status(400).json({ message: "BAD_ID" });
      }

      const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          organization: { select: { id: true, name: true, code: true } },
          _count: { select: { messages: true } },
        },
      });
      if (!ticket) {
        return res.status(404).json({ message: "Заявка не найдена." });
      }
      if (!req.user.isSystemOwner && req.user.orgId !== ticket.orgId) {
        return res.status(403).json({ message: "Нет доступа к заявке." });
      }

      const messages = await prisma.supportMessage.findMany({
        where: { ticketId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          author: { select: { id: true, name: true, email: true } },
        },
      });

      return res.json({
        ticket: supportTicketToResponse(ticket),
        messages: messages.map((message) => ({
          id: message.id,
          body: message.body || "",
          isStaff: Boolean(message.isStaff),
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
          author: message.author
            ? {
                id: message.author.id,
                name: message.author.name || "",
                email: message.author.email || "",
              }
            : null,
        })),
      });
    } catch (err) {
      console.error("admin support ticket messages error:", err);
      return res.status(500).json({ message: "Не удалось загрузить переписку." });
    }
  });

  app.post("/api/admin/support/tickets/:id/messages", auth, requireAdmin, async (req, res) => {
    try {
      const ticketId = Number(req.params.id);
      if (!ticketId || Number.isNaN(ticketId)) {
        return res.status(400).json({ message: "BAD_ID" });
      }

      const body = normalizeSupportText(req.body?.message, 4000);
      if (!body) {
        return res.status(400).json({ message: "Введите сообщение." });
      }

      const ticket = await loadSupportTicketForAccess(ticketId);
      if (!ticket) {
        return res.status(404).json({ message: "Заявка не найдена." });
      }
      if (!req.user.isSystemOwner && req.user.orgId !== ticket.orgId) {
        return res.status(403).json({ message: "Нет доступа к заявке." });
      }
      if (ticket.status === "RESOLVED") {
        return res.status(409).json({
          message: "Обращение закрыто. Действия по нему недоступны.",
        });
      }

      const now = new Date();
      const nextStatus = "WAITING_USER";
      const message = await prisma.$transaction(async (tx) => {
        const created = await tx.supportMessage.create({
          data: {
            orgId: ticket.orgId || req.user.orgId || null,
            ticketId: ticket.id,
            authorId: req.user.id,
            isStaff: true,
            body,
          },
          include: {
            author: { select: { id: true, name: true, email: true } },
          },
        });

        await tx.supportTicket.update({
          where: { id: ticket.id },
          data: {
            status: nextStatus,
            lastMessageAt: now,
            closedAt: null,
          },
        });
        return created;
      });

      if (ticket.createdById && ticket.createdById !== req.user.id) {
        await createWarehouseNotification({
          orgId: ticket.orgId || null,
          userId: ticket.createdById,
          type: "SUPPORT",
          title: "Ответ поддержки",
          message: ticket.subject || "В вашем обращении есть новый ответ.",
          linkUrl: SUPPORT_TICKETS_LINK,
          payloadJson: { ticketId: ticket.id },
        }).catch(() => null);
      }

      return res.status(201).json({
        message: {
          id: message.id,
          body: message.body || "",
          isStaff: Boolean(message.isStaff),
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
          author: message.author
            ? {
                id: message.author.id,
                name: message.author.name || "",
                email: message.author.email || "",
              }
            : null,
        },
        ticketStatus: nextStatus,
      });
    } catch (err) {
      console.error("admin support add message error:", err);
      return res.status(500).json({ message: "Не удалось отправить ответ." });
    }
  });

  app.patch("/api/admin/support/tickets/:id", auth, requireAdmin, async (req, res) => {
    try {
      const ticketId = Number(req.params.id);
      if (!ticketId || Number.isNaN(ticketId)) {
        return res.status(400).json({ message: "BAD_ID" });
      }

      const ticket = await loadSupportTicketForAccess(ticketId);
      if (!ticket) {
        return res.status(404).json({ message: "Заявка не найдена." });
      }
      if (!req.user.isSystemOwner && req.user.orgId !== ticket.orgId) {
        return res.status(403).json({ message: "Нет доступа к заявке." });
      }
      if (ticket.status === "RESOLVED") {
        return res.status(409).json({
          message: "Обращение закрыто. Действия по нему недоступны.",
        });
      }

      const hasStatus = Object.prototype.hasOwnProperty.call(req.body || {}, "status");
      const hasPriority = Object.prototype.hasOwnProperty.call(req.body || {}, "priority");
      if (!hasStatus && !hasPriority) {
        return res.status(400).json({ message: "Не переданы данные для изменения." });
      }

      const nextStatus = hasStatus
        ? normalizeSupportTicketStatus(req.body?.status, "")
        : "";
      const nextPriority = hasPriority
        ? normalizeSupportTicketPriority(req.body?.priority, "")
        : "";

      const updateData = {};
      if (hasStatus) {
        if (!nextStatus) {
          return res.status(400).json({ message: "Некорректный статус." });
        }
        updateData.status = nextStatus;
        updateData.closedAt = nextStatus === "RESOLVED" ? new Date() : null;
      }
      if (hasPriority) {
        if (!nextPriority) {
          return res.status(400).json({ message: "Некорректный приоритет." });
        }
        updateData.priority = nextPriority;
      }

      const updated = await prisma.supportTicket.update({
        where: { id: ticket.id },
        data: updateData,
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          organization: { select: { id: true, name: true, code: true } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              body: true,
              isStaff: true,
              createdAt: true,
              author: { select: { id: true, name: true, email: true } },
            },
          },
          _count: { select: { messages: true } },
        },
      });

      if (
        hasStatus &&
        ticket.createdById &&
        ticket.createdById !== req.user.id &&
        ticket.status !== nextStatus
      ) {
        await createWarehouseNotification({
          orgId: ticket.orgId || null,
          userId: ticket.createdById,
          type: "SUPPORT",
          title: "Статус обращения обновлен",
          message: `Новый статус: ${supportTicketStatusLabel(nextStatus)}.`,
          linkUrl: SUPPORT_TICKETS_LINK,
          payloadJson: { ticketId: ticket.id, status: nextStatus },
        }).catch(() => null);
      }

      return res.json({ ticket: supportTicketToResponse(updated) });
    } catch (err) {
      console.error("admin support update ticket error:", err);
      return res.status(500).json({ message: "Не удалось обновить обращение." });
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

      const { planId, periodId, paymentMethod } = req.body || {};
      const plan = getPlan(planId);
      if (!plan) {
        return res.status(400).json({ message: "PLAN_NOT_FOUND" });
      }
      const resolvedPlan = getResolvedPlanCharge(plan, periodId || "1m");
      if (!resolvedPlan) {
        return res.status(400).json({ message: "PLAN_PERIOD_NOT_SUPPORTED" });
      }
      if (plan.id === "trial-1") {
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
      }
      if (plan.id === "start-30") {
        const alreadyUsedStartPlan = await hasUsedStartPlanForBillingScope({
          orgId: req.user.isSystemOwner ? null : targetOrgId,
          userId: billingUserId,
        });
        if (alreadyUsedStartPlan) {
          return res.status(400).json({ message: "START_PLAN_ALREADY_USED" });
        }
      }
      if (paymentMethod && paymentMethod !== "sbp" && paymentMethod !== "default") {
        return res.status(400).json({ message: "PAYMENT_METHOD_INVALID" });
      }
      const resolvedPaymentMethod = paymentMethod === "sbp" ? "sbp" : "default";
      const tempProviderId = `pending_${crypto.randomUUID()}`;
      const localPayment = await prisma.payment.create({
        data: {
          userId: billingUserId,
          provider: "yookassa",
          providerPaymentId: tempProviderId,
          amount: resolvedPlan.amount,
          currency: resolvedPlan.currency,
          status: "pending",
          metadata: {
            planId: resolvedPlan.planId,
            periodId: resolvedPlan.periodId,
            days: resolvedPlan.days,
            amount: resolvedPlan.amount,
            currency: resolvedPlan.currency,
            paymentMethod: resolvedPaymentMethod,
          },
        },
      });

      const payload = {
        amount: {
          value: formatAmount(resolvedPlan.amount),
          currency: resolvedPlan.currency,
        },
        capture: true,
        confirmation: {
          type: "redirect",
          return_url: `${APP_URL}/subscribe/return?paymentId=${localPayment.id}`,
        },
        description: `Subscription ${resolvedPlan.planId} ${resolvedPlan.periodId}`,
        metadata: {
          userId: String(billingUserId),
          planId: resolvedPlan.planId,
          periodId: resolvedPlan.periodId,
          days: String(resolvedPlan.days),
          amount: String(resolvedPlan.amount),
          currency: resolvedPlan.currency,
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
      const resolvedPeriodId =
        metadata.periodId ||
        paymentRecord.metadata?.periodId ||
        resolveBillingPeriodIdByDays(
          plan,
          metadata.days || paymentRecord.metadata?.days,
          "1m"
        );
      const resolvedPlan = getResolvedPlanCharge(plan, resolvedPeriodId);
      if (!resolvedPlan) {
        return res.status(400).json({ message: "PLAN_PERIOD_NOT_SUPPORTED" });
      }
      const expectedAmount = formatAmount(resolvedPlan.amount);
      if (
        providerPayment.amount?.currency !== resolvedPlan.currency ||
        providerPayment.amount?.value !== expectedAmount
      ) {
        return res.status(400).json({ message: "PAYMENT_AMOUNT_MISMATCH" });
      }

      if (providerPayment.status === "succeeded" && providerPayment.paid) {
        if (paymentRecord.status !== "succeeded") {
          await applyPaymentSuccess({
            paymentRecord,
            providerPayment,
            plan: resolvedPlan,
          });
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
        periodId: resolvedPlan.periodId,
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
      const resolvedPeriodId =
        metadata.periodId ||
        resolveBillingPeriodIdByDays(plan, metadata.days, "1m");
      const resolvedPlan = getResolvedPlanCharge(plan, resolvedPeriodId);
      if (!resolvedPlan) {
        return res.status(400).json({ message: "PLAN_PERIOD_NOT_SUPPORTED" });
      }
      const metadataForValidation = {
        ...metadata,
        planId: metadata.planId || resolvedPlan.planId,
        periodId: metadata.periodId || resolvedPlan.periodId,
        days: metadata.days || resolvedPlan.days,
      };
      if (!validatePlanMetadata(resolvedPlan, metadataForValidation) || !metadata.userId) {
        return res.status(400).json({ message: "PAYMENT_METADATA_MISMATCH" });
      }

      const expectedAmount = formatAmount(resolvedPlan.amount);
      if (
        providerPayment.amount?.currency !== resolvedPlan.currency ||
        providerPayment.amount?.value !== expectedAmount
      ) {
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
            amount: Number(providerPayment.amount?.value || resolvedPlan.amount),
            currency: providerPayment.amount?.currency || resolvedPlan.currency,
            status: providerPayment.status || "pending",
            metadata: {
              planId: resolvedPlan.planId,
              periodId: resolvedPlan.periodId,
              days: resolvedPlan.days,
              amount: resolvedPlan.amount,
              currency: resolvedPlan.currency,
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
        await applyPaymentSuccess({
          paymentRecord,
          providerPayment,
          plan: resolvedPlan,
        });
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
    if (!hasPermission(req.user, PERMISSION_KEYS.ADMIN_WAREHOUSE)) {
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
    if (!hasPermission(req.user, PERMISSION_KEYS.ADMIN_WAREHOUSE)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }
    const {
      orgName,
      legalAddress,
      actualAddress,
      inn,
      kpp,
      phone,
      purchaseOrderEmailTemplate,
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
      purchaseOrderEmailTemplate:
        String(purchaseOrderEmailTemplate || "").trim() || null,
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

app.get("/api/settings/marketing-preferences", auth, async (req, res) => {
  try {
    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({ message: "NO_ACCESS" });
    }
    if (req.user?.isSystemOwner) {
      return res.status(403).json({ message: "OWNER_ONLY_COMPANY" });
    }
    const targetOrgId = Number(req.user?.orgId || 0);
    if (!targetOrgId) {
      return res.status(400).json({ message: "ORG_REQUIRED" });
    }

    const isOwner = await isCompanyOwnerAccount(req.user.id, targetOrgId);
    if (!isOwner) {
      return res.status(403).json({ message: "OWNER_ONLY_COMPANY" });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        marketingEmailsEnabled: true,
        marketingConsentAt: true,
        marketingUnsubscribedAt: true,
      },
    });

    return res.json({
      enabled: Boolean(currentUser?.marketingEmailsEnabled),
      consentAt: currentUser?.marketingConsentAt || null,
      unsubscribedAt: currentUser?.marketingUnsubscribedAt || null,
    });
  } catch (err) {
    console.error("marketing preferences get error:", err);
    return res.status(500).json({ message: "MARKETING_SETTINGS_LOAD_ERROR" });
  }
});

app.put("/api/settings/marketing-preferences", auth, async (req, res) => {
  try {
    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({ message: "NO_ACCESS" });
    }
    if (req.user?.isSystemOwner) {
      return res.status(403).json({ message: "OWNER_ONLY_COMPANY" });
    }
    const targetOrgId = Number(req.user?.orgId || 0);
    if (!targetOrgId) {
      return res.status(400).json({ message: "ORG_REQUIRED" });
    }

    const isOwner = await isCompanyOwnerAccount(req.user.id, targetOrgId);
    if (!isOwner) {
      return res.status(403).json({ message: "OWNER_ONLY_COMPANY" });
    }

    const enabled = toBoolean(req.body?.enabled);
    const now = new Date();
    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        marketingEmailsEnabled: enabled,
        marketingConsentAt: enabled ? now : null,
        marketingUnsubscribedAt: enabled ? null : now,
      },
      select: {
        marketingEmailsEnabled: true,
        marketingConsentAt: true,
        marketingUnsubscribedAt: true,
      },
    });

    return res.json({
      ok: true,
      enabled: Boolean(updatedUser?.marketingEmailsEnabled),
      consentAt: updatedUser?.marketingConsentAt || null,
      unsubscribedAt: updatedUser?.marketingUnsubscribedAt || null,
      message: enabled
        ? "Рассылка включена."
        : "Рассылка отключена.",
    });
  } catch (err) {
    console.error("marketing preferences put error:", err);
    return res.status(500).json({ message: "MARKETING_SETTINGS_SAVE_ERROR" });
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

function toManagedUserPayload(user, planId = null) {
  const isSystemOwner = isOwnerEmail(user.email);
  const config = normalizePermissionConfig(user.permissionsJson);
  const permissions = applyPlanPermissionCap(
    resolveUserPermissions({
      role: user.role,
      permissionsJson: user.permissionsJson,
      isSystemOwner,
    }),
    isSystemOwner ? null : planId
  );
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

    res.json(
      users.map((item) => toManagedUserPayload(item, req.user?.subscriptionPlan || null))
    );
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

    const { currentPlanId, maxActiveUsers } = await getOrgPlanAndUserLimit(
      targetOrgId,
      req.user.id
    );
    const activeUsersCount = await prisma.user.count({
      where: {
        orgId: targetOrgId,
        isActive: true,
      },
    });
    if (activeUsersCount >= maxActiveUsers) {
      return res.status(409).json({
        message: "PLAN_USER_LIMIT_REACHED",
        limit: maxActiveUsers,
        plan: currentPlanId,
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
        ...toManagedUserPayload(created, req.user?.subscriptionPlan || null),
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
    const baseCatalog = getPermissionCatalog({
      isSystemOwner: req.user?.isSystemOwner === true,
    });
    if (req.user?.isSystemOwner) {
      return res.json(baseCatalog);
    }

    const scopedPlan = req.user?.subscriptionPlan
      ? String(req.user.subscriptionPlan)
      : null;
    return res.json(filterPermissionCatalogByPlan(baseCatalog, scopedPlan));
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

    res.json({ user: toManagedUserPayload(fresh, req.user?.subscriptionPlan || null) });
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

    res.json({ user: toManagedUserPayload(fresh, req.user?.subscriptionPlan || null) });
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
    const subscriptions = await Promise.all(
      tenants.map((tenant) => getOrgSubscription(tenant.id, null))
    );

    const items = tenants.map(({ users, ...tenant }, index) => {
      const admin = Array.isArray(users) ? users[0] : null;
      const subscription = subscriptions[index] || null;
      const paidUntil = subscription?.paidUntil || null;
      const isActive =
        Boolean(subscription) &&
        ["active", "trialing"].includes(String(subscription?.status || "")) &&
        paidUntil &&
        new Date(paidUntil) > new Date();
      return {
        ...tenant,
        adminUserId: admin?.id || null,
        adminName: admin?.name || null,
        adminLogin: admin?.username || admin?.email || null,
        adminPassword: admin?.passwordVisible || null,
        subscription: subscription
          ? {
              plan: subscription.plan,
              status: subscription.status,
              paidUntil: subscription.paidUntil,
              trialStartedAt: subscription.trialStartedAt,
              trialUsed: subscription.trialUsed,
              isActive: Boolean(isActive),
            }
          : null,
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

app.post(
  "/api/admin/tenants/:id/grant-free-access",
  auth,
  requireAdmin,
  requireSystemOwner,
  async (req, res) => {
    try {
      if (!hasPermission(req.user, PERMISSION_KEYS.ADMIN_TENANTS)) {
        return res.status(403).json({ message: "Нет доступа к разделу." });
      }

      const tenantId = Number(req.params.id);
      if (!tenantId || Number.isNaN(tenantId)) {
        return res.status(400).json({ message: "BAD_TENANT_ID" });
      }

      const daysRaw = Number(req.body?.days || 30);
      const days = Math.max(1, Math.min(3650, Math.trunc(daysRaw)));
      if (!days || Number.isNaN(days)) {
        return res.status(400).json({ message: "BAD_DAYS" });
      }

      const tenant = await prisma.organization.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, code: true, isActive: true },
      });
      if (!tenant || tenant.isActive === false) {
        return res.status(404).json({ message: "TENANT_NOT_FOUND" });
      }
      if (tenant.code === "platform-owner") {
        return res.status(400).json({ message: "OWNER_TENANT_FORBIDDEN" });
      }

      const billingUserId = await getBillingUserIdForOrg(tenant.id, null);
      if (!billingUserId) {
        return res.status(400).json({ message: "BILLING_USER_REQUIRED" });
      }

      const now = new Date();
      const current = await prisma.subscription.findFirst({
        where: { userId: billingUserId },
      });
      const canExtendFromCurrent =
        Boolean(current) &&
        ["active", "trialing"].includes(String(current?.status || "").toLowerCase()) &&
        current?.paidUntil &&
        new Date(current.paidUntil) > now;
      const baseDate = canExtendFromCurrent ? new Date(current.paidUntil) : now;
      const paidUntil = addDays(baseDate, days);

      const next = await prisma.subscription.upsert({
        where: { userId: billingUserId },
        update: {
          plan: "manual-free",
          status: "active",
          paidUntil,
          trialStartedAt: current?.trialStartedAt || null,
          trialUsed: Boolean(current?.trialUsed),
        },
        create: {
          userId: billingUserId,
          plan: "manual-free",
          status: "active",
          paidUntil,
          trialStartedAt: null,
          trialUsed: true,
        },
      });

      return res.json({
        ok: true,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          code: tenant.code,
        },
        subscription: {
          plan: next.plan,
          status: next.status,
          paidUntil: next.paidUntil,
          trialStartedAt: next.trialStartedAt,
          trialUsed: next.trialUsed,
          isActive: true,
        },
      });
    } catch (err) {
      console.error("tenant grant free access error:", err);
      return res.status(500).json({ message: "TENANT_GRANT_FREE_ACCESS_ERROR" });
    }
  }
);

app.post(
  "/api/admin/tenants/:id/toggle-access",
  auth,
  requireAdmin,
  requireSystemOwner,
  async (req, res) => {
    try {
      if (!hasPermission(req.user, PERMISSION_KEYS.ADMIN_TENANTS)) {
        return res.status(403).json({ message: "Нет доступа к разделу." });
      }

      const tenantId = Number(req.params.id);
      if (!tenantId || Number.isNaN(tenantId)) {
        return res.status(400).json({ message: "BAD_TENANT_ID" });
      }

      const enabled = req.body?.enabled === true;

      const tenant = await prisma.organization.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, code: true, isActive: true },
      });
      if (!tenant || tenant.isActive === false) {
        return res.status(404).json({ message: "TENANT_NOT_FOUND" });
      }
      if (tenant.code === "platform-owner") {
        return res.status(400).json({ message: "OWNER_TENANT_FORBIDDEN" });
      }

      const orgSubscriptions = await prisma.subscription.findMany({
        where: { user: { orgId: tenant.id } },
        select: { id: true, userId: true },
      });

      if (!orgSubscriptions.length) {
        if (!enabled) {
          return res.json({
            ok: true,
            tenant: { id: tenant.id, name: tenant.name, code: tenant.code },
            subscription: null,
            accessEnabled: false,
          });
        }
        return res.status(400).json({ message: "TENANT_SUBSCRIPTION_NOT_FOUND" });
      }

      const subscriptionIds = orgSubscriptions.map((row) => row.id);
      await prisma.subscription.updateMany({
        where: { id: { in: subscriptionIds } },
        data: enabled
          ? { status: "active" }
          : { status: "paused", paidUntil: new Date() },
      });

      const subscription = await getOrgSubscription(tenant.id, null);
      const paidUntil = subscription?.paidUntil || null;
      const isEnabled =
        Boolean(subscription) &&
        ["active", "trialing"].includes(String(subscription?.status || "")) &&
        paidUntil &&
        new Date(paidUntil) > new Date();

      return res.json({
        ok: true,
        tenant: { id: tenant.id, name: tenant.name, code: tenant.code },
        subscription: subscription
          ? {
              plan: subscription.plan,
              status: subscription.status,
              paidUntil: subscription.paidUntil,
              trialStartedAt: subscription.trialStartedAt,
              trialUsed: subscription.trialUsed,
              isActive: Boolean(isEnabled),
            }
          : null,
        accessEnabled: Boolean(isEnabled),
      });
    } catch (err) {
      console.error("tenant toggle access error:", err);
      return res.status(500).json({ message: "TENANT_TOGGLE_ACCESS_ERROR" });
    }
  }
);

app.get("/api/admin/platform-news/history", auth, requireAdmin, requireSystemOwner, async (req, res) => {
  try {
    if (!hasPermission(req.user, PERMISSION_KEYS.ADMIN_TENANTS)) {
      return res.status(403).json({ message: "Нет доступа к разделу." });
    }

    const limitRaw = Number(req.query.limit || 20);
    const limit = Math.max(1, Math.min(limitRaw || 20, 100));
    const pageRaw = Number(req.query.page || 1);
    const page = Math.max(1, pageRaw || 1);
    const skip = (page - 1) * limit;

    const where = {
      userId: req.user.id,
      type: PLATFORM_NEWS_BROADCAST_TYPE,
    };

    const [items, total] = await Promise.all([
      prisma.warehouseNotification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.warehouseNotification.count({ where }),
    ]);

    const mapped = items.map((row) => {
      const meta = row?.payloadJson && typeof row.payloadJson === "object" ? row.payloadJson : {};
      return {
        id: row.id,
        createdAt: row.createdAt,
        title: String(meta.title || row.title || ""),
        message: String(meta.message || ""),
        priority: String(meta.priority || "NORMAL"),
        sentCount: Number(meta.sentCount || 0),
        totalRecipients: Number(meta.totalRecipients || 0),
        failedCount: Number(meta.failedCount || 0),
      };
    });

    res.json({
      items: mapped,
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error("platform news history error:", err);
    res.status(500).json({ message: "Не удалось загрузить историю новостей." });
  }
});

app.post("/api/admin/platform-news/publish", auth, requireAdmin, requireSystemOwner, async (req, res) => {
  try {
    if (!hasPermission(req.user, PERMISSION_KEYS.ADMIN_TENANTS)) {
      return res.status(403).json({ message: "Нет доступа к разделу." });
    }

    const rawTitle = String(req.body?.title || "").trim();
    const rawMessage = String(req.body?.message || "").trim();
    const rawPriority = String(req.body?.priority || "").trim().toUpperCase();

    if (!rawTitle) {
      return res.status(400).json({ message: "Введите заголовок новости." });
    }
    if (!rawMessage) {
      return res.status(400).json({ message: "Введите текст новости." });
    }

    const title = rawTitle.slice(0, 140);
    const message = rawMessage.slice(0, 4000);
    const priority = ["LOW", "NORMAL", "HIGH"].includes(rawPriority) ? rawPriority : "NORMAL";

    const admins = await prisma.user.findMany({
      where: {
        role: "ADMIN",
        isActive: true,
        orgId: { not: null },
        organization: {
          is: {
            isActive: true,
          },
        },
      },
      orderBy: [{ orgId: "asc" }, { id: "asc" }],
      select: {
        id: true,
        orgId: true,
        email: true,
      },
    });

    const orgSeen = new Set();
    const recipients = [];
    for (const user of admins) {
      if (isOwnerEmail(user.email)) continue;
      const orgId = Number(user.orgId || 0);
      if (!orgId || orgSeen.has(orgId)) continue;
      orgSeen.add(orgId);
      recipients.push({ orgId, userId: user.id });
    }

    const sendResults = await Promise.allSettled(
      recipients.map((recipient) =>
        createWarehouseNotification({
          orgId: recipient.orgId,
          userId: recipient.userId,
          type: PLATFORM_NEWS_TYPE,
          title,
          message,
          linkUrl: "/news",
          payloadJson: {
            kind: "platform-news",
            priority,
            publishedAt: new Date().toISOString(),
          },
        })
      )
    );

    let sentCount = 0;
    let failedCount = 0;
    for (const result of sendResults) {
      if (result.status === "fulfilled") {
        sentCount += 1;
      } else {
        failedCount += 1;
      }
    }

    const summaryMessage =
      failedCount > 0
        ? `Отправлено ${sentCount} из ${recipients.length}. Ошибок: ${failedCount}.`
        : `Отправлено ${sentCount} из ${recipients.length}.`;

    const historyEntry = await prisma.warehouseNotification.create({
      data: {
        orgId: req.user.orgId || null,
        userId: req.user.id,
        type: PLATFORM_NEWS_BROADCAST_TYPE,
        title: "Рассылка новости платформы",
        message: summaryMessage,
        linkUrl: PLATFORM_NEWS_ADMIN_LINK,
        payloadJson: {
          title,
          message,
          priority,
          sentCount,
          failedCount,
          totalRecipients: recipients.length,
          publishedAt: new Date().toISOString(),
        },
      },
    });

    res.json({
      ok: true,
      sentCount,
      failedCount,
      totalRecipients: recipients.length,
      historyItem: {
        id: historyEntry.id,
        createdAt: historyEntry.createdAt,
        title,
        message,
        priority,
        sentCount,
        failedCount,
        totalRecipients: recipients.length,
      },
      warning:
        recipients.length === 0
          ? "Нет владельцев компаний для рассылки."
          : failedCount > 0
            ? "Часть уведомлений не отправлена. Повторите попытку позже."
            : "",
    });
  } catch (err) {
    console.error("platform news publish error:", err);
    res.status(500).json({ message: "Не удалось отправить новость владельцам компаний." });
  }
});

app.get("/api/platform-news", auth, async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || 30);
    const limit = Math.max(1, Math.min(limitRaw || 30, 100));
    const pageRaw = Number(req.query.page || 1);
    const page = Math.max(1, pageRaw || 1);
    const skip = (page - 1) * limit;

    const where = {
      type: PLATFORM_NEWS_BROADCAST_TYPE,
    };

    const [rows, total] = await Promise.all([
      runWithoutTenantScope(() =>
        prismaBase.warehouseNotification.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        })
      ),
      runWithoutTenantScope(() =>
        prismaBase.warehouseNotification.count({ where })
      ),
    ]);
    const items = rows.map((row) => {
      const meta = row?.payloadJson && typeof row.payloadJson === "object" ? row.payloadJson : {};
      return {
        id: row.id,
        title: String(meta.title || row.title || ""),
        message: String(meta.message || row.message || ""),
        priority: String(meta.priority || "NORMAL"),
        createdAt: row.createdAt,
      };
    });

    res.json({
      items,
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error("platform news list error:", err);
    res.status(500).json({ message: "Не удалось загрузить новости платформы." });
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

    const { currentPlanId, maxActiveUsers } = await getOrgPlanAndUserLimit(
      targetOrgId,
      req.user.id
    );
    const activeUsersCount = await prisma.user.count({
      where: {
        orgId: targetOrgId,
        isActive: true,
      },
    });
    if (activeUsersCount >= maxActiveUsers) {
      return res.status(409).json({
        message: "PLAN_USER_LIMIT_REACHED",
        limit: maxActiveUsers,
        plan: currentPlanId,
      });
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
    const targetOrgIdForActivation = Number(
      inviteOrgId || existingUser?.orgId || 0
    );
    if (targetOrgIdForActivation) {
      const { currentPlanId, maxActiveUsers } = await getOrgPlanAndUserLimit(
        targetOrgIdForActivation,
        invite.createdByUserId || null
      );
      const activeUsersCount = await prisma.user.count({
        where: {
          orgId: targetOrgIdForActivation,
          isActive: true,
        },
      });
      if (activeUsersCount >= maxActiveUsers) {
        return res.status(409).json({
          message: "PLAN_USER_LIMIT_REACHED",
          limit: maxActiveUsers,
          plan: currentPlanId,
        });
      }
    }

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

    const user = await findUserByEmailInsensitive(normalized);
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
        return res.status(400).json({ message: "Укажите название товара." });
      }

      if (!Number.isFinite(q) || !Number.isInteger(q) || q <= 0) {
        return res.status(400).json({
          message: `Количество для товара "${name}" должно быть положительным целым числом.`,
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

        const currentStock = await getCurrentStockForItem(invItem.id);
        const current = currentStock ?? 0;

        if (current < it.quantity) {
          return res.status(400).json({
            message: `Недостаточно остатка по товару "${invItem.name}". Доступно ${current} ${invItem.unit || "шт."}, запрошено ${it.quantity}.`,
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

    // 4. Создаём задачу (уведомления только внутри приложения)
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
    const invItem = await prisma.item.findFirst({
      where: { name: item.name },
    });

    if (!invItem) {
      console.warn(
        `[Warehouse] Товар "${item.name}" не найден в номенклатуре при авто-проведении заявки #${id}`
      );
      continue;
    }

    // Если это расход — проверяем, хватит ли остатка
    if (movementType === "ISSUE") {
      try {
        const stockInfo = await calculateStockAfterMovement(invItem.id, "ISSUE", q);

        if (stockInfo.newStock < 0) {
          console.warn(
            `[Warehouse] Insufficient stock for "${item.name}" in request #${id} (have ${stockInfo.current}, need ${q})`
          );
          continue;
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

    scheduleAutoReorderCheck(invItem.id);
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
        orgId: request.orgId || null,
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
        executorUser: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    console.log(
      `[Warehouse] \u0441\u043e\u0437\u0434\u0430\u043d\u0430 \u0437\u0430\u0434\u0430\u0447\u0430 ${task.id} \u043f\u043e \u0437\u0430\u044f\u0432\u043a\u0435 ${request.id}`
    );

    return task;
  } catch (err) {
    console.error("[createWarehouseTaskFromRequest] error:", err);
  }
}

const WAREHOUSE_TASK_INCLUDE = {
  assigner: {
    select: { id: true, name: true, email: true },
  },
  executorUser: {
    select: { id: true, name: true, email: true, role: true },
  },
};

const WAREHOUSE_TASK_EDIT_STATUSES = ["NEW", "IN_PROGRESS", "DONE", "CANCELLED"];
const WAREHOUSE_TASK_STATUS_LABELS = {
  NEW: "Не выполнена",
  IN_PROGRESS: "В работе",
  DONE: "Выполнена",
  CANCELLED: "Отменена",
};

const TASK_PHOTO_MAX_COUNT = 5;
const TASK_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const TASK_PHOTO_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function normalizeTaskPhotoEntry(entry, index) {
  const fallbackName = `photo-${index + 1}.jpg`;
  const fileNameRaw = String(entry?.fileName || fallbackName).trim();
  const fileName = fileNameRaw.replace(/[^\w.\-()+\u0400-\u04FF ]/g, "_").slice(0, 120) || fallbackName;
  const mimeType = String(entry?.mimeType || "image/jpeg").trim().toLowerCase();
  if (!TASK_PHOTO_ALLOWED_MIME.has(mimeType)) {
    throw new Error("Разрешены только фото JPG, PNG или WEBP.");
  }
  const sizeBytes = Number(entry?.sizeBytes || 0);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > TASK_PHOTO_MAX_BYTES) {
    throw new Error("Размер одного фото не должен превышать 2 МБ.");
  }
  const dataUrl = String(entry?.dataUrl || "").trim();
  const mimeForRegex = mimeType.replace("/", "\\/");
  const base64Regex = new RegExp(`^data:${mimeForRegex};base64,[A-Za-z0-9+/=]+$`, "i");
  if (!base64Regex.test(dataUrl)) {
    throw new Error("Некорректный формат вложенного фото.");
  }
  return { fileName, mimeType, sizeBytes, dataUrl };
}

function normalizeTaskPhotosPayload(rawPhotos) {
  if (!Array.isArray(rawPhotos) || !rawPhotos.length) return [];
  if (rawPhotos.length > TASK_PHOTO_MAX_COUNT) {
    throw new Error(`Можно прикрепить не более ${TASK_PHOTO_MAX_COUNT} фото.`);
  }
  return rawPhotos.map((entry, index) => normalizeTaskPhotoEntry(entry, index));
}

function parseTaskPhotosJson(rawValue) {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry, index) => {
        try {
          return normalizeTaskPhotoEntry(entry, index);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function mapWarehouseTaskForResponse(task) {
  if (!task) return task;
  return {
    ...task,
    taskPhotos: parseTaskPhotosJson(task.taskPhotosJson),
    responsePhotos: parseTaskPhotosJson(task.responsePhotosJson),
  };
}

function canManageWarehouseTasks(user) {
  return Boolean(
    user?.role === "ADMIN" || hasPermission(user, PERMISSION_KEYS.WAREHOUSE_MANAGE)
  );
}

app.post("/api/warehouse/tasks", auth, async (req, res) => {
  try {
    if (!canManageWarehouseTasks(req.user)) {
      return res.status(403).json({ message: "Только администратор может создавать задачи." });
    }

    const { title, description, dueDate, executorUserId, taskPhotos } = req.body;

    if (!title) {
      return res
        .status(400)
        .json({ message: "\u041d\u0443\u0436\u043d\u043e \u0443\u043a\u0430\u0437\u0430\u0442\u044c \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435 \u0437\u0430\u0434\u0430\u0447\u0438." });
    }

    const normalizedExecutorUserId =
      Number(executorUserId) > 0 ? Number(executorUserId) : null;

    let executor = null;
    if (normalizedExecutorUserId) {
      executor = await prisma.user.findFirst({
        where: {
          id: normalizedExecutorUserId,
          orgId: req.user.orgId || null,
          isActive: true,
        },
        select: { id: true, name: true, email: true, role: true },
      });
      if (!executor) {
        return res.status(400).json({ message: "Выбранный исполнитель не найден." });
      }
    }

    const normalizedTaskPhotos = normalizeTaskPhotosPayload(taskPhotos);

    const task = await prisma.warehouseTask.create({
      data: {
        orgId: req.user.orgId || null,
        title,
        description: description || null,
        taskPhotosJson: normalizedTaskPhotos.length
          ? JSON.stringify(normalizedTaskPhotos)
          : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        executorUserId: executor?.id || null,
        executorName: executor?.name || null,
        executorChatId: null,
        assignerId: req.user.id,
      },
      include: WAREHOUSE_TASK_INCLUDE,
    });

    if (task.executorUserId) {
      await createWarehouseNotification({
        orgId: req.user.orgId || null,
        userId: task.executorUserId,
        type: "TASK_ASSIGNED",
        title: "Новая задача склада",
        message: `Вам назначена задача: "${task.title}".`,
        linkUrl: TASKS_JOURNAL_LINK,
        payloadJson: { taskId: task.id },
      });
    }

    res.status(201).json(mapWarehouseTaskForResponse(task));
  } catch (err) {
    console.error("warehouse task create error:", err);
    const message = String(err?.message || "");
    if (
      message.includes("Можно прикрепить не более") ||
      message.includes("Разрешены только фото") ||
      message.includes("Размер одного фото") ||
      message.includes("Некорректный формат вложенного фото")
    ) {
      return res.status(400).json({ message });
    }
    res
      .status(500)
      .json({ message: "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u0437\u0430\u0434\u0430\u0447\u0438 \u0441\u043a\u043b\u0430\u0434\u0430." });
  }
});

app.get("/api/warehouse/tasks/executors", auth, async (req, res) => {
  try {
    if (!canManageWarehouseTasks(req.user)) {
      return res.status(403).json({ message: "Нет прав для просмотра исполнителей." });
    }
    const users = await prisma.user.findMany({
      where: {
        orgId: req.user.orgId || null,
        isActive: true,
        role: { in: ["EMPLOYEE", "ADMIN"] },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });
    res.json(users);
  } catch (err) {
    console.error("warehouse task executors error:", err);
    res.status(500).json({ message: "Ошибка сервера при загрузке исполнителей." });
  }
});

app.get("/api/warehouse/tasks/my", auth, async (req, res) => {
  try {
    const manager = canManageWarehouseTasks(req.user);
    const tasks = await prisma.warehouseTask.findMany({
      where: manager
        ? {
            OR: [{ executorUserId: req.user.id }, { assignerId: req.user.id }],
          }
        : { executorUserId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: WAREHOUSE_TASK_INCLUDE,
    });

    res.json(tasks.map(mapWarehouseTaskForResponse));
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
    if (!canManageWarehouseTasks(req.user)) {
      return res.status(403).json({ message: "Нет прав для просмотра всех задач." });
    }

    const tasks = await prisma.warehouseTask.findMany({
      orderBy: { createdAt: "desc" },
      include: WAREHOUSE_TASK_INCLUDE,
    });

    res.json(tasks.map(mapWarehouseTaskForResponse));
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

    if (!id) {
      return res.status(400).json({ message: "Некорректный идентификатор задачи." });
    }

    if (!WAREHOUSE_TASK_EDIT_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Недопустимый статус" });
    }

    const existing = await prisma.warehouseTask.findUnique({
      where: { id },
      include: WAREHOUSE_TASK_INCLUDE,
    });
    if (!existing) {
      return res.status(404).json({ message: "Задача не найдена." });
    }

    const manager = canManageWarehouseTasks(req.user);
    const isExecutor = existing.executorUserId === req.user.id;
    if (!manager && !isExecutor) {
      return res.status(403).json({ message: "Можно менять только назначенные вам задачи." });
    }

    const updated = await prisma.warehouseTask.update({
      where: { id },
      data: { status },
      include: WAREHOUSE_TASK_INCLUDE,
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

    if (existing.status !== updated.status) {
      if (updated.assignerId && updated.assignerId !== req.user.id) {
        await createWarehouseNotification({
          orgId: req.user.orgId || null,
          userId: updated.assignerId,
          type: "TASK_STATUS_CHANGED",
          title: "Статус задачи изменен",
          message: `Задача "${updated.title}" переведена в статус "${
            WAREHOUSE_TASK_STATUS_LABELS[updated.status] || updated.status
          }".`,
          linkUrl: TASKS_JOURNAL_LINK,
          payloadJson: {
            taskId: updated.id,
            fromStatus: existing.status,
            toStatus: updated.status,
          },
        });
      }
      if (
        updated.executorUserId &&
        updated.executorUserId !== req.user.id &&
        updated.executorUserId !== updated.assignerId
      ) {
        await createWarehouseNotification({
          orgId: req.user.orgId || null,
          userId: updated.executorUserId,
          type: "TASK_STATUS_CHANGED",
          title: "Статус вашей задачи обновлен",
          message: `Задача "${updated.title}" теперь в статусе "${
            WAREHOUSE_TASK_STATUS_LABELS[updated.status] || updated.status
          }".`,
          linkUrl: TASKS_JOURNAL_LINK,
          payloadJson: {
            taskId: updated.id,
            fromStatus: existing.status,
            toStatus: updated.status,
          },
        });
      }
    }

    res.json(mapWarehouseTaskForResponse(updated));
  } catch (err) {
    console.error("warehouse task status error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при обновлении статуса задачи" });
  }
});

app.put("/api/warehouse/tasks/:id/response", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "Некорректный идентификатор задачи." });
    }

    const responseTextRaw = req.body?.responseText;
    const responseText =
      responseTextRaw == null ? null : String(responseTextRaw).trim().slice(0, 5000);
    const normalizedResponsePhotos = normalizeTaskPhotosPayload(req.body?.responsePhotos);

    if (!responseText && normalizedResponsePhotos.length === 0) {
      return res.status(400).json({ message: "Добавьте текст ответа или фото." });
    }

    const existing = await prisma.warehouseTask.findUnique({
      where: { id },
      include: WAREHOUSE_TASK_INCLUDE,
    });
    if (!existing) {
      return res.status(404).json({ message: "Задача не найдена." });
    }

    const manager = canManageWarehouseTasks(req.user);
    const isExecutor = Number(existing.executorUserId) === Number(req.user.id);
    if (!manager && !isExecutor) {
      return res.status(403).json({ message: "Можно отвечать только по назначенным вам задачам." });
    }

    const updated = await prisma.warehouseTask.update({
      where: { id },
      data: {
        responseText: responseText || null,
        responsePhotosJson: normalizedResponsePhotos.length
          ? JSON.stringify(normalizedResponsePhotos)
          : null,
        responseUpdatedAt: new Date(),
        responseAuthorUserId: req.user.id,
        responseAuthorName: req.user.name || req.user.email || null,
      },
      include: WAREHOUSE_TASK_INCLUDE,
    });

    if (updated.assignerId && updated.assignerId !== req.user.id) {
      await createWarehouseNotification({
        orgId: req.user.orgId || null,
        userId: updated.assignerId,
        type: "TASK_RESPONSE_UPDATED",
        title: "Новый ответ по задаче",
        message: `По задаче "${updated.title}" добавлен ответ.`,
        linkUrl: TASKS_JOURNAL_LINK,
        payloadJson: { taskId: updated.id },
      });
    }

    res.json(mapWarehouseTaskForResponse(updated));
  } catch (err) {
    console.error("warehouse task response error:", err);
    const message = String(err?.message || "");
    if (
      message.includes("Можно прикрепить не более") ||
      message.includes("Разрешены только фото") ||
      message.includes("Размер одного фото") ||
      message.includes("Некорректный формат вложенного фото")
    ) {
      return res.status(400).json({ message });
    }
    res.status(500).json({ message: "Ошибка сервера при сохранении ответа по задаче." });
  }
});

// ================== УВЕДОМЛЕНИЯ ==================

app.get("/api/notifications", auth, async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || 25);
    const limit = Math.max(1, Math.min(limitRaw || 25, 100));
    const unreadOnly =
      String(req.query.unreadOnly || "").trim().toLowerCase() === "true";

    const where = {
      userId: req.user.id,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [items, unreadCount] = await Promise.all([
      prisma.warehouseNotification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.warehouseNotification.count({
        where: {
          userId: req.user.id,
          isRead: false,
        },
      }),
    ]);

    res.json({ items, unreadCount });
  } catch (err) {
    console.error("notifications list error:", err);
    res.status(500).json({ message: "Ошибка загрузки уведомлений." });
  }
});

app.get("/api/notifications/unread-count", auth, async (req, res) => {
  try {
    const unreadCount = await prisma.warehouseNotification.count({
      where: {
        userId: req.user.id,
        isRead: false,
      },
    });
    res.json({ unreadCount });
  } catch (err) {
    console.error("notifications unread-count error:", err);
    res.status(500).json({ message: "Ошибка загрузки количества уведомлений." });
  }
});

app.post("/api/notifications/:id/read", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "Некорректный идентификатор уведомления." });
    }

    const current = await prisma.warehouseNotification.findFirst({
      where: {
        id,
        userId: req.user.id,
      },
      select: { id: true, isRead: true },
    });

    if (!current) {
      return res.status(404).json({ message: "Уведомление не найдено." });
    }
    if (current.isRead) {
      return res.json({ ok: true });
    }

    await prisma.warehouseNotification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("notifications mark-read error:", err);
    res.status(500).json({ message: "Ошибка обновления уведомления." });
  }
});

app.post("/api/notifications/read-all", auth, async (req, res) => {
  try {
    const result = await prisma.warehouseNotification.updateMany({
      where: {
        userId: req.user.id,
        isRead: false,
      },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ ok: true, updated: result.count || 0 });
  } catch (err) {
    console.error("notifications read-all error:", err);
    res.status(500).json({ message: "Ошибка обновления уведомлений." });
  }
});

app.get("/api/notifications/push/public-key", auth, async (req, res) => {
  res.json({
    enabled: WEB_PUSH_ENABLED,
    publicKey: WEB_PUSH_ENABLED ? WEB_PUSH_PUBLIC_KEY : null,
  });
});

app.post("/api/notifications/push/subscribe", auth, async (req, res) => {
  try {
    if (!WEB_PUSH_ENABLED) {
      return res.status(400).json({ message: "Push-уведомления пока не настроены." });
    }

    const subscription = parsePushSubscription(req.body?.subscription || req.body);
    if (!subscription) {
      return res.status(400).json({ message: "Некорректные данные push-подписки." });
    }

    await prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: {
        orgId: req.user.orgId || null,
        userId: req.user.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        userAgent: String(req.headers["user-agent"] || "").slice(0, 255),
      },
      update: {
        orgId: req.user.orgId || null,
        userId: req.user.id,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        userAgent: String(req.headers["user-agent"] || "").slice(0, 255),
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("push subscribe error:", err);
    res.status(500).json({ message: "Не удалось сохранить push-подписку." });
  }
});

app.post("/api/notifications/push/unsubscribe", auth, async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || "").trim();
    if (!endpoint) {
      return res.status(400).json({ message: "Не передан endpoint подписки." });
    }

    await prisma.pushSubscription.deleteMany({
      where: {
        endpoint,
        userId: req.user.id,
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("push unsubscribe error:", err);
    res.status(500).json({ message: "Не удалось удалить push-подписку." });
  }
});

app.post("/api/notifications/push/test", auth, async (req, res) => {
  try {
    if (!WEB_PUSH_ENABLED) {
      return res.status(400).json({ message: "Push-уведомления на сервере не настроены." });
    }

    const userSubsCount = await prisma.pushSubscription.count({
      where: {
        userId: req.user.id,
      },
    });

    if (!userSubsCount) {
      return res.status(409).json({
        message:
          "Нет активной push-подписки на этом аккаунте. Откройте приложение на устройстве и разрешите уведомления.",
      });
    }

    await createWarehouseNotification({
      orgId: req.user.orgId || null,
      userId: req.user.id,
      type: "PUSH_TEST",
      title: "Тест push-уведомления",
      message: "Проверка прошла: push-канал подключен.",
      linkUrl: "/warehouse",
      payloadJson: { at: new Date().toISOString() },
    });

    return res.json({
      ok: true,
      message: "Тестовое push-уведомление отправлено.",
    });
  } catch (err) {
    console.error("push test error:", err);
    return res.status(500).json({ message: "Ошибка отправки тестового push-уведомления." });
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
        .json({ message: "Артикул обязателен" });
    }

    if (!unit || !unit.trim()) {
      return res
        .status(400)
        .json({ message: "Единица измерения обязательна" });
    }

    // 2) Числовые поля
    const minVal = Number(minStock);
    const maxVal = Number(maxStock);
    const hasDefaultPrice =
      defaultPrice !== undefined &&
      defaultPrice !== null &&
      String(defaultPrice).trim() !== "";
    let priceVal = null;
    if (hasDefaultPrice) {
      const parsed = Number(String(defaultPrice).toString().replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0) {
        return res.status(400).json({
          message: "Цена за единицу должна быть числом (0 и больше)",
        });
      }
      priceVal = parsed;
    }

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

    // ищем по штрихкоду, QR или артикулу (на случай, если сканер посылает код артикула)
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
      imageUrl: item.imageUrl || null,
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
    const qrCode = buildLocationQrCode(location);
    if (!qrCode) {
      return res.status(400).json({ message: "Ошибка генерации QR локации" });
    }
    if (location.qrCode && !force && !isLegacyLocationQrCode(location.qrCode)) {
      return res.json({ id: location.id, qrCode: normalizePalletCode(location.qrCode) });
    }
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

    const isLoc = /^BP:(LOC|LOCATION):/i.test(raw);
    const isItem =
      raw.startsWith("BP:ITEM:") ||
      raw.startsWith("BP:ARTICLE:") ||
      raw.startsWith("BP:PRODUCT:");

    if (isLoc) {
      const payload = raw.replace(/^BP:(LOC|LOCATION):/i, "");
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
      const payload = raw.replace(/^BP:(ITEM|ARTICLE|PRODUCT):/, "");
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
          imageUrl: item.imageUrl || null,
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
          imageUrl: item.imageUrl || null,
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

// ===== DISCREPANCY CLOSE =====
app.put("/api/warehouse/discrepancies/:id/close", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { closeNote } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный идентификатор расхождения." });
    }

    const discrepancy = await prisma.stockDiscrepancy.findUnique({
      where: { id },
      include: { item: true, location: true },
    });
    if (!discrepancy) {
      return res.status(404).json({ message: "Расхождение не найдено." });
    }

    if (discrepancy.status === "CLOSED") {
      return res.json({ ok: true, alreadyClosed: true });
    }

    if (!["ADMIN", "EMPLOYEE"].includes(req.user?.role)) {
      return res.status(403).json({ message: "Недостаточно прав." });
    }

    if (discrepancy.delta < 0 && req.user?.role !== "ADMIN") {
      return res
        .status(403)
        .json({ message: "Только администратор может закрывать минусовые расхождения." });
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
          comment: "Корректировка - (закрытие расхождения)",
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
      return res.status(400).json({ message: "Нет привязки к ячейке товара." });
    }
    res.status(500).json({ message: "Не удалось закрыть расхождение." });
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
    res.status(500).json({ message: "Ошибка инвентаризации. Проверьте данные." });
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
      "Приход (ТСД)",
      locationId ? `ячейка=${locationId}` : "",
      supplierName ? `поставщик=${String(supplierName).trim()}` : "",
      docNo ? `???=${String(docNo).trim()}` : "",
    ].filter(Boolean);
    const baseComment = commentParts.join(" ");

    const linesToPost = hasLines ? lines : [{ itemId, qty, manufacturedAt, expiresAt }];

    await prisma.$transaction(async (tx) => {
      const receivingLocationId = await getReceivingLocationId(tx, req.user?.orgId || null);
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

      const moveComment = comment || `Перемещение (ТСД) ${from} > ${to}`;

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

      const moveComment = comment || `Размещение (ТСД) ${from} > ${to}`;

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
        line.locationId || (await getReceivingLocationId(tx, req.user?.orgId || null));
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

      const moveComment = `Размещение (ТСД) ${receivingLocationId} > ${to}`;

      if (line.sourceType === "INVENTORY_PLUS") {
        await stockService.createMovementInTx(tx, {
          opId: null,
          type: "ADJUSTMENT",
          itemId: line.itemId,
          qty: moveQty,
          locationId: to,
          fromLocationId: null,
          toLocationId: to,
          comment: "Инвентаризация +",
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

    const pickComment = comment || `Подбор (ТСД) из ${from}`;
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

      const replComment = comment || `Пополнение (ТСД) ${from} > ${to}`;

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
    const normalizedLayout = String(layout || "A4")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");

    const layoutPreset = (() => {
      if (normalizedLayout === "A4_12") {
        return {
          pageSize: "A4",
          pageMargin: "8mm",
          bodyPadding: "0",
          wrapperClass: "grid",
          gridColumns: "repeat(3, 1fr)",
          gridGap: "4mm",
          justifyItems: "stretch",
          labelRadius: "6px",
          labelPadding: "4mm",
          labelWidth: "auto",
          labelMinHeight: "58mm",
          labelGap: "3mm",
          titleSize: "13px",
          subtitleSize: "10px",
          qrSize: "30mm",
          locationQrSize: "34mm",
          codeSize: "10px",
          codeSpacing: "0.2px",
          forcePageBreak: false,
        };
      }

      if (normalizedLayout === "LABEL_70X50") {
        return {
          pageSize: "70mm 50mm",
          pageMargin: "0",
          bodyPadding: "0",
          wrapperClass: "",
          gridColumns: "1fr",
          gridGap: "0",
          justifyItems: "stretch",
          labelRadius: "0",
          labelPadding: "2.5mm",
          labelWidth: "70mm",
          labelMinHeight: "50mm",
          labelGap: "2mm",
          titleSize: "12px",
          subtitleSize: "10px",
          qrSize: "28mm",
          locationQrSize: "32mm",
          codeSize: "10px",
          codeSpacing: "0.2px",
          forcePageBreak: true,
        };
      }

      if (normalizedLayout === "LABEL" || normalizedLayout === "LABEL_58X40") {
        return {
          pageSize: "58mm 40mm",
          pageMargin: "0",
          bodyPadding: "0",
          wrapperClass: "",
          gridColumns: "1fr",
          gridGap: "0",
          justifyItems: "stretch",
          labelRadius: "0",
          labelPadding: "2mm",
          labelWidth: "58mm",
          labelMinHeight: "40mm",
          labelGap: "2mm",
          titleSize: "10px",
          subtitleSize: "8px",
          qrSize: "22mm",
          locationQrSize: "25mm",
          codeSize: "9px",
          codeSpacing: "0.2px",
          forcePageBreak: true,
        };
      }

      return {
        pageSize: "A4",
        pageMargin: "10mm",
        bodyPadding: "0",
        wrapperClass: "grid",
        gridColumns: "1fr",
        gridGap: "12mm",
        justifyItems: "center",
        labelRadius: "12px",
        labelPadding: "10mm",
        labelWidth: "170mm",
        labelMinHeight: "90mm",
        labelGap: "8mm",
        titleSize: "18px",
        subtitleSize: "13px",
        qrSize: "60mm",
        locationQrSize: "70mm",
        codeSize: "14px",
        codeSpacing: "0.4px",
        forcePageBreak: false,
      };
    })();

    const labels = [];

    for (const entry of ids) {
      const id = Number(entry);
      if (!id) continue;

      if (kind === "item") {
        const item = await prisma.item.findUnique({ where: { id } });
        if (!item) continue;
        labels.push({
          kind: "item",
          title: item.name,
          subtitle: item.sku
            ? `Артикул: ${item.sku}`
            : item.barcode
              ? `BARCODE: ${item.barcode}`
              : "",
          qrValue: `BP:ITEM:${item.id}`,
        });
      } else {
        const location = await prisma.warehouseLocation.findUnique({ where: { id } });
        if (!location) continue;
        const qrValue = await ensureBusinessLocationQrCode(location);
        const meta = [location.code, location.zone, location.aisle, location.rack, location.level]
          .filter(Boolean)
          .join(" / ");
        const displayCode = normalizePalletCode(location.code || location.name || "");
        labels.push({
          kind: "location",
          title: location.name || `LOCATION ${location.id}`,
          subtitle: meta,
          qrValue,
          displayCode: displayCode || qrValue,
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

    const printRows = rendered.flatMap((row) =>
      Array.from({ length: count }, () => row)
    );

    const html = `
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Print Labels</title>
          <style>
            @page { size: ${layoutPreset.pageSize}; margin: ${layoutPreset.pageMargin}; }
            body { font-family: Arial, sans-serif; margin: 0; color: #0f172a; padding: ${layoutPreset.bodyPadding}; }
            .grid {
              display: grid;
              grid-template-columns: ${layoutPreset.gridColumns};
              gap: ${layoutPreset.gridGap};
              justify-items: ${layoutPreset.justifyItems};
            }
            .label {
              border: 1px solid #e5e7eb;
              border-radius: ${layoutPreset.labelRadius};
              padding: ${layoutPreset.labelPadding};
              display: grid;
              gap: ${layoutPreset.labelGap};
              width: ${layoutPreset.labelWidth};
              min-height: ${layoutPreset.labelMinHeight};
              box-sizing: border-box;
            }
            .title { font-weight: 700; font-size: ${layoutPreset.titleSize}; line-height: 1.2; }
            .subtitle { font-size: ${layoutPreset.subtitleSize}; color: #475569; }
            .qr { width: ${layoutPreset.qrSize}; height: ${layoutPreset.qrSize}; }
            .code { font-size: ${layoutPreset.codeSize}; letter-spacing: ${layoutPreset.codeSpacing}; text-align: center; }
            .label--location .qr { width: ${layoutPreset.locationQrSize}; height: ${layoutPreset.locationQrSize}; }
            .label--page-break { break-after: page; page-break-after: always; }
            .label--page-break:last-child { break-after: auto; page-break-after: auto; }
            .print-actions { margin: 12px 8px 8px; display: flex; gap: 8px; flex-wrap: wrap; }
            .print-btn { padding: 6px 14px; font-size: 13px; cursor: pointer; }
            @media print { .print-actions { display: none; } }
          </style>
        </head>
        <body>
          <div class="${layoutPreset.wrapperClass}">
            ${printRows
              .map((r) => {
                const classes = [
                  "label",
                  r.kind === "location" ? "label--location" : "",
                  layoutPreset.forcePageBreak ? "label--page-break" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return `
                <div class="${classes}">
                  <div class="title">${escapeHtml(r.title)}</div>
                  ${r.subtitle ? `<div class="subtitle">${escapeHtml(r.subtitle)}</div>` : ""}
                  <img class="qr" src="${r.qrImg}" />
                  <div class="code">${escapeHtml(r.displayCode || r.qrValue)}</div>
                </div>
              `;
              })
              .join("")}
          </div>
          <div class="print-actions">
            <button class="print-btn" onclick="window.print()">Печать</button>
            <button class="print-btn" onclick="returnToApp()">Назад</button>
          </div>
          <script>
            function returnToApp() {
              try {
                if (window.opener && !window.opener.closed) {
                  window.close();
                  return;
                }
              } catch (e) {}
              if (window.history.length > 1) {
                window.history.back();
                return;
              }
              window.location.href = "/warehouse";
            }
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
    let visibleCode = "";
    if (kind === "product") {
      const item = await prisma.item.findUnique({ where: { id: Number(id) } });
      if (!item) return res.status(404).json({ message: "Товар не найден" });
      title = item.name;
      subtitle = item.sku ? `Артикул: ${item.sku}` : "";
      qrValue = item.qrCode || `BP:PRODUCT:${item.id}`;
      visibleCode = qrValue;
    } else {
      const location = await prisma.warehouseLocation.findUnique({ where: { id: Number(id) } });
      if (!location) return res.status(404).json({ message: "Локация не найдена" });
      title = `ЛОКАЦИЯ: ${location.name}`;
      subtitle = [location.zone, location.aisle, location.rack, location.level].filter(Boolean).join(" / ");
      qrValue = await ensureBusinessLocationQrCode(location);
      visibleCode = normalizePalletCode(location.code || location.name || "") || qrValue;
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
            .print-actions { margin: 12px 8px 8px; display: flex; gap: 8px; flex-wrap: wrap; }
            .print-btn { padding: 6px 14px; font-size: 13px; cursor: pointer; }
            @media print { .print-actions { display: none; } }
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
                <div class="code">${visibleCode || qrValue}</div>
              </div>
            `
              )
              .join("")}
          </div>
          <div class="print-actions">
            <button class="print-btn" onclick="window.print()">Печать</button>
            <button class="print-btn" onclick="returnToApp()">Назад</button>
          </div>
          <script>
            function returnToApp() {
              try {
                if (window.opener && !window.opener.closed) {
                  window.close();
                  return;
                }
              } catch (e) {}
              if (window.history.length > 1) {
                window.history.back();
                return;
              }
              window.location.href = "/warehouse";
            }
            window.print();
          </script>
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
        const qrValue = await ensureBusinessLocationQrCode(location);
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
            .print-actions { margin: 12px 0 8px; display: flex; gap: 8px; flex-wrap: wrap; }
            .print-btn { padding: 6px 14px; font-size: 13px; cursor: pointer; }
            @media print { .print-actions { display: none; } }
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
                    ${r.sku ? `<div class="sku">Артикул: ${r.sku}</div>` : ""}
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
          <div class="print-actions">
            <button class="print-btn" onclick="window.print()">Печать</button>
            <button class="print-btn" onclick="returnToApp()">Назад</button>
          </div>
          <script>
            function returnToApp() {
              try {
                if (window.opener && !window.opener.closed) {
                  window.close();
                  return;
                }
              } catch (e) {}
              if (window.history.length > 1) {
                window.history.back();
                return;
              }
              window.location.href = "/warehouse";
            }
            window.print();
          </script>
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
        stockHolds: { where: { status: "ACTIVE" } },
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

      const heldQty = (item.stockHolds || []).reduce(
        (sum, hold) => sum + (Number(hold?.qty) || 0),
        0
      );
      const availableQty = Math.max(0, qty - heldQty);

      return {
        id: item.id,
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        unit: item.unit,
        minStock: item.minStock,
        maxStock: item.maxStock,
        currentStock: Math.round(qty),
        heldStock: Math.round(heldQty),
        availableStock: Math.round(availableQty),
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
      include: { movements: true, stockHolds: { where: { status: "ACTIVE" } } },
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

      const heldQty = (item.stockHolds || []).reduce(
        (sum, hold) => sum + (Number(hold?.qty) || 0),
        0
      );
      const availableQty = Math.max(0, qty - heldQty);

      return {
        id: item.id,
        name: item.name,
        sku: item.sku,
        barcode: item.barcode,
        unit: item.unit,
        currentStock: Math.round(qty),
        heldStock: Math.round(heldQty),
        availableStock: Math.round(availableQty),
      };
    });

    res.json(result);
  } catch (err) {
    console.error("warehouse stock summary error:", err);
    res.status(500).json({ message: "WAREHOUSE_STOCK_SUMMARY_ERROR" });
  }
});

app.get("/api/warehouse/holds", auth, async (req, res) => {
  try {
    const orgId = req.user?.orgId || null;
    const status = String(req.query.status || "ACTIVE").toUpperCase();
    const itemId = Number(req.query.itemId);
    const locationId = Number(req.query.locationId);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

    const where = {
      orgId,
      status: ["ACTIVE", "RELEASED"].includes(status) ? status : "ACTIVE",
    };
    if (Number.isFinite(itemId) && itemId > 0) where.itemId = itemId;
    if (Number.isFinite(locationId) && locationId > 0) where.locationId = locationId;

    const [total, rows] = await prisma.$transaction([
      prisma.stockHold.count({ where }),
      prisma.stockHold.findMany({
        where,
        include: {
          item: { select: { id: true, name: true, sku: true, unit: true } },
          location: {
            select: { id: true, code: true, name: true, zone: true, aisle: true, rack: true, level: true },
          },
          createdBy: { select: { id: true, name: true, email: true } },
          releasedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    res.json({
      items: rows,
      paging: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("warehouse holds list error:", err);
    res.status(500).json({ message: "\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u043e\u043a \u043e\u0441\u0442\u0430\u0442\u043a\u043e\u0432." });
  }
});

app.post("/api/warehouse/holds", auth, async (req, res) => {
  try {
    const orgId = req.user?.orgId || null;
    const itemId = Number(req.body?.itemId);
    const locationId = Number(req.body?.locationId);
    const qty = Number(req.body?.qty);
    const reason = String(req.body?.reason || "").trim();
    const note = req.body?.note ? String(req.body.note).trim() : null;

    if (!itemId || !locationId || !Number.isFinite(qty) || qty <= 0 || !reason) {
      return res.status(400).json({
        message: "\u041d\u0443\u0436\u043d\u043e \u0443\u043a\u0430\u0437\u0430\u0442\u044c \u0442\u043e\u0432\u0430\u0440, \u044f\u0447\u0435\u0439\u043a\u0443, \u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e (>0) \u0438 \u043f\u0440\u0438\u0447\u0438\u043d\u0443 \u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u043a\u0438.",
      });
    }

    const created = await prisma.$transaction(async (tx) => {
        const item = await tx.item.findFirst({ where: { id: itemId, orgId } });
        if (!item) {
          const err = new Error("ITEM_NOT_FOUND");
          err.code = "ITEM_NOT_FOUND";
          throw err;
      }

      const location = await tx.warehouseLocation.findFirst({ where: { id: locationId, orgId } });
      if (!location) {
        const err = new Error("LOCATION_NOT_FOUND");
        err.code = "LOCATION_NOT_FOUND";
        throw err;
      }

      const onHandQty = await stockService.getItemLocationQty(tx, itemId, locationId);
      const activeHoldQty = await getActiveHoldQtyForLocation(tx, itemId, locationId);
      const availableQty = Math.max(0, (Number(onHandQty) || 0) - activeHoldQty);

      if (availableQty < qty) {
        const err = new Error("HOLD_EXCEEDS_AVAILABLE");
        err.code = "HOLD_EXCEEDS_AVAILABLE";
        err.detail = {
          onHandQty: Number(onHandQty) || 0,
          activeHoldQty,
          availableQty,
        };
        throw err;
      }

      return tx.stockHold.create({
        data: {
          orgId,
          itemId,
          locationId,
          qty,
          reason,
          note,
          createdByUserId: req.user?.id || null,
        },
        include: {
          item: { select: { id: true, name: true, sku: true, unit: true } },
          location: {
            select: { id: true, code: true, name: true, zone: true, aisle: true, rack: true, level: true },
          },
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });
    });

    scheduleAutoReorderCheck(created.itemId);
    res.status(201).json({ ok: true, hold: created });
  } catch (err) {
    if (err.code === "ITEM_NOT_FOUND") {
      return res.status(404).json({ message: "\u0422\u043e\u0432\u0430\u0440 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d." });
    }
    if (err.code === "LOCATION_NOT_FOUND") {
      return res.status(404).json({ message: "\u042f\u0447\u0435\u0439\u043a\u0430 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430." });
    }
    if (err.code === "HOLD_EXCEEDS_AVAILABLE") {
      return res.status(409).json({
        message: "\u041d\u0435\u0434\u043e\u0441\u0442\u0430\u0442\u043e\u0447\u043d\u043e \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e\u0433\u043e \u043e\u0441\u0442\u0430\u0442\u043a\u0430 \u0434\u043b\u044f \u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u043a\u0438.",
        detail: err.detail || null,
      });
    }
    console.error("warehouse hold create error:", err);
    res.status(500).json({ message: "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u043a\u0438 \u043e\u0441\u0442\u0430\u0442\u043a\u0430." });
  }
});

app.post("/api/warehouse/holds/:id/release", auth, async (req, res) => {
  try {
    const orgId = req.user?.orgId || null;
    const id = Number(req.params.id);
    const releaseNote = req.body?.note ? String(req.body.note).trim() : null;

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 ID \u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u043a\u0438." });
    }

    const hold = await prisma.stockHold.findFirst({ where: { id, orgId } });
    if (!hold) {
      return res.status(404).json({ message: "\u0411\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u043a\u0430 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430." });
    }
    if (hold.status !== "ACTIVE") {
      return res.status(409).json({ message: "\u0411\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u043a\u0430 \u0443\u0436\u0435 \u0441\u043d\u044f\u0442\u0430." });
    }

    const updated = await prisma.stockHold.update({
      where: { id },
      data: {
        status: "RELEASED",
        releasedAt: new Date(),
        releasedByUserId: req.user?.id || null,
        releaseNote,
      },
      include: {
        item: { select: { id: true, name: true, sku: true, unit: true } },
        location: {
          select: { id: true, code: true, name: true, zone: true, aisle: true, rack: true, level: true },
        },
        createdBy: { select: { id: true, name: true, email: true } },
        releasedBy: { select: { id: true, name: true, email: true } },
      },
    });

    scheduleAutoReorderCheck(updated.itemId);
    res.json({ ok: true, hold: updated });
  } catch (err) {
    console.error("warehouse hold release error:", err);
    res.status(500).json({ message: "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u043d\u044f\u0442\u0438\u044f \u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u043a\u0438 \u043e\u0441\u0442\u0430\u0442\u043a\u0430." });
  }
});
app.get("/api/warehouse/stock/item/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_ITEM_ID" });
    }

    const item = await prisma.item.findUnique({ where: { id } });
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
      include: { movements: true, stockHolds: { where: { status: "ACTIVE" } } },
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
      // B: Артикул
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
        if (raw == null || String(raw).trim() === "") return 0;
        if (typeof raw === "number") return raw;
        const n = Number(String(raw).replace(",", "."));
        return Number.isFinite(n) ? n : 0;
      };
      const toOptionalNumber = (raw) => {
        if (raw == null || String(raw).trim() === "") return null;
        if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
        const n = Number(String(raw).replace(",", "."));
        return Number.isFinite(n) ? n : null;
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
        let defaultPrice = toOptionalNumber(row.getCell(10).value);

        console.log(`Row ${rowNumber}: Артикул=${sku}, Мин=${minStock}, Макс=${maxStock}, Цена=${defaultPrice}`);

        // Если строка совсем пустая — пропускаем
        if (!name && !sku && !barcode) {
          skipped++;
          continue;
        }

        // Без имени или артикула — пропускаем (как и в API создания товара)
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
        if (defaultPrice !== null && (!Number.isFinite(defaultPrice) || defaultPrice < 0)) {
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
          // Ищем по артикулу (он уникальный)
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
        errors.push({ row: item.row, error: "Нет имени или артикула" });
        continue;
      }

      const hasDefaultPrice =
        item.defaultPrice !== undefined &&
        item.defaultPrice !== null &&
        String(item.defaultPrice).trim() !== "";
      const parsedDefaultPrice = hasDefaultPrice
        ? Number(String(item.defaultPrice).replace(",", "."))
        : null;
      if (hasDefaultPrice && (!Number.isFinite(parsedDefaultPrice) || parsedDefaultPrice < 0)) {
        errors.push({ row: item.row, error: "Некорректная цена (должна быть 0 и больше)" });
        continue;
      }

      const data = {
        name: String(item.name).trim(),
        sku: String(item.sku).trim(),
        barcode: item.barcode ? String(item.barcode).trim() : null,
        unit: item.unit ? String(item.unit).trim() : "шт",
        minStock: item.minStock ? Number(item.minStock) : 0,
        maxStock: item.maxStock ? Number(item.maxStock) : 0,
        defaultPrice: parsedDefaultPrice,
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

    scheduleAutoReorderCheck(movement.itemId);
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

function buildPurchasePriceUpdates(rows = [], { onlyReceived = false } = {}) {
  const latestByItemId = new Map();
  for (const row of rows) {
    const itemId = Number(row?.itemId);
    const price = Number(row?.price);
    if (!itemId || Number.isNaN(itemId)) continue;
    if (!Number.isFinite(price) || price < 0) continue;
    if (onlyReceived) {
      const receivedQty = Number(row?.receivedQty) || 0;
      if (receivedQty <= 0) continue;
    }
    latestByItemId.set(itemId, price);
  }
  return Array.from(latestByItemId.entries()).map(([itemId, price]) => ({
    itemId,
    price,
  }));
}

async function applyPurchasePriceUpdates(db, updates = [], orgId = null) {
  if (!Array.isArray(updates) || updates.length === 0) return;
  for (const update of updates) {
    const itemId = Number(update?.itemId);
    const price = Number(update?.price);
    if (!itemId || Number.isNaN(itemId)) continue;
    if (!Number.isFinite(price) || price < 0) continue;
    const where =
      orgId === null || orgId === undefined
        ? { id: itemId }
        : { id: itemId, orgId };
    await db.item.updateMany({
      where,
      data: { defaultPrice: price },
    });
  }
}

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

    await applyPurchasePriceUpdates(
      prisma,
      buildPurchasePriceUpdates(preparedItems),
      req.user.orgId || null
    );

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
          receivingStage: order.receivingStage,
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

    const updatedOrder = await prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        receivingStage:
          order.receivingStage === "FINALIZED" ? "FINALIZED" : "IN_PROGRESS",
      },
      include: { supplier: true },
    });


    res.json({
      ok: true,
      order: {
        id: updatedOrder.id,
        number: updatedOrder.number,
        status: updatedOrder.status,
        receivingStage: updatedOrder.receivingStage,
        supplier: updatedOrder.supplier
          ? { id: updatedOrder.supplier.id, name: updatedOrder.supplier.name }
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
      return res.status(403).json({ message: "\u041d\u0435\u0442 \u043f\u0440\u0430\u0432" });
    }

    const id = Number(req.params.id);
    const { status, sendEmail, emailTo, emailMessage } = req.body || {};

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "\u041d\u0435\u043a\u043e\u0440\u0440\u0435\u043a\u0442\u043d\u044b\u0439 ID \u0437\u0430\u043a\u0430\u0437\u0430" });
    }

    const allowedStatuses = ["DRAFT", "SENT", "PARTIAL", "RECEIVED", "CLOSED"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "\u041d\u0435\u0434\u043e\u043f\u0443\u0441\u0442\u0438\u043c\u044b\u0439 \u0441\u0442\u0430\u0442\u0443\u0441 \u0437\u0430\u043a\u0430\u0437\u0430" });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: {
          include: {
            item: {
              select: {
                id: true,
                name: true,
                sku: true,
                unit: true,
                autoReorderContactEmail: true,
                autoReorderMessage: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "\u0417\u0430\u043a\u0430\u0437 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d" });
    }

    if (status === "SENT" && ["RECEIVED", "CLOSED"].includes(order.status)) {
      return res.status(409).json({
        message: "\u041d\u0435\u043b\u044c\u0437\u044f \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443 \u0437\u0430\u043a\u0430\u0437 \u0441\u043e \u0441\u0442\u0430\u0442\u0443\u0441\u043e\u043c \u041f\u043e\u043b\u0443\u0447\u0435\u043d/\u0417\u0430\u043a\u0440\u044b\u0442",
      });
    }

    let emailResult = null;
    if (status === "SENT") {
      const orgProfile = await prisma.orgProfile.findFirst({
        where: { orgId: order.orgId || req.user.orgId || null },
        select: { purchaseOrderEmailTemplate: true },
      });
      const shouldSendEmail = sendEmail !== false;
      const preferredItem = (order.items || []).find(
        (row) => row?.item?.autoReorderContactEmail || row?.item?.autoReorderMessage
      );
      const recipient =
        String(emailTo || "").trim() ||
        String(preferredItem?.item?.autoReorderContactEmail || "").trim() ||
        String(order.supplier?.email || "").trim() ||
        null;

      const subject = `\u0417\u0430\u043a\u0430\u0437 \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443 ${order.number || `#${order.id}`}`;
      const text =
        String(emailMessage || "").trim() ||
        String(preferredItem?.item?.autoReorderMessage || "").trim() ||
        buildPurchaseOrderEmailText(
          order,
          orgProfile?.purchaseOrderEmailTemplate || null
        );

      if (!shouldSendEmail) {
        emailResult = {
          emailSent: false,
          emailRecipient: recipient,
          emailSkippedReason: "Email-\u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 \u043e\u0442\u043a\u043b\u044e\u0447\u0435\u043d\u0430 \u0432\u0440\u0443\u0447\u043d\u0443\u044e",
          emailError: null,
        };
      } else if (!recipient) {
        emailResult = {
          emailSent: false,
          emailRecipient: null,
          emailSkippedReason: "\u0423 \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0430 \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d email \u0434\u043b\u044f \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438",
          emailError: null,
        };
      } else {
        const sent = await sendAutoReorderEmail({
          to: recipient,
          subject,
          text,
        });

        emailResult = {
          emailSent: sent?.sent === true,
          emailRecipient: recipient,
          emailSkippedReason: sent?.sent === true ? null : "\u041e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 \u043d\u0435 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0430",
          emailError: sent?.error || null,
        };
      }
    }

    const touchedAutoReorderItemIds = new Set();

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
          message: "\u042d\u0442\u043e\u0442 \u0437\u0430\u043a\u0430\u0437 \u0443\u0436\u0435 \u043f\u0440\u043e\u0432\u0435\u0434\u0451\u043d \u043f\u043e \u0441\u043a\u043b\u0430\u0434\u0443",
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
            comment: `\u041f\u0440\u0438\u0445\u043e\u0434 \u043f\u043e \u0437\u0430\u043a\u0430\u0437\u0443 \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0443 ${order.number} [PO#${order.id}]`,
            createdById: req.user.id,
          },
        });
        touchedAutoReorderItemIds.add(Number(row.itemId));
      }

      await applyPurchasePriceUpdates(
        prisma,
        buildPurchasePriceUpdates(order.items),
        order.orgId || req.user.orgId || null
      );

      scheduleAutoReorderChecks(Array.from(touchedAutoReorderItemIds.values()));
    }

    const nextReceivingStage =
      status === "RECEIVED" || status === "CLOSED"
        ? "FINALIZED"
        : status === "PARTIAL"
          ? "CONFIRMED"
          : "NEW";

    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: { status, receivingStage: nextReceivingStage },
      include: {
        supplier: true,
        items: {
          include: { item: true },
        },
      },
    });

    if (status === "SENT") {
      return res.json({ ...updated, ...emailResult });
    }

    res.json(updated);
  } catch (err) {
    console.error("update purchase order status error:", err);
    res
      .status(500)
      .json({ message: "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0440\u0432\u0435\u0440\u0430 \u043f\u0440\u0438 \u0441\u043c\u0435\u043d\u0435 \u0441\u0442\u0430\u0442\u0443\u0441\u0430 \u0437\u0430\u043a\u0430\u0437\u0430" });
  }
});
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
    const priceUpdatesByItemId = new Map();
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
        const price = Number(row.price);
        if (Number.isFinite(price) && price >= 0) {
          priceUpdatesByItemId.set(row.itemId, price);
        }
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
      scheduleAutoReorderChecks(
        movementsData.map((row) => Number(row.itemId)).filter((value) => Number.isFinite(value) && value > 0)
      );
    }

    await applyPurchasePriceUpdates(
      prisma,
      Array.from(priceUpdatesByItemId.entries()).map(([itemId, price]) => ({
        itemId,
        price,
      })),
      order.orgId || req.user.orgId || null
    );

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
      data: {
        status: nextStatus,
        receivingStage: nextStatus === "RECEIVED" ? "FINALIZED" : "CONFIRMED",
      },
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
        where: { orderId: poId, orgId: effectiveOrgId },
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
      location = await getOrCreateReceivingLocation(effectiveOrgId);
    }

    const orderItemsByItemId = new Map();
    (fullOrderItems.length ? fullOrderItems : order.items).forEach((row) => {
      orderItemsByItemId.set(row.itemId, row);
    });

    const createdDiscrepancies = [];
    const movementIds = [];

    await prisma.$transaction(async (tx) => {
      const priceUpdatesByItemId = new Map();
      for (const line of lines) {
        const itemId = Number(line.productId ?? line.itemId);
        const qty = Number(line.qty);
        const qtyInt = Math.trunc(qty);
        if (!itemId || !Number.isFinite(qty) || qtyInt <= 0) continue;

        const lineOpId = opId ? `${opId}:${itemId}` : null;
        if (lineOpId) {
          const existing = await tx.stockMovement.findFirst({
            where: {
              opId: lineOpId,
              orgId: effectiveOrgId,
            },
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
          comment: `Приход по заказу ${order.number} [PO#${order.id}]`,
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
              where: { id: orderRow.id, orgId: effectiveOrgId },
              data: { receivedQty: nextReceived, orgId: effectiveOrgId },
            })
          );

          const price = Number(orderRow.price);
          if (Number.isFinite(price) && price >= 0) {
            priceUpdatesByItemId.set(itemId, price);
          }

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

      await applyPurchasePriceUpdates(
        tx,
        Array.from(priceUpdatesByItemId.entries()).map(([itemId, price]) => ({
          itemId,
          price,
        })),
        effectiveOrgId
      );

      await runWithoutTenantScope(() =>
        tx.purchaseOrder.updateMany({
          where: {
            id: poId,
            orgId: effectiveOrgId,
            receivingStage: { not: "FINALIZED" },
          },
          data: {
            receivingStage: "CONFIRMED",
            orgId: effectiveOrgId,
          },
        })
      );
      if (createdDiscrepancies.length > 0) {
        await tx.receivingDiscrepancy.findMany({
          where: { id: { in: createdDiscrepancies } },
        });
      }
    });
    let updatedOrder = null;
    try {
      updatedOrder = await runWithoutTenantScope(() =>
        prismaBase.purchaseOrder.findFirst({
          where: { id: poId, orgId: effectiveOrgId },
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
      const refreshed = await tx.purchaseOrder.findUnique({
        where: { id: poId },
        include: { items: true },
      });
      if (!refreshed) return;

      const priceUpdatesByItemId = new Map();
      for (const row of refreshed.items || []) {
        const ordered = Number(row.quantity) || 0;
        const received = Number(row.receivedQty) || 0;
        const price = Number(row.price);
        if (received > 0 && Number.isFinite(price) && price >= 0) {
          priceUpdatesByItemId.set(row.itemId, price);
        }
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

      await applyPurchasePriceUpdates(
        tx,
        Array.from(priceUpdatesByItemId.entries()).map(([itemId, price]) => ({
          itemId,
          price,
        })),
        effectiveOrgId
      );

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

      if (
        nextStatus !== refreshed.status ||
        !refreshed.orgId ||
        refreshed.receivingStage !== "FINALIZED"
      ) {
        await runWithoutTenantScope(() =>
          tx.purchaseOrder.updateMany({
            where: { id: poId, orgId: effectiveOrgId },
            data: {
              status: nextStatus,
              orgId: effectiveOrgId,
              receivingStage: "FINALIZED",
            },
          })
        );
      }
    });

    const now = new Date();
    if (linkedTruck.status !== "DONE") {
      try {
        await runWithoutTenantScope(() =>
          prismaBase.supplierTruck.updateMany({
            where: { id: linkedTruck.id, orgId: linkedTruck.orgId || effectiveOrgId, status: { not: "DONE" } },
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

    const updatedOrder = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        supplier: true,
        items: { include: { item: true } },
      },
    });

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
      return res.status(403).json({ message: "Нет доступа." });
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
      return res.status(400).json({ message: "Заполните номер заказа, получателя и адрес." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Добавьте позиции заказа." });
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
      return res.status(400).json({ message: "Добавьте позиции заказа." });
    }

    const result = await prisma.$transaction(async (tx) => {
      if (externalOrderId) {
        const existing = await tx.salesOrder.findFirst({
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
      return res.status(409).json({ message: "Заказ уже в работе или закрыт." });
    }
    console.error("orders inbound error:", err);
    res.status(500).json({ message: "Ошибка создания заказа." });
  }
});

// ===== INTEGRATION: ORDERS INBOUND (API KEY) =====
app.post("/api/integrations/orders/inbound", async (req, res) => {
  try {
    const apiKey = req.headers["x-api-key"] || req.headers["X-Api-Key"];
    if (!apiKey) {
      return res.status(401).json({ message: "Укажите API-ключ интеграции." });
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
      return res.status(401).json({ message: "Ключ интеграции не найден." });
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
      return res.status(400).json({ message: "Заполните номер заказа, получателя и адрес." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Добавьте позиции заказа." });
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
      return res.status(400).json({ message: "Добавьте позиции заказа." });
    }

    const result = await prisma.$transaction(async (tx) => {
      if (externalOrderId) {
        const existing = await tx.salesOrder.findFirst({
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
      return res.status(409).json({ message: "Заказ уже в работе или закрыт." });
    }
    console.error("integration inbound error:", err);
    res.status(500).json({ message: "Ошибка создания заказа." });
  }
});

// ===== ADMIN: ORDERS IMPORT (JSON BATCH) =====
app.post("/api/orders/import-batch", auth, requireAdmin, async (req, res) => {
  try {
    const { orders } = req.body || {};
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ message: "Передайте массив заказов." });
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
        errors.push({ row: i + 1, error: "Заполните номер заказа, получателя и адрес." });
        continue;
      }
      if (!Array.isArray(items) || items.length === 0) {
        errors.push({ row: i + 1, error: "Добавьте позиции заказа." });
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
        errors.push({ row: i + 1, error: "Не удалось распознать товары заказа." });
        continue;
      }

      try {
        const result = await prisma.$transaction(async (tx) => {
          if (externalOrderId) {
            const existing = await tx.salesOrder.findFirst({
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
          errors.push({ row: i + 1, error: "Заказ уже в работе или закрыт." });
        } else {
          errors.push({ row: i + 1, error: "Ошибка обработки заказа." });
          console.error("orders import row error:", err);
        }
      }
    }

    res.json({ created, updated, errors });
  } catch (err) {
    console.error("orders import error:", err);
    res.status(500).json({ message: "Ошибка импорта заказов." });
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
      return res.status(400).json({ message: "Нет товаров для создания теста." });
    }

    const orderNumber = `TEST-${Date.now()}`;
    const created = await prisma.salesOrder.create({
      data: {
        source: "TEST",
        orderNumber,
        customerName: "Тестовый покупатель",
        customerPhone: null,
        shippingAddress: "Тестовый адрес",
        deliveryComment: "Тестовый заказ",
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
    res.status(500).json({ message: "Ошибка создания тестового заказа." });
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
    res.status(500).json({ message: "Ошибка работы с API-ключом интеграции." });
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
    res.status(500).json({ message: "Ошибка работы с API-ключом интеграции." });
  }
});

const ADMIN_SHORTAGE_CLOSE_PREFIX = "[ADMIN_SHORTAGE_CLOSE]";

function parseAdminShortageMetaFromComment(commentValue) {
  const comment = String(commentValue || "");
  if (!comment) {
    return { baseComment: "", meta: null };
  }

  const lines = comment.split(/\r?\n/);
  const baseLines = [];
  let meta = null;

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line.startsWith(ADMIN_SHORTAGE_CLOSE_PREFIX)) {
      baseLines.push(rawLine);
      continue;
    }

    const jsonPart = line.slice(ADMIN_SHORTAGE_CLOSE_PREFIX.length).trim();
    if (!jsonPart) continue;

    try {
      meta = JSON.parse(jsonPart);
    } catch (err) {
      meta = null;
    }
  }

  return {
    baseComment: baseLines.join("\n").trim(),
    meta,
  };
}

function buildAdminShortageMetaLine(payload = {}) {
  return `${ADMIN_SHORTAGE_CLOSE_PREFIX}${JSON.stringify(payload)}`;
}

function parseSalesOrderStatusesCsv(value) {
  const statuses = String(value || "")
    .split(",")
    .map((entry) => String(entry || "").trim().toUpperCase())
    .filter(Boolean);
  return Array.from(new Set(statuses));
}

function sanitizeOptionalText(value, maxLength = 255) {
  if (value == null) return null;
  const textValue = String(value).trim();
  if (!textValue) return null;
  return textValue.slice(0, maxLength);
}

function buildOrderStatusHistoryMeta(payload = {}) {
  const entries = Object.entries(payload).filter(([, value]) => {
    if (value == null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    return true;
  });
  if (!entries.length) return null;
  return Object.fromEntries(entries);
}

async function writeOrderStatusHistory(tx, {
  orderId,
  orgId = null,
  fromStatus = null,
  toStatus,
  eventType,
  actorUserId = null,
  metaJson = null,
}) {
  if (!orderId || !toStatus || !eventType) return null;
  return tx.orderStatusHistory.create({
    data: {
      orderId,
      orgId: orgId || null,
      fromStatus: fromStatus || null,
      toStatus,
      eventType,
      actorUserId: actorUserId || null,
      metaJson: metaJson || null,
    },
  });
}
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
    res.status(500).json({ message: "Ошибка загрузки очереди заказов." });
  }
});

app.get("/api/orders/status-history", auth, async (req, res) => {
  try {
    const orderId = Number(req.query.orderId || 0);
    const actorUserId = Number(req.query.actorUserId || 0);
    const statusFilter = parseSalesOrderStatusesCsv(req.query.toStatus);
    const fromDate = parseDateInput(req.query.fromDate);
    const toDate = parseDateInput(req.query.toDate);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const where = {};
    if (orderId > 0) where.orderId = orderId;
    if (actorUserId > 0) where.actorUserId = actorUserId;
    if (statusFilter.length === 1) {
      where.toStatus = statusFilter[0];
    } else if (statusFilter.length > 1) {
      where.toStatus = { in: statusFilter };
    }
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lte = toDate;
    }

    const [total, events] = await Promise.all([
      prisma.orderStatusHistory.count({ where }),
      prisma.orderStatusHistory.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: limit,
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              customerName: true,
              status: true,
            },
          },
          actorUser: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
    ]);

    res.json({
      items: events,
      page,
      limit,
      total,
    });
  } catch (err) {
    console.error("orders status history list error:", err);
    res.status(500).json({ message: "ORDER_STATUS_HISTORY_LIST_ERROR" });
  }
});

app.get("/api/orders/:id/status-history", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_ORDER_ID" });
    }

    const order = await prisma.salesOrder.findUnique({
      where: { id },
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        status: true,
      },
    });
    if (!order) {
      return res.status(404).json({ message: "ORDER_NOT_FOUND" });
    }

    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const items = await prisma.orderStatusHistory.findMany({
      where: { orderId: id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
      include: {
        actorUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.json({ order, items });
  } catch (err) {
    console.error("orders status history by order error:", err);
    res.status(500).json({ message: "ORDER_STATUS_HISTORY_BY_ORDER_ERROR" });
  }
});


app.get("/api/orders/admin-shortage-candidates", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }

    const orders = await prisma.salesOrder.findMany({
      where: {
        status: { in: ["NEW", "IN_PICKING", "PICKED", "PACKED"] },
      },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      include: {
        assignedToUser: { select: { id: true, name: true, email: true } },
        lines: {
          select: {
            id: true,
            qty: true,
            pickedQty: true,
          },
        },
        pickSkips: {
          where: { status: "ACTIVE" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            lineId: true,
            itemId: true,
            locationId: true,
            qty: true,
            reason: true,
            comment: true,
            createdAt: true,
            skippedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
      take: 200,
    });

    const items = orders
      .map((order) => {
        const remainingQty = (order.lines || []).reduce((sum, line) => {
          const lineRemaining = Math.max(
            0,
            (Number(line.qty) || 0) - (Number(line.pickedQty) || 0)
          );
          return sum + lineRemaining;
        }, 0);

        return {
          ...order,
          activeSkipCount: (order.pickSkips || []).length,
          remainingQty,
        };
      })
      .filter((order) => order.activeSkipCount > 0);

    res.json({ items });
  } catch (err) {
    console.error("orders admin shortage candidates error:", err);
    res.status(500).json({ message: "ORDER_SHORTAGE_CANDIDATES_ERROR" });
  }
});

app.post("/api/orders/:id/admin-close-shortage", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }

    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_ORDER_ID" });
    }

    const reason = String(req.body?.reason || "").trim();
    if (!reason) {
      return res.status(400).json({ message: "CLOSE_REASON_REQUIRED" });
    }
    if (reason.length > 500) {
      return res.status(400).json({ message: "CLOSE_REASON_TOO_LONG" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUnique({
        where: { id },
        include: {
          assignedToUser: { select: { id: true, name: true, email: true } },
          lines: { include: { item: true }, orderBy: { id: "asc" } },
        },
      });
      if (!order) {
        const err = new Error("ORDER_NOT_FOUND");
        err.code = "ORDER_NOT_FOUND";
        throw err;
      }

      if (["READY_TO_SHIP", "SHIPPED", "CANCELLED"].includes(order.status)) {
        const err = new Error("ORDER_SHORTAGE_BAD_STATUS");
        err.code = "ORDER_SHORTAGE_BAD_STATUS";
        throw err;
      }

      const activeSkipCount = await tx.salesOrderPickSkip.count({
        where: {
          orderId: id,
          status: "ACTIVE",
        },
      });
      if (!activeSkipCount) {
        const err = new Error("ORDER_NO_ACTIVE_SKIPS");
        err.code = "ORDER_NO_ACTIVE_SKIPS";
        throw err;
      }

      const parsed = parseAdminShortageMetaFromComment(order.deliveryComment);
      const closeMeta = {
        closedAt: new Date().toISOString(),
        closedById: req.user?.id || null,
        closedByName: req.user?.name || "",
        closedByEmail: req.user?.email || "",
        reason,
      };
      const nextComment = [
        parsed.baseComment,
        buildAdminShortageMetaLine(closeMeta),
      ]
        .filter(Boolean)
        .join("\n")
        .trim();

      const updated = await tx.salesOrder.update({
        where: { id },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
          deliveryComment: nextComment,
        },
        include: {
          assignedToUser: { select: { id: true, name: true, email: true } },
          lines: { include: { item: true }, orderBy: { id: "asc" } },
        },
      });

      return {
        order: updated,
        activeSkipCount,
        closeMeta,
      };
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.code === "ORDER_NOT_FOUND") {
      return res.status(404).json({ message: "ORDER_NOT_FOUND" });
    }
    if (err.code === "ORDER_SHORTAGE_BAD_STATUS") {
      return res.status(400).json({ message: "ORDER_SHORTAGE_BAD_STATUS" });
    }
    if (err.code === "ORDER_NO_ACTIVE_SKIPS") {
      return res.status(409).json({ message: "ORDER_NO_ACTIVE_SKIPS" });
    }

    console.error("orders admin close shortage error:", err);
    res.status(500).json({ message: "ORDER_ADMIN_CLOSE_ERROR" });
  }
});

app.get("/api/orders/admin-shortage-journal", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500)
      : 100;

    const orders = await prisma.salesOrder.findMany({
      where: {
        status: "CANCELLED",
      },
      orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      include: {
        assignedToUser: { select: { id: true, name: true, email: true } },
        lines: {
          select: {
            id: true,
            qty: true,
            pickedQty: true,
          },
        },
        pickSkips: {
          where: { status: "ACTIVE" },
          select: {
            id: true,
            lineId: true,
            reason: true,
            comment: true,
            qty: true,
            createdAt: true,
          },
        },
      },
      take: limit,
    });

    const items = orders
      .map((order) => {
        const parsed = parseAdminShortageMetaFromComment(order.deliveryComment);
        if (!parsed.meta) return null;

        const totalQty = (order.lines || []).reduce(
          (sum, line) => sum + (Number(line.qty) || 0),
          0
        );
        const pickedQty = (order.lines || []).reduce(
          (sum, line) => sum + (Number(line.pickedQty) || 0),
          0
        );

        return {
          id: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          shippingAddress: order.shippingAddress,
          status: order.status,
          completedAt: order.completedAt,
          createdAt: order.createdAt,
          closeMeta: parsed.meta,
          remainingQty: Math.max(0, totalQty - pickedQty),
          totalQty,
          pickedQty,
          activeSkipCount: (order.pickSkips || []).length,
          assignedToUser: order.assignedToUser,
        };
      })
      .filter(Boolean);

    res.json({ items });
  } catch (err) {
    console.error("orders admin shortage journal error:", err);
    res.status(500).json({ message: "ORDER_SHORTAGE_JOURNAL_ERROR" });
  }
});
app.get("/api/orders/admin-picking-journal", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500)
      : 200;

    const statusFilter = String(
      req.query.status || "NEW,IN_PICKING,PICKED,PACKED,READY_TO_SHIP,SHIPPED,CANCELLED"
    )
      .split(",")
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    const orders = await prisma.salesOrder.findMany({
      where: {
        status: { in: statusFilter },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: {
        assignedToUser: { select: { id: true, name: true, email: true } },
        lines: {
          select: {
            id: true,
            qty: true,
            pickedQty: true,
          },
        },
      },
      take: limit,
    });

    const items = orders.map((order) => {
      const parsed = parseAdminShortageMetaFromComment(order.deliveryComment);
      const totalQty = (order.lines || []).reduce(
        (sum, line) => sum + (Number(line.qty) || 0),
        0
      );
      const pickedQty = (order.lines || []).reduce(
        (sum, line) => sum + (Number(line.pickedQty) || 0),
        0
      );

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        shippingAddress: order.shippingAddress,
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        takenAt: order.takenAt,
        pickedAt: order.pickedAt,
        packedAt: order.packedAt,
        completedAt: order.completedAt,
        assignedToUser: order.assignedToUser,
        totalQty,
        pickedQty,
        remainingQty: Math.max(0, totalQty - pickedQty),
        closeMeta: parsed.meta || null,
      };
    });

    res.json({ items });
  } catch (err) {
    console.error("orders admin picking journal error:", err);
    res.status(500).json({ message: "ORDER_PICKING_JOURNAL_ERROR" });
  }
});
app.get("/api/orders/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_ORDER_ID" });
    }

    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: {
        assignedToUser: { select: { id: true, name: true, email: true } },
        passportPrintedBy: { select: { id: true, name: true, email: true } },
        shippedBy: { select: { id: true, name: true, email: true } },
        lines: { include: { item: true }, orderBy: { id: "asc" } },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "ORDER_NOT_FOUND" });
    }

    res.json({ order });
  } catch (err) {
    console.error("orders get by id error:", err);
    res.status(500).json({ message: "ORDER_GET_ERROR" });
  }
});

app.get("/api/orders/:id/pick-skips", auth, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    if (!orderId || Number.isNaN(orderId)) {
      return res.status(400).json({ message: "Некорректный ID заказа." });
    }

    const order = await prisma.salesOrder.findUnique({
      where: { id: orderId },
      select: { id: true, assignedToUserId: true },
    });
    if (!order) {
      return res.status(404).json({ message: "Заказ не найден." });
    }

    if (
      order.assignedToUserId &&
      order.assignedToUserId !== req.user.id &&
      !isWarehouseManager(req.user)
    ) {
      return res.status(403).json({ message: "Заказ закреплен за другим сотрудником." });
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
    res.status(500).json({ message: "Ошибка при получении пропусков подбора." });
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
      return res.status(400).json({ message: "Некорректный ID заказа." });
    }
    if (!lineId || Number.isNaN(lineId)) {
      return res.status(400).json({ message: "Некорректная строка заказа." });
    }
    if (!reason) {
      return res.status(400).json({ message: "Укажите причину пропуска." });
    }
    if (reason.length > 180) {
      return res.status(400).json({ message: "Причина слишком длинная (максимум 180 символов)." });
    }
    if (comment.length > 500) {
      return res.status(400).json({ message: "Комментарий слишком длинный (максимум 500 символов)." });
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
      return res.status(400).json({ message: "Некорректная ячейка." });
    }
    if (itemId !== null && (!itemId || Number.isNaN(itemId))) {
      return res.status(400).json({ message: "Некорректный товар." });
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
      return res.status(404).json({ message: "Заказ не найден." });
    }
    if (err.code === "LINE_NOT_FOUND") {
      return res.status(404).json({ message: "Строка заказа не найдена." });
    }
    if (err.code === "ITEM_MISMATCH") {
      return res.status(400).json({ message: "Товар не соответствует строке заказа." });
    }
    if (err.code === "NOT_ASSIGNED_TO_YOU") {
      return res.status(403).json({ message: "Заказ закреплен за другим сотрудником." });
    }
    if (err.code === "BAD_STATUS") {
      return res.status(400).json({ message: "Заказ нельзя менять в текущем статусе." });
    }
    console.error("orders pick skip create error:", err);
    res.status(500).json({ message: "Ошибка сохранения пропуска." });
  }
});

app.post("/api/orders/:id/pick-skips/:skipId/restore", auth, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    const skipId = Number(req.params.skipId);
    if (!orderId || Number.isNaN(orderId) || !skipId || Number.isNaN(skipId)) {
      return res.status(400).json({ message: "Некорректные параметры." });
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
      return res.status(404).json({ message: "Заказ не найден." });
    }
    if (err.code === "SKIP_NOT_FOUND") {
      return res.status(404).json({ message: "Пропуск не найден." });
    }
    if (err.code === "NOT_ASSIGNED_TO_YOU") {
      return res.status(403).json({ message: "Заказ закреплен за другим сотрудником." });
    }
    console.error("orders pick skip restore error:", err);
    res.status(500).json({ message: "Ошибка восстановления пропуска." });
  }
});

app.post("/api/orders/:id/pick-skips/restore-all", auth, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    if (!orderId || Number.isNaN(orderId)) {
      return res.status(400).json({ message: "Некорректный ID заказа." });
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
      return res.status(404).json({ message: "Заказ не найден." });
    }
    if (err.code === "NOT_ASSIGNED_TO_YOU") {
      return res.status(403).json({ message: "Заказ закреплен за другим сотрудником." });
    }
    console.error("orders pick skip restore all error:", err);
    res.status(500).json({ message: "Ошибка восстановления пропусков." });
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
      return res.status(400).json({ message: "Некорректный ID заказа." });
    }
    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: { assignedToUser: { select: { id: true } } },
    });
    if (!order) return res.status(404).json({ message: "Заказ не найден." });
    if (order.assignedToUserId && order.assignedToUserId !== req.user.id) {
      return res.status(403).json({ message: "Заказ закреплен за другим сотрудником." });
    }

    const plan = await buildOrderPickPlan(id);
    res.json({ items: plan || [] });
  } catch (err) {
    console.error("orders pick plan error:", err);
    res.status(500).json({ message: "Ошибка формирования плана подбора." });
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
      return res.status(400).json({ message: "Некорректные параметры подтверждения." });
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
            comment: `Синхронизация остатка перед подбором заказа ${order.orderNumber}`,
            refType: "ORDER",
            refId: String(orderId),
            userId: req.user?.id || null,
          });
        }
      }

      const holdQty = await getActiveHoldQtyForLocation(tx, actualItemId, location);
      const locationQtyAfterSync = await stockService.getItemLocationQty(
        tx,
        actualItemId,
        location
      );
      const locationAvailableQty = Math.max(
        0,
        (Number(locationQtyAfterSync) || 0) - holdQty
      );
      if (locationAvailableQty < amount) {
        const err = new Error("HOLD_QTY_BLOCKED");
        err.code = "HOLD_QTY_BLOCKED";
        err.detail = {
          holdQty,
          locationQty: Number(locationQtyAfterSync) || 0,
          availableQty: locationAvailableQty,
        };
        throw err;
      }

      await stockService.createMovementInTx(tx, {
        opId: `ORDER:${orderId}:LINE:${line}:${Date.now()}`,
        type: "ISSUE",
        itemId: actualItemId,
        qty: amount,
        locationId: location,
        fromLocationId: location,
        comment: `Подбор по заказу ${order.orderNumber}`,
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
    if (err.code === "ORDER_NOT_FOUND") return res.status(404).json({ message: "Заказ не найден." });
    if (err.code === "LINE_NOT_FOUND") return res.status(404).json({ message: "Строка заказа не найдена." });
    if (err.code === "NOT_ASSIGNED_TO_YOU") return res.status(403).json({ message: "Заказ закреплен за другим сотрудником." });
    if (err.code === "BAD_STATUS") return res.status(400).json({ message: "Заказ не в статусе подбора." });
    if (err.code === "QTY_EXCEEDS_REMAINING") return res.status(400).json({ message: "Количество превышает остаток по строке." });
    if (err.code === "LINE_ITEM_NOT_LINKED") return res.status(400).json({ message: "Строка заказа не связана с товаром." });
    if (err.code === "HOLD_QTY_BLOCKED") return res.status(409).json({ message: "\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0432 \u044f\u0447\u0435\u0439\u043a\u0435 \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d\u043e (Hold).", detail: err.detail || null });
    if (err.code === "INSUFFICIENT_QTY") return res.status(400).json({ message: "Недостаточно товара в ячейке." });
    console.error("orders pick confirm error:", err);
    res.status(500).json({ message: "Ошибка подтверждения подбора." });
  }
});


app.post("/api/orders/:id/pack", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { boxCode, boxType } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_ORDER_ID" });
    }
    if (!boxCode) {
      return res.status(400).json({ message: "BOX_CODE_REQUIRED" });
    }

    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!order) return res.status(404).json({ message: "ORDER_NOT_FOUND" });
    if (order.assignedToUserId && order.assignedToUserId !== req.user.id) {
      return res.status(403).json({ message: "NOT_ASSIGNED_TO_YOU" });
    }

    const allPicked = order.lines.every((row) => Number(row.pickedQty) >= Number(row.qty));
    if (!allPicked) {
      return res.status(400).json({ message: "ORDER_NOT_FULLY_PICKED" });
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
    res.status(500).json({ message: "ORDER_PACK_ERROR" });
  }
});

app.get("/api/orders/:id/label", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный ID заказа." });
    }
    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: {
        lines: { include: { item: true }, orderBy: { id: "asc" } },
      },
    });
    if (!order) return res.status(404).json({ message: "Заказ не найден." });
    if (order.assignedToUserId && order.assignedToUserId !== req.user.id && !isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Заказ закреплен за другим сотрудником." });
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
    res.status(500).json({ message: "Ошибка печати этикетки." });
  }
});

app.post("/api/orders/:id/complete", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_ORDER_ID" });
    }

    const order = await prisma.salesOrder.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!order) return res.status(404).json({ message: "ORDER_NOT_FOUND" });
    if (order.assignedToUserId && order.assignedToUserId !== req.user.id) {
      return res.status(403).json({ message: "NOT_ASSIGNED_TO_YOU" });
    }
    if (!["PICKED", "PACKED", "READY_TO_SHIP"].includes(order.status)) {
      return res.status(400).json({ message: "ORDER_BAD_STATUS" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.salesOrder.findUnique({ where: { id } });
      if (!current) {
        const err = new Error("ORDER_NOT_FOUND");
        err.code = "ORDER_NOT_FOUND";
        throw err;
      }

      const nextStatus = "READY_TO_SHIP";
      const fromStatus = current.status;

      const savedOrder = await tx.salesOrder.update({
        where: { id },
        data: {
          status: nextStatus,
          completedAt: new Date(),
        },
        include: {
          assignedToUser: { select: { id: true, name: true, email: true } },
          lines: { include: { item: true }, orderBy: { id: "asc" } },
        },
      });

      await tx.salesOrderPickSkip.updateMany({
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

      if (fromStatus !== nextStatus) {
        await writeOrderStatusHistory(tx, {
          orderId: id,
          orgId: savedOrder.orgId || req.user?.orgId || null,
          fromStatus,
          toStatus: nextStatus,
          eventType: "COMPLETE",
          actorUserId: req.user?.id || null,
        });
      }

      return savedOrder;
    });

    res.json({ ok: true, order: updated });
  } catch (err) {
    if (err.code === "ORDER_NOT_FOUND") {
      return res.status(404).json({ message: "ORDER_NOT_FOUND" });
    }
    console.error("orders complete error:", err);
    res.status(500).json({ message: "ORDER_COMPLETE_ERROR" });
  }
});

app.post("/api/orders/:id/ship", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_ORDER_ID" });
    }

    const carrier = sanitizeOptionalText(req.body?.carrier, 120);
    const trackingNumber = sanitizeOptionalText(req.body?.trackingNumber, 160);
    const notes = sanitizeOptionalText(req.body?.notes, 1000);
    const methodRaw = sanitizeOptionalText(req.body?.method, 32);
    const method = methodRaw ? methodRaw.toUpperCase() : null;

    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUnique({
        where: { id },
      });
      if (!order) {
        const err = new Error("ORDER_NOT_FOUND");
        err.code = "ORDER_NOT_FOUND";
        throw err;
      }

      if (order.status === "SHIPPED") {
        const err = new Error("ORDER_ALREADY_SHIPPED");
        err.code = "ORDER_ALREADY_SHIPPED";
        throw err;
      }

      if (order.status !== "READY_TO_SHIP") {
        const err = new Error("ORDER_BAD_STATUS");
        err.code = "ORDER_BAD_STATUS";
        throw err;
      }

      const now = new Date();
      const nextStatus = "SHIPPED";

      const savedOrder = await tx.salesOrder.update({
        where: { id },
        data: {
          status: nextStatus,
          shippedAt: now,
          shippedByUserId: req.user?.id || null,
          carrier,
          trackingNumber,
          shipNotes: notes,
        },
        include: {
          assignedToUser: { select: { id: true, name: true, email: true } },
          shippedBy: { select: { id: true, name: true, email: true } },
          lines: { include: { item: true }, orderBy: { id: "asc" } },
        },
      });

      await writeOrderStatusHistory(tx, {
        orderId: id,
        orgId: savedOrder.orgId || req.user?.orgId || null,
        fromStatus: order.status,
        toStatus: nextStatus,
        eventType: "SHIP",
        actorUserId: req.user?.id || null,
        metaJson: buildOrderStatusHistoryMeta({
          carrier,
          trackingNumber,
          notes,
          method,
        }),
      });

      return savedOrder;
    });

    res.json({ ok: true, order: updated });
  } catch (err) {
    if (err.code === "ORDER_NOT_FOUND") {
      return res.status(404).json({ message: "ORDER_NOT_FOUND" });
    }
    if (err.code === "ORDER_ALREADY_SHIPPED") {
      return res.status(409).json({ message: "ORDER_ALREADY_SHIPPED" });
    }
    if (err.code === "ORDER_BAD_STATUS") {
      return res.status(409).json({ message: "ORDER_BAD_STATUS" });
    }

    console.error("orders ship error:", err);
    res.status(500).json({ message: "ORDER_SHIP_ERROR" });
  }
});

app.post("/api/orders/:id/passport-printed", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Некорректный ID заказа." });
    }

    const order = await prisma.salesOrder.findUnique({
      where: { id },
    });
    if (!order) return res.status(404).json({ message: "Заказ не найден." });
    if (order.assignedToUserId && order.assignedToUserId !== req.user.id && !isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Заказ закреплен за другим сотрудником." });
    }
    if (!["PICKED", "PACKED", "READY_TO_SHIP", "SHIPPED"].includes(order.status)) {
      return res.status(400).json({ message: "Нельзя печатать паспорт в этом статусе заказа." });
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
    res.status(500).json({ message: "Ошибка отметки печати паспорта." });
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
    console.error("[DB ready check] ошибка:", err?.message || err);
    return false;
  }
}

const AUTO_REORDER_INTERVAL_MS = Number(
  process.env.AUTO_REORDER_INTERVAL_MS || 5 * 60 * 1000
);
const AUTO_REORDER_REMINDER_MS = Number(
  process.env.AUTO_REORDER_REMINDER_MS || 24 * 60 * 60 * 1000
);
const AUTO_REORDER_EVENT_DEBOUNCE_MS = Math.max(
  250,
  Number(process.env.AUTO_REORDER_EVENT_DEBOUNCE_MS || 1200)
);
const autoReorderPendingItemIds = new Set();
let autoReorderEventTimer = null;
let autoReorderEventRunning = false;
let autoReorderEventRerun = false;

function scheduleAutoReorderCheck(itemId) {
  const id = Number(itemId);
  if (!id || Number.isNaN(id)) return;
  autoReorderPendingItemIds.add(id);
  if (autoReorderEventTimer) return;
  autoReorderEventTimer = setTimeout(() => {
    autoReorderEventTimer = null;
    flushAutoReorderQueue().catch((err) =>
      console.error("AUTO_REORDER_EVENT_FLUSH_ERROR:", err)
    );
  }, AUTO_REORDER_EVENT_DEBOUNCE_MS);
}

function scheduleAutoReorderChecks(itemIds = []) {
  for (const itemId of itemIds) {
    scheduleAutoReorderCheck(itemId);
  }
}

async function flushAutoReorderQueue() {
  if (autoReorderEventRunning) {
    autoReorderEventRerun = true;
    return;
  }

  const itemIds = Array.from(autoReorderPendingItemIds.values())
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  autoReorderPendingItemIds.clear();
  if (!itemIds.length) return;

  autoReorderEventRunning = true;
  try {
    await checkAutoReorders({ itemIds });
  } finally {
    autoReorderEventRunning = false;
    if (autoReorderEventRerun || autoReorderPendingItemIds.size > 0) {
      autoReorderEventRerun = false;
      if (!autoReorderEventTimer) {
        autoReorderEventTimer = setTimeout(() => {
          autoReorderEventTimer = null;
          flushAutoReorderQueue().catch((err) =>
            console.error("AUTO_REORDER_EVENT_FLUSH_ERROR:", err)
          );
        }, AUTO_REORDER_EVENT_DEBOUNCE_MS);
      }
    }
  }
}

async function getItemTotalQty(itemId, options = {}) {
  const id = Number(itemId);
  if (!id || Number.isNaN(id)) return 0;

  const orgIdRaw = options?.orgId;
  const orgId = Number.isFinite(Number(orgIdRaw)) ? Number(orgIdRaw) : null;
  const subtractHolds = Boolean(options?.subtractHolds);

  const movementWhere = {
    itemId: id,
    locationId: { not: null },
  };
  if (orgId !== null) {
    movementWhere.orgId = orgId;
  }

  const movements = await prisma.stockMovement.findMany({
    where: movementWhere,
    select: { type: true, quantity: true },
  });

  let qty = 0;
  for (const movement of movements) {
    if (movement.type === "INCOME" || movement.type === "ADJUSTMENT") {
      qty += Number(movement.quantity);
    } else if (movement.type === "ISSUE") {
      qty -= Number(movement.quantity);
    }
  }

  if (!subtractHolds) {
    return Math.round(qty);
  }

  const holdWhere = {
    itemId: id,
    status: "ACTIVE",
  };
  if (orgId !== null) {
    holdWhere.orgId = orgId;
  }

  const activeHolds = await prisma.stockHold.aggregate({
    where: holdWhere,
    _sum: { qty: true },
  });

  const holdQty = Number(activeHolds?._sum?.qty) || 0;
  return Math.max(0, Math.round(qty - holdQty));
}

async function ensureOwnerAdminAccount() {
  const normalizedEmail = OWNER_PRIMARY_EMAIL.trim().toLowerCase();
  const ownerName = OWNER_PRIMARY_NAME;
  const ownerHash = await bcrypt.hash(OWNER_PRIMARY_PASSWORD, 10);
  const ownerOrg = await getOrCreateOrganizationByCode(
    "platform-owner",
    "Владелец платформы"
  );

  const owner = await findUserByEmailInsensitive(normalizedEmail);

  if (owner?.id) {
    await prisma.user.update({
      where: { id: owner.id },
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

function isPostgresDatabaseUrl() {
  const normalizedUrl = String(DATABASE_URL || "").trim().toLowerCase();
  return normalizedUrl.startsWith("postgresql://") || normalizedUrl.startsWith("postgres://");
}

async function isPalletDiscrepancyStorageReady(tx = prismaBase) {
  if (!isPostgresDatabaseUrl()) return true;
  try {
    const rows = await tx.$queryRawUnsafe(`
      SELECT
        to_regclass('public."PalletDiscrepancy"') AS "tableRegclass",
        EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PalletDiscrepancyStatus') AS "hasStatusType"
    `);
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    return Boolean(row?.tableRegclass) && Boolean(row?.hasStatusType);
  } catch (err) {
    return false;
  }
}

let palletDiscrepancyStorageEnsurePromise = null;

async function ensurePalletDiscrepancyStorageReadyForRuntime() {
  if (!isPostgresDatabaseUrl()) return true;

  const alreadyReady = await isPalletDiscrepancyStorageReady(prisma);
  if (alreadyReady) return true;

  if (!palletDiscrepancyStorageEnsurePromise) {
    palletDiscrepancyStorageEnsurePromise = (async () => {
      try {
        await ensurePalletDiscrepancyStorageReady();
      } catch (err) {
        console.warn("[PALLET_DISCREPANCY_BOOTSTRAP] runtime ensure failed:", err);
      } finally {
        palletDiscrepancyStorageEnsurePromise = null;
      }
    })();
  }

  await palletDiscrepancyStorageEnsurePromise;
  return isPalletDiscrepancyStorageReady(prisma);
}

async function ensureEmailVerificationStorageReady() {
  if (!isPostgresDatabaseUrl()) {
    console.log(
      "[EMAIL_VERIFY_BOOTSTRAP] skipped: DATABASE_URL не PostgreSQL, runtime-инициализация не требуется."
    );
    return;
  }

  await prismaBase.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "EmailVerificationCode" (
      "id" SERIAL NOT NULL,
      "userId" INTEGER NOT NULL,
      "codeHash" TEXT NOT NULL,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "usedAt" TIMESTAMP(3),
      "phone" TEXT,
      "companyName" TEXT,
      "note" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "EmailVerificationCode_pkey" PRIMARY KEY ("id")
    );
  `);

  await prismaBase.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "EmailVerificationCode_userId_createdAt_idx"
    ON "EmailVerificationCode"("userId", "createdAt");
  `);

  await prismaBase.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "EmailVerificationCode_userId_usedAt_expiresAt_idx"
    ON "EmailVerificationCode"("userId", "usedAt", "expiresAt");
  `);

  await prismaBase.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'EmailVerificationCode_userId_fkey'
      ) THEN
        ALTER TABLE "EmailVerificationCode"
        ADD CONSTRAINT "EmailVerificationCode_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END
    $$;
  `);

  console.log("[EMAIL_VERIFY_BOOTSTRAP] EmailVerificationCode table is ready.");
}

async function ensurePalletDiscrepancyStorageReady() {
  if (!isPostgresDatabaseUrl()) {
    return;
  }

  await prismaBase.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PalletDiscrepancyStatus') THEN
        CREATE TYPE "PalletDiscrepancyStatus" AS ENUM ('OPEN', 'CLOSED');
      END IF;
    END $$;
  `);

  await prismaBase.$executeRawUnsafe(`
    DO $$
    BEGIN
      BEGIN
        ALTER TYPE "PalletEventType" ADD VALUE IF NOT EXISTS 'DISCREPANCY_OPEN';
      EXCEPTION
        WHEN insufficient_privilege THEN
          RAISE NOTICE 'skip enum alter DISCREPANCY_OPEN: insufficient privilege';
      END;
    END $$;
  `);
  await prismaBase.$executeRawUnsafe(`
    DO $$
    BEGIN
      BEGIN
        ALTER TYPE "PalletEventType" ADD VALUE IF NOT EXISTS 'DISCREPANCY_CLOSE';
      EXCEPTION
        WHEN insufficient_privilege THEN
          RAISE NOTICE 'skip enum alter DISCREPANCY_CLOSE: insufficient privilege';
      END;
    END $$;
  `);

  await prismaBase.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PalletDiscrepancy" (
      "id" SERIAL NOT NULL,
      "orgId" INTEGER,
      "palletId" INTEGER NOT NULL,
      "locationId" INTEGER,
      "status" "PalletDiscrepancyStatus" NOT NULL DEFAULT 'OPEN',
      "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "detectedByUserId" INTEGER,
      "lastCheckedAt" TIMESTAMP(3),
      "closedAt" TIMESTAMP(3),
      "closedByUserId" INTEGER,
      "note" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PalletDiscrepancy_pkey" PRIMARY KEY ("id")
    );
  `);

  await prismaBase.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PalletDiscrepancy_orgId_status_detectedAt_idx"
      ON "PalletDiscrepancy" ("orgId", "status", "detectedAt");
  `);
  await prismaBase.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PalletDiscrepancy_orgId_palletId_status_idx"
      ON "PalletDiscrepancy" ("orgId", "palletId", "status");
  `);
  await prismaBase.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PalletDiscrepancy_orgId_locationId_status_idx"
      ON "PalletDiscrepancy" ("orgId", "locationId", "status");
  `);

  await prismaBase.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PalletDiscrepancy_palletId_fkey'
      ) THEN
        ALTER TABLE "PalletDiscrepancy"
          ADD CONSTRAINT "PalletDiscrepancy_palletId_fkey"
          FOREIGN KEY ("palletId") REFERENCES "Pallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PalletDiscrepancy_locationId_fkey'
      ) THEN
        ALTER TABLE "PalletDiscrepancy"
          ADD CONSTRAINT "PalletDiscrepancy_locationId_fkey"
          FOREIGN KEY ("locationId") REFERENCES "PalletLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PalletDiscrepancy_detectedByUserId_fkey'
      ) THEN
        ALTER TABLE "PalletDiscrepancy"
          ADD CONSTRAINT "PalletDiscrepancy_detectedByUserId_fkey"
          FOREIGN KEY ("detectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PalletDiscrepancy_closedByUserId_fkey'
      ) THEN
        ALTER TABLE "PalletDiscrepancy"
          ADD CONSTRAINT "PalletDiscrepancy_closedByUserId_fkey"
          FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  console.log("[PALLET_DISCREPANCY_BOOTSTRAP] PalletDiscrepancy table is ready.");
}

async function ensureAuthDbPermissions() {
  if (!isPostgresDatabaseUrl()) {
    return;
  }

  const loadPrivileges = async () => {
    const rows = await prismaBase.$queryRawUnsafe(`
      SELECT
        current_user AS "currentUser",
        has_table_privilege(current_user, 'public."User"', 'SELECT') AS "userSelect",
        has_table_privilege(current_user, 'public."User"', 'INSERT') AS "userInsert",
        has_table_privilege(current_user, 'public."User"', 'UPDATE') AS "userUpdate",
        has_table_privilege(current_user, 'public."User"', 'DELETE') AS "userDelete",
        has_table_privilege(current_user, 'public."Organization"', 'SELECT') AS "orgSelect",
        has_table_privilege(current_user, 'public."Item"', 'SELECT') AS "itemSelect",
        has_table_privilege(current_user, 'public."WarehouseNotification"', 'SELECT') AS "notificationSelect",
        has_table_privilege(current_user, 'public."Pallet"', 'SELECT') AS "palletSelect",
        has_table_privilege(current_user, 'public."PalletLocation"', 'SELECT') AS "palletLocationSelect"
    `);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  };

  try {
    const before = await loadPrivileges();
    const hasUserRead = Boolean(before?.userSelect);
    const hasOrgRead = Boolean(before?.orgSelect);
    const hasItemRead = Boolean(before?.itemSelect);
    const hasNotificationRead = Boolean(before?.notificationSelect);
    const hasPalletRead = Boolean(before?.palletSelect);
    const hasPalletLocationRead = Boolean(before?.palletLocationSelect);
    if (
      hasUserRead &&
      hasOrgRead &&
      hasItemRead &&
      hasNotificationRead &&
      hasPalletRead &&
      hasPalletLocationRead
    ) {
      return;
    }

    await prismaBase.$executeRawUnsafe(`
      DO $$
      DECLARE
        v_user text := current_user;
      BEGIN
        BEGIN
          EXECUTE format('GRANT USAGE, CREATE ON SCHEMA public TO %I', v_user);
        EXCEPTION
          WHEN insufficient_privilege THEN
            EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', v_user);
        END;
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', v_user);
        EXECUTE format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I', v_user);
      END
      $$;
    `);

    const after = await loadPrivileges();
    if (!after?.userSelect) {
      console.warn("[DB_AUTH_PERMS] missing SELECT privilege on public.\"User\" for current_user.");
    }
    if (!after?.orgSelect) {
      console.warn(
        "[DB_AUTH_PERMS] missing SELECT privilege on public.\"Organization\" for current_user."
      );
    }
    if (!after?.itemSelect) {
      console.warn("[DB_AUTH_PERMS] missing SELECT privilege on public.\"Item\" for current_user.");
    }
    if (!after?.notificationSelect) {
      console.warn(
        "[DB_AUTH_PERMS] missing SELECT privilege on public.\"WarehouseNotification\" for current_user."
      );
    }
  } catch (err) {
    console.error("[DB_AUTH_PERMS] check/grant error:", err);
  }
}

function logMailConfigStatus() {
  const requiredKeys = [
    "MAIL_HOST",
    "MAIL_PORT",
    "MAIL_USER",
    "MAIL_PASS",
    "MAIL_FROM",
  ];
  const missing = requiredKeys.filter((key) =>
    !String(process.env[key] || "").trim()
  );

  if (missing.length) {
    console.warn(
      `[MAIL_CONFIG] не заполнены переменные: ${missing.join(", ")}`
    );
  } else {
    console.log("[MAIL_CONFIG] почтовые переменные заполнены.");
  }

  const transportConfigs = buildMailTransportConfigs();
  if (!transportConfigs.length) {
    console.warn("[MAIL_CONFIG] SMTP-план не собран: отсутствуют обязательные переменные.");
  } else {
    const transportPlan = transportConfigs
      .map((config, index) => {
        const host = String(config.host || "").trim() || "-";
        const port = Number(config.port || 0) || 0;
        const secure = config.secure ? "true" : "false";
        return `${index + 1}) ${host}:${port} secure=${secure}`;
      })
      .join("; ");
    console.log(`[MAIL_CONFIG] SMTP-план отправки: ${transportPlan}`);
  }

  const notifyEmail = String(
    process.env.NEW_CLIENT_NOTIFY_EMAILS ||
      process.env.NEW_CLIENT_NOTIFY_EMAIL ||
      OWNER_PRIMARY_EMAIL
  ).trim();
  console.log(
    `[MAIL_CONFIG] получатели уведомлений о новых клиентах: ${notifyEmail || "-"}`
  );
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

async function checkAutoReorders(options = {}) {
  try {
    const requestedItemIds = Array.isArray(options?.itemIds)
      ? options.itemIds
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
      : [];

    if (Array.isArray(options?.itemIds) && !requestedItemIds.length) {
      return;
    }

    const itemsWhere = {
      autoReorderEnabled: true,
      autoReorderMin: { not: null },
      autoReorderSupplierId: { not: null },
    };
    if (requestedItemIds.length) {
      itemsWhere.id = { in: requestedItemIds };
    }

    const items = await prisma.item.findMany({
      where: itemsWhere,
      include: {
        autoReorderSupplier: true,
      },
    });
    if (!items.length) return;

    const adminUsers = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true, orgId: { not: null } },
      select: { id: true, email: true, orgId: true },
    });

    const adminByOrg = new Map();
    const adminEmailsByOrg = new Map();
    for (const admin of adminUsers) {
      const orgKey = Number.isFinite(Number(admin.orgId)) ? Number(admin.orgId) : null;
      if (orgKey == null) continue;
      if (!adminByOrg.has(orgKey)) {
        adminByOrg.set(orgKey, admin.id);
      }
      if (admin.email) {
        if (!adminEmailsByOrg.has(orgKey)) {
          adminEmailsByOrg.set(orgKey, []);
        }
        adminEmailsByOrg.get(orgKey).push(admin.email);
      }
    }

    for (const item of items) {
      const orgId = Number.isFinite(Number(item.orgId)) ? Number(item.orgId) : null;
      if (orgId == null) continue;

      const adminUserId = adminByOrg.get(orgId) || null;
      const adminEmails = adminEmailsByOrg.get(orgId) || [];
      const minQty = Number(item.autoReorderMin);

      if (!Number.isFinite(minQty) || minQty <= 0) continue;

      const availableQty = await getItemTotalQty(item.id, {
        orgId,
        subtractHolds: true,
      });

      if (item.autoReorderActive && availableQty > minQty) {
        await prisma.item.update({
          where: { id: item.id },
          data: {
            autoReorderActive: false,
            autoReorderLastReminderAt: null,
          },
        });
        continue;
      }

      if (availableQty > minQty) {
        continue;
      }

      const supplier = item.autoReorderSupplier;
      if (!supplier) continue;
      if (!adminUserId) {
        console.error(`AUTO_REORDER: admin user not found for org ${orgId}`);
        continue;
      }

      const existingDraft = await prisma.purchaseOrder.findFirst({
        where: {
          orgId,
          supplierId: supplier.id,
          status: "DRAFT",
          comment: { contains: "[AUTO-REORDER]" },
        },
        orderBy: { createdAt: "desc" },
        include: {
          items: {
            where: { itemId: item.id },
            select: { id: true, quantity: true, price: true },
            take: 1,
          },
        },
      });
      const existingLine = Array.isArray(existingDraft?.items)
        ? existingDraft.items[0]
        : null;

      if (item.autoReorderActive && existingLine) {
        const lastReminderAt = item.autoReorderLastReminderAt
          ? new Date(item.autoReorderLastReminderAt).getTime()
          : 0;

        if (Date.now() - lastReminderAt >= AUTO_REORDER_REMINDER_MS) {
          const draftOrderId = existingDraft?.id || item.autoReorderLastOrderId;
          const lastOrderInfo = draftOrderId
            ? `\nDraft order ID: #${draftOrderId}`
            : "";
          const subject = `Auto reorder: action required for item \"${item.name}\"`;
          const text =
            `Item \"${item.name}\" is still below minimum.\n` +
            `Available qty: ${availableQty}\nMinimum: ${minQty}` +
            `${lastOrderInfo}\n\n` +
            `Open \"Purchase Orders\" and confirm sending manually.`;

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

      const targetMax = Number(item.maxStock || item.autoReorderMin || 0);
      const orderQty = Math.max(Math.round(targetMax - availableQty), 1);

      let order = existingDraft;

      let isNewDraft = false;
      let lineUpdated = false;

      if (!order) {
        const nextNumber = await getNextPurchaseOrderNumber(orgId);
        order = await prisma.purchaseOrder.create({
          data: {
            orgId,
            number: nextNumber,
            date: new Date(),
            status: "DRAFT",
            comment: `[AUTO-REORDER] Draft for supplier \"${supplier.name}\"`,
            supplierId: supplier.id,
            createdById: adminUserId,
            items: {
              create: [
                {
                  orgId,
                  itemId: item.id,
                  quantity: orderQty,
                  price: item.defaultPrice || 0,
                },
              ],
            },
          },
        });
        isNewDraft = true;
      } else {
        if (existingLine) {
          await prisma.purchaseOrderItem.update({
            where: { id: existingLine.id },
            data: {
              quantity: Number(existingLine.quantity || 0) + orderQty,
              price:
                Number(item.defaultPrice) ||
                Number(existingLine.price) ||
                0,
            },
          });
          lineUpdated = true;
        } else {
          await prisma.purchaseOrderItem.create({
            data: {
              orgId,
              orderId: order.id,
              itemId: item.id,
              quantity: orderQty,
              price: item.defaultPrice || 0,
            },
          });
        }
      }

      await prisma.item.update({
        where: { id: item.id },
        data: {
          autoReorderActive: true,
          autoReorderLastTriggeredAt: new Date(),
          autoReorderLastReminderAt: null,
          autoReorderLastOrderId: order.id,
        },
      });

      const orderNumberLabel = order.number || `#${order.id}`;
      const subject = isNewDraft
        ? `Auto reorder: draft created ${orderNumberLabel}`
        : `Auto reorder: draft updated ${orderNumberLabel}`;
      const text =
        `System ${isNewDraft ? "created" : "updated"} a draft supplier order.\n` +
        `Item: ${item.name}\n` +
        `Available qty: ${availableQty}\n` +
        `Minimum: ${minQty}\n` +
        `Order qty: ${orderQty}\n` +
        `Supplier: ${supplier.name}\n` +
        `Order number: ${orderNumberLabel}\n` +
        `Line action: ${lineUpdated ? "quantity increased" : "line added"}\n\n` +
        `Manual step required: open order and click \"Send to supplier\".`;

      for (const email of adminEmails) {
        await sendAutoReorderEmail({ to: email, subject, text });
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
      "[DB ready check] БД не готова, фоновые задачи не запущены (выполните db:deploy)."
    );
    return;
  }

  backgroundTasksStarted = true;
  console.log("[DB ready check] OK, БД готова.");

  setInterval(sendSafetyReminders, 1000 * 60 * 60); // раз в час
  sendSafetyReminders();

  setInterval(checkAutoReorders, AUTO_REORDER_INTERVAL_MS);
  checkAutoReorders();

  setInterval(() => {
    // 1) Уведомления по задачам склада
    checkWarehouseTaskNotifications().catch((err) =>
      console.error("ошибка в checkWarehouseTaskNotifications:", err)
    );

    // 2) В 18:00 отправляем сводку по остаткам
    const now = new Date();
    const hours = now.getHours(); // 0..23
    const minutes = now.getMinutes(); // 0..59
    const todayKey = now.toISOString().slice(0, 10); // "YYYY-MM-DD"

    if (hours === 18 && minutes === 0 && lastLowStockReportDate !== todayKey) {
      lastLowStockReportDate = todayKey;

      sendDailyLowStockSummary().catch((err) =>
        console.error("ошибка в sendDailyLowStockSummary:", err)
      );
    }
  }, 60 * 1000);
}

app.post(
  "/api/warehouse/stock/adjustment",
  auth,
  enforceOperationalTenantScope,
  requireAdmin,
  async (req, res) => {
  try {
    if (!hasPermission(req.user, PERMISSION_KEYS.ADMIN_WAREHOUSE)) {
      return res.status(403).json({ message: "Нет доступа к разделу." });
    }

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
        const receivingLocationId = await getReceivingLocationId(tx, req.user?.orgId || null);
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

// ================== ЗАПУСК СЕРВЕРА ==================

const PORT = Number(process.env.PORT || 3000);
// На Render и в контейнерах bind должен быть на 0.0.0.0.
const HOST = "0.0.0.0";

async function bootstrapServer() {
  try {
    await ensureEmailVerificationStorageReady();
  } catch (err) {
    console.error("[EMAIL_VERIFY_BOOTSTRAP] error:", err);
  }

  try {
    await ensurePalletDiscrepancyStorageReady();
  } catch (err) {
    console.error("[PALLET_DISCREPANCY_BOOTSTRAP] error:", err);
  }

  try {
    await ensureAuthDbPermissions();
  } catch (err) {
    console.error("[DB_AUTH_PERMS] bootstrap error:", err);
  }

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

  logMailConfigStatus();

  const server = app.listen(PORT, HOST, () => {
    console.log(`🚀 API запущен: http://${HOST}:${PORT}`);
  });
  server.on("error", (err) => {
    console.error(`[API LISTEN ERROR] host=${HOST} port=${PORT}`, err);
  });

  startBackgroundTasks().catch((err) =>
    console.error("[DB ready check] ошибка запуска фоновых задач:", err)
  );
}

bootstrapServer().catch((err) =>
  console.error("Ошибка запуска bootstrapServer:", err)
);
