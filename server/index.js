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
import { adminRoutes } from "./adminRoutes.js";
import { createWarehouseStockService } from "./services/warehouseStockService.js";

// ================== Р В Р’ВР В РЎСљР В Р’ВР В Р’В¦Р В Р’ВР В РЎвЂ™Р В РІР‚С”Р В Р’ВР В РІР‚вЂќР В РЎвЂ™Р В Р’В¦Р В Р’ВР В Р вЂЎ ==================

const app = express();
const prisma = new PrismaClient();
const stockService = createWarehouseStockService(prisma);

// Р В РўвЂР В Р’В»Р РЋР РЏ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР В РЎвЂ Р РЋРІР‚С›Р В Р’В°Р В РІвЂћвЂ“Р В Р’В»Р В РЎвЂўР В Р вЂ  Р В Р вЂ  Р В РЎвЂ”Р В Р’В°Р В РЎВР РЋР РЏР РЋРІР‚С™Р РЋР Р‰ (Р В Р’В±Р РЋРЎвЂњР В РўвЂР В Р’ВµР В РЎВ Р РЋРІР‚РЋР В РЎвЂР РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Excel Р В РЎвЂР В Р’В· Р В Р’В±Р РЋРЎвЂњР РЋРІР‚С›Р В Р’ВµР РЋР вЂљР В Р’В°)
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// ================== JWT / Р В РЎвЂ™Р В РІР‚в„ўР В РЎС›Р В РЎвЂєР В Р’В Р В Р’ВР В РІР‚вЂќР В РЎвЂ™Р В Р’В¦Р В Р’ВР В Р вЂЎ ==================

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key"; // Р В Р вЂ  .env Р В Р вЂ  Р В Р’В±Р В РЎвЂўР РЋР вЂ№
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
    return res.status(401).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р РЋРІР‚С™Р В РЎвЂўР В РЎвЂќР В Р’ВµР В Р вЂ¦Р В Р’В° Р В Р’В°Р В Р вЂ Р РЋРІР‚С™Р В РЎвЂўР РЋР вЂљР В РЎвЂР В Р’В·Р В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ" });
  }

  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token) {
    return res.status(401).json({ message: "Р В РЎСљР В Р’ВµР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р РЋРІР‚С›Р В РЎвЂўР РЋР вЂљР В РЎВР В Р’В°Р РЋРІР‚С™ Р РЋРІР‚С™Р В РЎвЂўР В РЎвЂќР В Р’ВµР В Р вЂ¦Р В Р’В°" });
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
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };
    next();
  } catch (err) {
    console.error("auth error:", err);
    return res.status(401).json({ message: "Р В РЎСљР В Р’ВµР В РўвЂР В Р’ВµР В РІвЂћвЂ“Р РЋР С“Р РЋРІР‚С™Р В Р вЂ Р В РЎвЂР РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р РЋРІР‚С™Р В РЎвЂўР В РЎвЂќР В Р’ВµР В Р вЂ¦" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ message: "Р В РЎСљР РЋРЎвЂњР В Р’В¶Р В Р вЂ¦Р РЋРІР‚в„– Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ Р В Р’В° Р В Р’В°Р В РўвЂР В РЎВР В РЎвЂР В Р вЂ¦Р В РЎвЂР РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В Р’В°Р РЋРІР‚С™Р В РЎвЂўР РЋР вЂљР В Р’В°" });
  }
  next();
}

function requireHr(req, res, next) {
  if (!["EMPLOYEE", "HR", "ADMIN"].includes(req.user?.role)) {
    return res
      .status(403)
      .json({ message: "HR or admin role required" });
  }
  next();
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

  const from = process.env.MAIL_FROM || `Business Portal <${process.env.MAIL_USER}>`;
  const subject = "\u041f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435 \u0432 Business Portal";
  const text = `\u0412\u044b \u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u044b \u0432 Business Portal. \u041f\u0435\u0440\u0435\u0439\u0434\u0438\u0442\u0435 \u043f\u043e \u0441\u0441\u044b\u043b\u043a\u0435 \u0434\u043b\u044f \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0438\u044f \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u0438: ${link}`;
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;">
      <p>\u0412\u044b \u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u044b \u0432 Business Portal.</p>
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

  const from = process.env.MAIL_FROM || `Business Portal <${process.env.MAIL_USER}>`;
  const subject = "Р В Р Р‹Р В Р’В±Р РЋР вЂљР В РЎвЂўР РЋР С“ Р В РЎвЂ”Р В Р’В°Р РЋР вЂљР В РЎвЂўР В Р’В»Р РЋР РЏ Р В Р вЂ  Business Portal";
  const text = `Р В РІР‚СњР В Р’В»Р РЋР РЏ Р РЋР С“Р В Р’В±Р РЋР вЂљР В РЎвЂўР РЋР С“Р В Р’В° Р В РЎвЂ”Р В Р’В°Р РЋР вЂљР В РЎвЂўР В Р’В»Р РЋР РЏ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В РІвЂћвЂ“Р В РўвЂР В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р В РЎвЂ”Р В РЎвЂў Р РЋР С“Р РЋР С“Р РЋРІР‚в„–Р В Р’В»Р В РЎвЂќР В Р’Вµ: ${link}`;
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;">
      <p>Р В РІР‚СњР В Р’В»Р РЋР РЏ Р РЋР С“Р В Р’В±Р РЋР вЂљР В РЎвЂўР РЋР С“Р В Р’В° Р В РЎвЂ”Р В Р’В°Р РЋР вЂљР В РЎвЂўР В Р’В»Р РЋР РЏ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В РІвЂћвЂ“Р В РўвЂР В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р В РЎвЂ”Р В РЎвЂў Р РЋР С“Р РЋР С“Р РЋРІР‚в„–Р В Р’В»Р В РЎвЂќР В Р’Вµ:</p>
      <p><a href="${link}">${link}</a></p>
      <p>Р В РІР‚СћР РЋР С“Р В Р’В»Р В РЎвЂ Р В Р вЂ Р РЋРІР‚в„– Р В Р вЂ¦Р В Р’Вµ Р В Р’В·Р В Р’В°Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р РЋРІвЂљВ¬Р В РЎвЂР В Р вЂ Р В Р’В°Р В Р’В»Р В РЎвЂ Р РЋР С“Р В Р’В±Р РЋР вЂљР В РЎвЂўР РЋР С“, Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В РЎвЂў Р В РЎвЂР В РЎвЂ“Р В Р вЂ¦Р В РЎвЂўР РЋР вЂљР В РЎвЂР РЋР вЂљР РЋРЎвЂњР В РІвЂћвЂ“Р РЋРІР‚С™Р В Р’Вµ Р РЋР РЉР РЋРІР‚С™Р В РЎвЂў Р В РЎвЂ”Р В РЎвЂР РЋР С“Р РЋР Р‰Р В РЎВР В РЎвЂў.</p>
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

  const from = process.env.MAIL_FROM || `Business Portal <${process.env.MAIL_USER}>`;
  const subject = "Р В РЎСџР В Р’В°Р РЋР вЂљР В РЎвЂўР В Р’В»Р РЋР Р‰ Р В РЎвЂР В Р’В·Р В РЎВР В Р’ВµР В Р вЂ¦Р РЋРІР‚ВР В Р вЂ¦";
  const text = "Р В РЎСџР В Р’В°Р РЋР вЂљР В РЎвЂўР В Р’В»Р РЋР Р‰ Р В Р вЂ  Business Portal Р В Р’В±Р РЋРІР‚в„–Р В Р’В» Р В РЎвЂР В Р’В·Р В РЎВР В Р’ВµР В Р вЂ¦Р РЋРІР‚ВР В Р вЂ¦. Р В РІР‚СћР РЋР С“Р В Р’В»Р В РЎвЂ Р РЋР РЉР РЋРІР‚С™Р В РЎвЂў Р В Р’В±Р РЋРІР‚в„–Р В Р’В»Р В РЎвЂ Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ Р РЋРІР‚в„–, Р РЋР С“Р В Р вЂ Р РЋР РЏР В Р’В¶Р В РЎвЂР РЋРІР‚С™Р В Р’ВµР РЋР С“Р РЋР Р‰ Р РЋР С“ Р В Р’В°Р В РўвЂР В РЎВР В РЎвЂР В Р вЂ¦Р В РЎвЂР РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В Р’В°Р РЋРІР‚С™Р В РЎвЂўР РЋР вЂљР В РЎвЂўР В РЎВ.";
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


const APP_URL = process.env.APP_URL || FRONTEND_URL;
const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

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
      name: true,
      role: true,
      createdAt: true,
    },
  });

  if (!user) return null;

  const subscription = await prisma.subscription.findFirst({ where: { userId } });
  const now = new Date();
  const isActive =
    subscription &&
    ["active", "trialing"].includes(subscription.status) &&
    subscription.paidUntil &&
    new Date(subscription.paidUntil) > now;

  return {
    ...user,
    roles: [user.role],
    subscription: subscription
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


app.use("/api/admin", adminRoutes({ prisma, auth, requireAdmin }));

function calcAccruedLeaveDays(hiredAt) {
  if (!hiredAt) return 0;
  const start = new Date(hiredAt);
  if (Number.isNaN(start.getTime())) return 0;

  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  // 28 Р В РўвЂР В Р вЂ¦Р В Р’ВµР В РІвЂћвЂ“ Р В Р вЂ  Р В РЎвЂ“Р В РЎвЂўР В РўвЂ Р Р†РІР‚В°РІвЂљВ¬ 2.33 Р В РўвЂР В Р вЂ¦Р РЋР РЏ Р В Р вЂ  Р В РЎВР В Р’ВµР РЋР С“Р РЋР РЏР РЋРІР‚В 
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
  return `Р вЂ™Р’В«${dd}Р вЂ™Р’В» ${mm} ${yyyy} Р В РЎвЂ“.`;
}

function formatDateLong(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "Р вЂ™Р’В«__Р вЂ™Р’В» __________ ____";
  const dd = String(d.getDate()).padStart(2, "0");
  const monthNames = [
    "Р РЋР РЏР В Р вЂ¦Р В Р вЂ Р В Р’В°Р РЋР вЂљР РЋР РЏ",
    "Р РЋРІР‚С›Р В Р’ВµР В Р вЂ Р РЋР вЂљР В Р’В°Р В Р’В»Р РЋР РЏ",
    "Р В РЎВР В Р’В°Р РЋР вЂљР РЋРІР‚С™Р В Р’В°",
    "Р В Р’В°Р В РЎвЂ”Р РЋР вЂљР В Р’ВµР В Р’В»Р РЋР РЏ",
    "Р В РЎВР В Р’В°Р РЋР РЏ",
    "Р В РЎвЂР РЋР вЂ№Р В Р вЂ¦Р РЋР РЏ",
    "Р В РЎвЂР РЋР вЂ№Р В Р’В»Р РЋР РЏ",
    "Р В Р’В°Р В Р вЂ Р В РЎвЂ“Р РЋРЎвЂњР РЋР С“Р РЋРІР‚С™Р В Р’В°",
    "Р РЋР С“Р В Р’ВµР В Р вЂ¦Р РЋРІР‚С™Р РЋР РЏР В Р’В±Р РЋР вЂљР РЋР РЏ",
    "Р В РЎвЂўР В РЎвЂќР РЋРІР‚С™Р РЋР РЏР В Р’В±Р РЋР вЂљР РЋР РЏ",
    "Р В Р вЂ¦Р В РЎвЂўР РЋР РЏР В Р’В±Р РЋР вЂљР РЋР РЏ",
    "Р В РўвЂР В Р’ВµР В РЎвЂќР В Р’В°Р В Р’В±Р РЋР вЂљР РЋР РЏ",
  ];
  const month = monthNames[d.getMonth()] || "";
  const yyyy = d.getFullYear();
  return `Р вЂ™Р’В«${dd}Р вЂ™Р’В» ${month} ${yyyy} Р В РЎвЂ“Р В РЎвЂўР В РўвЂР В Р’В°`;
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

  const titleLine = "Р В РІР‚вЂќР В РЎвЂ™Р В Р вЂЎР В РІР‚в„ўР В РІР‚С”Р В РІР‚СћР В РЎСљР В Р’ВР В РІР‚Сћ";

  const body = isTermination
    ? `Р В РЎСџР РЋР вЂљР В РЎвЂўР РЋРІвЂљВ¬Р РЋРЎвЂњ Р РЋРЎвЂњР В Р вЂ Р В РЎвЂўР В Р’В»Р В РЎвЂР РЋРІР‚С™Р РЋР Р‰ Р В РЎВР В Р’ВµР В Р вЂ¦Р РЋР РЏ Р В РЎвЂ”Р В РЎвЂў Р РЋР С“Р В РЎвЂўР В Р’В±Р РЋР С“Р РЋРІР‚С™Р В Р вЂ Р В Р’ВµР В Р вЂ¦Р В Р вЂ¦Р В РЎвЂўР В РЎВР РЋРЎвЂњ Р В Р’В¶Р В Р’ВµР В Р’В»Р В Р’В°Р В Р вЂ¦Р В РЎвЂР РЋР вЂ№ ${fromLong}. Р В РЎСџР РЋР вЂљР В РЎвЂўР РЋРІвЂљВ¬Р РЋРЎвЂњ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В РЎвЂР В Р’В·Р В Р вЂ Р В Р’ВµР РЋР С“Р РЋРІР‚С™Р В РЎвЂ Р В РЎвЂўР В РЎвЂќР В РЎвЂўР В Р вЂ¦Р РЋРІР‚РЋР В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р РЋР вЂљР В Р’В°Р РЋР С“Р РЋРІР‚РЋР В Р’ВµР РЋРІР‚С™, Р В Р вЂ Р РЋРІР‚в„–Р В РўвЂР В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РўвЂР В РЎвЂўР В Р вЂ Р РЋРЎвЂњР РЋР вЂ№ Р В РЎвЂќР В Р вЂ¦Р В РЎвЂР В Р’В¶Р В РЎвЂќР РЋРЎвЂњ (Р В РЎвЂР В Р’В»Р В РЎвЂ Р РЋР С“Р В Р вЂ Р В Р’ВµР В РўвЂР В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ Р В РЎвЂў Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РўвЂР В РЎвЂўР В Р вЂ Р В РЎвЂўР В РІвЂћвЂ“ Р В РўвЂР В Р’ВµР РЋР РЏР РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В РЎвЂ) Р В РЎвЂ Р РЋР С“Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ Р В РЎвЂќР В РЎвЂ Р РЋРЎвЂњР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ¦Р В РЎвЂўР В Р вЂ Р В Р’В»Р В Р’ВµР В Р вЂ¦Р В Р вЂ¦Р В РЎвЂўР В РІвЂћвЂ“ Р РЋРІР‚С›Р В РЎвЂўР РЋР вЂљР В РЎВР РЋРІР‚в„– Р В Р вЂ  Р В РўвЂР В Р’ВµР В Р вЂ¦Р РЋР Р‰ Р РЋРЎвЂњР В Р вЂ Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ.`
    : isUnpaid
      ? `Р В РІР‚в„ў Р РЋР С“Р В РЎвЂўР В РЎвЂўР РЋРІР‚С™Р В Р вЂ Р В Р’ВµР РЋРІР‚С™Р РЋР С“Р РЋРІР‚С™Р В Р вЂ Р В РЎвЂР В РЎвЂ Р РЋР С“Р В РЎвЂў Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰Р В Р’ВµР В РІвЂћвЂ“ 128 Р В РЎС›Р РЋР вЂљР РЋРЎвЂњР В РўвЂР В РЎвЂўР В Р вЂ Р В РЎвЂўР В РЎвЂ“Р В РЎвЂў Р В РЎвЂќР В РЎвЂўР В РўвЂР В Р’ВµР В РЎвЂќР РЋР С“Р В Р’В° Р В Р’В Р В Р’В¤ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР РЋРІвЂљВ¬Р РЋРЎвЂњ Р В РЎвЂ”Р РЋР вЂљР В Р’ВµР В РўвЂР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р В РЎвЂР РЋРІР‚С™Р РЋР Р‰ Р В РЎВР В Р вЂ¦Р В Р’Вµ Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќ Р В Р’В±Р В Р’ВµР В Р’В· Р РЋР С“Р В РЎвЂўР РЋРІР‚В¦Р РЋР вЂљР В Р’В°Р В Р вЂ¦Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ Р В Р’В·Р В Р’В°Р РЋР вЂљР В Р’В°Р В Р’В±Р В РЎвЂўР РЋРІР‚С™Р В Р вЂ¦Р В РЎвЂўР В РІвЂћвЂ“ Р В РЎвЂ”Р В Р’В»Р В Р’В°Р РЋРІР‚С™Р РЋРІР‚в„– Р РЋР С“ ${fromLong} Р В РЎвЂ”Р В РЎвЂў ${toLong} Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В РўвЂР В РЎвЂўР В Р’В»Р В Р’В¶Р В РЎвЂР РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р РЋР Р‰Р РЋР вЂ№ ${application.days} Р В РЎвЂќР В Р’В°Р В Р’В»Р В Р’ВµР В Р вЂ¦Р В РўвЂР В Р’В°Р РЋР вЂљР В Р вЂ¦Р РЋРІР‚в„–Р РЋРІР‚В¦ Р В РўвЂР В Р вЂ¦Р В Р’ВµР В РІвЂћвЂ“.`
      : `Р В РІР‚в„ў Р РЋР С“Р В РЎвЂўР В РЎвЂўР РЋРІР‚С™Р В Р вЂ Р В Р’ВµР РЋРІР‚С™Р РЋР С“Р РЋРІР‚С™Р В Р вЂ Р В РЎвЂР В РЎвЂ Р РЋР С“Р В РЎвЂў Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰Р В Р’ВµР В РІвЂћвЂ“ 115 Р В РЎС›Р РЋР вЂљР РЋРЎвЂњР В РўвЂР В РЎвЂўР В Р вЂ Р В РЎвЂўР В РЎвЂ“Р В РЎвЂў Р В РЎвЂќР В РЎвЂўР В РўвЂР В Р’ВµР В РЎвЂќР РЋР С“Р В Р’В° Р В Р’В Р В Р’В¤ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР РЋРІвЂљВ¬Р РЋРЎвЂњ Р В РЎвЂ”Р РЋР вЂљР В Р’ВµР В РўвЂР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р В РЎвЂР РЋРІР‚С™Р РЋР Р‰ Р В РЎВР В Р вЂ¦Р В Р’Вµ Р В Р’ВµР В Р’В¶Р В Р’ВµР В РЎвЂ“Р В РЎвЂўР В РўвЂР В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р В РЎвЂўР В РЎвЂ”Р В Р’В»Р В Р’В°Р РЋРІР‚РЋР В РЎвЂР В Р вЂ Р В Р’В°Р В Р’ВµР В РЎВР РЋРІР‚в„–Р В РІвЂћвЂ“ Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќ Р РЋР С“ ${fromLong} Р В РЎвЂ”Р В РЎвЂў ${toLong} Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В РўвЂР В РЎвЂўР В Р’В»Р В Р’В¶Р В РЎвЂР РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р РЋР Р‰Р РЋР вЂ№ ${application.days} Р В РЎвЂќР В Р’В°Р В Р’В»Р В Р’ВµР В Р вЂ¦Р В РўвЂР В Р’В°Р РЋР вЂљР В Р вЂ¦Р РЋРІР‚в„–Р РЋРІР‚В¦ Р В РўвЂР В Р вЂ¦Р В Р’ВµР В РІвЂћвЂ“.`;

  const reasonLine = application.reason
    ? `<div class="doc-reason">Р В РЎвЂєР РЋР С“Р В Р вЂ¦Р В РЎвЂўР В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’Вµ / Р В РЎвЂќР В РЎвЂўР В РЎВР В РЎВР В Р’ВµР В Р вЂ¦Р РЋРІР‚С™Р В Р’В°Р РЋР вЂљР В РЎвЂР В РІвЂћвЂ“: ${application.reason}</div>`
    : "";

  const noteSpan = isUnpaid
    ? ""
    : isTermination
      ? ""
      : `<span class="doc-note">(Р В РЎвЂ”Р В РЎвЂўР В РўвЂР В Р’В°Р В Р’ВµР РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р В Р’В·Р В Р’В° 14 Р В РЎвЂќР В Р’В°Р В Р’В»Р В Р’ВµР В Р вЂ¦Р В РўвЂР В Р’В°Р РЋР вЂљР В Р вЂ¦Р РЋРІР‚в„–Р РЋРІР‚В¦ Р В РўвЂР В Р вЂ¦Р В Р’ВµР В РІвЂћвЂ“ Р В РўвЂР В РЎвЂў Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р вЂ Р В РЎвЂўР В РЎвЂ“Р В РЎвЂў Р В РўвЂР В Р вЂ¦Р РЋР РЏ Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќР В Р’В°)</span>`;

  return `
<div class="doc-header">
  <div>Р В РЎв„ўР В РЎвЂєР В РЎС™Р В Р в‚¬: ________________________________________________</div>
  <div>_____________________________________________________</div>
  <div style="margin-top: 8px;">Р В РЎвЂєР В РЎС› Р В РЎв„ўР В РЎвЂєР В РІР‚СљР В РЎвЂє: ${employee.fullName}</div>
  <div>Р В РІР‚СњР В РЎвЂўР В Р’В»Р В Р’В¶Р В Р вЂ¦Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р РЋР Р‰: ${employee.position || ""}${employee.position ? ", " : ""}${employee.department || ""}</div>
</div>

<div class="doc-title">${titleLine}</div>

<div class="doc-body">${body}</div>
${reasonLine}

<div class="doc-meta">Р В РІР‚СњР В Р’В°Р РЋРІР‚С™Р В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР В Р’ВµР В РЎВР В Р’В°: ${hired} &nbsp;&nbsp; Р В РІР‚СњР В Р’В°Р РЋРІР‚С™Р В Р’В° Р РЋР вЂљР В РЎвЂўР В Р’В¶Р В РўвЂР В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ: ${birth}</div>

<div class="doc-date">Р В РІР‚СњР В Р’В°Р РЋРІР‚С™Р В Р’В° Р В Р’В·Р В Р’В°Р РЋР РЏР В Р вЂ Р В Р’В»Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ: Р вЂ™Р’В«____Р вЂ™Р’В» __________ 20____ Р В РЎвЂ“Р В РЎвЂўР В РўвЂР В Р’В° ${noteSpan}</div>
<div class="doc-sign">Р В РЎСџР В РЎвЂўР В РўвЂР В РЎвЂ”Р В РЎвЂР РЋР С“Р РЋР Р‰ ________________</div>

<div class="doc-meta" style="margin-top: 8px;">Р В Р’В¤Р В Р’В°Р В РЎвЂќР РЋРІР‚С™Р В РЎвЂР РЋРІР‚РЋР В Р’ВµР РЋР С“Р В РЎвЂќР В РЎвЂ: ${today}</div>
`.trim();
}


const DEFAULT_SAFETY_INSTRUCTIONS = [
  {
    title: "Р В РІР‚в„ўР В Р вЂ Р В РЎвЂўР В РўвЂР В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р В РЎвЂР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р В Р’В°Р В Р’В¶ Р В РўвЂР В Р’В»Р РЋР РЏ Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР В Р’В°",
    description:
      "Р В РЎвЂєР В Р’В±Р РЋРІР‚В°Р В РЎвЂР В Р’Вµ Р РЋРІР‚С™Р РЋР вЂљР В Р’ВµР В Р’В±Р В РЎвЂўР В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР РЋР РЏ Р В РЎвЂ”Р В РЎвЂў Р РЋРІР‚С™Р В Р’ВµР РЋРІР‚В¦Р В Р вЂ¦Р В РЎвЂР В РЎвЂќР В Р’Вµ Р В Р’В±Р В Р’ВµР В Р’В·Р В РЎвЂўР В РЎвЂ”Р В Р’В°Р РЋР С“Р В Р вЂ¦Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В РЎвЂ Р В Р вЂ¦Р В Р’В° Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР В Р’Вµ, Р РЋР вЂљР В Р’В°Р В Р’В±Р В РЎвЂўР РЋРІР‚С™Р В Р’В° Р РЋР С“ Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р В Р’ВµР В Р’В¶Р В РЎвЂќР В Р’В°Р В РЎВР В РЎвЂ/Р В РЎвЂ”Р В РЎвЂўР В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р РЋРІР‚РЋР В РЎвЂР В РЎвЂќР В Р’В°Р В РЎВР В РЎвЂ, Р В Р’В·Р В РЎвЂўР В Р вЂ¦Р РЋРІР‚в„– Р В РЎвЂ Р В РЎВР В Р’В°Р РЋР вЂљР РЋРІвЂљВ¬Р РЋР вЂљР РЋРЎвЂњР РЋРІР‚С™Р РЋРІР‚в„– Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В РўвЂР В Р вЂ Р В РЎвЂР В Р’В¶Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ.",
    role: "WAREHOUSE",
  },
  {
    title: "Р В Р’ВР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р В Р’В°Р В Р’В¶ Р В РўвЂР В Р’В»Р РЋР РЏ Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р РЋРІР‚РЋР В РЎвЂР В РЎвЂќР В РЎвЂўР В Р вЂ ",
    description:
      "Р В РІР‚ВР В Р’ВµР В Р’В·Р В РЎвЂўР В РЎвЂ”Р В Р’В°Р РЋР С“Р В Р вЂ¦Р В РЎвЂўР В Р’Вµ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В РЎВР В Р’ВµР РЋРІР‚В°Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В РЎвЂ Р РЋРІвЂљВ¬Р РЋРІР‚С™Р В Р’В°Р В Р’В±Р В Р’ВµР В Р’В»Р В РЎвЂР РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂўР В Р вЂ , Р РЋРІР‚С›Р В РЎвЂР В РЎвЂќР РЋР С“Р В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ Р В РЎвЂ”Р В Р’В°Р В Р’В»Р В Р’В»Р В Р’ВµР РЋРІР‚С™, Р РЋР вЂљР В Р’В°Р В Р’В±Р В РЎвЂўР РЋРІР‚С™Р В Р’В° Р РЋР С“ Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂ”Р В Р’В°Р В РЎВР В РЎвЂ Р В РЎвЂ Р В Р’В·Р В Р’В°Р РЋРІР‚В¦Р В Р вЂ Р В Р’В°Р РЋРІР‚С™Р В Р’В°Р В РЎВР В РЎвЂ, Р В РЎвЂўР РЋРІР‚С™Р В РўвЂР РЋРІР‚в„–Р РЋРІР‚В¦ Р В РўвЂР В Р’В»Р РЋР РЏ Р РЋР С“Р В РЎвЂ”Р В РЎвЂР В Р вЂ¦Р РЋРІР‚в„–.",
    role: "LOADER",
  },
  {
    title: "Р В РЎСџР В РЎвЂўР В Р вЂ Р РЋРІР‚С™Р В РЎвЂўР РЋР вЂљР В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р В РЎвЂР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р В Р’В°Р В Р’В¶ Р В РЎвЂ”Р В РЎвЂў Р В РЎвЂєР В РЎС›",
    description:
      "Р В РЎСљР В Р’В°Р В РЎвЂ”Р В РЎвЂўР В РЎВР В РЎвЂР В Р вЂ¦Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂў Р РЋР С“Р РЋР вЂљР В Р’ВµР В РўвЂР РЋР С“Р РЋРІР‚С™Р В Р вЂ Р В Р’В° Р В Р’В·Р В Р’В°Р РЋРІР‚В°Р В РЎвЂР РЋРІР‚С™Р РЋРІР‚в„–, Р РЋР С“Р В РЎвЂР В РЎвЂ“Р В Р вЂ¦Р В Р’В°Р В Р’В»Р РЋРІР‚в„– Р РЋР РЉР В Р вЂ Р В Р’В°Р В РЎвЂќР РЋРЎвЂњР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ, Р В РЎвЂ”Р В РЎвЂўР РЋР вЂљР РЋР РЏР В РўвЂР В РЎвЂўР В РЎвЂќ Р В РўвЂР В Р’ВµР В РІвЂћвЂ“Р РЋР С“Р РЋРІР‚С™Р В Р вЂ Р В РЎвЂР В РІвЂћвЂ“ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋРІР‚С™Р РЋР вЂљР В Р’В°Р В Р вЂ Р В РЎВР В Р’В°Р РЋРІР‚В¦ Р В РЎвЂ Р В Р вЂ Р В РЎвЂўР В Р’В·Р В РЎвЂ“Р В РЎвЂўР РЋР вЂљР В Р’В°Р В Р вЂ¦Р В РЎвЂР РЋР РЏР РЋРІР‚В¦.",
    role: "ALL",
  },
];

const SAFETY_PERIODICITY_DAYS = 180; // Р РЋР вЂљР В Р’В°Р В Р’В· Р В Р вЂ  Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В РЎвЂ“Р В РЎвЂўР В РўвЂР В Р’В°
const SAFETY_FIRST_DUE_DAYS = 3; // Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р вЂ Р В РЎвЂР РЋРІР‚РЋР В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р В РЎвЂќР В РЎвЂўР В Р вЂ¦Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В Р’В»Р РЋР Р‰ Р РЋРІР‚РЋР В Р’ВµР РЋР вЂљР В Р’ВµР В Р’В· 3 Р В РўвЂР В Р вЂ¦Р РЋР РЏ

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
      throw new Error("Р В Р РѓР РЋРІР‚С™Р РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂќР В РЎвЂўР В РўвЂ Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В РЎвЂР РЋР С“Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р РЋРЎвЂњР В Р’ВµР РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р В РўвЂР РЋР вЂљР РЋРЎвЂњР В РЎвЂ“Р В РЎвЂР В РЎВ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В РЎвЂўР В РЎВ");
    }
  }
  if (qrCode) {
    const existing = await prisma.item.findFirst({
      where: { qrCode, NOT: { id: itemId } },
    });
    if (existing) {
      throw new Error("QR Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В РЎвЂР РЋР С“Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р РЋРЎвЂњР В Р’ВµР РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р В РўвЂР РЋР вЂљР РЋРЎвЂњР В РЎвЂ“Р В РЎвЂР В РЎВ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В РЎвЂўР В РЎВ");
    }
  }
}

