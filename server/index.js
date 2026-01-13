import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import multer from "multer";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { XMLParser } from "fast-xml-parser";
import QRCode from "qrcode";
import bwipjs from "bwip-js";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adminRoutes } from "./adminRoutes.js";
import { createWarehouseStockService } from "./services/warehouseStockService.js";

// ================== РРќРР¦РРђР›РР—РђР¦РРЇ ==================

const app = express();
const basePrisma = new PrismaClient();
const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const orgId = getOrgIdFromContext();
        if (!orgId || !model || !ORG_SCOPED_MODELS.has(model)) {
          return query(args);
        }

        const nextArgs = { ...(args || {}) };
        const where = nextArgs.where || {};

        if ([
          "findMany",
          "findFirst",
          "findFirstOrThrow",
          "count",
          "aggregate",
          "groupBy"
        ].includes(operation)) {
          nextArgs.where = { ...where, orgId };
          return query(nextArgs);
        }

        if (["findUnique", "findUniqueOrThrow"].includes(operation)) {
          if (where?.id && !where?.id_orgId) {
            nextArgs.where = { id_orgId: { id: where.id, orgId } };
            return query(nextArgs);
          }
          const result = await basePrisma[model].findFirst({
            where: { ...where, orgId },
            select: nextArgs.select,
            include: nextArgs.include,
          });
          if (!result && operation === "findUniqueOrThrow") {
            throw new Error("Record not found");
          }
          return result;
        }

        if (operation === "create") {
          if (nextArgs.data && nextArgs.data.orgId == null) {
            nextArgs.data.orgId = orgId;
          }
          return query(nextArgs);
        }

        if (operation === "createMany") {
          if (Array.isArray(nextArgs.data)) {
            nextArgs.data = nextArgs.data.map((row) => (row.orgId == null ? { ...row, orgId } : row));
          }
          return query(nextArgs);
        }

        if (["update", "delete"].includes(operation)) {
          if (where?.id && !where?.id_orgId) {
            nextArgs.where = { id_orgId: { id: where.id, orgId } };
          } else if (!where?.id_orgId && nextArgs.where && nextArgs.where.orgId == null) {
            nextArgs.where = { ...where, orgId };
          }
          return query(nextArgs);
        }

        if (operation === "upsert") {
          if (where?.id && !where?.id_orgId) {
            nextArgs.where = { id_orgId: { id: where.id, orgId } };
          }
          if (nextArgs.create && nextArgs.create.orgId == null) {
            nextArgs.create.orgId = orgId;
          }
          return query(nextArgs);
        }

        return query(nextArgs);
      }
    }
  }
});
const stockService = createWarehouseStockService(prisma);

const orgContext = new AsyncLocalStorage();
const ORG_SCOPED_MODELS = new Set([
  "Employee",
  "HrLeaveApplication",
  "SafetyInstruction",
  "SafetyAssignment",
  "LeaveRequest",
  "PaymentRequest",
  "WarehouseRequest",
  "WarehouseRequestItem",
  "WarehouseTask",
  "PurchaseOrder",
  "PurchaseOrderItem",
  "Item",
  "WarehouseLocation",
  "WarehousePlacement",
  "StockMovement",
  "BinAuditSession",
  "BinAuditEvent",
  "StockDiscrepancy",
  "ReceivingDiscrepancy",
  "OrgProfile",
  "Supplier",
  "SupplierTruck",
  "InviteToken",
  "Membership",
  "Subscription",
  "Payment"
]);

function getOrgIdFromContext() {
  return orgContext.getStore()?.orgId || null;
}

// РґР»СЏ Р·Р°РіСЂСѓР·РєРё С„Р°Р№Р»РѕРІ РІ РїР°РјСЏС‚СЊ (Р±СѓРґРµРј С‡РёС‚Р°С‚СЊ Excel РёР· Р±СѓС„РµСЂР°)
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ok: true, version: APP_VERSION, db: "ok" });
  } catch (err) {
    console.error("health db error:", err?.message || err);
    return res.json({ ok: false, version: APP_VERSION, db: "error" });
  }
});


// ================== JWT / РђР’РўРћР РР—РђР¦РРЇ ==================

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("JWT_SECRET is not set");
  process.exit(1);
}
const JWT_EXPIRES_IN = "7d";

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion || 0,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function auth(req, res, next) {
  const header = req.headers["authorization"];
  if (!header) {
    return res.status(401).json({ message: "РќРµС‚ С‚РѕРєРµРЅР° Р°РІС‚РѕСЂРёР·Р°С†РёРё" });
  }

  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) {
    return res.status(401).json({ message: "РќРµРІРµСЂРЅС‹Р№ С„РѕСЂРјР°С‚ С‚РѕРєРµРЅР°" });
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
    const existingRoles = req.user?.roles;
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      roles: existingRoles,
    };
    next();
  } catch (err) {
    console.error("auth error:", err);
    return res.status(401).json({ message: "РќРµРґРµР№СЃС‚РІРёС‚РµР»СЊРЅС‹Р№ С‚РѕРєРµРЅ" });
  }
}

function getRequestRoles(req) {
  const roles = new Set();
  if (req.user?.role) roles.add(req.user.role);
  if (Array.isArray(req.user?.roles)) {
    req.user.roles.forEach((r) => roles.add(r));
  }
  if (Array.isArray(req.roles)) {
    req.roles.forEach((r) => roles.add(r));
  }
  return Array.from(roles);
}

function requireAdmin(req, res, next) {
  const roles = getRequestRoles(req);
  if (!roles.includes("ADMIN")) {
    return res.status(403).json({ message: "ADMIN_REQUIRED" });
  }
  next();
}

function requireHr(req, res, next) {
  const roles = getRequestRoles(req);
  if (!roles.includes("HR") && !roles.includes("ADMIN")) {
    return res.status(403).json({ message: "HR_REQUIRED" });
  }
  next();
}



const AUTH_EXEMPT_PATHS = [
  /^\/api\/health$/,
  /^\/api\/login$/,
  /^\/api\/register$/,
  /^\/api\/auth\/invite-info$/,
  /^\/api\/auth\/accept-invite$/,
  /^\/api\/auth\/forgot-password$/,
  /^\/api\/auth\/reset-password$/,
  /^\/api\/billing\/yookassa\/webhook$/
];

const ORG_EXEMPT_PATHS = [
  ...AUTH_EXEMPT_PATHS
];

const PAYWALL_EXEMPT_PATHS = [
  /^\/api\/health$/,
  /^\/api\/me$/,
  /^\/api\/billing\//,
  /^\/api\/auth\//,
  /^\/api\/login$/,
  /^\/api\/register$/,
  /^\/api\/dev\//
];

function isPathMatch(req, patterns) {
  const fullPath = `${req.baseUrl || ""}${req.path || ""}`;
  return patterns.some((pattern) => pattern.test(fullPath));
}

function resolveOrgContext(req, res, next) {
  (async () => {
    try {
      const memberships = await prisma.membership.findMany({
        where: { userId: req.user.id },
        include: { org: true }
      });
      if (!memberships.length) {
        return res.status(403).json({ message: "NO_ORG_MEMBERSHIP" });
      }

      const rawOrgId = req.headers["x-org-id"];
      const requestedOrgId = rawOrgId ? Number(rawOrgId) : null;
      let membership = memberships[0];
      if (requestedOrgId && !Number.isNaN(requestedOrgId)) {
        const found = memberships.find((m) => m.orgId === requestedOrgId);
        if (!found) {
          return res.status(403).json({ message: "ORG_ACCESS_DENIED" });
        }
        membership = found;
      }

      req.orgId = membership.orgId;
      req.org = membership.org;
      req.membershipRole = membership.role;
      req.roles = [req.user?.role, membership.role].filter(Boolean);
      if (req.user) {
        req.user.roles = req.roles;
      }

      return orgContext.run({ orgId: req.orgId }, () => next());
    } catch (err) {
      console.error("resolveOrgContext error:", err);
      return res.status(500).json({ message: "ORG_CONTEXT_ERROR" });
    }
  })();
}

async function requirePaidSubscription(req, res, next) {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: { orgId: req.orgId }
    });
    req.subscription = subscription;
    const now = new Date();
    const isActive =
      subscription &&
      subscription.status === "active" &&
      subscription.paidUntil &&
      new Date(subscription.paidUntil) > now;
    if (!isActive) {
      return res.status(402).json({ message: "SUBSCRIPTION_REQUIRED" });
    }
    return next();
  } catch (err) {
    console.error("subscription check error:", err);
    return res.status(500).json({ message: "SUBSCRIPTION_CHECK_ERROR" });
  }
}

app.use("/api", (req, res, next) => {
  if (isPathMatch(req, AUTH_EXEMPT_PATHS)) return next();
  return auth(req, res, next);
});

app.use("/api", (req, res, next) => {
  if (isPathMatch(req, ORG_EXEMPT_PATHS)) return next();
  return resolveOrgContext(req, res, next);
});

app.use("/api", (req, res, next) => {
  if (isPathMatch(req, PAYWALL_EXEMPT_PATHS)) return next();
  return requirePaidSubscription(req, res, next);
});

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const INVITE_EMAIL_COOLDOWN_MS = 60 * 1000;
const INVITE_GLOBAL_LIMIT = 20;

const RESET_TTL_MS = 45 * 60 * 1000;
const RESET_EMAIL_COOLDOWN_MS = 60 * 1000;
const RESET_GLOBAL_LIMIT = 30;

const resetEmailRate = new Map();
const resetGlobalRate = [];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_VERSION = (() => {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8")
    );
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
})();

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const APP_URL = process.env.APP_URL || FRONTEND_URL;
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

const PLANS = {
  "basic-30": {
    id: "basic-30",
    title: "Basic 30 days",
    amount: 1990,
    currency: "RUB",
    days: 30
  }
};

let mailTransport = null;
let mailReady = false;
const isDevEnv = process.env.NODE_ENV !== "production";

function getMailTransport() {
  if (mailTransport) return mailTransport;
  const host = process.env.MAIL_HOST || "smtp.mail.ru";
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;
  if (!host || !user || !pass) return null;

  const port = Number(process.env.MAIL_PORT || 465);
  const secure = String(process.env.MAIL_SECURE || "true") === "true";
  const requireTLS =
    process.env.MAIL_REQUIRE_TLS !== undefined
      ? String(process.env.MAIL_REQUIRE_TLS) === "true"
      : !secure;
  mailTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS,
    auth: { user, pass },
  });
  return mailTransport;
}

async function initMailer() {
  const host = process.env.MAIL_HOST || "smtp.mail.ru";
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;
  const port = Number(process.env.MAIL_PORT || 465);
  const secure = String(process.env.MAIL_SECURE || "true") === "true";
  const from = process.env.MAIL_FROM || `Business Portal <${user || ""}>`;
  const requireTLS =
    process.env.MAIL_REQUIRE_TLS !== undefined
      ? String(process.env.MAIL_REQUIRE_TLS) === "true"
      : !secure;

  if (!user || !pass) {
    mailReady = false;
    console.log("[MAIL] disabled (missing env)");
    return;
  }

  console.log(
    `[MAIL] config: host=${host} port=${port} secure=${secure} requireTLS=${requireTLS} user=${user} from=${from}`
  );

  try {
    const transport = getMailTransport();
    if (!transport) {
      mailReady = false;
      console.log("[MAIL] disabled (missing env)");
      return;
    }
    await transport.verify();
    mailReady = true;
    console.log("[MAIL] verify OK");
  } catch (err) {
    mailReady = false;
    console.log(
      `[MAIL] verify FAIL: code=${err?.code || "-"} message=${err?.message || err}`
    );
    if (err?.code === "EAUTH") {
      console.log(
        "[MAIL] AUTH failed — для mail.ru нужен пароль приложения (если включена 2FA) или включите SMTP-доступ"
      );
    }
  }
}

function hashInviteToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createInviteToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function sendInviteEmail(email, token) {
  const link = `${FRONTEND_URL}/invite?token=${token}`;
  const transport = getMailTransport();
  if (!transport) {
    if (isDevEnv) {
      console.log(`[DEV ONLY][INVITE] ${email}: ${link}`);
    } else {
      console.log(`[MAIL] invite skipped (mailer disabled) to=${email}`);
    }
    return { sent: false, link, error: "MAIL_DISABLED" };
  }

  const from = process.env.MAIL_FROM || `Business Portal <${process.env.MAIL_USER}>`;
  const subject = "Приглашение в Business Portal";
  const text = `Вы приглашены в Business Portal. Перейдите по ссылке для завершения регистрации: ${link}`;
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;">
      <p>Вы приглашены в Business Portal.</p>
      <p>Ссылка для завершения регистрации:</p>
      <p><a href="${link}">${link}</a></p>
      <p>Если вы не ожидали это письмо, просто игнорируйте его.</p>
    </div>
  `;

  try {
    await transport.sendMail({ from, to: email, subject, text, html });
    console.log(`[MAIL] invite sent to=${email}`);
    return { sent: true, link };
  } catch (err) {
    console.log(
      `[MAIL] invite failed to=${email} code=${err?.code || "-"} message=${err?.message || err}`
    );
    if (isDevEnv) {
      console.log(`[DEV ONLY][INVITE] ${email}: ${link}`);
    }
    return { sent: false, link, error: err?.code || err?.message || "MAIL_SEND_FAILED" };
  }
}

async function sendPasswordResetEmail(email, token) {
  const link = `${FRONTEND_URL}/reset-password?token=${token}`;
  const transport = getMailTransport();
  if (!transport) {
    if (isDevEnv) {
      console.log(`[DEV ONLY][RESET] ${email}: ${link}`);
    } else {
      console.log(`[MAIL] reset skipped (mailer disabled) to=${email}`);
    }
    return { sent: false, link, error: "MAIL_DISABLED" };
  }

  const from = process.env.MAIL_FROM || `Business Portal <${process.env.MAIL_USER}>`;
  const subject = "Сброс пароля в Business Portal";
  const text = `Кто-то запросил сброс пароля для вашего аккаунта. Если это были вы, перейдите по ссылке: ${link}`;
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;">
      <p>Кто-то запросил сброс пароля для вашего аккаунта.</p>
      <p>Перейдите по ссылке:</p>
      <p><a href="${link}">${link}</a></p>
      <p>Если вы не запрашивали сброс, просто проигнорируйте письмо.</p>
    </div>
  `;

  try {
    await transport.sendMail({ from, to: email, subject, text, html });
    console.log(`[MAIL] reset sent to=${email}`);
    return { sent: true, link };
  } catch (err) {
    console.log(
      `[MAIL] reset failed to=${email} code=${err?.code || "-"} message=${err?.message || err}`
    );
    if (isDevEnv) {
      console.log(`[DEV ONLY][RESET] ${email}: ${link}`);
    }
    return { sent: false, link, error: err?.code || err?.message || "MAIL_SEND_FAILED" };
  }
}

async function sendPasswordChangedEmail(email) {
  const transport = getMailTransport();
  if (!transport) {
    return { sent: false, error: "MAIL_DISABLED" };
  }

  const from = process.env.MAIL_FROM || `Business Portal <${process.env.MAIL_USER}>`;
  const subject = "Пароль изменён";
  const text =
    "Пароль в Business Portal был изменён. Если это были не вы, обратитесь к администратору.";
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;">
      <p>${text}</p>
    </div>
  `;

  try {
    await transport.sendMail({ from, to: email, subject, text, html });
    console.log(`[MAIL] password changed notice sent to=${email}`);
    return { sent: true };
  } catch (err) {
    console.log(
      `[MAIL] password changed notice failed to=${email} code=${err?.code || "-"} message=${err?.message || err}`
    );
    return { sent: false, error: err?.code || err?.message || "MAIL_SEND_FAILED" };
  }
}


function getPlan(planId) {
  return PLANS[planId] || null;
}

function getYookassaAuthHeader() {
  if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) return null;
  const token = Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString("base64");
  return `Basic ${token}`;
}

async function yookassaRequest(method, path, body, idempotenceKey) {
  const auth = getYookassaAuthHeader();
  if (!auth) {
    throw new Error("YOOKASSA_CONFIG_MISSING");
  }

  const headers = {
    Authorization: auth,
    "Content-Type": "application/json"
  };
  if (idempotenceKey) {
    headers["Idempotence-Key"] = idempotenceKey;
  }

  const res = await fetch(`https://api.yookassa.ru/v3${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error("YOOKASSA_REQUEST_FAILED");
    error.details = data;
    throw error;
  }
  return data;
}

function formatAmount(value) {
  return Number(value).toFixed(2);
}

async function fetchYookassaPayment(providerPaymentId) {
  return yookassaRequest("GET", `/payments/${providerPaymentId}`);
}

function logBilling(event, payload = {}) {
  const safePayload = {
    event,
    ts: new Date().toISOString(),
    ...payload,
  };
  console.log(JSON.stringify(safePayload));
}

async function applyPaymentSuccess({ paymentRecord, providerPayment, plan }) {
  const orgId = paymentRecord.orgId;
  const now = new Date();
  const current = await prisma.subscription.findFirst({ where: { orgId } });
  const baseDate = current?.paidUntil && new Date(current.paidUntil) > now
    ? new Date(current.paidUntil)
    : now;
  const nextPaidUntil = addDays(baseDate, plan.days);

  await prisma.subscription.upsert({
    where: { orgId },
    update: {
      plan: plan.id,
      status: "active",
      paidUntil: nextPaidUntil,
    },
    create: {
      orgId,
      plan: plan.id,
      status: "active",
      paidUntil: nextPaidUntil,
    },
  });

  logBilling("billing.subscription.update", {
    orgId,
    planId: plan.id,
    paidUntil: nextPaidUntil.toISOString(),
  });

  await prisma.payment.update({
    where: { id: paymentRecord.id },
    data: {
      status: "succeeded",
      metadata: {
        ...(paymentRecord.metadata || {}),
        providerStatus: providerPayment.status,
        providerPaid: providerPayment.paid,
      },
    },
  });

  return nextPaidUntil;
}

app.use("/api/admin", adminRoutes({ prisma, auth, requireAdmin }));

function calcAccruedLeaveDays(hiredAt) {
  if (!hiredAt) return 0;
  const start = new Date(hiredAt);
  if (Number.isNaN(start.getTime())) return 0;

  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  // 28 РґРЅРµР№ РІ РіРѕРґ в‰€ 2.33 РґРЅСЏ РІ РјРµСЃСЏС†
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
  return `В«${dd}В» ${mm} ${yyyy} Рі.`;
}

function formatDateLong(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "В«__В» __________ ____";
  const dd = String(d.getDate()).padStart(2, "0");
  const monthNames = [
    "СЏРЅРІР°СЂСЏ",
    "С„РµРІСЂР°Р»СЏ",
    "РјР°СЂС‚Р°",
    "Р°РїСЂРµР»СЏ",
    "РјР°СЏ",
    "РёСЋРЅСЏ",
    "РёСЋР»СЏ",
    "Р°РІРіСѓСЃС‚Р°",
    "СЃРµРЅС‚СЏР±СЂСЏ",
    "РѕРєС‚СЏР±СЂСЏ",
    "РЅРѕСЏР±СЂСЏ",
    "РґРµРєР°Р±СЂСЏ",
  ];
  const month = monthNames[d.getMonth()] || "";
  const yyyy = d.getFullYear();
  return `В«${dd}В» ${month} ${yyyy} РіРѕРґР°`;
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

  const titleLine = "Р—РђРЇР’Р›Р•РќРР•";

  const body = isTermination
    ? `РџСЂРѕС€Сѓ СѓРІРѕР»РёС‚СЊ РјРµРЅСЏ РїРѕ СЃРѕР±СЃС‚РІРµРЅРЅРѕРјСѓ Р¶РµР»Р°РЅРёСЋ ${fromLong}. РџСЂРѕС€Сѓ РїСЂРѕРёР·РІРµСЃС‚Рё РѕРєРѕРЅС‡Р°С‚РµР»СЊРЅС‹Р№ СЂР°СЃС‡РµС‚, РІС‹РґР°С‚СЊ С‚СЂСѓРґРѕРІСѓСЋ РєРЅРёР¶РєСѓ (РёР»Рё СЃРІРµРґРµРЅРёСЏ Рѕ С‚СЂСѓРґРѕРІРѕР№ РґРµСЏС‚РµР»СЊРЅРѕСЃС‚Рё) Рё СЃРїСЂР°РІРєРё СѓСЃС‚Р°РЅРѕРІР»РµРЅРЅРѕР№ С„РѕСЂРјС‹ РІ РґРµРЅСЊ СѓРІРѕР»СЊРЅРµРЅРёСЏ.`
    : isUnpaid
      ? `Р’ СЃРѕРѕС‚РІРµС‚СЃС‚РІРёРё СЃРѕ СЃС‚Р°С‚СЊРµР№ 128 РўСЂСѓРґРѕРІРѕРіРѕ РєРѕРґРµРєСЃР° Р Р¤ РїСЂРѕС€Сѓ РїСЂРµРґРѕСЃС‚Р°РІРёС‚СЊ РјРЅРµ РѕС‚РїСѓСЃРє Р±РµР· СЃРѕС…СЂР°РЅРµРЅРёСЏ Р·Р°СЂР°Р±РѕС‚РЅРѕР№ РїР»Р°С‚С‹ СЃ ${fromLong} РїРѕ ${toLong} РїСЂРѕРґРѕР»Р¶РёС‚РµР»СЊРЅРѕСЃС‚СЊСЋ ${application.days} РєР°Р»РµРЅРґР°СЂРЅС‹С… РґРЅРµР№.`
      : `Р’ СЃРѕРѕС‚РІРµС‚СЃС‚РІРёРё СЃРѕ СЃС‚Р°С‚СЊРµР№ 115 РўСЂСѓРґРѕРІРѕРіРѕ РєРѕРґРµРєСЃР° Р Р¤ РїСЂРѕС€Сѓ РїСЂРµРґРѕСЃС‚Р°РІРёС‚СЊ РјРЅРµ РµР¶РµРіРѕРґРЅС‹Р№ РѕРїР»Р°С‡РёРІР°РµРјС‹Р№ РѕС‚РїСѓСЃРє СЃ ${fromLong} РїРѕ ${toLong} РїСЂРѕРґРѕР»Р¶РёС‚РµР»СЊРЅРѕСЃС‚СЊСЋ ${application.days} РєР°Р»РµРЅРґР°СЂРЅС‹С… РґРЅРµР№.`;

  const reasonLine = application.reason
    ? `<div class="doc-reason">РћСЃРЅРѕРІР°РЅРёРµ / РєРѕРјРјРµРЅС‚Р°СЂРёР№: ${application.reason}</div>`
    : "";

  const noteSpan = isUnpaid
    ? ""
    : isTermination
      ? ""
      : `<span class="doc-note">(РїРѕРґР°РµС‚СЃСЏ Р·Р° 14 РєР°Р»РµРЅРґР°СЂРЅС‹С… РґРЅРµР№ РґРѕ РїРµСЂРІРѕРіРѕ РґРЅСЏ РѕС‚РїСѓСЃРєР°)</span>`;

  return `
<div class="doc-header">
  <div>РљРћРњРЈ: ________________________________________________</div>
  <div>_____________________________________________________</div>
  <div style="margin-top: 8px;">РћРў РљРћР“Рћ: ${employee.fullName}</div>
  <div>Р”РѕР»Р¶РЅРѕСЃС‚СЊ: ${employee.position || ""}${employee.position ? ", " : ""}${employee.department || ""}</div>
</div>

<div class="doc-title">${titleLine}</div>

<div class="doc-body">${body}</div>
${reasonLine}

<div class="doc-meta">Р”Р°С‚Р° РїСЂРёРµРјР°: ${hired} &nbsp;&nbsp; Р”Р°С‚Р° СЂРѕР¶РґРµРЅРёСЏ: ${birth}</div>

<div class="doc-date">Р”Р°С‚Р° Р·Р°СЏРІР»РµРЅРёСЏ: В«____В» __________ 20____ РіРѕРґР° ${noteSpan}</div>
<div class="doc-sign">РџРѕРґРїРёСЃСЊ ________________</div>

<div class="doc-meta" style="margin-top: 8px;">Р¤Р°РєС‚РёС‡РµСЃРєРё: ${today}</div>
`.trim();
}


