import { query, mutation, action, internalAction, internalQuery, internalMutation, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import type { FunctionReference } from "convex/server";
import { ConvexError, getConvexSize, v, type Value } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAuth, requireOrgRole, loadOrg } from "./_authHelpers";
import { requireInternalSecret } from "./_internalAuth";
import {
  startOfMonthUTC,
  decideIndividualAuthoring,
  authoredLimitForPlan,
  AUTHORING_QUOTA_EXCEEDED,
} from "./_individualAuthoringCap";
import anchorsData from "./domain-anchors.json";
import { computeTwinEdges, computeCalibration } from "./lib/relatedness";
import { clusterTagConcepts, conceptEdges, tagConceptMap } from "./lib/tag_concepts";
import { captureToSentry } from "./_sentry";
import {
  MAX_PUBLIC_TEMPLATE_JURISDICTIONS,
  MAX_PUBLIC_TEMPLATE_SCOPES,
  validateTemplateInputBudgets,
} from "./lib/templateInputBudget";
import {
  PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS,
  PUBLIC_DISCOVERY_RELATIONS_DEBOUNCE_MS,
  PUBLIC_DISCOVERY_RELATIONS_MIN_REBUILD_INTERVAL_MS,
  commitPublicDiscoveryListPublication,
  commitPublicDiscoveryRelationsPublication,
  getPublicDiscoveryManifestRow,
  markPublicDiscoveryListAndRelationsDirty,
  markPublicDiscoveryListDirty,
  markPublicDiscoveryRelationsDirty,
  preparePublicDiscoveryListPublication,
  preparePublicDiscoveryRelationsPublication,
  reschedulePublicDiscoveryListRefresh,
  reschedulePublicDiscoveryRelationsRefresh,
  toPublicDiscoveryManifestPayload,
} from "./lib/publicDiscovery";

declare const process: { env: Record<string, string | undefined> };

const templateGeographicScopeValidator = v.union(
  v.object({ type: v.literal("international") }),
  v.object({
    type: v.literal("nationwide"),
    country: v.string(),
    displayName: v.optional(v.string()),
  }),
  v.object({
    type: v.literal("subnational"),
    country: v.string(),
    subdivision: v.optional(v.string()),
    subdivisionName: v.optional(v.string()),
    locality: v.optional(v.string()),
    displayName: v.optional(v.string()),
  }),
);

const rateLimitCheckRef = makeFunctionReference<"mutation">("_rateLimit:check") as unknown as FunctionReference<"mutation", "internal">;
const getByIdsRef = makeFunctionReference<"query">("templates:getByIds") as unknown as FunctionReference<"query", "internal">;
const textSearchRef = makeFunctionReference<"query">("templates:textSearch") as unknown as FunctionReference<"query", "internal">;
const migrateTopicEmbeddingMarkersRef = makeFunctionReference<"mutation">("templates:migrateTopicEmbeddingMarkers") as unknown as FunctionReference<
  "mutation",
  "internal"
>;
const listMissingTagEmbeddingsRef = makeFunctionReference<"query">("templates:listMissingTagEmbeddings") as unknown as FunctionReference<"query", "internal">;
const patchTagEmbeddingsRef = makeFunctionReference<"mutation">("templates:patchTagEmbeddings") as unknown as FunctionReference<"mutation", "internal">;
const listMissingDomainHueRef = makeFunctionReference<"query">("templates:_listMissingDomainHue") as unknown as FunctionReference<"query", "internal">;
const patchDomainHueRef = makeFunctionReference<"mutation">("templates:_patchDomainHue") as unknown as FunctionReference<"mutation", "internal">;
const reportPublicDiscoverySnapshotFailureRef = makeFunctionReference<"action">(
  "templates:reportPublicDiscoverySnapshotFailure",
) as unknown as FunctionReference<
  "action",
  "internal",
  { family: "list" | "relations"; code: string; failedAt: number },
  unknown