async function ensureUniqueLocationCodes({ code, qrCode }, locationId) {
  if (code) {
    const existing = await prisma.warehouseLocation.findFirst({
      where: { code, NOT: { id: locationId } },
    });
    if (existing) {
      throw new Error("Р В РЎв„ўР В РЎвЂўР В РўвЂ Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В РЎвЂР РЋР С“Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р РЋРЎвЂњР В Р’ВµР РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р В РўвЂР РЋР вЂљР РЋРЎвЂњР В РЎвЂ“Р В РЎвЂўР В РІвЂћвЂ“ Р В Р’В»Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР В Р’ВµР В РІвЂћвЂ“");
    }
  }
  if (qrCode) {
    const existing = await prisma.warehouseLocation.findFirst({
      where: { qrCode, NOT: { id: locationId } },
    });
    if (existing) {
      throw new Error("QR Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В РЎвЂР РЋР С“Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р РЋРЎвЂњР В Р’ВµР РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р В РўвЂР РЋР вЂљР РЋРЎвЂњР В РЎвЂ“Р В РЎвЂўР В РІвЂћвЂ“ Р В Р’В»Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР В Р’ВµР В РІвЂћвЂ“");
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
      title: "Р В Р’ВР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚В Р В РЎвЂР РЋР РЏ Р В РЎвЂєР В РЎС›: Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР В РЎвЂўР В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќ (Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂ)",
      description: "Р В Р’ВР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚В Р В РЎвЂР РЋР РЏ Р В РЎвЂ”Р В РЎвЂў Р В РЎвЂўР РЋРІР‚В¦Р РЋР вЂљР В Р’В°Р В Р вЂ¦Р В Р’Вµ Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РўвЂР В Р’В° Р В РўвЂР В Р’В»Р РЋР РЏ Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР В РЎвЂўР В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В РЎвЂўР В Р вЂ  Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР В Р’В°.",
      file: "/templates/Р В Р’ВР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚В Р В РЎвЂР РЋР РЏ_Р В РЎвЂєР В РЎС›_Р В РЎв„ўР В Р’В»Р В Р’В°Р В РўвЂР В РЎвЂўР В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќ_Р В Р Р‹Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂ.docx",
    note: "",
    },
    {
      title: "Р В Р’ВР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚В Р В РЎвЂР РЋР РЏ Р В РЎвЂєР В РЎС›: Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р РЋРІР‚РЋР В РЎвЂР В РЎвЂќ (Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂ)",
      description: "Р В Р’ВР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚В Р В РЎвЂР РЋР РЏ Р В РЎвЂ”Р В РЎвЂў Р В РЎвЂўР РЋРІР‚В¦Р РЋР вЂљР В Р’В°Р В Р вЂ¦Р В Р’Вµ Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РўвЂР В Р’В° Р В РўвЂР В Р’В»Р РЋР РЏ Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р РЋРІР‚РЋР В РЎвЂР В РЎвЂќР В РЎвЂўР В Р вЂ  Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР В Р’В°.",
      file: "/templates/Р В Р’ВР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚В Р В РЎвЂР РЋР РЏ_Р В РЎвЂєР В РЎС›_Р В РІР‚СљР РЋР вЂљР РЋРЎвЂњР В Р’В·Р РЋРІР‚РЋР В РЎвЂР В РЎвЂќ_Р В Р Р‹Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂ.docx",
    note: "",
    },
  ],
  journals: [
    {
      title: "Р В РІР‚вЂњР РЋРЎвЂњР РЋР вЂљР В Р вЂ¦Р В Р’В°Р В Р’В» Р РЋР вЂљР В Р’ВµР В РЎвЂ“Р В РЎвЂР РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ Р В Р вЂ Р В Р вЂ Р В РЎвЂўР В РўвЂР В Р вЂ¦Р В РЎвЂўР В РЎвЂ“Р В РЎвЂў Р В РЎвЂР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р В Р’В°Р В Р’В¶Р В Р’В°",
      description: "Р В РЎСџР РЋРЎвЂњР РЋР С“Р РЋРІР‚С™Р В РЎвЂўР В РІвЂћвЂ“ Р В Р’В¶Р РЋРЎвЂњР РЋР вЂљР В Р вЂ¦Р В Р’В°Р В Р’В» Р В РўвЂР В Р’В»Р РЋР РЏ Р РЋРІР‚С›Р В РЎвЂР В РЎвЂќР РЋР С“Р В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ Р В Р вЂ Р В Р вЂ Р В РЎвЂўР В РўвЂР В Р вЂ¦Р В РЎвЂўР В РЎвЂ“Р В РЎвЂў Р В РЎвЂР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р В Р’В°Р В Р’В¶Р В Р’В° (Р В Р’В¤Р В Р’ВР В РЎвЂє, Р В РўвЂР В Р’В°Р РЋРІР‚С™Р В Р’В°, Р В РЎвЂ”Р В РЎвЂўР В РўвЂР В РЎвЂ”Р В РЎвЂР РЋР С“Р В РЎвЂ).",
      file: "/templates/Р В РІР‚вЂњР РЋРЎвЂњР РЋР вЂљР В Р вЂ¦Р В Р’В°Р В Р’В»_Р В РІР‚в„ўР В Р вЂ Р В РЎвЂўР В РўвЂР В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“_Р В Р’ВР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р В Р’В°Р В Р’В¶_Р В РЎвЂєР В РЎС›.docx",
    note: "",
    },
    {
      title: "Р В РІР‚вЂњР РЋРЎвЂњР РЋР вЂљР В Р вЂ¦Р В Р’В°Р В Р’В» Р В РЎвЂР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р В Р’В°Р В Р’В¶Р В Р’ВµР В РІвЂћвЂ“ Р В Р вЂ¦Р В Р’В° Р РЋР вЂљР В Р’В°Р В Р’В±Р В РЎвЂўР РЋРІР‚РЋР В Р’ВµР В РЎВ Р В РЎВР В Р’ВµР РЋР С“Р РЋРІР‚С™Р В Р’Вµ",
      description: "Р В Р в‚¬Р РЋРІР‚РЋР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р вЂ Р В РЎвЂР РЋРІР‚РЋР В Р вЂ¦Р РЋРІР‚в„–Р РЋРІР‚В¦ Р В РЎвЂ Р В РЎвЂ”Р В РЎвЂўР В Р вЂ Р РЋРІР‚С™Р В РЎвЂўР РЋР вЂљР В Р вЂ¦Р РЋРІР‚в„–Р РЋРІР‚В¦ Р В РЎвЂР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р В Р’В°Р В Р’В¶Р В Р’ВµР В РІвЂћвЂ“ Р В Р вЂ¦Р В Р’В° Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР В Р’Вµ Р В РЎвЂ Р В Р вЂ  Р В РЎвЂ”Р В РЎвЂўР В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂўР РЋРІР‚РЋР В Р вЂ¦Р В РЎвЂў-Р РЋР вЂљР В Р’В°Р В Р’В·Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂўР РЋРІР‚РЋР В Р вЂ¦Р В РЎвЂўР В РІвЂћвЂ“ Р В Р’В·Р В РЎвЂўР В Р вЂ¦Р В Р’Вµ.",
      file: "/templates/Р В РІР‚вЂњР РЋРЎвЂњР РЋР вЂљР В Р вЂ¦Р В Р’В°Р В Р’В»_Р В Р’ВР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р В Р’В°Р В Р’В¶_Р В РЎСљР В Р’В°_Р В Р’В Р В Р’В°Р В Р’В±Р В РЎвЂўР РЋРІР‚РЋР В Р’ВµР В РЎВ_Р В РЎС™Р В Р’ВµР РЋР С“Р РЋРІР‚С™Р В Р’Вµ_Р В РЎвЂєР В РЎС›.docx",
    note: "",
    },
    {
      title: "Р В РІР‚вЂњР РЋРЎвЂњР РЋР вЂљР В Р вЂ¦Р В Р’В°Р В Р’В» Р РЋР вЂљР В Р’ВµР В РЎвЂ“Р В РЎвЂР РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ Р РЋРІР‚В Р В Р’ВµР В Р’В»Р В Р’ВµР В Р вЂ Р РЋРІР‚в„–Р РЋРІР‚В¦ Р В РЎвЂР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р В Р’В°Р В Р’В¶Р В Р’ВµР В РІвЂћвЂ“",
      description: "Р В Р’ВР РЋР С“Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р РЋРЎвЂњР В Р’ВµР РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р В РўвЂР В Р’В»Р РЋР РЏ Р РЋРІР‚В Р В Р’ВµР В Р’В»Р В Р’ВµР В Р вЂ Р РЋРІР‚в„–Р РЋРІР‚В¦ Р В РЎвЂР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р В Р’В°Р В Р’В¶Р В Р’ВµР В РІвЂћвЂ“ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В Р вЂ Р В Р вЂ¦Р В Р’ВµР В РЎвЂ”Р В Р’В»Р В Р’В°Р В Р вЂ¦Р В РЎвЂўР В Р вЂ Р РЋРІР‚в„–Р РЋРІР‚В¦ Р РЋР вЂљР В Р’В°Р В Р’В±Р В РЎвЂўР РЋРІР‚С™Р В Р’В°Р РЋРІР‚В¦ Р В РЎвЂ Р В РЎСџР В Р’В Р В Р’В .",
      file: "/templates/Р В РІР‚вЂњР РЋРЎвЂњР РЋР вЂљР В Р вЂ¦Р В Р’В°Р В Р’В»_Р В Р’В¦Р В Р’ВµР В Р’В»Р В Р’ВµР В Р вЂ Р В РЎвЂўР В РІвЂћвЂ“_Р В Р’ВР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р В Р’В°Р В Р’В¶_Р В РЎвЂєР В РЎС›.docx",
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
    const due = addDays(new Date(), SAFETY_FIRST_DUE_DAYS); // Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’В°Р РЋР РЏ Р В РўвЂР В Р’В°Р РЋРІР‚С™Р В Р’В° Р В РЎвЂќР В РЎвЂўР В Р вЂ¦Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В Р’В»Р РЋР РЏ Р Р†Р вЂљРІР‚Сњ Р РЋРІР‚РЋР В Р’ВµР РЋР вЂљР В Р’ВµР В Р’В· 3 Р В РўвЂР В Р вЂ¦Р РЋР РЏ
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

// Р В Р вЂ¦Р В РЎвЂўР РЋР вЂљР В РЎВР В Р’В°Р В Р’В»Р В РЎвЂР В Р’В·Р РЋРЎвЂњР В Р’ВµР В РЎВ dueDate Р РЋРЎвЂњ Р РЋР С“Р РЋРЎвЂњР РЋРІР‚В°Р В Р’ВµР РЋР С“Р РЋРІР‚С™Р В Р вЂ Р РЋРЎвЂњР РЋР вЂ№Р РЋРІР‚В°Р В РЎвЂР РЋРІР‚В¦ Р В РЎвЂР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р В Р’В°Р В Р’В¶Р В Р’ВµР В РІвЂћвЂ“ (Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р В Р’В»Р В Р’Вµ Р В РЎвЂР В Р’В·Р В РЎВР В Р’ВµР В Р вЂ¦Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В РЎвЂР В РЎвЂўР В РўвЂР В РЎвЂР РЋРІР‚РЋР В Р вЂ¦Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В РЎвЂ)
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

// ---------- Р В РЎвЂєР В РўС’Р В Р’В Р В РЎвЂ™Р В РЎСљР В РЎвЂ™ Р В РЎС›Р В Р’В Р В Р в‚¬Р В РІР‚СњР В РЎвЂ™ (Р В РЎвЂР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚В Р В РЎвЂР В РЎвЂ) ----------
app.get("/api/safety/instructions", auth, requireHr, async (req, res) => {
  try {
    await ensureSafetyInstructions();
    const instructions = await prisma.safetyInstruction.findMany({
      orderBy: { id: "asc" },
    });

    // Р В РЎвЂўР В Р’В±Р В РЎвЂўР В РЎвЂ“Р В Р’В°Р РЋРІР‚В°Р В Р’В°Р В Р’ВµР В РЎВ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В Р’ВµР В Р’В·Р В Р вЂ¦Р РЋРІР‚в„–Р В РЎВР В РЎвЂ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР РЏР В РЎВР В РЎвЂ Р В РўвЂР В Р’В»Р РЋР РЏ Р РЋРІР‚С›Р РЋР вЂљР В РЎвЂўР В Р вЂ¦Р РЋРІР‚С™Р В Р’В°
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

      // Р РЋРІР‚С™Р РЋР РЏР В Р вЂ¦Р В Р’ВµР В РЎВ Р В РЎвЂР В Р вЂ¦Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р В Р’В°Р В Р’В¶, Р РЋРІР‚РЋР РЋРІР‚С™Р В РЎвЂўР В Р’В±Р РЋРІР‚в„– Р В РЎвЂ”Р В РЎвЂўР В Р вЂ¦Р РЋР РЏР РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В РЎвЂР В РЎвЂўР В РўвЂР В РЎвЂР РЋРІР‚РЋР В Р вЂ¦Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р РЋР Р‰
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
  // Р В РЎвЂќР РЋРІР‚С™Р В РЎвЂў Р В РЎвЂР В РЎВР В Р’ВµР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ Р В Р’В° Р РЋРЎвЂњР В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ Р В Р’В»Р РЋР РЏР РЋРІР‚С™Р РЋР Р‰ Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР В РЎвЂўР В РЎВ / Р В Р’В·Р В Р’В°Р В РЎвЂќР РЋРЎвЂњР В РЎвЂ”Р В РЎвЂќР В Р’В°Р В РЎВР В РЎвЂ
  return user?.role === "ADMIN" || user?.role === "ACCOUNTING";
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
        name: "Р В РІР‚вЂќР В РЎвЂўР В Р вЂ¦Р В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР В Р’ВµР В РЎВР В РЎвЂќР В РЎвЂ",
      },
    });
  }
  return location;
}


function buildReceiveActHtml(order, rows, orgInfo) {
  const safeOrg = {
    name: orgInfo?.orgName || orgInfo?.name || "Р В РЎвЂєР РЋР вЂљР В РЎвЂ“Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’В·Р В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ",
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
    ? `<tr><td>Р В РЎС›Р В Р’ВµР В Р’В».: ${safeOrg.phone}</td></tr>`
    : "";

  return `
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>Р В РЎвЂ™Р В РЎв„ўР В РЎС› Р В РІР‚в„ўР В РЎвЂєР В РІР‚вЂќР В РІР‚в„ўР В Р’В Р В РЎвЂ™Р В РЎС›Р В РЎвЂ™ Р В РЎС›Р В РЎвЂєР В РІР‚в„ўР В РЎвЂ™Р В Р’В Р В РЎвЂ™ Р Р†РІР‚С›РІР‚вЂњ ${order?.number || ""} Р В РЎвЂўР РЋРІР‚С™ ${actDateStr}</title>
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
      <tr><td>Р В Р’В®Р РЋР вЂљР В РЎвЂР В РўвЂР В РЎвЂР РЋРІР‚РЋР В Р’ВµР РЋР С“Р В РЎвЂќР В РЎвЂР В РІвЂћвЂ“ Р В Р’В°Р В РўвЂР РЋР вЂљР В Р’ВµР РЋР С“: ${safeOrg.legalAddress}</td></tr>
      <tr><td>Р В Р’В¤Р В Р’В°Р В РЎвЂќР РЋРІР‚С™Р В РЎвЂР РЋРІР‚РЋР В Р’ВµР РЋР С“Р В РЎвЂќР В РЎвЂР В РІвЂћвЂ“ Р В Р’В°Р В РўвЂР РЋР вЂљР В Р’ВµР РЋР С“: ${safeOrg.actualAddress}</td></tr>
      <tr><td>Р В Р’ВР В РЎСљР В РЎСљ ${safeOrg.inn}&nbsp;&nbsp;&nbsp;&nbsp;Р В РЎв„ўР В РЎСџР В РЎСџ ${safeOrg.kpp}</td></tr>
      ${phoneRow}
    </table>

    <div class="title">
      Р В РЎвЂ™Р В РЎв„ўР В РЎС› Р В РІР‚в„ўР В РЎвЂєР В РІР‚вЂќР В РІР‚в„ўР В Р’В Р В РЎвЂ™Р В РЎС›Р В РЎвЂ™ Р В РЎС›Р В РЎвЂєР В РІР‚в„ўР В РЎвЂ™Р В Р’В Р В РЎвЂ™ Р Р†РІР‚С›РІР‚вЂњ ${order?.number || ""} Р В РЎвЂўР РЋРІР‚С™ ${actDateStr}
    </div>

    <div class="small" style="margin-bottom:4px;">
      Р В РЎСџР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќ: ${order?.supplier?.name || ""}
    </div>
    <div class="small" style="margin-bottom:8px;">
      Р В РІР‚СњР В РЎвЂўР В РЎвЂќР РЋРЎвЂњР В РЎВР В Р’ВµР В Р вЂ¦Р РЋРІР‚С™: Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В· Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР РЋРЎвЂњ Р Р†РІР‚С›РІР‚вЂњ ${order?.number || ""} Р В РЎвЂўР РЋРІР‚С™ ${orderDateStr}
    </div>

    <div class="small" style="margin-bottom:6px;">
      Р В РЎСџР РЋР вЂљР В РЎвЂ Р В РЎвЂўР РЋРІР‚В Р В Р’ВµР В Р вЂ¦Р В РЎвЂќР В Р’Вµ Р В РЎвЂќР В Р’В°Р РЋРІР‚РЋР В Р’ВµР РЋР С“Р РЋРІР‚С™Р В Р вЂ Р В Р’В° Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р В Р’В»Р В Р’ВµР В Р вЂ¦Р В Р вЂ¦Р В РЎвЂўР В РЎвЂ“Р В РЎвЂў Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В° Р В Р’В·Р В Р’В°Р РЋРІР‚С›Р В РЎвЂР В РЎвЂќР РЋР С“Р В РЎвЂР РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’В°Р В Р вЂ¦Р РЋРІР‚в„– Р РЋР С“Р В Р’В»Р В Р’ВµР В РўвЂР РЋРЎвЂњР РЋР вЂ№Р РЋРІР‚В°Р В РЎвЂР В Р’Вµ Р В Р вЂ¦Р В Р’ВµР В РўвЂР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂќР В РЎвЂ:
    </div>

    <table class="act-table">
      <tr>
        <th style="width:30px;">Р Р†РІР‚С›РІР‚вЂњ Р В РЎвЂ”/Р В РЎвЂ”</th>
        <th>Р В РЎСљР В Р’В°Р В РЎвЂР В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂўР В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’Вµ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В°</th>
        <th style="width:140px;">Р В РЎв„ўР В РЎвЂўР В Р’В»Р В РЎвЂР РЋРІР‚РЋР В Р’ВµР РЋР С“Р РЋРІР‚С™Р В Р вЂ Р В РЎвЂў, Р РЋРІвЂљВ¬Р РЋРІР‚С™. (Р В РЎвЂ”Р В РЎвЂў Р В Р вЂ¦Р В Р’В°Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР В Р вЂ¦Р В РЎвЂўР В РІвЂћвЂ“)</th>
        <th style="width:120px;">Р В РЎв„ўР В РЎвЂўР В Р’В»Р В РЎвЂР РЋРІР‚РЋР В Р’ВµР РЋР С“Р РЋРІР‚С™Р В Р вЂ Р В РЎвЂў, Р РЋРІвЂљВ¬Р РЋРІР‚С™. (Р РЋРІР‚С›Р В Р’В°Р В РЎвЂќР РЋРІР‚С™Р В РЎвЂР РЋРІР‚РЋР В Р’ВµР РЋР С“Р В РЎвЂќР В РЎвЂ)</th>
        <th style="width:150px;">Р В РЎв„ўР В РЎвЂўР В Р’В»Р В РЎвЂР РЋРІР‚РЋР В Р’ВµР РЋР С“Р РЋРІР‚С™Р В Р вЂ Р В РЎвЂў Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В° Р РЋР С“ Р В Р вЂ¦Р В Р’ВµР В РўвЂР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂќР В Р’В°Р В РЎВР В РЎвЂ, Р РЋРІвЂљВ¬Р РЋРІР‚С™.</th>
        <th style="width:140px;">Р В РІР‚вЂќР В Р’В°Р В РЎвЂќР В Р’В»Р РЋР вЂ№Р РЋРІР‚РЋР В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ, Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР В РЎВР В Р’ВµР РЋРІР‚РЋР В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’Вµ</th>
      </tr>
      ${rowsHtml}
      <tr>
        <td colspan="2" style="text-align:right;font-weight:bold;">Р В Р’ВР РЋРІР‚С™Р В РЎвЂўР В РЎвЂ“Р В РЎвЂў:</td>
        <td style="text-align:center;font-weight:bold;">${totalOrdered}</td>
        <td style="text-align:center;font-weight:bold;">${totalReceived}</td>
        <td style="text-align:center;font-weight:bold;">${totalDiff}</td>
        <td></td>
      </tr>
    </table>

    <div class="small" style="margin-top:16px;">
      Р В РЎСџР РЋР вЂљР В РЎвЂР РЋРІР‚РЋР В РЎвЂР В Р вЂ¦Р РЋРІР‚в„– Р В Р вЂ¦Р В Р’ВµР В РўвЂР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚РЋР В РЎвЂ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В° Р В РЎВР В РЎвЂўР В РЎвЂ“Р РЋРЎвЂњР РЋРІР‚С™ Р В Р’В±Р РЋРІР‚в„–Р РЋРІР‚С™Р РЋР Р‰ Р В Р вЂ Р РЋРІР‚в„–Р РЋР РЏР В Р вЂ Р В Р’В»Р В Р’ВµР В Р вЂ¦Р РЋРІР‚в„– Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р В Р’В»Р В Р’Вµ Р В Р вЂ Р РЋР С“Р В РЎвЂќР РЋР вЂљР РЋРІР‚в„–Р РЋРІР‚С™Р В РЎвЂР РЋР РЏ Р РЋРІР‚С™Р В Р’В°Р РЋР вЂљР РЋРІР‚в„– Р В РЎвЂ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР РЋР С“Р РЋРІР‚РЋР В Р’ВµР РЋРІР‚С™Р В Р’В° Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В°.
    </div>

    <div class="signs">
      <div class="sign">
        <div>Р В РЎСџР В РЎвЂўР В Р’В»Р РЋРЎвЂњР РЋРІР‚РЋР В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰</div>
        <div class="line"></div>
        <div class="small">Р В РўвЂР В РЎвЂўР В Р’В»Р В Р’В¶Р В Р вЂ¦Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р РЋР Р‰ / Р В РЎвЂ”Р В РЎвЂўР В РўвЂР В РЎвЂ”Р В РЎвЂР РЋР С“Р РЋР Р‰ / Р В Р’В¤.Р В Р’В.Р В РЎвЂє.</div>
        <div class="small" style="margin-top:6px;">Р В РЎС™.Р В РЎСџ.</div>
      </div>
      <div class="sign">
        <div>Р В РЎСџР РЋР вЂљР В Р’ВµР В РўвЂР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р В РЎвЂР РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В° (Р РЋР РЉР В РЎвЂќР РЋР С“Р В РЎвЂ”Р В Р’ВµР В РўвЂР В РЎвЂР РЋРІР‚С™Р В РЎвЂўР РЋР вЂљ)</div>
        <div class="line"></div>
        <div class="small">Р В РўвЂР В РЎвЂўР В Р’В»Р В Р’В¶Р В Р вЂ¦Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р РЋР Р‰ / Р В РЎвЂ”Р В РЎвЂўР В РўвЂР В РЎвЂ”Р В РЎвЂР РЋР С“Р РЋР Р‰ / Р В Р’В¤.Р В Р’В.Р В РЎвЂє.</div>
      </div>
    </div>

    <button class="print-btn" onclick="window.print()">Р В РЎСџР В Р’ВµР РЋРІР‚РЋР В Р’В°Р РЋРІР‚С™Р РЋР Р‰</button>
  </div>
</body>
</html>
  `;
}

// ================== TELEGRAM Р В РІР‚ВР В РЎвЂєР В РЎС› (Р В РЎС›Р В РІР‚СћР В Р Р‹Р В РЎС›Р В РЎвЂєР В РІР‚в„ўР В Р’В«Р В РІвЂћСћ) ==================

const TELEGRAM_BOT_TOKEN =
  "8254839296:AAGnAvL09dFoMyHzIyRqi2FZ11G6tJgDee4";
const TELEGRAM_GROUP_CHAT_ID = "-4974442288";
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Р РЋРЎвЂњР В Р вЂ¦Р В РЎвЂР В Р вЂ Р В Р’ВµР РЋР вЂљР РЋР С“Р В Р’В°Р В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В Р’В°Р РЋР РЏ Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ Р В РЎвЂќР В Р’В° Р РЋР С“Р В РЎвЂўР В РЎвЂўР В Р’В±Р РЋРІР‚В°Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ
async function sendTelegramMessage(chatId, text, extra = {}) {
  try {
    if (!TELEGRAM_BOT_TOKEN || !chatId) {
      console.log("[Telegram] TOKEN Р В РЎвЂР В Р’В»Р В РЎвЂ chatId Р В Р вЂ¦Р В Р’Вµ Р РЋРЎвЂњР В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°Р В Р вЂ¦, Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ Р В РЎвЂќР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В РЎвЂ”Р РЋРЎвЂњР РЋРІР‚В°Р В Р’ВµР В Р вЂ¦Р В Р’В°");
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
      console.error("[Telegram] Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ Р В РЎвЂќР В РЎвЂ:", data);
    }
  } catch (err) {
    console.error("[Telegram] Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В°:", err);
  }
}

// Р В Р в‚¬Р В РўвЂР В РЎвЂўР В Р’В±Р В Р вЂ¦Р В Р’В°Р РЋР РЏ Р В РЎвЂўР В Р’В±Р РЋРІР‚ВР РЋР вЂљР РЋРІР‚С™Р В РЎвЂќР В Р’В°: Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ Р В РЎвЂР РЋРІР‚С™Р РЋР Р‰ Р РЋР С“Р В РЎвЂўР В РЎвЂўР В Р’В±Р РЋРІР‚В°Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В РЎвЂР В РЎВР В Р’ВµР В Р вЂ¦Р В Р вЂ¦Р В РЎвЂў Р В Р вЂ  Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР РЋР С“Р В РЎвЂќР В РЎвЂўР В РІвЂћвЂ“ Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В РЎвЂ”Р В РЎвЂ”Р В РЎвЂўР В Р вЂ Р В РЎвЂўР В РІвЂћвЂ“ Р РЋРІР‚РЋР В Р’В°Р РЋРІР‚С™
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

  const title = a.instruction?.title || "Инструкция";
  const dueStr = due.toLocaleDateString("ru-RU");
  const lines = [
    "Напоминание о проверке",
    "",
    `Инструкция: ${title}`,
    `Сотрудник: ${a.employee.fullName}`,
    `Срок: ${dueStr}`,
    diffDays >= 0
      ? `Осталось дней: ${diffDays + 1}`
      : `Просрочено на ${Math.abs(diffDays)} дн.`,
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

// Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋР вЂљР РЋРІР‚С™ Р РЋРІР‚С›Р В РЎвЂўР В Р вЂ¦Р В РЎвЂўР В Р вЂ Р РЋРІР‚в„–Р РЋРІР‚В¦ Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р РЋРІР‚РЋ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В Р вЂ¦Р В РЎвЂўР РЋР С“Р В РЎвЂР В РЎВ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р В Р’В»Р В Р’Вµ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’ВµР РЋР вЂљР В РЎвЂќР В РЎвЂ Р В РЎвЂ“Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р вЂ¦Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В РЎвЂ Р В РІР‚ВР В РІР‚Сњ

// Р В РЎвЂўР В Р’В±Р РЋР вЂљР В Р’В°Р В Р’В±Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂќР В Р’В° callback_query (Р В РЎвЂќР В Р вЂ¦Р В РЎвЂўР В РЎвЂ”Р В РЎвЂќР В Р’В° "Р Р†РЎС™РІР‚В¦ Р В РІР‚в„ўР РЋРІР‚в„–Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В Р вЂ¦Р В Р’ВµР В Р вЂ¦Р В РЎвЂў")
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
          text: "?????? ???????? ??? ???????????.",
          show_alert: false,
        }),
      });
      return;
    }

    // Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’ВµР РЋР вЂљР РЋР РЏР В Р’ВµР В РЎВ, Р РЋРІР‚РЋР РЋРІР‚С™Р В РЎвЂў Р В Р вЂ¦Р В Р’В°Р В Р’В¶Р В Р’В°Р В Р’В» Р В РЎвЂР В РЎВР В Р’ВµР В Р вЂ¦Р В Р вЂ¦Р В РЎвЂў Р В РЎвЂР РЋР С“Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В Р вЂ¦Р В РЎвЂР РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰ (Р В Р’ВµР РЋР С“Р В Р’В»Р В РЎвЂ executorChatId Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р В Р вЂ¦)
    if (
      task.executorChatId &&
      String(task.executorChatId) !== String(from.id)
    ) {
      await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackId,
          text: "������� ������ ����� ������ �����������.",
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
      const match = task.title.match(/������ ������ #(\d+)/);
      if (match && task.assignerId) {
        const requestId = Number(match[1]);
        if (requestId) {
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
        text: "������ �������� ��� �����������.",
        show_alert: false,
      }),
    });

    await sendTelegramMessage(
      from.id,
      `������ <b>${task.title}</b> �������� ��� �����������.`
    );

    await sendWarehouseGroupMessage(
      `������ <b>${task.title}</b> ��������� ������������� ${
        from.first_name || from.username || from.id
      }.`
    );

    console.log(
      `[Telegram] Р В РІР‚вЂќР В Р’В°Р В РўвЂР В Р’В°Р РЋРІР‚РЋР В Р’В° ${taskId} Р В РЎвЂўР РЋРІР‚С™Р В РЎВР В Р’ВµР РЋРІР‚РЋР В Р’ВµР В Р вЂ¦Р В Р’В° Р В РЎвЂќР В Р’В°Р В РЎвЂќ Р В Р вЂ Р РЋРІР‚в„–Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В Р вЂ¦Р В Р’ВµР В Р вЂ¦Р В Р вЂ¦Р В Р’В°Р РЋР РЏ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р В Р’ВµР В РЎВ ${from.id}`
    );
  } catch (err) {
    console.error("[handleTelegramUpdate] Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В°:", err);
  }
}