const DEFAULT_SAFETY_INSTRUCTIONS = [
  {
    title: "Р’РІРѕРґРЅС‹Р№ РёРЅСЃС‚СЂСѓРєС‚Р°Р¶ РґР»СЏ СЃРєР»Р°РґР°",
    description:
      "РћР±С‰РёРµ С‚СЂРµР±РѕРІР°РЅРёСЏ РїРѕ С‚РµС…РЅРёРєРµ Р±РµР·РѕРїР°СЃРЅРѕСЃС‚Рё РЅР° СЃРєР»Р°РґРµ, СЂР°Р±РѕС‚Р° СЃ С‚РµР»РµР¶РєР°РјРё/РїРѕРіСЂСѓР·С‡РёРєР°РјРё, Р·РѕРЅС‹ Рё РјР°СЂС€СЂСѓС‚С‹ РїРµСЂРµРґРІРёР¶РµРЅРёСЏ.",
    role: "WAREHOUSE",
  },
  {
    title: "РРЅСЃС‚СЂСѓРєС‚Р°Р¶ РґР»СЏ РіСЂСѓР·С‡РёРєРѕРІ",
    description:
      "Р‘РµР·РѕРїР°СЃРЅРѕРµ РїРµСЂРµРјРµС‰РµРЅРёРµ Рё С€С‚Р°Р±РµР»РёСЂРѕРІР°РЅРёРµ РіСЂСѓР·РѕРІ, С„РёРєСЃР°С†РёСЏ РїР°Р»Р»РµС‚, СЂР°Р±РѕС‚Р° СЃ СЃС‚СЂРѕРїР°РјРё Рё Р·Р°С…РІР°С‚Р°РјРё, РѕС‚РґС‹С… РґР»СЏ СЃРїРёРЅС‹.",
    role: "LOADER",
  },
  {
    title: "РџРѕРІС‚РѕСЂРЅС‹Р№ РёРЅСЃС‚СЂСѓРєС‚Р°Р¶ РїРѕ РћРў",
    description:
      "РќР°РїРѕРјРёРЅР°РЅРёРµ РїСЂРѕ СЃСЂРµРґСЃС‚РІР° Р·Р°С‰РёС‚С‹, СЃРёРіРЅР°Р»С‹ СЌРІР°РєСѓР°С†РёРё, РїРѕСЂСЏРґРѕРє РґРµР№СЃС‚РІРёР№ РїСЂРё С‚СЂР°РІРјР°С… Рё РІРѕР·РіРѕСЂР°РЅРёСЏС….",
    role: "ALL",
  },
];

const SAFETY_PERIODICITY_DAYS = 180; // СЂР°Р· РІ РїРѕР»РіРѕРґР°
const SAFETY_FIRST_DUE_DAYS = 3; // РїРµСЂРІРёС‡РЅС‹Р№ РєРѕРЅС‚СЂРѕР»СЊ С‡РµСЂРµР· 3 РґРЅСЏ

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

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
      throw new Error("РЁС‚СЂРёС…РєРѕРґ СѓР¶Рµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РґСЂСѓРіРёРј С‚РѕРІР°СЂРѕРј");
    }
  }
  if (qrCode) {
    const existing = await prisma.item.findFirst({
      where: { qrCode, NOT: { id: itemId } },
    });
    if (existing) {
      throw new Error("QR СѓР¶Рµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РґСЂСѓРіРёРј С‚РѕРІР°СЂРѕРј");
    }
  }
}

async function ensureUniqueLocationCodes({ code, qrCode }, locationId) {
  if (code) {
    const existing = await prisma.warehouseLocation.findFirst({
      where: { code, NOT: { id: locationId } },
    });
    if (existing) {
      throw new Error("РљРѕРґ СѓР¶Рµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РґСЂСѓРіРѕР№ Р»РѕРєР°С†РёРµР№");
    }
  }
  if (qrCode) {
    const existing = await prisma.warehouseLocation.findFirst({
      where: { qrCode, NOT: { id: locationId } },
    });
    if (existing) {
      throw new Error("QR СѓР¶Рµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РґСЂСѓРіРѕР№ Р»РѕРєР°С†РёРµР№");
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

// ================== РќРѕРІРѕСЃС‚Рё (RSS Р°РіСЂРµРіР°С‚РѕСЂ) ==================
const NEWS_SOURCES = [
  { name: "Р’РµРґРѕРјРѕСЃС‚Рё", type: "rss", url: "https://www.vedomosti.ru/rss/rubric/business", defaultCategory: "business" },
  { name: "Р’РµРґРѕРјРѕСЃС‚Рё", type: "rss", url: "https://www.vedomosti.ru/rss/rubric/economics/taxes", defaultCategory: "tax" },
  { name: "Р’РµРґРѕРјРѕСЃС‚Рё", type: "rss", url: "https://www.vedomosti.ru/rss/rubric/economics/regulations", defaultCategory: "tax" },
  { name: "РљРѕРјРјРµСЂСЃР°РЅС‚СЉ", type: "rss", url: "https://www.kommersant.ru/rss/news.xml", defaultCategory: "business" },
  {
    name: "Р Р‘Рљ",
    type: "rss",
    url: "https://rssexport.rbc.ru/rbcnews/news/30/full.rss",
    fallbackUrls: [
      "https://rss.rbc.ru/rbcnews/news/30/full.rss",
      "https://static.feed.rbc.ru/rbc/internal/rss.rbc.ru/rbc.ru/economics.rss",
    ],
    defaultCategory: "business",
  },
  { name: "РњРёРЅС‚СЂСѓРґ", type: "rss", url: "https://mintrud.gov.ru/news/rss/official", defaultCategory: "hr" },
];

const NEWS_CATEGORIES = {
  tax: ["РЅРґСЃ", "РЅР°Р»РѕРі", "С„РЅСЃ", "РІС‹С‡РµС‚", "СЃС‡РµС‚-С„Р°РєС‚СѓСЂ", "СѓРїРґ", "РєР°РјРµСЂР°Р»СЊРЅ", "РїСЂРѕРІРµСЂ", "Р°РєС†РёР·"],
  hr: ["С‚СЂСѓРґ", "РєР°РґСЂС‹", "СѓРІРѕР»СЊРЅРµРЅ", "РїСЂРёРµРј", "РґРѕРіРѕРІРѕСЂ", "РјРёРЅС‚СЂСѓРґ", "СЃС‚СЂР°С…РѕРІ", "РІР·РЅРѕСЃ", "РѕС‚РїСѓСЃРє", "Р±РѕР»СЊРЅРёС‡РЅ", "СЃР°РјРѕР·Р°РЅСЏС‚", "С€С‚СЂР°С„"],
};

const NEWS_REFRESH_MS = 15 * 60 * 1000; // 15 РјРёРЅСѓС‚
const NEWS_REQUEST_TIMEOUT = 10000; // 10 СЃРµРєСѓРЅРґ
const NEWS_FETCH_HEADERS = {
  "User-Agent": "business-portal/1.0",
  Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
  "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
};

let newsCache = {
  items: [],
  fetchedAt: 0,
};
const newsSourceCache = {};

function classifyCategory(title = "", description = "", fallback = "business") {
  const text = `${title} ${description}`.toLowerCase();
  if (NEWS_CATEGORIES.tax?.some((k) => text.includes(k))) return "tax";
  if (NEWS_CATEGORIES.hr?.some((k) => text.includes(k))) return "hr";
  return fallback;
}

function hashId(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

const RSS_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "text",
  cdataPropName: "text",
  removeNSPrefix: true,
  trimValues: true,
});

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") return value.text || value["#text"] || "";
  return "";
}

function cleanText(value) {
  return normalizeText(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractLink(linkField) {
  if (!linkField) return "";
  if (typeof linkField === "string") return linkField;
  if (Array.isArray(linkField)) {
    const alt = linkField.find((l) => l?.["@_rel"] === "alternate") || linkField[0];
    return alt?.["@_href"] || normalizeText(alt?.text);
  }
  return linkField["@_href"] || normalizeText(linkField.text);
}

function pickTag(block, tag) {
  const regexCdata = new RegExp(`<${tag}>\\s*<!\\[CDATA\\[(.*?)\\]\\]>\\s*<\\/${tag}>`, "is");
  const regexSimple = new RegExp(`<${tag}[^>]*>(.*?)<\\/${tag}>`, "is");
  const mC = block.match(regexCdata);
  if (mC) return mC[1].trim();
  const m = block.match(regexSimple);
  return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
}

function parseRssFallback(xml, source) {
  const items = [];
  const parts = xml.split(/<item[^>]*>/i).slice(1);
  for (const raw of parts) {
    const block = raw.split(/<\/item>/i)[0];
    const title = pickTag(block, "title");
    const link = pickTag(block, "link") || pickTag(block, "guid");
    const pubDate = pickTag(block, "pubDate") || pickTag(block, "dc:date");
    const desc = pickTag(block, "description");
    const summary = desc ? desc.replace(/\s+/g, " ").trim().slice(0, 300) : undefined;
    if (!title || !link) continue;
    items.push({
      id: hashId(link || title),
      title,
      source: source.name,
      link,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      summary,
      category: classifyCategory(title, desc, source.defaultCategory || "business"),
    });
  }
  return items;
}

function parseRss(xml, source) {
  const items = [];
  const data = RSS_PARSER.parse(xml);
  const rss = data?.rss;
  const feed = data?.feed;
  const channel = rss ? (Array.isArray(rss.channel) ? rss.channel[0] : rss.channel) : feed;
  const rawItems = channel?.item || channel?.entry || [];
  const list = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  for (const item of list) {
    const title = cleanText(item?.title);
    const link = extractLink(item?.link) || normalizeText(item?.guid);
    const pubDate =
      normalizeText(item?.pubDate) || normalizeText(item?.published) || normalizeText(item?.updated);
    const descRaw = normalizeText(item?.description) || normalizeText(item?.summary) || normalizeText(item?.content);
    const summary = descRaw ? cleanText(descRaw).slice(0, 300) : undefined;
    if (!title || !link) continue;
    items.push({
      id: hashId(link || title),
      title,
      source: source.name,
      link,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      summary,
      category: classifyCategory(title, descRaw, source.defaultCategory || "business"),
    });
  }
  if (items.length === 0) {
    return parseRssFallback(xml, source);
  }
  return items;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: NEWS_FETCH_HEADERS,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function refreshNewsCache() {
  try {
    const now = Date.now();
    if (newsCache.items.length && now - newsCache.fetchedAt < NEWS_REFRESH_MS) return newsCache.items;

    const tasks = NEWS_SOURCES.map(async (src) => {
      const cacheKey = src.url;
      const tryFetch = async (url, label) => {
        const xml = await fetchWithTimeout(url, NEWS_REQUEST_TIMEOUT);
        const items = parseRss(xml, src);
        if (items.length === 0) {
          console.log(`[News] fetched 0 items from ${src.name}${label ? ` (${label})` : ""}`);
        } else {
          console.log(`[News] fetched ${items.length} items from ${src.name}${label ? ` (${label})` : ""}`);
        }
        return items;
      };

      try {
        let items = await tryFetch(src.url, "primary");
        if (items.length === 0 && Array.isArray(src.fallbackUrls)) {
          for (const fallbackUrl of src.fallbackUrls) {
            try {
              items = await tryFetch(fallbackUrl, "fallback");
              if (items.length) break;
            } catch (fallbackErr) {
              console.log("[News] source error", src.name, fallbackErr.message, fallbackErr.cause?.code, fallbackErr.cause?.message);
            }
          }
        }
        if (items.length) {
          newsSourceCache[cacheKey] = items;
          return items;
        }
        return newsSourceCache[cacheKey] || [];
      } catch (err) {
        console.log("[News] source error", src.name, err.message, err.cause?.code, err.cause?.message);
        if (Array.isArray(src.fallbackUrls)) {
          for (const fallbackUrl of src.fallbackUrls) {
            try {
              const items = await tryFetch(fallbackUrl, "fallback");
              if (items.length) {
                newsSourceCache[cacheKey] = items;
                return items;
              }
            } catch (fallbackErr) {
              console.log("[News] source error", src.name, fallbackErr.message, fallbackErr.cause?.code, fallbackErr.cause?.message);
            }
          }
        }
        return newsSourceCache[cacheKey] || [];
      }
    });

    const results = await Promise.allSettled(tasks);
    const collected = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

    const seen = new Set();
    const unique = [];
    for (const item of collected) {
      const key = item.link || item.title;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    }

    unique.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    newsCache = { items: unique.slice(0, 50), fetchedAt: now };
    return newsCache.items;
  } catch (err) {
    console.error("[News] refresh error:", err);
    return newsCache.items;
  }
}

setInterval(refreshNewsCache, NEWS_REFRESH_MS);
refreshNewsCache();
const SAFETY_RESOURCES = {
  instructions: [
    {
      title: "РРЅСЃС‚СЂСѓРєС†РёСЏ РћРў: РєР»Р°РґРѕРІС‰РёРє (СЃРєР»Р°Рґ)",
      description: "РРЅСЃС‚СЂСѓРєС†РёСЏ РїРѕ РѕС…СЂР°РЅРµ С‚СЂСѓРґР° РґР»СЏ РєР»Р°РґРѕРІС‰РёРєРѕРІ СЃРєР»Р°РґР°.",
      file: "/templates/РРЅСЃС‚СЂСѓРєС†РёСЏ_РћРў_РљР»Р°РґРѕРІС‰РёРє_РЎРєР»Р°Рґ.docx",
    note: "",
    },
    {
      title: "РРЅСЃС‚СЂСѓРєС†РёСЏ РћРў: РіСЂСѓР·С‡РёРє (СЃРєР»Р°Рґ)",
      description: "РРЅСЃС‚СЂСѓРєС†РёСЏ РїРѕ РѕС…СЂР°РЅРµ С‚СЂСѓРґР° РґР»СЏ РіСЂСѓР·С‡РёРєРѕРІ СЃРєР»Р°РґР°.",
      file: "/templates/РРЅСЃС‚СЂСѓРєС†РёСЏ_РћРў_Р“СЂСѓР·С‡РёРє_РЎРєР»Р°Рґ.docx",
    note: "",
    },
  ],
  journals: [
    {
      title: "Р–СѓСЂРЅР°Р» СЂРµРіРёСЃС‚СЂР°С†РёРё РІРІРѕРґРЅРѕРіРѕ РёРЅСЃС‚СЂСѓРєС‚Р°Р¶Р°",
      description: "РџСѓСЃС‚РѕР№ Р¶СѓСЂРЅР°Р» РґР»СЏ С„РёРєСЃР°С†РёРё РІРІРѕРґРЅРѕРіРѕ РёРЅСЃС‚СЂСѓРєС‚Р°Р¶Р° (Р¤РРћ, РґР°С‚Р°, РїРѕРґРїРёСЃРё).",
      file: "/templates/Р–СѓСЂРЅР°Р»_Р’РІРѕРґРЅС‹Р№_РРЅСЃС‚СЂСѓРєС‚Р°Р¶_РћРў.docx",
    note: "",
    },
    {
      title: "Р–СѓСЂРЅР°Р» РёРЅСЃС‚СЂСѓРєС‚Р°Р¶РµР№ РЅР° СЂР°Р±РѕС‡РµРј РјРµСЃС‚Рµ",
      description: "РЈС‡РµС‚ РїРµСЂРІРёС‡РЅС‹С… Рё РїРѕРІС‚РѕСЂРЅС‹С… РёРЅСЃС‚СЂСѓРєС‚Р°Р¶РµР№ РЅР° СЃРєР»Р°РґРµ Рё РІ РїРѕРіСЂСѓР·РѕС‡РЅРѕ-СЂР°Р·РіСЂСѓР·РѕС‡РЅРѕР№ Р·РѕРЅРµ.",
      file: "/templates/Р–СѓСЂРЅР°Р»_РРЅСЃС‚СЂСѓРєС‚Р°Р¶_РќР°_Р Р°Р±РѕС‡РµРј_РњРµСЃС‚Рµ_РћРў.docx",
    note: "",
    },
    {
      title: "Р–СѓСЂРЅР°Р» СЂРµРіРёСЃС‚СЂР°С†РёРё С†РµР»РµРІС‹С… РёРЅСЃС‚СЂСѓРєС‚Р°Р¶РµР№",
      description: "РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РґР»СЏ С†РµР»РµРІС‹С… РёРЅСЃС‚СЂСѓРєС‚Р°Р¶РµР№ РїСЂРё РІРЅРµРїР»Р°РЅРѕРІС‹С… СЂР°Р±РѕС‚Р°С… Рё РџР Р .",
      file: "/templates/Р–СѓСЂРЅР°Р»_Р¦РµР»РµРІРѕР№_РРЅСЃС‚СЂСѓРєС‚Р°Р¶_РћРў.docx",
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
    const due = addDays(new Date(), SAFETY_FIRST_DUE_DAYS); // РїРµСЂРІР°СЏ РґР°С‚Р° РєРѕРЅС‚СЂРѕР»СЏ вЂ” С‡РµСЂРµР· 3 РґРЅСЏ
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

// РЅРѕСЂРјР°Р»РёР·СѓРµРј dueDate Сѓ СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёС… РёРЅСЃС‚СЂСѓРєС‚Р°Р¶РµР№ (РїРѕСЃР»Рµ РёР·РјРµРЅРµРЅРёСЏ РїРµСЂРёРѕРґРёС‡РЅРѕСЃС‚Рё)
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

// ---------- РћРҐР РђРќРђ РўР РЈР”Рђ (РёРЅСЃС‚СЂСѓРєС†РёРё) ----------
app.get("/api/safety/instructions", auth, requireHr, async (req, res) => {
  try {
    await ensureSafetyInstructions();
    const instructions = await prisma.safetyInstruction.findMany({
      orderBy: { id: "asc" },
    });

    // РѕР±РѕРіР°С‰Р°РµРј РїРѕР»РµР·РЅС‹РјРё РїРѕР»СЏРјРё РґР»СЏ С„СЂРѕРЅС‚Р°
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

// ---------- РќРѕРІРѕСЃС‚Рё ----------
app.get("/api/news", auth, async (req, res) => {
  try {
    const category = String(req.query.category || "").toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const items = await refreshNewsCache();
    let list = items || [];
    if (["business", "tax", "hr"].includes(category)) {
      list = list.filter((item) => item.category === category);
    }
    res.json({ items: list.slice(0, limit) });
  } catch (err) {
    console.error("news endpoint error:", err);
    res.status(500).json({ items: [], message: "РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ РЅРѕРІРѕСЃС‚Рё" });
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

      // С‚СЏРЅРµРј РёРЅСЃС‚СЂСѓРєС‚Р°Р¶, С‡С‚РѕР±С‹ РїРѕРЅСЏС‚СЊ РїРµСЂРёРѕРґРёС‡РЅРѕСЃС‚СЊ
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
      return res.status(400).json({ message: "??? ?????????? ?? ?????? Telegram ID" });
    }
    if (!assignment.dueDate) {
      return res.status(400).json({ message: "??? ???? ??????????? ???????????" });
    }

    await sendSafetyReminderForAssignment(assignment, true);
    return res.json({ message: "??????????? ??????????" });
  } catch (err) {
    console.error("manual remind error:", err);
    return res.status(500).json({ message: "Failed to send reminder" });
  }
});

function isWarehouseManager(user) {
  const roles = new Set();
  if (user?.role) roles.add(user.role);
  if (Array.isArray(user?.roles)) {
    user.roles.forEach((r) => roles.add(r));
  }
  return roles.has("WAREHOUSE") || roles.has("ADMIN");
}

async function getOrCreateReceivingLocation() {
  const code = "RECEIVING";
  let location = await prisma.warehouseLocation.findFirst({
    where: { code },
  });
  if (!location) {
    location = await prisma.warehouseLocation.create({
      data: {
        code,
        name: "Р—РѕРЅР° РїСЂРёРµРјРєРё",
      },
    });
  }
  return location;
}


function buildReceiveActHtml(order, rows, orgInfo) {
  const safeOrg = {
    name: orgInfo?.orgName || orgInfo?.name || "РћСЂРіР°РЅРёР·Р°С†РёСЏ",
    legalAddress: orgInfo?.legalAddress || "",
    actualAddress: orgInfo?.actualAddress || "",
    inn: orgInfo?.inn || "",
    kpp: orgInfo?.kpp || "",
    phone: orgInfo?.phone || "",
  };

  const actDate = new Date();
  const actDateStr = actDate.toLocaleDateString("ru-RU");
  const orderDateStr = order?.date
    ? new Date(order.date).toLocaleDateString("ru-RU")
    : "";

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
    ? `<tr><td>РўРµР».: ${safeOrg.phone}</td></tr>`
    : "";

  return `
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>РђРљРў Р’РћР—Р’Р РђРўРђ РўРћР’РђР Рђ в„– ${order?.number || ""} РѕС‚ ${actDateStr}</title>
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
      <tr><td>Р®СЂРёРґРёС‡РµСЃРєРёР№ Р°РґСЂРµСЃ: ${safeOrg.legalAddress}</td></tr>
      <tr><td>Р¤Р°РєС‚РёС‡РµСЃРєРёР№ Р°РґСЂРµСЃ: ${safeOrg.actualAddress}</td></tr>
      <tr><td>РРќРќ ${safeOrg.inn}&nbsp;&nbsp;&nbsp;&nbsp;РљРџРџ ${safeOrg.kpp}</td></tr>
      ${phoneRow}
    </table>

    <div class="title">
      РђРљРў Р’РћР—Р’Р РђРўРђ РўРћР’РђР Рђ в„– ${order?.number || ""} РѕС‚ ${actDateStr}
    </div>

    <div class="small" style="margin-bottom:4px;">
      РџРѕСЃС‚Р°РІС‰РёРє: ${order?.supplier?.name || ""}
    </div>
    <div class="small" style="margin-bottom:8px;">
      Р”РѕРєСѓРјРµРЅС‚: Р·Р°РєР°Р· РїРѕСЃС‚Р°РІС‰РёРєСѓ в„– ${order?.number || ""} РѕС‚ ${orderDateStr}
    </div>

    <div class="small" style="margin-bottom:6px;">
      РџСЂРё РѕС†РµРЅРєРµ РєР°С‡РµСЃС‚РІР° РїРѕСЃС‚Р°РІР»РµРЅРЅРѕРіРѕ С‚РѕРІР°СЂР° Р·Р°С„РёРєСЃРёСЂРѕРІР°РЅС‹ СЃР»РµРґСѓСЋС‰РёРµ РЅРµРґРѕСЃС‚Р°С‚РєРё:
    </div>

    <table class="act-table">
      <tr>
        <th style="width:30px;">в„– Рї/Рї</th>
        <th>РќР°РёРјРµРЅРѕРІР°РЅРёРµ С‚РѕРІР°СЂР°</th>
        <th style="width:140px;">РљРѕР»РёС‡РµСЃС‚РІРѕ, С€С‚. (РїРѕ РЅР°РєР»Р°РґРЅРѕР№)</th>
        <th style="width:120px;">РљРѕР»РёС‡РµСЃС‚РІРѕ, С€С‚. (С„Р°РєС‚РёС‡РµСЃРєРё)</th>
        <th style="width:150px;">РљРѕР»РёС‡РµСЃС‚РІРѕ С‚РѕРІР°СЂР° СЃ РЅРµРґРѕСЃС‚Р°С‚РєР°РјРё, С€С‚.</th>
        <th style="width:140px;">Р—Р°РєР»СЋС‡РµРЅРёРµ, РїСЂРёРјРµС‡Р°РЅРёРµ</th>
      </tr>
      ${rowsHtml}
      <tr>
        <td colspan="2" style="text-align:right;font-weight:bold;">РС‚РѕРіРѕ:</td>
        <td style="text-align:center;font-weight:bold;">${totalOrdered}</td>
        <td style="text-align:center;font-weight:bold;">${totalReceived}</td>
        <td style="text-align:center;font-weight:bold;">${totalDiff}</td>
        <td></td>
      </tr>
    </table>

    <div class="small" style="margin-top:16px;">
      РџСЂРёС‡РёРЅС‹ РЅРµРґРѕСЃС‚Р°С‡Рё С‚РѕРІР°СЂР° РјРѕРіСѓС‚ Р±С‹С‚СЊ РІС‹СЏРІР»РµРЅС‹ РїРѕСЃР»Рµ РІСЃРєСЂС‹С‚РёСЏ С‚Р°СЂС‹ Рё РїРµСЂРµСЃС‡РµС‚Р° С‚РѕРІР°СЂР°.
    </div>

    <div class="signs">
      <div class="sign">
        <div>РџРѕР»СѓС‡Р°С‚РµР»СЊ</div>
        <div class="line"></div>
        <div class="small">РґРѕР»Р¶РЅРѕСЃС‚СЊ / РїРѕРґРїРёСЃСЊ / Р¤.Р.Рћ.</div>
        <div class="small" style="margin-top:6px;">Рњ.Рџ.</div>
      </div>
      <div class="sign">
        <div>РџСЂРµРґСЃС‚Р°РІРёС‚РµР»СЊ РїРѕСЃС‚Р°РІС‰РёРєР° (СЌРєСЃРїРµРґРёС‚РѕСЂ)</div>
        <div class="line"></div>
        <div class="small">РґРѕР»Р¶РЅРѕСЃС‚СЊ / РїРѕРґРїРёСЃСЊ / Р¤.Р.Рћ.</div>
      </div>
    </div>

    <button class="print-btn" onclick="window.print()">РџРµС‡Р°С‚СЊ</button>
  </div>
</body>
</html>
  `;
}

// ================== TELEGRAM Р‘РћРў (РўР•РЎРўРћР’Р«Р™) ==================

const TELEGRAM_BOT_TOKEN =
  "8254839296:AAGnAvL09dFoMyHzIyRqi2FZ11G6tJgDee4";
const TELEGRAM_GROUP_CHAT_ID = "-4974442288";
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// СѓРЅРёРІРµСЂСЃР°Р»СЊРЅР°СЏ РѕС‚РїСЂР°РІРєР° СЃРѕРѕР±С‰РµРЅРёСЏ
async function sendTelegramMessage(chatId, text, extra = {}) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !chatId) {
      console.log("[Telegram] TOKEN РёР»Рё chatId РЅРµ СѓРєР°Р·Р°РЅ, РѕС‚РїСЂР°РІРєР° РїСЂРѕРїСѓС‰РµРЅР°");
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
      console.error("[Telegram] РћС€РёР±РєР° РѕС‚РїСЂР°РІРєРё:", data);
    }
  } catch (err) {
    console.error("[Telegram] РћС€РёР±РєР°:", err);
  }
}

// РЈРґРѕР±РЅР°СЏ РѕР±С‘СЂС‚РєР°: РѕС‚РїСЂР°РІРёС‚СЊ СЃРѕРѕР±С‰РµРЅРёРµ РёРјРµРЅРЅРѕ РІ СЃРєР»Р°РґСЃРєРѕР№ РіСЂСѓРїРїРѕРІРѕР№ С‡Р°С‚
function sendWarehouseGroupMessage(text, extra = {}) {
  return sendTelegramMessage(TELEGRAM_GROUP_CHAT_ID, text, extra);
}

async function sendSafetyReminderForAssignment(a, force = false) {
  if (!a?.employee?.telegramChatId || !a.dueDate) return false;
  const now = new Date();
  const due = new Date(a.dueDate);
  const diffDays = Math.floor((due - now) / (1000 * 60 * 60 * 24));
  if (!force && diffDays > 3) return false; // РЅР°С‡РёРЅР°РµРј Р·Р° 3 РґРЅСЏ

  if (!force && a.lastReminderAt) {
    const last = new Date(a.lastReminderAt);
    const hoursSince = (now - last) / (1000 * 60 * 60);
    if (hoursSince < 20) return false; // РЅРµ С‡Р°С‰Рµ СЂР°Р·Р° РІ СЃСѓС‚РєРё
  }

  const text = [
    `РќР°РїРѕРјРёРЅР°РЅРёРµ РїРѕ РёРЅСЃС‚СЂСѓРєС‚Р°Р¶Сѓ: ${a.instruction?.title || "РёРЅСЃС‚СЂСѓРєС‚Р°Р¶"}`,
    `РЎРѕС‚СЂСѓРґРЅРёРє: ${a.employee.fullName}`,
    `РЎСЂРѕРє: ${due.toLocaleDateString("ru-RU")}`,
    diffDays >= 0 ? `РћСЃС‚Р°Р»РѕСЃСЊ РґРЅРµР№: ${diffDays + 1}` : `РџСЂРѕСЃСЂРѕС‡РµРЅРѕ РЅР° ${Math.abs(diffDays)} РґРЅ.`,
    "",
    "РџРѕСЃР»Рµ РїСЂРѕС…РѕР¶РґРµРЅРёСЏ РїРѕСЃС‚Р°РІСЊС‚Рµ СЃС‚Р°С‚СѓСЃ В«РџСЂРѕР№РґРµРЅВ».",
  ].join("\n");

  await sendTelegramMessage(a.employee.telegramChatId, text);
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

setInterval(sendSafetyReminders, 1000 * 60 * 60); // СЂР°Р· РІ С‡Р°СЃ
sendSafetyReminders();

// РѕР±СЂР°Р±РѕС‚РєР° callback_query (РєРЅРѕРїРєР° "вњ… Р’С‹РїРѕР»РЅРµРЅРѕ")
async function handleTelegramUpdate(update) {
  if (!update.callback_query) return;

  const { id: callbackId, data, from } = update.callback_query;

  if (!data || !data.startsWith("done:")) {
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
          text: "Р—Р°РґР°С‡Р° РЅРµ РЅР°Р№РґРµРЅР°",
          show_alert: true,
        }),
      });
      return;
    }

    // РїСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РЅР°Р¶Р°Р» РёРјРµРЅРЅРѕ РёСЃРїРѕР»РЅРёС‚РµР»СЊ (РµСЃР»Рё executorChatId Р·Р°РґР°РЅ)
    if (
      task.executorChatId &&
      String(task.executorChatId) !== String(from.id)
    ) {
      await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackId,
          text: "Р­С‚Р° Р·Р°РґР°С‡Р° РЅР°Р·РЅР°С‡РµРЅР° РґСЂСѓРіРѕРјСѓ СЃРѕС‚СЂСѓРґРЅРёРєСѓ.",
          show_alert: true,
        }),
      });
      return;
    }

    // РѕР±РЅРѕРІР»СЏРµРј СЃС‚Р°С‚СѓСЃ Р·Р°РґР°С‡Рё
    await prisma.warehouseTask.update({
      where: { id: taskId },
      data: {
        status: "DONE",
        lastReminderAt: null,
      },
    });

    // РµСЃР»Рё Р·Р°РґР°С‡Р° СЃРѕР·РґР°РЅР° РїРѕ Р·Р°СЏРІРєРµ РЅР° СЃРєР»Р°Рґ вЂ” Р°РІС‚Рѕ-РїСЂРѕРІРµРґРµРЅРёРµ Р·Р°СЏРІРєРё РїРѕ СЃРєР»Р°РґСѓ
    try {
      // title РІРёРґР°: "Р—Р°СЏРІРєР° РЅР° СЃРєР»Р°Рґ #19: ... "
      const match = task.title.match(/Р—Р°СЏРІРєР° РЅР° СЃРєР»Р°Рґ #(\d+)/);
      if (match && task.assignerId) {
        const requestId = Number(match[1]);
        if (requestId) {
          await autoPostRequestToStock(requestId, task.assignerId);
        }
      }
    } catch (e) {
      console.error("[Telegram] autoPostRequestFromTask error:", e);
    }

    // РѕС‚РІРµС‚РёРј РўРµР»РµРіСЂР°РјСѓ, С‡С‚РѕР±С‹ СѓР±СЂР°Р»РёСЃСЊ "С‡Р°СЃРёРєРё" РЅР° РєРЅРѕРїРєРµ
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackId,
        text: "Р—Р°РґР°С‡Р° РѕС‚РјРµС‡РµРЅР° РєР°Рє РІС‹РїРѕР»РЅРµРЅРЅР°СЏ вњ…",
        show_alert: false,
      }),
    });

    // РёСЃРїРѕР»РЅРёС‚РµР»СЋ
    await sendTelegramMessage(
      from.id,
      `вњ… Р—Р°РґР°С‡Р° <b>${task.title}</b> РѕС‚РјРµС‡РµРЅР° РєР°Рє РІС‹РїРѕР»РЅРµРЅРЅР°СЏ.`
    );

    // РІ РіСЂСѓРїРїСѓ
    await sendWarehouseGroupMessage(
      `вњ… Р—Р°РґР°С‡Р° СЃРєР»Р°РґР° <b>${task.title}</b> РІС‹РїРѕР»РЅРµРЅР° РёСЃРїРѕР»РЅРёС‚РµР»РµРј.`
    );

    console.log(
      `[Telegram] Р—Р°РґР°С‡Р° ${taskId} РѕС‚РјРµС‡РµРЅР° РєР°Рє РІС‹РїРѕР»РЅРµРЅРЅР°СЏ РїРѕР»СЊР·РѕРІР°С‚РµР»РµРј ${from.id}`
    );
  } catch (err) {
    console.error("[handleTelegramUpdate] РћС€РёР±РєР°:", err);
  }
}

