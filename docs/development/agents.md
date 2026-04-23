# AI Agent System

**Status**: IMPLEMENTED | Gemini 3 Flash + SSE Streaming + Multi-Phase Pipelines

> ⚠️ **2026-04-23 audit — small but load-bearing corrections:**
>
> - **Agent roster is 4+, not 3.** Beyond subject-line / decision-maker /
>   message-writer, `src/lib/core/agents/agents/` also contains
>   `source-discovery.ts`, `source-evaluator.ts`, and
>   `decision-maker-accountability.ts`. Source discovery/evaluation
>   should be documented as first-class (the message-writer flow
>   invokes them as distinct agents, not private helpers).
> - **SSE event vocabulary per endpoint** (from the real route
>   handlers):
>   - `/stream-subject` → `thought`, `clarification`, `complete`, `error`
>   - `/stream-message` → `thought`, `phase` (values include
>     `'sources'`, `'validate'`, `'generate'`), `complete`, `error`
>   - `/stream-decision-makers` → `segment`, `identity-found`,
>     `candidate-resolved`, `verification`, `complete`, `error`
>     (no `phase`, no `progress`; `thought` text travels inside
>     `segment.content`, not as a separate event)
> - **Email "verbatim" verification** is a case-insensitive substring
>   match (`email.toLowerCase().includes(emailLower)`) against fetched
>   page text — not a literal verbatim scan.
> - **Subject-line threshold is 0.5 default, not 0.6.** Call site
>   (`src/routes/api/agents/stream-subject/+server.ts:~77`) invokes
>   `moderatePromptOnly(body.message)` with no threshold arg; message
>   + DM routes pass 0.8 explicitly.
> - **Layer-1 moderation model migrated** to `openai/gpt-oss-safeguard-20b`
>   (`llama-guard.ts:20`). Any "Llama Guard 4" naming is historical.
> - **Rate-limit table (canonical, from `llm-cost-protection.ts`):**
>   subject 3/5/5/hr, DM 0/2/3/hr, message 0/3/5/hr,
>   embeddings 0/20/20/hr, daily global 3/10/15/day. Higher numbers
>   elsewhere are wrong.
> - **`FEATURES.DELEGATION=false`** — agentic-delegation endpoints are
>   code-present but not live.

---

**Three AI agents power the campaign creation flow: subject line generation, decision-maker resolution, and message writing.**

## Architecture

```
User Input → API Route → Agent Pipeline → SSE Stream → Client UI
                              ↓
                    Gemini 3 Flash (primary LLM)
                    Exa Search (web search)
                    Firecrawl (page scraping)
                    Groq (prompt injection detection)
```

**Foundation**: `src/lib/core/agents/gemini-client.ts` — singleton `@google/genai` client with retry logic, token tracking, and thought streaming.

**Model**: `gemini-3-flash-preview` (low latency, advanced features). Temperature and thinking level tuned per agent.

---

## Agents

### 1. Subject Line Generator

**Route**: `POST /api/agents/stream-subject`

Transforms raw civic issue into crystallized subject line + structured metadata.

**Two modes**:
- **Clarification**: Asks 1-2 questions (multiple choice, location picker, open text) when input is ambiguous
- **Generation**: Returns subject line, core message, topics, URL slug, voice sample, inferred context (location, scope, target type, urgency)

**Configuration**: Temperature 0.7 (creative latitude), thinking level high.

**Prompt design**: Emotional archaeology — finds what the user *felt*, not the policy topic. Forbids petition-speak, institutional framing, person names (only structural roles).

### 2. Decision-Maker Resolution

**Route**: `POST /api/agents/stream-decision-makers`

Multi-phase agentic pipeline that identifies people with power over an issue and finds verified contact information.

**Four phases**:

1. **Role Discovery** — Identifies 8-10 positions with structural power (budget authority, regulatory, legislative). No grounding needed.
2. **Identity Extraction** — Parallel Exa searches to find current holders. Detects vacant positions.
3. **Contact Hunting** — Per-identity agentic sessions with function calling tools (`search_web`, `read_page`, `analyze_document`). Budget: 1 search + 2 reads per identity. Email must be found verbatim on institutional page.
4. **Accountability** — Generates per-person accountability openers, role categories, relevance ranking. Non-fatal (pipeline continues if this fails).

**Email verification**: `verifyEmailBatch()` checks deliverability. Drops undeliverable addresses.

**Server timeout**: 4-minute ceiling prevents runaway resolutions.

### 3. Message Writer

**Route**: `POST /api/agents/stream-message`

Two-phase verified source pipeline that eliminates citation hallucination.

**Phase 1 — Source Discovery**: Google Search grounding via Gemini. Discovered URLs verified via HTTP HEAD requests. Only verified sources pass to Phase 2.