>;
const rebuildPublicTemplateSnapshotsForCronAttemptRef = makeFunctionReference<"mutation">(
  "templates:rebuildPublicTemplateSnapshotsForCronAttempt",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  Record<string, never>,
  | { status: "rebuilt"; rebuilt: PublicTemplateSnapshotRebuildResult }
  | { status: "oversize" }
  | { status: "invalid" }
>;
const rebuildRelationSnapshotForCronAttemptRef = makeFunctionReference<"mutation">(
  "templates:rebuildRelationSnapshotForCronAttempt",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  Record<string, never>,
  | { status: "rebuilt"; rebuilt: RelationSnapshotRebuildResult }
  | { status: "oversize" }
  | { status: "invalid" }
  | { status: "failed" }
>;
const rebuildHomepageSnapshotsForCronAttemptRef = makeFunctionReference<"mutation">(
  "templates:rebuildHomepageSnapshotsForCronAttempt",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  Record<string, never>,
  { status: "rebuilt"; rebuilt: HomepageSnapshotRebuildResult }
>;
type PublicDiscoveryCronAttemptState = {
  manifestId: Id<"publicDiscoveryManifest"> | null;
  listRevision: number;
  listUpdatedAt: number | null;
  listScheduledAt: number | null;
  relationsRevision: number;
  relationsUpdatedAt: number | null;
  relationsScheduledAt: number | null;
};
type PublicDiscoveryCronFailure = {
  family: "list" | "relations";
  code: string;
};
const recordPublicDiscoverySnapshotRuntimeFailureRef = makeFunctionReference<"mutation">(
  "templates:recordPublicDiscoverySnapshotRuntimeFailure",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  {
    failures: PublicDiscoveryCronFailure[];
    failedAt: number;
    attempt: PublicDiscoveryCronAttemptState;
  },
  unknown
>;
const publicDiscoveryCronAttemptStateRef = makeFunctionReference<"query">(
  "templates:publicDiscoveryCronAttemptState",
) as unknown as FunctionReference<
  "query",
  "internal",
  Record<string, never>,
  PublicDiscoveryCronAttemptState
>;
type ScheduledPublicDiscoveryRefreshArgs = {
  scheduledAt: number;
  bypassMinInterval?: boolean;
};
const scheduledPublicDiscoveryRefreshAttemptStateRef = makeFunctionReference<"query">(
  "templates:scheduledPublicDiscoveryRefreshAttemptState",
) as unknown as FunctionReference<
  "query",
  "internal",
  ScheduledPublicDiscoveryRefreshArgs & { family: "list" | "relations" },
  {
    current: boolean;
    rebuildsRelations: boolean;
    relationsScheduledAt?: number;
  }
>;
const flushScheduledPublicTemplateRefreshRef = makeFunctionReference<"mutation">(
  "templates:flushScheduledPublicTemplateRefresh",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  ScheduledPublicDiscoveryRefreshArgs,
  unknown
>;
const flushScheduledPublicTemplateRelationsRefreshRef = makeFunctionReference<"mutation">(
  "templates:flushScheduledPublicTemplateRelationsRefresh",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  ScheduledPublicDiscoveryRefreshArgs,
  unknown
>;
const recoverPublicDiscoveryScheduledRefreshFailureRef = makeFunctionReference<"mutation">(
  "templates:recoverPublicDiscoveryScheduledRefreshFailure",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  {
    family: "list" | "relations";
    scheduledAt: number;
    relationsScheduledAt?: number;
    code: string;
    failedAt: number;
  },
  unknown
>;

// ── Domain hue projection (cosine similarity → circular hue interpolation) ──

interface DomainAnchor { label: string; hue: number; embedding: number[] }
const DOMAIN_ANCHORS: DomainAnchor[] = anchorsData as DomainAnchor[];

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function projectToHue(embedding: number[], topK = 3): number {
  if (!embedding?.length || DOMAIN_ANCHORS.length === 0) return 0;
  const scored = DOMAIN_ANCHORS.map((a) => ({ hue: a.hue, similarity: cosineSim(embedding, a.embedding) }));
  scored.sort((a, b) => b.similarity - a.similarity);
  const top = scored.slice(0, topK);
  const minSim = Math.min(...top.map((t) => t.similarity));
  const shifted = top.map((t) => ({ hue: t.hue, weight: Math.max(0, t.similarity - minSim + 0.01) }));
  let sinSum = 0, cosSum = 0, weightSum = 0;
  for (const s of shifted) {
    const rad = (s.hue * Math.PI) / 180;
    sinSum += s.weight * Math.sin(rad);
    cosSum += s.weight * Math.cos(rad);
    weightSum += s.weight;
  }
  if (weightSum === 0) return 0;
  const angle = (Math.atan2(sinSum / weightSum, cosSum / weightSum) * 180) / Math.PI;
  return ((angle % 360) + 360) % 360;
}

// =============================================================================
// TEMPLATES — Queries & Actions
// =============================================================================

/** Resolve domain from document, falling back to pre-migration category field.
 *  Filters out "General" — the old meaningless deriveCategory() default. */
function resolveDomain(doc: any): string {
  if (doc.domain) return doc.domain;
  const cat = doc.category;
  if (cat && cat !== 'General') return cat;
  return '';
}

/**
 * Normalize a template's `topics` (stored as untyped JSON) into clean tag
 * strings: non-empty trimmed strings only, de-duplicated, stably ordered. Used
 * by the tag-embedding backfill and the concept query so both see the same tag
 * vocabulary regardless of how the raw field was authored.
 */
function normalizeTags(topics: unknown): string[] {
  if (!Array.isArray(topics)) return [];
  const seen = new Set<string>();
  for (const t of topics) {
    if (typeof t !== 'string') continue;
    const tag = t.trim();
    if (tag.length > 0) seen.add(tag);
  }
  return Array.from(seen).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function toPublicTemplate(t: Doc<"templates">, score?: number | null) {
  const projected = {
    _id: t._id,
    slug: t.slug,
    title: t.title,
    description: t.description,
    domain: resolveDomain(t),
    domainHue: t.domainHue ?? undefined,
    type: t.type,
    deliveryMethod: t.deliveryMethod,
    status: t.status,
    isPublic: t.isPublic,
    verifiedSends: t.verifiedSends < 5 ? null : t.verifiedSends,
    uniqueDistricts: t.uniqueDistricts < 3 ? null : t.uniqueDistricts,
    createdAt: new Date(t._creationTime).toISOString(),
  };
  return score === undefined ? projected : { ...projected, _score: score };
}

/**
 * Public: List published templates, ordered by creation time (newest first).
 * Paginated via Convex's built-in pagination. Embedding vectors are stripped —
 * they are server-only and must not reach the client.
 */
export const list = query({
  args: {
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("templates")
      .withIndex("by_status", (q) => q.eq("status", "published"))
      .order("desc")
      .paginate({
        numItems: Math.min(args.paginationOpts.numItems, 50),
        cursor: args.paginationOpts.cursor ?? null,
      });
    return {
      ...result,
      page: result.page.map((template) => toPublicTemplate(template)),
    };
  },
});

/**
 * Public: Get a single template by slug.
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const template = await ctx.db
      .query("templates")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!template) return null;

    // Only return published or public templates to unauthenticated users
    if (template.status !== "published" && !template.isPublic) {
      return null;
    }

    return {
      id: template._id,
      slug: template.slug,
      title: template.title,
      status: template.status,
      isPublic: template.isPublic,
    };
  },
});

type PublicTemplateSnapshotKey = "all" | "excludeCwc";
type RelationSnapshotKey = PublicTemplateSnapshotKey;
const PUBLIC_TEMPLATE_SNAPSHOT_SCAN_CAP = 250;
const PUBLIC_TEMPLATE_SNAPSHOT_VARIANT_CAP = 50;
const PUBLIC_TEMPLATE_SNAPSHOT_VALIDATION_BATCH = 50;
const PUBLIC_TEMPLATE_PROJECTION_VERSION = 4;
// TemplateCard renders three avatars. Read the newest six endorsement rows so
// filtering a possible owner endorsement still leaves a bounded display sample.
// Across the worst-case 250-row validation scan this permits <=1,500 endorsement
// rows and <=1,500 endorsement-org gets. Normal healthy corpora stop after the
// first 50-card batch. The authoritative counter travels separately; this array
// is never a total.
const PUBLIC_TEMPLATE_ENDORSEMENT_CAP = 6;
const RELATION_SNAPSHOT_VARIANT_CAP = 50;
// Fifty cards at this cap leave roughly 100 KB for the row envelope and array
// metadata below the 900 KB document guard. Exact aggregate sizing below is
// still authoritative and deterministically sheds the largest remaining card
// if a future schema expansion consumes that headroom.
const MAX_PUBLIC_TEMPLATE_CARD_BYTES = 16_000;
const MAX_PUBLIC_TEMPLATE_SNAPSHOT_BYTES = 900_000;
const DAILY_ARRIVALS_DAY_MS = 24 * 60 * 60 * 1000;

function classifyPublicTemplateSnapshotFreeze(error: unknown): "oversize" | "invalid" | null {
  if (!(error instanceof Error)) return null;
  if (error.message.startsWith("PUBLIC_TEMPLATE_SNAPSHOT_TOO_LARGE:")) return "oversize";
  if (error.message.startsWith("PUBLIC_TEMPLATE_SNAPSHOT_NO_VALID_CARDS:")) return "invalid";
  if (error.message.startsWith("PUBLIC_TEMPLATE_SNAPSHOT_INVALID:")) return "invalid";
  return null;
}

/** Emit the out-of-band alert scheduled by a failed snapshot mutation. */
export const reportPublicDiscoverySnapshotFailure = internalAction({
  args: {
    family: v.union(v.literal("list"), v.literal("relations")),
    code: v.string(),
    failedAt: v.number(),
  },
  handler: async (_ctx, args) => {
    await captureToSentry(new Error(args.code), {
      action: "templates:publicDiscoverySnapshotRebuild",
      level: "error",
      extra: { family: args.family, failedAt: args.failedAt, code: args.code },
    });
    return { reported: true };
  },
});

async function recordPublicDiscoverySnapshotFailure(
  ctx: MutationCtx,
  manifest: Doc<"publicDiscoveryManifest">,
  family: "list" | "relations",
  error: Error,
  failedAt: number,
  previousFailure?: { code?: string; failedAt?: number },
  expectedScheduledAt?: number | null,
): Promise<void> {
  const code = error.message.slice(0, 500);
  const currentCode =
    family === "list" ? manifest.listFailureCode : manifest.relationsFailureCode;
  const currentFailedAt =
    family === "list" ? manifest.listFailureAt : manifest.relationsFailureAt;
  const priorCode = previousFailure === undefined ? currentCode : previousFailure.code;
  const priorFailedAt =
    previousFailure === undefined ? currentFailedAt : previousFailure.failedAt;
  const repeatedFailure = priorCode === code && priorFailedAt !== undefined;
  const durableFailedAt = repeatedFailure ? priorFailedAt : failedAt;
  const currentScheduledAt =
    family === "list" ? manifest.listRefreshScheduledAt : manifest.relationsRefreshScheduledAt;
  const mayClearScheduledToken =
    expectedScheduledAt === undefined ||
    currentScheduledAt === (expectedScheduledAt === null ? undefined : expectedScheduledAt);

  // A successful-but-degraded publication first clears the old failure in its
  // commit marker, then calls this helper with `previousFailure`. If the exact
  // same unsafe source rows are still present, retain their original evidence
  // without re-dirtying the just-published revision or emitting another alert.
  // A source write will dirty the family again, while the daily supervisor can
  // still prove whether the degradation has been repaired.
  const listDirtyAt =
    repeatedFailure && previousFailure !== undefined
      ? undefined
      : manifest.listDirtyAt ?? failedAt;
  const relationsDirtyAt =
    repeatedFailure && previousFailure !== undefined
      ? undefined
      : manifest.relationsDirtyAt ?? failedAt;
  await ctx.db.patch(
    manifest._id,
    family === "list"
      ? {
          listDirtyAt,
          ...(mayClearScheduledToken ? { listRefreshScheduledAt: undefined } : {}),
          listFailureAt: durableFailedAt,
          listFailureCode: code,
        }
      : {
          relationsDirtyAt,
          ...(mayClearScheduledToken ? { relationsRefreshScheduledAt: undefined } : {}),
          relationsFailureAt: durableFailedAt,
          relationsFailureCode: code,
        },
  );
  if (!repeatedFailure) {
    await ctx.scheduler.runAfter(0, reportPublicDiscoverySnapshotFailureRef, {
      family,
      code,
      failedAt,
    });
  }
}

async function freezePublicDiscoverySnapshotFailure(
  ctx: MutationCtx,
  family: "list" | "relations",
  error: Error,
  failedAt: number,
  expectedScheduledAt?: number | null,
): Promise<void> {
  let manifest = await getPublicDiscoveryManifestRow(ctx);
  if (!manifest) {
    // A first-ever cron can fail before a manifest exists. Create the tiny
    // dirty control row through the normal scheduler path. An in-transaction
    // deterministic freeze clears that token; guarded action recovery retains
    // it because the cron observed no token before the failed attempt.
    if (family === "list") {
      await markPublicDiscoveryListDirty(ctx, failedAt);
    } else {
      await markPublicDiscoveryRelationsDirty(ctx, failedAt);
    }
    manifest = await getPublicDiscoveryManifestRow(ctx);
  }
  if (!manifest) throw error;

  await recordPublicDiscoverySnapshotFailure(
    ctx,
    manifest,
    family,
    error,
    failedAt,
    undefined,
    expectedScheduledAt,
  );
  console.error(
    `[public-discovery] ${family} snapshot frozen at last-good until the next source write or daily cron: ${error.message}`,
  );
}

/** Persist a failure observed outside the failed rebuild mutation transaction. */
export const recordPublicDiscoverySnapshotRuntimeFailure = internalMutation({
  args: {
    failures: v.array(
      v.object({
        family: v.union(v.literal("list"), v.literal("relations")),
        code: v.string(),
      }),
    ),
    failedAt: v.number(),
    attempt: v.object({
      manifestId: v.union(v.id("publicDiscoveryManifest"), v.null()),
      listRevision: v.number(),
      listUpdatedAt: v.union(v.number(), v.null()),
      listScheduledAt: v.union(v.number(), v.null()),
      relationsRevision: v.number(),
      relationsUpdatedAt: v.union(v.number(), v.null()),
      relationsScheduledAt: v.union(v.number(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const manifest = await getPublicDiscoveryManifestRow(ctx);
    const sameManifest = (manifest?._id ?? null) === args.attempt.manifestId;
    const eligible = sameManifest
      ? args.failures.filter(({ family }, index, failures) => {
          if (failures.findIndex((failure) => failure.family === family) !== index) return false;
          return family === "list"
            ? (manifest?.listRevision ?? 0) === args.attempt.listRevision &&
                (manifest?.listUpdatedAt ?? null) === args.attempt.listUpdatedAt
            : (manifest?.relationsRevision ?? 0) === args.attempt.relationsRevision &&
                (manifest?.relationsUpdatedAt ?? null) === args.attempt.relationsUpdatedAt;
        })
      : [];

    // Compute eligibility before the first freeze. A first-ever composite cron
    // has no manifest; recording the list failure creates one, but the sibling
    // relation failure still belongs to the same absent-manifest attempt.
    const recorded: Array<"list" | "relations"> = [];
    for (const failure of eligible) {
      await freezePublicDiscoverySnapshotFailure(
        ctx,
        failure.family,
        new Error(failure.code.slice(0, 500)),
        args.failedAt,
        failure.family === "list"
          ? args.attempt.listScheduledAt
          : args.attempt.relationsScheduledAt,
      );
      recorded.push(failure.family);
    }
    return { recorded };
  },
});

/** Capture publication identity, coordinates, and tokens before a cron attempt. */
export const publicDiscoveryCronAttemptState = internalQuery({
  args: {},
  handler: async (ctx) => {
    const manifest = await ctx.db
      .query("publicDiscoveryManifest")
      .withIndex("by_key", (q) => q.eq("key", "public"))
      .unique();
    return {
      manifestId: manifest?._id ?? null,
      listRevision: manifest?.listRevision ?? 0,
      listUpdatedAt: manifest?.listUpdatedAt ?? null,
      listScheduledAt: manifest?.listRefreshScheduledAt ?? null,
      relationsRevision: manifest?.relationsRevision ?? 0,
      relationsUpdatedAt: manifest?.relationsUpdatedAt ?? null,
      relationsScheduledAt: manifest?.relationsRefreshScheduledAt ?? null,
    };
  },
});

/**
 * Capture the tokens a supervised scheduled attempt is about to consume.
 *
 * The action/mutation boundary is intentional: if the rebuild transaction
 * rolls back after a database-write failure, the supervising action still has
 * the exact pre-attempt tokens needed to record the failure without clearing a
 * newer generation scheduled by a concurrent source write.
 */
export const scheduledPublicDiscoveryRefreshAttemptState = internalQuery({
  args: {
    family: v.union(v.literal("list"), v.literal("relations")),
    scheduledAt: v.number(),
  },
  handler: async (ctx, args) => {
    const manifest = await ctx.db
      .query("publicDiscoveryManifest")
      .withIndex("by_key", (q) => q.eq("key", "public"))
      .unique();
    const current =
      args.family === "list"
        ? manifest?.listRefreshScheduledAt === args.scheduledAt
        : manifest?.relationsRefreshScheduledAt === args.scheduledAt;
    const rebuildsRelations =
      args.family === "list" && current && manifest?.relationsDirtyAt !== undefined;

    return {
      current,
      rebuildsRelations,
      ...(rebuildsRelations && manifest?.relationsRefreshScheduledAt !== undefined
        ? { relationsScheduledAt: manifest.relationsRefreshScheduledAt }
        : {}),
    };
  },
});

/**
 * Persist an unknown scheduled rebuild failure after its mutation rolled back.
 * Token equality is the authority to clear a job: a newer writer-owned token
 * is never touched. A failed composite list attempt records both affected
 * families so neither elapsed token can spin or silently disappear.
 */
export const recoverPublicDiscoveryScheduledRefreshFailure = internalMutation({
  args: {
    family: v.union(v.literal("list"), v.literal("relations")),
    scheduledAt: v.number(),
    relationsScheduledAt: v.optional(v.number()),
    code: v.string(),
    failedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const manifest = await getPublicDiscoveryManifestRow(ctx);
    if (!manifest) return { recorded: [] as Array<"list" | "relations"> };

    const recorded: Array<"list" | "relations"> = [];
    if (args.family === "list" && manifest.listRefreshScheduledAt === args.scheduledAt) {
      await recordPublicDiscoverySnapshotFailure(
        ctx,
        manifest,
        "list",
        new Error(args.code.slice(0, 500)),
        args.failedAt,
      );
      recorded.push("list");
    }

    if (args.family === "relations" && manifest.relationsRefreshScheduledAt === args.scheduledAt) {
      await recordPublicDiscoverySnapshotFailure(
        ctx,
        manifest,
        "relations",
        new Error(args.code.slice(0, 500)),
        args.failedAt,
      );
      recorded.push("relations");
    } else if (
      args.family === "list" &&
      args.relationsScheduledAt !== undefined &&
      manifest.relationsRefreshScheduledAt === args.relationsScheduledAt
    ) {
      await recordPublicDiscoverySnapshotFailure(
        ctx,
        manifest,
        "relations",
        new Error(`PUBLIC_DISCOVERY_RELATIONS_COMPOSITE_REBUILD_FAILED:${args.code}`.slice(0, 500)),
        args.failedAt,
      );
      recorded.push("relations");
    }

    return { recorded };
  },
});

async function superviseScheduledPublicDiscoveryRefresh(
  ctx: ActionCtx,
  family: "list" | "relations",
  attempt: FunctionReference<"mutation", "internal", ScheduledPublicDiscoveryRefreshArgs, unknown>,
  args: ScheduledPublicDiscoveryRefreshArgs,
) {
  let relationsScheduledAt: number | undefined;
  try {
    const state = await ctx.runQuery(scheduledPublicDiscoveryRefreshAttemptStateRef, {
      family,
      scheduledAt: args.scheduledAt,
    });
    if (state.current && state.rebuildsRelations) {
      relationsScheduledAt = state.relationsScheduledAt;
    }
    return await ctx.runMutation(attempt, args);
  } catch (error) {
    const failedAt = Date.now();
    const message = error instanceof Error ? error.message : String(error);
    await ctx.runMutation(recoverPublicDiscoveryScheduledRefreshFailureRef, {
      family,
      scheduledAt: args.scheduledAt,
      ...(relationsScheduledAt !== undefined ? { relationsScheduledAt } : {}),
      code: `PUBLIC_DISCOVERY_${family.toUpperCase()}_SCHEDULED_REBUILD_FAILED:${message}`.slice(
        0,
        500,
      ),
      failedAt,
    });
    throw error;
  }
}

/** Durable supervisor for the list token scheduled by publicDiscovery.ts. */
export const superviseScheduledPublicTemplateRefresh = internalAction({
  args: { scheduledAt: v.number(), bypassMinInterval: v.optional(v.boolean()) },
  handler: async (ctx, args) =>
    await superviseScheduledPublicDiscoveryRefresh(
      ctx,
      "list",
      flushScheduledPublicTemplateRefreshRef,
      args,
    ),
});

/** Durable supervisor for the relation token scheduled by publicDiscovery.ts. */
export const superviseScheduledPublicTemplateRelationsRefresh = internalAction({
  args: { scheduledAt: v.number(), bypassMinInterval: v.optional(v.boolean()) },
  handler: async (ctx, args) =>
    await superviseScheduledPublicDiscoveryRefresh(
      ctx,
      "relations",
      flushScheduledPublicTemplateRelationsRefreshRef,
      args,
    ),
});

async function supervisePublicDiscoveryCronRebuild<Result>(
  ctx: ActionCtx,
  family: "list" | "relations",
  attempt: FunctionReference<"mutation", "internal", Record<string, never>, Result>,
): Promise<Result> {
  // The failed attempt rolls back, then recovery runs in a fresh transaction.
  // Capture publication coordinates first so recovery cannot re-dirty a newer
  // successful generation or clear a successor token from a source writer.
  const attemptState = await ctx.runQuery(publicDiscoveryCronAttemptStateRef, {});
  try {
    return await ctx.runMutation(attempt, {});
  } catch (error) {
    const failedAt = Date.now();
    const message = error instanceof Error ? error.message : String(error);
    await ctx.runMutation(recordPublicDiscoverySnapshotRuntimeFailureRef, {
      failures: [
        {
          family,
          code: `PUBLIC_DISCOVERY_${family.toUpperCase()}_REBUILD_FAILED:${message}`.slice(0, 500),
        },
      ],
      failedAt,
      attempt: attemptState,
    });
    throw error;
  }
}

/**
 * Align a stored oldest-first rolling arrival window with the materialization
 * day without mutating the source template. Arrival writes shift the window
 * when traffic resumes; this projection also ages it on quiet templates so an
 * old final bucket cannot continue to look like today's activity indefinitely.
 * Legacy rows without dailyArrivalsLastDay retain their existing shape because
 * there is no truthful anchor from which to infer elapsed days.
 */
function normalizeDailyArrivalsForSnapshot(
  arrivals: number[] | undefined,
  lastDay: number | undefined,
  materializedAt: number,
): number[] {
  if (!arrivals || arrivals.length === 0) return [];
  if (lastDay === undefined || !Number.isFinite(lastDay)) return [...arrivals];

  const currentDay = Math.floor(materializedAt / DAILY_ARRIVALS_DAY_MS) * DAILY_ARRIVALS_DAY_MS;
  const anchoredDay = Math.floor(lastDay / DAILY_ARRIVALS_DAY_MS) * DAILY_ARRIVALS_DAY_MS;
  const elapsedDays = Math.floor((currentDay - anchoredDay) / DAILY_ARRIVALS_DAY_MS);
  if (elapsedDays <= 0) return [...arrivals];
  if (elapsedDays >= arrivals.length) return new Array<number>(arrivals.length).fill(0);

  return [
    ...arrivals.slice(elapsedDays),
    ...new Array<number>(elapsedDays).fill(0),
  ];
}

/**
 * Build the existing `listPublic` projection over a bounded, already-selected
 * source set. This helper is mutation-only: public requests must read the
 * materialized payload and never call it.
 */
async function enrichPublicTemplates(ctx: MutationCtx, templates: Doc<"templates">[]) {
  const templateIds = templates.map((t) => t._id);

  // Batch-fetch related data in parallel
  const [allDebates, allEndorsements, orgMap] = await Promise.all([
    // Debates for these templates
    Promise.all(
      templateIds.map((tid) =>
        ctx.db
          .query("debates")
          .withIndex("by_templateId", (q) => q.eq("templateId", tid))
          .order("desc")
          .first(),
      ),
    ),
    // Endorsements for these templates
    Promise.all(
      templateIds.map((tid) =>
        ctx.db
          .query("templateEndorsements")
          .withIndex("by_templateId", (q) => q.eq("templateId", tid))
          .order("desc")
          .take(PUBLIC_TEMPLATE_ENDORSEMENT_CAP),
      ),
    ),
    // Collect unique orgIds and batch-fetch orgs
    (async () => {
      const orgIds = new Set<Id<"organizations">>();
      for (const t of templates) {
        if (t.orgId) orgIds.add(t.orgId);
      }
      const orgs = await Promise.all([...orgIds].map((id) => ctx.db.get(id)));
      const map = new Map<string, { name: string; slug: string; avatar: string | null }>();
      for (const org of orgs) {
        if (org) {
          map.set(org._id, { name: org.name, slug: org.slug, avatar: org.avatar ?? null });
        }
      }
      return map;
    })(),
  ]);

  // Also fetch orgs from endorsements
  const endorsementOrgIds = new Set<Id<"organizations">>();
  for (const endorsements of allEndorsements) {
    for (const e of endorsements) {
      endorsementOrgIds.add(e.orgId);
    }
  }
  // Remove already-fetched orgIds
  for (const key of orgMap.keys()) {
    endorsementOrgIds.delete(key as Id<"organizations">);
  }
  // Fetch remaining endorsement orgs
  const extraOrgs = await Promise.all([...endorsementOrgIds].map((id) => ctx.db.get(id)));
  for (const org of extraOrgs) {
    if (org) {
      orgMap.set(org._id, { name: org.name, slug: org.slug, avatar: org.avatar ?? null });
    }
  }

  // Build enriched results
  const materializedAt = Date.now();
  return templates.map((template, i) => {
    const debate = allDebates[i];
    const endorsements = allEndorsements[i] ?? [];
    const endorsementCount = template.endorsementCount ?? endorsements.length;

    // Endorsing org (template owner)
    const endorsingOrg = template.orgId ? (orgMap.get(template.orgId) ?? null) : null;

    // Additional endorsing orgs (excluding the template owner)
    const endorsingOrgs = endorsements
      .filter((e) => e.orgId !== template.orgId)
      .map((e) => orgMap.get(e.orgId))
      .filter((o): o is NonNullable<typeof o> => o != null);

    // Debate summary
    const hasActiveDebate = debate?.status === "active";
    // debate.status was tightened to a closed union; the prior
    // `!== "cancelled"` defensive check is now dead (the validator
    // would reject any row with that value at write time). Keep the
    // null-guard on `debate` itself; drop the obsolete value check.
    const debateSummary = debate
      ? {
          status: debate.status,
          winningStance: debate.winningStance ?? undefined,
          uniqueParticipants: (debate.uniqueParticipants ?? 0) < 5 ? null : (debate.uniqueParticipants ?? 0),
          argumentCount: (debate.argumentCount ?? 0) < 5 ? null : (debate.argumentCount ?? 0),
          deadline: debate.deadline ? new Date(debate.deadline).toISOString() : undefined,
        }
      : undefined;

    // Coordination scale
    const sendCount = template.verifiedSends || 0;
    const coordinationScale = Math.min(1.0, Math.log10(Math.max(1, sendCount)) / 3);
    const creationTime = template._creationTime;
    const daysSinceCreation = (materializedAt - creationTime) / (1000 * 60 * 60 * 24);
    const isNew = daysSinceCreation <= 7;
    const dailyArrivals = normalizeDailyArrivalsForSnapshot(
      template.dailyArrivals,
      template.dailyArrivalsLastDay,
      materializedAt,
    );

    return {
      id: template._id,
      slug: template.slug,
      title: template.title,
      description: template.description,
      domain: resolveDomain(template),
      domainHue: template.domainHue ?? undefined,
      topics: normalizeTags(template.topics).slice(0, 200),
      type: template.type,
      deliveryMethod: template.deliveryMethod,
      subject: template.title,
      message_body: template.messageBody,
      preview: template.preview,
      endorsingOrg,
      endorsingOrgs,
      endorsementCount,
      coordinationScale,
      isNew,
      hasActiveDebate,
      debateSummary,
      // Public counters K-floor at 5 (3 for unique_districts): sub-K cohort
      // sizes name specific submitters. Above the floor, counts are exact —
      // template visibility is the product. daily_arrivals zeroes sub-K days
      // so a singleton-day doesn't reveal the day's only sender.
      verified_sends: template.verifiedSends < 5 ? null : template.verifiedSends,
      unique_districts: template.uniqueDistricts < 3 ? null : template.uniqueDistricts,
      send_count: template.verifiedSends < 5 ? null : template.verifiedSends,
      daily_arrivals: dailyArrivals.map((c: number) => (c < 5 ? 0 : c)),
      // K-anon at trust boundary: filter districts with count < 5 out of
      // the public payload, zero tier counts below the same threshold.
      // Consumers still see the visible-shape but not the thin-cohort
      // contributions. earlier hero work applied this; the per-template path
      // mirrors it so all consumers (org pages, share cards, public API,
      // future surfaces) inherit the floor without re-implementing.
      district_counts: (template.districtCounts ?? []).filter((d: { code: string; count: number }) => d.count >= 5),
      tier_counts: (template.tierCounts ?? []).map((c: number) => (c < 5 ? 0 : c)),
      // Discovery cards never execute delivery. Provider routing and CWC
      // workflow configuration are not part of any anonymous public payload.
      delivery_config: {},
      cwc_config: null,
      // Recipient addresses and decision-maker configuration are private source
      // data. Anonymous discovery needs only the non-identifying target count.
      recipient_config: null,
      recipient_count: countRecipientsConvex(template.recipientConfig),
      campaign_id: template.campaignId ?? null,
      status: template.status,
      is_public: template.isPublic,
      jurisdictions: (template.jurisdictions ?? []).map((j, ji) => ({
        id: template._id + "_j" + ji,
        template_id: template._id,
        jurisdiction_type: j.jurisdictionType,
        congressional_district: j.congressionalDistrict ?? null,
        senate_class: j.senateClass ?? null,
        state_code: j.stateCode ?? null,
        state_senate_district: j.stateSenateDistrict ?? null,
        state_house_district: j.stateHouseDistrict ?? null,
        county_fips: j.countyFips ?? null,
        county_name: j.countyName ?? null,
        city_name: j.cityName ?? null,
        city_fips: j.cityFips ?? null,
        school_district_id: j.schoolDistrictId ?? null,
        school_district_name: j.schoolDistrictName ?? null,
        latitude: j.latitude ?? null,
        longitude: j.longitude ?? null,
        estimated_population: j.estimatedPopulation ?? null,
        coverage_notes: j.coverageNotes ?? null,
      })),
      scope:
        (template.scopes ?? []).length > 0
          ? {
              id: template._id + "_s0",
              template_id: template._id,
              country_code: template.scopes![0].countryCode,
              region_code: template.scopes![0].regionCode ?? null,
              locality_code: template.scopes![0].localityCode ?? null,
              district_code: template.scopes![0].districtCode ?? null,
              display_text: template.scopes![0].displayText,
              scope_level: template.scopes![0].scopeLevel,
              confidence: template.scopes![0].confidence,
              extraction_method: template.scopes![0].extractionMethod,
            }
          : null,
      scopes: (template.scopes ?? []).map((s, si) => ({
        id: template._id + "_s" + si,
        template_id: template._id,
        country_code: s.countryCode,
        region_code: s.regionCode ?? null,
        locality_code: s.localityCode ?? null,
        district_code: s.districtCode ?? null,
        display_text: s.displayText,
        scope_level: s.scopeLevel,
        confidence: s.confidence,
        extraction_method: s.extractionMethod,
      })),
      recipientEmails: [],
      createdAt: new Date(creationTime).toISOString(),
    };
  });
}

type PublicTemplatePayload = Awaited<ReturnType<typeof enrichPublicTemplates>>[number];

/**
 * Runtime schema for producer-trusted snapshot rows.
 *
 * `publicTemplateSnapshots.templates` remains `v.any()` during the live-row
 * migration, but public readers never return a stored object or nested producer
 * object verbatim. The `Record<keyof PublicTemplatePayload, SnapshotField>`
 * constraint also makes a newly added producer field fail type-check until its
 * public exposure and runtime shape are reviewed.
 */
type SnapshotField =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "redacted"; replacement: "emptyObject" | "emptyArray" | "null" }
  | { kind: "optional"; value: SnapshotField }
  | { kind: "nullable"; value: SnapshotField }
  | { kind: "array"; value: SnapshotField; maxItems: number }
  | { kind: "object"; fields: Record<string, SnapshotField> };

type SnapshotSchemaFor<T> = {
  [K in keyof T]-?: undefined extends T[K]
    ? Extract<SnapshotField, { kind: "optional" }>
    : Exclude<SnapshotField, { kind: "optional" }>;
};

const SNAPSHOT_STRING = { kind: "string" } as const satisfies SnapshotField;
const SNAPSHOT_NUMBER = { kind: "number" } as const satisfies SnapshotField;
const SNAPSHOT_BOOLEAN = { kind: "boolean" } as const satisfies SnapshotField;
const snapshotRedacted = (
  replacement: "emptyObject" | "emptyArray" | "null",
): Extract<SnapshotField, { kind: "redacted" }> => ({ kind: "redacted", replacement });
const snapshotOptional = <T extends SnapshotField>(value: T): { kind: "optional"; value: T } => ({
  kind: "optional",
  value,
});
const snapshotNullable = <T extends SnapshotField>(value: T): { kind: "nullable"; value: T } => ({
  kind: "nullable",
  value,
});
const snapshotArray = <T extends SnapshotField>(
  value: T,
  maxItems: number,
): { kind: "array"; value: T; maxItems: number } => ({
  kind: "array",
  value,
  maxItems,
});
const snapshotObject = <T extends Record<string, SnapshotField>>(
  fields: T,
): { kind: "object"; fields: T } => ({
  kind: "object",
  fields,
});

const SNAPSHOT_ORG = snapshotObject({
  name: SNAPSHOT_STRING,
  slug: SNAPSHOT_STRING,
  avatar: snapshotNullable(SNAPSHOT_STRING),
});
const SNAPSHOT_SCOPE = snapshotObject({
  id: SNAPSHOT_STRING,
  template_id: SNAPSHOT_STRING,
  country_code: SNAPSHOT_STRING,
  region_code: snapshotNullable(SNAPSHOT_STRING),
  locality_code: snapshotNullable(SNAPSHOT_STRING),
  district_code: snapshotNullable(SNAPSHOT_STRING),
  display_text: SNAPSHOT_STRING,
  scope_level: SNAPSHOT_STRING,
  confidence: SNAPSHOT_NUMBER,
  extraction_method: SNAPSHOT_STRING,
});
const SNAPSHOT_JURISDICTION = snapshotObject({
  id: SNAPSHOT_STRING,
  template_id: SNAPSHOT_STRING,
  jurisdiction_type: SNAPSHOT_STRING,
  congressional_district: snapshotNullable(SNAPSHOT_STRING),
  senate_class: snapshotNullable(SNAPSHOT_STRING),
  state_code: snapshotNullable(SNAPSHOT_STRING),
  state_senate_district: snapshotNullable(SNAPSHOT_STRING),
  state_house_district: snapshotNullable(SNAPSHOT_STRING),
  county_fips: snapshotNullable(SNAPSHOT_STRING),
  county_name: snapshotNullable(SNAPSHOT_STRING),
  city_name: snapshotNullable(SNAPSHOT_STRING),
  city_fips: snapshotNullable(SNAPSHOT_STRING),
  school_district_id: snapshotNullable(SNAPSHOT_STRING),
  school_district_name: snapshotNullable(SNAPSHOT_STRING),
  latitude: snapshotNullable(SNAPSHOT_NUMBER),
  longitude: snapshotNullable(SNAPSHOT_NUMBER),
  estimated_population: snapshotNullable(SNAPSHOT_NUMBER),
  coverage_notes: snapshotNullable(SNAPSHOT_STRING),
});

const PUBLIC_TEMPLATE_SNAPSHOT_SCHEMA = {
  id: SNAPSHOT_STRING,
  slug: SNAPSHOT_STRING,
  title: SNAPSHOT_STRING,
  description: SNAPSHOT_STRING,
  domain: SNAPSHOT_STRING,
  domainHue: snapshotOptional(SNAPSHOT_NUMBER),
  topics: snapshotArray(SNAPSHOT_STRING, 200),
  type: SNAPSHOT_STRING,
  deliveryMethod: SNAPSHOT_STRING,
  subject: SNAPSHOT_STRING,
  message_body: SNAPSHOT_STRING,
  preview: SNAPSHOT_STRING,
  endorsingOrg: snapshotNullable(SNAPSHOT_ORG),
  endorsingOrgs: snapshotArray(SNAPSHOT_ORG, PUBLIC_TEMPLATE_ENDORSEMENT_CAP),
  endorsementCount: SNAPSHOT_NUMBER,
  coordinationScale: SNAPSHOT_NUMBER,
  isNew: SNAPSHOT_BOOLEAN,
  hasActiveDebate: SNAPSHOT_BOOLEAN,
  debateSummary: snapshotOptional(
    snapshotObject({
      status: SNAPSHOT_STRING,
      winningStance: snapshotOptional(SNAPSHOT_STRING),
      uniqueParticipants: snapshotNullable(SNAPSHOT_NUMBER),
      argumentCount: snapshotNullable(SNAPSHOT_NUMBER),
      deadline: snapshotOptional(SNAPSHOT_STRING),
    }),
  ),
  verified_sends: snapshotNullable(SNAPSHOT_NUMBER),
  unique_districts: snapshotNullable(SNAPSHOT_NUMBER),
  send_count: snapshotNullable(SNAPSHOT_NUMBER),
  daily_arrivals: snapshotArray(SNAPSHOT_NUMBER, 30),
  district_counts: snapshotArray(
    snapshotObject({ code: SNAPSHOT_STRING, count: SNAPSHOT_NUMBER }),
    500,
  ),
  tier_counts: snapshotArray(SNAPSHOT_NUMBER, 6),
  // These compatibility keys are deliberately represented as redactions in
  // the schema itself. There is no generic "config" projector that a future
  // field can accidentally use to clone producer secrets into public output.
  delivery_config: snapshotRedacted("emptyObject"),
  cwc_config: snapshotRedacted("null"),
  recipient_config: snapshotRedacted("null"),
  recipient_count: SNAPSHOT_NUMBER,
  campaign_id: snapshotNullable(SNAPSHOT_STRING),
  status: SNAPSHOT_STRING,
  is_public: SNAPSHOT_BOOLEAN,
  jurisdictions: snapshotArray(SNAPSHOT_JURISDICTION, MAX_PUBLIC_TEMPLATE_JURISDICTIONS),
  scope: snapshotNullable(SNAPSHOT_SCOPE),
  scopes: snapshotArray(SNAPSHOT_SCOPE, MAX_PUBLIC_TEMPLATE_SCOPES),
  recipientEmails: snapshotRedacted("emptyArray"),
  createdAt: SNAPSHOT_STRING,
} satisfies SnapshotSchemaFor<PublicTemplatePayload>;

const INVALID_SNAPSHOT_VALUE = Symbol("INVALID_SNAPSHOT_VALUE");

function projectSnapshotField(
  value: unknown,
  field: SnapshotField,
): unknown | typeof INVALID_SNAPSHOT_VALUE {
  switch (field.kind) {
    case "string":
      return typeof value === "string" ? value : INVALID_SNAPSHOT_VALUE;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? value
        : INVALID_SNAPSHOT_VALUE;
    case "boolean":
      return typeof value === "boolean" ? value : INVALID_SNAPSHOT_VALUE;
    case "redacted":
      return field.replacement === "emptyObject"
        ? {}
        : field.replacement === "emptyArray"
          ? []
          : null;
    case "optional":
      return projectSnapshotField(value, field.value);
    case "nullable":
      return value === null ? null : projectSnapshotField(value, field.value);
    case "array": {
      if (!Array.isArray(value) || value.length > field.maxItems) return INVALID_SNAPSHOT_VALUE;
      const projected: unknown[] = [];
      for (const item of value) {
        const next = projectSnapshotField(item, field.value);
        if (next === INVALID_SNAPSHOT_VALUE) return INVALID_SNAPSHOT_VALUE;
        projected.push(next);
      }
      return projected;
    }
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return INVALID_SNAPSHOT_VALUE;
      }
      const stored = value as Record<string, unknown>;
      const projected: Record<string, unknown> = {};
      for (const [name, nestedField] of Object.entries(field.fields)) {
        if (!Object.prototype.hasOwnProperty.call(stored, name) || stored[name] === undefined) {
          if (nestedField.kind === "optional") continue;
          return INVALID_SNAPSHOT_VALUE;
        }
        const next = projectSnapshotField(stored[name], nestedField);
        if (next === INVALID_SNAPSHOT_VALUE) return INVALID_SNAPSHOT_VALUE;
        projected[name] = next;
      }
      return projected;
    }
  }
}

function projectStoredPublicTemplate(value: unknown): PublicTemplatePayload | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const stored = value as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(PUBLIC_TEMPLATE_SNAPSHOT_SCHEMA)) {
    // Redact/minimize legacy snapshots at the public read boundary as well as
    // in the producer. The replacement travels with the field descriptor, so a
    // rename or newly reviewed config field cannot fall through to generic JSON
    // cloning merely because a hard-coded field-name list was not updated.
    if (field.kind === "redacted") {
      projected[name] = projectSnapshotField(undefined, field);
      continue;
    }
    if (name === "recipient_count" && (!Object.prototype.hasOwnProperty.call(stored, name) || stored[name] === undefined)) {
      const legacyEmailCount = Array.isArray(stored.recipientEmails) ? stored.recipientEmails.filter((email) => typeof email === "string").length : 0;
      projected[name] = Math.max(countRecipientsConvex(stored.recipient_config), legacyEmailCount);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(stored, name) || stored[name] === undefined) {
      if (field.kind === "optional") continue;
      return null;
    }
    const next = projectSnapshotField(stored[name], field);
    if (next === INVALID_SNAPSHOT_VALUE) return null;
    projected[name] = next;
  }
  return projected as PublicTemplatePayload;
}

function projectStoredPublicTemplates(
  value: unknown,
  context: { key: PublicTemplateSnapshotKey; revision: number },
): PublicTemplatePayload[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    console.error(
      `[public-discovery] PUBLIC_TEMPLATE_SNAPSHOT_STORED_INVALID:key=${context.key}:revision=${context.revision}:container=non_array`,
    );
    return [];
  }

  const templates: PublicTemplatePayload[] = [];
  let dropped = 0;
  for (const stored of value) {
    const template = projectStoredPublicTemplate(stored);
    if (template) templates.push(template);
    else dropped += 1;
  }
  if (dropped > 0) {
    // Queries cannot schedule the Sentry action without violating Convex query
    // purity. Emit one stable, counted error per read so Convex log alerts can
    // detect at-rest/manual corruption without sacrificing the valid cards.
    console.error(
      `[public-discovery] PUBLIC_TEMPLATE_SNAPSHOT_STORED_INVALID:key=${context.key}:revision=${context.revision}:dropped=${dropped}:stored=${value.length}`,
    );
  }
  return templates;
}

/**
 * Tiny public control plane for edge versioning and honest cold starts.
 *
 * No manifest row means neither snapshot family has ever published. That is
 * intentionally distinct from a successful rebuild over an empty corpus,
 * which returns `ready:true` with revision 1 and an empty payload.
 */
export const publicDiscoveryManifest = query({
  args: {},
  handler: async (ctx) => {
    const manifest = await ctx.db
      .query("publicDiscoveryManifest")
      .withIndex("by_key", (q) => q.eq("key", "public"))
      .unique();
    return toPublicDiscoveryManifestPayload(manifest);
  },
});

/** Operator detail for a producer serving a frozen or explicitly degraded revision. */
export const publicDiscoveryFailureStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const manifest = await ctx.db
      .query("publicDiscoveryManifest")
      .withIndex("by_key", (q) => q.eq("key", "public"))
      .unique();
    return {
      list: manifest?.listFailureAt === undefined ? null : { failedAt: manifest.listFailureAt, code: manifest.listFailureCode ?? "UNKNOWN" },
      relations:
        manifest?.relationsFailureAt === undefined
          ? null
          : {
              failedAt: manifest.relationsFailureAt,
              code: manifest.relationsFailureCode ?? "UNKNOWN",
            },
    };
  },
});

/**
 * Public: List public templates with enriched data for the homepage.
 *
 * Signature and successful payload are unchanged, but the request path reads
 * one compact singleton selected by `excludeCwc`. A missing snapshot is an
 * explicit not-ready error; only a published empty snapshot returns `[]`.
 * There is deliberately no live-scan fallback.
 */
export const listPublic = query({
  args: {
    excludeCwc: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<PublicTemplatePayload[]> => {
    const key: PublicTemplateSnapshotKey = args.excludeCwc ? "excludeCwc" : "all";
    const snapshot = await ctx.db
      .query("publicTemplateSnapshots")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!snapshot) {
      throw new Error(`PUBLIC_DISCOVERY_LIST_SNAPSHOT_NOT_READY:${key}`);
    }
    return projectStoredPublicTemplates(snapshot.templates, {
      key,
      revision: snapshot.revision ?? 0,
    });
  },
});

/**
 * Versioned list payload for edge consumers. Consumers compare this row's
 * revision with `publicDiscoveryManifest.list.revision` and cache only a match.
 * The manifest owns readiness, which distinguishes cold start from a valid
 * empty-corpus snapshot without adding a redundant manifest read here.
 */
export const publicDiscoveryList = query({
  args: { excludeCwc: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const key: PublicTemplateSnapshotKey = args.excludeCwc ? "excludeCwc" : "all";
    const snapshot = await ctx.db
      .query("publicTemplateSnapshots")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    return {
      projectionVersion: snapshot?.projectionVersion ?? 0,
      revision: snapshot?.revision ?? 0,
      updatedAt: snapshot?.updatedAt ?? null,
      templates: projectStoredPublicTemplates(snapshot?.templates, {
        key,
        revision: snapshot?.revision ?? 0,
      }),
    };
  },
});

type PublicTemplateSnapshotRebuildResult = {
  sourceCap: number;
  scannedCount: number;
  allCount: number;
  excludeCwcCount: number;
  invalidCount: number;
  oversizedCardCount: number;
  aggregateShedCount: number;
  excludedCount: number;
  allSnapshotBytes: number;
  excludeCwcSnapshotBytes: number;
};

type PublicDiscoveryPublication = { revision: number; updatedAt: number };

type PublicTemplateSnapshotRow = {
  key: PublicTemplateSnapshotKey;
  projectionVersion: number;
  revision: number;
  templates: PublicTemplatePayload[];
  sourceCount: number;
  updatedAt: number;
};

type PublicTemplateSnapshotPlan = {
  candidates: Doc<"templates">[];
  sources: Record<PublicTemplateSnapshotKey, Doc<"templates">[]>;
  rows: PublicTemplateSnapshotRow[];
  rowSizes: Map<PublicTemplateSnapshotKey, number>;
  invalidTemplateIds: string[];
  oversizedTemplateIds: string[];
  aggregateShedIds: string[];
  exclusionCodes: string[];
};

type PublicTemplateRelationSelection = Pick<PublicTemplateSnapshotPlan, "candidates" | "sources">;

/**
 * Build and atomically upsert both `listPublic` materializations.
 *
 * The exact `(published, public)` index removes drafts/private rows before any
 * document hydration. The descending source scan is hard-capped at 250 rows.
 * Candidates are enriched and validated in newest-first batches before either
 * variant takes its 50-card limit, so an invalid/oversized card is backfilled by
 * the next valid candidate within the same explicit I/O budget. Shared cards
 * are enriched once per batch.
 */
async function preparePublicTemplateSnapshotPlan(
  ctx: MutationCtx,
  publication: PublicDiscoveryPublication,
): Promise<PublicTemplateSnapshotPlan> {
  const candidates = await ctx.db
    .query("templates")
    .withIndex("by_status_isPublic", (q) => q.eq("status", "published").eq("isPublic", true))
    .order("desc")
    .take(PUBLIC_TEMPLATE_SNAPSHOT_SCAN_CAP);

  const invalidTemplateIds: string[] = [];
  const oversizedTemplateIds: string[] = [];
  const aggregateShedIds: string[] = [];
  const exclusionCodes: string[] = [];
  const cardBytesById = new Map<string, number>();
  const enrichedById = new Map<Id<"templates">, PublicTemplatePayload>();
  const allTemplateIds: Array<Id<"templates">> = [];
  const excludeCwcTemplateIds: Array<Id<"templates">> = [];
  const allTargetCount = Math.min(PUBLIC_TEMPLATE_SNAPSHOT_VARIANT_CAP, candidates.length);
  const excludeCwcTargetCount = Math.min(PUBLIC_TEMPLATE_SNAPSHOT_VARIANT_CAP, candidates.filter((template) => template.deliveryMethod !== "cwc").length);
  let validatedCandidateCount = 0;

  candidateScan: for (let offset = 0; offset < candidates.length; offset += PUBLIC_TEMPLATE_SNAPSHOT_VALIDATION_BATCH) {
    const needsAll = allTemplateIds.length < allTargetCount;
    const needsExcludeCwc = excludeCwcTemplateIds.length < excludeCwcTargetCount;
    if (!needsAll && !needsExcludeCwc) break;

    // Once the normal variant is full, do not pay enrichment joins for CWC
    // candidates that cannot backfill the gated variant.
    const batch = candidates
      .slice(offset, offset + PUBLIC_TEMPLATE_SNAPSHOT_VALIDATION_BATCH)
      .filter((template) => needsAll || template.deliveryMethod !== "cwc");
    const enrichedBatch = await enrichPublicTemplates(ctx, batch);
    for (const template of enrichedBatch) {
      const canFillAll = allTemplateIds.length < allTargetCount;
      const canFillExcludeCwc = template.deliveryMethod !== "cwc" && excludeCwcTemplateIds.length < excludeCwcTargetCount;
      if (!canFillAll && !canFillExcludeCwc) continue;
      validatedCandidateCount += 1;

      const projected = projectStoredPublicTemplate(template);
      if (!projected) {
        const id = String(template.id);
        invalidTemplateIds.push(id);
        exclusionCodes.push(`PUBLIC_TEMPLATE_SNAPSHOT_INVALID:${id}`);
        continue;
      }
      const cardBytes = getConvexSize(projected as unknown as Value);
      if (cardBytes > MAX_PUBLIC_TEMPLATE_CARD_BYTES) {
        const id = String(projected.id);
        oversizedTemplateIds.push(id);
        exclusionCodes.push(`PUBLIC_TEMPLATE_CARD_TOO_LARGE:${id}:${cardBytes}>${MAX_PUBLIC_TEMPLATE_CARD_BYTES}`);
        continue;
      }

      cardBytesById.set(String(projected.id), cardBytes);
      enrichedById.set(projected.id, projected);
      if (canFillAll) allTemplateIds.push(projected.id);
      if (canFillExcludeCwc) excludeCwcTemplateIds.push(projected.id);
      if (allTemplateIds.length >= allTargetCount && excludeCwcTemplateIds.length >= excludeCwcTargetCount) {
        break candidateScan;
      }
    }
  }

  const noValidCardsError = () =>
    new Error(
      `PUBLIC_TEMPLATE_SNAPSHOT_NO_VALID_CARDS:candidates=${candidates.length}:validated=${validatedCandidateCount}:` + exclusionCodes.slice(0, 3).join("|"),
    );
  if (candidates.length > 0 && allTemplateIds.length === 0) {
    throw noValidCardsError();
  }

  const projectSelectedIds = (ids: Array<Id<"templates">>) =>
    ids.flatMap((id) => {
      const projected = enrichedById.get(id);
      return projected ? [projected] : [];
    });
  const buildRows = (): PublicTemplateSnapshotRow[] => {
    const allTemplates = projectSelectedIds(allTemplateIds);
    const excludeCwcTemplates = projectSelectedIds(excludeCwcTemplateIds);
    return [
      {
        key: "all",
        projectionVersion: PUBLIC_TEMPLATE_PROJECTION_VERSION,
        revision: publication.revision,
        templates: allTemplates,
        sourceCount: allTemplates.length,
        updatedAt: publication.updatedAt,
      },
      {
        key: "excludeCwc",
        projectionVersion: PUBLIC_TEMPLATE_PROJECTION_VERSION,
        revision: publication.revision,
        templates: excludeCwcTemplates,
        sourceCount: excludeCwcTemplates.length,
        updatedAt: publication.updatedAt,
      },
    ];
  };

  // Per-card bounds make the normal 50-card case fit with headroom. The exact
  // row guard remains authoritative: if future envelope growth crosses it,
  // remove the largest card from both variants and recompute until the matched
  // revision is publishable. Every exclusion is durable failure evidence, so
  // availability recovers without silently corrupting or truncating content.
  let rows = buildRows();
  const rowSizes = new Map<PublicTemplateSnapshotKey, number>();
  while (true) {
    rowSizes.clear();
    const oversizedRow = rows.find((row) => {
      const bytes = getConvexSize(row as unknown as Value);
      rowSizes.set(row.key, bytes);
      return bytes > MAX_PUBLIC_TEMPLATE_SNAPSHOT_BYTES;
    });
    if (!oversizedRow) break;

    const oversizedBytes = rowSizes.get(oversizedRow.key)!;
    const largest = [...oversizedRow.templates].sort((a, b) => {
      const sizeDelta = (cardBytesById.get(String(b.id)) ?? 0) - (cardBytesById.get(String(a.id)) ?? 0);
      return sizeDelta || String(a.id).localeCompare(String(b.id));
    })[0];
    if (!largest) {
      throw new Error(`PUBLIC_TEMPLATE_SNAPSHOT_TOO_LARGE:${oversizedRow.key}:${oversizedBytes}>${MAX_PUBLIC_TEMPLATE_SNAPSHOT_BYTES}`);
    }

    const id = String(largest.id);
    enrichedById.delete(largest.id);
    aggregateShedIds.push(id);
    exclusionCodes.push(`PUBLIC_TEMPLATE_SNAPSHOT_AGGREGATE_SHED:${id}:${oversizedRow.key}:${oversizedBytes}>${MAX_PUBLIC_TEMPLATE_SNAPSHOT_BYTES}`);
    rows = buildRows();
  }

  if (candidates.length > 0 && rows.every((row) => row.templates.length === 0)) {
    throw noValidCardsError();
  }

  const candidatesById = new Map(candidates.map((template) => [template._id, template]));
  const projectSelectedSources = (ids: Array<Id<"templates">>) =>
    ids.flatMap((id) => {
      if (!enrichedById.has(id)) return [];
      const source = candidatesById.get(id);
      return source ? [source] : [];
    });

  return {
    candidates,
    sources: {
      all: projectSelectedSources(allTemplateIds),
      excludeCwc: projectSelectedSources(excludeCwcTemplateIds),
    },
    rows,
    rowSizes,
    invalidTemplateIds,
    oversizedTemplateIds,
    aggregateShedIds,
    exclusionCodes,
  };
}

async function publishPublicTemplateSnapshotPlan(
  ctx: MutationCtx,
  publication: PublicDiscoveryPublication,
  plan: PublicTemplateSnapshotPlan,
): Promise<PublicTemplateSnapshotRebuildResult> {
  const previousManifest = await getPublicDiscoveryManifestRow(ctx);

  for (const row of plan.rows) {
    const existing = await ctx.db
      .query("publicTemplateSnapshots")
      .withIndex("by_key", (q) => q.eq("key", row.key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("publicTemplateSnapshots", row);
    }
  }

  // The manifest revision is the commit marker. Convex mutation atomicity means
  // a later failure in the composite list+relations rebuild rolls this back too.
  await commitPublicDiscoveryListPublication(ctx, publication);

  if (plan.exclusionCodes.length > 0) {
    const manifest = await getPublicDiscoveryManifestRow(ctx);
    if (!manifest) throw new Error("PUBLIC_DISCOVERY_MANIFEST_MISSING_AFTER_LIST_PUBLICATION");
    const failure = new Error(
      plan.exclusionCodes.length === 1
        ? plan.exclusionCodes[0]
        : `PUBLIC_TEMPLATE_SNAPSHOT_EXCLUDED:${plan.exclusionCodes.join("|")}`,
    );
    await recordPublicDiscoverySnapshotFailure(
      ctx,
      manifest,
      "list",
      failure,
      publication.updatedAt,
      {
        code: previousManifest?.listFailureCode,
        failedAt: previousManifest?.listFailureAt,
      },
    );
    if (plan.oversizedTemplateIds.length === 0 && plan.aggregateShedIds.length === 0) {
      console.error(
        `[public-discovery] list revision ${publication.revision} excluded ${plan.invalidTemplateIds.length} invalid template card(s); valid cards remain available`,
      );
    } else {
      console.error(
        `[public-discovery] list revision ${publication.revision} excluded ${plan.exclusionCodes.length} unsafe or oversized template card(s); valid cards remain available`,
      );
    }
  }

  const allTemplates = plan.rows.find((row) => row.key === "all")!.templates;
  const excludeCwcTemplates = plan.rows.find((row) => row.key === "excludeCwc")!.templates;

  return {
    sourceCap: PUBLIC_TEMPLATE_SNAPSHOT_SCAN_CAP,
    scannedCount: plan.candidates.length,
    allCount: allTemplates.length,
    excludeCwcCount: excludeCwcTemplates.length,
    invalidCount: plan.invalidTemplateIds.length,
    oversizedCardCount: plan.oversizedTemplateIds.length,
    aggregateShedCount: plan.aggregateShedIds.length,
    excludedCount: plan.exclusionCodes.length,
    allSnapshotBytes: plan.rowSizes.get("all")!,
    excludeCwcSnapshotBytes: plan.rowSizes.get("excludeCwc")!,
  };
}

async function rebuildPublicTemplateSnapshotsImpl(
  ctx: MutationCtx,
): Promise<PublicTemplateSnapshotRebuildResult> {
  // Reserve the revision without mutating the manifest. It becomes visible only
  // after BOTH list rows have passed their size guards and been upserted.
  const publication = await preparePublicDiscoveryListPublication(ctx);
  const plan = await preparePublicTemplateSnapshotPlan(ctx, publication);
  return await publishPublicTemplateSnapshotPlan(ctx, publication, plan);
}

/** Internal/operator entry point for the low-cost public-list materialization. */
export const rebuildPublicTemplateSnapshots = internalMutation({
  args: {},
  handler: rebuildPublicTemplateSnapshotsImpl,
});

/** Mutation attempt supervised by the cron action below. */
export const rebuildPublicTemplateSnapshotsForCronAttempt = internalMutation({
  args: {},
  handler: async (ctx) => {
    try {
      return { status: "rebuilt" as const, rebuilt: await rebuildPublicTemplateSnapshotsImpl(ctx) };
    } catch (error) {
      const status = classifyPublicTemplateSnapshotFreeze(error);
      if (!status) throw error;
      await freezePublicDiscoverySnapshotFailure(
        ctx,
        "list",
        error as Error,
        Date.now(),
      );
      return { status };
    }
  },
});

/** Daily supervisor persists even unknown rebuild failures in a new mutation. */
export const rebuildPublicTemplateSnapshotsForCron = internalAction({
  args: {},
  handler: async (ctx) =>
    await supervisePublicDiscoveryCronRebuild(
      ctx,
      "list",
      rebuildPublicTemplateSnapshotsForCronAttemptRef,
    ),
});

/** Internal entry point used by tests/operators and future write modules. */
export const requestPublicTemplateSnapshotRefresh = internalMutation({
  args: {},
  handler: async (ctx) => markPublicDiscoveryListDirty(ctx),
});

/**
 * Coalesced write-driven list refresh.
 *
 * The first dirty write schedules one job after 60 seconds. Further writes
 * share that token. If a successful list publish happened less than six hours
 * ago, the same token is moved to the first permitted instant instead of
 * repeatedly paying the bounded enrichment joins.
 */
export const flushScheduledPublicTemplateRefresh = internalMutation({
  args: { scheduledAt: v.number(), bypassMinInterval: v.optional(v.boolean()) },
  handler: async (ctx, { scheduledAt, bypassMinInterval }) => {
    const manifest = await getPublicDiscoveryManifestRow(ctx);
    if (!manifest || manifest.listRefreshScheduledAt !== scheduledAt) {
      return { status: "superseded" as const };
    }

    if (manifest.listDirtyAt === undefined) {
      await ctx.db.patch(manifest._id, { listRefreshScheduledAt: undefined });
      return { status: "clean" as const };
    }

    const now = Date.now();
    const rebuildsRelations = manifest.relationsDirtyAt !== undefined;
    const listNextAllowedAt =
      (manifest.listUpdatedAt ?? 0) + PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS;
    const relationsNextAllowedAt = rebuildsRelations
      ? (manifest.relationsUpdatedAt ?? 0) +
        PUBLIC_DISCOVERY_RELATIONS_MIN_REBUILD_INTERVAL_MS
      : 0;
    const nextAllowedAt = Math.max(listNextAllowedAt, relationsNextAllowedAt);
    if (!bypassMinInterval && now < nextAllowedAt) {
      const nextScheduledAt = await reschedulePublicDiscoveryListRefresh(
        ctx,
        manifest,
        now,
        nextAllowedAt,
      );
      // The list job owns this deferred composite generation. Point the
      // relation token at the same supervised action without queuing another
      // relation job; any previously queued relation invocation becomes a
      // cheap superseded no-op unless it already owns this exact timestamp.
      const relationsScheduledAt = rebuildsRelations ? nextScheduledAt : undefined;
      if (relationsScheduledAt !== undefined) {
        await ctx.db.patch(manifest._id, {
          relationsRefreshScheduledAt: relationsScheduledAt,
        });
      }
      return {
        status: "deferred" as const,
        scheduledAt: nextScheduledAt,
        ...(relationsScheduledAt !== undefined ? { relationsScheduledAt } : {}),
      };
    }

    try {
      const rebuilt = rebuildsRelations
        ? await rebuildHomepageSnapshotsImpl(ctx)
        : await rebuildPublicTemplateSnapshotsImpl(ctx);
      const publishedManifest = await getPublicDiscoveryManifestRow(ctx);
      if (publishedManifest) {
        const patch: {
          listRefreshScheduledAt?: undefined;
          relationsRefreshScheduledAt?: undefined;
        } = {};
        if (publishedManifest.listRefreshScheduledAt === scheduledAt) {
          patch.listRefreshScheduledAt = undefined;
        }
        if (
          rebuildsRelations &&
          publishedManifest.relationsRefreshScheduledAt === manifest.relationsRefreshScheduledAt
        ) {
          patch.relationsRefreshScheduledAt = undefined;
        }
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(publishedManifest._id, patch);
        }
      }
      return { status: "rebuilt" as const, rebuilt };
    } catch (error) {
      // Size or runtime-schema rejection is detected before either snapshot row
      // is written. Retain the dirty/failure evidence but clear this elapsed
      // token: deterministic invalid input is retried by the next source write
      // or daily cron, not four times per day forever. Unknown database/runtime
      // failures are rethrown so Convex rolls the transaction back atomically.
      const status = classifyPublicTemplateSnapshotFreeze(error);
      if (!status) throw error;
      await freezePublicDiscoverySnapshotFailure(ctx, "list", error as Error, now);
      if (rebuildsRelations) {
        await freezePublicDiscoverySnapshotFailure(
          ctx,
          "relations",
          new Error(
            `PUBLIC_DISCOVERY_RELATIONS_BLOCKED_BY_LIST:${(error as Error).message}`.slice(
              0,
              500,
            ),
          ),
          now,
        );
      }
      return { status };
    }
  },
});

/**
 * Selector for the public-corpus normalization. Relation payloads use the same
 * `all` / `excludeCwc` keys as their list variants so every returned edge has
 * endpoints in the exact graph being displayed.
 */
const RELATEDNESS_CALIBRATION_KEY = "public";

function relationSnapshotKey(excludeCwc: boolean | undefined): RelationSnapshotKey {
  return excludeCwc ? "excludeCwc" : "all";
}

/** Leave headroom for Convex document system fields below the 1 MiB value cap. */
const MAX_RELATION_SNAPSHOT_BYTES = 900_000;

/**
 * Public: measured-twin relatedness edges over the public template set.
 *
 * Request-path invariant: this query reads exactly one compact materialized row
 * and never hydrates `templates` or the calibration centroid. The nightly
 * `rebuildRelationSnapshot` mutation owns all embedding-heavy computation.
 *
 * A missing snapshot is the honest cold-start state: return no edges. There is
 * deliberately no live-scan fallback, because a fallback would reintroduce the
 * database-I/O failure mode this materialization exists to remove.
 */
export const relatednessEdges = query({
  args: { excludeCwc: v.optional(v.boolean()) },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ a: string; b: string; score: number; kind: "twin" }>> => {
    const snapshot = await ctx.db
      .query("templateRelationSnapshots")
      .withIndex("by_key", (q) => q.eq("key", relationSnapshotKey(args.excludeCwc)))
      .unique();
    return snapshot?.twinEdges ?? [];
  },
});

/**
 * Refit the persisted relatedness normalization over the bounded homepage
 * corpus (the newest 50 published+public templates). This cap is intentionally
 * lower than the list candidate cap because `computeTwinEdges` is O(n^3*d).
 *
 * Recomputes the corpus centroid (the genre common-mode removed before scoring
 * template twins) + the calibrated threshold via the same pure helper the edge
 * query uses, and upserts the optional operator-observability singleton. The
 * relation snapshot computes its matched calibration inline, so correctness
 * and recurring freshness do not depend on this maintenance function.
 *
 * Idempotent and side-effect-free beyond the single singleton write: same
 * corpus → same centroid → same row. Guards the tiny-corpus floor — fewer than
 * two embedded public templates leaves nothing to fit a common-mode against, so
 * the write is skipped and any prior calibration is preserved rather than
 * overwritten with nonsense. Pure Convex compute, no external cost.
 */
export const recomputeRelatednessCalibration = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ updated: boolean; count: number; dim: number }> => {
    const templates = await ctx.db
      .query("templates")
      .withIndex("by_status_isPublic", (q) => q.eq("status", "published").eq("isPublic", true))
      .order("desc")
      .take(RELATION_SNAPSHOT_VARIANT_CAP);

    const items = templates
      .filter((t) => isFiniteEmbeddingVector(t.topicEmbedding))
      .map((t) => ({ id: t._id as string, embedding: t.topicEmbedding as number[] }));

    const calibration = computeCalibration(items);
    // Too thin to normalize — keep the prior calibration (if any) untouched.
    if (!calibration) {
      return { updated: false, count: items.length, dim: 0 };
    }

    const existing = await ctx.db
      .query("relatednessCalibration")
      .withIndex("by_key", (q) => q.eq("key", RELATEDNESS_CALIBRATION_KEY))
      .unique();

    const row = {
      key: RELATEDNESS_CALIBRATION_KEY,
      centroid: calibration.centroid,
      threshold: calibration.threshold,
      count: calibration.count,
      dim: calibration.dim,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, row);
    } else {
      await ctx.db.insert("relatednessCalibration", row);
    }

    return { updated: true, count: calibration.count, dim: calibration.dim };
  },
});