let telegramOffset = 0;

async function startTelegramPolling() {
  console.log("в–¶пёЏ Р—Р°РїСѓСЃРє long polling Telegram...");

  while (true) {
    try {
      const url = `${TELEGRAM_API}/getUpdates?timeout=25&offset=${telegramOffset}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!data.ok) {
        console.error("[startTelegramPolling] РћС‚РІРµС‚ Telegram СЃ РѕС€РёР±РєРѕР№:", data);
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
      console.error("[startTelegramPolling] РћС€РёР±РєР°:", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ================== РќРђРџРћРњРРќРђРќРРЇ РџРћ Р—РђР”РђР§РђРњ РЎРљР›РђР”Рђ ==================

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

      // 1) Р—Р° 5 РјРёРЅСѓС‚ РґРѕ СЃСЂРѕРєР° вЂ” РѕРґРЅРѕ РЅР°РїРѕРјРёРЅР°РЅРёРµ
      if (diffMinutes <= 5 && diffMinutes > 0 && !task.lastReminderAt) {
        const dueStr = due.toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        const baseText =
          "вЏ° <b>РЎРєРѕСЂРѕ СЃСЂРѕРє РїРѕ Р·Р°РґР°С‡Рµ СЃРєР»Р°РґР°</b>\n\n" +
          `рџ“ќ <b>Р—Р°РґР°С‡Р°:</b> ${task.title}\n` +
          (task.executorName
            ? `рџ‘· <b>РСЃРїРѕР»РЅРёС‚РµР»СЊ:</b> ${task.executorName}\n`
            : "") +
          `вЏ° <b>РЎСЂРѕРє:</b> ${dueStr}`;

        await sendWarehouseGroupMessage(baseText);

        if (task.executorChatId) {
          const execText =
            "вЏ° <b>РЈ РІР°СЃ СЃРєРѕСЂРѕ СЃСЂРѕРє РїРѕ Р·Р°РґР°С‡Рµ СЃРєР»Р°РґР°</b>\n\n" +
            `рџ“ќ <b>Р—Р°РґР°С‡Р°:</b> ${task.title}\n` +
            `вЏ° <b>РЎСЂРѕРє:</b> ${dueStr}`;
          await sendTelegramMessage(task.executorChatId, execText);
        }

        await prisma.warehouseTask.update({
          where: { id: task.id },
          data: { lastReminderAt: now },
        });

        continue;
      }

      // 2) РЎСЂРѕРє СѓР¶Рµ РїСЂРѕС€С‘Р» вЂ” РЅР°РїРѕРјРёРЅР°РЅРёРµ СЂР°Р· РІ С‡Р°СЃ
      if (diffMinutes < 0 && minutesSinceLast >= 60) {
        const dueStr = due.toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        const baseText =
          "вљ пёЏ <b>РџСЂРѕСЃСЂРѕС‡РµРЅР° Р·Р°РґР°С‡Р° СЃРєР»Р°РґР°</b>\n\n" +
          `рџ“ќ <b>Р—Р°РґР°С‡Р°:</b> ${task.title}\n` +
          (task.executorName
            ? `рџ‘· <b>РСЃРїРѕР»РЅРёС‚РµР»СЊ:</b> ${task.executorName}\n`
            : "") +
          `вЏ° <b>РЎСЂРѕРє Р±С‹Р»:</b> ${dueStr}`;

        await sendWarehouseGroupMessage(baseText);

        if (task.executorChatId) {
          const execText =
            "вљ пёЏ <b>РЈ РІР°СЃ РїСЂРѕСЃСЂРѕС‡РµРЅР° Р·Р°РґР°С‡Р° СЃРєР»Р°РґР°</b>\n\n" +
            `рџ“ќ <b>Р—Р°РґР°С‡Р°:</b> ${task.title}\n` +
            `вЏ° <b>РЎСЂРѕРє Р±С‹Р»:</b> ${dueStr}`;
          await sendTelegramMessage(task.executorChatId, execText);
        }

        await prisma.warehouseTask.update({
          where: { id: task.id },
          data: { lastReminderAt: now },
        });
      }
    }
  } catch (err) {
    console.error("[checkWarehouseTaskNotifications] РћС€РёР±РєР°:", err);
  }
}

// ================== РђР’РўРћРџР РћР’Р•Р РљРђ РћРЎРўРђРўРљРћР’ (РќРћР’РђРЇ Р§РђРЎРўР¬) ==================

// 1. РџРѕР»СѓС‡РёС‚СЊ С‚РѕРІР°СЂС‹, РіРґРµ С‚РµРєСѓС‰РёР№ РѕСЃС‚Р°С‚РѕРє < minStock
async function getLowStockItems() {
  const items = await prisma.item.findMany({
    where: {
      minStock: { not: null },
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

// 2. РћС‚РїСЂР°РІРёС‚СЊ РѕРґРёРЅ РѕР±С‰РёР№ РѕС‚С‡С‘С‚ РІ СЃРєР»Р°РґСЃРєРѕР№ С‡Р°С‚
async function sendDailyLowStockSummary() {
  try {
    const lowItems = await getLowStockItems();
    const now = new Date();
    const dateStr = now.toLocaleDateString("ru-RU");

    if (lowItems.length === 0) {
      await sendWarehouseGroupMessage(
        `вњ… РќР° РєРѕРЅРµС† РґРЅСЏ (${dateStr}) С‚РѕРІР°СЂРѕРІ РЅРёР¶Рµ РјРёРЅРёРјР°Р»СЊРЅРѕРіРѕ РѕСЃС‚Р°С‚РєР° РЅРµС‚.`
      );
      return;
    }

    let text = `рџ“¦ РЎРїРёСЃРѕРє С‚РѕРІР°СЂРѕРІ РґР»СЏ РґРѕР·Р°РєР°Р·Р° РЅР° ${dateStr}:\n\n`;

    for (const it of lowItems) {
      text += `вЂў ${it.name} вЂ” СЃРµР№С‡Р°СЃ ${it.currentStock} ${it.unit || ""
        }, РјРёРЅРёРјСѓРј ${it.minStock}\n`;
    }

    await sendWarehouseGroupMessage(text);
  } catch (err) {
    console.error("[sendDailyLowStockSummary] РћС€РёР±РєР°:", err);
  }
}

// ================== РђРЈРўР•РќРўРР¤РРљРђР¦РРЇ ==================

// СЂРµРіРёСЃС‚СЂР°С†РёСЏ
app.post("/api/register", async (req, res) => {

  if (process.env.DISABLE_PUBLIC_REGISTER !== "false") {
    return res.status(403).json({
      message: "PUBLIC_REGISTER_DISABLED"
    });
  }

  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res
        .status(400)
        .json({ message: "EMAIL_PASSWORD_NAME_REQUIRED" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res
        .status(400)
        .json({ message: "EMAIL_ALREADY_EXISTS" });
    }

    const hash = await bcrypt.hash(password, 10);
    const orgName = `${name} Organization`;

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password: hash,
          passwordHash: hash,
          name,
          role: "EMPLOYEE",
        },
      });

      const org = await tx.organization.create({
        data: { name: orgName },
      });

      await tx.membership.create({
        data: {
          orgId: org.id,
          userId: user.id,
          role: user.role,
        },
      });

      await tx.subscription.create({
        data: {
          orgId: org.id,
          plan: "basic-30",
          status: "inactive",
          paidUntil: null,
        },
      });

      return { user, org };
    });

    const token = createToken(result.user);

    res.status(201).json({
      message: "REGISTERED",
      token,
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
      },
      orgId: result.org.id
    });
  } catch (err) {
    console.error("register error:", err);
    res.status(500).json({ message: "REGISTER_ERROR" });
  }
});

// Р»РѕРіРёРЅ
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "email Рё РїР°СЂРѕР»СЊ РѕР±СЏР·Р°С‚РµР»СЊРЅС‹" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.isActive === false) {
      return res.status(403).json({ message: "USER_INACTIVE" });
    }
    if (!user) {
      return res
        .status(401)
        .json({ message: "РќРµРІРµСЂРЅС‹Р№ email РёР»Рё РїР°СЂРѕР»СЊ" });
    }

    const storedHash = user.passwordHash || user.password;
    const ok = await bcrypt.compare(password, storedHash);
    if (!ok) {
      return res
        .status(401)
        .json({ message: "РќРµРІРµСЂРЅС‹Р№ email РёР»Рё РїР°СЂРѕР»СЊ" });
    }

    const token = createToken(user);

    const memberships = await prisma.membership.findMany({
      where: { userId: user.id },
      include: { org: true }
    });
    const activeOrgId = memberships[0]?.orgId || null;

    res.json({
      message: "LOGIN_OK",
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      orgId: activeOrgId
    });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё РІС…РѕРґРµ" });
  }
});

// РїСЂРѕС„РёР»СЊ С‚РµРєСѓС‰РµРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
const getMeResponse = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true
      }
    });

    if (!user) {
      return res.status(404).json({ message: "USER_NOT_FOUND" });
    }

    const memberships = await prisma.membership.findMany({
      where: { userId: req.user.id },
      include: { org: true }
    });

    const activeOrgId = req.orgId || memberships[0]?.orgId || null;
    const activeMembership = memberships.find((m) => m.orgId === activeOrgId) || null;
    const subscription = activeOrgId
      ? await prisma.subscription.findFirst({ where: { orgId: activeOrgId } })
      : null;
    const now = new Date();
    const isActive =
      subscription &&
      subscription.status === "active" &&
      subscription.paidUntil &&
      new Date(subscription.paidUntil) > now;

    const roles = [user.role, activeMembership?.role].filter(Boolean);

    return res.json({
      user: { ...user, roles },
      org: activeMembership?.org || null,
      memberships: memberships.map((m) => ({
        orgId: m.orgId,
        orgName: m.org?.name || null,
        role: m.role
      })),
      subscription: subscription
        ? {
            id: subscription.id,
            plan: subscription.plan,
            status: subscription.status,
            paidUntil: subscription.paidUntil,
            isActive
          }
        : { isActive: false }
    });
  } catch (err) {
    console.error("me error:", err);
    return res.status(500).json({ message: "ME_ERROR" });
  }
};

app.get("/api/me", auth, getMeResponse);
app.get("/api/profile", auth, getMeResponse);

app.put("/api/me", auth, async (req, res) => {
  try {
    const { name, password } = req.body || {};
    const data = {};
    let changedPassword = false;

    if (name !== undefined) {
      const trimmed = String(name || "").trim();
      if (!trimmed) {
        return res.status(400).json({ message: "NAME_REQUIRED" });
      }
      data.name = trimmed;
    }

    if (password) {
      if (String(password).length < 6) {
        return res.status(400).json({ message: "PASSWORD_TOO_SHORT" });
      }
      const hash = await bcrypt.hash(password, 10);
      data.password = hash;
      data.passwordHash = hash;
      data.tokenVersion = { increment: 1 };
      changedPassword = true;
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ message: "NO_CHANGES" });
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data
    });

    if (changedPassword) {
      await sendPasswordChangedEmail(updated.email);
    }

    return res.json({
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role
      }
    });
  } catch (err) {
    console.error("me update error:", err);
    return res.status(500).json({ message: "ME_UPDATE_ERROR" });
  }
});



// ===== ORG PROFILE SETTINGS =====
app.get("/api/settings/org-profile", auth, requireAdmin, async (req, res) => {
  try {
    const profile = await prisma.orgProfile.findFirst({
      where: { orgId: req.orgId }
    });
    res.json({ profile: profile || null });
  } catch (err) {
    console.error("org profile get error:", err);
    res.status(500).json({ message: "ORG_PROFILE_GET_ERROR" });
  }
});

app.put("/api/settings/org-profile", auth, requireAdmin, async (req, res) => {
  try {
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

    const profile = await prisma.orgProfile.upsert({
      where: { orgId: req.orgId },
      update: {
        orgName,
        legalAddress,
        actualAddress,
        inn,
        kpp,
        phone: phone || "",
      },
      create: {
        orgId: req.orgId,
        orgName,
        legalAddress,
        actualAddress,
        inn,
        kpp,
        phone: phone || "",
      },
    });

    res.json({ profile });
  } catch (err) {
    console.error("org profile put error:", err);
    res.status(500).json({ message: "ORG_PROFILE_PUT_ERROR" });
  }
});

// DEV: СЃРґРµР»Р°С‚СЊ С‚РµРєСѓС‰РµРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ Р°РґРјРёРЅРѕРј РїРѕ email
app.post("/api/dev/make-me-admin", auth, async (req, res) => {
  try {
    const allowedEmail = "dvinskihsergej9@gmail.com";

    if (req.user.email.toLowerCase() !== allowedEmail.toLowerCase()) {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { role: "ADMIN" },
      select: { id: true, email: true, name: true, role: true },
    });

    res.json({ message: "РўРµРїРµСЂСЊ РІС‹ ADMIN", user });
  } catch (err) {
    console.error("make-me-admin error:", err);
    res
      .status(500)
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё РЅР°Р·РЅР°С‡РµРЅРёРё Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂР°" });
  }
});

app.post("/api/dev/activate-test-subscription", auth, async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "DEV_ONLY" });
    }

    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ message: "ORG_REQUIRED" });
    }

    const now = new Date();
    const existing = await prisma.subscription.findFirst({ where: { orgId } });
    const baseDate =
      existing?.paidUntil && new Date(existing.paidUntil) > now
        ? new Date(existing.paidUntil)
        : now;
    const nextPaidUntil = addDays(baseDate, 30);
    const planId = existing?.plan || "basic-30";

    const subscription = await prisma.subscription.upsert({
      where: { orgId },
      update: {
        status: "active",
        plan: planId,
        paidUntil: nextPaidUntil,
      },
      create: {
        orgId,
        plan: planId,
        status: "active",
        paidUntil: nextPaidUntil,
      },
    });

    return res.json({
      subscription: {
        id: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
        paidUntil: subscription.paidUntil,
        isActive: true,
      },
    });
  } catch (err) {
    console.error("activate test subscription error:", err);
    return res.status(500).json({ message: "TEST_SUBSCRIPTION_ERROR" });
  }
});


// ================== РђР”РњРРќРљРђ РџРћР›Р¬Р—РћР’РђРўР•Р›Р•Р™ ==================

app.get("/api/users", auth, requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
    res.json(users);
  } catch (err) {
    console.error("users list error:", err);
    res
      .status(500)
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№" });
  }
});

app.put("/api/users/:id/role", auth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { role } = req.body;

    if (!["EMPLOYEE", "HR", "ACCOUNTING", "ADMIN"].includes(role)) {
      return res.status(400).json({ message: "РќРµРґРѕРїСѓСЃС‚РёРјР°СЏ СЂРѕР»СЊ" });
    }

    const user = await prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    res.json(user);
  } catch (err) {
    console.error("change role error:", err);
    res.status(500).json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СЃРјРµРЅРµ СЂРѕР»Рё" });
  }
});

const INVITE_ROLES = ["EMPLOYEE", "HR", "ACCOUNTING", "WAREHOUSE", "ADMIN"];

app.get("/api/admin/invites", auth, requireAdmin, async (req, res) => {
  try {
    const items = await prisma.inviteToken.findMany({
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
    const { email, role } = req.body || {};
    if (!email || !role || !INVITE_ROLES.includes(role)) {
      return res.status(400).json({ message: "BAD_INVITE" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "EMAIL_ALREADY_EXISTS" });
    }

    const now = new Date();
    const minuteAgo = new Date(now.getTime() - INVITE_EMAIL_COOLDOWN_MS);

    const recentForEmail = await prisma.inviteToken.count({
      where: {
        email,
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
        email,
        tokenHash,
        role,
        expiresAt,
        createdByUserId: req.user.id,
      },
    });

    const mail = await sendInviteEmail(email, rawToken);

    res.json({
      ok: true,
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      orgName: invite.org?.name || null,
        createdAt: invite.createdAt,
        status: "PENDING",
      },
      mail: {
        sent: !!mail.sent,
        error: mail.sent ? null : mail.error || "MAIL_SEND_FAILED",
      },
    });
  } catch (err) {
    console.error("admin invite create error:", err);
    res.status(500).json({ message: "INVITE_CREATE_ERROR" });
  }
});

app.post("/api/admin/invites/:id/resend", auth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_INVITE_ID" });
    }

    const invite = await prisma.inviteToken.findUnique({ where: { id } });
    if (!invite) {
      return res.status(404).json({ message: "INVITE_NOT_FOUND" });
    }

    const now = new Date();
    const minuteAgo = new Date(now.getTime() - INVITE_EMAIL_COOLDOWN_MS);

    const recentForEmail = await prisma.inviteToken.count({
      where: {
        email: invite.email,
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
        tokenHash,
        role: invite.role,
        expiresAt,
        createdByUserId: req.user.id,
      },
    });

    const mail = await sendInviteEmail(invite.email, rawToken);

    res.json({
      ok: true,
      invite: {
        id: nextInvite.id,
        email: nextInvite.email,
        role: nextInvite.role,
        expiresAt: nextInvite.expiresAt,
        createdAt: nextInvite.createdAt,
        status: "PENDING",
      },
      mail: {
        sent: !!mail.sent,
        error: mail.sent ? null : mail.error || "MAIL_SEND_FAILED",
      },
    });
  } catch (err) {
    console.error("admin invite resend error:", err);
    res.status(500).json({ message: "INVITE_RESEND_ERROR" });
  }
});

app.post("/api/debug/mail-test", auth, requireAdmin, async (req, res) => {
  try {
    const { email } = req.body || {};
    const target = String(email || "").trim();
    if (!target) {
      return res.status(400).json({ message: "BAD_EMAIL" });
    }

    const transport = getMailTransport();
    if (!transport) {
      console.log(`[MAIL] test skipped (mailer disabled) to=${target}`);
      return res.json({ sent: false, error: "MAIL_DISABLED" });
    }

    const from = process.env.MAIL_FROM || `Business Portal <${process.env.MAIL_USER}>`;
    const subject = "Тестовое письмо Business Portal";
    const text = "Это тестовое письмо. Если вы его получили, SMTP настроен корректно.";

    await transport.sendMail({ from, to: target, subject, text });
    console.log(`[MAIL] test sent to=${target}`);
    return res.json({ sent: true });
  } catch (err) {
    console.log(
      `[MAIL] test failed: code=${err?.code || "-"} message=${err?.message || err}`
    );
    return res.json({ sent: false, error: err?.code || err?.message || "MAIL_SEND_FAILED" });
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
      include: { org: true },
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
      orgName: invite.org?.name || null,
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
      include: { org: true }
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

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({
        where: { email: invite.email },
      });

      let user = existingUser;
      if (existingUser) {
        if (!existingUser.isActive) {
          user = await tx.user.update({
            where: { id: existingUser.id },
            data: {
              name: name || existingUser.name,
              role: invite.role,
              password: passwordHash,
              passwordHash,
              isActive: true,
              emailVerifiedAt: now,
            },
          });
        }
      } else {
        user = await tx.user.create({
          data: {
            email: invite.email,
            name: name || invite.email,
            role: invite.role,
            password: passwordHash,
            passwordHash,
            isActive: true,
            emailVerifiedAt: now,
          },
        });
      }

      await tx.membership.upsert({
        where: {
          orgId_userId: {
            orgId: invite.orgId,
            userId: user.id,
          },
        },
        update: { role: invite.role },
        create: {
          orgId: invite.orgId,
          userId: user.id,
          role: invite.role,
        },
      });

      await tx.inviteToken.update({
        where: { id: invite.id },
        data: { usedAt: now },
      });
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
    const normalized = String(email || "").trim().toLowerCase();
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

    const user = await prisma.user.findUnique({ where: { email: normalized } });
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
  const invalidMessage = "Ссылка недействительна или истекла.";
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ message: invalidMessage });
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
      return res.status(400).json({ message: invalidMessage });
    }

    const hash = await bcrypt.hash(String(newPassword), 10);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: resetToken.userId },
        data: {
          password: hash,
          passwordHash: hash,
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
    res.status(500).json({ message: invalidMessage });
  }
});

// ===== BILLING / YOOKASSA =====
function parseYookassaMetadata(metadata) {
  const orgId = Number(metadata?.orgId || 0);
  const planId = metadata?.planId ? String(metadata.planId) : null;
  const days = Number(metadata?.days || 0);
  const localPaymentId = Number(metadata?.localPaymentId || 0) || null;
  return {
    orgId: Number.isFinite(orgId) && orgId > 0 ? orgId : null,
    planId,
    days: Number.isFinite(days) && days > 0 ? days : null,
    localPaymentId,
  };
}

function validatePlanMetadata(plan, metadata) {
  if (!plan || !metadata.planId || !metadata.days) return false;
  return plan.id === metadata.planId && Number(plan.days) === Number(metadata.days);
}

app.post("/api/billing/yookassa/create-payment", auth, async (req, res) => {
  try {
    const { planId } = req.body || {};
    const plan = getPlan(planId);
    if (!plan) {
      return res.status(400).json({ message: "PLAN_NOT_FOUND" });
    }

    logBilling("billing.create_payment.request", {
      orgId: req.orgId,
      userId: req.user.id,
      planId: plan.id,
    });

    const tempProviderId = `pending_${crypto.randomUUID()}`;
    const localPayment = await prisma.payment.create({
      data: {
        orgId: req.orgId,
        userId: req.user.id,
        provider: "yookassa",
        providerPaymentId: tempProviderId,
        amount: plan.amount,
        currency: plan.currency,
        status: "pending",
        metadata: {
          planId: plan.id,
          days: plan.days,
        },
      },
    });

    const payment = await yookassaRequest(
      "POST",
      "/payments",
      {
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
          orgId: String(req.orgId),
          planId: plan.id,
          days: String(plan.days),
          localPaymentId: String(localPayment.id),
        },
      },
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

    logBilling("billing.create_payment.created", {
      orgId: req.orgId,
      userId: req.user.id,
      planId: plan.id,
      localPaymentId: localPayment.id,
      providerPaymentId: payment.id,
      status: payment.status || "pending",
    });

    return res.json({
      confirmationUrl: payment.confirmation?.confirmation_url || null,
      paymentId: payment.id,
      localPaymentId: localPayment.id,
    });
  } catch (err) {
    logBilling("billing.create_payment.error", {
      orgId: req.orgId,
      error: err?.message || String(err),
    });
    console.error("create payment error:", err);
    return res.status(500).json({ message: "PAYMENT_CREATE_ERROR" });
  }
});

app.get("/api/billing/yookassa/payment-status", auth, async (req, res) => {
  try {
    const paymentId = String(req.query.paymentId || "").trim();
    if (!paymentId) {
      return res.status(400).json({ message: "PAYMENT_ID_REQUIRED" });
    }

    let paymentRecord = null;
    if (/^\d+$/.test(paymentId)) {
      paymentRecord = await prisma.payment.findUnique({
        where: { id: Number(paymentId) },
      });
    }
    if (!paymentRecord) {
      paymentRecord = await prisma.payment.findFirst({
        where: { providerPaymentId: paymentId },
      });
    }
    if (!paymentRecord) {
      return res.status(404).json({ message: "PAYMENT_NOT_FOUND" });
    }
    if (paymentRecord.orgId !== req.orgId) {
      return res.status(403).json({ message: "PAYMENT_FORBIDDEN" });
    }

    logBilling("billing.status.check", {
      orgId: req.orgId,
      paymentId: paymentRecord.id,
      providerPaymentId: paymentRecord.providerPaymentId,
    });

    const providerPaymentId = paymentRecord.providerPaymentId;
    const providerPayment = await fetchYookassaPayment(providerPaymentId);
    const metadata = parseYookassaMetadata(providerPayment.metadata || {});
    const plan = getPlan(metadata.planId || paymentRecord.metadata?.planId);
    if (!plan) {
      return res.status(400).json({ message: "PLAN_NOT_FOUND" });
    }

    if (!validatePlanMetadata(plan, metadata)) {
      return res.status(400).json({ message: "PAYMENT_METADATA_MISMATCH" });
    }

    if (metadata.orgId && metadata.orgId !== paymentRecord.orgId) {
      return res.status(400).json({ message: "PAYMENT_ORG_MISMATCH" });
    }

    const expectedAmount = formatAmount(plan.amount);
    if (providerPayment.amount?.currency !== plan.currency || providerPayment.amount?.value !== expectedAmount) {
      return res.status(400).json({ message: "PAYMENT_AMOUNT_MISMATCH" });
    }

    logBilling("billing.status.provider", {
      orgId: req.orgId,
      paymentId: paymentRecord.id,
      providerPaymentId,
      status: providerPayment.status,
      paid: providerPayment.paid || false,
    });

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
    logBilling("billing.status.error", {
      error: err?.message || String(err),
    });
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

    logBilling("billing.webhook.received", { providerPaymentId });

    const providerPayment = await fetchYookassaPayment(providerPaymentId);
    const metadata = parseYookassaMetadata(providerPayment.metadata || {});
    const plan = getPlan(metadata.planId);
    if (!plan) {
      return res.status(400).json({ message: "PLAN_NOT_FOUND" });
    }

    if (!validatePlanMetadata(plan, metadata) || !metadata.orgId) {
      return res.status(400).json({ message: "PAYMENT_METADATA_MISMATCH" });
    }

    const org = await prisma.organization.findUnique({
      where: { id: metadata.orgId },
    });
    if (!org) {
      return res.status(400).json({ message: "ORG_NOT_FOUND" });
    }

    const expectedAmount = formatAmount(plan.amount);
    if (providerPayment.amount?.currency !== plan.currency || providerPayment.amount?.value !== expectedAmount) {
      return res.status(400).json({ message: "PAYMENT_AMOUNT_MISMATCH" });
    }

    logBilling("billing.webhook.verified", {
      providerPaymentId,
      orgId: metadata.orgId,
      planId: plan.id,
      status: providerPayment.status,
      paid: providerPayment.paid || false,
      amount: providerPayment.amount?.value,
      currency: providerPayment.amount?.currency,
    });

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
          orgId: metadata.orgId,
          userId: null,
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

    if (paymentRecord.orgId !== metadata.orgId) {
      return res.status(400).json({ message: "PAYMENT_ORG_MISMATCH" });
    }

    if (paymentRecord.status === "succeeded") {
      logBilling("billing.webhook.idempotent", {
        paymentId: paymentRecord.id,
        providerPaymentId,
      });
      return res.json({ ok: true });
    }

    const subscription = await prisma.subscription.findFirst({
      where: { orgId: metadata.orgId },
    });
    if (!subscription) {
      await prisma.subscription.create({
        data: {
          orgId: metadata.orgId,
          plan: plan.id,
          status: "inactive",
          paidUntil: null,
        },
      });
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
    logBilling("billing.webhook.error", {
      error: err?.message || String(err),
    });
    console.error("yookassa webhook error:", err);
    return res.status(500).json({ message: "WEBHOOK_ERROR" });
  }
});



// ================== ???????T????????'?????: ????"???'????????T???T???? ==================
// ================== РЎРљР›РђР”: Р—РђРЇР’РљР ==================

// СЃРѕР·РґР°С‚СЊ Р·Р°СЏРІРєСѓ РЅР° СЃРєР»Р°Рґ

// ================== HR: employees ==================

app.get("/api/hr/employees", auth, requireHr, async (req, res) => {
  try {
    const { status, search } = req.query || {};

    const clauses = [];
    const params = [];
    if (status && status !== "ALL") {
      clauses.push(`status = ?`);
      params.push(status);
    }
    if (search) {
      clauses.push(`LOWER(fullName) LIKE ?`);
      params.push(`%${String(search).toLowerCase()}%`);
    }
    const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const employees =
      (await prisma.$queryRawUnsafe(
        `SELECT * FROM Employee ${whereSql} ORDER BY createdAt DESC`,
        ...params
      )) || [];

    res.json(employees);
  } catch (err) {
    console.error("employees list error:", err);
    res.status(500).json({ message: "Failed to load employees" });
  }
});

app.post("/api/hr/employees", auth, requireHr, async (req, res) => {
  try {
    const { fullName, position, department, status, hiredAt, birthDate, telegramChatId } =
      req.body || {};

    if (
      !fullName?.trim() ||
      !position?.trim() ||
      !department?.trim() ||
      !telegramChatId?.trim() ||
      !hiredAt ||
      !birthDate
    ) {
      return res.status(400).json({ message: "Р—Р°РїРѕР»РЅРёС‚Рµ РІСЃРµ РїРѕР»СЏ, РІРєР»СЋС‡Р°СЏ Telegram ID." });
    }

    const allowedStatuses = ["ACTIVE", "FIRED"];
    const normalizedStatus = allowedStatuses.includes(status)
      ? status
      : "ACTIVE";

    const hiredDate = parseDateInput(hiredAt);
    const birth = parseDateInput(birthDate);
    if (!hiredDate || !birth) {
      return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°С‚С‹ РїСЂРёРµРјР° РёР»Рё СЂРѕР¶РґРµРЅРёСЏ." });
    }

    await ensureSafetyInstructions();

    const employee = await prisma.employee.create({
      data: {
        fullName: fullName.trim(),
        position: position?.trim() || "",
        department: department?.trim() || "",
        telegramChatId: telegramChatId?.trim() || null,
        status: normalizedStatus,
        hiredAt: hiredDate,
        birthDate: birth,
      },
    });

    // safety assignments for new employee
    await createSafetyAssignmentsForEmployee(employee.id);

    res.status(201).json(employee);
  } catch (err) {
    console.error("create employee error:", err);
    res
      .status(500)
      .json({ message: "Failed to create employee card" });
  }
});

app.put("/api/hr/employees/:id", auth, requireHr, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Invalid employee id" });
    }

    const { fullName, position, department, telegramChatId, hiredAt, birthDate } = req.body || {};
    if (
      !fullName?.trim() ||
      !position?.trim() ||
      !department?.trim() ||
      !telegramChatId?.trim() ||
      !hiredAt ||
      !birthDate
    ) {
      return res.status(400).json({ message: "Р—Р°РїРѕР»РЅРёС‚Рµ РІСЃРµ РїРѕР»СЏ, РІРєР»СЋС‡Р°СЏ Telegram ID." });
    }

    const hiredDate = parseDateInput(hiredAt);
    const birth = parseDateInput(birthDate);
    if (!hiredDate || !birth) {
      return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Рµ РґР°С‚С‹ РїСЂРёРµРјР° РёР»Рё СЂРѕР¶РґРµРЅРёСЏ." });
    }

    const employee = await prisma.employee.update({
      where: { id },
      data: {
        fullName: fullName.trim(),
        position: position.trim(),
        department: department.trim(),
        telegramChatId: telegramChatId.trim(),
        hiredAt: hiredDate,
        birthDate: birth,
      },
    });

    res.json(employee);
  } catch (err) {
    console.error("update employee error:", err);

    if (err?.code === "P2025") {
      return res.status(404).json({ message: "Employee not found" });
    }

    res.status(500).json({ message: "Failed to update employee" });
  }
});

app.put("/api/hr/employees/:id/status", auth, requireHr, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body || {};

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Invalid employee id" });
    }

    const allowedStatuses = ["ACTIVE", "FIRED"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const employee = await prisma.employee.update({
      where: { id },
      data: { status },
    });

    res.json(employee);
  } catch (err) {
    console.error("update employee status error:", err);

    if (err?.code === "P2025") {
      return res.status(404).json({ message: "Employee not found" });
    }

    res
      .status(500)
      .json({ message: "Failed to update employee status" });
  }
});


app.get(
  "/api/hr/employees/:id/leave-balance",
  auth,
  requireHr,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid employee id" });
      }

      const employee = await prisma.employee.findUnique({ where: { id } });
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      const accruedDays = calcAccruedLeaveDays(employee.hiredAt);
      const usageRows =
        (await prisma.$queryRaw`
          SELECT COALESCE(SUM(days), 0) as used
          FROM HrLeaveApplication
          WHERE employeeId = ${id} AND status IN ('GENERATED', 'APPROVED')
        `) || [];
      const usedDays = Number(usageRows[0]?.used || 0);
      const availableDays = Math.max(accruedDays - usedDays, 0);

      res.json({ accruedDays, usedDays, availableDays });
    } catch (err) {
      console.error("leave balance error:", err);
      res.status(500).json({ message: "Failed to get leave balance" });
    }
  }
);

app.post(
  "/api/hr/leave-applications",
  auth,
  requireHr,
  async (req, res) => {
    try {
      const { employeeId, type, startDate, endDate, reason } = req.body || {};
      const id = Number(employeeId);

      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid employee id" });
      }

      if (!["PAID", "UNPAID", "TERMINATION"].includes(type)) {
        return res.status(400).json({ message: "Invalid leave type" });
      }

      const parsedStart = parseDateInput(startDate);
      const parsedEnd = parseDateInput(endDate);
      const days =
        type === "TERMINATION"
          ? 0
          : daysBetweenInclusive(parsedStart, parsedEnd);

      if (type !== "TERMINATION") {
        if (!days || days < 1) {
          return res.status(400).json({ message: "Invalid dates range" });
        }
      }

      const employee = await prisma.employee.findUnique({ where: { id } });
      if (!employee) {
        return res.status(404).json({ message: "Employee not found" });
      }

      const accruedDays = calcAccruedLeaveDays(employee.hiredAt);
      const apps = await prisma.hrLeaveApplication.findMany({
        where: {
          employeeId: id,
          status: { in: ["GENERATED", "APPROVED"] },
          NOT: { type: "TERMINATION" },
        },
      });
      const usedDays = apps.reduce((sum, a) => sum + Number(a.days || 0), 0);
      const availableDays = Math.max(accruedDays - usedDays, 0);

      if (type === "PAID" && days > availableDays) {
        return res
          .status(400)
          .json({ message: "Not enough leave balance" });
      }

      const application = await prisma.hrLeaveApplication.create({
        data: {
          employeeId: id,
          type,
          startDate: parsedStart,
          endDate: type === "TERMINATION" ? parsedStart : parsedEnd,
          days,
          status: "GENERATED",
          reason: reason?.trim() || null,
        },
      });

      const docText = buildLeaveDoc(employee, application);

      const withDoc = await prisma.hrLeaveApplication.update({
        where: { id: application.id },
        data: { docText },
      });

      if (type === "TERMINATION") {
        await prisma.employee.update({
          where: { id },
          data: { status: "FIRED" },
        });
      }

      res.status(201).json({
        ...withDoc,
        accruedDays,
        usedDays,
        availableDays:
          type === "PAID" ? Math.max(availableDays - days, 0) : availableDays,
      });
    } catch (err) {
      console.error("create leave application error:", err);
      res
        .status(500)
        .json({ message: "Failed to create leave application" });
    }
  }
);
app.get(
  "/api/hr/leave-applications/:id/doc",
  auth,
  requireHr,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid application id" });
      }

      const application = await prisma.hrLeaveApplication.findUnique({
        where: { id },
        include: { employee: true },
      });

      if (!application) {
        return res.status(404).json({ message: "Application not found" });
      }

      const docText =
        application.docText ||
        buildLeaveDoc(
          {
            fullName: application.fullName,
            position: application.position,
            department: application.department,
            birthDate: application.birthDate,
            hiredAt: application.hiredAt,
          },
          application
        );

      res.json({
        id: application.id,
        employeeName: application.employee.fullName,
        type: application.type,
        startDate: application.startDate,
        endDate: application.endDate,
        days: application.days,
        docText,
      });
    } catch (err) {
      console.error("leave doc error:", err);
      res.status(500).json({ message: "Failed to get leave document" });
    }
  }
);

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
        .json({ message: "РќРµ СѓРєР°Р·Р°РЅ С‚РёРї РёР»Рё РЅР°Р·РІР°РЅРёРµ Р·Р°СЏРІРєРё" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ message: "РќСѓР¶РЅРѕ СѓРєР°Р·Р°С‚СЊ С…РѕС‚СЏ Р±С‹ РѕРґРЅСѓ РїРѕР·РёС†РёСЋ" });
    }

    // Р°РєРєСѓСЂР°С‚РЅРѕ СЂР°Р·Р±РёСЂР°РµРј РЅРѕРјРµСЂ РїР»Р°С‚С‘Р¶РєРё: С‚РѕР»СЊРєРѕ С‡РёСЃР»Рѕ, РёРЅР°С‡Рµ null
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

    // 1. РџСЂРёРІРѕРґРёРј РїРѕР·РёС†РёРё Рё РїСЂРѕРІРµСЂСЏРµРј РєРѕР»РёС‡РµСЃС‚РІРѕ
    const preparedItems = [];

    for (const it of items) {
      const q = Number(it.quantity);

      if (!Number.isFinite(q) || !Number.isInteger(q) || q <= 0) {
        return res.status(400).json({
          message: `РљРѕР»РёС‡РµСЃС‚РІРѕ РїРѕ РїРѕР·РёС†РёРё "${it.name || ""}" РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ РїРѕР»РѕР¶РёС‚РµР»СЊРЅС‹Рј С†РµР»С‹Рј С‡РёСЃР»РѕРј`,
        });
      }

      preparedItems.push({
        name: it.name,
        quantity: q,
        unit: it.unit || null,
      });
    }

    // 2. Р•СЃР»Рё СЌС‚Рѕ РІС‹РґР°С‡Р° (ISSUE) вЂ” РїСЂРѕРІРµСЂСЏРµРј РѕСЃС‚Р°С‚РєРё
    if (type === "ISSUE") {
      for (const it of preparedItems) {
        if (!it.name) continue;

        const invItem = await prisma.item.findFirst({
          where: { name: it.name },
        });

        // РµСЃР»Рё С‚РѕРІР°СЂР° РЅРµС‚ РІ РЅРѕРјРµРЅРєР»Р°С‚СѓСЂРµ вЂ” РїСЂРѕРїСѓСЃРєР°РµРј РїСЂРѕРІРµСЂРєСѓ
        if (!invItem) continue;

        const currentStock = await getCurrentStockForItem(invItem.id);
        const current = currentStock ?? 0;

        if (current < it.quantity) {
          return res.status(400).json({
            message: `РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РѕСЃС‚Р°С‚РєР° РїРѕ С‚РѕРІР°СЂСѓ "${it.name}". РќР° СЃРєР»Р°РґРµ ${current} ${invItem.unit || "С€С‚."}, РІ Р·Р°СЏРІРєРµ СѓРєР°Р·Р°РЅРѕ ${it.quantity}.`,
          });
        }
      }
    }

    // 3. РЎРѕР·РґР°С‘Рј Р·Р°СЏРІРєСѓ
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
          create: preparedItems,
        },
      },
      include: {
        items: true,
      },
    });

    // 4. РЎРѕР·РґР°С‘Рј Р·Р°РґР°С‡Сѓ Рё С€Р»С‘Рј РІ Telegram
    try {
      await createWarehouseTaskFromRequest(created, req.user.id);
    } catch (err) {
      console.error("РћС€РёР±РєР° РїСЂРё СЃРѕР·РґР°РЅРёРё Р·Р°РґР°С‡Рё РїРѕ Р·Р°СЏРІРєРµ:", err);
    }

    res.status(201).json(created);
  } catch (err) {
    console.error("warehouse request create error:", err);
    res
      .status(500)
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СЃРѕР·РґР°РЅРёРё Р·Р°СЏРІРєРё РЅР° СЃРєР»Р°Рґ" });
  }
});

// РјРѕРё Р·Р°СЏРІРєРё
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ РІР°С€РёС… Р·Р°СЏРІРѕРє" });
  }
});

// РІСЃРµ Р·Р°СЏРІРєРё (ADMIN/ACCOUNTING)
app.get("/api/warehouse/requests", auth, async (req, res) => {
  try {
    if (req.user.role !== "ADMIN" && req.user.role !== "ACCOUNTING") {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ СЃРєР»Р°РґСЃРєРёС… Р·Р°СЏРІРѕРє" });
  }
});

// РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїСЂРѕРІРµСЃС‚Рё Р·Р°СЏРІРєСѓ РїРѕ СЃРєР»Р°РґСѓ (СЃРѕР·РґР°С‚СЊ РґРІРёР¶РµРЅРёСЏ РїРѕ РЅРѕРјРµРЅРєР»Р°С‚СѓСЂРµ)
async function autoPostRequestToStock(requestId, userId) {
  const id = Number(requestId);
  if (!id) return;

  // РЈР¶Рµ РµСЃС‚СЊ РґРІРёР¶РµРЅРёСЏ РїРѕ СЌС‚РѕР№ Р·Р°СЏРІРєРµ? (РёС‰РµРј РјРµС‚РєСѓ [REQ#id] РІ РєРѕРјРјРµРЅС‚Р°СЂРёРё)
  const alreadyPosted = await prisma.stockMovement.findFirst({
    where: {
      comment: {
        contains: `[REQ#${id}]`,
      },
    },
  });

  if (alreadyPosted) {
    console.log(
      `[Warehouse] Р—Р°СЏРІРєР° #${id} СѓР¶Рµ РїСЂРѕРІРµРґРµРЅР° РїРѕ СЃРєР»Р°РґСѓ, Р°РІС‚Рѕ-РїСЂРѕРІРµРґРµРЅРёРµ РїСЂРѕРїСѓС‰РµРЅРѕ`
    );
    return;
  }

  // Р‘РµСЂС‘Рј Р·Р°СЏРІРєСѓ Рё РµС‘ РїРѕР·РёС†РёРё
  const request = await prisma.warehouseRequest.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!request) {
    console.warn(
      `[Warehouse] Р—Р°СЏРІРєР° #${id} РЅРµ РЅР°Р№РґРµРЅР° РґР»СЏ Р°РІС‚Рѕ-РїСЂРѕРІРµРґРµРЅРёСЏ РїРѕ СЃРєР»Р°РґСѓ`
    );
    return;
  }

  if (!request.items || request.items.length === 0) {
    console.warn(
      `[Warehouse] Р—Р°СЏРІРєР° #${id} РЅРµ РёРјРµРµС‚ РїРѕР·РёС†РёР№ РґР»СЏ Р°РІС‚Рѕ-РїСЂРѕРІРµРґРµРЅРёСЏ`
    );
    return;
  }

  // РўРёРї РґРІРёР¶РµРЅРёСЏ РїРѕ СЃРєР»Р°РґСѓ РїРѕ С‚РёРїСѓ Р·Р°СЏРІРєРё
  const mapRequestTypeToMovementType = (reqType) => {
    if (reqType === "ISSUE") return "ISSUE"; // РІС‹РґР°С‡Р° в†’ СЂР°СЃС…РѕРґ
    if (reqType === "RETURN" || reqType === "INCOME") return "INCOME"; // РІРѕР·РІСЂР°С‚/РїСЂРёС…РѕРґ в†’ РїСЂРёС…РѕРґ
    return "ISSUE";
  };

  const movementType = mapRequestTypeToMovementType(request.type);

  let createdCount = 0;

  // РёРґС‘Рј РїРѕ РІСЃРµРј РїРѕР·РёС†РёСЏРј Р·Р°СЏРІРєРё
  for (const item of request.items) {
    if (!item.name || !item.quantity) continue;

    const q = Number(item.quantity);
    if (!Number.isFinite(q) || !Number.isInteger(q) || q <= 0) {
      continue;
    }

    // РС‰РµРј С‚РѕРІР°СЂ РІ РЅРѕРјРµРЅРєР»Р°С‚СѓСЂРµ РїРѕ С‚РѕС‡РЅРѕРјСѓ РёРјРµРЅРё
    const invItem = await prisma.item.findFirst({
      where: { name: item.name },
    });

    if (!invItem) {
      console.warn(
        `[Warehouse] РўРѕРІР°СЂ "${item.name}" РЅРµ РЅР°Р№РґРµРЅ РІ РЅРѕРјРµРЅРєР»Р°С‚СѓСЂРµ РїСЂРё Р°РІС‚Рѕ-РїСЂРѕРІРµРґРµРЅРёРё Р·Р°СЏРІРєРё #${id}`
      );
      continue;
    }

    // Р•СЃР»Рё СЌС‚Рѕ СЂР°СЃС…РѕРґ вЂ” РїСЂРѕРІРµСЂСЏРµРј, С…РІР°С‚РёС‚ Р»Рё РѕСЃС‚Р°С‚РєР°
    if (movementType === "ISSUE") {
      try {
        const stockInfo = await calculateStockAfterMovement(
          invItem.id,
          "ISSUE",
          q
        );

        if (stockInfo.newStock < 0) {
          console.warn(
            `[Warehouse] РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РѕСЃС‚Р°С‚РєР° РїРѕ "${item.name}" РїСЂРё Р°РІС‚Рѕ-СЃРїРёСЃР°РЅРёРё РїРѕ Р·Р°СЏРІРєРµ #${id} (РµСЃС‚СЊ ${stockInfo.current}, РЅСѓР¶РЅРѕ ${q})`
          );
          continue;
        }
      } catch (e) {
        console.error(
          `[Warehouse] РћС€РёР±РєР° СЂР°СЃС‡С‘С‚Р° РѕСЃС‚Р°С‚РєР° РїРѕ "${item.name}" РїСЂРё Р°РІС‚Рѕ-РїСЂРѕРІРµРґРµРЅРёРё Р·Р°СЏРІРєРё #${id}:`,
          e
        );
        continue;
      }
    }

    // РЎРѕР·РґР°С‘Рј РґРІРёР¶РµРЅРёРµ РїРѕ СЃРєР»Р°РґСѓ
    await prisma.stockMovement.create({
      data: {
        itemId: invItem.id,
        type: movementType, // "ISSUE" РёР»Рё "INCOME"
        quantity: q,
        comment: `РђРІС‚РѕРґРІРёР¶РµРЅРёРµ РїРѕ Р·Р°СЏРІРєРµ СЃРєР»Р°РґР° #${request.id}: ${request.title} [REQ#${request.id}]`,
        createdById: userId,
      },
    });

    createdCount++;
  }

  console.log(
    `[Warehouse] РђРІС‚Рѕ-РїСЂРѕРІРµРґРµРЅРёРµ Р·Р°СЏРІРєРё #${id}: СЃРѕР·РґР°РЅРѕ РґРІРёР¶РµРЅРёР№ РїРѕ СЃРєР»Р°РґСѓ: ${createdCount}`
  );

  return createdCount;
}

