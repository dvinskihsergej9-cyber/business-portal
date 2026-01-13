const API_BASE = process.env.API_BASE || "http://localhost:3001/api";

async function checkHealth() {
  const res = await fetch(`${API_BASE}/health`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(`Health check failed: ${res.status}`);
  }
  console.log("health ok", data);
}

async function checkMe() {
  const res = await fetch(`${API_BASE}/me`);
  if (res.status === 401) {
    console.log("me ok (unauthorized as expected)");
    return;
  }
  const data = await res.json().catch(() => ({}));
  console.log("me status", res.status, data);
}

async function main() {
  await checkHealth();
  await checkMe();
}

main().catch((err) => {
  console.error("smoke test failed:", err.message || err);
  process.exitCode = 1;
});
