#!/usr/bin/env node
/**
 * Bring the local dev stack up to health before the SvelteKit dev server starts.
 *
 * Each component is checked independently and only started when it is actually
 * missing, so a warm stack costs one HTTP probe and a healthy component is never
 * restarted out from under an in-flight session:
 *   1. Convex backend reachable on CONVEX_SELF_HOSTED_URL -> nothing else runs.
 *   2. Otherwise: Docker daemon, then `docker compose up -d`, then wait healthy.
 *   3. A backend that came up with zero deployment env vars is re-synced.
 *   4. platform.env / .env.local Convex URL agreement is reported, not enforced.
 *
 * Never fatal: every failure degrades to a warning so the dev server still
 * starts and frontend-only work stays unblocked.
 *
 * Usage: node scripts/dev-up.mjs   (wired to `predev`)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const BACKEND_URL =
  process.env.CONVEX_SELF_HOSTED_URL ??
  readEnvValue(".env.local", "CONVEX_SELF_HOSTED_URL") ??
  "http://127.0.0.1:3210";
const HEALTH_TIMEOUT_MS = 90_000;

function log(message) {
  process.stdout.write(`[dev-up] ${message}\n`);
}

function warn(message) {
  process.stdout.write(`[dev-up] ! ${message}\n`);
}

function readEnvValue(file, key) {
  try {
    const text = readFileSync(`${ROOT}${file}`, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      if (trimmed.slice(0, eq).trim() !== key) continue;
      return trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  } catch {
    /* missing file is not an error here */
  }
  return undefined;
}

function run(command, args, { capture = false } = {}) {
  return execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
  });
}

async function backendHealthy() {
  try {
    const response = await fetch(`${BACKEND_URL}/version`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

function dockerDaemonReady() {
  try {
    run("docker", ["info"], { capture: true });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  warn(`timed out waiting for ${label} after ${Math.round(timeoutMs / 1000)}s`);
  return false;
}

async function ensureDockerDaemon() {
  if (dockerDaemonReady()) return true;
  if (process.platform !== "darwin") {
    warn("Docker daemon is not running — start it, then re-run `npm run dev`");
    return false;
  }
  log("Docker daemon is down; launching Docker Desktop");
  try {
    run("open", ["-a", "Docker"], { capture: true });
  } catch {
    warn("could not launch Docker Desktop — start it manually");
    return false;
  }
  return waitFor(async () => dockerDaemonReady(), HEALTH_TIMEOUT_MS, "Docker daemon");
}

function deploymentEnvCount() {
  try {
    const output = run("npx", ["convex", "env", "list"], { capture: true });
    return output.split("\n").filter((line) => line.includes("=")).length;
  } catch {
    return null;
  }
}

function reportConvexUrlAgreement() {
  const platformUrl = readEnvValue(".dev.vars", "PUBLIC_CONVEX_URL");
  const staticUrl = readEnvValue(".env.local", "PUBLIC_CONVEX_URL");
  if (!platformUrl || !staticUrl) return;
  if (platformUrl !== staticUrl) {
    warn(`Convex URL split: platform.env=${platformUrl} vs .env.local=${staticUrl}`);
    warn("server-side queries and the browser client will address different deployments");
  }
}

async function main() {
  if (await backendHealthy()) {
    log(`Convex backend already healthy at ${BACKEND_URL}`);
    reportConvexUrlAgreement();
    return;
  }

  log(`Convex backend not reachable at ${BACKEND_URL}; starting local stack`);
  if (!(await ensureDockerDaemon())) return;

  try {
    run("docker", ["compose", "up", "-d"]);
  } catch {
    warn("`docker compose up -d` failed — dev server will start without Convex");
    return;
  }

  if (!(await waitFor(backendHealthy, HEALTH_TIMEOUT_MS, "Convex backend health"))) return;
  log("Convex backend healthy");

  const envCount = deploymentEnvCount();
  if (envCount === 0) {
    log("deployment has zero env vars (fresh volume); syncing");
    try {
      run("node", ["scripts/sync-convex-env-local.mjs"]);
    } catch {
      warn("env sync failed — run `node scripts/sync-convex-env-local.mjs` manually");
    }
    warn("a fresh backend also needs `npx convex dev --once` and `npm run seed`");
  } else if (envCount === null) {
    warn("could not read deployment env vars — check the Convex CLI");
  }

  reportConvexUrlAgreement();
}

await main();
