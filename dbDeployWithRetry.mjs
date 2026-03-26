import { spawn } from "node:child_process";

const IS_WIN = process.platform === "win32";
const NPX = IS_WIN ? "npx.cmd" : "npx";

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
    await runStep("cleanup_sql", [
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
      throw error;
    }
  }

  console.log("[DB_DEPLOY] Step 2/3: prisma db push");
  await runStep("db_push", [
    "prisma",
    "db",
    "push",
    "--accept-data-loss",
  ]);

  console.log("[DB_DEPLOY] Step 3/3: prisma generate");
  await runStep("generate", ["prisma", "generate"]);

  console.log("[DB_DEPLOY] Success.");
}

main().catch((error) => {
  const step = error?.message || "unknown";
  console.error(`[DB_DEPLOY] Failed: ${step}`);
  process.exit(1);
});

