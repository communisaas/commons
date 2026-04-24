# Templates

**The core unit of civic action. Templates are reusable message structures that resolve with user context at send time.**

**Schema specifics (2026-04-23):**

- **Schema location:** `convex/schema.ts`, table `templates`.
- **Field naming:** camelCase. `messageBody`, `researchLog`, `verifiedSends`, `uniqueDistricts`, `avgReputation`, `topicEmbedding`, etc.
- **Nested arrays, not separate tables:** `jurisdictions` and `scopes` are flattened onto the template record as `v.array(v.object({...}))`.
- **Category is deprecated:** `category` remains as a backward-compat string; the primary grouping fields are `domain` + `topics`.
- **Draft store encrypts DM emails separately:** `templateDraftStore` (`src/lib/stores/templateDraft.ts`) strips decision-maker emails from the plaintext draft and encrypts them in a separate localStorage key to avoid plaintext PII.
- **`recipientConfig`** is stored as opaque `v.any()`; there is no typed `recipientEmails` computed field on current responses.

---

## Table of Contents

1. [Data Model](#data-model)
2. [CRUD Operations](#crud-operations)
3. [Template Creation Flow](#template-creation-flow)
4. [Rich Text Editor](#rich-text-editor)
5. [Variable System](#variable-system)
6. [Content Moderation](#content-moderation)
7. [Jurisdiction Scoping](#jurisdiction-scoping)
8. [Share URLs](#share-urls)
9. [Draft System](#draft-system)
10. [Search and Discovery](#search-and-discovery)
11. [Key Files](#key-files)

---

## Data Model

The `Template` model stores the message content, delivery configuration, moderation state, and aggregate community metrics.

**Core fields:**

| Field | Type | Purpose |
|---|---|---|
| `id` | `String @id` | CUID primary key |
| `slug` | `String @unique` | URL path segment (`/s/[slug]`) |
| `title` | `String` | Also used as email subject line |
| `description` | `String` | Short summary (auto-derived from preview if omitted) |
| `message_body` | `String` | Full message text with `[Variable]` placeholders |
| `preview` | `String` | Short preview text (max 500 chars) |
| `category` | `String` | Grouping category (default: "General") |
| `topics` | `Json` | Topic tags for search/filtering (1-5 lowercase strings) |
| `type` | `String` | Template type |
| `deliveryMethod` | `String` | `'email'`, `'email_attested'`, `'certified'`, `'direct'`, `'cwc'` |
| `sources` | `Json` | Citation sources from message generation agent |
| `research_log` | `Json` | Agent's research process log |
| `status` | `String` | `'draft'` or `'published'` (auto-set by moderation) |
| `is_public` | `Boolean` | Visibility in template listing |
| `content_hash` | `String?` | SHA-256(title + body) for deduplication |

**Aggregate metrics (no individual user tracking):**

| Field | Type | Purpose |
|---|---|---|
| `verified_sends` | `Int` | Total verified messages sent |
| `unique_districts` | `Int` | Unique congressional districts reached |
| `avg_reputation` | `Float?` | Average sender reputation |

**Moderation fields:**

| Field | Type | Purpose |
|---|---|---|
| `flagged_by_moderation` | `Boolean` | Whether content was flagged |
| `consensus_approved` | `Boolean` | Multi-agent moderation passed |
| `verification_status` | `String?` | `'pending'`, `'approved'`, `'rejected'` |

**Semantic search:**

| Field | Type | Purpose |
|---|---|---|
| `location_embedding` | `Json?` | Gemini embedding of location context |
| `topic_embedding` | `Json?` | Gemini embedding of policy topic |

**Relationships:**

- `User` (author) -- dual ownership with `Organization`
- `TemplateJurisdiction[]` -- structured US jurisdictions (federal, state, county, city, school district)
- `TemplateScope[]` -- international geographic scope (agent-extracted, used for breadcrumb filtering)
- `Message[]` -- verifiable sent messages (pseudonymous, no user linkage)
- `Debate[]` -- staked deliberation threads (feature-gated)

A unique constraint on `(userId, content_hash)` prevents the same author from publishing duplicate content. The POST endpoint returns the existing template idempotently if a duplicate is detected.

---

## CRUD Operations

### `GET /api/templates`

Returns all public templates (`is_public: true`), ordered by creation date descending.

Response includes computed fields:
- `coordinationScale` -- logarithmic 0-1 scale based on `verified_sends` (for visual weight in UI)
- `isNew` -- true if created within the last 7 days
- `hasActiveDebate` -- cross-referenced from the Debate table
- `scopes` -- joined from `TemplateScope` table for hierarchical location filtering
- `recipientEmails` -- extracted from `recipient_config` JSON

### `POST /api/templates`

Creates a new template. Requires authentication and either verified identity or trust score >= 100 (anti-astroturf gate).

**Required fields:** `title`, `message_body`, `preview`, `type`, `deliveryMethod`

**Pipeline on creation:**
1. Validate request body (title max 200 chars, message_body max 10,000 chars, preview max 500 chars)
2. Run 2-layer content moderation (see [Content Moderation](#content-moderation))
3. Compute `content_hash` and check for duplicate by same author
4. Check slug availability (auto-generated from title, or AI-provided)
5. Create template + `TemplateScope` in a transaction
6. If moderation passes: auto-publish (`status: 'published'`, `is_public: true`)
7. Fire-and-forget: generate Gemini embeddings for search

**No manual review step.** Templates that pass moderation are immediately public.

### `GET /api/templates/check-slug?slug=...&title=...`

Checks slug availability. If taken, returns up to 3 alternative suggestions (action-prefixed, year-suffixed, or shortened variants).

---

## Template Creation Flow

Templates are created through a multi-step guided workflow, not a blank editor.

**Steps:** Objective → Decision Makers → Message → Publish

The `TemplateCreator.svelte` component orchestrates these steps:

1. **UnifiedObjectiveEntry** -- User describes their goal in free text. An AI agent (Gemini) processes this into a structured subject line, topic tags, and URL slug.

2. **DecisionMakerResolver** -- AI agent identifies relevant decision makers based on the objective. Users can add custom recipients with email addresses.

3. **MessageGenerationResolver** -- AI agent (Gemini via SSE streaming) generates a full message body with citations, research log, and geographic scope extraction. The user reviews the result and can edit before publishing.

The message writer agent generates `[Personal Connection]` placeholders, citation markers `[1]`, `[2]`, and positions variables strategically within the message body.

---

## Rich Text Editor

The platform uses **Tiptap 3.x** (ProseMirror-based) for rich text editing, currently in the org-layer email compose flow (`/org/[slug]/emails/compose`).

Tiptap extensions in use:
- `@tiptap/starter-kit` -- basic formatting (bold, italic, headings, lists, code blocks)
- `@tiptap/extension-link` -- clickable links
- `@tiptap/extension-text-align` -- text alignment
- `@tiptap/extension-underline` -- underline formatting

Template creation itself uses AI-generated plain text with bracket variables, not a rich text editor. The message writer agent produces the body via SSE streaming, and users edit the result in a standard textarea before publishing.

There is no CodeMirror in the codebase.

---

## Variable System

Templates use bracket-notation variables (`[Name]`, `[Representative Name]`, `[Personal Connection]`) that are resolved at render/send time by `resolveTemplate()`.

Two categories:
- **System variables** -- auto-filled from user profile and congressional data
- **User-editable variables** -- require manual input (e.g., `[Personal Connection]`)

For the full variable reference, resolution logic, and UI rendering behavior, see **[Template Variables](template-variables.md)**.

---

## Content Moderation

All templates pass through a 2-layer automated moderation pipeline before creation:

1. **Llama Prompt Guard 2** (via Groq) -- prompt injection detection
2. **Llama Guard 4 12B** (via Groq) -- content safety (MLCommons S1-S14 taxonomy)

Only two hazard categories block content: S1 (violent crimes/threats) and S4 (CSAM). Political speech, defamation claims, and controversial opinions are explicitly allowed.

If moderation rejects: HTTP 400 with `CONTENT_FLAGGED` error. If Groq is unreachable: HTTP 503 with `MODERATION_FAILED` (fail-closed -- template is NOT created).

There is no human review, no admin dashboard, and no approval queue. This is by design.

For the full moderation architecture, hazard taxonomy, and integration points, see **[Content Moderation](../development/moderation.md)**.

---

## Jurisdiction Scoping

Templates have two complementary geographic scoping systems:

### TemplateJurisdiction (US-specific)

Structured US jurisdictions with fields for congressional district, senate class, state code, county FIPS, city FIPS, and school district ID. Supports geospatial data (lat/lng) and population estimates.

### TemplateScope (international)

Universal semantic hierarchy: `country → region → locality → district`. Works internationally with ISO 3166-1 country codes. Key fields:

- `scope_level` -- `'country'`, `'region'`, `'locality'`, `'district'`
- `display_text` -- human-readable label (e.g., "California", "CA-12", "London")
- `power_structure_type` -- open-ended (government, corporate, housing, labor, etc.)
- `audience_filter` -- target audience (renters, workers, shareholders, etc.)
- `confidence` + `extraction_method` -- tracks how the scope was determined (`'regex'`, `'fuzzy'`, `'geocoder'`, `'llm'`, `'user_confirmed'`)

During template creation, the message writer agent extracts geographic scope from the content and creates a `TemplateScope` row in the same transaction. Users can edit the scope via `GeographicScopeEditor.svelte` before publishing.

---

## Share URLs

Published templates are accessible at `/s/[slug]`. The slug is auto-generated from the title (lowercase, alphanumeric + hyphens, max 100 chars) or provided by the AI subject line agent.

The share page (`src/routes/s/[slug]/+page.server.ts`) loads the template along with:
- District-level message delivery data
- Active debates and argument scores
- Position registration counts (support/oppose)
- User's district officials (from Shadow Atlas)
- Engagement heatmap by district

Debate threads live at `/s/[slug]/debate/[debateId]`.

---

## Draft System

The `templateDraftStore` persists work-in-progress templates to localStorage.

Key behaviors:
- Auto-save every 30 seconds (if meaningful content exists)
- Drafts expire after 7 days
- Keyed by generated draft IDs (supports multiple concurrent drafts)
- Saves all form state: objective, audience (decision makers + custom recipients), content (message, sources, research log, geographic scope), and current step
- Strips Svelte reactive proxies via `structuredClone()` before serializing
- On successful publish: draft is deleted. On failure: draft is preserved.
- Supports OAuth resumption -- draft ID is passed through the auth flow so work is recoverable.

---

## Search and Discovery

Templates support two search vectors via Gemini embeddings:

- **Location embedding** -- generated from `title + description + category`
- **Topic embedding** -- generated from `title + description + message_body`

Embeddings are generated asynchronously (fire-and-forget) after template creation. The `embedding_version` field tracks the embedding model version for future migrations.

Client-side filtering uses `TemplateScope` data for hierarchical location matching (country → region → locality → district).

The `GET /api/templates` endpoint returns `topics` tags (1-5 lowercase strings) extracted by the AI agent, enabling category and keyword filtering.

---

## Key Files

| File | Purpose |
|---|---|
| `convex/schema.ts` | `templates` table definition (with nested `jurisdictions` + `scopes`) |
| `convex/templates.ts` | Convex queries/mutations for list, get, create, check-slug |
| `src/routes/api/templates/+server.ts` | SvelteKit bridge → Convex (GET list, POST create) |
| `src/routes/api/templates/check-slug/+server.ts` | SvelteKit bridge for slug availability check |
| `src/lib/utils/templateResolver.ts` | Variable resolution engine |
| `src/lib/components/template/TemplateCreator.svelte` | Multi-step creation orchestrator |
| `src/lib/components/template/creator/UnifiedObjectiveEntry.svelte` | Step 1: objective + AI subject line |
| `src/lib/components/template/creator/DecisionMakerResolver.svelte` | Step 2: AI decision maker discovery |
| `src/lib/components/template/creator/MessageGenerationResolver.svelte` | Step 3: AI message generation + review |
| `src/lib/components/template/creator/MessageResults.svelte` | Generated message display with citations |
| `src/lib/components/template/creator/SlugCustomizer.svelte` | URL slug editor with availability check |
| `src/lib/components/template/creator/GeographicScopeEditor.svelte` | Geographic scope editing UI |
| `src/lib/components/template/TemplateCard.svelte` | Template listing card component |
| `src/lib/stores/templateDraft.ts` | localStorage draft persistence |
| `src/lib/core/server/moderation/index.ts` | Moderation pipeline orchestration |
| `src/routes/s/[slug]/+page.server.ts` | Share page data loading |

---

**See also:**
- [Template Variables](template-variables.md) -- variable types, resolution logic, UI rendering
- [Content Moderation](../development/moderation.md) -- full moderation architecture and hazard taxonomy
- [Template Creator](creator.md) -- detailed creator component architecture
- [Agents](../development/agents.md) -- AI agent system (subject line, message writer, decision maker)
