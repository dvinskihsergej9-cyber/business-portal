import "dotenv/config";
import { spawn } from "node:child_process";

const IS_WIN = process.platform === "win32";
const NODE = IS_WIN ? "node.exe" : "node";

function runNodeScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, args, {
      stdio: "inherit",
      shell: false,
      env: process.env,
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => resolve(Number(code || 0)));
  });
}

async function main() {
  const skipPermissionsBootstrap =
    String(process.env.SKIP_DB_PERMISSIONS_BOOTSTRAP || "")
      .trim()
      .toLowerCase() === "true";

  if (!skipPermissionsBootstrap) {
    console.log("[START] Step 1/2: check and grant runtime DB permissions");
    const grantExitCode = await runNodeScript(["tools/grant-runtime-db-permissions.mjs"]);
    if (grantExitCode !== 0) {
      console.error(
        "[START] DB permissions bootstrap failed. Backend will not start to avoid runtime auth errors."
      );
      process.exit(grantExitCode);
    }
  } else {
    console.warn("[START] SKIP_DB_PERMISSIONS_BOOTSTRAP=true -> permissions bootstrap skipped.");
  }

  console.log("[START] Step 2/2: run API server");
  const serverExitCode = await runNodeScript(["server/index.js"]);
  process.exit(serverExitCode);
}

main().catch((error) => {
  console.error("[START] failed:", error?.message || error);
  process.exit(1);
});
