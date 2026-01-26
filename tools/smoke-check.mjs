import process from "process";

const API_BASE = process.env.SMOKE_API_BASE || "http://localhost:3001/api";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || "";
const EMPLOYEE_EMAIL = process.env.SMOKE_EMPLOYEE_EMAIL || "employee@test.local";
const EMPLOYEE_PASSWORD = process.env.SMOKE_EMPLOYEE_PASSWORD || "Test12345!";
const INVITE_EMAIL = process.env.SMOKE_INVITE_EMAIL || "invite@test.local";

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

async function run() {
  if (!EMPLOYEE_EMAIL || !EMPLOYEE_PASSWORD) {
    throw new Error("Missing EMPLOYEE credentials.");
  }

  let adminToken = "";
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
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
  } else {
    results.push({
      name: "ADMIN login",
      ok: true,
      message: "SKIPPED (SMOKE_ADMIN_EMAIL/PASSWORD not set)",
    });
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
    results.push({ name: "EMPLOYEE /me", ok: me.ok, status: me.status });

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
  }

  if (adminToken) {
    const me = await request("/me", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    results.push({ name: "ADMIN /me", ok: me.ok, status: me.status });

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

    const hrCreate = await request("/hr/employees", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fullName: "Smoke Test",
        position: "QA",
        department: "QA",
        hiredAt: new Date().toISOString().slice(0, 10),
      }),
    });
    results.push({
      name: "ADMIN create HR employee",
      ok: hrCreate.ok,
      status: hrCreate.status,
      message: hrCreate.data?.message,
    });

    const locations = await request("/warehouse/locations", {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    results.push({
      name: "ADMIN warehouse locations",
      ok: locations.ok,
      status: locations.status,
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