// СЃРјРµРЅР° СЃС‚Р°С‚СѓСЃР° Р·Р°СЏРІРєРё + Р°РІС‚РѕРїСЂРѕРІРµРґРµРЅРёРµ РїРѕ СЃРєР»Р°РґСѓ РїСЂРё DONE
app.put("/api/warehouse/requests/:id/status", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, statusComment } = req.body;

    if (req.user.role !== "ADMIN" && req.user.role !== "ACCOUNTING") {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
    }

    if (!["NEW", "IN_PROGRESS", "DONE", "REJECTED"].includes(status)) {
      return res.status(400).json({ message: "РќРµРґРѕРїСѓСЃС‚РёРјС‹Р№ СЃС‚Р°С‚СѓСЃ" });
    }

    // 1. РњРµРЅСЏРµРј СЃС‚Р°С‚СѓСЃ Р·Р°СЏРІРєРё
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

    // 2. Р•СЃР»Рё Р·Р°СЏРІРєР° РїРµСЂРµРІРµРґРµРЅР° РІ DONE вЂ” РїСЂРѕРІРѕРґРёРј РµС‘ РїРѕ СЃРєР»Р°РґСѓ
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
            "РћС€РёР±РєР° РїСЂРё Р°РІС‚РѕСЃРїРёСЃР°РЅРёРё РїРѕ СЃРєР»Р°РґСѓ. РџСЂРѕРІРµСЂСЊС‚Рµ Р¶СѓСЂРЅР°Р» РґРІРёР¶РµРЅРёР№ Рё РѕСЃС‚Р°С‚РєРё РІСЂСѓС‡РЅСѓСЋ.",
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё РѕР±РЅРѕРІР»РµРЅРёРё СЃС‚Р°С‚СѓСЃР° Р·Р°СЏРІРєРё" });
  }
});