/**
 * Public: tag-concept relations over the public template set.
 *
 * Raw tag strings barely overlap and read as register noise, so they carry no
 * relation on their own. The nightly snapshot rebuild pools and clusters the
 * server-only per-tag embeddings; this request-path query reads only the compact
 * materialized result. From those tight concepts it returns:
 *
 *   - `conceptMap`: raw tag -> canonical concept label, for consistent display
 *     (so "libraries" and "library card" show as one topic, not two).
 *   - `edges`: `kind:'concept'` edges between templates that share a tight
 *     concept — the additive, honest edge source (subordinate to `twin`,
 *     comparable to `family`).
 *
 * Honest by construction: the same tightness gate that folds tags for display
 * grounds the edges, so a concept formed by raw-string match or register-level
 * proximity yields neither a fold nor an edge. If the corpus is too sparse to
 * form any tight cross-template concept — the honest state at the seed — the
 * `edges` array is empty. A missing snapshot also returns that same honest empty
 * shape, with no live-scan fallback. Vectors are consumed only by the rebuild and
 * NEVER leave; only labels and `{a,b,concept,kind}` tuples cross the boundary.
 */
export const conceptRelations = query({
  args: { excludeCwc: v.optional(v.boolean()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    edges: Array<{ a: string; b: string; concept: string; kind: "concept" }>;
    conceptMap: Record<string, string>;
  }> => {
    const snapshot = await ctx.db
      .query("templateRelationSnapshots")
      .withIndex("by_key", (q) => q.eq("key", relationSnapshotKey(args.excludeCwc)))
      .unique();
    if (!snapshot) return { edges: [], conceptMap: {} };

    return {
      edges: snapshot.conceptEdges,
      conceptMap: Object.fromEntries(snapshot.conceptEntries.map(({ tag, concept }) => [tag, concept])),
    };
  },
});

/**
 * One-call relation payload for the edge cache. The legacy split queries stay
 * available during rollout, but new consumers should use this shape so twin and
 * concept data can never come from different cache generations.
 */
export const publicDiscoveryRelations = query({
  args: { excludeCwc: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const key = relationSnapshotKey(args.excludeCwc);
    const snapshot = await ctx.db
      .query("templateRelationSnapshots")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!snapshot) {
      return {
        revision: 0,
        updatedAt: null,
        twinEdges: [],
        conceptRelations: { edges: [], conceptMap: {} },
      };
    }

    return {
      revision: snapshot.revision ?? 0,
      updatedAt: snapshot.updatedAt,
      twinEdges: snapshot.twinEdges,
      conceptRelations: {
        edges: snapshot.conceptEdges,
        conceptMap: Object.fromEntries(
          snapshot.conceptEntries.map(({ tag, concept }) => [tag, concept]),
        ),
      },
    };
  },
});

