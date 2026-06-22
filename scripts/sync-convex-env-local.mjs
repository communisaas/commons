#!/usr/bin/env node
/**
 * Sync Convex-side runtime env vars into the LOCAL self-hosted backend.
 *
 * A fresh self-hosted Convex deployment starts with zero env vars. The cloud
 * deployment had them set; this script reconstructs the set for local dev by:
 *   1. Reading .env + .env.local for values the convex/ functions reference.
 *   2. Generating ORG_KEY_WRAPPING_KEY if absent, persisting it to .env.local.
 *   3. Mirroring cross-side salts (PSEUDONYMOUS_ID_SALT <- SUBMISSION_ANONYMIZATION_SALT).
 *   4. Applying local URL overrides so the container can reach the host.
 *
 * Idempotent: re-running overwrites with the same values. Safe to re-run after
 * `docker compose down -v` (which wipes deployment env vars with the data).
 *
 * Usage: node scripts/sync-convex-env-local.mjs
 */
import { readFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const ROOT = new URL("..", import.meta.url).pathname;

function parseDotenv(path) {
  const out = {};
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  // Minimal dotenv parse: KEY=VALUE, supports single/double quotes, ignores comments.
  const re = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/;
  for (const rawLine of text.split("\n")) {
    const line = rawLine;
    if (!line || line.trimStart().startsWith("#")) continue;
    const m = line.match(re);
    if (!m) continue;
    let [, key, val] = m;
    // Strip a trailing inline comment only when value is unquoted.
    if (val.startsWith('"') || val.startsWith("'")) {
      const q = val[0];
      const end = val.indexOf(q, 1);
      if (end !== -1) val = val.slice(1, end);
    } else {
      const hash = val.indexOf(" #");
      if (hash !== -1) val = val.slice(0, hash);
      val = val.trim();
    }
    out[key] = val;
  }
  return out;
}

// .env first, .env.local overrides.
const env = { ...parseDotenv(ROOT + ".env"), ...parseDotenv(ROOT + ".env.local") };

// Vars the convex/ functions read at runtime, pulled straight from dotenv. Some are
// real upstream credentials (Stripe/AWS/CWC/Gemini/...) — copied verbatim into the
// LOCAL backend because the functions genuinely need them to run. Bounded because the
// backend binds to loopback only (see docker-compose.yml); nothing here leaves the host.
const PASSTHROUGH = [
  "AWS_ACCESS_KEY_ID",
  "AWS_REGION",
  "AWS_SECRET_ACCESS_KEY",
  "BLAST_RECEIPTS_SECRET",
  "CONGRESS_API_KEY",
  "CRON_SECRET",
  "CWC_API_BASE_URL",
  "CWC_API_KEY",
  "CWC_DELIVERY_AGENT_NAME",
  "CWC_DELIVERY_AGENT_CONTACT",
  "CWC_DELIVERY_AGENT_ACKNOWLEDGEMENT_EMAIL",
  "CWC_SENATE_DELIVERY_AGENT_NAME",
  "CWC_SENATE_ACK_EMAIL",
  "GCP_PROXY_AUTH_TOKEN",
  "GCP_PROXY_URL",
  "GEMINI_API_KEY",
  "INTERNAL_API_SECRET",
  "SENTRY_DSN",
  "SENTRY_ENVIRONMENT",
  "PUBLIC_SENTRY_ENVIRONMENT",
  "SESSION_CREATION_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "UNSUBSCRIBE_SECRET",
];

const toSet = {};
for (const k of PASSTHROUGH) {
  if (env[k]) toSet[k] = env[k];
}

// Generated: org key wrapping key (32 bytes hex). Persisted to .env.local on first
// generation so every re-run reuses the SAME key (this is what makes the script
// idempotent) — regenerating it would orphan any org data already sealed under the
// previous key.
if (env.ORG_KEY_WRAPPING_KEY) {
  toSet.ORG_KEY_WRAPPING_KEY = env.ORG_KEY_WRAPPING_KEY;
} else {
  toSet.ORG_KEY_WRAPPING_KEY = randomBytes(32).toString("hex");
  appendFileSync(ROOT + ".env.local", `\nORG_KEY_WRAPPING_KEY=${toSet.ORG_KEY_WRAPPING_KEY}\n`);
  console.log("Generated ORG_KEY_WRAPPING_KEY and persisted it to .env.local.\n");
}

// Mirror: SvelteKit falls back to SUBMISSION_ANONYMIZATION_SALT, Convex reads
// PSEUDONYMOUS_ID_SALT — they must match for pseudonymous IDs to line up.
if (env.SUBMISSION_ANONYMIZATION_SALT) {
  toSet.PSEUDONYMOUS_ID_SALT = env.PSEUDONYMOUS_ID_SALT || env.SUBMISSION_ANONYMIZATION_SALT;
}

// Local URL overrides — the Convex container reaches the host via host.docker.internal.
toSet.CONVEX_AUTH_ISSUER = "http://host.docker.internal:5173";
toSet.COMMONS_INTERNAL_URL = "http://host.docker.internal:5173";
toSet.PUBLIC_BASE_URL = "http://localhost:5173";
toSet.PUBLIC_ORIGIN = "http://localhost:5173";
toSet.SHADOW_ATLAS_URL = "http://host.docker.internal:3000";

const NODE_OPTIONS = "--dns-result-order=ipv4first --no-network-family-autoselection";
const childEnv = { ...process.env, NODE_OPTIONS };

const keys = Object.keys(toSet).sort();
console.log(`Setting ${keys.length} env vars on the local Convex deployment...\n`);
let ok = 0;
for (const k of keys) {
  try {
    // Values pass as argv (the convex CLI's only interface for `env set`). On this
    // single-user local machine the values already live in .env files, so argv
    // visibility adds negligible exposure beyond what is already on disk.
    execFileSync("npx", ["convex", "env", "set", k, toSet[k]], {
      cwd: ROOT,
      env: childEnv,
      stdio: ["ignore", "ignore", "pipe"],
    });
    console.log(`  ✔ ${k}`);
    ok++;
  } catch (e) {
    console.error(`  ✖ ${k}: ${e.stderr?.toString().trim() || e.message}`);
  }
}
console.log(`\nDone: ${ok}/${keys.length} set.`);
