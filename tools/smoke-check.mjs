import process from "process";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const API_BASE = process.env.SMOKE_API_BASE || "http://localhost:3001/api";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || "admin@test.local";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || "Test12345!";
const EMPLOYEE_EMAIL = process.env.SMOKE_EMPLOYEE_EMAIL || "employee@test.local";
const EMPLOYEE_PASSWORD = process.env.SMOKE_EMPLOYEE_PASSWORD || "Test12345!";
const INVITE_EMAIL = process.env.SMOKE_INVITE_EMAIL || "invite@test.local";
const SMOKE_SEED = process.env.SMOKE_SEED === "true";

const results = [];

async function request(path, options) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function login(email, password) {
  return request("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

async function seedUsers() {
  const prisma = new PrismaClient();
  const hashAdmin = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const hashEmployee = await bcrypt.hash(EMPLOYEE_PASSWORD, 10);
  const upsertUser = async (email, role, name, hash) => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await prisma.user.update({
        where: { email },
        data: {
          password: hash,
          passwordHash: hash,
          role,
          name: name || existing.name,
          isActive: true,
        },
      });
      return;
    }
    await prisma.user.create({
      data: {
        email,
        password: hash,
        passwordHash: hash,
        role,
        name,
        isActive: true,
      },
    });
  };
  await upsertUser(ADMIN_EMAIL, "ADMIN", "Smoke Admin", hashAdmin);
  await upsertUser(EMPLOYEE_EMAIL, "EMPLOYEE", "Smoke Employee", hashEmployee);
  await prisma.$disconnect();
}

async function run() {
  if (SMOKE_SEED) {
    await seedUsers();
  }

  let adminToken = "";
  const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  if (!adminLogin.ok) {
    results.push({
      name: "ADMIN login",
      ok: false,
      status: adminLogin.status,
      message: adminLogin.data?.message,
    });
  } else {
    adminToken = adminLogin.data.token;
    results.push({ name: "ADMIN login", ok: true });
  }

  const empLogin = await login(EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
  if (!empLogin.ok) {
    results.push({
      name: "EMPLOYEE login",
      ok: false,
      status: empLogin.status,
      message: empLogin.data?.message,
    });
  } else {
    results.push({ name: "EMPLOYEE login", ok: true });
  }
  const empToken = empLogin.data?.token || "";

  if (empToken) {
    const me = await request("/me", {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    const empRoleOk = me.ok && me.data?.role === "EMPLOYEE";
    results.push({
      name: "EMPLOYEE /me role",
      ok: empRoleOk,
      status: me.status,
      message: me.data?.role,
    });

    const trial = await request("/billing/start-trial", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${empToken}`,
        "Content-Type": "application/json",
      },
    });
    const trialOk = trial.ok || trial.data?.message === "TRIAL_ALREADY_USED";
    results.push({
      name: "EMPLOYEE start-trial",
      ok: trialOk,
      status: trial.status,
      message: trial.data?.message,
    });

    const empLocations = await request("/warehouse/locations", {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    results.push({
      name: "EMPLOYEE warehouse locations",
      ok: empLocations.ok,
      status: empLocations.status,
    });

    const empItems = await request("/inventory/items", {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    results.push({
      name: "EMPLOYEE inventory items",
      ok: empItems.ok,
      status: empItems.status,
    });

    const empStock = await request("/inventory/stock", {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    results.push({
      name: "EMPLOYEE inventory stock",
      ok: empStock.ok,
      status: empStock.status,
    });

    const empMovements = await request("/inventory/movements", {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    results.push({
      name: "EMPLOYEE inventory movements",
      ok: empMovements.ok,
      status: empMovements.status,
    });

    const empRequests = await request("/warehouse/requests/my", {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    results.push({
      name: "EMPLOYEE warehouse requests",
      ok: empRequests.ok,
      status: empRequests.status,
    });

    const empAdminInvites = await request("/admin/invites", {
      headers: { Authorization: `Bearer ${empToken}` },
    });
    const empAdminForbidden =
      empAdminInvites.status === 401 || empAdminInvites.status === 403;
    results.push({
      name: "EMPLOYEE admin invites forbidden",
      ok: empAdminForbidden,
      status: empAdminInvites.status,
    });
  }

  if (adminToken) {
    const me = await request("/me", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const adminRoleOk = me.ok && me.data?.role === "ADMIN";
    results.push({
      name: "ADMIN /me role",
      ok: adminRoleOk,
      status: me.status,
      message: me.data?.role,
    });

    const users = await request("/users", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    results.push({
      name: "ADMIN list users",
      ok: users.ok,
      status: users.status,
      message: users.data?.message,
    });

    const invites = await request("/admin/invites", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    results.push({
      name: "ADMIN list invites",
      ok: invites.ok,
      status: invites.status,
      message: invites.data?.message,
    });

    const createInvite = await request("/admin/invites", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: INVITE_EMAIL, role: "EMPLOYEE" }),
    });
    results.push({
      name: "ADMIN create invite",
      ok: createInvite.ok,
      status: createInvite.status,
      message: createInvite.data?.message,
    });

    if (users.ok && Array.isArray(users.data) && users.data.length > 0) {
      const target = users.data.find((u) => u.role !== "ADMIN") || users.data[0];
      const changeRole = await request(`/users/${target.id}/role`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: target.role || "EMPLOYEE" }),
      });
      results.push({
        name: "ADMIN update user role",
        ok: changeRole.ok,
        status: changeRole.status,
        message: changeRole.data?.message,
      });
    } else {
      results.push({
        name: "ADMIN update user role",
        ok: true,
        message: "SKIPPED (no users list)",
      });
    }

    const locations = await request("/warehouse/locations", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    results.push({
      name: "ADMIN warehouse locations",
      ok: locations.ok,
      status: locations.status,
    });

    const adminRequests = await request("/warehouse/requests", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    results.push({
      name: "ADMIN warehouse requests",
      ok: adminRequests.ok,
      status: adminRequests.status,
    });

    const adminItems = await request("/inventory/items", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    results.push({
      name: "ADMIN inventory items",
      ok: adminItems.ok,
      status: adminItems.status,
    });

    const adminStock = await request("/inventory/stock", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    results.push({
      name: "ADMIN inventory stock",
      ok: adminStock.ok,
      status: adminStock.status,
    });

    const adminMovements = await request("/inventory/movements", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    results.push({
      name: "ADMIN inventory movements",
      ok: adminMovements.ok,
      status: adminMovements.status,
    });
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    const status = r.ok ? "OK" : "FAIL";
    const extra = r.message ? ` - ${r.message}` : "";
    console.log(`${status}: ${r.name}${extra}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error("Smoke check failed:", err);
  process.exitCode = 1;
});