/**
 * Nightly materialization for both public relation variants.
 *
 * This is the ONLY request-independent path that reads the embedding-heavy
 * public template corpus. It preserves the former scoring and filtering rules
 * over an explicitly bounded discovery corpus:
 *
 * - one bounded newest-250 source scan is card-validated and backfilled before
 *   deriving the exact same at-most-50 `all` and non-CWC sets as the list;
 * - each graph consumes only edges whose endpoints are in its displayed list;
 * - twin edges fit their calibration from this exact bounded generation, so a
 *   stale optional maintenance row cannot skew a newly published snapshot;
 * - concept clustering pools one vector per distinct raw tag across that same
 *   corpus, then relates all tagged templates against the resulting concepts.
 *
 * Both compact results are size-checked before either is written. Oversized
 * derived arrays shed deterministic prefixes, publish a bounded usable graph,
 * and retain unhealthy producer evidence until a clean repair. If computation
 * or a base guard fails, Convex mutation atomicity preserves both last-good
 * rows. Public queries never fall back to this scan.
 */
type RelationSnapshotVariantRebuildResult = {
  sourceCap: number;
  sourceTemplateCount: number;
  embeddedTemplateCount: number;
  tagVectorCount: number;
  twinEdgeCount: number;
  conceptEdgeCount: number;
  conceptEntryCount: number;
  twinEdgeShedCount: number;
  conceptEdgeShedCount: number;
  conceptEntryShedCount: number;
  snapshotBytes: number;
};

type RelationSnapshotRow = {
  key: RelationSnapshotKey;
  revision: number;
  twinEdges: ReturnType<typeof computeTwinEdges>;
  conceptEdges: ReturnType<typeof conceptEdges>;
  conceptEntries: Array<{ tag: string; concept: string }>;
  sourceCap: number;
  sourceTemplateCount: number;
  embeddedTemplateCount: number;
  tagVectorCount: number;
  updatedAt: number;
};