let telegramOffset = 0;

async function startTelegramPolling() {
  console.log("Р Р†РІР‚вЂњР’В¶Р С—РЎвЂР РЏ Р В РІР‚вЂќР В Р’В°Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќ long polling Telegram...");

  while (true) {
    try {
      const url = `${TELEGRAM_API}/getUpdates?timeout=25&offset=${telegramOffset}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!data.ok) {
        console.error("[startTelegramPolling] Р В РЎвЂєР РЋРІР‚С™Р В Р вЂ Р В Р’ВµР РЋРІР‚С™ Telegram Р РЋР С“ Р В РЎвЂўР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В РЎвЂўР В РІвЂћвЂ“:", data);
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
      console.error("[startTelegramPolling] Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В°:", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ================== Р В РЎСљР В РЎвЂ™Р В РЎСџР В РЎвЂєР В РЎС™Р В Р’ВР В РЎСљР В РЎвЂ™Р В РЎСљР В Р’ВР В Р вЂЎ Р В РЎСџР В РЎвЂє Р В РІР‚вЂќР В РЎвЂ™Р В РІР‚СњР В РЎвЂ™Р В Р’В§Р В РЎвЂ™Р В РЎС™ Р В Р Р‹Р В РЎв„ўР В РІР‚С”Р В РЎвЂ™Р В РІР‚СњР В РЎвЂ™ ==================


function buildWarehouseTaskTelegramText({ task, dueStr, kind }) {
  const title = task?.title || "";
  const executor = task?.executorName || "";
  const assigner = task?.assigner?.name || task?.assigner?.email || "";
  const lines = [];

  if (kind === "overdue") {
    lines.push("������������ ������ ������");
  } else if (kind === "due_soon") {
    lines.push("������ ������ ����� �� �����");
  } else {
    lines.push("������ ������");
  }

  lines.push("");
  if (title) lines.push(`������: ${title}`);
  if (executor) lines.push(`�����������: ${executor}`);
  if (dueStr) lines.push(`����: ${dueStr}`);
  if (assigner) lines.push(`�����: ${assigner}`);

  return lines.join("\n");
}

function buildWarehouseTaskCreatedTelegramText(task) {
  const title = task?.title || "";
  const executor = task?.executorName || "�� ��������";
  const assigner = task?.assigner?.name || task?.assigner?.email || "����������";
  const lines = ["����� ������ ������", ""];

  if (title) lines.push(`������: ${title}`);
  lines.push(`�����������: ${executor}`);
  lines.push(`�����: ${assigner}`);

  if (task?.description) {
    lines.push("");
    lines.push("��������:");
    lines.push(task.description);
  }

  if (task?.dueDate) {
    lines.push(`����: ${new Date(task.dueDate).toLocaleString("ru-RU")}`);
  }

  return lines.join("\n");
}

async function createWarehouseTaskFromRequest(request, assignerId) {
  try {
    const lines = [];

    if (request.comment) {
      lines.push(`�����������: ${request.comment}`);
    }

    if (request.items && request.items.length) {
      if (lines.length) lines.push("");
      lines.push("�������:");

      for (const it of request.items) {
        lines.push(`- ${it.name} x ${it.quantity} ${it.unit || ""}`.trim());
      }
    }

    const description = lines.join("\n");

    const task = await prisma.warehouseTask.create({
      data: {
        title: `������ ������ #${request.id}: ${request.title}`,
        description,
        dueDate: null,
        executorName: "�� ��������",
        executorChatId: null,
        assignerId,
      },
      include: {
        assigner: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    const text = buildWarehouseTaskCreatedTelegramText(task);

    await sendWarehouseGroupMessage(text);

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
        .json({ message: "����� ������� �������� ������." });
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

    // Р В Р Р‹Р В РЎвЂўР В РЎвЂўР В Р’В±Р РЋРІР‚В°Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В Р вЂ  Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В РЎвЂ”Р В РЎвЂ”Р РЋРЎвЂњ
    const text = buildWarehouseTaskCreatedTelegramText(task);

    sendWarehouseGroupMessage(text).catch((err) =>
      console.error("[Telegram] send group message error:", err)
    );

    if (task.executorChatId) {
      sendTelegramMessage(task.executorChatId, text, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "�������� ���������",
                callback_data: `done:${task.id}`,
              },
            ],
          ],
        },
      }).catch((err) =>
        console.error("[Telegram] send executor message error:", err)
      );
    }

    res.status(201).json(task);
  } catch (err) {
    console.error("Warehouse task create error:", err);
    res
      .status(500)
      .json({ message: "������ �������� ������ ������." });
  }
});

// Р В РЎВР В РЎвЂўР В РЎвЂ Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р РЋРІР‚РЋР В РЎвЂ (Р В Р вЂ¦Р В Р’В°Р В Р’В·Р В Р вЂ¦Р В Р’В°Р РЋРІР‚РЋР В Р’ВµР В Р вЂ¦Р В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ Р В РЎВР В Р вЂ¦Р В РЎвЂўР В РІвЂћвЂ“)
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР В Р’Вµ Р В Р вЂ Р В Р’В°Р РЋРІвЂљВ¬Р В РЎвЂР РЋРІР‚В¦ Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р РЋРІР‚РЋ" });
  }
});

// Р В Р вЂ Р РЋР С“Р В Р’Вµ Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р РЋРІР‚РЋР В РЎвЂ Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР В Р’В° (ADMIN/ACCOUNTING)
app.get("/api/warehouse/tasks", auth, async (req, res) => {
  try {
    if (!["ADMIN", "ACCOUNTING", "EMPLOYEE"].includes(req.user.role)) {
      return res.status(403).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ " });
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР В Р’Вµ Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р РЋРІР‚РЋ Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР В Р’В°" });
  }
});

// Р РЋР С“Р В РЎВР В Р’ВµР В Р вЂ¦Р В Р’В° Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“Р В Р’В° Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р РЋРІР‚РЋР В РЎвЂ (Р РЋРІР‚РЋР В Р’ВµР РЋР вЂљР В Р’ВµР В Р’В· Р В РЎвЂ”Р В РЎвЂўР РЋР вЂљР РЋРІР‚С™Р В Р’В°Р В Р’В», Р В Р вЂ¦Р В Р’Вµ Р РЋРІР‚РЋР В Р’ВµР РЋР вЂљР В Р’ВµР В Р’В· Р В Р’В±Р В РЎвЂўР РЋРІР‚С™Р В Р’В°)
app.put("/api/warehouse/tasks/:id/status", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;

    if (!["ADMIN", "ACCOUNTING", "EMPLOYEE"].includes(req.user.role)) {
      return res.status(403).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ " });
    }

    if (!["NEW", "IN_PROGRESS", "DONE", "CANCELLED"].includes(status)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РўвЂР В РЎвЂўР В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р РЋРІР‚С™Р В РЎвЂР В РЎВР РЋРІР‚в„–Р В РІвЂћвЂ“ Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“" });
    }

    const updated = await prisma.warehouseTask.update({
      where: { id },
      data: { status },
    });

    // Р В РІР‚СћР РЋР С“Р В Р’В»Р В РЎвЂ Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р РЋРІР‚РЋР В Р’В° Р РЋР С“Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р В Р вЂ¦Р В Р’В° Р В РЎвЂ”Р В РЎвЂў Р В Р’В·Р В Р’В°Р РЋР РЏР В Р вЂ Р В РЎвЂќР В Р’Вµ Р В Р вЂ¦Р В Р’В° Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂ Р В РЎвЂ Р В РЎВР РЋРІР‚в„– Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р В РЎвЂР В Р’В»Р В РЎвЂ DONE Р Р†Р вЂљРІР‚Сњ
    // Р В Р’В°Р В Р вЂ Р РЋРІР‚С™Р В РЎвЂўР В РЎВР В Р’В°Р РЋРІР‚С™Р В РЎвЂР РЋРІР‚РЋР В Р’ВµР РЋР С“Р В РЎвЂќР В РЎвЂ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В Р вЂ Р В РЎвЂўР В РўвЂР В РЎвЂР В РЎВ Р РЋР РЉР РЋРІР‚С™Р РЋРЎвЂњ Р В Р’В·Р В Р’В°Р РЋР РЏР В Р вЂ Р В РЎвЂќР РЋРЎвЂњ Р В РЎвЂ”Р В РЎвЂў Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР РЋРЎвЂњ
    if (status === "DONE") {
      try {
        // title Р В Р вЂ Р В РЎвЂР В РўвЂР В Р’В°: "Р В РІР‚вЂќР В Р’В°Р РЋР РЏР В Р вЂ Р В РЎвЂќР В Р’В° Р В Р вЂ¦Р В Р’В° Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂ #19: ..."
        const match = updated.title.match(/Р В РІР‚вЂќР В Р’В°Р РЋР РЏР В Р вЂ Р В РЎвЂќР В Р’В° Р В Р вЂ¦Р В Р’В° Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂ #(\d+)/);
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В РЎвЂўР В Р’В±Р В Р вЂ¦Р В РЎвЂўР В Р вЂ Р В Р’В»Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В РЎвЂ Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“Р В Р’В° Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р РЋРІР‚РЋР В РЎвЂ" });
  }
});

// ================== Р В Р Р‹Р В РЎв„ўР В РІР‚С”Р В РЎвЂ™Р В РІР‚Сњ: Р В РЎСљР В РЎвЂєР В РЎС™Р В РІР‚СћР В РЎСљР В РЎв„ўР В РІР‚С”Р В РЎвЂ™Р В РЎС›Р В Р в‚¬Р В Р’В Р В РЎвЂ™ Р В Р’В Р В РЎвЂєР В Р Р‹Р В РЎС›Р В РЎвЂ™Р В РЎС›Р В РЎв„ўР В Р’В ==================

// Р В Р Р‹Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљ (Р В Р вЂ¦Р В РЎвЂўР В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂќР В Р’В»Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР вЂљР В Р’В°)
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

    // 1) Р В РЎСџР РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’ВµР РЋР вЂљР РЋР РЏР В Р’ВµР В РЎВ, Р РЋРІР‚РЋР РЋРІР‚С™Р В РЎвЂў Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В РЎвЂ Р В Р вЂ¦Р В Р’Вµ Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р РЋРІР‚С™Р РЋРІР‚в„–Р В Р’Вµ
    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ message: "Р В РЎСљР В Р’В°Р В РЎвЂР В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂўР В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’Вµ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В° Р В РЎвЂўР В Р’В±Р РЋР РЏР В Р’В·Р В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В РЎвЂў" });
    }

    if (!sku || !sku.trim()) {
      return res
        .status(400)
        .json({ message: "Р В РЎвЂ™Р РЋР вЂљР РЋРІР‚С™Р В РЎвЂР В РЎвЂќР РЋРЎвЂњР В Р’В» (SKU) Р В РЎвЂўР В Р’В±Р РЋР РЏР В Р’В·Р В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р В Р’ВµР В Р вЂ¦" });
    }

    if (!unit || !unit.trim()) {
      return res
        .status(400)
        .json({ message: "Р В РІР‚СћР В РўвЂР В РЎвЂР В Р вЂ¦Р В РЎвЂР РЋРІР‚В Р В Р’В° Р В РЎвЂР В Р’В·Р В РЎВР В Р’ВµР РЋР вЂљР В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ Р В РЎвЂўР В Р’В±Р РЋР РЏР В Р’В·Р В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В Р’В°" });
    }

    // 2) Р В Р’В§Р В РЎвЂР РЋР С“Р В Р’В»Р В РЎвЂўР В Р вЂ Р РЋРІР‚в„–Р В Р’Вµ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР РЏ
    const minVal = Number(minStock);
    const maxVal = Number(maxStock);
    const priceVal = Number(
      String(defaultPrice).toString().replace(",", ".")
    );

    if (!Number.isFinite(minVal) || minVal <= 0) {
      return res.status(400).json({
        message: "Р В РЎС™Р В РЎвЂР В Р вЂ¦Р В РЎвЂР В РЎВР В Р’В°Р В Р’В»Р РЋР Р‰Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂўР В РЎвЂќ Р В РўвЂР В РЎвЂўР В Р’В»Р В Р’В¶Р В Р’ВµР В Р вЂ¦ Р В Р’В±Р РЋРІР‚в„–Р РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В РЎвЂўР В Р’В¶Р В РЎвЂР РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р РЋРІР‚в„–Р В РЎВ Р РЋРІР‚РЋР В РЎвЂР РЋР С“Р В Р’В»Р В РЎвЂўР В РЎВ",
      });
    }

    if (!Number.isFinite(maxVal) || maxVal <= 0) {
      return res.status(400).json({
        message: "Р В РЎС™Р В Р’В°Р В РЎвЂќР РЋР С“Р В РЎвЂР В РЎВР В Р’В°Р В Р’В»Р РЋР Р‰Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂўР В РЎвЂќ Р В РўвЂР В РЎвЂўР В Р’В»Р В Р’В¶Р В Р’ВµР В Р вЂ¦ Р В Р’В±Р РЋРІР‚в„–Р РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В РЎвЂўР В Р’В¶Р В РЎвЂР РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р РЋРІР‚в„–Р В РЎВ Р РЋРІР‚РЋР В РЎвЂР РЋР С“Р В Р’В»Р В РЎвЂўР В РЎВ",
      });
    }

    if (!Number.isFinite(priceVal) || priceVal <= 0) {
      return res.status(400).json({
        message: "Р В Р’В¦Р В Р’ВµР В Р вЂ¦Р В Р’В° Р В Р’В·Р В Р’В° Р В Р’ВµР В РўвЂР В РЎвЂР В Р вЂ¦Р В РЎвЂР РЋРІР‚В Р РЋРЎвЂњ Р В РўвЂР В РЎвЂўР В Р’В»Р В Р’В¶Р В Р вЂ¦Р В Р’В° Р В Р’В±Р РЋРІР‚в„–Р РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В РЎвЂўР В Р’В¶Р В РЎвЂР РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р РЋРІР‚в„–Р В РЎВ Р РЋРІР‚РЋР В РЎвЂР РЋР С“Р В Р’В»Р В РЎвЂўР В РЎВ",
      });
    }

    // 3) Р В Р Р‹Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р РЋРІР‚ВР В РЎВ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљ
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
        .json({ message: "Р В РЎвЂ™Р РЋР вЂљР РЋРІР‚С™Р В РЎвЂР В РЎвЂќР РЋРЎвЂњР В Р’В», Р РЋРІвЂљВ¬Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂќР В РЎвЂўР В РўвЂ Р В РЎвЂР В Р’В»Р В РЎвЂ QR Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В РЎвЂР РЋР С“Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р РЋРЎвЂњР РЋР вЂ№Р РЋРІР‚С™Р РЋР С“Р РЋР РЏ" });
    }
    return res
      .status(500)
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋР С“Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р В Р вЂ¦Р В РЎвЂР В РЎвЂ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В°" });
  }
});

