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
import QRCode from "qrcode";
import bwipjs from "bwip-js";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adminRoutes } from "./adminRoutes.js";
import { createWarehouseStockService } from "./services/warehouseStockService.js";

// ================== НЦАЛЗАЦЯ ==================

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
  "PortalNews",
  "InviteToken",
  "Membership",
  "Subscription",
  "Payment"
]);

function getOrgIdFromContext() {
  return orgContext.getStore()?.orgId || null;
}

// для загрузки файлов в память (будем читать Excel из буфера)
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return originalJson(body);
  };
  next();
});
app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ok: true, version: APP_VERSION, db: "ok" });
  } catch (err) {
    console.error("health db error:", err?.message || err);
    return res.json({ ok: false, version: APP_VERSION, db: "error" });
  }
});


// ================== JWT / АВТОРЗАЦЯ ==================

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
    return res.status(401).json({ message: "Authorization token missing" });
  }

  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) {
    return res.status(401).json({ message: "Invalid authorization header" });
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
    return res.status(401).json({ message: "Invalid or expired token" });
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
  const from = process.env.MAIL_FROM || `Бизнес-портал <${user || ""}>`;
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

  const from = process.env.MAIL_FROM || `Бизнес-портал <${process.env.MAIL_USER}>`;
  const subject = "Приглашение в Бизнес-портал";
  const text = `Вы приглашены в Бизнес-портал. Перейдите по ссылке для завершения регистрации: ${link}`;
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;">
      <p>Вы приглашены в Бизнес-портал.</p>
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

  const from = process.env.MAIL_FROM || `Бизнес-портал <${process.env.MAIL_USER}>`;
  const subject = "Сброс пароля в Бизнес-портале";
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

  const from = process.env.MAIL_FROM || `Бизнес-портал <${process.env.MAIL_USER}>`;
  const subject = "Пароль изменён";
  const text =
    "Пароль в Бизнес-портале был изменён. Если это были не вы, обратитесь к администратору.";
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
  if (Number.isNaN(d.getTime())) return "В«__В» __________ ____";
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

  const titleLine = "ЗАЯВЛЕНЕ";

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
    title: "нструктаж для грузчиков",
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
      title: "нструкция ОТ: кладовщик (склад)",
      description: "нструкция по охране труда для кладовщиков склада.",
      file: "/templates/нструкция_ОТ_Кладовщик_Склад.docx",
    note: "",
    },
    {
      title: "нструкция ОТ: грузчик (склад)",
      description: "нструкция по охране труда для грузчиков склада.",
      file: "/templates/нструкция_ОТ_Грузчик_Склад.docx",
    note: "",
    },
  ],
  journals: [
    {
      title: "Журнал регистрации вводного инструктажа",
      description: "Пустой журнал для фиксации вводного инструктажа (ФО, дата, подписи).",
      file: "/templates/Журнал_Вводный_нструктаж_ОТ.docx",
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


const PORTAL_NEWS_SEED = [
  {
    title: "Переезд на новый портал",
    body:
      "Мы обновили интерфейс и добавили раздел с новостями портала. Здесь будут важные обновления, регламенты и изменения в процессах.",
    tags: ["портал", "обновления"],
    published: true,
  },
  {
    title: "Единый регламент заявок",
    body:
      "С этого месяца заявки оформляются только через портал. Проверьте роли и права доступа, чтобы видеть нужные разделы.",
    tags: ["регламент", "заявки"],
    published: true,
  },
  {
    title: "Контакты поддержки",
    body:
      "Если вы столкнулись с ошибками или не видите нужный раздел, напишите в поддержку портала и укажите номер организации.",
    tags: ["поддержка"],
    published: true,
  },
];

const decodeEscapedUnicode = (value) => {
  if (typeof value !== "string") return value;
  if (!value.includes("\\u")) return value;
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
};

const normalizePortalNewsText = (value) =>
  decodeEscapedUnicode(String(value || "").trim());

const normalizePortalNewsTags = (value) => {
  if (!Array.isArray(value)) return value;
  return value
    .map((tag) => decodeEscapedUnicode(String(tag).trim()))
    .filter(Boolean);
};

app.get("/api/portal-news", auth, async (req, res) => {
  try {
    const roles = getRequestRoles(req);
    const isAdmin = roles.includes("ADMIN");
    let items = await prisma.portalNews.findMany({
      where: isAdmin ? {} : { published: true },
      orderBy: { createdAt: "desc" },
    });

    if (items.length === 0) {
      await prisma.portalNews.createMany({
        data: PORTAL_NEWS_SEED.map((item) => ({
          title: item.title,
          body: item.body,
          tags: item.tags,
          published: item.published,
        })),
      });
      items = await prisma.portalNews.findMany({
        where: isAdmin ? {} : { published: true },
        orderBy: { createdAt: "desc" },
      });
    }
    const normalized = items.map((item) => ({
      ...item,
      title: decodeEscapedUnicode(item.title),
      body: decodeEscapedUnicode(item.body),
      tags: normalizePortalNewsTags(item.tags),
    }));
    const updates = normalized
      .map((item, index) => {
        const original = items[index];
        if (
          item.title === original.title &&
          item.body === original.body &&
          JSON.stringify(item.tags ?? null) === JSON.stringify(original.tags ?? null)
        ) {
          return null;
        }
        return prisma.portalNews.update({
          where: { id: item.id },
          data: {
            title: item.title,
            body: item.body,
            tags: item.tags,
          },
        });
      })
      .filter(Boolean);

    if (updates.length) {
      await Promise.allSettled(updates);
    }
    res.json({ items: normalized });
  } catch (err) {
    console.error("portal news list error:", err);
    res.status(500).json({ items: [], message: "Failed to load portal news" });
  }
});

app.post("/api/portal-news", auth, requireAdmin, async (req, res) => {
  try {
    const title = normalizePortalNewsText(req.body?.title);
    const body = normalizePortalNewsText(req.body?.body);
    const published = req.body?.published !== false;
    const rawTags = req.body?.tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.map((t) => String(t).trim()).filter(Boolean)
      : typeof rawTags === "string"
      ? rawTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    const normalizedTags = normalizePortalNewsTags(tags);

    if (!title || !body) {
      return res.status(400).json({ message: "Title and body are required" });
    }

    const created = await prisma.portalNews.create({
      data: {
        title,
        body,
        tags: normalizedTags,
        published,
      },
    });
    res.status(201).json(created);
  } catch (err) {
    console.error("portal news create error:", err);
    res.status(500).json({ message: "Failed to create portal news" });
  }
});

app.put("/api/portal-news/:id", auth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const title = normalizePortalNewsText(req.body?.title);
    const body = normalizePortalNewsText(req.body?.body);
    const published = req.body?.published !== false;
    const rawTags = req.body?.tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.map((t) => String(t).trim()).filter(Boolean)
      : typeof rawTags === "string"
      ? rawTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    const normalizedTags = normalizePortalNewsTags(tags);

    if (!title || !body) {
      return res.status(400).json({ message: "Title and body are required" });
    }

    const updated = await prisma.portalNews.update({
      where: { id },
      data: {
        title,
        body,
        tags: normalizedTags,
        published,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error("portal news update error:", err);
    if (err?.code === "P2025") {
      return res.status(404).json({ message: "Portal news not found" });
    }
    res.status(500).json({ message: "Failed to update portal news" });
  }
});

app.delete("/api/portal-news/:id", auth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Invalid id" });
    }

    await prisma.portalNews.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("portal news delete error:", err);
    if (err?.code === "P2025") {
      return res.status(404).json({ message: "Portal news not found" });
    }
    res.status(500).json({ message: "Failed to delete portal news" });
  }
});


