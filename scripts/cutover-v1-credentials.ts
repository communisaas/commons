/**
 * V1 -> V2 Credential Cutover Script
 *
 * Stage 5 (F1 closure) — one-shot migration that marks every currently-active
 * districtCredential as revoked and schedules on-chain revocation emits
 * against RevocationRegistry. Used exactly once at the v1 -> v2 cutover.
 *
 * Pre-launch assumption: see
 * voter-protocol/specs/CIRCUIT-REVISION-MIGRATION.md. Operator MUST verify
 * Commons has no production users prior to running this script with --execute.
 *
 * Idempotency: re-running the script finds only credentials still in the
 * pre-cutover state (revokedAt undefined). A credential already patched is
 * skipped; a credential whose emit failed and flipped to revocationStatus
 * 'failed' is NOT re-processed by this script — operator must investigate
 * and re-queue via convex directly.
 *
 * Usage:
 *   npx tsx scripts/cutover-v1-credentials.ts                 # dry-run (default)
 *   npx tsx scripts/cutover-v1-credentials.ts --execute       # apply changes
 *
 * Env vars required:
 *   CONVEX_URL               — Convex deployment URL
 *   CONVEX_ADMIN_KEY         — Admin key for the deployment
 */

import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

interface Options {
  execute: boolean;
  batchSize: number;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  return {
    execute: args.includes("--execute"),
    batchSize: 50,
  };
}

async function main() {
  const opts = parseArgs();
  const convexUrl = process.env.CONVEX_URL;
  const adminKey = process.env.CONVEX_ADMIN_KEY;

  if (!convexUrl || !adminKey) {
    console.error("[cutover] CONVEX_URL and CONVEX_ADMIN_KEY required.");
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl);
  (client as unknown as { setAdminAuth: (k: string) => void }).setAdminAuth(adminKey);

  console.log("=== V1 -> V2 Credential Cutover ===");
  console.log(`Mode: ${opts.execute ? "EXECUTE (will patch DB)" : "DRY RUN"}`);
  console.log("");

  // Fetch all active credentials in batches. Because this is a one-shot ops
  // script we rely on the backing query to return manageable volumes; if the
  // eventual candidate list exceeds ~10K rows, split by userId ranges.
  const candidates = await client.query(
    (api as unknown as { cutover: { listActiveCredentials: unknown } }).cutover
      .listActiveCredentials,
    {},
  );

  const typedCandidates = candidates as Array<{
    _id: Id<"districtCredentials">;
    userId: Id<"users">;
    districtCommitment?: string;
    issuedAt: number;
  }>;

  console.log(`Found ${typedCandidates.length} active credentials to cut over.`);
  const withCommitment = typedCandidates.filter((c) => Boolean(c.districtCommitment));
  const withoutCommitment = typedCandidates.filter((c) => !c.districtCommitment);
  console.log(`  With districtCommitment (schedulable on-chain): ${withCommitment.length}`);
  console.log(`  Without (server-layer only):                   ${withoutCommitment.length}`);
  console.log("");

  if (!opts.execute) {
    console.log("[DRY RUN] No changes applied. Re-run with --execute to commit.");
    console.log("");
    console.log("Summary by first 20 credentials:");
    for (const c of typedCandidates.slice(0, 20)) {
      console.log(
        `  - ${c._id}  user=${c.userId}  commitment=${c.districtCommitment ? "yes" : "no"}  issuedAt=${new Date(c.issuedAt).toISOString()}`,
      );
    }
    if (typedCandidates.length > 20) console.log(`  ... and ${typedCandidates.length - 20} more`);
    return;
  }

  let succeeded = 0;
  let scheduled = 0;
  for (let i = 0; i < typedCandidates.length; i += opts.batchSize) {
    const batch = typedCandidates.slice(i, i + opts.batchSize);
    for (const cred of batch) {
      try {
        const result = await client.mutation(
          (internal as unknown as {
            cutover: { markCredentialForCutover: unknown };
          }).cutover.markCredentialForCutover,
          { credentialId: cred._id },
        );
        succeeded += 1;
        if ((result as { scheduled?: boolean }).scheduled) scheduled += 1;
      } catch (err) {
        console.error(
          `[cutover] failed to mark ${cred._id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    console.log(
      `[cutover] processed ${Math.min(i + opts.batchSize, typedCandidates.length)}/${typedCandidates.length} (ok: ${succeeded}, scheduled emit: ${scheduled})`,
    );
  }

  console.log("");
  console.log("=== Done ===");
  console.log(`Marked revoked: ${succeeded}`);
  console.log(`On-chain emit scheduled: ${scheduled}`);
  console.log("");
  console.log(
    "Monitor convex/districtCredentials for revocationStatus transitions. Stuck-pending cron handles orphans. `failed` rows require operator attention.",
  );
}

main().catch((err) => {
  console.error("[cutover] FATAL:", err);
  process.exit(1);
});