**Phase 2 — Message Generation**: Writes using ONLY the verified source pool. Generates narrative with `[Personal Connection]` placeholder, citation markers `[1][2]`, and research log of actual search queries.

**Configuration**: Temperature 0.8 (linguistic range — sources provide factual grounding).

---

## SSE Streaming

All agents stream results via Server-Sent Events for real-time UI feedback.

**Server-side** (`src/lib/server/sse-stream.ts`):
```typescript
const { stream, emitter } = createSSEStream();
emitter.thought('Searching for relevant sources...');
emitter.progress(3, 10, 'sources');
emitter.complete(finalResult);
return new Response(stream, { headers: SSE_HEADERS });
```

**Client-side** (`src/lib/utils/sse-stream.ts`):
```typescript
for await (const event of parseSSEStream<AgentEvent>(response)) {
  if (event.type === 'thought') showThought(event.data);
  if (event.type === 'complete') handleResult(event.data);
}
```

**Event types**: `thought`, `phase`, `progress`, `segment`, `identity-found`, `candidate-resolved`, `verification`, `clarification`, `complete`, `error`

---

## Cost Model

### Per-Operation Estimates (Gemini 3 Flash)

| Operation | Gemini Calls | External APIs | Estimated Cost |
|---|---|---|---|
| Subject line | 1-2 | None | ~$0.01-0.02 |
| Decision makers | 4-6 | Exa ($0.005/search) + Firecrawl ($0.01-0.05/page) | ~$0.08-0.15 |
| Message generation | 2 | Google Search grounding | ~$0.03-0.05 |

### Per-User Quotas

| Operation | Guest | Authenticated | Verified (Tier 2+) |
|---|---|---|---|
| Subject line | 5/hr | 15/hr | 30/hr |
| Decision makers | Blocked | 3/hr | 10/hr |
| Message generation | Blocked | 10/hr | 30/hr |
| Daily global | 10/day | 50/day | 150/day |

Quota enforcement: `src/lib/server/llm-cost-protection.ts`

### Token Tracking

Every operation tracks `TokenUsage` (prompt, candidate, thought tokens) and external API counts (Exa searches, Firecrawl reads, Groq moderations). Logged via `logLLMOperation()`.

---

## Safety

**Prompt injection detection** runs before every agent call via Groq's Llama Prompt Guard 2.

| Context | Threshold | Rationale |
|---|---|---|
| Subject line (raw user input) | 0.6 | Most exposed to injection |
| Message/decision makers (AI-refined) | 0.8 | Input already processed |

---

## Configuration

### Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Gemini API access |
| `GROQ_API_KEY` | Yes | Prompt injection detection |
| `EXA_API_KEY` | For decision makers | Web search |
| `FIRECRAWL_API_KEY` | For decision makers | Page scraping |

### Tuning

- **Temperature**: Set per agent in prompt files (`src/lib/core/agents/prompts/`)
- **Thinking level**: low (1,024 budget), medium (4,096), high (8,192)
- **Max output tokens**: 65,536 (Gemini 3.0 max)

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `RESOURCE_EXHAUSTED` | Retry with exponential backoff (1s, 2s, 4s), max 3 retries |
| `MAX_TOKENS` truncation | Attempt JSON recovery via `recoverTruncatedJson()` |
| JSON parse failure | Extract from grounding response, strip markdown fences |
| Email verification failure | Non-fatal — drops person from list, emits warning |
| Phase 4 (accountability) failure | Non-fatal — pipeline continues without openers |
| External API down | Circuit breaker opens, skips after threshold failures |

---

## Key Files

| File | Purpose |
|---|---|
| `src/lib/core/agents/gemini-client.ts` | Gemini SDK wrapper, retry, token tracking |
| `src/lib/core/agents/agents/subject-line.ts` | Subject line agent |
| `src/lib/core/agents/agents/message-writer.ts` | Two-phase message writer |
| `src/lib/core/agents/agents/decision-maker.ts` | Multi-phase decision maker resolver |
| `src/lib/core/agents/prompts/` | System prompts per agent |
| `src/lib/core/agents/index.ts` | Agent barrel exports |
| `src/lib/server/sse-stream.ts` | Server-side SSE emitter |
| `src/lib/utils/sse-stream.ts` | Client-side SSE parser |
| `src/lib/server/llm-cost-protection.ts` | Per-user LLM quotas |
| `src/lib/core/thoughts/` | Thought emission and filtering |
| `src/routes/api/agents/stream-subject/+server.ts` | Subject line API route |
| `src/routes/api/agents/stream-message/+server.ts` | Message generation API route |
| `src/routes/api/agents/stream-decision-makers/+server.ts` | Decision maker API route |
| `src/lib/server/exa/client.ts` | Exa search client |
| `src/lib/server/firecrawl/client.ts` | Firecrawl scraping client |