// ---------- Новости ----------

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
        name: "Зона приемки",
      },
    });
  }
  return location;
}


function buildReceiveActHtml(order, rows, orgInfo) {
  const safeOrg = {
    name: orgInfo?.orgName || orgInfo?.name || "Организация",
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
    ? `<tr><td>Тел.: ${safeOrg.phone}</td></tr>`
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
      <tr><td>НН ${safeOrg.inn}&nbsp;&nbsp;&nbsp;&nbsp;КПП ${safeOrg.kpp}</td></tr>
      ${phoneRow}
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
        <td colspan="2" style="text-align:right;font-weight:bold;">того:</td>
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
        <div class="small">должность / подпись / Ф..О.</div>
        <div class="small" style="margin-top:6px;">М.П.</div>
      </div>
      <div class="sign">
        <div>Представитель поставщика (экспедитор)</div>
        <div class="line"></div>
        <div class="small">должность / подпись / Ф..О.</div>
      </div>
    </div>

    <button class="print-btn" onclick="window.print()">Печать</button>
  </div>
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
  if (!force && diffDays > 3) return false; // начинаем за 3 дня

  if (!force && a.lastReminderAt) {
    const last = new Date(a.lastReminderAt);
    const hoursSince = (now - last) / (1000 * 60 * 60);
    if (hoursSince < 20) return false; // не чаще раза в сутки
  }

  const text = [
    `Напоминание по инструктажу: ${a.instruction?.title || "инструктаж"}`,
    `Сотрудник: ${a.employee.fullName}`,
    `Срок: ${due.toLocaleDateString("ru-RU")}`,
    diffDays >= 0 ? `Осталось дней: ${diffDays + 1}` : `Просрочено на ${Math.abs(diffDays)} дн.`,
    "",
    "После прохождения поставьте статус «Пройден».",
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

setInterval(sendSafetyReminders, 1000 * 60 * 60); // раз в час
sendSafetyReminders();

// обработка callback_query (кнопка "✅ Выполнено")
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
          text: "Задача не найдена",
          show_alert: true,
        }),
      });
      return;
    }

    // проверяем, что нажал именно исполнитель (если executorChatId задан)
    if (
      task.executorChatId &&
      String(task.executorChatId) !== String(from.id)
    ) {
      await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackId,
          text: "Эта задача назначена другому сотруднику.",
          show_alert: true,
        }),
      });
      return;
    }

    // обновляем статус задачи
    await prisma.warehouseTask.update({
      where: { id: taskId },
      data: {
        status: "DONE",
        lastReminderAt: null,
      },
    });

    // если задача создана по заявке на склад — авто-проведение заявки по складу
    try {
      // title вида: "Заявка на склад #19: ... "
      const match = task.title.match(/Заявка на склад #(\d+)/);
      if (match && task.assignerId) {
        const requestId = Number(match[1]);
        if (requestId) {
          await autoPostRequestToStock(requestId, task.assignerId);
        }
      }
    } catch (e) {
      console.error("[Telegram] autoPostRequestFromTask error:", e);
    }

    // ответим Телеграму, чтобы убрались "часики" на кнопке
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackId,
        text: "Задача отмечена как выполненная ✅",
        show_alert: false,
      }),
    });

    // исполнителю
    await sendTelegramMessage(
      from.id,
      `✅ Задача <b>${task.title}</b> отмечена как выполненная.`
    );

    // в группу
    await sendWarehouseGroupMessage(
      `✅ Задача склада <b>${task.title}</b> выполнена исполнителем.`
    );

    console.log(
      `[Telegram] Задача ${taskId} отмечена как выполненная пользователем ${from.id}`
    );
  } catch (err) {
    console.error("[handleTelegramUpdate] Ошибка:", err);
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

// ================== НАПОМНАНЯ ПО ЗАДАЧАМ СКЛАДА ==================

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

        const baseText =
          "⏰ <b>Скоро срок по задаче склада</b>\n\n" +
          `📝 <b>Задача:</b> ${task.title}\n` +
          (task.executorName
            ? `👷 <b>сполнитель:</b> ${task.executorName}\n`
            : "") +
          `⏰ <b>Срок:</b> ${dueStr}`;

        await sendWarehouseGroupMessage(baseText);

        if (task.executorChatId) {
          const execText =
            "⏰ <b>У вас скоро срок по задаче склада</b>\n\n" +
            `📝 <b>Задача:</b> ${task.title}\n` +
            `⏰ <b>Срок:</b> ${dueStr}`;
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

        const baseText =
          "⚠️ <b>Просрочена задача склада</b>\n\n" +
          `📝 <b>Задача:</b> ${task.title}\n` +
          (task.executorName
            ? `👷 <b>сполнитель:</b> ${task.executorName}\n`
            : "") +
          `⏰ <b>Срок был:</b> ${dueStr}`;

        await sendWarehouseGroupMessage(baseText);

        if (task.executorChatId) {
          const execText =
            "⚠️ <b>У вас просрочена задача склада</b>\n\n" +
            `📝 <b>Задача:</b> ${task.title}\n` +
            `⏰ <b>Срок был:</b> ${dueStr}`;
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

// ================== АУТЕНТФКАЦЯ ==================

// регистрация
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

// логин
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "email и пароль обязательны" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.isActive === false) {
      return res.status(403).json({ message: "USER_INACTIVE" });
    }
    if (!user) {
      return res
        .status(401)
        .json({ message: "Неверный email или пароль" });
    }

    const storedHash = user.passwordHash || user.password;
    const ok = await bcrypt.compare(password, storedHash);
    if (!ok) {
      return res
        .status(401)
        .json({ message: "Неверный email или пароль" });
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
    res.status(500).json({ message: "Ошибка сервера при входе" });
  }
});