// ================== РЎРљР›РђР”: Р—РђР”РђР§Р ==================

// Р’СЃРїРѕРјРѕРіР°С‚РµР»СЊРЅР°СЏ С„СѓРЅРєС†РёСЏ: СЃРѕР·РґР°С‚СЊ Р·Р°РґР°С‡Сѓ СЃРєР»Р°РґР° РїРѕ Р·Р°СЏРІРєРµ
async function createWarehouseTaskFromRequest(request, assignerId) {
  try {
    // РЎРѕР±РёСЂР°РµРј РѕРїРёСЃР°РЅРёРµ Р·Р°РґР°С‡Рё РёР· РєРѕРјРјРµРЅС‚Р°СЂРёСЏ Рё РїРѕР·РёС†РёР№ Р·Р°СЏРІРєРё
    const lines = [];

    if (request.comment) {
      lines.push(`РљРѕРјРјРµРЅС‚Р°СЂРёР№: ${request.comment}`);
    }

    if (request.items && request.items.length) {
      if (lines.length) lines.push("");
      lines.push("РџРѕР·РёС†РёРё:");

      for (const it of request.items) {
        lines.push(
          `- ${it.name} вЂ” ${it.quantity} ${it.unit || ""}`.trim()
        );
      }
    }

    const description = lines.join("\n");

    const task = await prisma.warehouseTask.create({
      data: {
        title: `Р—Р°СЏРІРєР° РЅР° СЃРєР»Р°Рґ #${request.id}: ${request.title}`,
        description,
        // РїРѕРєР° СЃСЂРѕРє РЅРµ Р·Р°РґР°С‘Рј, РµРіРѕ РјРѕР¶РЅРѕ РїРѕС‚РѕРј СЂСѓРєР°РјРё РІС‹СЃС‚Р°РІРёС‚СЊ РІ Р·Р°РґР°С‡Р°С…
        dueDate: null,
        executorName: "РЎРєР»Р°Рґ",
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
      `[Warehouse] СЃРѕР·РґР°РЅР° Р·Р°РґР°С‡Р° ${task.id} РїРѕ Р·Р°СЏРІРєРµ ${request.id}`
    );

    // РЎРѕРѕР±С‰РµРЅРёРµ РІ СЃРєР»Р°РґСЃРєРѕР№ Telegram-С‡Р°С‚
    const parts = [];

    parts.push("рџ“¦ <b>РќРѕРІР°СЏ Р·Р°РґР°С‡Р° СЃРєР»Р°РґР° РїРѕ Р·Р°СЏРІРєРµ</b>");
    parts.push("");
    parts.push(`рџ“ќ <b>Р—Р°РґР°С‡Р°:</b> ${task.title}`);

    if (task.description) {
      parts.push("");
      parts.push(`<b>Р”РµС‚Р°Р»Рё:</b>\n${task.description}`);
    }

    if (task.assigner) {
      parts.push("");
      parts.push(
        `рџ‘¤ <b>РђРІС‚РѕСЂ Р·Р°СЏРІРєРё:</b> ${task.assigner.name || "РќРµРёР·РІРµСЃС‚РЅРѕ"} (${task.assigner.email || ""})`
      );
    }

    const text = parts.join("\n");

    await sendWarehouseGroupMessage(text);

    return task;
  } catch (err) {
    console.error("[createWarehouseTaskFromRequest] РћС€РёР±РєР°:", err);
  }
}

// СЃРѕР·РґР°С‚СЊ Р·Р°РґР°С‡Сѓ СЃРєР»Р°РґР°
app.post("/api/warehouse/tasks", auth, async (req, res) => {
  try {
    const { title, description, dueDate, executorName, executorChatId } =
      req.body;

    if (!title) {
      return res
        .status(400)
        .json({ message: "РћРїРёСЃР°РЅРёРµ Р·Р°РґР°С‡Рё РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ" });
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

    // РЎРѕРѕР±С‰РµРЅРёРµ РІ РіСЂСѓРїРїСѓ
    const parts = [];

    parts.push("рџ“¦ <b>РќРѕРІР°СЏ Р·Р°РґР°С‡Р° СЃРєР»Р°РґР°</b>");
    parts.push("");
    parts.push(`рџ“ќ <b>Р—Р°РґР°С‡Р°:</b> ${task.title}`);

    if (task.description) {
      parts.push(`рџ“„ <b>Р”РµС‚Р°Р»Рё:</b> ${task.description}`);
    }

    if (task.executorName) {
      parts.push(`рџ‘· <b>РСЃРїРѕР»РЅРёС‚РµР»СЊ:</b> ${task.executorName}`);
    }

    if (task.dueDate) {
      const due = new Date(task.dueDate);
      if (!Number.isNaN(due.getTime())) {
        const dueStr = due.toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        parts.push(`вЏ° <b>РЎСЂРѕРє:</b> ${dueStr}`);
      }
    }

    if (task.assigner) {
      parts.push("");
      parts.push(
        `рџ‘¤ <b>РќР°Р·РЅР°С‡РёР»:</b> ${task.assigner.name || "РќРµРёР·РІРµСЃС‚РЅРѕ"} (${task.assigner.email || ""
        })`
      );
    }

    const groupText = parts.join("\n");

    sendWarehouseGroupMessage(groupText).catch((err) =>
      console.error("РћС€РёР±РєР° РѕС‚РїСЂР°РІРєРё РІ Telegram (РіСЂСѓРїРїР°):", err)
    );

    // Р›РёС‡РЅРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ РёСЃРїРѕР»РЅРёС‚РµР»СЋ
    if (task.executorChatId) {
      const execParts = [];

      execParts.push("рџ‘‹ <b>Р’Р°Рј РЅР°Р·РЅР°С‡РµРЅР° Р·Р°РґР°С‡Р° СЃРєР»Р°РґР°</b>");
      execParts.push("");
      execParts.push(`рџ“ќ <b>Р—Р°РґР°С‡Р°:</b> ${task.title}`);

      if (task.description) {
        execParts.push(`рџ“„ <b>Р”РµС‚Р°Р»Рё:</b> ${task.description}`);
      }

      if (task.dueDate) {
        const due = new Date(task.dueDate);
        if (!Number.isNaN(due.getTime())) {
          const dueStr = due.toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          execParts.push(`вЏ° <b>РЎСЂРѕРє:</b> ${dueStr}`);
        }
      }

      if (task.assigner) {
        execParts.push("");
        execParts.push(
          `рџ‘¤ <b>РќР°Р·РЅР°С‡РёР»:</b> ${task.assigner.name || "РќРµРёР·РІРµСЃС‚РЅРѕ"} (${task.assigner.email || ""
          })`
        );
      }

      const execText = execParts.join("\n");

      sendTelegramMessage(task.executorChatId, execText, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "вњ… Р’С‹РїРѕР»РЅРµРЅРѕ",
                callback_data: `done:${task.id}`,
              },
            ],
          ],
        },
      }).catch((err) =>
        console.error("РћС€РёР±РєР° РѕС‚РїСЂР°РІРєРё РІ Telegram (РёСЃРїРѕР»РЅРёС‚РµР»СЊ):", err)
      );
    }

    res.status(201).json(task);
  } catch (err) {
    console.error("Warehouse task create error:", err);
    res
      .status(500)
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СЃРѕР·РґР°РЅРёРё Р·Р°РґР°С‡Рё СЃРєР»Р°РґР°" });
  }
});

// РјРѕРё Р·Р°РґР°С‡Рё (РЅР°Р·РЅР°С‡РµРЅРЅС‹Рµ РјРЅРѕР№)
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ РІР°С€РёС… Р·Р°РґР°С‡" });
  }
});

// РІСЃРµ Р·Р°РґР°С‡Рё СЃРєР»Р°РґР° (ADMIN/ACCOUNTING)
app.get("/api/warehouse/tasks", auth, async (req, res) => {
  try {
    if (req.user.role !== "ADMIN" && req.user.role !== "ACCOUNTING") {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ Р·Р°РґР°С‡ СЃРєР»Р°РґР°" });
  }
});

// СЃРјРµРЅР° СЃС‚Р°С‚СѓСЃР° Р·Р°РґР°С‡Рё (С‡РµСЂРµР· РїРѕСЂС‚Р°Р», РЅРµ С‡РµСЂРµР· Р±РѕС‚Р°)
app.put("/api/warehouse/tasks/:id/status", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;

    if (req.user.role !== "ADMIN" && req.user.role !== "ACCOUNTING") {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
    }

    if (!["NEW", "IN_PROGRESS", "DONE", "CANCELLED"].includes(status)) {
      return res.status(400).json({ message: "РќРµРґРѕРїСѓСЃС‚РёРјС‹Р№ СЃС‚Р°С‚СѓСЃ" });
    }

    const updated = await prisma.warehouseTask.update({
      where: { id },
      data: { status },
    });

    // Р•СЃР»Рё Р·Р°РґР°С‡Р° СЃРѕР·РґР°РЅР° РїРѕ Р·Р°СЏРІРєРµ РЅР° СЃРєР»Р°Рґ Рё РјС‹ РїРѕСЃС‚Р°РІРёР»Рё DONE вЂ”
    // Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїСЂРѕРІРѕРґРёРј СЌС‚Сѓ Р·Р°СЏРІРєСѓ РїРѕ СЃРєР»Р°РґСѓ
    if (status === "DONE") {
      try {
        // title РІРёРґР°: "Р—Р°СЏРІРєР° РЅР° СЃРєР»Р°Рґ #19: ..."
        const match = updated.title.match(/Р—Р°СЏРІРєР° РЅР° СЃРєР»Р°Рґ #(\d+)/);
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё РѕР±РЅРѕРІР»РµРЅРёРё СЃС‚Р°С‚СѓСЃР° Р·Р°РґР°С‡Рё" });
  }
});

// ================== РЎРљР›РђР”: РќРћРњР•РќРљР›РђРўРЈР Рђ Р РћРЎРўРђРўРљР ==================

// РЎРѕР·РґР°С‚СЊ С‚РѕРІР°СЂ (РЅРѕРјРµРЅРєР»Р°С‚СѓСЂР°)
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

    // 1) РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ СЃС‚СЂРѕРєРё РЅРµ РїСѓСЃС‚С‹Рµ
    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ message: "РќР°РёРјРµРЅРѕРІР°РЅРёРµ С‚РѕРІР°СЂР° РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ" });
    }

    if (!sku || !sku.trim()) {
      return res
        .status(400)
        .json({ message: "РђСЂС‚РёРєСѓР» (SKU) РѕР±СЏР·Р°С‚РµР»РµРЅ" });
    }

    if (!unit || !unit.trim()) {
      return res
        .status(400)
        .json({ message: "Р•РґРёРЅРёС†Р° РёР·РјРµСЂРµРЅРёСЏ РѕР±СЏР·Р°С‚РµР»СЊРЅР°" });
    }

    // 2) Р§РёСЃР»РѕРІС‹Рµ РїРѕР»СЏ
    const minVal = Number(minStock);
    const maxVal = Number(maxStock);
    const priceVal = Number(
      String(defaultPrice).toString().replace(",", ".")
    );

    if (!Number.isFinite(minVal) || minVal <= 0) {
      return res.status(400).json({
        message: "РњРёРЅРёРјР°Р»СЊРЅС‹Р№ РѕСЃС‚Р°С‚РѕРє РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РїРѕР»РѕР¶РёС‚РµР»СЊРЅС‹Рј С‡РёСЃР»РѕРј",
      });
    }

    if (!Number.isFinite(maxVal) || maxVal <= 0) {
      return res.status(400).json({
        message: "РњР°РєСЃРёРјР°Р»СЊРЅС‹Р№ РѕСЃС‚Р°С‚РѕРє РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РїРѕР»РѕР¶РёС‚РµР»СЊРЅС‹Рј С‡РёСЃР»РѕРј",
      });
    }

    if (!Number.isFinite(priceVal) || priceVal <= 0) {
      return res.status(400).json({
        message: "Р¦РµРЅР° Р·Р° РµРґРёРЅРёС†Сѓ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ РїРѕР»РѕР¶РёС‚РµР»СЊРЅС‹Рј С‡РёСЃР»РѕРј",
      });
    }

    // 3) РЎРѕР·РґР°С‘Рј С‚РѕРІР°СЂ
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
        .json({ message: "РђСЂС‚РёРєСѓР», С€С‚СЂРёС…РєРѕРґ РёР»Рё QR СѓР¶Рµ РёСЃРїРѕР»СЊР·СѓСЋС‚СЃСЏ" });
    }
    return res
      .status(500)
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СЃРѕР·РґР°РЅРёРё С‚РѕРІР°СЂР°" });
  }
});

// РЎРїРёСЃРѕРє С‚РѕРІР°СЂРѕРІ (Р±РµР· СЂР°СЃС‡С‘С‚Р° РѕСЃС‚Р°С‚РєРѕРІ)
app.get("/api/inventory/items", auth, async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      orderBy: { name: "asc" },
    });
    res.json(items);
  } catch (err) {
    console.error("list items error:", err);
    res
      .status(500)
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ С‚РѕРІР°СЂРѕРІ" });
  }
});

