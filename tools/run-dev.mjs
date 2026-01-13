import { spawn } from "node:child_process";

function run(command, args, name) {
  const proc = spawn(command, args, { stdio: "inherit", shell: true });
  proc.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[dev] ${name} exited with code ${code}`);
    }
  });
  return proc;
}

const web = run("npm", ["run", "web"], "web");
const api = run("npm", ["run", "api"], "api");

const shutdown = () => {
  if (web) web.kill("SIGINT");
  if (api) api.kill("SIGINT");
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