// профиль текущего пользователя
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

// DEV: сделать текущего пользователя админом по email
app.post("/api/dev/make-me-admin", auth, async (req, res) => {
  try {
    const allowedEmail = "dvinskihsergej9@gmail.com";

    if (req.user.email.toLowerCase() !== allowedEmail.toLowerCase()) {
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


// ================== АДМНКА ПОЛЬЗОВАТЕЛЕЙ ==================

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
      .json({ message: "Ошибка сервера при загрузке пользователей" });
  }
});

app.put("/api/users/:id/role", auth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { role } = req.body;

    if (!["EMPLOYEE", "HR", "ACCOUNTING", "ADMIN"].includes(role)) {
      return res.status(400).json({ message: "Недопустимая роль" });
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
    res.status(500).json({ message: "Ошибка сервера при смене роли" });
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

    const from = process.env.MAIL_FROM || `Бизнес-портал <${process.env.MAIL_USER}>`;
    const subject = "Тестовое письмо Бизнес-портала";
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
// ================== СКЛАД: ЗАЯВК ==================

// создать заявку на склад

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
      return res.status(400).json({ message: "Заполните все поля, включая Telegram ID." });
    }

    const allowedStatuses = ["ACTIVE", "FIRED"];
    const normalizedStatus = allowedStatuses.includes(status)
      ? status
      : "ACTIVE";

    const hiredDate = parseDateInput(hiredAt);
    const birth = parseDateInput(birthDate);
    if (!hiredDate || !birth) {
      return res.status(400).json({ message: "Некорректные даты приема или рождения." });
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
      return res.status(400).json({ message: "Заполните все поля, включая Telegram ID." });
    }

    const hiredDate = parseDateInput(hiredAt);
    const birth = parseDateInput(birthDate);
    if (!hiredDate || !birth) {
      return res.status(400).json({ message: "Некорректные даты приема или рождения." });
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

    for (const it of items) {
      const q = Number(it.quantity);

      if (!Number.isFinite(q) || !Number.isInteger(q) || q <= 0) {
        return res.status(400).json({
          message: `Количество по позиции "${it.name || ""}" должно быть положительным целым числом`,
        });
      }

      preparedItems.push({
        name: it.name,
        quantity: q,
        unit: it.unit || null,
      });
    }

    // 2. Если это выдача (ISSUE) — проверяем остатки
    if (type === "ISSUE") {
      for (const it of preparedItems) {
        if (!it.name) continue;

        const invItem = await prisma.item.findFirst({
          where: { name: it.name },
        });

        // если товара нет в номенклатуре — пропускаем проверку
        if (!invItem) continue;

        const currentStock = await getCurrentStockForItem(invItem.id);
        const current = currentStock ?? 0;

        if (current < it.quantity) {
          return res.status(400).json({
            message: `Недостаточно остатка по товару "${it.name}". На складе ${current} ${invItem.unit || "шт."}, в заявке указано ${it.quantity}.`,
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
          create: preparedItems,
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

// все заявки (ADMIN/ACCOUNTING)
app.get("/api/warehouse/requests", auth, async (req, res) => {
  try {
    if (req.user.role !== "ADMIN" && req.user.role !== "ACCOUNTING") {
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

    // щем товар в номенклатуре по точному имени
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
        const stockInfo = await calculateStockAfterMovement(
          invItem.id,
          "ISSUE",
          q
        );

        if (stockInfo.newStock < 0) {
          console.warn(
            `[Warehouse] Недостаточно остатка по "${item.name}" при авто-списании по заявке #${id} (есть ${stockInfo.current}, нужно ${q})`
          );
          continue;
        }
      } catch (e) {
        console.error(
          `[Warehouse] Ошибка расчёта остатка по "${item.name}" при авто-проведении заявки #${id}:`,
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

    if (req.user.role !== "ADMIN" && req.user.role !== "ACCOUNTING") {
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

// ================== СКЛАД: ЗАДАЧ ==================

// Вспомогательная функция: создать задачу склада по заявке
async function createWarehouseTaskFromRequest(request, assignerId) {
  try {
    // Собираем описание задачи из комментария и позиций заявки
    const lines = [];

    if (request.comment) {
      lines.push(`Комментарий: ${request.comment}`);
    }

    if (request.items && request.items.length) {
      if (lines.length) lines.push("");
      lines.push("Позиции:");

      for (const it of request.items) {
        lines.push(
          `- ${it.name} вЂ” ${it.quantity} ${it.unit || ""}`.trim()
        );
      }
    }

    const description = lines.join("\n");

    const task = await prisma.warehouseTask.create({
      data: {
        title: `Заявка на склад #${request.id}: ${request.title}`,
        description,
        // пока срок не задаём, его можно потом руками выставить в задачах
        dueDate: null,
        executorName: "Склад",
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
      `[Warehouse] Создана задача ${task.id} по заявке ${request.id}`
    );

    // Сообщение в складской Telegram-чат
    const parts = [];

    parts.push("📦 <b>Новая задача склада по заявке</b>");
    parts.push("");
    parts.push(`📝 <b>Задача:</b> ${task.title}`);

    if (task.description) {
      parts.push("");
      parts.push(`<b>Детали:</b>\n${task.description}`);
    }

    if (task.assigner) {
      parts.push("");
      parts.push(
        `👤 <b>Автор заявки:</b> ${task.assigner.name || "Неизвестно"} (${task.assigner.email || ""})`
      );
    }

    const text = parts.join("\n");

    await sendWarehouseGroupMessage(text);

    return task;
  } catch (err) {
    console.error("[createWarehouseTaskFromRequest] Ошибка:", err);
  }
}

// создать задачу склада
app.post("/api/warehouse/tasks", auth, async (req, res) => {
  try {
    const { title, description, dueDate, executorName, executorChatId } =
      req.body;

    if (!title) {
      return res
        .status(400)
        .json({ message: "Описание задачи обязательно" });
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

    // Сообщение в группу
    const parts = [];

    parts.push("📦 <b>Новая задача склада</b>");
    parts.push("");
    parts.push(`📝 <b>Задача:</b> ${task.title}`);

    if (task.description) {
      parts.push(`📄 <b>Детали:</b> ${task.description}`);
    }

    if (task.executorName) {
      parts.push(`👷 <b>сполнитель:</b> ${task.executorName}`);
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
        parts.push(`⏰ <b>Срок:</b> ${dueStr}`);
      }
    }

    if (task.assigner) {
      parts.push("");
      parts.push(
        `👤 <b>Назначил:</b> ${task.assigner.name || "Неизвестно"} (${task.assigner.email || ""
        })`
      );
    }

    const groupText = parts.join("\n");

    sendWarehouseGroupMessage(groupText).catch((err) =>
      console.error("Ошибка отправки в Telegram (группа):", err)
    );

    // Личное сообщение исполнителю
    if (task.executorChatId) {
      const execParts = [];

      execParts.push("👋 <b>Вам назначена задача склада</b>");
      execParts.push("");
      execParts.push(`📝 <b>Задача:</b> ${task.title}`);

      if (task.description) {
        execParts.push(`📄 <b>Детали:</b> ${task.description}`);
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
          execParts.push(`⏰ <b>Срок:</b> ${dueStr}`);
        }
      }

      if (task.assigner) {
        execParts.push("");
        execParts.push(
          `👤 <b>Назначил:</b> ${task.assigner.name || "Неизвестно"} (${task.assigner.email || ""
          })`
        );
      }

      const execText = execParts.join("\n");

      sendTelegramMessage(task.executorChatId, execText, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ Выполнено",
                callback_data: `done:${task.id}`,
              },
            ],
          ],
        },
      }).catch((err) =>
        console.error("Ошибка отправки в Telegram (исполнитель):", err)
      );
    }

    res.status(201).json(task);
  } catch (err) {
    console.error("Warehouse task create error:", err);
    res
      .status(500)
      .json({ message: "Ошибка сервера при создании задачи склада" });
  }
});

// мои задачи (назначенные мной)
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

// все задачи склада (ADMIN/ACCOUNTING)
app.get("/api/warehouse/tasks", auth, async (req, res) => {
  try {
    if (req.user.role !== "ADMIN" && req.user.role !== "ACCOUNTING") {
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

    if (req.user.role !== "ADMIN" && req.user.role !== "ACCOUNTING") {
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

// ================== СКЛАД: НОМЕНКЛАТУРА  ОСТАТК ==================

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

// ===== СКЛАД: ЛОКАЦ =====
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

// ===== КОДЫ: ЛОКАЦ =====
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

// ===== QR: ЛОКАЦ =====
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
      title = `ЛОКАЦЯ: ${location.name}`;
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

// ===== РАЗМЕЩЕНЯ =====
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

// ===== ПЕЧАТЬ ЭТКЕТОК =====
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
      .json({ message: "Ошибка сервера при расчёте остатков" });
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

// Готовый заказ по товарам ниже минимального остатка (Excel .xlsx)
app.get("/api/inventory/low-stock-order-file", auth, async (req, res) => {
  try {
    // 1. Берём все товары с движениями
    const items = await prisma.item.findMany({
      orderBy: { name: "asc" },
      include: { movements: true },
    });

    const lowItems = [];

    for (const item of items) {
      // считаем текущий остаток так же, как в /api/inventory/stock
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
        index + 1,          // A: в„–
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

    totalRow.getCell(5).value = "ТОГО:";
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

    // тоговая строка (границы для суммы)
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

// мпорт товаров из Excel (шаблон "мпорт.xlsx")
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

      // Предполагаем структуру файла "мпорт.xlsx":
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
          // щем по SKU (он у тебя уникальный)
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
            "Ошибка при импорте строки",
            rowNumber,
            err
          );
          skipped++;
        }
      }

      return res.json({
        message: "мпорт завершён",
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

    // Для ПРХОДА нужна цена за единицу
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

    // ===== ПРОВЕРКА ОСТАТКА ПЕРЕД СОЗДАНЕМ ДВЖЕНЯ =====
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
    // ===== КОНЕЦ ПРОВЕРК ОСТАТКА =====

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

// ================== ПОСТАВЩК ==================

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

// ================== ЗАКАЗЫ ПОСТАВЩКУ ==================

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
      "в„–",
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

    // тог
    const totalRowIndex = lastDataRow + 1;
    const totalRow = worksheet.getRow(totalRowIndex);
    totalRow.getCell(5).value = "ТОГО:";
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

    // тоговая строка
    const totalRowIndex = lastDataRow + 1;
    const totalRow = worksheet.getRow(totalRowIndex);

    totalRow.getCell(5).value = "того:";
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

// ================== ОЧЕРЕДЬ МАШН ПОСТАВЩКОВ ==================

// список машин в очереди (с фильтрами)
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

// ================== ПЕРОДЧЕСКЕ ЗАДАЧ ==================

// дата, за которую уже отправлен ежедневный отчёт по остаткам (формат "YYYY-MM-DD")
let lastLowStockReportDate = null;

// проверка каждые 60 секунд
setInterval(() => {
  // 1) напоминания по задачам склада
  checkWarehouseTaskNotifications().catch((err) =>
    console.error("Ошибка в checkWarehouseTaskNotifications:", err)
  );

  // 2) раз в день в 18:00 отправляем отчёт по минимальным остаткам
  const now = new Date();
  const hours = now.getHours(); // 0..23
  const minutes = now.getMinutes(); // 0..59
  const todayKey = now.toISOString().slice(0, 10); // "YYYY-MM-DD"

  if (hours === 18 && minutes === 0 && lastLowStockReportDate !== todayKey) {
    lastLowStockReportDate = todayKey;

    sendDailyLowStockSummary().catch((err) =>
      console.error("Ошибка в sendDailyLowStockSummary:", err)
    );
  }
}, 60 * 1000);

// запуск long polling Telegram (один экземпляр)
startTelegramPolling().catch((err) =>
  console.error("Ошибка при запуске startTelegramPolling:", err)
);

// ================== ЗАПУСК СЕРВЕРА ==================

initMailer().catch((err) => console.error("[MAIL] init error:", err));

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 API запущен: http://localhost:${PORT}`);
});