// Р В Р Р‹Р В РЎвЂ”Р В РЎвЂР РЋР С“Р В РЎвЂўР В РЎвЂќ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В РЎвЂўР В Р вЂ  (Р В Р’В±Р В Р’ВµР В Р’В· Р РЋР вЂљР В Р’В°Р РЋР С“Р РЋРІР‚РЋР РЋРІР‚ВР РЋРІР‚С™Р В Р’В° Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂќР В РЎвЂўР В Р вЂ )
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР В Р’Вµ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В РЎвЂўР В Р вЂ " });
  }
});

// Р В РЎСџР В РЎвЂўР В РЎвЂР РЋР С“Р В РЎвЂќ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В° Р В РЎвЂ”Р В РЎвЂў Р РЋРІвЂљВ¬Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂќР В РЎвЂўР В РўвЂР РЋРЎвЂњ (Р В РўвЂР В Р’В»Р РЋР РЏ Р В РЎВР В РЎвЂўР В Р’В±Р В РЎвЂР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В РЎвЂўР В РЎвЂ“Р В РЎвЂў Р В РЎС›Р В Р Р‹Р В РІР‚Сњ)
app.get("/api/inventory/items/by-barcode/:barcode", auth, async (req, res) => {
  try {
    const raw = req.params.barcode || "";
    const barcode = raw.trim();

    if (!barcode) {
      return res.status(400).json({ message: "Р В Р РѓР РЋРІР‚С™Р РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂќР В РЎвЂўР В РўвЂ Р В РЎвЂўР В Р’В±Р РЋР РЏР В Р’В·Р В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р В Р’ВµР В Р вЂ¦" });
    }

    // Р В РЎвЂР РЋРІР‚В°Р В Р’ВµР В РЎВ Р В РЎвЂ”Р В РЎвЂў Р РЋРІвЂљВ¬Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂќР В РЎвЂўР В РўвЂР РЋРЎвЂњ, QR Р В РЎвЂР В Р’В»Р В РЎвЂ SKU (Р В Р вЂ¦Р В Р’В° Р РЋР С“Р В Р’В»Р РЋРЎвЂњР РЋРІР‚РЋР В Р’В°Р В РІвЂћвЂ“, Р В Р’ВµР РЋР С“Р В Р’В»Р В РЎвЂ Р РЋР С“Р В РЎвЂќР В Р’В°Р В Р вЂ¦Р В Р’ВµР РЋР вЂљ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚в„–Р В Р’В»Р В Р’В°Р В Р’ВµР РЋРІР‚С™ Р В РЎвЂќР В РЎвЂўР В РўвЂ Р В Р’В°Р РЋР вЂљР РЋРІР‚С™Р В РЎвЂР В РЎвЂќР РЋРЎвЂњР В Р’В»Р В Р’В°)
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
        .json({ message: "Р В РЎС›Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљ Р РЋР С“ Р РЋРІР‚С™Р В Р’В°Р В РЎвЂќР В РЎвЂР В РЎВ Р РЋРІвЂљВ¬Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂќР В РЎвЂўР В РўвЂР В РЎвЂўР В РЎВ Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦" });
    }

    // Р РЋР С“Р РЋРІР‚РЋР В РЎвЂР РЋРІР‚С™Р В Р’В°Р В Р’ВµР В РЎВ Р РЋРІР‚С™Р В Р’ВµР В РЎвЂќР РЋРЎвЂњР РЋРІР‚В°Р В РЎвЂР В РІвЂћвЂ“ Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂўР В РЎвЂќ Р В РЎвЂ”Р В РЎвЂў Р РЋР РЉР РЋРІР‚С™Р В РЎвЂўР В РЎВР РЋРЎвЂњ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР РЋРЎвЂњ
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В РЎвЂ”Р В РЎвЂўР В РЎвЂР РЋР С“Р В РЎвЂќР В Р’Вµ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В° Р В РЎвЂ”Р В РЎвЂў Р РЋРІвЂљВ¬Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂќР В РЎвЂўР В РўвЂР РЋРЎвЂњ" });
  }
});

// Р В Р в‚¬Р В РўвЂР В Р’В°Р В Р’В»Р В РЎвЂР РЋРІР‚С™Р РЋР Р‰ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљ (Р В Р вЂ¦Р В РЎвЂўР В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂќР В Р’В»Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР вЂљР В Р’В°)
app.delete("/api/inventory/items/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id || Number.isNaN(id)) {
      return res
        .status(400)
        .json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ ID Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В°" });
    }

    const existing = await prisma.item.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({ message: "Р В РЎС›Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљ Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦" });
    }

    // Р В Р Р‹Р В Р вЂ¦Р В Р’В°Р РЋРІР‚РЋР В Р’В°Р В Р’В»Р В Р’В° Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р РЋР РЏР В Р’ВµР В РЎВ Р В Р вЂ Р РЋР С“Р В Р’Вµ Р В РўвЂР В Р вЂ Р В РЎвЂР В Р’В¶Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ Р В РЎвЂ”Р В РЎвЂў Р РЋР РЉР РЋРІР‚С™Р В РЎвЂўР В РЎВР РЋРЎвЂњ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР РЋРЎвЂњ
    await prisma.stockMovement.deleteMany({
      where: { itemId: id },
    });

    // Р В РЎСџР В РЎвЂўР РЋРІР‚С™Р В РЎвЂўР В РЎВ Р РЋР С“Р В Р’В°Р В РЎВ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљ
    await prisma.item.delete({
      where: { id },
    });

    return res.json({ message: "Р В РЎС›Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљ Р В РЎвЂ Р В Р вЂ Р РЋР С“Р В Р’Вµ Р В РўвЂР В Р вЂ Р В РЎвЂР В Р’В¶Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ Р В РЎвЂ”Р В РЎвЂў Р В Р вЂ¦Р В Р’ВµР В РЎВР РЋРЎвЂњ Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р В Р’ВµР В Р вЂ¦Р РЋРІР‚в„–" });
  } catch (err) {
    console.error("delete item error:", err);
    return res
      .status(500)
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В РЎвЂ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В°" });
  }
});

// ===== Р В Р Р‹Р В РЎв„ўР В РІР‚С”Р В РЎвЂ™Р В РІР‚Сњ: Р В РІР‚С”Р В РЎвЂєР В РЎв„ўР В РЎвЂ™Р В Р’В¦Р В Р’ВР В Р’В =====
app.get("/api/warehouse/locations", auth, async (req, res) => {
  try {
    const locations = await prisma.warehouseLocation.findMany({
      orderBy: { id: "asc" },
    });
    res.json(locations);
  } catch (err) {
    console.error("list locations error:", err);
    res.status(500).json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР В Р’Вµ Р В Р’В»Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РІвЂћвЂ“" });
  }
});

app.post("/api/warehouse/locations", auth, async (req, res) => {
  try {
    const { name, zone, aisle, rack, level } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’В°Р В Р’В·Р В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В Р’В»Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ Р В РЎвЂўР В Р’В±Р РЋР РЏР В Р’В·Р В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В РЎвЂў" });
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
      return res.status(400).json({ message: "Р В РЎв„ўР В РЎвЂўР В РўвЂ Р В Р’В»Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В РЎвЂР РЋР С“Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р РЋРЎвЂњР В Р’ВµР РЋРІР‚С™Р РЋР С“Р РЋР РЏ" });
    }
    res.status(500).json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋР С“Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р В Р вЂ¦Р В РЎвЂР В РЎвЂ Р В Р’В»Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ" });
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
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ ID Р В Р’В»Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ" });
    }
    const existing = await prisma.warehouseLocation.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: "Р В РІР‚С”Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦Р В Р’В°" });
    }
    await prisma.warehouseLocation.delete({ where: { id } });
    res.json({ message: "Р В РІР‚С”Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р В Р’ВµР В Р вЂ¦Р В Р’В°" });
  } catch (err) {
    console.error("delete location error:", err);
    res.status(500).json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В РЎвЂ Р В Р’В»Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ" });
  }
});

// ===== Р В РЎв„ўР В РЎвЂєР В РІР‚СњР В Р’В«: Р В РЎС›Р В РЎвЂєР В РІР‚в„ўР В РЎвЂ™Р В Р’В Р В Р’В« =====
app.post("/api/warehouse/products/:id/codes", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { type, mode = "auto", value, force = false } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ ID Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В°" });
    }
    if (!["barcode", "qr", "both"].includes(type)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р РЋРІР‚С™Р В РЎвЂР В РЎвЂ” Р В РЎвЂќР В РЎвЂўР В РўвЂР В Р’В°" });
    }

    const item = await prisma.item.findUnique({ where: { id } });
    if (item && item.category === "TMC") {
      return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    }
    if (!item) {
      return res.status(404).json({ message: "Р В РЎС›Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљ Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦" });
    }

    const next = { barcode: item.barcode, qrCode: item.qrCode };
    const manualValue = value ? String(value).trim() : "";

    if ((type === "barcode" || type === "both") && next.barcode && !force) {
      return res.status(400).json({ message: "Р В Р РѓР РЋРІР‚С™Р РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂќР В РЎвЂўР В РўвЂ Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р В Р вЂ¦, Р В РЎвЂР РЋР С“Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р РЋРЎвЂњР В РІвЂћвЂ“Р РЋРІР‚С™Р В Р’Вµ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В Р вЂ Р РЋРІР‚в„–Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќ" });
    }
    if ((type === "qr" || type === "both") && next.qrCode && !force) {
      return res.status(400).json({ message: "QR Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р В Р вЂ¦, Р В РЎвЂР РЋР С“Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р РЋРЎвЂњР В РІвЂћвЂ“Р РЋРІР‚С™Р В Р’Вµ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В Р вЂ Р РЋРІР‚в„–Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќ" });
    }

    if (type === "barcode" || type === "both") {
      if (mode === "manual") {
        if (!manualValue) return res.status(400).json({ message: "Р В Р в‚¬Р В РЎвЂќР В Р’В°Р В Р’В¶Р В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р В Р’В·Р В Р вЂ¦Р В Р’В°Р РЋРІР‚РЋР В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В РЎвЂќР В РЎвЂўР В РўвЂР В Р’В°" });
        next.barcode = manualValue;
      } else {
        next.barcode = buildProductCode(item);
      }
    }

    if (type === "qr" || type === "both") {
      if (mode === "manual") {
        if (!manualValue) return res.status(400).json({ message: "Р В Р в‚¬Р В РЎвЂќР В Р’В°Р В Р’В¶Р В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р В Р’В·Р В Р вЂ¦Р В Р’В°Р РЋРІР‚РЋР В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В РЎвЂќР В РЎвЂўР В РўвЂР В Р’В°" });
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
    res.status(400).json({ message: err.message || "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р В РЎвЂ“Р В Р’ВµР В Р вЂ¦Р В Р’ВµР РЋР вЂљР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ Р В РЎвЂќР В РЎвЂўР В РўвЂР В Р’В°" });
  }
});

// ===== Р В РЎв„ўР В РЎвЂєР В РІР‚СњР В Р’В«: Р В РІР‚С”Р В РЎвЂєР В РЎв„ўР В РЎвЂ™Р В Р’В¦Р В Р’ВР В Р’В =====
app.post("/api/warehouse/locations/:id/codes", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { type, mode = "auto", value, force = false } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ ID Р В Р’В»Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ" });
    }
    if (!["barcode", "qr", "both"].includes(type)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р РЋРІР‚С™Р В РЎвЂР В РЎвЂ” Р В РЎвЂќР В РЎвЂўР В РўвЂР В Р’В°" });
    }

    const location = await prisma.warehouseLocation.findUnique({ where: { id } });
    if (!location) {
      return res.status(404).json({ message: "Р В РІР‚С”Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦Р В Р’В°" });
    }

    const next = { code: location.code, qrCode: location.qrCode };
    const manualValue = value ? String(value).trim() : "";

    if ((type === "barcode" || type === "both") && next.code && !force) {
      return res.status(400).json({ message: "Р В РЎв„ўР В РЎвЂўР В РўвЂ Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р В Р вЂ¦, Р В РЎвЂР РЋР С“Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р РЋРЎвЂњР В РІвЂћвЂ“Р РЋРІР‚С™Р В Р’Вµ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В Р вЂ Р РЋРІР‚в„–Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќ" });
    }
    if ((type === "qr" || type === "both") && next.qrCode && !force) {
      return res.status(400).json({ message: "QR Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р В Р вЂ¦, Р В РЎвЂР РЋР С“Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р РЋРЎвЂњР В РІвЂћвЂ“Р РЋРІР‚С™Р В Р’Вµ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В Р вЂ Р РЋРІР‚в„–Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќ" });
    }

    if (type === "barcode" || type === "both") {
      if (mode === "manual") {
        if (!manualValue) return res.status(400).json({ message: "Р В Р в‚¬Р В РЎвЂќР В Р’В°Р В Р’В¶Р В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р В Р’В·Р В Р вЂ¦Р В Р’В°Р РЋРІР‚РЋР В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В РЎвЂќР В РЎвЂўР В РўвЂР В Р’В°" });
        next.code = manualValue;
      } else {
        next.code = buildLocationCode(location);
      }
    }

    if (type === "qr" || type === "both") {
      if (mode === "manual") {
        if (!manualValue) return res.status(400).json({ message: "Р В Р в‚¬Р В РЎвЂќР В Р’В°Р В Р’В¶Р В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р В Р’В·Р В Р вЂ¦Р В Р’В°Р РЋРІР‚РЋР В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В РЎвЂќР В РЎвЂўР В РўвЂР В Р’В°" });
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
    res.status(400).json({ message: err.message || "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р В РЎвЂ“Р В Р’ВµР В Р вЂ¦Р В Р’ВµР РЋР вЂљР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ Р В РЎвЂќР В РЎвЂўР В РўвЂР В Р’В°" });
  }
});

// ===== QR: Р В РЎС›Р В РЎвЂєР В РІР‚в„ўР В РЎвЂ™Р В Р’В Р В Р’В« =====
app.post("/api/warehouse/products/:id/qr", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { force = false } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ ID Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В°" });
    }
    const item = await prisma.item.findUnique({ where: { id } });
    if (item && item.category === "TMC") {
      return res.status(404).json({ message: "ITEM_NOT_FOUND" });
    }
    if (!item) {
      return res.status(404).json({ message: "Р В РЎС›Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљ Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦" });
    }
    if (item.qrCode && !force) {
      return res.status(400).json({ message: "QR Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р В Р вЂ¦, Р В РЎвЂР РЋР С“Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В Р’В·Р РЋРЎвЂњР В РІвЂћвЂ“Р РЋРІР‚С™Р В Р’Вµ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В Р вЂ Р РЋРІР‚в„–Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќ" });
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
    res.status(400).json({ message: err.message || "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р В РЎвЂ“Р В Р’ВµР В Р вЂ¦Р В Р’ВµР РЋР вЂљР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ QR" });
  }
});

// ===== QR: Р В РІР‚С”Р В РЎвЂєР В РЎв„ўР В РЎвЂ™Р В Р’В¦Р В Р’ВР В Р’В =====
app.post("/api/warehouse/locations/:id/qr", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { force = false } = req.body || {};
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ ID Р В Р’В»Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ" });
    }
    const location = await prisma.warehouseLocation.findUnique({ where: { id } });
    if (!location) {
      return res.status(404).json({ message: "Р В РІР‚С”Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦Р В Р’В°" });
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
    res.status(400).json({ message: err.message || "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р В РЎвЂ“Р В Р’ВµР В Р вЂ¦Р В Р’ВµР РЋР вЂљР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ QR" });
  }
});

// ===== Р В Р’В Р В РІР‚СћР В РІР‚вЂќР В РЎвЂєР В РІР‚С”Р В РІР‚в„ў Р В Р Р‹Р В РЎв„ўР В РЎвЂ™Р В РЎСљР В РЎвЂ™ =====
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
  { name: "Бумага А4", unit: "пачка" },
  { name: "Ручки шариковые", unit: "шт" },
  { name: "Маркер перманентный", unit: "шт" },
  { name: "Скотч прозрачный", unit: "рулон" },
  { name: "Стретч-плёнка", unit: "рулон" },
  { name: "Перчатки рабочие", unit: "пара" },
  { name: "Салфетки", unit: "уп" },
  { name: "Мешки для мусора", unit: "уп" },
  { name: "Картридж", unit: "шт" },
  { name: "Клейкая лента", unit: "рулон" },
  { name: "Этикетки", unit: "рулон" },
  { name: "Нож канцелярский", unit: "шт" },
  { name: "Скотч армированный", unit: "рулон" },
  { name: "Пакеты зип", unit: "уп" },
  { name: "Маркировочные наклейки", unit: "уп" },
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
    const note = docNo ? `Приход ТМЦ: ${docNo}` : "Приход ТМЦ";
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
    const note = target ? `Выдача ТМЦ: ${target}` : "Выдача ТМЦ";
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
    if (!["ADMIN", "EMPLOYEE"].includes(req.user?.role)) {
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

// ===== TSD: INVENTORY COUNT (CREATE DISCREPANCY ONLY) =====
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
    let discrepancyId = null;

    await prisma.$transaction(async (tx) => {
      const current = await stockService.getItemLocationQty(tx, item, location);
      delta = normalizedQty - current;

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
        } else {
          discrepancyId = existing.id;
        }
      }
    });

    res.json({ locationId: location, itemId: item, qty: normalizedQty, delta, discrepancyId });
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
      "Приемка (ТСД)",
      `ячейка=${locationId}`,
      supplierName ? `поставщик=${String(supplierName).trim()}` : "",
      docNo ? `док=${String(docNo).trim()}` : "",
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

      const moveComment = comment || `Перемещение (ТСД) ${from} → ${to}`;

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

      const moveComment = comment || `Размещение (ТСД) ${from} → ${to}`;

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

    const pickComment = comment || `Отбор (ТСД) из ${from}`;
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

      const replComment = comment || `Пополнение (ТСД) ${from} → ${to}`;

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


// ===== Р В Р’В Р В РІР‚СћР В РЎСљР В РІР‚СњР В РІР‚СћР В Р’В  QR =====
app.get("/api/warehouse/qr/render", async (req, res) => {
  try {
    const value = String(req.query.value || "").trim();
    if (!value) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ Р В РЎвЂ”Р В Р’В°Р РЋР вЂљР В Р’В°Р В РЎВР В Р’ВµР РЋРІР‚С™Р РЋР вЂљР РЋРІР‚в„–" });
    }
    const buffer = await renderQrPng(value);
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  } catch (err) {
    console.error("render code error:", err);
    res.status(500).json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р В РЎвЂ“Р В Р’ВµР В Р вЂ¦Р В Р’ВµР РЋР вЂљР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ Р В РЎвЂР В Р’В·Р В РЎвЂўР В Р’В±Р РЋР вЂљР В Р’В°Р В Р’В¶Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ" });
  }
});