type RelationSnapshotVariantBuild = {
  snapshot: RelationSnapshotRow;
  result: RelationSnapshotVariantRebuildResult;
  degradationCode?: string;
};

function maximumFittingPrefixLength(
  length: number,
  fits: (prefixLength: number) => boolean,
): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

function buildRelationSnapshotVariant(
  key: RelationSnapshotKey,
  templates: Doc<"templates">[],
  publication: PublicDiscoveryPublication,
): RelationSnapshotVariantBuild {
  // Measured twins: missing embeddings contribute no edge, exactly as before.
  // Reject malformed legacy vectors before calibration: the first vector must
  // never get to redefine the canonical dimensionality for the whole corpus.
  const items = templates
    .filter((t) => isFiniteEmbeddingVector(t.topicEmbedding))
    .map((t) => ({ id: t._id as string, embedding: t.topicEmbedding as number[] }));

  // Fit the matched centroid/threshold from the exact snapshot generation.
  // This is bounded pure compute over <=50 rows and saves a database read; the
  // optional operational calibration job remains useful as observability, but
  // correctness never depends on its cadence.
  const calibration = computeCalibration(items);
  const twinEdges = computeTwinEdges(
    items,
    calibration
      ? { centroid: calibration.centroid, threshold: calibration.threshold }
      : undefined,
  );

  // Tag concepts: retain the former first-occurrence de-duplication and stable
  // template/tag traversal order so a rebuild is byte-for-byte deterministic
  // for an unchanged corpus (apart from the audit timestamp).
  const tagVectors: Array<{ tag: string; embedding: number[] }> = [];
  const taggedTemplates: Array<{ id: string; tags: string[] }> = [];
  const seenTag = new Set<string>();
  for (const template of templates) {
    const currentTags = normalizeTags(template.topics);
    const currentTagSet = new Set(currentTags);
    taggedTemplates.push({
      id: template._id as string,
      tags: currentTags,
    });
    const tagEmbeddings = Array.isArray(template.tagEmbeddings) ? template.tagEmbeddings : [];
    for (const tagEmbedding of tagEmbeddings) {
      if (
        tagEmbedding &&
        typeof tagEmbedding.tag === "string" &&
        currentTagSet.has(tagEmbedding.tag) &&
        isFiniteEmbeddingVector(tagEmbedding.embedding) &&
        !seenTag.has(tagEmbedding.tag)
      ) {
        seenTag.add(tagEmbedding.tag);
        tagVectors.push({
          tag: tagEmbedding.tag,
          embedding: tagEmbedding.embedding,
        });
      }
    }
  }

  const concepts = clusterTagConcepts(tagVectors);
  const allConceptEdges = conceptEdges(taggedTemplates, concepts);
  const allConceptEntries = Object.entries(tagConceptMap(concepts)).map(([tag, concept]) => ({
    tag,
    concept,
  }));

  const buildSnapshot = (
    retainedTwinEdges: ReturnType<typeof computeTwinEdges>,
    retainedConceptEdges: ReturnType<typeof conceptEdges>,
    retainedConceptEntries: Array<{ tag: string; concept: string }>,
  ): RelationSnapshotRow => ({
    key,
    revision: publication.revision,
    twinEdges: retainedTwinEdges,
    conceptEdges: retainedConceptEdges,
    conceptEntries: retainedConceptEntries,
    sourceCap: RELATION_SNAPSHOT_VARIANT_CAP,
    sourceTemplateCount: templates.length,
    embeddedTemplateCount: items.length,
    tagVectorCount: tagVectors.length,
    updatedAt: publication.updatedAt,
  });
  const measureSnapshot = (
    retainedTwinEdges: ReturnType<typeof computeTwinEdges>,
    retainedConceptEdges: ReturnType<typeof conceptEdges>,
    retainedConceptEntries: Array<{ tag: string; concept: string }>,
  ) =>
    getConvexSize(
      buildSnapshot(
        retainedTwinEdges,
        retainedConceptEdges,
        retainedConceptEntries,
      ) as unknown as Value,
    );

  let retainedTwinEdges = twinEdges;
  let retainedConceptEdges = allConceptEdges;
  let retainedConceptEntries = allConceptEntries;
  const initialSnapshotBytes = measureSnapshot(
    retainedTwinEdges,
    retainedConceptEdges,
    retainedConceptEntries,
  );

  if (initialSnapshotBytes > MAX_RELATION_SNAPSHOT_BYTES) {
    // Preserve the primary measured-twin graph first. Concept edges are
    // additive, followed by the display-only concept map, and weakest twins
    // are the last resort. Every array already has a deterministic quality
    // order; binary-searching prefixes bounds fitting work and keeps rebuilds
    // byte-stable for an unchanged corpus.
    const conceptEdgeCount = maximumFittingPrefixLength(
      retainedConceptEdges.length,
      (count) =>
        measureSnapshot(
          retainedTwinEdges,
          retainedConceptEdges.slice(0, count),
          retainedConceptEntries,
        ) <= MAX_RELATION_SNAPSHOT_BYTES,
    );
    retainedConceptEdges = retainedConceptEdges.slice(0, conceptEdgeCount);

    if (
      measureSnapshot(retainedTwinEdges, retainedConceptEdges, retainedConceptEntries) >
      MAX_RELATION_SNAPSHOT_BYTES
    ) {
      const conceptEntryCount = maximumFittingPrefixLength(
        retainedConceptEntries.length,
        (count) =>
          measureSnapshot(
            retainedTwinEdges,
            retainedConceptEdges,
            retainedConceptEntries.slice(0, count),
          ) <= MAX_RELATION_SNAPSHOT_BYTES,
      );
      retainedConceptEntries = retainedConceptEntries.slice(0, conceptEntryCount);
    }

    if (
      measureSnapshot(retainedTwinEdges, retainedConceptEdges, retainedConceptEntries) >
      MAX_RELATION_SNAPSHOT_BYTES
    ) {
      const twinEdgeCount = maximumFittingPrefixLength(
        retainedTwinEdges.length,
        (count) =>
          measureSnapshot(
            retainedTwinEdges.slice(0, count),
            retainedConceptEdges,
            retainedConceptEntries,
          ) <= MAX_RELATION_SNAPSHOT_BYTES,
      );
      retainedTwinEdges = retainedTwinEdges.slice(0, twinEdgeCount);
    }
  }

  const snapshot = buildSnapshot(
    retainedTwinEdges,
    retainedConceptEdges,
    retainedConceptEntries,
  );
  // RelationEdge/ConceptEdge are nominal interfaces without Value's index
  // signature, but every field above is a concrete Convex value.
  const snapshotBytes = getConvexSize(snapshot as unknown as Value);
  if (snapshotBytes > MAX_RELATION_SNAPSHOT_BYTES) {
    throw new Error(
      `RELATION_SNAPSHOT_TOO_LARGE:${key}:${snapshotBytes}>${MAX_RELATION_SNAPSHOT_BYTES}`,
    );
  }

  const twinEdgeShedCount = twinEdges.length - retainedTwinEdges.length;
  const conceptEdgeShedCount = allConceptEdges.length - retainedConceptEdges.length;
  const conceptEntryShedCount = allConceptEntries.length - retainedConceptEntries.length;
  const degradationCode =
    twinEdgeShedCount + conceptEdgeShedCount + conceptEntryShedCount > 0
      ? `RELATION_SNAPSHOT_DEGRADED:${key}:initial=${initialSnapshotBytes}:final=${snapshotBytes}:twin=${twinEdgeShedCount}:concept=${conceptEdgeShedCount}:entries=${conceptEntryShedCount}`
      : undefined;

  return {
    snapshot,
    degradationCode,
    result: {
      sourceCap: RELATION_SNAPSHOT_VARIANT_CAP,
      sourceTemplateCount: templates.length,
      embeddedTemplateCount: items.length,
      tagVectorCount: tagVectors.length,
      twinEdgeCount: retainedTwinEdges.length,
      conceptEdgeCount: retainedConceptEdges.length,
      conceptEntryCount: retainedConceptEntries.length,
      twinEdgeShedCount,
      conceptEdgeShedCount,
      conceptEntryShedCount,
      snapshotBytes,
    },
  };
}

type RelationSnapshotRebuildResult = {
  sourceScanCap: number;
  scannedCount: number;
  all: RelationSnapshotVariantRebuildResult;
  excludeCwc: RelationSnapshotVariantRebuildResult;
};

type HomepageSnapshotRebuildResult = {
  list: PublicTemplateSnapshotRebuildResult;
  relations: RelationSnapshotRebuildResult;
};

type PreparedRelationSnapshotRebuild = {
  publication: PublicDiscoveryPublication;
  selection: PublicTemplateRelationSelection;
  variants: Record<RelationSnapshotKey, RelationSnapshotVariantBuild>;
  existingRows: Record<RelationSnapshotKey, Doc<"templateRelationSnapshots"> | null>;
};

function normalizeRelationSnapshotError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function classifyRelationSnapshotFreeze(error: Error): "oversize" | "invalid" | "failed" {
  if (error.message.startsWith("RELATION_SNAPSHOT_TOO_LARGE:")) return "oversize";
  const listStatus = classifyPublicTemplateSnapshotFreeze(error);
  if (listStatus === "oversize") return "oversize";
  if (listStatus === "invalid") return "invalid";
  return "failed";
}

type PublicDiscoveryDatabaseReader = QueryCtx["db"];

/**
 * Resolve the exact template IDs in the currently published list generation.
 * Relation rebuilds and tag maintenance share this tiny control/list read so
 * neither needs another published-corpus index scan.
 */
async function readPublishedPublicTemplateIds(ctx: {
  db: PublicDiscoveryDatabaseReader;
}): Promise<Record<PublicTemplateSnapshotKey, Array<Id<"templates">>>> {
  const manifest = await ctx.db
    .query("publicDiscoveryManifest")
    .withIndex("by_key", (q) => q.eq("key", "public"))
    .unique();
  if (!manifest?.listReady || manifest.listUpdatedAt === undefined) {
    throw new Error("PUBLIC_TEMPLATE_SNAPSHOT_INVALID:relations:list-not-ready");
  }

  const rows = {
    all: await ctx.db
      .query("publicTemplateSnapshots")
      .withIndex("by_key", (q) => q.eq("key", "all"))
      .unique(),
    excludeCwc: await ctx.db
      .query("publicTemplateSnapshots")
      .withIndex("by_key", (q) => q.eq("key", "excludeCwc"))
      .unique(),
  };
  const idsByKey = {} as Record<PublicTemplateSnapshotKey, Array<Id<"templates">>>;
  for (const key of ["all", "excludeCwc"] as const) {
    const row = rows[key];
    if (
      !row ||
      row.projectionVersion !== PUBLIC_TEMPLATE_PROJECTION_VERSION ||
      row.revision !== manifest.listRevision ||
      row.updatedAt !== manifest.listUpdatedAt
    ) {
      throw new Error(`PUBLIC_TEMPLATE_SNAPSHOT_INVALID:relations:published-generation:${key}`);
    }
    idsByKey[key] = projectStoredPublicTemplates(row.templates, {
      key,
      revision: row.revision,
    }).map((template) => {
      const id = ctx.db.normalizeId("templates", String(template.id));
      if (!id) {
        throw new Error(`PUBLIC_TEMPLATE_SNAPSHOT_INVALID:relations:template-id:${key}`);
      }
      return id;
    });
  }

  return idsByKey;
}

async function preparePublishedPublicTemplateRelationSelection(
  ctx: MutationCtx,
): Promise<PublicTemplateRelationSelection> {
  const idsByKey = await readPublishedPublicTemplateIds(ctx);

  const uniqueIds = [...new Set([...idsByKey.all, ...idsByKey.excludeCwc])];
  const hydrated = await Promise.all(uniqueIds.map(async (id) => await ctx.db.get(id)));
  const templatesById = new Map(
    hydrated.flatMap((template) => (template ? [[template._id, template] as const] : [])),
  );
  const sources = {
    all: idsByKey.all.flatMap((id) => {
      const template = templatesById.get(id);
      return template ? [template] : [];
    }),
    excludeCwc: idsByKey.excludeCwc.flatMap((id) => {
      const template = templatesById.get(id);
      return template ? [template] : [];
    }),
  };

  return { candidates: [...templatesById.values()], sources };
}

async function prepareRelationSnapshotRebuild(
  ctx: MutationCtx,
  selection?: PublicTemplateRelationSelection,
): Promise<PreparedRelationSnapshotRebuild> {
  // Reserve without advancing either manifest revision. A relation-only rebuild
  // hydrates the exact IDs in the currently published list generation; the
  // composite rebuild supplies its already-computed plan.
  const publication = await preparePublicDiscoveryRelationsPublication(ctx);
  const existingRows = {
    all: await ctx.db
      .query("templateRelationSnapshots")
      .withIndex("by_key", (q) => q.eq("key", "all"))
      .unique(),
    excludeCwc: await ctx.db
      .query("templateRelationSnapshots")
      .withIndex("by_key", (q) => q.eq("key", "excludeCwc"))
      .unique(),
  };
  const resolvedSelection =
    selection ?? (await preparePublishedPublicTemplateRelationSelection(ctx));

  // Building both variants performs every size check before the first write.
  const variants = {
    all: buildRelationSnapshotVariant("all", resolvedSelection.sources.all, publication),
    excludeCwc: buildRelationSnapshotVariant(
      "excludeCwc",
      resolvedSelection.sources.excludeCwc,
      publication,
    ),
  };

  return { publication, selection: resolvedSelection, variants, existingRows };
}

async function publishRelationSnapshotRebuild(
  ctx: MutationCtx,
  prepared: PreparedRelationSnapshotRebuild,
): Promise<RelationSnapshotRebuildResult> {
  const { publication, selection, variants, existingRows } = prepared;
  const previousManifest = await getPublicDiscoveryManifestRow(ctx);

  for (const key of ["all", "excludeCwc"] as const) {
    const existing = existingRows[key];
    if (existing) {
      await ctx.db.patch(existing._id, variants[key].snapshot);
    } else {
      await ctx.db.insert("templateRelationSnapshots", variants[key].snapshot);
    }
  }

  await commitPublicDiscoveryRelationsPublication(ctx, publication);

  const degradationCodes = (["all", "excludeCwc"] as const).flatMap((key) => {
    const code = variants[key].degradationCode;
    return code ? [code] : [];
  });
  if (degradationCodes.length > 0) {
    const manifest = await getPublicDiscoveryManifestRow(ctx);
    if (!manifest) {
      throw new Error("PUBLIC_DISCOVERY_MANIFEST_MISSING_AFTER_RELATIONS_PUBLICATION");
    }
    const failure = new Error(degradationCodes.join("|"));
    await recordPublicDiscoverySnapshotFailure(
      ctx,
      manifest,
      "relations",
      failure,
      publication.updatedAt,
      {
        code: previousManifest?.relationsFailureCode,
        failedAt: previousManifest?.relationsFailureAt,
      },
    );
    console.error(
      `[public-discovery] relation revision ${publication.revision} shed bounded payload data; retained graph remains available`,
    );
  }

  return {
    sourceScanCap: PUBLIC_TEMPLATE_SNAPSHOT_SCAN_CAP,
    scannedCount: selection.candidates.length,
    all: variants.all.result,
    excludeCwc: variants.excludeCwc.result,
  };
}

async function rebuildRelationSnapshotImpl(
  ctx: MutationCtx,
  selection?: PublicTemplateRelationSelection,
): Promise<RelationSnapshotRebuildResult> {
  return await publishRelationSnapshotRebuild(
    ctx,
    await prepareRelationSnapshotRebuild(ctx, selection),
  );
}

/** Internal/operator entry point for relation-only refreshes and the cron. */
export const rebuildRelationSnapshot = internalMutation({
  args: {},
  handler: async (ctx) => await rebuildRelationSnapshotImpl(ctx),
});

/** Mutation attempt supervised by the cron action below. */
export const rebuildRelationSnapshotForCronAttempt = internalMutation({
  args: {},
  handler: async (ctx) => {
    let prepared: PreparedRelationSnapshotRebuild;
    try {
      prepared = await prepareRelationSnapshotRebuild(ctx);
    } catch (error) {
      const normalized = normalizeRelationSnapshotError(error);
      const status = classifyRelationSnapshotFreeze(normalized);
      await freezePublicDiscoverySnapshotFailure(
        ctx,
        "relations",
        normalized,
        Date.now(),
      );
      return { status };
    }
    // Keep database-write errors throwable so this transaction rolls every
    // partial upsert back; the outer action records them in a fresh mutation.
    return {
      status: "rebuilt" as const,
      rebuilt: await publishRelationSnapshotRebuild(ctx, prepared),
    };
  },
});

/** Daily supervisor persists even unknown rebuild failures in a new mutation. */
export const rebuildRelationSnapshotForCron = internalAction({
  args: {},
  handler: async (ctx) =>
    await supervisePublicDiscoveryCronRebuild(
      ctx,
      "relations",
      rebuildRelationSnapshotForCronAttemptRef,
    ),
});

/** Internal entry point used by tests/operators and relation-affecting writers. */
export const requestPublicTemplateRelationSnapshotRefresh = internalMutation({
  args: {},
  handler: async (ctx) => markPublicDiscoveryRelationsDirty(ctx),
});

/**
 * Coalesced write-driven relation refresh.
 *
 * Topic and tag-embedding writes only dirty the compact control-plane row.
 * The first write schedules this bounded rebuild; subsequent writes reuse the
 * token, and no scheduled relation rebuild can run more than once per six-hour
 * cost window. A successful publication clears the dirty marker. Oversize and
 * runtime failures preserve the last-good relation row and leave it dirty.
 */
export const flushScheduledPublicTemplateRelationsRefresh = internalMutation({
  args: { scheduledAt: v.number(), bypassMinInterval: v.optional(v.boolean()) },
  handler: async (ctx, { scheduledAt, bypassMinInterval }) => {
    const manifest = await getPublicDiscoveryManifestRow(ctx);
    if (!manifest || manifest.relationsRefreshScheduledAt !== scheduledAt) {
      return { status: "superseded" as const };
    }

    if (manifest.relationsDirtyAt === undefined) {
      await ctx.db.patch(manifest._id, { relationsRefreshScheduledAt: undefined });
      return { status: "clean" as const };
    }

    const now = Date.now();
    if (manifest.listDirtyAt !== undefined) {
      if (manifest.listRefreshScheduledAt === undefined) {
        const blocked = new Error(
          `PUBLIC_DISCOVERY_RELATIONS_BLOCKED_BY_LIST:${manifest.listFailureCode ?? "UNSCHEDULED_DIRTY"}`.slice(
            0,
            500,
          ),
        );
        await freezePublicDiscoverySnapshotFailure(ctx, "relations", blocked, now);
        return { status: "blocked-by-list" as const };
      }
      const nextScheduledAt = await reschedulePublicDiscoveryRelationsRefresh(
        ctx,
        manifest,
        now,
        manifest.listRefreshScheduledAt + PUBLIC_DISCOVERY_RELATIONS_DEBOUNCE_MS,
      );
      return {
        status: "deferred-for-list" as const,
        scheduledAt: nextScheduledAt,
      };
    }
    const nextAllowedAt =
      (manifest.relationsUpdatedAt ?? 0) +
      PUBLIC_DISCOVERY_RELATIONS_MIN_REBUILD_INTERVAL_MS;
    if (!bypassMinInterval && now < nextAllowedAt) {
      const nextScheduledAt = await reschedulePublicDiscoveryRelationsRefresh(
        ctx,
        manifest,
        now,
        nextAllowedAt,
      );
      return { status: "deferred" as const, scheduledAt: nextScheduledAt };
    }

    let prepared: PreparedRelationSnapshotRebuild;
    try {
      prepared = await prepareRelationSnapshotRebuild(ctx);
    } catch (error) {
      const normalized = normalizeRelationSnapshotError(error);
      const status = classifyRelationSnapshotFreeze(normalized);
      await freezePublicDiscoverySnapshotFailure(ctx, "relations", normalized, now);
      return { status };
    }

    // Preparation is side-effect-free, so every compute/validation failure is
    // durably classified above. Publication errors still throw to preserve
    // Convex's all-or-nothing rollback for the two snapshot rows.
    const rebuilt = await publishRelationSnapshotRebuild(ctx, prepared);
    const publishedManifest = await getPublicDiscoveryManifestRow(ctx);
    if (publishedManifest?.relationsRefreshScheduledAt === scheduledAt) {
      await ctx.db.patch(publishedManifest._id, {
        relationsRefreshScheduledAt: undefined,
      });
    }
    return { status: "rebuilt" as const, rebuilt };
  },
});