// РџРѕРёСЃРє С‚РѕРІР°СЂР° РїРѕ С€С‚СЂРёС…РєРѕРґСѓ (РґР»СЏ РјРѕР±РёР»СЊРЅРѕРіРѕ РўРЎР”)
app.get("/api/inventory/items/by-barcode/:barcode", auth, async (req, res) => {
  try {
    const raw = req.params.barcode || "";
    const barcode = raw.trim();

    if (!barcode) {
      return res.status(400).json({ message: "РЁС‚СЂРёС…РєРѕРґ РѕР±СЏР·Р°С‚РµР»РµРЅ" });
    }

    // РёС‰РµРј РїРѕ С€С‚СЂРёС…РєРѕРґСѓ, QR РёР»Рё SKU (РЅР° СЃР»СѓС‡Р°Р№, РµСЃР»Рё СЃРєР°РЅРµСЂ РїРѕСЃС‹Р»Р°РµС‚ РєРѕРґ Р°СЂС‚РёРєСѓР»Р°)
    const item = await prisma.item.findFirst({
      where: {
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
        .json({ message: "РўРѕРІР°СЂ СЃ С‚Р°РєРёРј С€С‚СЂРёС…РєРѕРґРѕРј РЅРµ РЅР°Р№РґРµРЅ" });
    }

    // СЃС‡РёС‚Р°РµРј С‚РµРєСѓС‰РёР№ РѕСЃС‚Р°С‚РѕРє РїРѕ СЌС‚РѕРјСѓ С‚РѕРІР°СЂСѓ
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё РїРѕРёСЃРєРµ С‚РѕРІР°СЂР° РїРѕ С€С‚СЂРёС…РєРѕРґСѓ" });
  }
});

// РЈРґР°Р»РёС‚СЊ С‚РѕРІР°СЂ (РЅРѕРјРµРЅРєР»Р°С‚СѓСЂР°)
app.delete("/api/inventory/items/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id || Number.isNaN(id)) {
      return res
        .status(400)
        .json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID С‚РѕРІР°СЂР°" });
    }

    const existing = await prisma.item.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({ message: "РўРѕРІР°СЂ РЅРµ РЅР°Р№РґРµРЅ" });
    }

    // РЎРЅР°С‡Р°Р»Р° СѓРґР°Р»СЏРµРј РІСЃРµ РґРІРёР¶РµРЅРёСЏ РїРѕ СЌС‚РѕРјСѓ С‚РѕРІР°СЂСѓ
    await prisma.stockMovement.deleteMany({
      where: { itemId: id },
    });

    // РџРѕС‚РѕРј СЃР°Рј С‚РѕРІР°СЂ
    await prisma.item.delete({
      where: { id },
    });

    return res.json({ message: "РўРѕРІР°СЂ Рё РІСЃРµ РґРІРёР¶РµРЅРёСЏ РїРѕ РЅРµРјСѓ СѓРґР°Р»РµРЅС‹" });
  } catch (err) {
    console.error("delete item error:", err);
    return res
      .status(500)
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СѓРґР°Р»РµРЅРёРё С‚РѕРІР°СЂР°" });
  }
});

// ===== РЎРљР›РђР”: Р›РћРљРђР¦РР =====
app.get("/api/warehouse/locations", auth, async (req, res) => {
  try {
    const locations = await prisma.warehouseLocation.findMany({
      orderBy: { id: "asc" },
    });
    res.json(locations);
  } catch (err) {
    console.error("list locations error:", err);
    res.status(500).json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ Р»РѕРєР°С†РёР№" });
  }
});

app.post("/api/warehouse/locations", auth, async (req, res) => {
  try {
    const { name, zone, aisle, rack, level } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "РќР°Р·РІР°РЅРёРµ Р»РѕРєР°С†РёРё РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ" });
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
      return res.status(400).json({ message: "РљРѕРґ Р»РѕРєР°С†РёРё СѓР¶Рµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ" });
    }
    res.status(500).json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СЃРѕР·РґР°РЅРёРё Р»РѕРєР°С†РёРё" });
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
      return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID Р»РѕРєР°С†РёРё" });
    }
    const existing = await prisma.warehouseLocation.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: "Р›РѕРєР°С†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°" });
    }
    await prisma.warehouseLocation.delete({ where: { id } });
    res.json({ message: "Р›РѕРєР°С†РёСЏ СѓРґР°Р»РµРЅР°" });
  } catch (err) {
    console.error("delete location error:", err);
    res.status(500).json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СѓРґР°Р»РµРЅРёРё Р»РѕРєР°С†РёРё" });
  }
});

// ===== РљРћР”Р«: РўРћР’РђР Р« =====
app.post("/api/warehouse/products/:id/codes", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { type, mode = "auto", value, force = false } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID С‚РѕРІР°СЂР°" });
    }
    if (!["barcode", "qr", "both"].includes(type)) {
      return res.status(400).json({ message: "РќРµРІРµСЂРЅС‹Р№ С‚РёРї РєРѕРґР°" });
    }

    const item = await prisma.item.findUnique({ where: { id } });
    if (!item) {
      return res.status(404).json({ message: "РўРѕРІР°СЂ РЅРµ РЅР°Р№РґРµРЅ" });
    }

    const next = { barcode: item.barcode, qrCode: item.qrCode };
    const manualValue = value ? String(value).trim() : "";

    if ((type === "barcode" || type === "both") && next.barcode && !force) {
      return res.status(400).json({ message: "РЁС‚СЂРёС…РєРѕРґ СѓР¶Рµ Р·Р°РґР°РЅ, РёСЃРїРѕР»СЊР·СѓР№С‚Рµ РїРµСЂРµРІС‹РїСѓСЃРє" });
    }
    if ((type === "qr" || type === "both") && next.qrCode && !force) {
      return res.status(400).json({ message: "QR СѓР¶Рµ Р·Р°РґР°РЅ, РёСЃРїРѕР»СЊР·СѓР№С‚Рµ РїРµСЂРµРІС‹РїСѓСЃРє" });
    }

    if (type === "barcode" || type === "both") {
      if (mode === "manual") {
        if (!manualValue) return res.status(400).json({ message: "РЈРєР°Р¶РёС‚Рµ Р·РЅР°С‡РµРЅРёРµ РєРѕРґР°" });
        next.barcode = manualValue;
      } else {
        next.barcode = buildProductCode(item);
      }
    }

    if (type === "qr" || type === "both") {
      if (mode === "manual") {
        if (!manualValue) return res.status(400).json({ message: "РЈРєР°Р¶РёС‚Рµ Р·РЅР°С‡РµРЅРёРµ РєРѕРґР°" });
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
    res.status(400).json({ message: err.message || "РћС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё РєРѕРґР°" });
  }
});

// ===== РљРћР”Р«: Р›РћРљРђР¦РР =====
app.post("/api/warehouse/locations/:id/codes", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { type, mode = "auto", value, force = false } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID Р»РѕРєР°С†РёРё" });
    }
    if (!["barcode", "qr", "both"].includes(type)) {
      return res.status(400).json({ message: "РќРµРІРµСЂРЅС‹Р№ С‚РёРї РєРѕРґР°" });
    }

    const location = await prisma.warehouseLocation.findUnique({ where: { id } });
    if (!location) {
      return res.status(404).json({ message: "Р›РѕРєР°С†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°" });
    }

    const next = { code: location.code, qrCode: location.qrCode };
    const manualValue = value ? String(value).trim() : "";

    if ((type === "barcode" || type === "both") && next.code && !force) {
      return res.status(400).json({ message: "РљРѕРґ СѓР¶Рµ Р·Р°РґР°РЅ, РёСЃРїРѕР»СЊР·СѓР№С‚Рµ РїРµСЂРµРІС‹РїСѓСЃРє" });
    }
    if ((type === "qr" || type === "both") && next.qrCode && !force) {
      return res.status(400).json({ message: "QR СѓР¶Рµ Р·Р°РґР°РЅ, РёСЃРїРѕР»СЊР·СѓР№С‚Рµ РїРµСЂРµРІС‹РїСѓСЃРє" });
    }

    if (type === "barcode" || type === "both") {
      if (mode === "manual") {
        if (!manualValue) return res.status(400).json({ message: "РЈРєР°Р¶РёС‚Рµ Р·РЅР°С‡РµРЅРёРµ РєРѕРґР°" });
        next.code = manualValue;
      } else {
        next.code = buildLocationCode(location);
      }
    }

    if (type === "qr" || type === "both") {
      if (mode === "manual") {
        if (!manualValue) return res.status(400).json({ message: "РЈРєР°Р¶РёС‚Рµ Р·РЅР°С‡РµРЅРёРµ РєРѕРґР°" });
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
    res.status(400).json({ message: err.message || "РћС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё РєРѕРґР°" });
  }
});

// ===== QR: РўРћР’РђР Р« =====
app.post("/api/warehouse/products/:id/qr", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { force = false } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID С‚РѕРІР°СЂР°" });
    }
    const item = await prisma.item.findUnique({ where: { id } });
    if (!item) {
      return res.status(404).json({ message: "РўРѕРІР°СЂ РЅРµ РЅР°Р№РґРµРЅ" });
    }
    if (item.qrCode && !force) {
      return res.status(400).json({ message: "QR СѓР¶Рµ Р·Р°РґР°РЅ, РёСЃРїРѕР»СЊР·СѓР№С‚Рµ РїРµСЂРµРІС‹РїСѓСЃРє" });
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
    res.status(400).json({ message: err.message || "РћС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё QR" });
  }
});

// ===== QR: Р›РћРљРђР¦РР =====
app.post("/api/warehouse/locations/:id/qr", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { force = false } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID Р»РѕРєР°С†РёРё" });
    }
    const location = await prisma.warehouseLocation.findUnique({ where: { id } });
    if (!location) {
      return res.status(404).json({ message: "Р›РѕРєР°С†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°" });
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
    res.status(400).json({ message: err.message || "РћС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё QR" });
  }
});

// ===== Р Р•Р—РћР›Р’ РЎРљРђРќРђ =====
app.get("/api/warehouse/scan/resolve", auth, async (req, res) => {
  try {
    const raw = String(req.query.code || "").trim();
    if (!raw) {
      return res.status(400).json({ message: "CODE_REQUIRED" });
    }

    const isLoc = raw.startsWith("BP:LOC:") || raw.startsWith("BP:LOCATION:");
    const isItem =
      raw.startsWith("BP:ITEM:") ||
      raw.startsWith("BP:SKU:") ||
      raw.startsWith("BP:PRODUCT:");

    if (isLoc) {
      const payload = raw.replace(/^BP:(LOC|LOCATION):/, "");
      const id = Number(payload);
      const hasId = Number.isFinite(id) && id > 0;
      const location = await prisma.warehouseLocation.findFirst({
        where: {
          OR: [
            { qrCode: raw },
            ...(hasId ? [{ id }] : []),
            { code: payload },
          ],
        },
      });
      if (!location) {
        return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
      }
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
          { code: raw },
          { qrCode: raw },
          { name: raw },
          { code: { contains: raw } },
          { name: { contains: raw } },
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
          const movement = await stockService.createMovementInTx(tx, {
            opId,
            type: "ADJUSTMENT",
            itemId,
            qty: delta,
            locationId,
            comment: note || `BIN AUDIT ${session}`,
            userId: req.user?.id || null,
          });

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
                movementOpId: movement.opId || opId,
              },
            });
            createdDiscrepancies.push(created.id);
          }

          adjustedCount += 1;
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

    res.json({
      items: items.map((row) => ({
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
      })),
    });
  } catch (err) {
    console.error("discrepancies list error:", err);
    res.status(500).json({ message: "DISCREPANCIES_LIST_ERROR" });
  }
});

// ===== DISCREPANCY CLOSE =====
app.put("/api/warehouse/discrepancies/:id/close", auth, async (req, res) => {
  try {
    if (req.user?.role !== "ADMIN") {
      return res.status(403).json({ message: "FORBIDDEN" });
    }
    const id = Number(req.params.id);
    const { closeNote } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_DISCREPANCY_ID" });
    }

    await prisma.stockDiscrepancy.update({
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
    console.error("discrepancy close error:", err);
    res.status(500).json({ message: "DISCREPANCY_CLOSE_ERROR" });
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

// ===== TSD: INVENTORY COUNT =====
app.post("/api/warehouse/inventory/count", auth, async (req, res) => {
  try {
    const { opId, locationId, itemId, qty, comment } = req.body || {};
    const location = Number(locationId);
    const item = Number(itemId);
    const amount = Number(qty);

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
    await prisma.$transaction(async (tx) => {
      const current = await stockService.getItemLocationQty(
        tx,
        item,
        location
      );
      delta = normalizedQty - current;
      if (delta !== 0) {
        await stockService.createMovementInTx(tx, {
          opId: opId || null,
          type: "ADJUSTMENT",
          itemId: item,
          qty: delta,
          locationId: location,
          comment: comment || `TSD COUNT locationId=${location}`,
          userId: req.user?.id || null,
        });
      }
    });

    res.json({ locationId: location, itemId: item, qty: normalizedQty, delta });
  } catch (err) {
    console.error("inventory count error:", err);
    if (err.code === "BAD_QTY") {
      return res.status(400).json({ message: "BAD_QTY" });
    }
    res.status(500).json({ message: "INVENTORY_COUNT_ERROR" });
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
    } = req.body || {};
    const locationId = Number(rawLocationId ?? defaultLocationId);

    const hasLines = Array.isArray(lines) && lines.length > 0;
    if (
      !locationId ||
      (!hasLines && (!itemId || !Number.isFinite(Number(qty)) || Number(qty) <= 0))
    ) {
      return res.status(400).json({ message: "BAD_REQUEST" });
    }

    const location = await prisma.warehouseLocation.findUnique({
      where: { id: locationId },
    });
    if (!location) {
      return res.status(404).json({ message: "LOCATION_NOT_FOUND" });
    }

    const commentParts = [
      "TSD RECEIVING",
      `locationId=${locationId}`,
      supplierName ? `supplier=${String(supplierName).trim()}` : "",
      docNo ? `doc=${String(docNo).trim()}` : "",
    ].filter(Boolean);
    const baseComment = commentParts.join(" ");

    const linesToPost = hasLines ? lines : [{ itemId, qty }];

    await prisma.$transaction(async (tx) => {
      for (const line of linesToPost) {
        const lineItemId = Number(line.itemId);
        const amount = Number(line.qty);
        if (!lineItemId || !Number.isFinite(amount) || amount <= 0) continue;

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
          locationId,
          comment: comment || baseComment,
          userId: req.user?.id || null,
          refType: supplierName ? "SUPPLIER" : null,
          refId: docNo || null,
        });
      }
    });

    res.json({ ok: true, locationId, lines: linesToPost.length });
  } catch (err) {
    console.error("receiving error:", err);
    if (err.code === "BAD_QTY") {
      return res.status(400).json({ message: "BAD_QTY" });
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

      const moveComment = comment || `TSD MOVE from=${from} to=${to}`;

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

      const moveComment = comment || `TSD PUTAWAY from=${from} to=${to}`;

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

    const pickComment = comment || `TSD PICK from=${from}`;
    const movement = await stockService.createMovement({
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

      const replComment = comment || `TSD REPLENISH from=${from} to=${to}`;

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


// ===== Р Р•РќР”Р•Р  QR =====
app.get("/api/warehouse/qr/render", async (req, res) => {
  try {
    const value = String(req.query.value || "").trim();
    if (!value) {
      return res.status(400).json({ message: "РќРµРІРµСЂРЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹" });
    }
    const buffer = await renderQrPng(value);
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  } catch (err) {
    console.error("render code error:", err);
    res.status(500).json({ message: "РћС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё РёР·РѕР±СЂР°Р¶РµРЅРёСЏ" });
  }
});

// ===== РџР•Р§РђРўР¬ QR =====
app.post("/api/warehouse/qr/print", auth, async (req, res) => {
  try {
    const { kind, id, qty = 1, layout = "A4" } = req.body || {};
    if (!id || !["product", "location"].includes(kind)) {
      return res.status(400).json({ message: "РќРµРІРµСЂРЅС‹Рµ РїР°СЂР°РјРµС‚СЂС‹ РїРµС‡Р°С‚Рё" });
    }
    const count = Math.max(1, Number(qty || 1));
    let title = "";
    let subtitle = "";
    let qrValue = "";
    if (kind === "product") {
      const item = await prisma.item.findUnique({ where: { id: Number(id) } });
      if (!item) return res.status(404).json({ message: "РўРѕРІР°СЂ РЅРµ РЅР°Р№РґРµРЅ" });
      title = item.name;
      subtitle = item.sku ? `SKU: ${item.sku}` : "";
      qrValue = item.qrCode || `BP:PRODUCT:${item.id}`;
    } else {
      const location = await prisma.warehouseLocation.findUnique({ where: { id: Number(id) } });
      if (!location) return res.status(404).json({ message: "Р›РѕРєР°С†РёСЏ РЅРµ РЅР°Р№РґРµРЅР°" });
      title = `Р›РћРљРђР¦РРЇ: ${location.name}`;
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
          <title>QR РїРµС‡Р°С‚СЊ</title>
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
    res.status(500).json({ message: "РћС€РёР±РєР° РїРµС‡Р°С‚Рё QR" });
  }
});

// ===== Р РђР—РњР•Р©Р•РќРРЇ =====
app.post("/api/warehouse/placements", auth, async (req, res) => {
  try {
    const { itemId, locationId, qty } = req.body || {};
    const item = Number(itemId);
    const location = Number(locationId);
    const amount = Number(qty);
    if (!item || !location || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "РќРµРІРµСЂРЅС‹Рµ РґР°РЅРЅС‹Рµ СЂР°Р·РјРµС‰РµРЅРёСЏ" });
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
    res.status(500).json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СЂР°Р·РјРµС‰РµРЅРёРё" });
  }
});

app.get("/api/warehouse/products/:id/placements", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID С‚РѕРІР°СЂР°" });
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
    res.status(500).json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ СЂР°Р·РјРµС‰РµРЅРёР№" });
  }
});

app.put("/api/warehouse/placements/pick", auth, async (req, res) => {
  try {
    const { itemId, locationId, qty } = req.body || {};
    const item = Number(itemId);
    const location = Number(locationId);
    const amount = Number(qty);
    if (!item || !location || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "РќРµРІРµСЂРЅС‹Рµ РґР°РЅРЅС‹Рµ РѕС‚Р±РѕСЂР°" });
    }

    const existing = await prisma.warehousePlacement.findUnique({
      where: { itemId_locationId: { itemId: item, locationId: location } },
    });
    if (!existing || existing.qty < amount) {
      return res.status(400).json({ message: "РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ С‚РѕРІР°СЂР° РІ Р»РѕРєР°С†РёРё" });
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
    res.status(500).json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё РѕС‚Р±РѕСЂРµ" });
  }
});

// ===== РџР•Р§РђРўР¬ Р­РўРРљР•РўРћРљ =====
app.post("/api/warehouse/labels/print", auth, async (req, res) => {
  try {
    const { items = [], format = "A4", labelSize = "58x40" } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "РЎРїРёСЃРѕРє СЌС‚РёРєРµС‚РѕРє РїСѓСЃС‚" });
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
          <title>Р­С‚РёРєРµС‚РєРё</title>
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
                      <div class="print-date">РџРµС‡Р°С‚СЊ: ${new Date().toLocaleDateString("ru-RU")}</div>
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
                    <div class="print-date">РџРµС‡Р°С‚СЊ: ${new Date().toLocaleDateString("ru-RU")}</div>
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
    res.status(500).json({ message: "РћС€РёР±РєР° РіРµРЅРµСЂР°С†РёРё СЌС‚РёРєРµС‚РѕРє" });
  }
});

// РЎРїРёСЃРѕРє С‚РѕРІР°СЂРѕРІ СЃ С‚РµРєСѓС‰РёРјРё РѕСЃС‚Р°С‚РєР°РјРё
app.get("/api/inventory/stock", auth, async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      orderBy: { name: "asc" },
      include: {
        movements: true,
      },
    });

    const result = items.map((item) => {
      let qty = 0;
      for (const m of item.movements) {
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СЂР°СЃС‡С‘С‚Рµ РѕСЃС‚Р°С‚РєРѕРІ" });
  }
});

// ===== WAREHOUSE: STOCK SUMMARY =====
app.get("/api/warehouse/stock/summary", auth, async (req, res) => {
  try {
    const items = await prisma.item.findMany({
      orderBy: { name: "asc" },
      include: { movements: true },
    });

    const result = items.map((item) => {
      let qty = 0;
      for (const m of item.movements) {
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

// Р“РѕС‚РѕРІС‹Р№ Р·Р°РєР°Р· РїРѕ С‚РѕРІР°СЂР°Рј РЅРёР¶Рµ РјРёРЅРёРјР°Р»СЊРЅРѕРіРѕ РѕСЃС‚Р°С‚РєР° (Excel .xlsx)
app.get("/api/inventory/low-stock-order-file", auth, async (req, res) => {
  try {
    // 1. Р‘РµСЂС‘Рј РІСЃРµ С‚РѕРІР°СЂС‹ СЃ РґРІРёР¶РµРЅРёСЏРјРё
    const items = await prisma.item.findMany({
      orderBy: { name: "asc" },
      include: { movements: true },
    });

    const lowItems = [];

    for (const item of items) {
      // СЃС‡РёС‚Р°РµРј С‚РµРєСѓС‰РёР№ РѕСЃС‚Р°С‚РѕРє С‚Р°Рє Р¶Рµ, РєР°Рє РІ /api/inventory/stock
      let qty = 0;
      for (const m of item.movements) {
        if (m.type === "INCOME" || m.type === "ADJUSTMENT") {
          qty += Number(m.quantity);
        } else if (m.type === "ISSUE") {
          qty -= Number(m.quantity);
        }
      }

      const currentStock = Math.round(qty);
      const min = item.minStock != null ? Number(item.minStock) : null;
      const max = item.maxStock != null ? Number(item.maxStock) : null;

      // Р›РѕРіРёРєР° "С‚РѕРІР°СЂ Рє Р·Р°РєР°Р·Сѓ" РґРµР»Р°РµРј С‚Р°РєРѕР№ Р¶Рµ, РєР°Рє РїРѕРґСЃРІРµС‚РєР° РІ РёРЅС‚РµСЂС„РµР№СЃРµ:
      // 1) РµСЃР»Рё РѕСЃС‚Р°С‚РѕРє <= 0 Рё РµСЃС‚СЊ min РёР»Рё max
      // 2) РёР»Рё РµСЃР»Рё РµСЃС‚СЊ min Рё РѕСЃС‚Р°С‚РѕРє < min
      const shouldOrder =
        (currentStock <= 0 && ((min != null && min > 0) || (max != null && max > 0))) ||
        (min != null && currentStock < min);

      if (!shouldOrder) continue;

      // РЎРєРѕР»СЊРєРѕ Р·Р°РєР°Р·С‹РІР°С‚СЊ:
      // - РµСЃР»Рё Р·Р°РґР°РЅ min Рё >0 вЂ” РґРѕР±РёРІР°РµРј РґРѕ min
      // - РёРЅР°С‡Рµ, РµСЃР»Рё РµСЃС‚СЊ max вЂ” РґРѕР±РёРІР°РµРј РґРѕ max
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
        .json({ message: "РќРµС‚ С‚РѕРІР°СЂРѕРІ РЅРёР¶Рµ РјРёРЅРёРјР°Р»СЊРЅРѕРіРѕ РѕСЃС‚Р°С‚РєР°" });
    }

    // 2. РЎРѕР·РґР°С‘Рј Excel-РєРЅРёРіСѓ Рё Р»РёСЃС‚
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Р—Р°РєР°Р·");

    // РЎС‚СЂРѕРєР° 1: Р—Р°РіРѕР»РѕРІРѕРє "Р—РђРљРђР— в„– ____ РѕС‚ [Р”Р°С‚Р°]"
    const now = new Date();
    const dateStr = now.toLocaleDateString("ru-RU");
    worksheet.mergeCells("A1:F1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `Р—РђРљРђР— в„– ____ РѕС‚ ${dateStr}`;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };

    // РЎС‚СЂРѕРєР° 2: РЁР°РїРєР° С‚Р°Р±Р»РёС†С‹
    // РљРѕР»РѕРЅРєРё: в„–, РќРѕРјРµРЅРєР»Р°С‚СѓСЂР°, РљРѕР»-РІРѕ, Р•Рґ., Р¦РµРЅР° Р·Р° С€С‚, РЎСѓРјРјР°
    worksheet.getRow(2).values = ["в„–", "РќРѕРјРµРЅРєР»Р°С‚СѓСЂР°", "РљРѕР»-РІРѕ", "Р•Рґ.", "Р¦РµРЅР° Р·Р° С€С‚", "РЎСѓРјРјР°"];

    // РќР°СЃС‚СЂРѕР№РєР° РєРѕР»РѕРЅРѕРє (С€РёСЂРёРЅР°)
    worksheet.columns = [
      { key: "position", width: 8 },
      { key: "name", width: 40 },
      { key: "qty", width: 15 },
      { key: "unit", width: 10 },
      { key: "price", width: 15 },
      { key: "sum", width: 15 },
    ];

    // 4. Р—Р°РїРѕР»РЅСЏРµРј СЃС‚СЂРѕРєРё РґР°РЅРЅС‹РјРё
    const firstDataRow = 3; // РґР°РЅРЅС‹Рµ РЅР°С‡РёРЅР°СЋС‚СЃСЏ СЃ 3-Р№ СЃС‚СЂРѕРєРё

    lowItems.forEach((it, index) => {
      const rowIndex = firstDataRow + index;
      const row = worksheet.getRow(rowIndex);

      row.values = [
        index + 1,          // A: в„–
        it.name,            // B: РќРѕРјРµРЅРєР»Р°С‚СѓСЂР°
        it.orderQty,        // C: РљРѕР»-РІРѕ
        it.unit || "С€С‚",    // D: Р•Рґ.
        it.price ?? 0,      // E: Р¦РµРЅР°
        // F: РЎСѓРјРјР° (С„РѕСЂРјСѓР»Р°)
      ];

      // Р¤РѕСЂРјСѓР»Р° СЃСѓРјРјС‹: C*E
      row.getCell(6).value = {
        formula: `C${rowIndex}*E${rowIndex}`,
      };
    });

    const lastDataRow = firstDataRow + lowItems.length - 1;

    // 5. РЎС‚СЂРѕРєР° СЃ РёС‚РѕРіРѕРј РїРѕРґ С‚Р°Р±Р»РёС†РµР№
    const totalRowIndex = lastDataRow + 1;
    const totalRow = worksheet.getRow(totalRowIndex);

    totalRow.getCell(5).value = "РРўРћР“Рћ:";
    totalRow.getCell(5).font = { bold: true };
    totalRow.getCell(5).alignment = { horizontal: "right", vertical: "middle" };

    // РЎСѓРјРјР° РїРѕ СЃС‚РѕР»Р±С†Сѓ F
    totalRow.getCell(6).value = {
      formula: `SUM(F${firstDataRow}:F${lastDataRow})`,
    };
    totalRow.getCell(6).font = { bold: true };

    // 6. РћС„РѕСЂРјР»РµРЅРёРµ РіСЂР°РЅРёС† Рё РІС‹СЂР°РІРЅРёРІР°РЅРёРµ
    // РЁР°РїРєР° (СЃС‚СЂРѕРєР° 2)
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

    // Р”Р°РЅРЅС‹Рµ
    for (let r = firstDataRow; r <= lastDataRow; r++) {
      const row = worksheet.getRow(r);
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        // Р’С‹СЂР°РІРЅРёРІР°РЅРёРµ: С‚РµРєСЃС‚ СЃР»РµРІР°, С‡РёСЃР»Р° СЃРїСЂР°РІР°/С†РµРЅС‚СЂ
        if (cell.col === 2) { // РќРѕРјРµРЅРєР»Р°С‚СѓСЂР°
          cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
        } else {
          cell.alignment = { horizontal: "center", vertical: "middle" };
        }
      });
    }

    // РС‚РѕРіРѕРІР°СЏ СЃС‚СЂРѕРєР° (РіСЂР°РЅРёС†С‹ РґР»СЏ СЃСѓРјРјС‹)
    totalRow.getCell(6).border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };

    // 7. РћС‚РґР°С‘Рј С„Р°Р№Р»
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё С„РѕСЂРјРёСЂРѕРІР°РЅРёРё Р·Р°РєР°Р·Р°" });
  }
});

// РРјРїРѕСЂС‚ С‚РѕРІР°СЂРѕРІ РёР· Excel (С€Р°Р±Р»РѕРЅ "РРјРїРѕСЂС‚.xlsx")
app.post(
  "/api/inventory/items/import",
  auth,
  upload.single("file"), // Р¶РґС‘Рј С„Р°Р№Р» РІ РїРѕР»Рµ "file"
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ message: "Р¤Р°Р№Р» РЅРµ РїРµСЂРµРґР°РЅ" });
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        return res
          .status(400)
          .json({ message: "РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕС‡РёС‚Р°С‚СЊ РїРµСЂРІС‹Р№ Р»РёСЃС‚ С„Р°Р№Р»Р°" });
      }

      // РџСЂРµРґРїРѕР»Р°РіР°РµРј СЃС‚СЂСѓРєС‚СѓСЂСѓ С„Р°Р№Р»Р° "РРјРїРѕСЂС‚.xlsx":
      // 1-СЏ СЃС‚СЂРѕРєР° вЂ” Р·Р°РіРѕР»РѕРІРєРё, РґР°Р»СЊС€Рµ вЂ” РґР°РЅРЅС‹Рµ
      // A: РќР°РёРјРµРЅРѕРІР°РЅРёРµ
      // B: РђСЂС‚РёРєСѓР» (SKU)
      // C: РЁС‚СЂРёС…РєРѕРґ
      // D: Р•Рґ. РёР·Рј.
      // E: РњРёРЅ. РѕСЃС‚Р°С‚РѕРє
      // F: РњР°РєСЃ. РѕСЃС‚Р°С‚РѕРє
      // G: Р¦РµРЅР° Р·Р° РµРґРёРЅРёС†Сѓ
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

        // Р§РёСЃР»РѕРІС‹Рµ Р·РЅР°С‡РµРЅРёСЏ
        // F=6 (Min), I=9 (Max), J=10 (Price)
        let minStock = Math.round(toNumber(row.getCell(6).value));
        let maxStock = Math.round(toNumber(row.getCell(9).value));
        let defaultPrice = toNumber(row.getCell(10).value);

        console.log(`Row ${rowNumber}: SKU=${sku}, Min=${minStock}, Max=${maxStock}, Price=${defaultPrice}`);

        // Р•СЃР»Рё СЃС‚СЂРѕРєР° СЃРѕРІСЃРµРј РїСѓСЃС‚Р°СЏ вЂ” РїСЂРѕРїСѓСЃРєР°РµРј
        if (!name && !sku && !barcode) {
          skipped++;
          continue;
        }

        // Р‘РµР· РёРјРµРЅРё РёР»Рё SKU вЂ” РїСЂРѕРїСѓСЃРєР°РµРј (РєР°Рє Рё РІ API СЃРѕР·РґР°РЅРёСЏ С‚РѕРІР°СЂР°)
        if (!name || !sku) {
          skipped++;
          continue;
        }

        // РќРѕСЂРјР°Р»РёР·СѓРµРј: РЅРµ РґРѕРїСѓСЃРєР°РµРј РѕС‚СЂРёС†Р°С‚РµР»СЊРЅС‹С…
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
          // РС‰РµРј РїРѕ SKU (РѕРЅ Сѓ С‚РµР±СЏ СѓРЅРёРєР°Р»СЊРЅС‹Р№)
          const existing = await prisma.item.findUnique({
            where: { sku },
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
            "РћС€РёР±РєР° РїСЂРё РёРјРїРѕСЂС‚Рµ СЃС‚СЂРѕРєРё",
            rowNumber,
            err
          );
          skipped++;
        }
      }

      return res.json({
        message: "РРјРїРѕСЂС‚ Р·Р°РІРµСЂС€С‘РЅ",
        created,
        updated,
        skipped,
      });
    } catch (err) {
      console.error("import file error:", err);
      res.status(500).json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё РёРјРїРѕСЂС‚Рµ С„Р°Р№Р»Р°" });
    }
  }
);