// ===== Р В РЎСџР В РІР‚СћР В Р’В§Р В РЎвЂ™Р В РЎС›Р В Р’В¬ QR =====
app.post("/api/warehouse/qr/print", auth, async (req, res) => {
  try {
    const { kind, id, qty = 1, layout = "A4" } = req.body || {};
    if (!id || !["product", "location"].includes(kind)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ Р В РЎвЂ”Р В Р’В°Р РЋР вЂљР В Р’В°Р В РЎВР В Р’ВµР РЋРІР‚С™Р РЋР вЂљР РЋРІР‚в„– Р В РЎвЂ”Р В Р’ВµР РЋРІР‚РЋР В Р’В°Р РЋРІР‚С™Р В РЎвЂ" });
    }
    const count = Math.max(1, Number(qty || 1));
    let title = "";
    let subtitle = "";
    let qrValue = "";
    if (kind === "product") {
      const item = await prisma.item.findUnique({ where: { id: Number(id) } });
      if (!item) return res.status(404).json({ message: "Р В РЎС›Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљ Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦" });
      title = item.name;
      subtitle = item.sku ? `SKU: ${item.sku}` : "";
      qrValue = item.qrCode || `BP:PRODUCT:${item.id}`;
    } else {
      const location = await prisma.warehouseLocation.findUnique({ where: { id: Number(id) } });
      if (!location) return res.status(404).json({ message: "Р В РІР‚С”Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦Р В Р’В°" });
      title = `Р В РІР‚С”Р В РЎвЂєР В РЎв„ўР В РЎвЂ™Р В Р’В¦Р В Р’ВР В Р вЂЎ: ${location.name}`;
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
          <title>QR Р В РЎвЂ”Р В Р’ВµР РЋРІР‚РЋР В Р’В°Р РЋРІР‚С™Р РЋР Р‰</title>
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
    res.status(500).json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р В РЎвЂ”Р В Р’ВµР РЋРІР‚РЋР В Р’В°Р РЋРІР‚С™Р В РЎвЂ QR" });
  }
});

// ===== Р В Р’В Р В РЎвЂ™Р В РІР‚вЂќР В РЎС™Р В РІР‚СћР В Р’В©Р В РІР‚СћР В РЎСљР В Р’ВР В Р вЂЎ =====
app.post("/api/warehouse/placements", auth, async (req, res) => {
  try {
    const { itemId, locationId, qty } = req.body || {};
    const item = Number(itemId);
    const location = Number(locationId);
    const amount = Number(qty);
    if (!item || !location || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ Р В РўвЂР В Р’В°Р В Р вЂ¦Р В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ Р РЋР вЂљР В Р’В°Р В Р’В·Р В РЎВР В Р’ВµР РЋРІР‚В°Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ" });
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
    res.status(500).json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋР вЂљР В Р’В°Р В Р’В·Р В РЎВР В Р’ВµР РЋРІР‚В°Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В РЎвЂ" });
  }
});

app.get("/api/warehouse/products/:id/placements", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ ID Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В°" });
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
    res.status(500).json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР В Р’Вµ Р РЋР вЂљР В Р’В°Р В Р’В·Р В РЎВР В Р’ВµР РЋРІР‚В°Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В РІвЂћвЂ“" });
  }
});

app.put("/api/warehouse/placements/pick", auth, async (req, res) => {
  try {
    const { itemId, locationId, qty } = req.body || {};
    const item = Number(itemId);
    const location = Number(locationId);
    const amount = Number(qty);
    if (!item || !location || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ Р В РўвЂР В Р’В°Р В Р вЂ¦Р В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ Р В РЎвЂўР РЋРІР‚С™Р В Р’В±Р В РЎвЂўР РЋР вЂљР В Р’В°" });
    }

    const existing = await prisma.warehousePlacement.findUnique({
      where: { itemId_locationId: { itemId: item, locationId: location } },
    });
    if (!existing || existing.qty < amount) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РўвЂР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂўР РЋРІР‚РЋР В Р вЂ¦Р В РЎвЂў Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В° Р В Р вЂ  Р В Р’В»Р В РЎвЂўР В РЎвЂќР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ" });
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
    res.status(500).json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В РЎвЂўР РЋРІР‚С™Р В Р’В±Р В РЎвЂўР РЋР вЂљР В Р’Вµ" });
  }
});

// ===== Р В РЎСџР В РІР‚СћР В Р’В§Р В РЎвЂ™Р В РЎС›Р В Р’В¬ Р В Р’В­Р В РЎС›Р В Р’ВР В РЎв„ўР В РІР‚СћР В РЎС›Р В РЎвЂєР В РЎв„ў =====
app.post("/api/warehouse/labels/print", auth, async (req, res) => {
  try {
    const { items = [], format = "A4", labelSize = "58x40" } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Р В Р Р‹Р В РЎвЂ”Р В РЎвЂР РЋР С“Р В РЎвЂўР В РЎвЂќ Р РЋР РЉР РЋРІР‚С™Р В РЎвЂР В РЎвЂќР В Р’ВµР РЋРІР‚С™Р В РЎвЂўР В РЎвЂќ Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р РЋРІР‚С™" });
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
          <title>Р В Р’В­Р РЋРІР‚С™Р В РЎвЂР В РЎвЂќР В Р’ВµР РЋРІР‚С™Р В РЎвЂќР В РЎвЂ</title>
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
                      <div class="print-date">Р В РЎСџР В Р’ВµР РЋРІР‚РЋР В Р’В°Р РЋРІР‚С™Р РЋР Р‰: ${new Date().toLocaleDateString("ru-RU")}</div>
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
                    <div class="print-date">Р В РЎСџР В Р’ВµР РЋРІР‚РЋР В Р’В°Р РЋРІР‚С™Р РЋР Р‰: ${new Date().toLocaleDateString("ru-RU")}</div>
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
    res.status(500).json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р В РЎвЂ“Р В Р’ВµР В Р вЂ¦Р В Р’ВµР РЋР вЂљР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ Р РЋР РЉР РЋРІР‚С™Р В РЎвЂР В РЎвЂќР В Р’ВµР РЋРІР‚С™Р В РЎвЂўР В РЎвЂќ" });
  }
});

// Р В Р Р‹Р В РЎвЂ”Р В РЎвЂР РЋР С“Р В РЎвЂўР В РЎвЂќ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В РЎвЂўР В Р вЂ  Р РЋР С“ Р РЋРІР‚С™Р В Р’ВµР В РЎвЂќР РЋРЎвЂњР РЋРІР‚В°Р В РЎвЂР В РЎВР В РЎвЂ Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂќР В Р’В°Р В РЎВР В РЎвЂ
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋР вЂљР В Р’В°Р РЋР С“Р РЋРІР‚РЋР РЋРІР‚ВР РЋРІР‚С™Р В Р’Вµ Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂќР В РЎвЂўР В Р вЂ " });
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

// Р В РІР‚СљР В РЎвЂўР РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В· Р В РЎвЂ”Р В РЎвЂў Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В°Р В РЎВ Р В Р вЂ¦Р В РЎвЂР В Р’В¶Р В Р’Вµ Р В РЎВР В РЎвЂР В Р вЂ¦Р В РЎвЂР В РЎВР В Р’В°Р В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В РЎвЂўР В РЎвЂ“Р В РЎвЂў Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂќР В Р’В° (Excel .xlsx)
app.get("/api/inventory/low-stock-order-file", auth, async (req, res) => {
  try {
    // 1. Р В РІР‚ВР В Р’ВµР РЋР вЂљР РЋРІР‚ВР В РЎВ Р В Р вЂ Р РЋР С“Р В Р’Вµ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР РЋРІР‚в„– Р РЋР С“ Р В РўвЂР В Р вЂ Р В РЎвЂР В Р’В¶Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏР В РЎВР В РЎвЂ
    const items = await prisma.item.findMany({
      where: { category: "STOCK" },
      orderBy: { name: "asc" },
      include: { movements: true },
    });

    const lowItems = [];

    for (const item of items) {
      // Р РЋР С“Р РЋРІР‚РЋР В РЎвЂР РЋРІР‚С™Р В Р’В°Р В Р’ВµР В РЎВ Р РЋРІР‚С™Р В Р’ВµР В РЎвЂќР РЋРЎвЂњР РЋРІР‚В°Р В РЎвЂР В РІвЂћвЂ“ Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂўР В РЎвЂќ Р РЋРІР‚С™Р В Р’В°Р В РЎвЂќ Р В Р’В¶Р В Р’Вµ, Р В РЎвЂќР В Р’В°Р В РЎвЂќ Р В Р вЂ  /api/inventory/stock
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

      // Р В РІР‚С”Р В РЎвЂўР В РЎвЂ“Р В РЎвЂР В РЎвЂќР В Р’В° "Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљ Р В РЎвЂќ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р РЋРЎвЂњ" Р В РўвЂР В Р’ВµР В Р’В»Р В Р’В°Р В Р’ВµР В РЎВ Р РЋРІР‚С™Р В Р’В°Р В РЎвЂќР В РЎвЂўР В РІвЂћвЂ“ Р В Р’В¶Р В Р’Вµ, Р В РЎвЂќР В Р’В°Р В РЎвЂќ Р В РЎвЂ”Р В РЎвЂўР В РўвЂР РЋР С“Р В Р вЂ Р В Р’ВµР РЋРІР‚С™Р В РЎвЂќР В Р’В° Р В Р вЂ  Р В РЎвЂР В Р вЂ¦Р РЋРІР‚С™Р В Р’ВµР РЋР вЂљР РЋРІР‚С›Р В Р’ВµР В РІвЂћвЂ“Р РЋР С“Р В Р’Вµ:
      // 1) Р В Р’ВµР РЋР С“Р В Р’В»Р В РЎвЂ Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂўР В РЎвЂќ <= 0 Р В РЎвЂ Р В Р’ВµР РЋР С“Р РЋРІР‚С™Р РЋР Р‰ min Р В РЎвЂР В Р’В»Р В РЎвЂ max
      // 2) Р В РЎвЂР В Р’В»Р В РЎвЂ Р В Р’ВµР РЋР С“Р В Р’В»Р В РЎвЂ Р В Р’ВµР РЋР С“Р РЋРІР‚С™Р РЋР Р‰ min Р В РЎвЂ Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂўР В РЎвЂќ < min
      const shouldOrder =
        (currentStock <= 0 && ((min != null && min > 0) || (max != null && max > 0))) ||
        (min != null && currentStock < min);

      if (!shouldOrder) continue;

      // Р В Р Р‹Р В РЎвЂќР В РЎвЂўР В Р’В»Р РЋР Р‰Р В РЎвЂќР В РЎвЂў Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р РЋРІР‚в„–Р В Р вЂ Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰:
      // - Р В Р’ВµР РЋР С“Р В Р’В»Р В РЎвЂ Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р В Р вЂ¦ min Р В РЎвЂ >0 Р Р†Р вЂљРІР‚Сњ Р В РўвЂР В РЎвЂўР В Р’В±Р В РЎвЂР В Р вЂ Р В Р’В°Р В Р’ВµР В РЎВ Р В РўвЂР В РЎвЂў min
      // - Р В РЎвЂР В Р вЂ¦Р В Р’В°Р РЋРІР‚РЋР В Р’Вµ, Р В Р’ВµР РЋР С“Р В Р’В»Р В РЎвЂ Р В Р’ВµР РЋР С“Р РЋРІР‚С™Р РЋР Р‰ max Р Р†Р вЂљРІР‚Сњ Р В РўвЂР В РЎвЂўР В Р’В±Р В РЎвЂР В Р вЂ Р В Р’В°Р В Р’ВµР В РЎВ Р В РўвЂР В РЎвЂў max
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
        .json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В РЎвЂўР В Р вЂ  Р В Р вЂ¦Р В РЎвЂР В Р’В¶Р В Р’Вµ Р В РЎВР В РЎвЂР В Р вЂ¦Р В РЎвЂР В РЎВР В Р’В°Р В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В РЎвЂўР В РЎвЂ“Р В РЎвЂў Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂќР В Р’В°" });
    }

    // 2. Р В Р Р‹Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р РЋРІР‚ВР В РЎВ Excel-Р В РЎвЂќР В Р вЂ¦Р В РЎвЂР В РЎвЂ“Р РЋРЎвЂњ Р В РЎвЂ Р В Р’В»Р В РЎвЂР РЋР С“Р РЋРІР‚С™
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Р В РІР‚вЂќР В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·");

    // Р В Р Р‹Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В Р’В° 1: Р В РІР‚вЂќР В Р’В°Р В РЎвЂ“Р В РЎвЂўР В Р’В»Р В РЎвЂўР В Р вЂ Р В РЎвЂўР В РЎвЂќ "Р В РІР‚вЂќР В РЎвЂ™Р В РЎв„ўР В РЎвЂ™Р В РІР‚вЂќ Р Р†РІР‚С›РІР‚вЂњ ____ Р В РЎвЂўР РЋРІР‚С™ [Р В РІР‚СњР В Р’В°Р РЋРІР‚С™Р В Р’В°]"
    const now = new Date();
    const dateStr = now.toLocaleDateString("ru-RU");
    worksheet.mergeCells("A1:F1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `Р В РІР‚вЂќР В РЎвЂ™Р В РЎв„ўР В РЎвЂ™Р В РІР‚вЂќ Р Р†РІР‚С›РІР‚вЂњ ____ Р В РЎвЂўР РЋРІР‚С™ ${dateStr}`;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };

    // Р В Р Р‹Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В Р’В° 2: Р В Р РѓР В Р’В°Р В РЎвЂ”Р В РЎвЂќР В Р’В° Р РЋРІР‚С™Р В Р’В°Р В Р’В±Р В Р’В»Р В РЎвЂР РЋРІР‚В Р РЋРІР‚в„–
    // Р В РЎв„ўР В РЎвЂўР В Р’В»Р В РЎвЂўР В Р вЂ¦Р В РЎвЂќР В РЎвЂ: Р Р†РІР‚С›РІР‚вЂњ, Р В РЎСљР В РЎвЂўР В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂќР В Р’В»Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР вЂљР В Р’В°, Р В РЎв„ўР В РЎвЂўР В Р’В»-Р В Р вЂ Р В РЎвЂў, Р В РІР‚СћР В РўвЂ., Р В Р’В¦Р В Р’ВµР В Р вЂ¦Р В Р’В° Р В Р’В·Р В Р’В° Р РЋРІвЂљВ¬Р РЋРІР‚С™, Р В Р Р‹Р РЋРЎвЂњР В РЎВР В РЎВР В Р’В°
    worksheet.getRow(2).values = ["Р Р†РІР‚С›РІР‚вЂњ", "Р В РЎСљР В РЎвЂўР В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂќР В Р’В»Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР вЂљР В Р’В°", "Р В РЎв„ўР В РЎвЂўР В Р’В»-Р В Р вЂ Р В РЎвЂў", "Р В РІР‚СћР В РўвЂ.", "Р В Р’В¦Р В Р’ВµР В Р вЂ¦Р В Р’В° Р В Р’В·Р В Р’В° Р РЋРІвЂљВ¬Р РЋРІР‚С™", "Р В Р Р‹Р РЋРЎвЂњР В РЎВР В РЎВР В Р’В°"];

    // Р В РЎСљР В Р’В°Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РІвЂћвЂ“Р В РЎвЂќР В Р’В° Р В РЎвЂќР В РЎвЂўР В Р’В»Р В РЎвЂўР В Р вЂ¦Р В РЎвЂўР В РЎвЂќ (Р РЋРІвЂљВ¬Р В РЎвЂР РЋР вЂљР В РЎвЂР В Р вЂ¦Р В Р’В°)
    worksheet.columns = [
      { key: "position", width: 8 },
      { key: "name", width: 40 },
      { key: "qty", width: 15 },
      { key: "unit", width: 10 },
      { key: "price", width: 15 },
      { key: "sum", width: 15 },
    ];

    // 4. Р В РІР‚вЂќР В Р’В°Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В Р вЂ¦Р РЋР РЏР В Р’ВµР В РЎВ Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В РЎвЂ Р В РўвЂР В Р’В°Р В Р вЂ¦Р В Р вЂ¦Р РЋРІР‚в„–Р В РЎВР В РЎвЂ
    const firstDataRow = 3; // Р В РўвЂР В Р’В°Р В Р вЂ¦Р В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р РЋРІР‚РЋР В РЎвЂР В Р вЂ¦Р В Р’В°Р РЋР вЂ№Р РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р РЋР С“ 3-Р В РІвЂћвЂ“ Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В РЎвЂ

    lowItems.forEach((it, index) => {
      const rowIndex = firstDataRow + index;
      const row = worksheet.getRow(rowIndex);

      row.values = [
        index + 1,          // A: Р Р†РІР‚С›РІР‚вЂњ
        it.name,            // B: Р В РЎСљР В РЎвЂўР В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂќР В Р’В»Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР вЂљР В Р’В°
        it.orderQty,        // C: Р В РЎв„ўР В РЎвЂўР В Р’В»-Р В Р вЂ Р В РЎвЂў
        it.unit || "Р РЋРІвЂљВ¬Р РЋРІР‚С™",    // D: Р В РІР‚СћР В РўвЂ.
        it.price ?? 0,      // E: Р В Р’В¦Р В Р’ВµР В Р вЂ¦Р В Р’В°
        // F: Р В Р Р‹Р РЋРЎвЂњР В РЎВР В РЎВР В Р’В° (Р РЋРІР‚С›Р В РЎвЂўР РЋР вЂљР В РЎВР РЋРЎвЂњР В Р’В»Р В Р’В°)
      ];

      // Р В Р’В¤Р В РЎвЂўР РЋР вЂљР В РЎВР РЋРЎвЂњР В Р’В»Р В Р’В° Р РЋР С“Р РЋРЎвЂњР В РЎВР В РЎВР РЋРІР‚в„–: C*E
      row.getCell(6).value = {
        formula: `C${rowIndex}*E${rowIndex}`,
      };
    });

    const lastDataRow = firstDataRow + lowItems.length - 1;

    // 5. Р В Р Р‹Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В Р’В° Р РЋР С“ Р В РЎвЂР РЋРІР‚С™Р В РЎвЂўР В РЎвЂ“Р В РЎвЂўР В РЎВ Р В РЎвЂ”Р В РЎвЂўР В РўвЂ Р РЋРІР‚С™Р В Р’В°Р В Р’В±Р В Р’В»Р В РЎвЂР РЋРІР‚В Р В Р’ВµР В РІвЂћвЂ“
    const totalRowIndex = lastDataRow + 1;
    const totalRow = worksheet.getRow(totalRowIndex);

    totalRow.getCell(5).value = "Р В Р’ВР В РЎС›Р В РЎвЂєР В РІР‚СљР В РЎвЂє:";
    totalRow.getCell(5).font = { bold: true };
    totalRow.getCell(5).alignment = { horizontal: "right", vertical: "middle" };

    // Р В Р Р‹Р РЋРЎвЂњР В РЎВР В РЎВР В Р’В° Р В РЎвЂ”Р В РЎвЂў Р РЋР С“Р РЋРІР‚С™Р В РЎвЂўР В Р’В»Р В Р’В±Р РЋРІР‚В Р РЋРЎвЂњ F
    totalRow.getCell(6).value = {
      formula: `SUM(F${firstDataRow}:F${lastDataRow})`,
    };
    totalRow.getCell(6).font = { bold: true };

    // 6. Р В РЎвЂєР РЋРІР‚С›Р В РЎвЂўР РЋР вЂљР В РЎВР В Р’В»Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В РЎвЂ“Р РЋР вЂљР В Р’В°Р В Р вЂ¦Р В РЎвЂР РЋРІР‚В  Р В РЎвЂ Р В Р вЂ Р РЋРІР‚в„–Р РЋР вЂљР В Р’В°Р В Р вЂ Р В Р вЂ¦Р В РЎвЂР В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’Вµ
    // Р В Р РѓР В Р’В°Р В РЎвЂ”Р В РЎвЂќР В Р’В° (Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В Р’В° 2)
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

    // Р В РІР‚СњР В Р’В°Р В Р вЂ¦Р В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ
    for (let r = firstDataRow; r <= lastDataRow; r++) {
      const row = worksheet.getRow(r);
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        // Р В РІР‚в„ўР РЋРІР‚в„–Р РЋР вЂљР В Р’В°Р В Р вЂ Р В Р вЂ¦Р В РЎвЂР В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’Вµ: Р РЋРІР‚С™Р В Р’ВµР В РЎвЂќР РЋР С“Р РЋРІР‚С™ Р РЋР С“Р В Р’В»Р В Р’ВµР В Р вЂ Р В Р’В°, Р РЋРІР‚РЋР В РЎвЂР РЋР С“Р В Р’В»Р В Р’В° Р РЋР С“Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ Р В Р’В°/Р РЋРІР‚В Р В Р’ВµР В Р вЂ¦Р РЋРІР‚С™Р РЋР вЂљ
        if (cell.col === 2) { // Р В РЎСљР В РЎвЂўР В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂќР В Р’В»Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР вЂљР В Р’В°
          cell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
        } else {
          cell.alignment = { horizontal: "center", vertical: "middle" };
        }
      });
    }

    // Р В Р’ВР РЋРІР‚С™Р В РЎвЂўР В РЎвЂ“Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР РЏ Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В Р’В° (Р В РЎвЂ“Р РЋР вЂљР В Р’В°Р В Р вЂ¦Р В РЎвЂР РЋРІР‚В Р РЋРІР‚в„– Р В РўвЂР В Р’В»Р РЋР РЏ Р РЋР С“Р РЋРЎвЂњР В РЎВР В РЎВР РЋРІР‚в„–)
    totalRow.getCell(6).border = {
      top: { style: "thin" },
      left: { style: "thin" },
      bottom: { style: "thin" },
      right: { style: "thin" },
    };

    // 7. Р В РЎвЂєР РЋРІР‚С™Р В РўвЂР В Р’В°Р РЋРІР‚ВР В РЎВ Р РЋРІР‚С›Р В Р’В°Р В РІвЂћвЂ“Р В Р’В»
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋРІР‚С›Р В РЎвЂўР РЋР вЂљР В РЎВР В РЎвЂР РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°" });
  }
});