async function rebuildHomepageSnapshotsImpl(
  ctx: MutationCtx,
): Promise<HomepageSnapshotRebuildResult> {
  const listPublication = await preparePublicDiscoveryListPublication(ctx);
  const selection = await preparePublicTemplateSnapshotPlan(ctx, listPublication);
  const preparedRelations = await prepareRelationSnapshotRebuild(ctx, selection);

  // Finish both pure preparations before the first row write. The relation
  // graph therefore consumes the exact cards the list publishes, and a guard
  // failure cannot expose a half-prepared generation even transiently.
  const list = await publishPublicTemplateSnapshotPlan(
    ctx,
    listPublication,
    selection,
  );
  const relations = await publishRelationSnapshotRebuild(ctx, preparedRelations);
  return { list, relations };
}

/**
 * One-shot activation and post-authoring refresh for every homepage snapshot.
 * Both materializations publish in one transaction, so callers can never
 * observe a freshly rebuilt list paired with relations from a failed rebuild.
 */
export const rebuildHomepageSnapshots = internalMutation({
  args: {},
  handler: rebuildHomepageSnapshotsImpl,
});

/** One atomic list+relations attempt used by the consolidated daily cron. */
export const rebuildHomepageSnapshotsForCronAttempt = internalMutation({
  args: {},
  handler: async (ctx) => ({
    status: "rebuilt" as const,
    rebuilt: await rebuildHomepageSnapshotsImpl(ctx),
  }),
});

/**
 * Persist failures outside the rolled-back composite transaction. Both
 * families are marked because neither generation advances when any prepare or
 * publish stage fails.
 */
export const rebuildHomepageSnapshotsForCron = internalAction({
  args: {},
  handler: async (ctx) => {
    const attemptState = await ctx.runQuery(publicDiscoveryCronAttemptStateRef, {});
    try {
      return await ctx.runMutation(rebuildHomepageSnapshotsForCronAttemptRef, {});
    } catch (error) {
      const failedAt = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(recordPublicDiscoverySnapshotRuntimeFailureRef, {
        failures: (["list", "relations"] as const).map((family) => ({
          family,
          code: `PUBLIC_DISCOVERY_${family.toUpperCase()}_COMPOSITE_CRON_REBUILD_FAILED:${message}`.slice(
            0,
            500,
          ),
        })),
        failedAt,
        attempt: attemptState,
      });
      throw error;
    }
  },
});

/**
 * Public: Get one published template for an explicit detail/send route.
 *
 * This indexed query is deliberately separate from the materialized discovery
 * snapshots. Detail/send pages need the target roster to render the power
 * landscape and construct a mailto action; homepage/list snapshots must never
 * contain it. This Convex query is directly public, so every returned field is
 * treated as public; SvelteKit's private + no-store response policy only keeps
 * the purpose-bound roster out of browser and Cloudflare caches. Provider and
 * CWC configuration are therefore redacted here, not merely at the HTTP edge.
 */
export const getBySlugPublic = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const template = await ctx.db
      .query("templates")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    // Also gate on `status === 'published'`. The CWC delivery path at
    // `convex/submissions.ts:105 getTemplateDeliveryError` already
    // rejects non-published templates as `CWC_TEMPLATE_NOT_PUBLISHED`.
    // But this PUBLIC query (the modal's loader at
    // `/s/[slug]/+layout.server.ts`) must also enforce the status gate:
    // returning any `isPublic` template regardless of status would let
    // an unpublished-but-public CWC template open the modal, and for
    // guests `TemplateModal.svelte:333` routes to `handleUnifiedEmailFlow`
    // (mailto relay), bypassing the official publish gate for unofficial
    // sends. Authors who need to preview unpublished templates should
    // use an authenticated preview route, not the public `/s/[slug]`
    // page.
    if (!template || !template.isPublic || template.status !== 'published') return null;

    // Fetch author info. Post-PII-elimination (2026-04-10) the users table
    // stores plaintext `name`; the legacy `encryptedName` blob is deprecated
    // and not produced for new users.
    let author: { name: string | null; avatar: string | null } | null = null;
    if (template.userId) {
      const user = await ctx.db.get(template.userId);
      if (user) {
        author = { name: user.name ?? null, avatar: user.avatar ?? null };
      }
    }
    const publicRecipientConfig = projectPublicDetailRecipientConfig(template.recipientConfig);

    return {
      id: template._id,
      slug: template.slug,
      title: template.title,
      description: template.description,
      domain: resolveDomain(template),
      domainHue: template.domainHue ?? undefined,
      type: template.type,
      deliveryMethod: template.deliveryMethod,
      subject: template.title,
      message_body: template.messageBody,
      sources: template.sources ?? [],
      research_log: template.researchLog ?? [],
      preview: template.preview,
      is_public: template.isPublic,
      verified_sends: template.verifiedSends < 5 ? null : template.verifiedSends,
      unique_districts: template.uniqueDistricts < 3 ? null : template.uniqueDistricts,
      send_count: template.verifiedSends < 5 ? null : template.verifiedSends,
      delivery_config: {},
      cwc_config: null,
      recipient_config: publicRecipientConfig,
      recipient_count: countRecipientsConvex(template.recipientConfig),
      recipientEmails: publicRecipientConfig.emails,
      topics: template.topics ?? [],
      author,
      createdAt: new Date(template._creationTime).toISOString(),
    };
  },
});

/**
 * Extract recipient emails from recipient_config JSON.
 */
function extractRecipientEmailsConvex(recipientConfig: unknown): string[] {
  if (!recipientConfig || typeof recipientConfig !== "object") return [];
  const config = recipientConfig as Record<string, unknown>;
  const emails: string[] = [];

  // Handle various recipient config shapes
  if (Array.isArray(config.recipients)) {
    for (const r of config.recipients) {
      if (typeof r === "string") emails.push(r);
      else if (r && typeof r === "object") {
        const email = (r as { email?: unknown }).email;
        if (typeof email === "string") emails.push(email);
      }
    }
  }
  if (Array.isArray(config.decisionMakers)) {
    for (const decisionMaker of config.decisionMakers) {
      if (decisionMaker && typeof decisionMaker === "object") {
        const email = (decisionMaker as { email?: unknown }).email;
        if (typeof email === "string") emails.push(email);
      }
    }
  }
  if (typeof config.email === "string") emails.push(config.email);
  if (Array.isArray(config.emails)) {
    for (const e of config.emails) {
      if (typeof e === "string") emails.push(e);
    }
  }

  // Authoring stores commonly carry the same target in both `emails` and
  // `decisionMakers`. Keep the compatibility projection and recipient count
  // stable instead of double-counting that denormalized representation.
  return [...new Set(emails.map((email) => email.trim()).filter(Boolean))];
}

function projectPublicHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  if (candidate.length === 0 || candidate.length > 2_048) return undefined;
  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * Construct the exact public roster shape used by anonymous detail/send pages.
 *
 * `recipientConfig` is stored as opaque JSON for authoring compatibility, so it
 * must never cross a directly callable public Convex boundary wholesale. Legacy
 * recipient shapes are normalized into `emails`; decision-maker and location
 * objects retain only fields used by the public power-landscape/mailto UI.
 */
function projectPublicDetailRecipientConfig(
  recipientConfig: unknown,
): Record<string, unknown> & { emails: string[] } {
  const publicEmails = extractRecipientEmailsConvex(recipientConfig).slice(0, 50);
  const allowedEmails = new Set(publicEmails);
  const projected: Record<string, unknown> & { emails: string[] } = {
    emails: publicEmails,
  };
  if (!recipientConfig || typeof recipientConfig !== "object" || Array.isArray(recipientConfig)) {
    return projected;
  }

  const config = recipientConfig as Record<string, unknown>;
  for (const field of ["reach", "target_type", "personalPrompt"] as const) {
    if (typeof config[field] === "string") projected[field] = config[field];
  }
  for (const field of ["cwcRouting", "includesCongress"] as const) {
    if (typeof config[field] === "boolean") projected[field] = config[field];
  }
  if (Array.isArray(config.chambers)) {
    projected.chambers = config.chambers
      .filter((value): value is string => typeof value === "string")
      .slice(0, 4);
  }

  if (config.location && typeof config.location === "object" && !Array.isArray(config.location)) {
    const location = config.location as Record<string, unknown>;
    const publicLocation: Record<string, string> = {};
    for (const field of ["city", "jurisdiction", "state", "country"] as const) {
      if (typeof location[field] === "string") publicLocation[field] = location[field];
    }
    if (Object.keys(publicLocation).length > 0) projected.location = publicLocation;
  }

  if (Array.isArray(config.decisionMakers)) {
    const decisionMakers = config.decisionMakers
      .slice(0, 50)
      .map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const decisionMaker = value as Record<string, unknown>;
        const publicDecisionMaker: Record<string, unknown> = {};
        for (const field of [
          "name",
          "title",
          "role",
          "shortName",
          "organization",
          "roleCategory",
          "personalPrompt",
          "accountabilityOpener",
        ] as const) {
          if (typeof decisionMaker[field] === "string") {
            publicDecisionMaker[field] = decisionMaker[field];
          }
        }
        if (typeof decisionMaker.email === "string") {
          const email = decisionMaker.email.trim();
          if (allowedEmails.has(email)) publicDecisionMaker.email = email;
        }
        if (
          typeof publicDecisionMaker.email === "string" &&
          decisionMaker.emailGrounded === true
        ) {
          const emailSource = projectPublicHttpUrl(decisionMaker.emailSource);
          if (emailSource) {
            publicDecisionMaker.emailGrounded = true;
            publicDecisionMaker.emailSource = emailSource;
          }
        }
        if (
          typeof decisionMaker.relevanceRank === "number" &&
          Number.isFinite(decisionMaker.relevanceRank)
        ) {
          publicDecisionMaker.relevanceRank = decisionMaker.relevanceRank;
        }
        return Object.keys(publicDecisionMaker).length > 0 ? publicDecisionMaker : null;
      })
      .filter((value): value is Record<string, unknown> => value !== null);
    if (decisionMakers.length > 0) projected.decisionMakers = decisionMakers;
  }

  return projected;
}

/** Return only the non-identifying cardinality needed by anonymous UI. */
function countRecipientsConvex(recipientConfig: unknown): number {
  if (!recipientConfig || typeof recipientConfig !== "object") return 0;
  const config = recipientConfig as Record<string, unknown>;
  const decisionMakerCount = Array.isArray(config.decisionMakers) ? config.decisionMakers.length : 0;
  return Math.max(decisionMakerCount, extractRecipientEmailsConvex(recipientConfig).length);
}

/**
 * Internal: Batch lookup templates by IDs.
 * Used by search action to hydrate results after vector search.
 */
export const getByIds = internalQuery({
  args: { ids: v.array(v.id("templates")) },
  handler: async (ctx, args) => {
    const results = await Promise.all(
      args.ids.map((id) => ctx.db.get(id)),
    );
    return results.filter(Boolean);
  },
});

// =============================================================================
// SEARCH — Action (needs external Gemini API call)
// =============================================================================

const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;

/**
 * Generate a query embedding via Gemini API.
 * Raw fetch — no SDK dependency needed in Convex actions.
 */
async function generateQueryEmbedding(
  query: string,
  apiKey: string,
): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${GEMINI_EMBEDDING_MODEL}`,
      content: { parts: [{ text: query }] },
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[templates.search] Gemini error ${response.status}: ${text}`);
    throw new Error("Search service temporarily unavailable");
  }

  const data = await response.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("No embedding values in Gemini response");
  }
  return values;
}

/**
 * Semantic template search.
 *
 * Pipeline:
 *   1. Generate query embedding via Gemini (RETRIEVAL_QUERY task type)
 *   2. Vector search on topicEmbedding index
 *   3. Apply quality boost + 0.40 similarity floor
 *   4. Hydrate full template docs
 *
 * Falls back to text search if embedding generation fails.
 */
export const search = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    domain: v.optional(v.string()),
    countryCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Rate limit: 30 searches per minute per IP/session (Gemini API cost)
    // Rate limit per user (authenticated search)
    const identity = await ctx.auth.getUserIdentity();
    const rlKey = `templates.search:${identity?.subject ?? 'anon'}:${args.query.slice(0, 20)}`;
    const rl = await ctx.runMutation(rateLimitCheckRef, {
      key: rlKey,
      windowMs: 60_000,
      maxRequests: 30,
    });
    if (!rl.allowed) throw new Error("Rate limit exceeded — please try again shortly");

    const queryText = args.query.trim();
    if (queryText.length < 2) {
      throw new Error("Query must be at least 2 characters");
    }
    if (queryText.length > 200) {
      throw new Error("Query too long (max 200 characters)");
    }

    // Bound domain + countryCode at the action boundary. The SvelteKit
    // boundary takes a separate path and does not enforce these caps
    // for direct Convex callers.
    if (args.domain !== undefined && args.domain.length > 64) {
      throw new Error("DOMAIN_TOO_LARGE");
    }
    if (args.countryCode !== undefined && args.countryCode.length > 8) {
      throw new Error("COUNTRY_CODE_TOO_LARGE");
    }

    const limit = Math.min(Math.max(args.limit ?? 10, 1), 20);

    // Try semantic search first
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY not set");
      }

      const embedding = await generateQueryEmbedding(queryText, apiKey);

      // Build filter for vector search. Convex's VectorFilterBuilder only
      // exposes `.eq` and `.or` — there is no `.and`, so multi-field
      // conjunction must be handled via post-filter in JS. With one filter
      // field the builder applies it natively; with two we apply one in
      // the builder and post-filter the hydrated docs against the other.
      const filterEntries: Array<['domain' | 'countryCode', string]> = [];
      if (args.domain) filterEntries.push(['domain', args.domain]);
      if (args.countryCode) filterEntries.push(['countryCode', args.countryCode]);
      const [primaryFilter, secondaryFilter] = filterEntries;

      // Fetch more candidates to allow for quality filtering. When a
      // post-filter applies, widen further so the post-filter has room to
      // shed candidates without starving the result set.
      const candidateLimit = limit + 10 + (secondaryFilter ? 20 : 0);

      const vectorResults = await ctx.vectorSearch("templates", "by_topicEmbedding", {
        vector: embedding,
        limit: candidateLimit,
        filter: primaryFilter
          ? (q) => q.eq(primaryFilter[0], primaryFilter[1])
          : undefined,
      });

      if (vectorResults.length === 0) {
        // Fall through to text search
        throw new Error("No vector results");
      }

      // Hydrate full docs
      const templateIds = vectorResults.map((r) => r._id);
      const templates = await ctx.runQuery(getByIdsRef, {
        ids: templateIds,
      }) as Array<Doc<"templates"> | null>;

      // Build score map from vector results
      const scoreMap = new Map(
        vectorResults.map((r) => [r._id, r._score]),
      );

      // Apply quality boost, similarity floor, and the secondary post-filter
      // for multi-field AND that VectorFilterBuilder can't express natively.
      const scored = templates
        .filter((t): t is NonNullable<typeof t> => t != null)
        .filter((t) => t.status === "published" && t.isPublic)
        .filter((t) =>
          secondaryFilter ? t[secondaryFilter[0]] === secondaryFilter[1] : true,
        )
        .map((t) => {
          const rawScore = Number(scoreMap.get(t._id) ?? 0);
          const sends = t.verifiedSends || 0;
          const qualityBoost = 0.8 + 0.2 * Math.min(sends / 100, 1);
          return {
            ...t,
            _score: rawScore * qualityBoost,
          };
        })
        .filter((t) => t._score >= 0.40)
        .sort((a, b) => b._score - a._score)
        .slice(0, limit);

      return {
        templates: scored.map((t) => toPublicTemplate(t, t._score)),
        method: "semantic" as const,
      };
    } catch {
      // Fallback: text search via Convex search index
      const textResults = await ctx.runQuery(textSearchRef, {
        query: queryText,
        limit,
        domain: args.domain,
        countryCode: args.countryCode,
      }) as Doc<"templates">[];

      return {
        templates: textResults.map((t) => toPublicTemplate(t, null)),
        method: "keyword" as const,
      };
    }
  },
});

/**
 * Internal: Text-based search fallback using Convex search index.
 */
export const textSearch = internalQuery({
  args: {
    query: v.string(),
    limit: v.number(),
    domain: v.optional(v.string()),
    countryCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let q = ctx.db
      .query("templates")
      .withSearchIndex("search_templates", (s) => {
        let search = s.search("title", args.query);
        if (args.domain) search = search.eq("domain", args.domain);
        search = search.eq("status", "published");
        if (args.countryCode) search = search.eq("countryCode", args.countryCode);
        return search;
      });

    const results = await q.take(Math.min(args.limit + 20, 50));
    return results
      .filter((t) => t.status === "published" && t.isPublic)
      .slice(0, args.limit);
  },
});

/**
 * Authenticated: List templates belonging to the current user.
 * Used by: src/routes/api/user/templates/+server.ts
 */
export const listByUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    // Resolve userId from identity
    const user = identity.email
      ? await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", identity.email))
          .first()
      : null;
    if (!user) return [];

    const templates = await ctx.db
      .query("templates")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();

    return templates.map((t) => ({
      _id: t._id,
      _creationTime: t._creationTime,
      slug: t.slug,
      title: t.title,
      description: t.description,
      domain: resolveDomain(t),
      domainHue: t.domainHue ?? undefined,
      status: t.status,
      isPublic: t.isPublic,
      verifiedSends: t.verifiedSends,
      updatedAt: t.updatedAt,
    }));
  },
});

/**
 * Authenticated: List templates belonging to an org (title + id only).
 * Used by: src/routes/org/[slug]/campaigns/new/+page.server.ts
 */
export const listByOrg = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const { org } = await requireOrgRole(ctx, slug, "member");

    const templates = await ctx.db
      .query("templates")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    // Sort alphabetically by title
    templates.sort((a, b) => a.title.localeCompare(b.title));

    return templates.map((t) => ({
      _id: t._id,
      title: t.title,
    }));
  },
});