// РџР°РєРµС‚РЅРѕРµ СЃРѕР·РґР°РЅРёРµ С‚РѕРІР°СЂРѕРІ (JSON) вЂ” РґР»СЏ ImportItemsModal
app.post("/api/inventory/items/batch", auth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ message: "РћР¶РёРґР°РµС‚СЃСЏ РјР°СЃСЃРёРІ items" });
    }

    let created = 0;
    let updated = 0;
    let errors = [];

    for (const item of items) {
      // Р’Р°Р»РёРґР°С†РёСЏ
      if (!item.name || !item.sku) {
        errors.push({ row: item.row, error: "РќРµС‚ РёРјРµРЅРё РёР»Рё SKU" });
        continue;
      }

      const data = {
        name: String(item.name).trim(),
        sku: String(item.sku).trim(),
        barcode: item.barcode ? String(item.barcode).trim() : null,
        unit: item.unit ? String(item.unit).trim() : "С€С‚",
        minStock: item.minStock ? Number(item.minStock) : 0,
        maxStock: item.maxStock ? Number(item.maxStock) : 0,
        defaultPrice: item.defaultPrice ? Number(item.defaultPrice) : 0,
      };

      try {
        const existing = await prisma.item.findUnique({
          where: { sku: data.sku },
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
        errors.push({ row: item.row, error: "РћС€РёР±РєР° Р‘Р” (РІРѕР·РјРѕР¶РЅРѕ РґСѓР±Р»СЊ)" });
      }
    }

    res.json({
      message: "РџР°РєРµС‚РЅР°СЏ РѕР±СЂР°Р±РѕС‚РєР° Р·Р°РІРµСЂС€РµРЅР°",
      created,
      updated,
      errors,
    });
  } catch (err) {
    console.error("batch import error:", err);
    res.status(500).json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё РїР°РєРµС‚РЅРѕРј РёРјРїРѕСЂС‚Рµ" });
  }
});

// ====== РЎРљР›РђР”: РҐР•Р›РџР•Р Р« Р”Р›РЇ РћРЎРўРђРўРљРћР’ ======

// С‚РµРєСѓС‰РёР№ РѕСЃС‚Р°С‚РѕРє РїРѕ С‚РѕРІР°СЂСѓ
async function getCurrentStockForItem(itemId) {
  const id = Number(itemId);

  const item = await prisma.item.findUnique({
    where: { id },
  });

  if (!item) return null;

  const movements = await prisma.stockMovement.findMany({
    where: { itemId: id },
  });

  let total = 0;

  for (const m of movements) {
    const q = Number(m.quantity) || 0;

    if (m.type === "INCOME") {
      total += Math.abs(q);
    } else if (m.type === "ISSUE") {
      total -= Math.abs(q);
    } else if (m.type === "ADJUSTMENT") {
      // РєРѕСЂСЂРµРєС‚РёСЂРѕРІРєР° РјРѕР¶РµС‚ Р±С‹С‚СЊ Рё РїР»СЋСЃ, Рё РјРёРЅСѓСЃ
      total += q;
    }
  }

  return total;
}

// СЂР°СЃС‡С‘С‚, РєР°РєРѕР№ РѕСЃС‚Р°С‚РѕРє Р±СѓРґРµС‚ РїРѕСЃР»Рµ РґРІРёР¶РµРЅРёСЏ
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

// РЎРѕР·РґР°С‚СЊ РґРІРёР¶РµРЅРёРµ (РїСЂРёС…РѕРґ / СЂР°СЃС…РѕРґ / РєРѕСЂСЂРµРєС‚РёСЂРѕРІРєР°) СЃ РїСЂРѕРІРµСЂРєРѕР№ РѕСЃС‚Р°С‚РєР°
app.post("/api/inventory/movements", auth, async (req, res) => {
  try {
    const { itemId, type, quantity, comment, pricePerUnit } = req.body;

    if (!itemId || !type || quantity === undefined) {
      return res
        .status(400)
        .json({ message: "РќСѓР¶РЅРѕ СѓРєР°Р·Р°С‚СЊ С‚РѕРІР°СЂ, С‚РёРї Рё РєРѕР»РёС‡РµСЃС‚РІРѕ" });
    }

    if (!["INCOME", "ISSUE", "ADJUSTMENT"].includes(type)) {
      return res.status(400).json({ message: "РќРµРґРѕРїСѓСЃС‚РёРјС‹Р№ С‚РёРї РґРІРёР¶РµРЅРёСЏ" });
    }

    const itemIdNum = Number(itemId);
    const qtyNum = Number(quantity);

    // С‚РѕР»СЊРєРѕ С†РµР»С‹Рµ С‡РёСЃР»Р° Рё РЅРµ 0
    if (!Number.isFinite(qtyNum) || !Number.isInteger(qtyNum) || qtyNum === 0) {
      return res.status(400).json({
        message: "РљРѕР»РёС‡РµСЃС‚РІРѕ РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ РЅРµРЅСѓР»РµРІС‹Рј С†РµР»С‹Рј С‡РёСЃР»РѕРј",
      });
    }

    let normalizedQty = qtyNum;

    // РґР»СЏ INCOME/ISSUE вЂ” С‚РѕР»СЊРєРѕ РїРѕР»РѕР¶РёС‚РµР»СЊРЅС‹Рµ С†РµР»С‹Рµ
    if (type === "INCOME" || type === "ISSUE") {
      if (qtyNum < 0) {
        return res.status(400).json({
          message:
            "Р”Р»СЏ РїСЂРёС…РѕРґР° Рё СЂР°СЃС…РѕРґР° РєРѕР»РёС‡РµСЃС‚РІРѕ РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ РїРѕР»РѕР¶РёС‚РµР»СЊРЅС‹Рј С†РµР»С‹Рј С‡РёСЃР»РѕРј",
        });
      }
      normalizedQty = qtyNum; // > 0
    }

    // Р”Р»СЏ РџР РРҐРћР”Рђ РЅСѓР¶РЅР° С†РµРЅР° Р·Р° РµРґРёРЅРёС†Сѓ
    let priceValue = null;
    if (type === "INCOME") {
      if (
        pricePerUnit === undefined ||
        pricePerUnit === null ||
        pricePerUnit === ""
      ) {
        return res
          .status(400)
          .json({ message: "Р”Р»СЏ РїСЂРёС…РѕРґР° РЅСѓР¶РЅРѕ СѓРєР°Р·Р°С‚СЊ С†РµРЅСѓ Р·Р° РµРґРёРЅРёС†Сѓ" });
      }

      const p = Number(String(pricePerUnit).replace(",", "."));

      if (!Number.isFinite(p) || p <= 0) {
        return res.status(400).json({
          message: "Р¦РµРЅР° Р·Р° РµРґРёРЅРёС†Сѓ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ РїРѕР»РѕР¶РёС‚РµР»СЊРЅС‹Рј С‡РёСЃР»РѕРј",
        });
      }

      priceValue = p;
    }

    // ===== РџР РћР’Р•Р РљРђ РћРЎРўРђРўРљРђ РџР•Р Р•Р” РЎРћР—Р”РђРќРР•Рњ Р”Р’РР–Р•РќРРЇ =====
    let stockInfo;
    try {
      stockInfo = await calculateStockAfterMovement(
        itemIdNum,
        type,
        normalizedQty
      );
    } catch (e) {
      if (e.code === "ITEM_NOT_FOUND") {
        return res.status(404).json({ message: "РўРѕРІР°СЂ РЅРµ РЅР°Р№РґРµРЅ" });
      }
      console.error("calculateStockAfterMovement error:", e);
      return res
        .status(500)
        .json({ message: "РћС€РёР±РєР° РїСЂРё СЂР°СЃС‡С‘С‚Рµ РѕСЃС‚Р°С‚РєР° РїРѕ С‚РѕРІР°СЂСѓ" });
    }

    if (stockInfo.newStock < 0) {
      return res.status(400).json({
        message: `РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РѕСЃС‚Р°С‚РєР°. РќР° СЃРєР»Р°РґРµ ${stockInfo.current} С€С‚., РІС‹ РїС‹С‚Р°РµС‚РµСЃСЊ СЃРїРёСЃР°С‚СЊ ${normalizedQty} С€С‚.`,
      });
    }
    // ===== РљРћРќР•Р¦ РџР РћР’Р•Р РљР РћРЎРўРђРўРљРђ =====

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
      message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СЃРѕР·РґР°РЅРёРё РґРІРёР¶РµРЅРёСЏ РїРѕ СЃРєР»Р°РґСѓ",
    });
  }
});

// Р–СѓСЂРЅР°Р» РґРІРёР¶РµРЅРёР№ РїРѕ СЃРєР»Р°РґСѓ
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ РґРІРёР¶РµРЅРёР№" });
  }
});

// ================== РџРћРЎРўРђР’Р©РРљР ==================

// РЎРїРёСЃРѕРє РїРѕСЃС‚Р°РІС‰РёРєРѕРІ
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ РїРѕСЃС‚Р°РІС‰РёРєРѕРІ" });
  }
});

// РЎРѕР·РґР°С‚СЊ РїРѕСЃС‚Р°РІС‰РёРєР°
app.post("/api/suppliers", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
    }

    const { name, inn, phone, email, comment } = req.body;

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ message: "РќР°Р·РІР°РЅРёРµ РїРѕСЃС‚Р°РІС‰РёРєР° РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ" });
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СЃРѕР·РґР°РЅРёРё РїРѕСЃС‚Р°РІС‰РёРєР°" });
  }
});

// РћР±РЅРѕРІРёС‚СЊ РїРѕСЃС‚Р°РІС‰РёРєР°
app.put("/api/suppliers/:id", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
    }

    const id = Number(req.params.id);
    const { name, inn, phone, email, comment } = req.body;

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID РїРѕСЃС‚Р°РІС‰РёРєР°" });
    }

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ message: "РќР°Р·РІР°РЅРёРµ РїРѕСЃС‚Р°РІС‰РёРєР° РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ" });
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё РѕР±РЅРѕРІР»РµРЅРёРё РїРѕСЃС‚Р°РІС‰РёРєР°" });
  }
});

// РЈРґР°Р»РёС‚СЊ РїРѕСЃС‚Р°РІС‰РёРєР° (РµСЃР»Рё РїРѕ РЅРµРјСѓ РЅРµС‚ Р·Р°РєР°Р·РѕРІ)
app.delete("/api/suppliers/:id", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
    }

    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID РїРѕСЃС‚Р°РІС‰РёРєР°" });
    }

    const ordersCount = await prisma.purchaseOrder.count({
      where: { supplierId: id },
    });

    if (ordersCount > 0) {
      return res.status(400).json({
        message: "РќРµР»СЊР·СЏ СѓРґР°Р»РёС‚СЊ РїРѕСЃС‚Р°РІС‰РёРєР°, РїРѕ РЅРµРјСѓ РµСЃС‚СЊ Р·Р°РєР°Р·С‹",
      });
    }

    await prisma.supplier.delete({ where: { id } });
    res.json({ message: "РџРѕСЃС‚Р°РІС‰РёРє СѓРґР°Р»С‘РЅ" });
  } catch (err) {
    console.error("delete supplier error:", err);
    res
      .status(500)
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СѓРґР°Р»РµРЅРёРё РїРѕСЃС‚Р°РІС‰РёРєР°" });
  }
});

// ================== Р—РђРљРђР—Р« РџРћРЎРўРђР’Р©РРљРЈ ==================

// РЎРѕР·РґР°С‚СЊ Р·Р°РєР°Р· РїРѕСЃС‚Р°РІС‰РёРєСѓ (Р·Р°РїРёСЃСЊ РІ Р‘Р”)
app.post("/api/purchase-orders", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
    }

    const { supplierId, plannedDate, comment, items } = req.body;

    const supplierIdNum = Number(supplierId);
    if (!supplierIdNum || Number.isNaN(supplierIdNum)) {
      return res
        .status(400)
        .json({ message: "РќСѓР¶РЅРѕ СѓРєР°Р·Р°С‚СЊ РєРѕСЂСЂРµРєС‚РЅРѕРіРѕ РїРѕСЃС‚Р°РІС‰РёРєР°" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ message: "РќСѓР¶РЅРѕ СѓРєР°Р·Р°С‚СЊ С…РѕС‚СЏ Р±С‹ РѕРґРЅСѓ РїРѕР·РёС†РёСЋ Р·Р°РєР°Р·Р°" });
    }

    // РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РїРѕСЃС‚Р°РІС‰РёРє СЃСѓС‰РµСЃС‚РІСѓРµС‚
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierIdNum },
    });

    if (!supplier) {
      return res.status(404).json({ message: "РџРѕСЃС‚Р°РІС‰РёРє РЅРµ РЅР°Р№РґРµРЅ" });
    }

    // Р“РѕС‚РѕРІРёРј РїРѕР·РёС†РёРё
    const preparedItems = [];
    for (const row of items) {
      const itemId = Number(row.itemId);
      const qty = Number(row.quantity);
      const price = Number(String(row.price).replace(",", "."));

      if (!itemId || Number.isNaN(itemId)) {
        return res
          .status(400)
          .json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ С‚РѕРІР°СЂ РІ СЃРїРёСЃРєРµ РїРѕР·РёС†РёР№" });
      }

      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({
          message: "РљРѕР»РёС‡РµСЃС‚РІРѕ РїРѕ РєР°Р¶РґРѕР№ РїРѕР·РёС†РёРё РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ > 0",
        });
      }

      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({
          message:
            "Р¦РµРЅР° РїРѕ РєР°Р¶РґРѕР№ РїРѕР·РёС†РёРё РґРѕР»Р¶РЅР° Р±С‹С‚СЊ С‡РёСЃР»РѕРј (РјРѕР¶РµС‚ Р±С‹С‚СЊ 0, РЅРѕ РЅРµ РјРµРЅСЊС€Рµ)",
        });
      }

      preparedItems.push({
        itemId,
        quantity: qty,
        price,
      });
    }

    // Р“РµРЅРµСЂРёСЂСѓРµРј РЅРѕРјРµСЂ Р·Р°РєР°Р·Р°: PO-00001, PO-00002, ...
    const lastOrder = await prisma.purchaseOrder.findFirst({
      orderBy: { id: "desc" },
      select: { id: true },
    });

    const nextNumber = `PO-${String((lastOrder?.id || 0) + 1).padStart(
      5,
      "0"
    )}`;

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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СЃРѕР·РґР°РЅРёРё Р·Р°РєР°Р·Р° РїРѕСЃС‚Р°РІС‰РёРєСѓ" });
  }
});

// РЎРїРёСЃРѕРє Р·Р°РєР°Р·РѕРІ РїРѕСЃС‚Р°РІС‰РёРєСѓ
app.get("/api/purchase-orders", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ Р·Р°РєР°Р·РѕРІ РїРѕСЃС‚Р°РІС‰РёРєСѓ" });
  }
});

// ===== WAREHOUSE RECEIVING: OPEN POs =====
app.get("/api/warehouse/receiving/open-pos", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
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

    const list = orders.map((order) => {
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
    });

    res.json(list);
  } catch (err) {
    console.error("open pos error:", err);
    res.status(500).json({ message: "OPEN_POS_ERROR" });
  }
});


// РџРѕР»СѓС‡РёС‚СЊ РѕРґРёРЅ Р·Р°РєР°Р·
app.get("/api/purchase-orders/:id", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
    }

    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID Р·Р°РєР°Р·Р°" });
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
      return res.status(404).json({ message: "Р—Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ" });
    }

    res.json(order);
  } catch (err) {
    console.error("get purchase order error:", err);
    res
      .status(500)
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ Р·Р°РєР°Р·Р° РїРѕСЃС‚Р°РІС‰РёРєСѓ" });
  }
});

// Excel-С„Р°Р№Р» РїРѕ СѓР¶Рµ СЃРѕС…СЂР°РЅС‘РЅРЅРѕРјСѓ Р·Р°РєР°Р·Сѓ РїРѕСЃС‚Р°РІС‰РёРєСѓ