// Р В Р’ВР В РЎВР В РЎвЂ”Р В РЎвЂўР РЋР вЂљР РЋРІР‚С™ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В РЎвЂўР В Р вЂ  Р В РЎвЂР В Р’В· Excel (Р РЋРІвЂљВ¬Р В Р’В°Р В Р’В±Р В Р’В»Р В РЎвЂўР В Р вЂ¦ "Р В Р’ВР В РЎВР В РЎвЂ”Р В РЎвЂўР РЋР вЂљР РЋРІР‚С™.xlsx")
app.post(
  "/api/inventory/items/import",
  auth,
  upload.single("file"), // Р В Р’В¶Р В РўвЂР РЋРІР‚ВР В РЎВ Р РЋРІР‚С›Р В Р’В°Р В РІвЂћвЂ“Р В Р’В» Р В Р вЂ  Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В Р’Вµ "file"
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ message: "Р В Р’В¤Р В Р’В°Р В РІвЂћвЂ“Р В Р’В» Р В Р вЂ¦Р В Р’Вµ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В РўвЂР В Р’В°Р В Р вЂ¦" });
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        return res
          .status(400)
          .json({ message: "Р В РЎСљР В Р’Вµ Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р В РЎвЂўР РЋР С“Р РЋР Р‰ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР РЋРІР‚РЋР В РЎвЂР РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р вЂ Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р В Р’В»Р В РЎвЂР РЋР С“Р РЋРІР‚С™ Р РЋРІР‚С›Р В Р’В°Р В РІвЂћвЂ“Р В Р’В»Р В Р’В°" });
      }

      // Р В РЎСџР РЋР вЂљР В Р’ВµР В РўвЂР В РЎвЂ”Р В РЎвЂўР В Р’В»Р В Р’В°Р В РЎвЂ“Р В Р’В°Р В Р’ВµР В РЎВ Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР РЋРЎвЂњР В РЎвЂќР РЋРІР‚С™Р РЋРЎвЂњР РЋР вЂљР РЋРЎвЂњ Р РЋРІР‚С›Р В Р’В°Р В РІвЂћвЂ“Р В Р’В»Р В Р’В° "Р В Р’ВР В РЎВР В РЎвЂ”Р В РЎвЂўР РЋР вЂљР РЋРІР‚С™.xlsx":
      // 1-Р РЋР РЏ Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В Р’В° Р Р†Р вЂљРІР‚Сњ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р В РЎвЂўР В Р’В»Р В РЎвЂўР В Р вЂ Р В РЎвЂќР В РЎвЂ, Р В РўвЂР В Р’В°Р В Р’В»Р РЋР Р‰Р РЋРІвЂљВ¬Р В Р’Вµ Р Р†Р вЂљРІР‚Сњ Р В РўвЂР В Р’В°Р В Р вЂ¦Р В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ
      // A: Р В РЎСљР В Р’В°Р В РЎвЂР В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂўР В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’Вµ
      // B: Р В РЎвЂ™Р РЋР вЂљР РЋРІР‚С™Р В РЎвЂР В РЎвЂќР РЋРЎвЂњР В Р’В» (SKU)
      // C: Р В Р РѓР РЋРІР‚С™Р РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂќР В РЎвЂўР В РўвЂ
      // D: Р В РІР‚СћР В РўвЂ. Р В РЎвЂР В Р’В·Р В РЎВ.
      // E: Р В РЎС™Р В РЎвЂР В Р вЂ¦. Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂўР В РЎвЂќ
      // F: Р В РЎС™Р В Р’В°Р В РЎвЂќР РЋР С“. Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂўР В РЎвЂќ
      // G: Р В Р’В¦Р В Р’ВµР В Р вЂ¦Р В Р’В° Р В Р’В·Р В Р’В° Р В Р’ВµР В РўвЂР В РЎвЂР В Р вЂ¦Р В РЎвЂР РЋРІР‚В Р РЋРЎвЂњ
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

        // Р В Р’В§Р В РЎвЂР РЋР С“Р В Р’В»Р В РЎвЂўР В Р вЂ Р РЋРІР‚в„–Р В Р’Вµ Р В Р’В·Р В Р вЂ¦Р В Р’В°Р РЋРІР‚РЋР В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ
        // F=6 (Min), I=9 (Max), J=10 (Price)
        let minStock = Math.round(toNumber(row.getCell(6).value));
        let maxStock = Math.round(toNumber(row.getCell(9).value));
        let defaultPrice = toNumber(row.getCell(10).value);

        console.log(`Row ${rowNumber}: SKU=${sku}, Min=${minStock}, Max=${maxStock}, Price=${defaultPrice}`);

        // Р В РІР‚СћР РЋР С“Р В Р’В»Р В РЎвЂ Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В Р’В° Р РЋР С“Р В РЎвЂўР В Р вЂ Р РЋР С“Р В Р’ВµР В РЎВ Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋР РЏ Р Р†Р вЂљРІР‚Сњ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќР В Р’В°Р В Р’ВµР В РЎВ
        if (!name && !sku && !barcode) {
          skipped++;
          continue;
        }

        // Р В РІР‚ВР В Р’ВµР В Р’В· Р В РЎвЂР В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂ Р В РЎвЂР В Р’В»Р В РЎвЂ SKU Р Р†Р вЂљРІР‚Сњ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќР В Р’В°Р В Р’ВµР В РЎВ (Р В РЎвЂќР В Р’В°Р В РЎвЂќ Р В РЎвЂ Р В Р вЂ  API Р РЋР С“Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р В Р вЂ¦Р В РЎвЂР РЋР РЏ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В Р’В°)
        if (!name || !sku) {
          skipped++;
          continue;
        }

        // Р В РЎСљР В РЎвЂўР РЋР вЂљР В РЎВР В Р’В°Р В Р’В»Р В РЎвЂР В Р’В·Р РЋРЎвЂњР В Р’ВµР В РЎВ: Р В Р вЂ¦Р В Р’Вµ Р В РўвЂР В РЎвЂўР В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќР В Р’В°Р В Р’ВµР В РЎВ Р В РЎвЂўР РЋРІР‚С™Р РЋР вЂљР В РЎвЂР РЋРІР‚В Р В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р РЋРІР‚в„–Р РЋРІР‚В¦
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
          // Р В Р’ВР РЋРІР‚В°Р В Р’ВµР В РЎВ Р В РЎвЂ”Р В РЎвЂў SKU (Р В РЎвЂўР В Р вЂ¦ Р РЋРЎвЂњ Р РЋРІР‚С™Р В Р’ВµР В Р’В±Р РЋР РЏ Р РЋРЎвЂњР В Р вЂ¦Р В РЎвЂР В РЎвЂќР В Р’В°Р В Р’В»Р РЋР Р‰Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“)
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
            "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В РЎвЂР В РЎВР В РЎвЂ”Р В РЎвЂўР РЋР вЂљР РЋРІР‚С™Р В Р’Вµ Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В РЎвЂ",
            rowNumber,
            err
          );
          skipped++;
        }
      }

      return res.json({
        message: "Р В Р’ВР В РЎВР В РЎвЂ”Р В РЎвЂўР РЋР вЂљР РЋРІР‚С™ Р В Р’В·Р В Р’В°Р В Р вЂ Р В Р’ВµР РЋР вЂљР РЋРІвЂљВ¬Р РЋРІР‚ВР В Р вЂ¦",
        created,
        updated,
        skipped,
      });
    } catch (err) {
      console.error("import file error:", err);
      res.status(500).json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В РЎвЂР В РЎВР В РЎвЂ”Р В РЎвЂўР РЋР вЂљР РЋРІР‚С™Р В Р’Вµ Р РЋРІР‚С›Р В Р’В°Р В РІвЂћвЂ“Р В Р’В»Р В Р’В°" });
    }
  }
);

// Р В РЎСџР В Р’В°Р В РЎвЂќР В Р’ВµР РЋРІР‚С™Р В Р вЂ¦Р В РЎвЂўР В Р’Вµ Р РЋР С“Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’Вµ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР В РЎвЂўР В Р вЂ  (JSON) Р Р†Р вЂљРІР‚Сњ Р В РўвЂР В Р’В»Р РЋР РЏ ImportItemsModal
app.post("/api/inventory/items/batch", auth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ message: "Р В РЎвЂєР В Р’В¶Р В РЎвЂР В РўвЂР В Р’В°Р В Р’ВµР РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р В РЎВР В Р’В°Р РЋР С“Р РЋР С“Р В РЎвЂР В Р вЂ  items" });
    }

    let created = 0;
    let updated = 0;
    let errors = [];

    for (const item of items) {
      // Р В РІР‚в„ўР В Р’В°Р В Р’В»Р В РЎвЂР В РўвЂР В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ
      if (!item.name || !item.sku) {
        errors.push({ row: item.row, error: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂР В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂ Р В РЎвЂР В Р’В»Р В РЎвЂ SKU" });
        continue;
      }

      const data = {
        name: String(item.name).trim(),
        sku: String(item.sku).trim(),
        barcode: item.barcode ? String(item.barcode).trim() : null,
        unit: item.unit ? String(item.unit).trim() : "Р РЋРІвЂљВ¬Р РЋРІР‚С™",
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
        errors.push({ row: item.row, error: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р В РІР‚ВР В РІР‚Сњ (Р В Р вЂ Р В РЎвЂўР В Р’В·Р В РЎВР В РЎвЂўР В Р’В¶Р В Р вЂ¦Р В РЎвЂў Р В РўвЂР РЋРЎвЂњР В Р’В±Р В Р’В»Р РЋР Р‰)" });
      }
    }

    res.json({
      message: "Р В РЎСџР В Р’В°Р В РЎвЂќР В Р’ВµР РЋРІР‚С™Р В Р вЂ¦Р В Р’В°Р РЋР РЏ Р В РЎвЂўР В Р’В±Р РЋР вЂљР В Р’В°Р В Р’В±Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂќР В Р’В° Р В Р’В·Р В Р’В°Р В Р вЂ Р В Р’ВµР РЋР вЂљР РЋРІвЂљВ¬Р В Р’ВµР В Р вЂ¦Р В Р’В°",
      created,
      updated,
      errors,
    });
  } catch (err) {
    console.error("batch import error:", err);
    res.status(500).json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В РЎвЂ”Р В Р’В°Р В РЎвЂќР В Р’ВµР РЋРІР‚С™Р В Р вЂ¦Р В РЎвЂўР В РЎВ Р В РЎвЂР В РЎВР В РЎвЂ”Р В РЎвЂўР РЋР вЂљР РЋРІР‚С™Р В Р’Вµ" });
  }
});

// ====== Р В Р Р‹Р В РЎв„ўР В РІР‚С”Р В РЎвЂ™Р В РІР‚Сњ: Р В РўС’Р В РІР‚СћР В РІР‚С”Р В РЎСџР В РІР‚СћР В Р’В Р В Р’В« Р В РІР‚СњР В РІР‚С”Р В Р вЂЎ Р В РЎвЂєР В Р Р‹Р В РЎС›Р В РЎвЂ™Р В РЎС›Р В РЎв„ўР В РЎвЂєР В РІР‚в„ў ======

// Р РЋРІР‚С™Р В Р’ВµР В РЎвЂќР РЋРЎвЂњР РЋРІР‚В°Р В РЎвЂР В РІвЂћвЂ“ Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂўР В РЎвЂќ Р В РЎвЂ”Р В РЎвЂў Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР РЋРЎвЂњ
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
      // Р В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В РЎвЂР РЋР вЂљР В РЎвЂўР В Р вЂ Р В РЎвЂќР В Р’В° Р В РЎВР В РЎвЂўР В Р’В¶Р В Р’ВµР РЋРІР‚С™ Р В Р’В±Р РЋРІР‚в„–Р РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ Р В РЎвЂ”Р В Р’В»Р РЋР вЂ№Р РЋР С“, Р В РЎвЂ Р В РЎВР В РЎвЂР В Р вЂ¦Р РЋРЎвЂњР РЋР С“
      total += q;
    }
  }

  return total;
}

// Р РЋР вЂљР В Р’В°Р РЋР С“Р РЋРІР‚РЋР РЋРІР‚ВР РЋРІР‚С™, Р В РЎвЂќР В Р’В°Р В РЎвЂќР В РЎвЂўР В РІвЂћвЂ“ Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂўР В РЎвЂќ Р В Р’В±Р РЋРЎвЂњР В РўвЂР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р В Р’В»Р В Р’Вµ Р В РўвЂР В Р вЂ Р В РЎвЂР В Р’В¶Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ
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

// Р В Р Р‹Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р В РўвЂР В Р вЂ Р В РЎвЂР В Р’В¶Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ (Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂўР В РўвЂ / Р РЋР вЂљР В Р’В°Р РЋР С“Р РЋРІР‚В¦Р В РЎвЂўР В РўвЂ / Р В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В РЎвЂР РЋР вЂљР В РЎвЂўР В Р вЂ Р В РЎвЂќР В Р’В°) Р РЋР С“ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’ВµР РЋР вЂљР В РЎвЂќР В РЎвЂўР В РІвЂћвЂ“ Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂќР В Р’В°
app.post("/api/inventory/movements", auth, async (req, res) => {
  try {
    const { itemId, type, quantity, comment, pricePerUnit } = req.body;

    if (!itemId || !type || quantity === undefined) {
      return res
        .status(400)
        .json({ message: "Р В РЎСљР РЋРЎвЂњР В Р’В¶Р В Р вЂ¦Р В РЎвЂў Р РЋРЎвЂњР В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљ, Р РЋРІР‚С™Р В РЎвЂР В РЎвЂ” Р В РЎвЂ Р В РЎвЂќР В РЎвЂўР В Р’В»Р В РЎвЂР РЋРІР‚РЋР В Р’ВµР РЋР С“Р РЋРІР‚С™Р В Р вЂ Р В РЎвЂў" });
    }

    if (!["INCOME", "ISSUE", "ADJUSTMENT"].includes(type)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РўвЂР В РЎвЂўР В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р РЋРІР‚С™Р В РЎвЂР В РЎВР РЋРІР‚в„–Р В РІвЂћвЂ“ Р РЋРІР‚С™Р В РЎвЂР В РЎвЂ” Р В РўвЂР В Р вЂ Р В РЎвЂР В Р’В¶Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ" });
    }

    const itemIdNum = Number(itemId);
    const qtyNum = Number(quantity);

    // Р РЋРІР‚С™Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В РЎвЂќР В РЎвЂў Р РЋРІР‚В Р В Р’ВµР В Р’В»Р РЋРІР‚в„–Р В Р’Вµ Р РЋРІР‚РЋР В РЎвЂР РЋР С“Р В Р’В»Р В Р’В° Р В РЎвЂ Р В Р вЂ¦Р В Р’Вµ 0
    if (!Number.isFinite(qtyNum) || !Number.isInteger(qtyNum) || qtyNum === 0) {
      return res.status(400).json({
        message: "Р В РЎв„ўР В РЎвЂўР В Р’В»Р В РЎвЂР РЋРІР‚РЋР В Р’ВµР РЋР С“Р РЋРІР‚С™Р В Р вЂ Р В РЎвЂў Р В РўвЂР В РЎвЂўР В Р’В»Р В Р’В¶Р В Р вЂ¦Р В РЎвЂў Р В Р’В±Р РЋРІР‚в„–Р РЋРІР‚С™Р РЋР Р‰ Р В Р вЂ¦Р В Р’ВµР В Р вЂ¦Р РЋРЎвЂњР В Р’В»Р В Р’ВµР В Р вЂ Р РЋРІР‚в„–Р В РЎВ Р РЋРІР‚В Р В Р’ВµР В Р’В»Р РЋРІР‚в„–Р В РЎВ Р РЋРІР‚РЋР В РЎвЂР РЋР С“Р В Р’В»Р В РЎвЂўР В РЎВ",
      });
    }

    let normalizedQty = qtyNum;

    // Р В РўвЂР В Р’В»Р РЋР РЏ INCOME/ISSUE Р Р†Р вЂљРІР‚Сњ Р РЋРІР‚С™Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В РЎвЂќР В РЎвЂў Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В РЎвЂўР В Р’В¶Р В РЎвЂР РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ Р РЋРІР‚В Р В Р’ВµР В Р’В»Р РЋРІР‚в„–Р В Р’Вµ
    if (type === "INCOME" || type === "ISSUE") {
      if (qtyNum < 0) {
        return res.status(400).json({
          message:
            "Р В РІР‚СњР В Р’В»Р РЋР РЏ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂўР В РўвЂР В Р’В° Р В РЎвЂ Р РЋР вЂљР В Р’В°Р РЋР С“Р РЋРІР‚В¦Р В РЎвЂўР В РўвЂР В Р’В° Р В РЎвЂќР В РЎвЂўР В Р’В»Р В РЎвЂР РЋРІР‚РЋР В Р’ВµР РЋР С“Р РЋРІР‚С™Р В Р вЂ Р В РЎвЂў Р В РўвЂР В РЎвЂўР В Р’В»Р В Р’В¶Р В Р вЂ¦Р В РЎвЂў Р В Р’В±Р РЋРІР‚в„–Р РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В РЎвЂўР В Р’В¶Р В РЎвЂР РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р РЋРІР‚в„–Р В РЎВ Р РЋРІР‚В Р В Р’ВµР В Р’В»Р РЋРІР‚в„–Р В РЎВ Р РЋРІР‚РЋР В РЎвЂР РЋР С“Р В Р’В»Р В РЎвЂўР В РЎВ",
        });
      }
      normalizedQty = qtyNum; // > 0
    }

    // Р В РІР‚СњР В Р’В»Р РЋР РЏ Р В РЎСџР В Р’В Р В Р’ВР В РўС’Р В РЎвЂєР В РІР‚СњР В РЎвЂ™ Р В Р вЂ¦Р РЋРЎвЂњР В Р’В¶Р В Р вЂ¦Р В Р’В° Р РЋРІР‚В Р В Р’ВµР В Р вЂ¦Р В Р’В° Р В Р’В·Р В Р’В° Р В Р’ВµР В РўвЂР В РЎвЂР В Р вЂ¦Р В РЎвЂР РЋРІР‚В Р РЋРЎвЂњ
    let priceValue = null;
    if (type === "INCOME") {
      if (
        pricePerUnit === undefined ||
        pricePerUnit === null ||
        pricePerUnit === ""
      ) {
        return res
          .status(400)
          .json({ message: "Р В РІР‚СњР В Р’В»Р РЋР РЏ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂўР В РўвЂР В Р’В° Р В Р вЂ¦Р РЋРЎвЂњР В Р’В¶Р В Р вЂ¦Р В РЎвЂў Р РЋРЎвЂњР В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р РЋРІР‚В Р В Р’ВµР В Р вЂ¦Р РЋРЎвЂњ Р В Р’В·Р В Р’В° Р В Р’ВµР В РўвЂР В РЎвЂР В Р вЂ¦Р В РЎвЂР РЋРІР‚В Р РЋРЎвЂњ" });
      }

      const p = Number(String(pricePerUnit).replace(",", "."));

      if (!Number.isFinite(p) || p <= 0) {
        return res.status(400).json({
          message: "Р В Р’В¦Р В Р’ВµР В Р вЂ¦Р В Р’В° Р В Р’В·Р В Р’В° Р В Р’ВµР В РўвЂР В РЎвЂР В Р вЂ¦Р В РЎвЂР РЋРІР‚В Р РЋРЎвЂњ Р В РўвЂР В РЎвЂўР В Р’В»Р В Р’В¶Р В Р вЂ¦Р В Р’В° Р В Р’В±Р РЋРІР‚в„–Р РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р В РЎвЂўР В Р’В¶Р В РЎвЂР РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р РЋРІР‚в„–Р В РЎВ Р РЋРІР‚РЋР В РЎвЂР РЋР С“Р В Р’В»Р В РЎвЂўР В РЎВ",
        });
      }

      priceValue = p;
    }

    // ===== Р В РЎСџР В Р’В Р В РЎвЂєР В РІР‚в„ўР В РІР‚СћР В Р’В Р В РЎв„ўР В РЎвЂ™ Р В РЎвЂєР В Р Р‹Р В РЎС›Р В РЎвЂ™Р В РЎС›Р В РЎв„ўР В РЎвЂ™ Р В РЎСџР В РІР‚СћР В Р’В Р В РІР‚СћР В РІР‚Сњ Р В Р Р‹Р В РЎвЂєР В РІР‚вЂќР В РІР‚СњР В РЎвЂ™Р В РЎСљР В Р’ВР В РІР‚СћР В РЎС™ Р В РІР‚СњР В РІР‚в„ўР В Р’ВР В РІР‚вЂњР В РІР‚СћР В РЎСљР В Р’ВР В Р вЂЎ =====
    let stockInfo;
    try {
      stockInfo = await calculateStockAfterMovement(
        itemIdNum,
        type,
        normalizedQty
      );
    } catch (e) {
      if (e.code === "ITEM_NOT_FOUND") {
        return res.status(404).json({ message: "Р В РЎС›Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљ Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦" });
      }
      console.error("calculateStockAfterMovement error:", e);
      return res
        .status(500)
        .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋР вЂљР В Р’В°Р РЋР С“Р РЋРІР‚РЋР РЋРІР‚ВР РЋРІР‚С™Р В Р’Вµ Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂќР В Р’В° Р В РЎвЂ”Р В РЎвЂў Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљР РЋРЎвЂњ" });
    }

    if (stockInfo.newStock < 0) {
      return res.status(400).json({
        message: `Р В РЎСљР В Р’ВµР В РўвЂР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂўР РЋРІР‚РЋР В Р вЂ¦Р В РЎвЂў Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂќР В Р’В°. Р В РЎСљР В Р’В° Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР В Р’Вµ ${stockInfo.current} Р РЋРІвЂљВ¬Р РЋРІР‚С™., Р В Р вЂ Р РЋРІР‚в„– Р В РЎвЂ”Р РЋРІР‚в„–Р РЋРІР‚С™Р В Р’В°Р В Р’ВµР РЋРІР‚С™Р В Р’ВµР РЋР С“Р РЋР Р‰ Р РЋР С“Р В РЎвЂ”Р В РЎвЂР РЋР С“Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰ ${normalizedQty} Р РЋРІвЂљВ¬Р РЋРІР‚С™.`,
      });
    }
    // ===== Р В РЎв„ўР В РЎвЂєР В РЎСљР В РІР‚СћР В Р’В¦ Р В РЎСџР В Р’В Р В РЎвЂєР В РІР‚в„ўР В РІР‚СћР В Р’В Р В РЎв„ўР В Р’В Р В РЎвЂєР В Р Р‹Р В РЎС›Р В РЎвЂ™Р В РЎС›Р В РЎв„ўР В РЎвЂ™ =====

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
      message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋР С“Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р В Р вЂ¦Р В РЎвЂР В РЎвЂ Р В РўвЂР В Р вЂ Р В РЎвЂР В Р’В¶Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ Р В РЎвЂ”Р В РЎвЂў Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР РЋРЎвЂњ",
    });
  }
});

// Р В РІР‚вЂњР РЋРЎвЂњР РЋР вЂљР В Р вЂ¦Р В Р’В°Р В Р’В» Р В РўвЂР В Р вЂ Р В РЎвЂР В Р’В¶Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В РІвЂћвЂ“ Р В РЎвЂ”Р В РЎвЂў Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР РЋРЎвЂњ
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР В Р’Вµ Р В РўвЂР В Р вЂ Р В РЎвЂР В Р’В¶Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В РІвЂћвЂ“" });
  }
});

// ================== Р В РЎСџР В РЎвЂєР В Р Р‹Р В РЎС›Р В РЎвЂ™Р В РІР‚в„ўР В Р’В©Р В Р’ВР В РЎв„ўР В Р’В ==================

// Р В Р Р‹Р В РЎвЂ”Р В РЎвЂР РЋР С“Р В РЎвЂўР В РЎвЂќ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В РЎвЂўР В Р вЂ 
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР В Р’Вµ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В РЎвЂўР В Р вЂ " });
  }
});

// Р В Р Р‹Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В°
app.post("/api/suppliers", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ " });
    }

    const { name, inn, phone, email, comment } = req.body;

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ message: "Р В РЎСљР В Р’В°Р В Р’В·Р В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В° Р В РЎвЂўР В Р’В±Р РЋР РЏР В Р’В·Р В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В РЎвЂў" });
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋР С“Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р В Р вЂ¦Р В РЎвЂР В РЎвЂ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В°" });
  }
});

// Р В РЎвЂєР В Р’В±Р В Р вЂ¦Р В РЎвЂўР В Р вЂ Р В РЎвЂР РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В°
app.put("/api/suppliers/:id", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ " });
    }

    const id = Number(req.params.id);
    const { name, inn, phone, email, comment } = req.body;

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ ID Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В°" });
    }

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ message: "Р В РЎСљР В Р’В°Р В Р’В·Р В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В° Р В РЎвЂўР В Р’В±Р РЋР РЏР В Р’В·Р В Р’В°Р РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В РЎвЂў" });
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В РЎвЂўР В Р’В±Р В Р вЂ¦Р В РЎвЂўР В Р вЂ Р В Р’В»Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В РЎвЂ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В°" });
  }
});