// =============================================================================
// ENDORSEMENTS — Org endorses/un-endorses a template
// =============================================================================

/**
 * Endorse a template on behalf of an org. Requires editor role.
 * Upserts to handle duplicate endorsement gracefully.
 */
export const endorse = mutation({
  args: {
    orgSlug: v.string(),
    templateId: v.id("templates"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    // Verify template exists and is public
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");
    if (!template.isPublic) throw new Error("Cannot endorse a private template");

    // Check if already endorsed (upsert behavior)
    const existing = await ctx.db
      .query("templateEndorsements")
      .withIndex("by_templateId_orgId", (q) =>
        q.eq("templateId", args.templateId).eq("orgId", org._id),
      )
      .first();

    if (existing) {
      return { id: existing._id };
    }

    const id = await ctx.db.insert("templateEndorsements", {
      templateId: args.templateId,
      orgId: org._id,
      endorsedAt: Date.now(),
    });

    // Increment endorsementCount on template
    const currentCount = template.endorsementCount ?? 0;
    await ctx.db.patch(args.templateId, {
      endorsementCount: currentCount + 1,
    });

    if (template.status === "published" && template.isPublic) {
      await markPublicDiscoveryListDirty(ctx);
    }

    return { id };
  },
});

/**
 * Remove an endorsement. Requires editor role.
 */
export const removeEndorsement = mutation({
  args: {
    orgSlug: v.string(),
    templateId: v.id("templates"),
  },
  handler: async (ctx, args) => {
    const { org } = await requireOrgRole(ctx, args.orgSlug, "editor");

    const existing = await ctx.db
      .query("templateEndorsements")
      .withIndex("by_templateId_orgId", (q) =>
        q.eq("templateId", args.templateId).eq("orgId", org._id),
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);

      // Decrement endorsementCount on template
      const template = await ctx.db.get(args.templateId);
      if (template) {
        const currentCount = template.endorsementCount ?? 0;
        await ctx.db.patch(args.templateId, {
          endorsementCount: Math.max(0, currentCount - 1),
        });
        if (template.status === "published" && template.isPublic) {
          await markPublicDiscoveryListDirty(ctx);
        }
      }
    }

    return { ok: true };
  },
});

// =============================================================================
// Template source cache (for stream-message LLM pipeline)
// =============================================================================

/**
 * Get cached sources for a template (72h TTL checked by caller).
 */
export const getSourceCache = query({
  args: { templateId: v.id("templates") },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) return null;
    return {
      cachedSources: template.cachedSources ?? null,
      sourcesCachedAt: template.sourcesCachedAt ?? null,
    };
  },
});

/**
 * Update cached sources on a template (fire-and-forget from stream-message).
 */
export const updateSourceCache = mutation({
  args: {
    templateId: v.id("templates"),
    cachedSources: v.any(),
    sourcesCachedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    await ctx.db.patch(args.templateId, {
      cachedSources: args.cachedSources,
      sourcesCachedAt: args.sourcesCachedAt,
    });
  },
});

const EMBEDDING_BACKFILL_BATCH_LIMIT = 100;
const EMBEDDING_MARKER_MIGRATION_BATCH_LIMIT = 100;
const EMBEDDING_MARKER_MIGRATION_STALE_MS = 15 * 60 * 1000;
const EMBEDDING_BACKFILL_LEASE_MS = 15 * 60 * 1000;

function assertEmbeddingBackfillLeaseToken(token: string): void {
  if (token.length < 16 || token.length > 100) {
    throw new Error("EMBEDDING_BACKFILL_LEASE_TOKEN_INVALID");
  }
}

async function requireActiveEmbeddingBackfillLease(ctx: MutationCtx, token: string): Promise<void> {
  assertEmbeddingBackfillLeaseToken(token);
  const lease = await ctx.db
    .query("embeddingBackfillLeases")
    .withIndex("by_key", (q) => q.eq("key", "topic"))
    .unique();
  if (!lease || lease.token !== token) {
    throw new Error("EMBEDDING_BACKFILL_LEASE_NOT_OWNED");
  }
  if (lease.expiresAt <= Date.now()) {
    throw new Error("EMBEDDING_BACKFILL_LEASE_EXPIRED");
  }
}

/**
 * Claim one distributed repair lease before the Pages route spends Gemini I/O.
 *
 * The indexed read and insert/patch share a Convex mutation, so concurrent
 * isolates serialize on the `topic` key. The lease expires if a worker is
 * evicted before its token-checked release runs.
 */
export const claimEmbeddingBackfillLease = mutation({
  args: { _secret: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    requireInternalSecret(args._secret);
    assertEmbeddingBackfillLeaseToken(args.token);
    const now = Date.now();
    const existing = await ctx.db
      .query("embeddingBackfillLeases")
      .withIndex("by_key", (q) => q.eq("key", "topic"))
      .unique();

    if (existing && existing.expiresAt > now) {
      return { acquired: false as const, retryAt: existing.expiresAt };
    }

    const expiresAt = now + EMBEDDING_BACKFILL_LEASE_MS;
    if (existing) {
      await ctx.db.patch(existing._id, { token: args.token, expiresAt });
    } else {
      await ctx.db.insert("embeddingBackfillLeases", {
        key: "topic",
        token: args.token,
        expiresAt,
      });
    }
    return { acquired: true as const, expiresAt };
  },
});

/** Release only the lease generation owned by this request. */
export const releaseEmbeddingBackfillLease = mutation({
  args: { _secret: v.string(), token: v.string() },
  handler: async (ctx, args) => {
    requireInternalSecret(args._secret);
    assertEmbeddingBackfillLeaseToken(args.token);
    const existing = await ctx.db
      .query("embeddingBackfillLeases")
      .withIndex("by_key", (q) => q.eq("key", "topic"))
      .unique();
    if (!existing || existing.token !== args.token) {
      return { released: false as const };
    }
    await ctx.db.delete(existing._id);
    return { released: true as const };
  },
});

function embeddingBackfillLimit(limit: number | undefined): number {
  if (limit === undefined) return EMBEDDING_BACKFILL_BATCH_LIMIT;
  return Math.max(1, Math.min(EMBEDDING_BACKFILL_BATCH_LIMIT, Math.floor(limit)));
}

async function listMissingEmbeddingsImpl(ctx: QueryCtx, requestedLimit?: number) {
  const templates = await ctx.db
    .query("templates")
    .withIndex("by_status_isPublic_topicEmbeddingsUpdatedAt", (q) =>
      q.eq("status", "published").eq("isPublic", true).eq("topicEmbeddingsUpdatedAt", undefined),
    )
    .order("desc")
    .take(embeddingBackfillLimit(requestedLimit));

  return templates.map((t) => ({
    _id: t._id,
    title: t.title,
    description: t.description ?? null,
    domain: resolveDomain(t),
    messageBody: t.messageBody,
  }));
}

/** Server-only bounded batch used by the authenticated SvelteKit admin route. */
export const listMissingEmbeddings = query({
  args: { _secret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    requireInternalSecret(args._secret);
    return await listMissingEmbeddingsImpl(ctx, args.limit);
  },
});

/**
 * One-time bounded migration for rows created before the topic-specific marker.
 * It never calls Gemini: already-valid vectors inherit their existing update
 * timestamp, while genuinely missing/wrong-dimension rows remain in the exact
 * repair index. Each transaction scans at most 100 stable creation-order rows
 * and schedules the next page, avoiding one oversized migration transaction.
 * Progress lives on the public-discovery singleton so operators can prove every
 * scheduled page finished. A top-level invocation restarts a run whose first
 * page is older than 15 minutes; the new start token supersedes any delayed old
 * continuation. Once complete, an accidental rerun is a no-op.
 */
export const migrateTopicEmbeddingMarkers = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    scanned: v.optional(v.number()),
    marked: v.optional(v.number()),
    restart: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const isContinuation = args.startedAt !== undefined;
    if (!isContinuation && (args.cursor !== undefined || args.scanned !== undefined || args.marked !== undefined)) {
      throw new Error("TOPIC_EMBEDDING_MARKER_MIGRATION_INVALID_CONTINUATION");
    }

    let manifest = await getPublicDiscoveryManifestRow(ctx);
    if (!isContinuation && !args.restart) {
      if (manifest?.topicEmbeddingMarkerMigrationCompletedAt !== undefined) {
        return {
          status: "already-complete" as const,
          scanned: manifest.topicEmbeddingMarkerMigrationScanned ?? 0,
          marked: manifest.topicEmbeddingMarkerMigrationMarked ?? 0,
          isDone: true,
          startedAt: manifest.topicEmbeddingMarkerMigrationStartedAt ?? null,
          completedAt: manifest.topicEmbeddingMarkerMigrationCompletedAt,
        };
      }
      if (manifest?.topicEmbeddingMarkerMigrationStartedAt !== undefined) {
        const stale =
          Date.now() - manifest.topicEmbeddingMarkerMigrationStartedAt >=
          EMBEDDING_MARKER_MIGRATION_STALE_MS;
        if (!stale) {
          return {
            status: "already-running" as const,
            scanned: manifest.topicEmbeddingMarkerMigrationScanned ?? 0,
            marked: manifest.topicEmbeddingMarkerMigrationMarked ?? 0,
            isDone: false,
            startedAt: manifest.topicEmbeddingMarkerMigrationStartedAt,
            completedAt: null,
          };
        }
      }
    }

    const startedAt = args.startedAt ?? Date.now();
    let manifestId = manifest?._id;
    if (!isContinuation) {
      const progress = {
        topicEmbeddingMarkerMigrationStartedAt: startedAt,
        topicEmbeddingMarkerMigrationCompletedAt: undefined,
        topicEmbeddingMarkerMigrationScanned: 0,
        topicEmbeddingMarkerMigrationMarked: 0,
      };
      if (manifestId) {
        await ctx.db.patch(manifestId, progress);
      } else {
        manifestId = await ctx.db.insert("publicDiscoveryManifest", {
          key: "public",
          listReady: false,
          relationsReady: false,
          listRevision: 0,
          relationsRevision: 0,
          ...progress,
        });
      }
    } else if (
      !manifestId ||
      manifest?.topicEmbeddingMarkerMigrationStartedAt !== startedAt ||
      manifest.topicEmbeddingMarkerMigrationCompletedAt !== undefined
    ) {
      return {
        status: "superseded" as const,
        scanned: args.scanned ?? 0,
        marked: args.marked ?? 0,
        isDone: false,
        startedAt,
        completedAt: null,
      };
    }

    const page = await ctx.db
      .query("templates")
      .order("asc")
      .paginate({
        cursor: args.cursor ?? null,
        numItems: EMBEDDING_MARKER_MIGRATION_BATCH_LIMIT,
      });
    let pageMarked = 0;
    for (const template of page.page) {
      if (template.topicEmbeddingsUpdatedAt === undefined && isFiniteEmbeddingVector(template.topicEmbedding)) {
        await ctx.db.patch(template._id, {
          topicEmbeddingsUpdatedAt: template.embeddingsUpdatedAt ?? template.updatedAt,
        });
        pageMarked += 1;
      }
    }

    const scanned = (args.scanned ?? 0) + page.page.length;
    const marked = (args.marked ?? 0) + pageMarked;
    const completedAt = page.isDone ? Date.now() : undefined;
    await ctx.db.patch(manifestId, {
      topicEmbeddingMarkerMigrationScanned: scanned,
      topicEmbeddingMarkerMigrationMarked: marked,
      topicEmbeddingMarkerMigrationCompletedAt: completedAt,
    });

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, migrateTopicEmbeddingMarkersRef, {
        cursor: page.continueCursor,
        startedAt,
        scanned,
        marked,
      });
    }

    return {
      status: page.isDone ? ("complete" as const) : ("running" as const),
      pageScanned: page.page.length,
      pageMarked,
      scanned,
      marked,
      isDone: page.isDone,
      startedAt,
      completedAt: completedAt ?? null,
      ...(page.isDone ? {} : { continueCursor: page.continueCursor }),
    };
  },
});

/** Observable completion proof for the one-time marker-migration cutover. */
export const topicEmbeddingMarkerMigrationStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const manifest = await ctx.db
      .query("publicDiscoveryManifest")
      .withIndex("by_key", (q) => q.eq("key", "public"))
      .unique();
    const startedAt = manifest?.topicEmbeddingMarkerMigrationStartedAt ?? null;
    const completedAt = manifest?.topicEmbeddingMarkerMigrationCompletedAt ?? null;
    return {
      status: completedAt !== null ? "complete" : startedAt !== null ? "running" : "not-started",
      startedAt,
      completedAt,
      scanned: manifest?.topicEmbeddingMarkerMigrationScanned ?? 0,
      marked: manifest?.topicEmbeddingMarkerMigrationMarked ?? 0,
    };
  },
});

type TemplateEmbeddingWrite = {
  locationEmbedding: number[];
  topicEmbedding: number[];
  domainHue?: number;
};

function isFiniteEmbeddingVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 768 && value.every((component) => typeof component === "number" && Number.isFinite(component));
}

function assertEmbeddingDimensions(args: TemplateEmbeddingWrite): void {
  if (args.locationEmbedding.length !== 768 || args.topicEmbedding.length !== 768) {
    throw new Error("INVALID_EMBEDDING_DIMENSION:expected=768");
  }
  if (!isFiniteEmbeddingVector(args.locationEmbedding) || !isFiniteEmbeddingVector(args.topicEmbedding)) {
    throw new Error("INVALID_EMBEDDING_VALUE:finite-numbers-required");
  }
  if (args.domainHue !== undefined && (!Number.isFinite(args.domainHue) || args.domainHue < 0 || args.domainHue > 360)) {
    throw new Error("INVALID_DOMAIN_HUE:expected=0..360");
  }
}

async function patchTemplateEmbeddingValues(
  ctx: MutationCtx,
  template: Doc<"templates">,
  args: TemplateEmbeddingWrite,
  embeddingVersion: string,
): Promise<void> {
  const embeddingsUpdatedAt = Date.now();
  await ctx.db.patch(template._id, {
    locationEmbedding: args.locationEmbedding,
    topicEmbedding: args.topicEmbedding,
    embeddingVersion,
    embeddingsUpdatedAt,
    topicEmbeddingsUpdatedAt: embeddingsUpdatedAt,
    ...(args.domainHue !== undefined ? { domainHue: args.domainHue } : {}),
  });

  if (template.status !== "published" || !template.isPublic) return;

  // Topic vectors always affect twins. Domain hue affects the list card, but
  // the vectors and repair markers themselves never enter the public list row.
  const listChanged =
    args.domainHue !== undefined && args.domainHue !== template.domainHue;
  if (listChanged) {
    await markPublicDiscoveryListAndRelationsDirty(ctx);
  } else {
    await markPublicDiscoveryRelationsDirty(ctx);
  }
}

/**
 * Complete the one missing embedding write started by an authenticated template
 * creation request. The caller captures `expectedUserId` before entering its
 * post-response continuation, so this bridge does not depend on request-local
 * Convex auth surviving a `waitUntil`/provider await. The server secret protects
 * the bridge, the expected owner prevents cross-request mixups, and missing-only
 * semantics prevent it from becoming an embedding-overwrite capability.
 *
 * The original creation dirties both snapshot families. Completion always
 * dirties relations and also dirties the list when domain hue changes, reusing
 * the existing coalesced tokens; no first-embedding path can bypass the
 * six-hour relation cost ceiling.
 */
export const completePublicTemplateEmbeddings = mutation({
  args: {
    templateId: v.id("templates"),
    expectedUserId: v.id("users"),
    locationEmbedding: v.array(v.float64()),
    topicEmbedding: v.array(v.float64()),
    domainHue: v.optional(v.float64()),
    _secret: v.string(),
  },
  handler: async (ctx, args) => {
    requireInternalSecret(args._secret);
    assertEmbeddingDimensions(args);
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");
    if (template.userId !== args.expectedUserId) {
      throw new Error("EMBEDDING_COMPLETION_OWNER_MISMATCH");
    }
    if (template.status !== "published" || !template.isPublic) {
      throw new Error("EMBEDDING_COMPLETION_PUBLIC_TEMPLATE_REQUIRED");
    }
    if (template.topicEmbeddingsUpdatedAt !== undefined || isFiniteEmbeddingVector(template.topicEmbedding)) {
      throw new Error("TOPIC_EMBEDDINGS_ALREADY_PRESENT");
    }

    await patchTemplateEmbeddingValues(ctx, template, args, "v1");
    return { updated: true };
  },
});

/**
 * Narrow secret-gated bridge for the SvelteKit repair batch.
 *
 * This path deliberately has no end-user ownership context. It can only fill a
 * row still selected by the missing-topic marker and only while the caller owns
 * the unexpired distributed lease; it cannot overwrite an existing embedding.
 * The batch publishes once through `rebuildHomepageSnapshotsAfterBackfill`.
 */
export const updateMissingEmbeddingsForBackfill = mutation({
  args: {
    templateId: v.id("templates"),
    locationEmbedding: v.array(v.float64()),
    topicEmbedding: v.array(v.float64()),
    domainHue: v.optional(v.float64()),
    _secret: v.string(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    requireInternalSecret(args._secret);
    await requireActiveEmbeddingBackfillLease(ctx, args.leaseToken);
    assertEmbeddingDimensions(args);
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");
    if (template.status !== "published" || !template.isPublic) {
      throw new Error("EMBEDDING_BACKFILL_PUBLIC_TEMPLATE_REQUIRED");
    }
    if (template.topicEmbeddingsUpdatedAt !== undefined || isFiniteEmbeddingVector(template.topicEmbedding)) {
      throw new Error("TOPIC_EMBEDDINGS_ALREADY_PRESENT");
    }

    await patchTemplateEmbeddingValues(ctx, template, args, "gemini-001-768");
    return { updated: true };
  },
});

/** Publish exactly once after a server-side embedding repair batch. */
export const rebuildHomepageSnapshotsAfterBackfill = mutation({
  args: { _secret: v.string(), leaseToken: v.string() },
  handler: async (ctx, args) => {
    requireInternalSecret(args._secret);
    await requireActiveEmbeddingBackfillLease(ctx, args.leaseToken);
    return await rebuildHomepageSnapshotsImpl(ctx);
  },
});

/**
 * Find template by content hash (dedup check).
 */
export const findByContentHash = query({
  args: { userId: v.string(), contentHash: v.string() },
  handler: async (ctx, { contentHash }) => {
    const { userId: authUserId } = await requireAuth(ctx);
    const templates = await ctx.db
      .query("templates")
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), authUserId),
          q.eq(q.field("contentHash"), contentHash),
        ),
      )
      .first();
    return templates;
  },
});

/**
 * Get user's org membership (for quota check).
 */
export const getUserOrgId = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .filter((q) => q.eq(q.field("userId"), userId))
      .first();
    return membership ? { orgId: membership.orgId } : null;
  },
});

/**
 * Create a template (with quota check and geographic scope).
 */