// ===== Purchase Order: RECEIVE ACT (PRINT) =====
app.get("/api/purchase-orders/:id/print-receive-act", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "NO_ACCESS" });
    }

    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "BAD_PO_ID" });
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
      return res.status(404).json({ message: "PO_NOT_FOUND" });
    }

    const rows = order.items.map((row) => ({
      name: row.item?.name || row.name || "",
      orderedQty: row.quantity,
      receivedQty: row.receivedQty ?? 0,
    }));

    const shortageRows = rows.filter(
      (row) => Number(row.orderedQty) > Number(row.receivedQty)
    );

    if (shortageRows.length === 0) {
      return res.status(204).end();
    }

    const profile = await prisma.orgProfile.findUnique({ where: { id: 1 } });
    if (!profile) {
      return res.status(409).json({ message: "ORG_PROFILE_REQUIRED" });
    }

    const html = buildReceiveActHtml(order, shortageRows, profile);
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
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
    }

    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res
        .status(400)
        .json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID Р·Р°РєР°Р·Р°" });
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
      return res.status(404).json({ message: "Р—Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ" });
    }

    // ---------- Excel ----------
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Р—Р°РєР°Р· РїРѕСЃС‚Р°РІС‰РёРєСѓ");

    const dateStr = new Date(order.date).toLocaleDateString("ru-RU");
    worksheet.mergeCells("A1:F1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `Р—РђРљРђР— ${order.number} РѕС‚ ${dateStr}`;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };

    // РџРѕРґРїРёСЃСЊ РїРѕСЃС‚Р°РІС‰РёРєР° РїРѕРґ Р·Р°РіРѕР»РѕРІРєРѕРј (РїРѕ Р¶РµР»Р°РЅРёСЋ)
    worksheet.mergeCells("A2:F2");
    const supCell = worksheet.getCell("A2");
    supCell.value = `РџРѕСЃС‚Р°РІС‰РёРє: ${order.supplier?.name || ""}`;
    supCell.alignment = { horizontal: "left", vertical: "middle" };

    // РЁР°РїРєР° С‚Р°Р±Р»РёС†С‹
    const headerRowIndex = 4;
    worksheet.getRow(headerRowIndex).values = [
      "в„–",
      "РќРѕРјРµРЅРєР»Р°С‚СѓСЂР°",
      "РљРѕР»-РІРѕ",
      "Р•Рґ.",
      "Р¦РµРЅР° Р·Р° С€С‚",
      "РЎСѓРјРјР°",
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
      const unit = row.item?.unit || "С€С‚";
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

    // РС‚РѕРі
    const totalRowIndex = lastDataRow + 1;
    const totalRow = worksheet.getRow(totalRowIndex);
    totalRow.getCell(5).value = "РРўРћР“Рћ:";
    totalRow.getCell(5).font = { bold: true };
    totalRow.getCell(5).alignment = {
      horizontal: "right",
      vertical: "middle",
    };
    totalRow.getCell(6).value = {
      formula: `SUM(F${firstDataRow}:F${lastDataRow})`,
    };
    totalRow.getCell(6).font = { bold: true };

    // РћС„РѕСЂРјР»РµРЅРёРµ
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё С„РѕСЂРјРёСЂРѕРІР°РЅРёРё Excel Р·Р°РєР°Р·Р°" });
  }
});

// РЎРјРµРЅР° СЃС‚Р°С‚СѓСЃР° Р·Р°РєР°Р·Р° (Рё РїСЂРё RECEIVED вЂ” Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРёР№ РїСЂРёС…РѕРґ РЅР° СЃРєР»Р°Рґ)
app.put("/api/purchase-orders/:id/status", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
    }

    const id = Number(req.params.id);
    const { status } = req.body;

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID Р·Р°РєР°Р·Р°" });
    }

    const allowedStatuses = ["DRAFT", "SENT", "PARTIAL", "RECEIVED", "CLOSED"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "РќРµРґРѕРїСѓСЃС‚РёРјС‹Р№ СЃС‚Р°С‚СѓСЃ Р·Р°РєР°Р·Р°" });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Р—Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ" });
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
          message: "Р­С‚РѕС‚ Р·Р°РєР°Р· СѓР¶Рµ РїСЂРѕРІРµРґС‘РЅ РїРѕ СЃРєР»Р°РґСѓ",
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
            comment: `РџСЂРёС…РѕРґ РїРѕ Р·Р°РєР°Р·Сѓ РїРѕСЃС‚Р°РІС‰РёРєСѓ ${order.number} [PO#${order.id}]`,
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СЃРјРµРЅРµ СЃС‚Р°С‚СѓСЃР° Р·Р°РєР°Р·Р°" });
  }
});

// РџСЂРёС‘РјРєР° Р·Р°РєР°Р·Р° РїРѕСЃС‚Р°РІС‰РёРєСѓ (СЃ Р°РєС‚РѕРј СЂР°СЃС…РѕР¶РґРµРЅРёР№)
app.post("/api/purchase-orders/:id/receive", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
    }

    const id = Number(req.params.id);
    const { items } = req.body || {};

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID Р·Р°РєР°Р·Р°" });
    }

    if (!Array.isArray(items)) {
      return res
        .status(400)
        .json({ message: "РќСѓР¶РЅРѕ РїРµСЂРµРґР°С‚СЊ РјР°СЃСЃРёРІ РїРѕР·РёС†РёР№ РґР»СЏ РїСЂРёС‘РјРєРё" });
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
      return res.status(404).json({ message: "Р—Р°РєР°Р· РЅРµ РЅР°Р№РґРµРЅ" });
    }

    // РµСЃР»Рё СЃС‚Р°С‚СѓСЃ СѓР¶Рµ РїРѕР»СѓС‡РµРЅ/Р·Р°РєСЂС‹С‚ вЂ” РЅРµ РґР°С‘Рј РїСЂРѕРІРµСЃС‚Рё РµС‰С‘ СЂР°Р·
    if (order.status === "RECEIVED" || order.status === "CLOSED") {
      return res
        .status(400)
        .json({ message: "Р­С‚РѕС‚ Р·Р°РєР°Р· СѓР¶Рµ Р±С‹Р» РїСЂРѕРІРµРґС‘РЅ РїРѕ СЃРєР»Р°РґСѓ" });
    }

    // РџСЂРѕРІРµСЂРєР° РЅР° СѓР¶Рµ СЃРѕР·РґР°РЅРЅС‹Рµ РґРІРёР¶РµРЅРёСЏ РїРѕ СЌС‚РѕРјСѓ Р·Р°РєР°Р·Сѓ
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
        .json({ message: "Р­С‚РѕС‚ Р·Р°РєР°Р· СѓР¶Рµ РїСЂРѕРІРµРґС‘РЅ РїРѕ СЃРєР»Р°РґСѓ" });
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
        : ordered; // РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ СЃС‡РёС‚Р°РµРј, С‡С‚Рѕ РїСЂРёС€Р»Рѕ СЃС‚РѕР»СЊРєРѕ Р¶Рµ, СЃРєРѕР»СЊРєРѕ Р·Р°РєР°Р·Р°РЅРѕ

      // РґРІРёР¶РµРЅРёРµ РїРѕ СЃРєР»Р°РґСѓ вЂ” С‚РѕР»СЊРєРѕ РµСЃР»Рё СЂРµР°Р»СЊРЅРѕ С‡С‚Рѕ-С‚Рѕ РїСЂРёС€Р»Рѕ
      receivedByOrderItemId.set(row.id, received);
      if (received > 0) {
        movementsData.push({
          itemId: row.itemId,
          type: "INCOME",
          quantity: Math.round(received),
          pricePerUnit: row.price,
          comment: `РџСЂРёС…РѕРґ РїРѕ Р·Р°РєР°Р·Сѓ ${order.number} [PO#${order.id}] (Р·Р°РєР°Р·Р°РЅРѕ ${ordered}, РїРѕР»СѓС‡РµРЅРѕ ${received})`,
          createdById: userId,
        });
      }

      const diff = received - ordered;
      if (diff !== 0) {
        discrepancies.push({
          itemName: row.item?.name || "",
          unit: row.item?.unit || "С€С‚",
          orderedQty: ordered,
          receivedQty: received,
          diffQty: diff,
          price: row.price,
        });
      }
    }

    // СЃРѕР·РґР°С‘Рј РґРІРёР¶РµРЅРёСЏ
    if (movementsData.length > 0) {
      await prisma.stockMovement.createMany({ data: movementsData });
    }

    // РѕР±РЅРѕРІР»СЏРµРј СЃС‚Р°С‚СѓСЃ Р·Р°РєР°Р·Р°
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё РїСЂРёС‘РјРєРµ Р·Р°РєР°Р·Р°" });
  }
});

// ===== WAREHOUSE RECEIVING: CONFIRM PO =====
app.post("/api/warehouse/receiving/:poId/confirm", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
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
    order.items.forEach((row) => {
      orderItemsByItemId.set(row.itemId, row);
    });

    const createdDiscrepancies = [];
    const movementIds = [];

    await prisma.$transaction(async (tx) => {
      for (const line of lines) {
        const itemId = Number(line.productId ?? line.itemId);
        const qty = Number(line.qty);
        if (!itemId || !Number.isFinite(qty) || qty <= 0) continue;

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
          qty: Math.trunc(qty),
          locationId: location.id,
          comment: `PO RECEIVING ${order.number} [PO#${order.id}]`,
          refType: "PO",
          refId: String(order.id),
          userId: req.user?.id || null,
        });

        movementIds.push(movement.id);

        const orderRow = orderItemsByItemId.get(itemId);
        if (orderRow) {
          const ordered = Number(orderRow.quantity) || 0;
          const prevReceived = Number(orderRow.receivedQty) || 0;
          const expectedRemaining = Math.max(0, ordered - prevReceived);
          const nextReceived = prevReceived + qty;

          await tx.purchaseOrderItem.update({
            where: { id: orderRow.id },
            data: { receivedQty: nextReceived },
          });

          if (qty !== expectedRemaining) {
            const delta = Math.trunc(qty - expectedRemaining);
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
                  receivedQty: Math.trunc(qty),
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
                receivedQty: Math.trunc(qty),
                delta: Math.trunc(qty),
                status: "OPEN",
                movementOpId,
                note: "UNPLANNED_ITEM",
              },
            });
            createdDiscrepancies.push(created.id);
          }
        }
      }

      const refreshed = await tx.purchaseOrder.findUnique({
        where: { id: poId },
        include: { items: true },
      });

      if (refreshed) {
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
        if (nextStatus !== refreshed.status) {
          await tx.purchaseOrder.update({
            where: { id: poId },
            data: { status: nextStatus },
          });
        }
      }

      await tx.receivingDiscrepancy.findMany({
        where: { id: { in: createdDiscrepancies } },
      });
    });

    const updatedOrder = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: {
        supplier: true,
        items: { include: { item: true } },
      },
    });

    res.json({
      ok: true,
      movementIds,
      discrepancies: createdDiscrepancies,
      order: updatedOrder,
    });
  } catch (err) {
    console.error("po receiving confirm error:", err);
    if (err.code === "INSUFFICIENT_QTY") {
      return res.status(400).json({ message: "INSUFFICIENT_QTY" });
    }
    res.status(500).json({ message: "PO_RECEIVING_CONFIRM_ERROR" });
  }
});

// ===== RECEIVING DISCREPANCIES =====
app.get("/api/warehouse/receiving/:poId/discrepancies", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
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
    if (!isWarehouseManager(req.user)) {
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


// ===== Excel-С„Р°Р№Р» Р·Р°РєР°Р·Р° РїРѕСЃС‚Р°РІС‰РёРєСѓ (Р±РµР· СЃРѕС…СЂР°РЅРµРЅРёСЏ РІ Р‘Р”) =====
app.post("/api/purchase-orders/excel-file", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
    }

    const { supplierId, plannedDate, comment, items } = req.body;

    const supplierIdNum = Number(supplierId);
    if (!supplierIdNum || Number.isNaN(supplierIdNum)) {
      return res
        .status(400)
        .json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ РїРѕСЃС‚Р°РІС‰РёРє" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "РќСѓР¶РЅРѕ СѓРєР°Р·Р°С‚СЊ С…РѕС‚СЏ Р±С‹ РѕРґРЅСѓ РїРѕР·РёС†РёСЋ Р·Р°РєР°Р·Р°",
      });
    }

    // РџС‹С‚Р°РµРјСЃСЏ СѓР·РЅР°С‚СЊ РёРјСЏ РїРѕСЃС‚Р°РІС‰РёРєР° (РµСЃР»Рё РЅРµ РїРѕР»СѓС‡РёС‚СЃСЏ вЂ“ РїСЂРѕСЃС‚Рѕ Р±СѓРґРµС‚ "РџРѕСЃС‚Р°РІС‰РёРє")
    let supplierName = "РџРѕСЃС‚Р°РІС‰РёРє";
    try {
      const supplier = await prisma.supplier.findUnique({
        where: { id: supplierIdNum },
      });
      if (supplier?.name) supplierName = supplier.name;
    } catch (e) {
      console.error("[excel-file] РћС€РёР±РєР° С‡С‚РµРЅРёСЏ РїРѕСЃС‚Р°РІС‰РёРєР°:", e);
    }

    // Р§РёСЃС‚РёРј Рё РІР°Р»РёРґРёСЂСѓРµРј РїРѕР·РёС†РёРё
    const cleanedItems = [];
    for (const raw of items) {
      const name = String(raw.name || "").trim();
      const unit = String(raw.unit || "С€С‚").trim();
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
        message: "РќРµС‚ РІР°Р»РёРґРЅС‹С… РїРѕР·РёС†РёР№ РґР»СЏ С„РѕСЂРјРёСЂРѕРІР°РЅРёСЏ Р·Р°РєР°Р·Р°",
      });
    }

    // === Р¤РѕСЂРјРёСЂСѓРµРј Excel ===
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Р—Р°РєР°Р·");

    const now = new Date();
    const orderDateStr = now.toLocaleDateString("ru-RU");
    const plannedDateStr = plannedDate
      ? new Date(plannedDate).toLocaleDateString("ru-RU")
      : null;

    // РЎС‚СЂРѕРєР° 1 вЂ” Р·Р°РіРѕР»РѕРІРѕРє
    worksheet.mergeCells("A1:F1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `Р—Р°РєР°Р· РїРѕСЃС‚Р°РІС‰РёРєСѓ: ${supplierName}`;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };

    // РЎС‚СЂРѕРєР° 2 вЂ” РґР°С‚Р° Р·Р°РєР°Р·Р° / РїР»Р°РЅ. РїСЂРёС‘РјРєР°
    worksheet.mergeCells("A2:F2");
    const metaCell = worksheet.getCell("A2");
    metaCell.value =
      `Р”Р°С‚Р° Р·Р°РєР°Р·Р°: ${orderDateStr}` +
      (plannedDateStr ? ` / РџР»Р°РЅ. РїСЂРёС‘РјРєР°: ${plannedDateStr}` : "");
    metaCell.alignment = { horizontal: "right", vertical: "middle" };
    metaCell.font = { size: 11, color: { argb: "FF555555" } };

    // РЎС‚СЂРѕРєР° 3 вЂ” РїСѓСЃС‚Р°СЏ
    worksheet.getRow(3).height = 4;

    // РЎС‚СЂРѕРєР° 4 вЂ” С€Р°РїРєР° С‚Р°Р±Р»РёС†С‹
    const headerRowIndex = 4;
    const headerRow = worksheet.getRow(headerRowIndex);
    headerRow.values = ["в„–", "РќРѕРјРµРЅРєР»Р°С‚СѓСЂР°", "РљРѕР»-РІРѕ", "Р•Рґ.", "Р¦РµРЅР°", "РЎСѓРјРјР°"];

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

    // Р”Р°РЅРЅС‹Рµ
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
        undefined, // С„РѕСЂРјСѓР»Р° Р±СѓРґРµС‚ РЅРёР¶Рµ
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

    // РС‚РѕРіРѕРІР°СЏ СЃС‚СЂРѕРєР°
    const totalRowIndex = lastDataRow + 1;
    const totalRow = worksheet.getRow(totalRowIndex);

    totalRow.getCell(5).value = "РС‚РѕРіРѕ:";
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

    // РљРѕРјРјРµРЅС‚Р°СЂРёР№ (РµСЃР»Рё РµСЃС‚СЊ)
    if (comment) {
      const commentRowIndex = totalRowIndex + 2;
      worksheet.mergeCells(`A${commentRowIndex}:F${commentRowIndex}`);
      const cCell = worksheet.getCell(`A${commentRowIndex}`);
      cCell.value = `РљРѕРјРјРµРЅС‚Р°СЂРёР№: ${comment}`;
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
      message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё С„РѕСЂРјРёСЂРѕРІР°РЅРёРё Excel-Р·Р°РєР°Р·Р° РїРѕСЃС‚Р°РІС‰РёРєСѓ",
      error: String(err),
    });
  }
});

// ================== РћР§Р•Р Р•Р”Р¬ РњРђРЁРРќ РџРћРЎРўРђР’Р©РРљРћР’ ==================

// СЃРїРёСЃРѕРє РјР°С€РёРЅ РІ РѕС‡РµСЂРµРґРё (СЃ С„РёР»СЊС‚СЂР°РјРё)
app.get("/api/supplier-trucks", auth, async (req, res) => {
  try {
    const onlyActive = req.query.onlyActive === "1";
    const { dateFrom, dateTo } = req.query;

    const where = {};

    // С„РёР»СЊС‚СЂ РїРѕ СЃС‚Р°С‚СѓСЃСѓ
    if (onlyActive) {
      where.status = { in: ["IN_QUEUE", "UNLOADING"] };
    }

    // С„РёР»СЊС‚СЂ РїРѕ РґР°С‚Рµ РїСЂРёР±С‹С‚РёСЏ (РєРѕР»РѕРЅРєР° "РџСЂРёР±С‹С‚РёРµ")
    // dateFrom Рё dateTo РїСЂРёС…РѕРґСЏС‚ РІ С„РѕСЂРјР°С‚Рµ "YYYY-MM-DD"
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (!Number.isNaN(from.getTime())) {
        // РЅР°С‡Р°Р»Рѕ РґРЅСЏ
        from.setHours(0, 0, 0, 0);
        where.arrivalAt = { ...(where.arrivalAt || {}), gte: from };
      }
    }

    if (dateTo) {
      const to = new Date(dateTo);
      if (!Number.isNaN(to.getTime())) {
        // РєРѕРЅРµС† РґРЅСЏ
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё Р·Р°РіСЂСѓР·РєРµ РѕС‡РµСЂРµРґРё РјР°С€РёРЅ" });
  }
});

// СЂРµРіРёСЃС‚СЂР°С†РёСЏ РјР°С€РёРЅС‹ РІ РѕС‡РµСЂРµРґРё
app.post("/api/supplier-trucks", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
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
          "РЈРєР°Р¶РёС‚Рµ С…РѕС‚СЏ Р±С‹ РїРѕСЃС‚Р°РІС‰РёРєР°, РЅРѕРјРµСЂ РјР°С€РёРЅС‹ РёР»Рё РІРѕРґРёС‚РµР»СЏ РґР»СЏ СЂРµРіРёСЃС‚СЂР°С†РёРё РІ РѕС‡РµСЂРµРґРё",
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
        // arrivalAt Рё status РїРѕСЃС‚Р°РІСЏС‚СЃСЏ СЃР°РјРё (РґРµС„РѕР»С‚С‹)
      },
    });

    res.status(201).json(truck);
  } catch (err) {
    console.error("create supplier truck error:", err);
    res
      .status(500)
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СЂРµРіРёСЃС‚СЂР°С†РёРё РјР°С€РёРЅС‹ РІ РѕС‡РµСЂРµРґРё" });
  }
});

// СЃРјРµРЅР° СЃС‚Р°С‚СѓСЃР° (РІ РѕС‡РµСЂРµРґРё -> РЅР° СЂР°Р·РіСЂСѓР·РєРµ -> РІС‹РµС…Р°Р»)
app.put("/api/supplier-trucks/:id/status", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "РќРµС‚ РїСЂР°РІ" });
    }

    const id = Number(req.params.id);
    const { status, gate } = req.body || {};

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ ID Р·Р°РїРёСЃРё" });
    }

    if (!["IN_QUEUE", "UNLOADING", "DONE"].includes(status)) {
      return res.status(400).json({ message: "РќРµРґРѕРїСѓСЃС‚РёРјС‹Р№ СЃС‚Р°С‚СѓСЃ" });
    }

    const truck = await prisma.supplierTruck.findUnique({
      where: { id },
    });

    if (!truck) {
      return res.status(404).json({ message: "Р—Р°РїРёСЃСЊ РЅРµ РЅР°Р№РґРµРЅР°" });
    }

    const data = { status };
    const now = new Date();

    // РєРѕРіРґР° СЃС‚Р°РІРёРј РЅР° СЂР°Р·РіСЂСѓР·РєСѓ вЂ” С„РёРєСЃРёСЂСѓРµРј РІСЂРµРјСЏ Рё РІРѕСЂРѕС‚Р°
    if (status === "UNLOADING" && !truck.unloadStartAt) {
      data.unloadStartAt = now;
      if (gate) data.gate = gate;
    }

    // РєРѕРіРґР° РІС‹РµС…Р°Р» вЂ” С„РёРєСЃРёСЂСѓРµРј РІСЂРµРјСЏ РІС‹РµР·РґР°
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
      .json({ message: "РћС€РёР±РєР° СЃРµСЂРІРµСЂР° РїСЂРё СЃРјРµРЅРµ СЃС‚Р°С‚СѓСЃР° РјР°С€РёРЅС‹" });
  }
});

// ================== РџР•Р РРћР”РР§Р•РЎРљРР• Р—РђР”РђР§Р ==================

// РґР°С‚Р°, Р·Р° РєРѕС‚РѕСЂСѓСЋ СѓР¶Рµ РѕС‚РїСЂР°РІР»РµРЅ РµР¶РµРґРЅРµРІРЅС‹Р№ РѕС‚С‡С‘С‚ РїРѕ РѕСЃС‚Р°С‚РєР°Рј (С„РѕСЂРјР°С‚ "YYYY-MM-DD")
let lastLowStockReportDate = null;

// РїСЂРѕРІРµСЂРєР° РєР°Р¶РґС‹Рµ 60 СЃРµРєСѓРЅРґ
setInterval(() => {
  // 1) РЅР°РїРѕРјРёРЅР°РЅРёСЏ РїРѕ Р·Р°РґР°С‡Р°Рј СЃРєР»Р°РґР°
  checkWarehouseTaskNotifications().catch((err) =>
    console.error("РћС€РёР±РєР° РІ checkWarehouseTaskNotifications:", err)
  );

  // 2) СЂР°Р· РІ РґРµРЅСЊ РІ 18:00 РѕС‚РїСЂР°РІР»СЏРµРј РѕС‚С‡С‘С‚ РїРѕ РјРёРЅРёРјР°Р»СЊРЅС‹Рј РѕСЃС‚Р°С‚РєР°Рј
  const now = new Date();
  const hours = now.getHours(); // 0..23
  const minutes = now.getMinutes(); // 0..59
  const todayKey = now.toISOString().slice(0, 10); // "YYYY-MM-DD"

  if (hours === 18 && minutes === 0 && lastLowStockReportDate !== todayKey) {
    lastLowStockReportDate = todayKey;

    sendDailyLowStockSummary().catch((err) =>
      console.error("РћС€РёР±РєР° РІ sendDailyLowStockSummary:", err)
    );
  }
}, 60 * 1000);

// Р·Р°РїСѓСЃРє long polling Telegram (РѕРґРёРЅ СЌРєР·РµРјРїР»СЏСЂ)
startTelegramPolling().catch((err) =>
  console.error("РћС€РёР±РєР° РїСЂРё Р·Р°РїСѓСЃРєРµ startTelegramPolling:", err)
);

// ================== Р—РђРџРЈРЎРљ РЎР•Р Р’Р•Р Рђ ==================

initMailer().catch((err) => console.error("[MAIL] init error:", err));

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`рџљЂ API Р·Р°РїСѓС‰РµРЅ: http://localhost:${PORT}`);
});