// Р В Р в‚¬Р В РўвЂР В Р’В°Р В Р’В»Р В РЎвЂР РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В° (Р В Р’ВµР РЋР С“Р В Р’В»Р В РЎвЂ Р В РЎвЂ”Р В РЎвЂў Р В Р вЂ¦Р В Р’ВµР В РЎВР РЋРЎвЂњ Р В Р вЂ¦Р В Р’ВµР РЋРІР‚С™ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В РЎвЂўР В Р вЂ )
app.delete("/api/suppliers/:id", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ " });
    }

    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ ID Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В°" });
    }

    const ordersCount = await prisma.purchaseOrder.count({
      where: { supplierId: id },
    });

    if (ordersCount > 0) {
      return res.status(400).json({
        message: "Р В РЎСљР В Р’ВµР В Р’В»Р РЋР Р‰Р В Р’В·Р РЋР РЏ Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р В РЎвЂР РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В°, Р В РЎвЂ”Р В РЎвЂў Р В Р вЂ¦Р В Р’ВµР В РЎВР РЋРЎвЂњ Р В Р’ВµР РЋР С“Р РЋРІР‚С™Р РЋР Р‰ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р РЋРІР‚в„–",
      });
    }

    await prisma.supplier.delete({ where: { id } });
    res.json({ message: "Р В РЎСџР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќ Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р РЋРІР‚ВР В Р вЂ¦" });
  } catch (err) {
    console.error("delete supplier error:", err);
    res
      .status(500)
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋРЎвЂњР В РўвЂР В Р’В°Р В Р’В»Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В РЎвЂ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В°" });
  }
});

// ================== Р В РІР‚вЂќР В РЎвЂ™Р В РЎв„ўР В РЎвЂ™Р В РІР‚вЂќР В Р’В« Р В РЎСџР В РЎвЂєР В Р Р‹Р В РЎС›Р В РЎвЂ™Р В РІР‚в„ўР В Р’В©Р В Р’ВР В РЎв„ўР В Р в‚¬ ==================

// Р В Р Р‹Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В· Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР РЋРЎвЂњ (Р В Р’В·Р В Р’В°Р В РЎвЂ”Р В РЎвЂР РЋР С“Р РЋР Р‰ Р В Р вЂ  Р В РІР‚ВР В РІР‚Сњ)
app.post("/api/purchase-orders", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ " });
    }

    const { supplierId, plannedDate, comment, items } = req.body;

    const supplierIdNum = Number(supplierId);
    if (!supplierIdNum || Number.isNaN(supplierIdNum)) {
      return res
        .status(400)
        .json({ message: "Р В РЎСљР РЋРЎвЂњР В Р’В¶Р В Р вЂ¦Р В РЎвЂў Р РЋРЎвЂњР В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р В РЎвЂўР В РЎвЂ“Р В РЎвЂў Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В°" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({ message: "Р В РЎСљР РЋРЎвЂњР В Р’В¶Р В Р вЂ¦Р В РЎвЂў Р РЋРЎвЂњР В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р РЋРІР‚В¦Р В РЎвЂўР РЋРІР‚С™Р РЋР РЏ Р В Р’В±Р РЋРІР‚в„– Р В РЎвЂўР В РўвЂР В Р вЂ¦Р РЋРЎвЂњ Р В РЎвЂ”Р В РЎвЂўР В Р’В·Р В РЎвЂР РЋРІР‚В Р В РЎвЂР РЋР вЂ№ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°" });
    }

    // Р В РЎСџР РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’ВµР РЋР вЂљР РЋР РЏР В Р’ВµР В РЎВ, Р РЋРІР‚РЋР РЋРІР‚С™Р В РЎвЂў Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќ Р РЋР С“Р РЋРЎвЂњР РЋРІР‚В°Р В Р’ВµР РЋР С“Р РЋРІР‚С™Р В Р вЂ Р РЋРЎвЂњР В Р’ВµР РЋРІР‚С™
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierIdNum },
    });

    if (!supplier) {
      return res.status(404).json({ message: "Р В РЎСџР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќ Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦" });
    }

    // Р В РІР‚СљР В РЎвЂўР РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В РЎвЂР В РЎВ Р В РЎвЂ”Р В РЎвЂўР В Р’В·Р В РЎвЂР РЋРІР‚В Р В РЎвЂР В РЎвЂ
    const preparedItems = [];
    for (const row of items) {
      const itemId = Number(row.itemId);
      const qty = Number(row.quantity);
      const price = Number(String(row.price).replace(",", "."));

      if (!itemId || Number.isNaN(itemId)) {
        return res
          .status(400)
          .json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р РЋРІР‚С™Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР вЂљ Р В Р вЂ  Р РЋР С“Р В РЎвЂ”Р В РЎвЂР РЋР С“Р В РЎвЂќР В Р’Вµ Р В РЎвЂ”Р В РЎвЂўР В Р’В·Р В РЎвЂР РЋРІР‚В Р В РЎвЂР В РІвЂћвЂ“" });
      }

      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({
          message: "Р В РЎв„ўР В РЎвЂўР В Р’В»Р В РЎвЂР РЋРІР‚РЋР В Р’ВµР РЋР С“Р РЋРІР‚С™Р В Р вЂ Р В РЎвЂў Р В РЎвЂ”Р В РЎвЂў Р В РЎвЂќР В Р’В°Р В Р’В¶Р В РўвЂР В РЎвЂўР В РІвЂћвЂ“ Р В РЎвЂ”Р В РЎвЂўР В Р’В·Р В РЎвЂР РЋРІР‚В Р В РЎвЂР В РЎвЂ Р В РўвЂР В РЎвЂўР В Р’В»Р В Р’В¶Р В Р вЂ¦Р В РЎвЂў Р В Р’В±Р РЋРІР‚в„–Р РЋРІР‚С™Р РЋР Р‰ > 0",
        });
      }

      if (!Number.isFinite(price) || price < 0) {
        return res.status(400).json({
          message:
            "Р В Р’В¦Р В Р’ВµР В Р вЂ¦Р В Р’В° Р В РЎвЂ”Р В РЎвЂў Р В РЎвЂќР В Р’В°Р В Р’В¶Р В РўвЂР В РЎвЂўР В РІвЂћвЂ“ Р В РЎвЂ”Р В РЎвЂўР В Р’В·Р В РЎвЂР РЋРІР‚В Р В РЎвЂР В РЎвЂ Р В РўвЂР В РЎвЂўР В Р’В»Р В Р’В¶Р В Р вЂ¦Р В Р’В° Р В Р’В±Р РЋРІР‚в„–Р РЋРІР‚С™Р РЋР Р‰ Р РЋРІР‚РЋР В РЎвЂР РЋР С“Р В Р’В»Р В РЎвЂўР В РЎВ (Р В РЎВР В РЎвЂўР В Р’В¶Р В Р’ВµР РЋРІР‚С™ Р В Р’В±Р РЋРІР‚в„–Р РЋРІР‚С™Р РЋР Р‰ 0, Р В Р вЂ¦Р В РЎвЂў Р В Р вЂ¦Р В Р’Вµ Р В РЎВР В Р’ВµР В Р вЂ¦Р РЋР Р‰Р РЋРІвЂљВ¬Р В Р’Вµ)",
        });
      }

      preparedItems.push({
        itemId,
        quantity: qty,
        price,
      });
    }

    // Р В РІР‚СљР В Р’ВµР В Р вЂ¦Р В Р’ВµР РЋР вЂљР В РЎвЂР РЋР вЂљР РЋРЎвЂњР В Р’ВµР В РЎВ Р В Р вЂ¦Р В РЎвЂўР В РЎВР В Р’ВµР РЋР вЂљ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°: PO-00001, PO-00002, ...
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋР С“Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р В Р вЂ¦Р В РЎвЂР В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В° Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР РЋРЎвЂњ" });
  }
});

// Р В Р Р‹Р В РЎвЂ”Р В РЎвЂР РЋР С“Р В РЎвЂўР В РЎвЂќ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В РЎвЂўР В Р вЂ  Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР РЋРЎвЂњ
app.get("/api/purchase-orders", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ " });
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР В Р’Вµ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В РЎвЂўР В Р вЂ  Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР РЋРЎвЂњ" });
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


// Р В РЎСџР В РЎвЂўР В Р’В»Р РЋРЎвЂњР РЋРІР‚РЋР В РЎвЂР РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂўР В РўвЂР В РЎвЂР В Р вЂ¦ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·
app.get("/api/purchase-orders/:id", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ " });
    }

    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ ID Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°" });
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
      return res.status(404).json({ message: "Р В РІР‚вЂќР В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В· Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦" });
    }

    res.json(order);
  } catch (err) {
    console.error("get purchase order error:", err);
    res
      .status(500)
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР В Р’Вµ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В° Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР РЋРЎвЂњ" });
  }
});

// Excel-Р РЋРІР‚С›Р В Р’В°Р В РІвЂћвЂ“Р В Р’В» Р В РЎвЂ”Р В РЎвЂў Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р РЋР С“Р В РЎвЂўР РЋРІР‚В¦Р РЋР вЂљР В Р’В°Р В Р вЂ¦Р РЋРІР‚ВР В Р вЂ¦Р В Р вЂ¦Р В РЎвЂўР В РЎВР РЋРЎвЂњ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р РЋРЎвЂњ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР РЋРЎвЂњ

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
      return res.status(403).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ " });
    }

    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      return res
        .status(400)
        .json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ ID Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°" });
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
      return res.status(404).json({ message: "Р В РІР‚вЂќР В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В· Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦" });
    }

    // ---------- Excel ----------
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Р В РІР‚вЂќР В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В· Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР РЋРЎвЂњ");

    const dateStr = new Date(order.date).toLocaleDateString("ru-RU");
    worksheet.mergeCells("A1:F1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `Р В РІР‚вЂќР В РЎвЂ™Р В РЎв„ўР В РЎвЂ™Р В РІР‚вЂќ ${order.number} Р В РЎвЂўР РЋРІР‚С™ ${dateStr}`;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };

    // Р В РЎСџР В РЎвЂўР В РўвЂР В РЎвЂ”Р В РЎвЂР РЋР С“Р РЋР Р‰ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В° Р В РЎвЂ”Р В РЎвЂўР В РўвЂ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р В РЎвЂўР В Р’В»Р В РЎвЂўР В Р вЂ Р В РЎвЂќР В РЎвЂўР В РЎВ (Р В РЎвЂ”Р В РЎвЂў Р В Р’В¶Р В Р’ВµР В Р’В»Р В Р’В°Р В Р вЂ¦Р В РЎвЂР РЋР вЂ№)
    worksheet.mergeCells("A2:F2");
    const supCell = worksheet.getCell("A2");
    supCell.value = `Р В РЎСџР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќ: ${order.supplier?.name || ""}`;
    supCell.alignment = { horizontal: "left", vertical: "middle" };

    // Р В Р РѓР В Р’В°Р В РЎвЂ”Р В РЎвЂќР В Р’В° Р РЋРІР‚С™Р В Р’В°Р В Р’В±Р В Р’В»Р В РЎвЂР РЋРІР‚В Р РЋРІР‚в„–
    const headerRowIndex = 4;
    worksheet.getRow(headerRowIndex).values = [
      "Р Р†РІР‚С›РІР‚вЂњ",
      "Р В РЎСљР В РЎвЂўР В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂќР В Р’В»Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР вЂљР В Р’В°",
      "Р В РЎв„ўР В РЎвЂўР В Р’В»-Р В Р вЂ Р В РЎвЂў",
      "Р В РІР‚СћР В РўвЂ.",
      "Р В Р’В¦Р В Р’ВµР В Р вЂ¦Р В Р’В° Р В Р’В·Р В Р’В° Р РЋРІвЂљВ¬Р РЋРІР‚С™",
      "Р В Р Р‹Р РЋРЎвЂњР В РЎВР В РЎВР В Р’В°",
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
      const unit = row.item?.unit || "Р РЋРІвЂљВ¬Р РЋРІР‚С™";
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

    // Р В Р’ВР РЋРІР‚С™Р В РЎвЂўР В РЎвЂ“
    const totalRowIndex = lastDataRow + 1;
    const totalRow = worksheet.getRow(totalRowIndex);
    totalRow.getCell(5).value = "Р В Р’ВР В РЎС›Р В РЎвЂєР В РІР‚СљР В РЎвЂє:";
    totalRow.getCell(5).font = { bold: true };
    totalRow.getCell(5).alignment = {
      horizontal: "right",
      vertical: "middle",
    };
    totalRow.getCell(6).value = {
      formula: `SUM(F${firstDataRow}:F${lastDataRow})`,
    };
    totalRow.getCell(6).font = { bold: true };

    // Р В РЎвЂєР РЋРІР‚С›Р В РЎвЂўР РЋР вЂљР В РЎВР В Р’В»Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋРІР‚С›Р В РЎвЂўР РЋР вЂљР В РЎВР В РЎвЂР РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В РЎвЂ Excel Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°" });
  }
});

// Р В Р Р‹Р В РЎВР В Р’ВµР В Р вЂ¦Р В Р’В° Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“Р В Р’В° Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В° (Р В РЎвЂ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ RECEIVED Р Р†Р вЂљРІР‚Сњ Р В Р’В°Р В Р вЂ Р РЋРІР‚С™Р В РЎвЂўР В РЎВР В Р’В°Р РЋРІР‚С™Р В РЎвЂР РЋРІР‚РЋР В Р’ВµР РЋР С“Р В РЎвЂќР В РЎвЂР В РІвЂћвЂ“ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂўР В РўвЂ Р В Р вЂ¦Р В Р’В° Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂ)
app.put("/api/purchase-orders/:id/status", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ " });
    }

    const id = Number(req.params.id);
    const { status } = req.body;

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ ID Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°" });
    }

    const allowedStatuses = ["DRAFT", "SENT", "PARTIAL", "RECEIVED", "CLOSED"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РўвЂР В РЎвЂўР В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р РЋРІР‚С™Р В РЎвЂР В РЎВР РЋРІР‚в„–Р В РІвЂћвЂ“ Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°" });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Р В РІР‚вЂќР В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В· Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦" });
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
          message: "Р В Р’В­Р РЋРІР‚С™Р В РЎвЂўР РЋРІР‚С™ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В· Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’ВµР В РўвЂР РЋРІР‚ВР В Р вЂ¦ Р В РЎвЂ”Р В РЎвЂў Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР РЋРЎвЂњ",
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
            comment: `Р В РЎСџР РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂўР В РўвЂ Р В РЎвЂ”Р В РЎвЂў Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р РЋРЎвЂњ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР РЋРЎвЂњ ${order.number} [PO#${order.id}]`,
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋР С“Р В РЎВР В Р’ВµР В Р вЂ¦Р В Р’Вµ Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“Р В Р’В° Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°" });
  }
});

// Р В РЎСџР РЋР вЂљР В РЎвЂР РЋРІР‚ВР В РЎВР В РЎвЂќР В Р’В° Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В° Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР РЋРЎвЂњ (Р РЋР С“ Р В Р’В°Р В РЎвЂќР РЋРІР‚С™Р В РЎвЂўР В РЎВ Р РЋР вЂљР В Р’В°Р РЋР С“Р РЋРІР‚В¦Р В РЎвЂўР В Р’В¶Р В РўвЂР В Р’ВµР В Р вЂ¦Р В РЎвЂР В РІвЂћвЂ“)
app.post("/api/purchase-orders/:id/receive", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ " });
    }

    const id = Number(req.params.id);
    const { items } = req.body || {};

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ ID Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°" });
    }

    if (!Array.isArray(items)) {
      return res
        .status(400)
        .json({ message: "Р В РЎСљР РЋРЎвЂњР В Р’В¶Р В Р вЂ¦Р В РЎвЂў Р В РЎвЂ”Р В Р’ВµР РЋР вЂљР В Р’ВµР В РўвЂР В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р В РЎВР В Р’В°Р РЋР С“Р РЋР С“Р В РЎвЂР В Р вЂ  Р В РЎвЂ”Р В РЎвЂўР В Р’В·Р В РЎвЂР РЋРІР‚В Р В РЎвЂР В РІвЂћвЂ“ Р В РўвЂР В Р’В»Р РЋР РЏ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР РЋРІР‚ВР В РЎВР В РЎвЂќР В РЎвЂ" });
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
      return res.status(404).json({ message: "Р В РІР‚вЂќР В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В· Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦" });
    }

    // Р В Р’ВµР РЋР С“Р В Р’В»Р В РЎвЂ Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“ Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋРЎвЂњР РЋРІР‚РЋР В Р’ВµР В Р вЂ¦/Р В Р’В·Р В Р’В°Р В РЎвЂќР РЋР вЂљР РЋРІР‚в„–Р РЋРІР‚С™ Р Р†Р вЂљРІР‚Сњ Р В Р вЂ¦Р В Р’Вµ Р В РўвЂР В Р’В°Р РЋРІР‚ВР В РЎВ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’ВµР РЋР С“Р РЋРІР‚С™Р В РЎвЂ Р В Р’ВµР РЋРІР‚В°Р РЋРІР‚В Р РЋР вЂљР В Р’В°Р В Р’В·
    if (order.status === "RECEIVED" || order.status === "CLOSED") {
      return res
        .status(400)
        .json({ message: "Р В Р’В­Р РЋРІР‚С™Р В РЎвЂўР РЋРІР‚С™ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В· Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В Р’В±Р РЋРІР‚в„–Р В Р’В» Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’ВµР В РўвЂР РЋРІР‚ВР В Р вЂ¦ Р В РЎвЂ”Р В РЎвЂў Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР РЋРЎвЂњ" });
    }

    // Р В РЎСџР РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’ВµР РЋР вЂљР В РЎвЂќР В Р’В° Р В Р вЂ¦Р В Р’В° Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р РЋР С“Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р В Р вЂ¦Р В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ Р В РўвЂР В Р вЂ Р В РЎвЂР В Р’В¶Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ Р В РЎвЂ”Р В РЎвЂў Р РЋР РЉР РЋРІР‚С™Р В РЎвЂўР В РЎВР РЋРЎвЂњ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р РЋРЎвЂњ
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
        .json({ message: "Р В Р’В­Р РЋРІР‚С™Р В РЎвЂўР РЋРІР‚С™ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В· Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’ВµР В РўвЂР РЋРІР‚ВР В Р вЂ¦ Р В РЎвЂ”Р В РЎвЂў Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР РЋРЎвЂњ" });
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
        : ordered; // Р В РЎвЂ”Р В РЎвЂў Р РЋРЎвЂњР В РЎВР В РЎвЂўР В Р’В»Р РЋРІР‚РЋР В Р’В°Р В Р вЂ¦Р В РЎвЂР РЋР вЂ№ Р РЋР С“Р РЋРІР‚РЋР В РЎвЂР РЋРІР‚С™Р В Р’В°Р В Р’ВµР В РЎВ, Р РЋРІР‚РЋР РЋРІР‚С™Р В РЎвЂў Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР РЋРІвЂљВ¬Р В Р’В»Р В РЎвЂў Р РЋР С“Р РЋРІР‚С™Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В РЎвЂќР В РЎвЂў Р В Р’В¶Р В Р’Вµ, Р РЋР С“Р В РЎвЂќР В РЎвЂўР В Р’В»Р РЋР Р‰Р В РЎвЂќР В РЎвЂў Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°Р В Р вЂ¦Р В РЎвЂў

      // Р В РўвЂР В Р вЂ Р В РЎвЂР В Р’В¶Р В Р’ВµР В Р вЂ¦Р В РЎвЂР В Р’Вµ Р В РЎвЂ”Р В РЎвЂў Р РЋР С“Р В РЎвЂќР В Р’В»Р В Р’В°Р В РўвЂР РЋРЎвЂњ Р Р†Р вЂљРІР‚Сњ Р РЋРІР‚С™Р В РЎвЂўР В Р’В»Р РЋР Р‰Р В РЎвЂќР В РЎвЂў Р В Р’ВµР РЋР С“Р В Р’В»Р В РЎвЂ Р РЋР вЂљР В Р’ВµР В Р’В°Р В Р’В»Р РЋР Р‰Р В Р вЂ¦Р В РЎвЂў Р РЋРІР‚РЋР РЋРІР‚С™Р В РЎвЂў-Р РЋРІР‚С™Р В РЎвЂў Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР РЋРІвЂљВ¬Р В Р’В»Р В РЎвЂў
      receivedByOrderItemId.set(row.id, received);
      if (received > 0) {
        movementsData.push({
          itemId: row.itemId,
          type: "INCOME",
          quantity: Math.round(received),
          pricePerUnit: row.price,
          comment: `Р В РЎСџР РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂўР В РўвЂ Р В РЎвЂ”Р В РЎвЂў Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р РЋРЎвЂњ ${order.number} [PO#${order.id}] (Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°Р В Р вЂ¦Р В РЎвЂў ${ordered}, Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋРЎвЂњР РЋРІР‚РЋР В Р’ВµР В Р вЂ¦Р В РЎвЂў ${received})`,
          createdById: userId,
        });
      }

      const diff = received - ordered;
      if (diff !== 0) {
        discrepancies.push({
          itemName: row.item?.name || "",
          unit: row.item?.unit || "Р РЋРІвЂљВ¬Р РЋРІР‚С™",
          orderedQty: ordered,
          receivedQty: received,
          diffQty: diff,
          price: row.price,
        });
      }
    }

    // Р РЋР С“Р В РЎвЂўР В Р’В·Р В РўвЂР В Р’В°Р РЋРІР‚ВР В РЎВ Р В РўвЂР В Р вЂ Р В РЎвЂР В Р’В¶Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ
    if (movementsData.length > 0) {
      await prisma.stockMovement.createMany({ data: movementsData });
    }

    // Р В РЎвЂўР В Р’В±Р В Р вЂ¦Р В РЎвЂўР В Р вЂ Р В Р’В»Р РЋР РЏР В Р’ВµР В РЎВ Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР РЋРІР‚ВР В РЎВР В РЎвЂќР В Р’Вµ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°" });
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
          comment: `Приемка по заказу ${order.number} [PO#${order.id}]`,
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