export const createTemplate = mutation({
  args: {
    _secret: v.string(),
    userId: v.id("users"),
    title: v.string(),
    slug: v.string(),
    description: v.string(),
    messageBody: v.string(),
    preview: v.string(),
    type: v.string(),
    deliveryMethod: v.string(),
    domain: v.string(),
    topics: v.array(v.string()),
    sources: v.optional(v.any()),
    researchLog: v.optional(v.any()),
    contentHash: v.string(),
    status: v.string(),
    isPublic: v.boolean(),
    deliveryConfig: v.optional(v.any()),
    cwcConfig: v.optional(v.any()),
    recipientConfig: v.optional(v.any()),
    consensusApproved: v.boolean(),
    geographicScope: v.optional(templateGeographicScopeValidator),
    domainHue: v.optional(v.float64()),
  },
  handler: async (ctx, args) => {
    // Moderation, publication state, and public visibility are derived by the
    // SvelteKit server. Convex functions are internet-callable, so require the
    // server credential before trusting any of those fields.
    requireInternalSecret(args._secret);
    // Also force-match the authenticated identity. The credential closes the
    // server-derived moderation/publication boundary; this identity check keeps
    // a server request from accidentally attributing content to another user.
    const { userId: authUserId } = await requireAuth(ctx);
    if (String(authUserId) !== String(args.userId)) {
      throw new Error("Authenticated user does not match args.userId");
    }
    const ALLOWED_TEMPLATE_STATUSES = ["draft", "published", "archived", "pending"] as const;
    if (!ALLOWED_TEMPLATE_STATUSES.includes(args.status as typeof ALLOWED_TEMPLATE_STATUSES[number])) {
      throw new Error("INVALID_TEMPLATE_STATUS");
    }

    // Mirror the HTTP boundary before any quota reads or source write. The
    // internal secret is a trust boundary, not permission to store a document
    // large enough to exhaust the bounded homepage materializer.
    const inputBudget = validateTemplateInputBudgets(
      {
        title: args.title,
        slug: args.slug,
        description: args.description,
        messageBody: args.messageBody,
        preview: args.preview,
        type: args.type,
        deliveryMethod: args.deliveryMethod,
        domain: args.domain,
        topics: args.topics,
        sources: args.sources,
        researchLog: args.researchLog,
        deliveryConfig: args.deliveryConfig,
        cwcConfig: args.cwcConfig,
        recipientConfig: args.recipientConfig,
        geographicScope: args.geographicScope,
        contentHash: args.contentHash,
        status: args.status,
        isPublic: args.isPublic,
      },
      { includePublicInput: args.status === "published" && args.isPublic },
    );
    if (!inputBudget.ok) {
      throw new Error(
        `TEMPLATE_INPUT_BUDGET_EXCEEDED:${inputBudget.scope}:${inputBudget.reason}`,
      );
    }

    // Fail duplicate links before the more expensive plan/quota reads. This
    // indexed range read remains authoritative: Convex OCC serializes a
    // concurrent same-slug insert and retries the loser against the new row.
    const existingSlug = await ctx.db
      .query("templates")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (existingSlug) throw new ConvexError({ code: "TEMPLATE_SLUG_TAKEN" });

    // Check org quota
    const membership = await ctx.db
      .query("orgMemberships")
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();

    if (membership) {
      const org = await ctx.db.get(membership.orgId);
      if (org && org.maxTemplatesMonth) {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const templates = await ctx.db
          .query("templates")
          .withIndex("by_orgId", (q) => q.eq("orgId", membership.orgId))
          .filter((q) => q.gte(q.field("_creationTime"), startOfMonth.getTime()))
          .collect();
        if (templates.length >= org.maxTemplatesMonth) {
          throw new Error("TEMPLATE_QUOTA_EXCEEDED");
        }
      }
    } else {
      // Individual AI-authoring cap (the L2 metered surface). Individuals are
      // free forever to ACT on existing messages; the bound is on AI-AUTHORING
      // NEW templates (the expensive person-layer TemplateCreator generation
      // path). Org members are governed by their plan's maxTemplatesMonth above,
      // so this only applies to the un-orged individual path.
      //
      // The limit is DYNAMIC: read the user's individual subscription plan and
      // resolve its authored-per-month allowance (free floor 3, Voice 20,
      // Advocate 75). The template-creation count IS the meter — query-time
      // aggregation from timestamped rows (templates.by_userId + _creationTime
      // >= start-of-month), mirroring the billing pattern, NOT a denormalized
      // counter that needs resetting.
      const now = Date.now();

      // Resolve the user's effective individual authored limit. Only honor the
      // plan when the sub is effectively active (active/trialing, or past_due
      // within a 7-day grace) — otherwise fall to the free floor. The sub is
      // user-scoped (by_userId); org-scoped subs never reach this branch (those
      // users have an orgMembership and take the maxTemplatesMonth path above).
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .first();
      const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
      const isWithinGrace =
        sub?.status === "past_due" &&
        sub.pastDueSince !== undefined &&
        now - sub.pastDueSince < GRACE_PERIOD_MS;
      const effectivelyActive =
        sub?.status === "active" || sub?.status === "trialing" || isWithinGrace;
      // authoredLimitForPlan resolves org slugs + unknowns to the free floor,
      // so an individual sub can NEVER unlock an org plan's volume here.
      const limit = effectivelyActive
        ? authoredLimitForPlan(sub?.plan)
        : authoredLimitForPlan(null);

      const monthStart = startOfMonthUTC(now);
      const monthToDate = await ctx.db
        .query("templates")
        .withIndex("by_userId", (q) => q.eq("userId", args.userId))
        .filter((q) => q.gte(q.field("_creationTime"), monthStart))
        .collect();
      const decision = decideIndividualAuthoring(monthToDate.length, now, limit);
      if (!decision.ok) {
        // Coded throw so the SvelteKit route surfaces the at-cap upgrade card.
        throw new Error(`${AUTHORING_QUOTA_EXCEEDED}:${decision.message}`);
      }
    }

    const templateId = await ctx.db.insert("templates", {
      userId: args.userId,
      orgId: membership?.orgId,
      title: args.title,
      slug: args.slug,
      description: args.description,
      messageBody: args.messageBody,
      preview: args.preview,
      type: args.type,
      deliveryMethod: args.deliveryMethod,
      domain: args.domain,
      topics: args.topics,
      sources: args.sources ?? [],
      researchLog: args.researchLog ?? [],
      contentHash: args.contentHash,
      status: args.status,
      isPublic: args.isPublic,
      deliveryConfig: args.deliveryConfig ?? {},
      cwcConfig: args.cwcConfig ?? {},
      recipientConfig: args.recipientConfig ?? {},
      verificationStatus: args.consensusApproved ? "approved" : "pending",
      countryCode: "US",
      reputationApplied: false,
      consensusApproved: args.consensusApproved,
      verifiedSends: 0,
      uniqueDistricts: 0,
      embeddingVersion: "gemini-001",
      flaggedByModeration: !args.consensusApproved,
      reputationDelta: 0.0,
      updatedAt: Date.now(),
    });

    // Create geographic scope if provided
    if (args.geographicScope && args.geographicScope.type !== "international") {
      const geo = args.geographicScope;
      let countryCode = "US";
      let regionCode: string | null = null;
      let localityCode: string | null = null;
      let scopeLevel = "country";
      let displayText = "Nationwide";

      if (geo.type === "nationwide") {
        countryCode = geo.country;
        displayText = geo.country;
      } else if (geo.type === "subnational") {
        countryCode = geo.country;
        if (geo.subdivision) {
          regionCode = geo.subdivision;
          scopeLevel = "region";
          displayText = geo.subdivision;
        }
        if (geo.locality) {
          localityCode = geo.locality;
          scopeLevel = "locality";
          displayText = geo.locality + (geo.subdivision ? `, ${geo.subdivision}` : "");
        }
      }

      await ctx.db.patch(templateId, {
        scopes: [
          {
            countryCode,
            ...(regionCode ? { regionCode } : {}),
            ...(localityCode ? { localityCode } : {}),
            displayText,
            scopeLevel,
            confidence: 1.0,
            extractionMethod: "gemini_inline",
          },
        ],
      });
    }

    // Do not make public discovery publication depend on the external embedding
    // call. A new row can enter/evict the relation graph's bounded top-50 even
    // before it has vectors, so Gemini failure must still refresh both families.
    // A successful embedding patch below reuses the relation dirty token (and
    // the list token when domain hue changes); it never starts a direct rebuild.
    if (args.status === "published" && args.isPublic) {
      await markPublicDiscoveryListAndRelationsDirty(ctx);
    }

    const template = await ctx.db.get(templateId);
    return template;
  },
});

/** Delete a template by ID (internal only). */
export const deleteTemplate = internalMutation({
  args: { templateId: v.id("templates") },
  handler: async (ctx, { templateId }) => {
    const template = await ctx.db.get(templateId);
    await ctx.db.delete(templateId);
    if (template?.status === "published" && template.isPublic) {
      await markPublicDiscoveryListAndRelationsDirty(ctx);
    }
  },
});

/**
 * Patch domain + topics on an existing template (dedupe metadata refresh).
 * Called when content-hash matches an existing document but metadata has changed.
 */
export const patchMetadata = mutation({
  args: {
    templateId: v.id("templates"),
    domain: v.optional(v.string()),
    topics: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");
    if (template.userId !== userId) throw new Error("Unauthorized");

    // Metadata is part of the materialized public card. Re-evaluate the full
    // resulting authoring/public projection so this secondary writer cannot
    // bypass the create boundary's snapshot-availability budget.
    const inputBudget = validateTemplateInputBudgets(
      {
        title: template.title,
        slug: template.slug,
        description: template.description,
        messageBody: template.messageBody,
        preview: template.preview,
        type: template.type,
        deliveryMethod: template.deliveryMethod,
        domain: args.domain ?? resolveDomain(template),
        topics: args.topics ?? template.topics ?? [],
        sources: template.sources,
        researchLog: template.researchLog,
        deliveryConfig: template.deliveryConfig,
        cwcConfig: template.cwcConfig,
        recipientConfig: template.recipientConfig,
        scopes: template.scopes,
        jurisdictions: template.jurisdictions,
        contentHash: template.contentHash,
        status: template.status,
        isPublic: template.isPublic,
      },
      { includePublicInput: template.status === "published" && template.isPublic },
    );
    if (!inputBudget.ok) {
      throw new Error(
        `TEMPLATE_INPUT_BUDGET_EXCEEDED:${inputBudget.scope}:${inputBudget.reason}`,
      );
    }

    await ctx.db.patch(args.templateId, {
      updatedAt: Date.now(),
      ...(args.domain !== undefined ? { domain: args.domain } : {}),
      ...(args.topics !== undefined ? { topics: args.topics } : {}),
    });
    if (template.status === "published" && template.isPublic) {
      if (args.topics !== undefined) {
        await markPublicDiscoveryListAndRelationsDirty(ctx);
      } else if (args.domain !== undefined) {
        await markPublicDiscoveryListDirty(ctx);
      }
    }
  },
});

/**
 * Set CWC verification status on a template.
 */
export const setCwcVerification = mutation({
  args: {
    templateId: v.id("templates"),
    verificationStatus: v.string(),
    countryCode: v.string(),
    reputationApplied: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    await ctx.db.patch(args.templateId, {
      verificationStatus: args.verificationStatus,
      countryCode: args.countryCode,
      reputationApplied: args.reputationApplied,
    });
  },
});

// =============================================================================
// BACKFILL: Embed per-tag concepts (denoise the tag space for concept edges)
// =============================================================================

/**
 * Internal: public published templates whose tags are not yet embedded.
 *
 * A template needs a tag-embedding pass when it carries tags but its stored
 * `tagEmbeddings` don't cover the current tag set (newly authored, or tags
 * edited since the last pass). Embedding ~a dozen tags per template is a trivial
 * one-time Gemini cost, run alongside the topic-embedding backfill.
 */
export const listMissingTagEmbeddings = internalQuery({
  args: {},
  handler: async (ctx) => {
    let idsByKey: Record<PublicTemplateSnapshotKey, Array<Id<"templates">>>;
    try {
      idsByKey = await readPublishedPublicTemplateIds(ctx);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "PUBLIC_TEMPLATE_SNAPSHOT_INVALID:relations:list-not-ready"
      ) {
        // Cold start has no truthful displayed corpus yet. The consolidated
        // homepage rebuild publishes it later in the same daily maintenance
        // window; the next tag pass then embeds only those displayed IDs.
        return [];
      }
      throw error;
    }

    const selectedIds = [...new Set([...idsByKey.all, ...idsByKey.excludeCwc])];
    const templates = (
      await Promise.all(selectedIds.map(async (id) => await ctx.db.get(id)))
    ).filter((template): template is Doc<"templates"> => template !== null);

    return templates
      .map((t) => ({ doc: t, tags: normalizeTags(t.topics) }))
      .filter(({ doc, tags }) => {
        if (tags.length === 0) return false; // nothing to embed
        const covered = new Set(
          (Array.isArray(doc.tagEmbeddings) ? doc.tagEmbeddings : [])
            .filter((te) => te && Array.isArray(te.embedding) && te.embedding.length === 768)
            .map((te) => te.tag),
        );
        // Re-embed only when some current tag has no embedding yet.
        return tags.some((tag) => !covered.has(tag));
      })
      .map(({ doc, tags }) => ({ _id: doc._id, tags }));
  },
});

/**
 * Backfill per-tag embeddings via Gemini, mirroring the topicEmbedding path
 * (same model, RETRIEVAL_DOCUMENT task type, 768 dimensions). Each tag is
 * embedded once; the vectors are stored on the template (server-only) so the
 * concept query can cluster the tag vocabulary into concepts. No auth — internal.
 */
export const backfillTagEmbeddings = internalAction({
  args: {},
  handler: async (ctx) => {
    const missing: Array<{ _id: Id<"templates">; tags: string[] }> =
      await ctx.runQuery(listMissingTagEmbeddingsRef);

    if (missing.length === 0) {
      console.log("[backfill-tags] All template tags are embedded.");
      return { processed: 0 };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[backfill-tags] GEMINI_API_KEY not configured in Convex env vars.");
      return { processed: 0, error: "GEMINI_API_KEY missing" };
    }

    async function embed(text: string): Promise<number[] | null> {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: { parts: [{ text }] },
            taskType: "RETRIEVAL_DOCUMENT",
            outputDimensionality: 768,
          }),
        },
      );
      if (!res.ok) return null;
      const data = await res.json();
      return data.embedding?.values ?? null;
    }

    let processed = 0;
    for (const t of missing) {
      try {
        const embedded = await Promise.all(
          t.tags.map(async (tag) => ({ tag, embedding: await embed(tag) })),
        );
        const tagEmbeddings = embedded
          .filter((e): e is { tag: string; embedding: number[] } => Array.isArray(e.embedding))
          .map((e) => ({ tag: e.tag, embedding: e.embedding }));

        if (tagEmbeddings.length === 0) {
          console.error(`[backfill-tags] Gemini returned no tag embeddings for ${t._id}`);
          continue;
        }

        await ctx.runMutation(patchTagEmbeddingsRef, {
          templateId: t._id,
          tagEmbeddings,
        });
        processed++;
        console.log(`[backfill-tags] Embedded ${tagEmbeddings.length} tags for ${t._id}`);
      } catch (err) {
        console.error(`[backfill-tags] Failed for ${t._id}:`, err);
      }
    }

    console.log(`[backfill-tags] Done: ${processed}/${missing.length} templates.`);
    return { processed, total: missing.length };
  },
});

/** Internal mutation: store per-tag embeddings (server-only) on a template. */
export const patchTagEmbeddings = internalMutation({
  args: {
    templateId: v.id("templates"),
    tagEmbeddings: v.array(v.object({ tag: v.string(), embedding: v.array(v.float64()) })),
  },
  handler: async (ctx, args) => {
    if (args.tagEmbeddings.some(({ embedding }) => embedding.length !== 768)) {
      throw new Error("INVALID_TAG_EMBEDDING_DIMENSION:expected=768");
    }
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");
    await ctx.db.patch(args.templateId, {
      tagEmbeddings: args.tagEmbeddings,
      embeddingsUpdatedAt: Date.now(),
    });
    if (template.status === "published" && template.isPublic) {
      await markPublicDiscoveryRelationsDirty(ctx);
    }
  },
});

// =============================================================================
// DOMAIN HUE BACKFILL
// =============================================================================

/** Cosine similarity between two equal-length vectors. */
function _cosine(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Circular weighted mean of hue angles (handles 350° + 10° → 0°). */
function _circularMean(hues: number[], weights: number[]): number {
  let sinSum = 0, cosSum = 0, weightSum = 0;
  for (let i = 0; i < hues.length; i++) {
    const rad = (hues[i] * Math.PI) / 180;
    sinSum += weights[i] * Math.sin(rad);
    cosSum += weights[i] * Math.cos(rad);
    weightSum += weights[i];
  }
  if (weightSum === 0) return 0;
  const angle = (Math.atan2(sinSum / weightSum, cosSum / weightSum) * 180) / Math.PI;
  return ((angle % 360) + 360) % 360;
}

/** Project embedding onto anchors → hue angle. */
function _projectToHue(embedding: number[], anchors: Array<{ hue: number; embedding: number[] }>, topK = 3): number {
  const scored = anchors.map((a) => ({
    hue: a.hue,
    similarity: _cosine(embedding, a.embedding),
  }));
  scored.sort((a, b) => b.similarity - a.similarity);
  const top = scored.slice(0, topK);
  const minSim = Math.min(...top.map((t) => t.similarity));
  const shifted = top.map((t) => ({
    hue: t.hue,
    weight: Math.max(0, t.similarity - minSim + 0.01),
  }));
  return _circularMean(
    shifted.map((s) => s.hue),
    shifted.map((s) => s.weight),
  );
}

/**
 * Backfill domainHue on templates that have topicEmbedding but no domainHue.
 *
 * Usage: npx convex run templates:backfillDomainHue '{"anchors": <contents of domain-anchors.json>}'
 */
export const backfillDomainHue = internalAction({
  args: {
    anchors: v.array(v.object({
      hue: v.float64(),
      embedding: v.array(v.float64()),
    })),
  },
  handler: async (ctx, args) => {
    const candidates = await ctx.runQuery(listMissingDomainHueRef, {});
    console.log(`[backfillDomainHue] ${candidates.length} templates need domainHue`);

    let processed = 0;
    for (const t of candidates) {
      const hue = _projectToHue(t.topicEmbedding, args.anchors);
      await ctx.runMutation(patchDomainHueRef, {
        templateId: t._id,
        domainHue: hue,
      });
      processed++;
      console.log(`[backfillDomainHue] ${t._id} → hue ${hue.toFixed(1)}`);
    }

    return { processed, total: candidates.length };
  },
});

/** Internal query: find templates with topicEmbedding but no domainHue. */
export const _listMissingDomainHue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("templates").collect();
    return all
      .filter((t): t is typeof t & { topicEmbedding: number[] } =>
        t.topicEmbedding != null && !t.domainHue
      )
      .map((t) => ({
        _id: t._id,
        topicEmbedding: t.topicEmbedding,
      }));
  },
});

/** Internal mutation: set domainHue on a single template. */
export const _patchDomainHue = internalMutation({
  args: {
    templateId: v.id("templates"),
    domainHue: v.float64(),
  },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    await ctx.db.patch(args.templateId, { domainHue: args.domainHue });
    if (template?.status === "published" && template.isPublic) {
      await markPublicDiscoveryListDirty(ctx);
    }
  },
});
