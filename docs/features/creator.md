# Template Creator

**Status**: IMPLEMENTED | AI-Powered Multi-Step Campaign Authoring

> ⚠️ **2026-04-23 audit — minor metric drift; architecture is accurate.**
> Flow, API endpoints, SSE event types, draft persistence, domain/topics,
> moderation, and decision-maker pipeline are all correct against code.
> Things to treat skeptically:
>
> - **Component line counts are stale** — most listed values are 50–170%
>   under actual sizes (e.g. `UnifiedObjectiveEntry` is ~1,529 lines,
>   not ~550; `MessageGenerationResolver` ~649, not ~480). Use as rough
>   landmarks only.
> - **File count in `src/lib/components/template/creator/` is 15**, not 14.
> - **`SourceEditor.svelte` (~460 lines) exists** in that directory but
>   is missing from the architecture tree below.
> - **Step naming:** code uses `'objective' | 'audience' | 'content'`
>   internally; UI labels step 2 as "Who Controls This?"; this doc
>   sometimes refers to step 2 as "Decision-Makers". Same step, three
>   names.
> - **Draft save timing:** 2s debounce on content-change **plus** 30s
>   periodic auto-save from the store (`templateDraftStore.startAutoSave`).
>   The "auto-saves every 2s (debounced)" summary is the debounce leg
>   only.

---

**Guided creation flow that transforms a raw civic concern into a research-backed, publishable campaign template with verified decision-maker contacts.**

## Overview

The Template Creator is a three-step wizard rendered inside a modal on the homepage (`src/routes/+page.svelte`). Each step is powered by a Gemini AI agent that streams reasoning to the UI via SSE.

**Flow**: Objective --> Decision-Makers --> Message + Publish

**Steps**:
1. **Objective** -- User describes their issue in free text. The subject-line agent crystallizes it into a title, description, topics, URL slug, and voice sample. May ask 1-2 clarifying questions first.
2. **Decision-Makers** -- The decision-maker agent identifies people with structural power over the issue, then hunts for verified contact emails via web search.
3. **Message + Publish** -- The message-writer agent researches the issue, discovers verified sources, and writes a citation-backed message. User reviews, edits, and publishes.

**State machine**: If the user changes the subject line and advances, all downstream state (decision-makers, message) is invalidated and re-generated.

## Component Architecture

The orchestrator lives one level up from the `creator/` directory. All child components are in `src/lib/components/template/creator/`.

```
+page.svelte (homepage)
  └─ TemplateCreator.svelte          Orchestrator: step state, draft persistence, validation, publish
       ├─ UnifiedObjectiveEntry       Step 1: free-text input, AI suggestion panel, clarification
       │    ├─ SlugCustomizer          URL slug generation, availability check, manual override
       │    └─ ClarificationPanel      Conversational clarification UI (multiple-choice, location, open-text)
       ├─ DecisionMakerResolver       Step 2: SSE streaming resolution, progressive card reveal
       │    ├─ DecisionMakerResults    Editable results list with grouped display
       │    │    ├─ DecisionMakerGrouped   Organization-grouped cards with inline email editing
       │    │    ├─ DecisionMakerCard      Individual decision-maker card with provenance
       │    │    └─ CustomDecisionMakerForm Manual recipient entry form
       │    └─ AuthGateOverlay         Progressive auth prompt (preserves sunk-cost context)
       └─ MessageGenerationResolver   Step 3: SSE streaming message generation + publish
            ├─ MessageResults          Message display with citations, sources, geographic scope
            │    ├─ SourceCard          Expandable citation card (domain, type badge)
            │    ├─ ResearchLog         Collapsible log of agent's research steps
            │    └─ GeographicScopeEditor  AI-inferred scope with manual override via LocationPicker
            └─ AuthGateOverlay         (reused) Auth gate for unauthenticated users
```

### Component Roles

| Component | Lines | Purpose |
|---|---|---|
| `TemplateCreator.svelte` | ~710 | Step navigation, draft auto-save (2s debounce), validation, publish flow, state machine invalidation |
| `UnifiedObjectiveEntry.svelte` | ~550 | Free-text input, calls `POST /api/agents/stream-subject`, renders AI suggestion panel, handles clarification turns |
| `DecisionMakerResolver.svelte` | ~670 | Calls `POST /api/agents/stream-decision-makers`, progressive card reveal during resolution, auth/rate-limit handling |
| `MessageGenerationResolver.svelte` | ~480 | Calls `POST /api/agents/stream-message`, inline message editing, publish button with error display |
| `DecisionMakerResults.svelte` | ~200 | Editable list of resolved decision-makers, custom recipient addition, "Include Congress" toggle |
| `MessageResults.svelte` | ~200 | Rendered message with paragraph splitting, citation highlighting, source cards, research log, geographic scope |
| `SlugCustomizer.svelte` | ~150 | Slug generation from title, availability check via `POST /api/templates/check-slug`, manual override |
| `ClarificationPanel.svelte` | ~200 | Multiple-choice, location picker, and open-text question types; max 2 questions |
| `AuthGateOverlay.svelte` | ~150 | Shows sunk-cost progress (subject, decision-makers) to motivate sign-in; preserves draft ID for OAuth resumption |
| `DecisionMakerCard.svelte` | ~80 | Single decision-maker card with email, provenance toggle, remove action |
| `DecisionMakerGrouped.svelte` | ~120 | Groups decision-makers by organization, inline email editing for missing addresses |
| `CustomDecisionMakerForm.svelte` | ~60 | Manual email/name/org entry with validation |
| `SourceCard.svelte` | ~60 | Expandable citation: domain, source type badge, formatted citation |
| `ResearchLog.svelte` | ~40 | Collapsible list of agent research steps |
| `GeographicScopeEditor.svelte` | ~40 | Displays AI-inferred geographic scope, editable via LocationPicker |