// ===== Excel-Р РЋРІР‚С›Р В Р’В°Р В РІвЂћвЂ“Р В Р’В» Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В° Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР РЋРЎвЂњ (Р В Р’В±Р В Р’ВµР В Р’В· Р РЋР С“Р В РЎвЂўР РЋРІР‚В¦Р РЋР вЂљР В Р’В°Р В Р вЂ¦Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ Р В Р вЂ  Р В РІР‚ВР В РІР‚Сњ) =====
app.post("/api/purchase-orders/excel-file", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ " });
    }

    const { supplierId, plannedDate, comment, items } = req.body;

    const supplierIdNum = Number(supplierId);
    if (!supplierIdNum || Number.isNaN(supplierIdNum)) {
      return res
        .status(400)
        .json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќ" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: "Р В РЎСљР РЋРЎвЂњР В Р’В¶Р В Р вЂ¦Р В РЎвЂў Р РЋРЎвЂњР В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р РЋРІР‚В¦Р В РЎвЂўР РЋРІР‚С™Р РЋР РЏ Р В Р’В±Р РЋРІР‚в„– Р В РЎвЂўР В РўвЂР В Р вЂ¦Р РЋРЎвЂњ Р В РЎвЂ”Р В РЎвЂўР В Р’В·Р В РЎвЂР РЋРІР‚В Р В РЎвЂР РЋР вЂ№ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°",
      });
    }

    // Р В РЎСџР РЋРІР‚в„–Р РЋРІР‚С™Р В Р’В°Р В Р’ВµР В РЎВР РЋР С“Р РЋР РЏ Р РЋРЎвЂњР В Р’В·Р В Р вЂ¦Р В Р’В°Р РЋРІР‚С™Р РЋР Р‰ Р В РЎвЂР В РЎВР РЋР РЏ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В° (Р В Р’ВµР РЋР С“Р В Р’В»Р В РЎвЂ Р В Р вЂ¦Р В Р’Вµ Р В РЎвЂ”Р В РЎвЂўР В Р’В»Р РЋРЎвЂњР РЋРІР‚РЋР В РЎвЂР РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р Р†Р вЂљРІР‚Сљ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В РЎвЂў Р В Р’В±Р РЋРЎвЂњР В РўвЂР В Р’ВµР РЋРІР‚С™ "Р В РЎСџР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќ")
    let supplierName = "Р В РЎСџР В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќ";
    try {
      const supplier = await prisma.supplier.findUnique({
        where: { id: supplierIdNum },
      });
      if (supplier?.name) supplierName = supplier.name;
    } catch (e) {
      console.error("[excel-file] Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋРІР‚РЋР РЋРІР‚С™Р В Р’ВµР В Р вЂ¦Р В РЎвЂР РЋР РЏ Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В°:", e);
    }

    // Р В Р’В§Р В РЎвЂР РЋР С“Р РЋРІР‚С™Р В РЎвЂР В РЎВ Р В РЎвЂ Р В Р вЂ Р В Р’В°Р В Р’В»Р В РЎвЂР В РўвЂР В РЎвЂР РЋР вЂљР РЋРЎвЂњР В Р’ВµР В РЎВ Р В РЎвЂ”Р В РЎвЂўР В Р’В·Р В РЎвЂР РЋРІР‚В Р В РЎвЂР В РЎвЂ
    const cleanedItems = [];
    for (const raw of items) {
      const name = String(raw.name || "").trim();
      const unit = String(raw.unit || "Р РЋРІвЂљВ¬Р РЋРІР‚С™").trim();
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
        message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В Р вЂ Р В Р’В°Р В Р’В»Р В РЎвЂР В РўвЂР В Р вЂ¦Р РЋРІР‚в„–Р РЋРІР‚В¦ Р В РЎвЂ”Р В РЎвЂўР В Р’В·Р В РЎвЂР РЋРІР‚В Р В РЎвЂР В РІвЂћвЂ“ Р В РўвЂР В Р’В»Р РЋР РЏ Р РЋРІР‚С›Р В РЎвЂўР РЋР вЂљР В РЎВР В РЎвЂР РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР РЋР РЏ Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°",
      });
    }

    // === Р В Р’В¤Р В РЎвЂўР РЋР вЂљР В РЎВР В РЎвЂР РЋР вЂљР РЋРЎвЂњР В Р’ВµР В РЎВ Excel ===
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Р В РІР‚вЂќР В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·");

    const now = new Date();
    const orderDateStr = now.toLocaleDateString("ru-RU");
    const plannedDateStr = plannedDate
      ? new Date(plannedDate).toLocaleDateString("ru-RU")
      : null;

    // Р В Р Р‹Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В Р’В° 1 Р Р†Р вЂљРІР‚Сњ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р В РЎвЂўР В Р’В»Р В РЎвЂўР В Р вЂ Р В РЎвЂўР В РЎвЂќ
    worksheet.mergeCells("A1:F1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = `Р В РІР‚вЂќР В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В· Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР РЋРЎвЂњ: ${supplierName}`;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };

    // Р В Р Р‹Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В Р’В° 2 Р Р†Р вЂљРІР‚Сњ Р В РўвЂР В Р’В°Р РЋРІР‚С™Р В Р’В° Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В° / Р В РЎвЂ”Р В Р’В»Р В Р’В°Р В Р вЂ¦. Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР РЋРІР‚ВР В РЎВР В РЎвЂќР В Р’В°
    worksheet.mergeCells("A2:F2");
    const metaCell = worksheet.getCell("A2");
    metaCell.value =
      `Р В РІР‚СњР В Р’В°Р РЋРІР‚С™Р В Р’В° Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В°: ${orderDateStr}` +
      (plannedDateStr ? ` / Р В РЎСџР В Р’В»Р В Р’В°Р В Р вЂ¦. Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР РЋРІР‚ВР В РЎВР В РЎвЂќР В Р’В°: ${plannedDateStr}` : "");
    metaCell.alignment = { horizontal: "right", vertical: "middle" };
    metaCell.font = { size: 11, color: { argb: "FF555555" } };

    // Р В Р Р‹Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В Р’В° 3 Р Р†Р вЂљРІР‚Сњ Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋР РЏ
    worksheet.getRow(3).height = 4;

    // Р В Р Р‹Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В Р’В° 4 Р Р†Р вЂљРІР‚Сњ Р РЋРІвЂљВ¬Р В Р’В°Р В РЎвЂ”Р В РЎвЂќР В Р’В° Р РЋРІР‚С™Р В Р’В°Р В Р’В±Р В Р’В»Р В РЎвЂР РЋРІР‚В Р РЋРІР‚в„–
    const headerRowIndex = 4;
    const headerRow = worksheet.getRow(headerRowIndex);
    headerRow.values = ["Р Р†РІР‚С›РІР‚вЂњ", "Р В РЎСљР В РЎвЂўР В РЎВР В Р’ВµР В Р вЂ¦Р В РЎвЂќР В Р’В»Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР вЂљР В Р’В°", "Р В РЎв„ўР В РЎвЂўР В Р’В»-Р В Р вЂ Р В РЎвЂў", "Р В РІР‚СћР В РўвЂ.", "Р В Р’В¦Р В Р’ВµР В Р вЂ¦Р В Р’В°", "Р В Р Р‹Р РЋРЎвЂњР В РЎВР В РЎВР В Р’В°"];

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

    // Р В РІР‚СњР В Р’В°Р В Р вЂ¦Р В Р вЂ¦Р РЋРІР‚в„–Р В Р’Вµ
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
        undefined, // Р РЋРІР‚С›Р В РЎвЂўР РЋР вЂљР В РЎВР РЋРЎвЂњР В Р’В»Р В Р’В° Р В Р’В±Р РЋРЎвЂњР В РўвЂР В Р’ВµР РЋРІР‚С™ Р В Р вЂ¦Р В РЎвЂР В Р’В¶Р В Р’Вµ
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

    // Р В Р’ВР РЋРІР‚С™Р В РЎвЂўР В РЎвЂ“Р В РЎвЂўР В Р вЂ Р В Р’В°Р РЋР РЏ Р РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В РЎвЂўР В РЎвЂќР В Р’В°
    const totalRowIndex = lastDataRow + 1;
    const totalRow = worksheet.getRow(totalRowIndex);

    totalRow.getCell(5).value = "Р В Р’ВР РЋРІР‚С™Р В РЎвЂўР В РЎвЂ“Р В РЎвЂў:";
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

    // Р В РЎв„ўР В РЎвЂўР В РЎВР В РЎВР В Р’ВµР В Р вЂ¦Р РЋРІР‚С™Р В Р’В°Р РЋР вЂљР В РЎвЂР В РІвЂћвЂ“ (Р В Р’ВµР РЋР С“Р В Р’В»Р В РЎвЂ Р В Р’ВµР РЋР С“Р РЋРІР‚С™Р РЋР Р‰)
    if (comment) {
      const commentRowIndex = totalRowIndex + 2;
      worksheet.mergeCells(`A${commentRowIndex}:F${commentRowIndex}`);
      const cCell = worksheet.getCell(`A${commentRowIndex}`);
      cCell.value = `Р В РЎв„ўР В РЎвЂўР В РЎВР В РЎВР В Р’ВµР В Р вЂ¦Р РЋРІР‚С™Р В Р’В°Р РЋР вЂљР В РЎвЂР В РІвЂћвЂ“: ${comment}`;
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
      message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋРІР‚С›Р В РЎвЂўР РЋР вЂљР В РЎВР В РЎвЂР РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’В°Р В Р вЂ¦Р В РЎвЂР В РЎвЂ Excel-Р В Р’В·Р В Р’В°Р В РЎвЂќР В Р’В°Р В Р’В·Р В Р’В° Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР РЋРЎвЂњ",
      error: String(err),
    });
  }
});

// ================== Р В РЎвЂєР В Р’В§Р В РІР‚СћР В Р’В Р В РІР‚СћР В РІР‚СњР В Р’В¬ Р В РЎС™Р В РЎвЂ™Р В Р РѓР В Р’ВР В РЎСљ Р В РЎСџР В РЎвЂєР В Р Р‹Р В РЎС›Р В РЎвЂ™Р В РІР‚в„ўР В Р’В©Р В Р’ВР В РЎв„ўР В РЎвЂєР В РІР‚в„ў ==================

// Р РЋР С“Р В РЎвЂ”Р В РЎвЂР РЋР С“Р В РЎвЂўР В РЎвЂќ Р В РЎВР В Р’В°Р РЋРІвЂљВ¬Р В РЎвЂР В Р вЂ¦ Р В Р вЂ  Р В РЎвЂўР РЋРІР‚РЋР В Р’ВµР РЋР вЂљР В Р’ВµР В РўвЂР В РЎвЂ (Р РЋР С“ Р РЋРІР‚С›Р В РЎвЂР В Р’В»Р РЋР Р‰Р РЋРІР‚С™Р РЋР вЂљР В Р’В°Р В РЎВР В РЎвЂ)
app.get("/api/supplier-trucks", auth, async (req, res) => {
  try {
    const onlyActive = req.query.onlyActive === "1";
    const { dateFrom, dateTo } = req.query;

    const where = {};

    // Р РЋРІР‚С›Р В РЎвЂР В Р’В»Р РЋР Р‰Р РЋРІР‚С™Р РЋР вЂљ Р В РЎвЂ”Р В РЎвЂў Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“Р РЋРЎвЂњ
    if (onlyActive) {
      where.status = { in: ["IN_QUEUE", "UNLOADING"] };
    }

    // Р РЋРІР‚С›Р В РЎвЂР В Р’В»Р РЋР Р‰Р РЋРІР‚С™Р РЋР вЂљ Р В РЎвЂ”Р В РЎвЂў Р В РўвЂР В Р’В°Р РЋРІР‚С™Р В Р’Вµ Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР В Р’В±Р РЋРІР‚в„–Р РЋРІР‚С™Р В РЎвЂР РЋР РЏ (Р В РЎвЂќР В РЎвЂўР В Р’В»Р В РЎвЂўР В Р вЂ¦Р В РЎвЂќР В Р’В° "Р В РЎСџР РЋР вЂљР В РЎвЂР В Р’В±Р РЋРІР‚в„–Р РЋРІР‚С™Р В РЎвЂР В Р’Вµ")
    // dateFrom Р В РЎвЂ dateTo Р В РЎвЂ”Р РЋР вЂљР В РЎвЂР РЋРІР‚В¦Р В РЎвЂўР В РўвЂР РЋР РЏР РЋРІР‚С™ Р В Р вЂ  Р РЋРІР‚С›Р В РЎвЂўР РЋР вЂљР В РЎВР В Р’В°Р РЋРІР‚С™Р В Р’Вµ "YYYY-MM-DD"
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (!Number.isNaN(from.getTime())) {
        // Р В Р вЂ¦Р В Р’В°Р РЋРІР‚РЋР В Р’В°Р В Р’В»Р В РЎвЂў Р В РўвЂР В Р вЂ¦Р РЋР РЏ
        from.setHours(0, 0, 0, 0);
        where.arrivalAt = { ...(where.arrivalAt || {}), gte: from };
      }
    }

    if (dateTo) {
      const to = new Date(dateTo);
      if (!Number.isNaN(to.getTime())) {
        // Р В РЎвЂќР В РЎвЂўР В Р вЂ¦Р В Р’ВµР РЋРІР‚В  Р В РўвЂР В Р вЂ¦Р РЋР РЏ
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР В Р’Вµ Р В РЎвЂўР РЋРІР‚РЋР В Р’ВµР РЋР вЂљР В Р’ВµР В РўвЂР В РЎвЂ Р В РЎВР В Р’В°Р РЋРІвЂљВ¬Р В РЎвЂР В Р вЂ¦" });
  }
});

// Р РЋР вЂљР В Р’ВµР В РЎвЂ“Р В РЎвЂР РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В Р’В°Р РЋРІР‚В Р В РЎвЂР РЋР РЏ Р В РЎВР В Р’В°Р РЋРІвЂљВ¬Р В РЎвЂР В Р вЂ¦Р РЋРІР‚в„– Р В Р вЂ  Р В РЎвЂўР РЋРІР‚РЋР В Р’ВµР РЋР вЂљР В Р’ВµР В РўвЂР В РЎвЂ
app.post("/api/supplier-trucks", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ " });
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
          "Р В Р в‚¬Р В РЎвЂќР В Р’В°Р В Р’В¶Р В РЎвЂР РЋРІР‚С™Р В Р’Вµ Р РЋРІР‚В¦Р В РЎвЂўР РЋРІР‚С™Р РЋР РЏ Р В Р’В±Р РЋРІР‚в„– Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋРІР‚В°Р В РЎвЂР В РЎвЂќР В Р’В°, Р В Р вЂ¦Р В РЎвЂўР В РЎВР В Р’ВµР РЋР вЂљ Р В РЎВР В Р’В°Р РЋРІвЂљВ¬Р В РЎвЂР В Р вЂ¦Р РЋРІР‚в„– Р В РЎвЂР В Р’В»Р В РЎвЂ Р В Р вЂ Р В РЎвЂўР В РўвЂР В РЎвЂР РЋРІР‚С™Р В Р’ВµР В Р’В»Р РЋР РЏ Р В РўвЂР В Р’В»Р РЋР РЏ Р РЋР вЂљР В Р’ВµР В РЎвЂ“Р В РЎвЂР РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ Р В Р вЂ  Р В РЎвЂўР РЋРІР‚РЋР В Р’ВµР РЋР вЂљР В Р’ВµР В РўвЂР В РЎвЂ",
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
        // arrivalAt Р В РЎвЂ status Р В РЎвЂ”Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р РЋР РЏР РЋРІР‚С™Р РЋР С“Р РЋР РЏ Р РЋР С“Р В Р’В°Р В РЎВР В РЎвЂ (Р В РўвЂР В Р’ВµР РЋРІР‚С›Р В РЎвЂўР В Р’В»Р РЋРІР‚С™Р РЋРІР‚в„–)
      },
    });

    res.status(201).json(truck);
  } catch (err) {
    console.error("create supplier truck error:", err);
    res
      .status(500)
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋР вЂљР В Р’ВµР В РЎвЂ“Р В РЎвЂР РЋР С“Р РЋРІР‚С™Р РЋР вЂљР В Р’В°Р РЋРІР‚В Р В РЎвЂР В РЎвЂ Р В РЎВР В Р’В°Р РЋРІвЂљВ¬Р В РЎвЂР В Р вЂ¦Р РЋРІР‚в„– Р В Р вЂ  Р В РЎвЂўР РЋРІР‚РЋР В Р’ВµР РЋР вЂљР В Р’ВµР В РўвЂР В РЎвЂ" });
  }
});

// Р РЋР С“Р В РЎВР В Р’ВµР В Р вЂ¦Р В Р’В° Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“Р В Р’В° (Р В Р вЂ  Р В РЎвЂўР РЋРІР‚РЋР В Р’ВµР РЋР вЂљР В Р’ВµР В РўвЂР В РЎвЂ -> Р В Р вЂ¦Р В Р’В° Р РЋР вЂљР В Р’В°Р В Р’В·Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР В Р’Вµ -> Р В Р вЂ Р РЋРІР‚в„–Р В Р’ВµР РЋРІР‚В¦Р В Р’В°Р В Р’В»)
app.put("/api/supplier-trucks/:id/status", auth, async (req, res) => {
  try {
    if (!isWarehouseManager(req.user)) {
      return res.status(403).json({ message: "Р В РЎСљР В Р’ВµР РЋРІР‚С™ Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ " });
    }

    const id = Number(req.params.id);
    const { status, gate } = req.body || {};

    if (!id || Number.isNaN(id)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РЎвЂќР В РЎвЂўР РЋР вЂљР РЋР вЂљР В Р’ВµР В РЎвЂќР РЋРІР‚С™Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ ID Р В Р’В·Р В Р’В°Р В РЎвЂ”Р В РЎвЂР РЋР С“Р В РЎвЂ" });
    }

    if (!["IN_QUEUE", "UNLOADING", "DONE"].includes(status)) {
      return res.status(400).json({ message: "Р В РЎСљР В Р’ВµР В РўвЂР В РЎвЂўР В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р РЋРІР‚С™Р В РЎвЂР В РЎВР РЋРІР‚в„–Р В РІвЂћвЂ“ Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“" });
    }

    const truck = await prisma.supplierTruck.findUnique({
      where: { id },
    });

    if (!truck) {
      return res.status(404).json({ message: "Р В РІР‚вЂќР В Р’В°Р В РЎвЂ”Р В РЎвЂР РЋР С“Р РЋР Р‰ Р В Р вЂ¦Р В Р’Вµ Р В Р вЂ¦Р В Р’В°Р В РІвЂћвЂ“Р В РўвЂР В Р’ВµР В Р вЂ¦Р В Р’В°" });
    }

    const data = { status };
    const now = new Date();

    // Р В РЎвЂќР В РЎвЂўР В РЎвЂ“Р В РўвЂР В Р’В° Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р В Р вЂ Р В РЎвЂР В РЎВ Р В Р вЂ¦Р В Р’В° Р РЋР вЂљР В Р’В°Р В Р’В·Р В РЎвЂ“Р РЋР вЂљР РЋРЎвЂњР В Р’В·Р В РЎвЂќР РЋРЎвЂњ Р Р†Р вЂљРІР‚Сњ Р РЋРІР‚С›Р В РЎвЂР В РЎвЂќР РЋР С“Р В РЎвЂР РЋР вЂљР РЋРЎвЂњР В Р’ВµР В РЎВ Р В Р вЂ Р РЋР вЂљР В Р’ВµР В РЎВР РЋР РЏ Р В РЎвЂ Р В Р вЂ Р В РЎвЂўР РЋР вЂљР В РЎвЂўР РЋРІР‚С™Р В Р’В°
    if (status === "UNLOADING" && !truck.unloadStartAt) {
      data.unloadStartAt = now;
      if (gate) data.gate = gate;
    }

    // Р В РЎвЂќР В РЎвЂўР В РЎвЂ“Р В РўвЂР В Р’В° Р В Р вЂ Р РЋРІР‚в„–Р В Р’ВµР РЋРІР‚В¦Р В Р’В°Р В Р’В» Р Р†Р вЂљРІР‚Сњ Р РЋРІР‚С›Р В РЎвЂР В РЎвЂќР РЋР С“Р В РЎвЂР РЋР вЂљР РЋРЎвЂњР В Р’ВµР В РЎВ Р В Р вЂ Р РЋР вЂљР В Р’ВµР В РЎВР РЋР РЏ Р В Р вЂ Р РЋРІР‚в„–Р В Р’ВµР В Р’В·Р В РўвЂР В Р’В°
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
      .json({ message: "Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р РЋР С“Р В Р’ВµР РЋР вЂљР В Р вЂ Р В Р’ВµР РЋР вЂљР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р РЋР С“Р В РЎВР В Р’ВµР В Р вЂ¦Р В Р’Вµ Р РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р РЋРЎвЂњР РЋР С“Р В Р’В° Р В РЎВР В Р’В°Р РЋРІвЂљВ¬Р В РЎвЂР В Р вЂ¦Р РЋРІР‚в„–" });
  }
});

// ================== Р В РЎСџР В РІР‚СћР В Р’В Р В Р’ВР В РЎвЂєР В РІР‚СњР В Р’ВР В Р’В§Р В РІР‚СћР В Р Р‹Р В РЎв„ўР В Р’ВР В РІР‚Сћ Р В РІР‚вЂќР В РЎвЂ™Р В РІР‚СњР В РЎвЂ™Р В Р’В§Р В Р’В ==================

// Р В РўвЂР В Р’В°Р РЋРІР‚С™Р В Р’В°, Р В Р’В·Р В Р’В° Р В РЎвЂќР В РЎвЂўР РЋРІР‚С™Р В РЎвЂўР РЋР вЂљР РЋРЎвЂњР РЋР вЂ№ Р РЋРЎвЂњР В Р’В¶Р В Р’Вµ Р В РЎвЂўР РЋРІР‚С™Р В РЎвЂ”Р РЋР вЂљР В Р’В°Р В Р вЂ Р В Р’В»Р В Р’ВµР В Р вЂ¦ Р В Р’ВµР В Р’В¶Р В Р’ВµР В РўвЂР В Р вЂ¦Р В Р’ВµР В Р вЂ Р В Р вЂ¦Р РЋРІР‚в„–Р В РІвЂћвЂ“ Р В РЎвЂўР РЋРІР‚С™Р РЋРІР‚РЋР РЋРІР‚ВР РЋРІР‚С™ Р В РЎвЂ”Р В РЎвЂў Р В РЎвЂўР РЋР С“Р РЋРІР‚С™Р В Р’В°Р РЋРІР‚С™Р В РЎвЂќР В Р’В°Р В РЎВ (Р РЋРІР‚С›Р В РЎвЂўР РЋР вЂљР В РЎВР В Р’В°Р РЋРІР‚С™ "YYYY-MM-DD")
let lastLowStockReportDate = null;

// Р В РЎвЂ”Р РЋР вЂљР В РЎвЂўР В Р вЂ Р В Р’ВµР РЋР вЂљР В РЎвЂќР В Р’В° Р В РЎвЂќР В Р’В°Р В Р’В¶Р В РўвЂР РЋРІР‚в„–Р В Р’Вµ 60 Р РЋР С“Р В Р’ВµР В РЎвЂќР РЋРЎвЂњР В Р вЂ¦Р В РўвЂ
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

async function startBackgroundTasks() {
  if (backgroundTasksStarted) return;
  const ready = await checkDbReadyForBackground();
  if (!ready) {
    console.error(
      "[DB ready check] ?? ?? ?????? ? ??????? ?????? ?? ???????? (????????? db:deploy)."
    );
    return;
  }

  backgroundTasksStarted = true;
  console.log("[DB ready check] OK, ????????? ??????? ??????.");

  setInterval(sendSafetyReminders, 1000 * 60 * 60); // ??? ? ???
  sendSafetyReminders();

  setInterval(() => {
    // 1) ??????????? ?? ??????? ??????
    checkWarehouseTaskNotifications().catch((err) =>
      console.error("?????? ? checkWarehouseTaskNotifications:", err)
    );

    // 2) ??? ? ???? ? 18:00 ?????????? ????? ?? ??????????? ????????
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

// Р В Р’В·Р В Р’В°Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќ long polling Telegram (Р В РЎвЂўР В РўвЂР В РЎвЂР В Р вЂ¦ Р РЋР РЉР В РЎвЂќР В Р’В·Р В Р’ВµР В РЎВР В РЎвЂ”Р В Р’В»Р РЋР РЏР РЋР вЂљ)
startTelegramPolling().catch((err) =>
  console.error("Р В РЎвЂєР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р В РЎвЂ”Р РЋР вЂљР В РЎвЂ Р В Р’В·Р В Р’В°Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќР В Р’Вµ startTelegramPolling:", err)
);

// ================== Р В РІР‚вЂќР В РЎвЂ™Р В РЎСџР В Р в‚¬Р В Р Р‹Р В РЎв„ў Р В Р Р‹Р В РІР‚СћР В Р’В Р В РІР‚в„ўР В РІР‚СћР В Р’В Р В РЎвЂ™ ==================

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`РЎР‚РЎСџРЎв„ўР вЂљ API Р В Р’В·Р В Р’В°Р В РЎвЂ”Р РЋРЎвЂњР РЋРІР‚В°Р В Р’ВµР В Р вЂ¦: http://localhost:${PORT}`);
});

startBackgroundTasks().catch((err) =>
  console.error("[DB ready check] Р В РЎвЂўР РЋРІвЂљВ¬Р В РЎвЂР В Р’В±Р В РЎвЂќР В Р’В° Р В Р’В·Р В Р’В°Р В РЎвЂ”Р РЋРЎвЂњР РЋР С“Р В РЎвЂќР В Р’В° Р РЋРІР‚С›Р В РЎвЂўР В Р вЂ¦Р В РЎвЂўР В Р вЂ Р РЋРІР‚в„–Р РЋРІР‚В¦ Р В Р’В·Р В Р’В°Р В РўвЂР В Р’В°Р РЋРІР‚РЋ:", err)
);



