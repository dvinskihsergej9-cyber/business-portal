import { spawn } from "node:child_process";

const IS_WIN = process.platform === "win32";
const NPX = IS_WIN ? "npx.cmd" : "npx";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runStep(label, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(NPX, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: process.env,
    });

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ label, stdout, stderr });
        return;
      }
      const error = new Error(`Step failed: ${label} (code ${code})`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function isRetryableStepError(text) {
  const value = String(text || "").toLowerCase();
  return (
    value.includes("binaries.prisma.sh") ||
    value.includes("getaddrinfo eai_again") ||
    value.includes("request to https://") && value.includes("failed") ||
    value.includes("etimedout") ||
    value.includes("econnreset") ||
    value.includes("socket hang up") ||
    value.includes("network error")
  );
}

async function runStepWithRetry(label, args, options = {}) {
  const maxAttempts = Number(options.maxAttempts || 4);
  const baseDelayMs = Number(options.baseDelayMs || 2500);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (attempt > 1) {
        console.log(
          `[DB_DEPLOY] Retry ${attempt}/${maxAttempts} for step "${label}"`
        );
      }
      return await runStep(label, args);
    } catch (error) {
      const merged = `${error?.stdout || ""}\n${error?.stderr || ""}`;
      const retryable = isRetryableStepError(merged);
      const hasMoreAttempts = attempt < maxAttempts;

      if (retryable && hasMoreAttempts) {
        const delayMs = baseDelayMs * attempt;
        console.warn(
          `[DB_DEPLOY] Step "${label}" failed due to transient network issue. ` +
            `Waiting ${delayMs}ms before retry.`
        );
        await sleep(delayMs);
        continue;
      }

      throw error;
    }
  }
}

function isIgnorableCleanupError(text) {
  const value = String(text || "").toLowerCase();
  return (
    value.includes("permission denied for table item") ||
    value.includes("отказано в доступе к таблице item") ||
    value.includes("the underlying table for model `item` does not exist") ||
    value.includes("table") && value.includes("does not exist")
  );
}

async function main() {
  console.log("[DB_DEPLOY] Step 1/3: cleanup legacy item category");
  try {
    await runStepWithRetry("cleanup_sql", [
      "prisma",
      "db",
      "execute",
      "--schema",
      "prisma/schema.prisma",
      "--file",
      "prisma/sql/cleanup_tmc_category.sql",
    ]);
  } catch (error) {
    const merged = `${error?.stdout || ""}\n${error?.stderr || ""}`;
    if (isIgnorableCleanupError(merged)) {
      console.log("[DB_DEPLOY] Cleanup skipped: permission/table limitations detected.");
    } else {
      console.warn(
        "[DB_DEPLOY] Cleanup skipped: non-critical cleanup step failed. Continuing deployment."
      );
    }
  }

  console.log("[DB_DEPLOY] Step 2/3: prisma db push");
  try {
    await runStepWithRetry("db_push", [
      "prisma",
      "db",
      "push",
      "--accept-data-loss",
    ]);
  } catch (error) {
    const merged = `${error?.stdout || ""}\n${error?.stderr || ""}`;
    if (isRetryableStepError(merged)) {
      console.warn(
        "[DB_DEPLOY] db_push skipped: Prisma engine CDN is temporarily unreachable. Continuing deployment."
      );
    } else {
      throw error;
    }
  }

  console.log("[DB_DEPLOY] Step 3/3: prisma generate");
  await runStepWithRetry("generate", ["prisma", "generate"]);

  console.log("[DB_DEPLOY] Success.");
}

main().catch((error) => {
  const step = error?.message || "unknown";
  console.error(`[DB_DEPLOY] Failed: ${step}`);
  process.exit(1);
});