## Agent Pipeline Integration

Each step calls a streaming API endpoint that runs a Gemini agent. See [agents.md](../development/agents.md) for full agent documentation.

### Step 1: Subject Line Agent

**Endpoint**: `POST /api/agents/stream-subject`

The `UnifiedObjectiveEntry` component sends the user's raw text and receives either clarification questions or a structured suggestion:

```
{ subject_line, core_message, topics[], url_slug, voice_sample }
```

Features client-side caching (`SuggestionCache`) and rate limiting (`SuggestionRateLimiter`) to avoid redundant API calls during typing.

### Step 2: Decision-Maker Agent

**Endpoint**: `POST /api/agents/stream-decision-makers`

The `DecisionMakerResolver` component sends the subject line, core message, topics, and voice sample. The server runs a 4-phase pipeline:

1. Role discovery (structural power analysis)
2. Identity extraction (parallel web searches)
3. Contact hunting (agentic per-identity sessions with `search_web`, `read_page`, `analyze_document` tools)
4. Accountability openers (per-person context for the message writer)

**Progressive reveal**: Cards appear as `identity-found` events arrive, then animate to resolved/no-email states as `candidate-resolved` events stream in.

### Step 3: Message Writer Agent

**Endpoint**: `POST /api/agents/stream-message`

The `MessageGenerationResolver` component sends subject, core message, topics, decision-maker names, and voice sample. Two-phase source-verified pipeline:

1. **Source Discovery** -- Google Search grounding, URL validation
2. **Message Generation** -- Writes using only verified sources, with `[1][2]` citation markers and `[Personal Connection]` placeholder

The generated message includes `sources[]`, `research_log[]`, and `geographic_scope` (ISO 3166 GeoScope).

## SSE Streaming

All agent endpoints stream Server-Sent Events. The client uses `parseSSEStream()` from `src/lib/utils/sse-stream.ts`:

```typescript
for await (const event of parseSSEStream<Record<string, unknown>>(response)) {
  switch (event.type) {
    case 'segment':    // Thought/reasoning text
    case 'identity-found':   // Decision-maker cards (phase 2a)
    case 'candidate-resolved': // Contact resolution (phase 2b)
    case 'complete':   // Final structured result
    case 'error':      // Error with message
  }
}
```

Thought streams are rendered by `AgentThinking` (`src/lib/components/ui/AgentThinking.svelte`), which shows the agent's live reasoning.

## Draft Persistence

`TemplateCreator` auto-saves to localStorage via `templateDraftStore` every 2 seconds (debounced). Drafts persist across page reloads and OAuth redirects.

- On mount: checks for existing drafts, offers recovery modal
- On destroy: saves if `draftCleanupMode === 'save'`, deletes if publish succeeded
- Draft includes: `formData`, `currentStep`, `pendingSuggestion`
- OAuth resumption: `draftId` and `onSaveDraft` passed to `AuthGateOverlay` so draft is saved before redirect

## Publish Flow

When the user clicks "Publish" on the message step:

1. `MessageGenerationResolver` calls `onnext()`, which maps to `handleSave()` in `TemplateCreator`
2. `handleSave()` validates, extracts recipient emails, appends source references to message body
3. Fires `onsave(template)` to the parent (`+page.svelte`)
4. Parent calls `POST /api/templates` with the template payload
5. Server validates, runs 2-layer content moderation (Llama Guard + Gemini), creates DB record
6. On success: draft is deleted, success modal shown, user redirected to `/s/{slug}`

**API endpoint**: `POST /api/templates` (not `/api/templates/create`)

**Moderation**: Templates are auto-published if moderation passes. Rejected templates return a `CONTENT_FLAGGED` error with a human-readable summary.

**Anti-astroturf gate**: Requires verified identity or trust score >= 100.

## Key Files

| File | Purpose |
|---|---|
| `src/lib/components/template/TemplateCreator.svelte` | Orchestrator |
| `src/lib/components/template/creator/` | All child components (14 files) |
| `src/routes/+page.svelte` | Hosts creator in modal |
| `src/routes/api/templates/+server.ts` | `POST /api/templates` -- create + validate + moderate |
| `src/routes/api/templates/check-slug/+server.ts` | Slug availability check |
| `src/routes/api/agents/stream-subject/+server.ts` | Subject line streaming endpoint |
| `src/routes/api/agents/stream-decision-makers/+server.ts` | Decision-maker streaming endpoint |
| `src/routes/api/agents/stream-message/+server.ts` | Message generation streaming endpoint |
| `src/lib/core/agents/agents/subject-line.ts` | Subject line agent |
| `src/lib/core/agents/agents/decision-maker.ts` | Decision-maker resolution agent |
| `src/lib/core/agents/agents/message-writer.ts` | Message writer agent |
| `src/lib/core/agents/agents/source-discovery.ts` | Source discovery (Phase 1 of message writer) |
| `src/lib/utils/sse-stream.ts` | Client-side SSE parser (`parseSSEStream`) |
| `src/lib/stores/templateDraft.ts` | Draft auto-save store (localStorage) |
| `src/lib/types/template.ts` | `TemplateFormData`, `TemplateCreationContext`, `ProcessedDecisionMaker` |
| `src/lib/utils/message-processing.ts` | `appendReferences`, `cleanHtmlFormatting`, `splitIntoParagraphs` |
| `src/lib/utils/decision-maker-processing.ts` | `processDecisionMakers`, `extractRecipientEmails` |

## References

- [AI Agent System](../development/agents.md) -- full agent documentation, cost model, quotas
- [Templates](templates.md) -- template data model and sending flow
- [Template Variables](template-variables.md) -- variable system and resolution
