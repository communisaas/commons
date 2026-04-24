# Subject-Line Agent: Minimal Clarifying Questions

> **STATUS: SHIPPED** — Clarification UX is live in the subject-line agent pipeline.

## Design Philosophy

The subject-line agent is the gateway to the agentic pipeline. When input is ambiguous in ways that significantly affect downstream targeting, the agent should ask **minimal, effortless clarifying questions** rather than guessing wrong.

### Core Principle: Ask Only When It Matters

From [ICLR 2025 research](https://proceedings.iclr.cc/paper_files/paper/2025/file/97e2df4bb8b2f1913657344a693166a2-Paper-Conference.pdf), state-of-the-art LLMs often don't ask clarifying questions due to RLHF training on single-turn preferences. We must explicitly design for judicious clarification.

**Ask when:**
- Geographic scope ambiguity would lead to **different decision-makers** (local mayor vs federal agency)
- Target type ambiguity would lead to **different power structures** (government vs corporate)
- Multiple valid interpretations exist with **significantly different downstream paths**

**Don't ask when:**
- Agent can reasonably infer from context clues
- Ambiguity wouldn't meaningfully change the output
- User's voice sample or rawInput contains implicit signals

### Design Constraints

1. **0-2 questions maximum** - Beyond this creates friction that kills engagement
2. **Multiple choice only** - No open text fields for clarification (that's what the rawInput already is)
3. **Pre-populated from analysis** - Agent's best guesses become the options
4. **Location uses existing UI** - LocationAutocomplete component, not free text
5. **Single screen** - All questions visible at once, not a wizard

---

## Question Types

### 1. Geographic Scope (Location Question)

**Trigger Condition:**
- Input mentions a place name that could be local OR references a broader policy
- No clear location signal from user's inferred location
- Scope would change target decision-makers (city council vs state legislature vs Congress)

**UI Pattern:**
```
Where is this happening?

[LocationAutocomplete: Country → State → City]
   └── Pre-filled with agent's best guess if detectable
   └── "Nationwide" option always available
   └── Uses existing Nominatim/Census integration
```

**Examples:**
- "housing crisis" → Could be SF, CA, or national. Ask.
- "SF's 28-day policy" → Clear. Don't ask.
- "congress should act" → National. Don't ask.

### 2. Scope Level (Chips)

**Trigger Condition:**
- Geographic place detected but unclear if issue is local instance or systemic
- Would change whether we target local officials or national policymakers

**UI Pattern:**
```
Is this about...

[Local issue] [Statewide policy] [National policy] [Corporate/Private]
     ↑ Pre-selected based on agent analysis
```

**Examples:**
- "rent is too high" + location=SF → Pre-select "Local issue", but offer alternatives
- "student debt crisis" → Pre-select "National policy"

### 3. Target Type (Radio)

**Trigger Condition:**
- Input could target multiple power structure types
- Would route to completely different decision-makers

**UI Pattern:**
```
Who controls this?

○ Government officials (mayors, legislators, regulators)
○ Corporate executives (CEOs, boards, shareholders)
○ Institutional leaders (universities, hospitals, school boards)
○ Other (unions, HOAs, nonprofits)
     ↑ Pre-selected based on agent analysis
```

**Examples:**
- "Amazon workers deserve better" → Pre-select "Corporate executives"
- "fix the roads" → Pre-select "Government officials"
- "tuition hikes" → Could be government OR institutional. Ask.

---

## Agent Response Schema

### Current Schema (No Clarification)
```typescript
interface SubjectLineResponse {
  subject_line: string;
  core_issue: string;
  topics: string[];
  url_slug: string;
  voice_sample: string;
}
```

### Extended Schema (With Clarification)
```typescript
interface SubjectLineResponse {
  // Standard output (only present if no clarification needed)
  subject_line?: string;
  core_issue?: string;
  topics?: string[];
  url_slug?: string;
  voice_sample?: string;

  // Clarification request (only present if clarification needed)
  needs_clarification?: boolean;
  clarification_questions?: ClarificationQuestion[];

  // Agent's best guesses (always present)
  inferred_context?: {
    detected_location?: string;      // "San Francisco, CA" or null
    detected_scope?: GeographicScope; // 'local' | 'state' | 'national' | null
    detected_target_type?: TargetType; // 'government' | 'corporate' | 'institutional' | null
    confidence: number;               // 0-1, ask if below threshold
  };
}

interface ClarificationQuestion {
  id: 'location' | 'scope' | 'target_type';
  question: string;
  type: 'location_picker' | 'single_choice' | 'chips';
  options?: ClarificationOption[];
  preselected?: string;  // Agent's best guess
  required: boolean;
}

interface ClarificationOption {
  value: string;
  label: string;
  description?: string;
}
```

---

## Decision Flow

```
                    ┌─────────────────┐
                    │   Raw Input     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Agent Analyzes │
                    │  - Location?    │
                    │  - Scope?       │
                    │  - Target?      │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
     confidence >= 0.7              confidence < 0.7
              │                             │
              ▼                             ▼
    ┌─────────────────┐          ┌─────────────────┐
    │ Generate Output │          │ Return Questions│
    │ (current flow)  │          │ + Best Guesses  │
    └─────────────────┘          └────────┬────────┘
                                          │
                                 ┌────────▼────────┐
                                 │  User Answers   │
                                 │  (UI: 1 screen) │
                                 └────────┬────────┘
                                          │
                                 ┌────────▼────────┐
                                 │ Agent Generates │
                                 │ With Context    │
                                 └─────────────────┘
```

---

## Prompt Engineering

Add to `subject-line.ts` prompt:

```
## Clarification Protocol

Before generating, assess your confidence in three dimensions:

1. **Location Confidence** (0-1)
   - 1.0: Explicit location named ("SF's 28-day policy")
   - 0.8: Implicit from context ("the mayor should...")
   - 0.5: Ambiguous ("housing crisis" - could be anywhere)
   - 0.0: No location signal at all

2. **Scope Confidence** (0-1)
   - 1.0: Clear scope ("Congress must act")
   - 0.7: Likely scope ("my landlord" → probably local)
   - 0.5: Could go either way ("rent control" → local or state?)

3. **Target Type Confidence** (0-1)
   - 1.0: Explicit target ("Amazon workers")
   - 0.7: Implied target ("fix the roads" → government)
   - 0.5: Multiple valid targets ("tuition" → university or legislature?)

**Decision Rule:**
- If ALL dimensions >= 0.7: Generate immediately
- If ANY dimension < 0.7 AND would change decision-makers: Request clarification
- Maximum 2 clarification questions

**When requesting clarification:**
- Always include your best guess as the pre-selected option
- Only ask questions where the answer would materially change the output
- Frame questions to feel helpful, not interrogating
```

---

## UI Component Design

### ClarificationPanel.svelte

```svelte
<script lang="ts">
  import LocationAutocomplete from '../template-browser/LocationAutocomplete.svelte';

  interface Props {
    questions: ClarificationQuestion[];
    inferredContext: InferredContext;
    onSubmit: (answers: Record<string, string>) => void;
    onSkip: () => void; // "Just generate with your best guess"
  }
</script>

<div class="clarification-panel">
  <header>
    <h3>Quick question to get this right</h3>
    <p class="text-sm text-slate-600">
      This helps us find the right people to target
    </p>
  </header>

  {#each questions as question}
    {#if question.type === 'location_picker'}
      <LocationAutocomplete
        preselected={question.preselected}
        on:select={(e) => answers[question.id] = e.detail}
      />
    {:else if question.type === 'chips'}
      <ChipSelector
        options={question.options}
        preselected={question.preselected}
        on:change={(e) => answers[question.id] = e.detail}
      />
    {:else if question.type === 'single_choice'}
      <RadioGroup
        options={question.options}
        preselected={question.preselected}
        on:change={(e) => answers[question.id] = e.detail}
      />
    {/if}
  {/each}

  <footer>
    <button on:click={onSkip} class="text-slate-500">
      Skip — use your best guess
    </button>
    <button on:click={() => onSubmit(answers)} class="primary">
      Continue →
    </button>
  </footer>
</div>
```

**Key UX Decisions:**
1. Pre-select agent's best guess (user just confirms or changes)
2. "Skip" option respects user agency (they know their issue better)
3. Single screen, no pagination
4. Under 5 seconds to answer if pre-selections are correct

---

## Global Scalability

### Jurisdiction Resolver Interface

```typescript
// src/lib/core/jurisdiction/resolver.ts

interface IJurisdictionResolver {
  country_code: string;

  // Search locations within this country
  searchLocations(query: string, scope: 'country' | 'region' | 'city'): Promise<LocationResult[]>;

  // Get jurisdiction levels for this country
  getJurisdictionLevels(): JurisdictionLevel[];

  // Resolve location to representative offices
  resolveOffices(location: ResolvedLocation): Promise<Office[]>;

  // Get delivery capabilities
  getDeliveryCapabilities(): DeliveryCapability;
}

// US Implementation (already exists, refactor)
class USJurisdictionResolver implements IJurisdictionResolver {
  country_code = 'US';

  getJurisdictionLevels() {
    return [
      { id: 'federal', name: 'Federal', searchable: false },
      { id: 'state', name: 'State', searchable: true },
      { id: 'county', name: 'County', searchable: true },
      { id: 'city', name: 'City', searchable: true },
      { id: 'district', name: 'Congressional District', searchable: true }
    ];
  }

  async searchLocations(query, scope) {
    // Uses Census Bureau + Nominatim (existing)
  }

  async resolveOffices(location) {
    // Uses Congress.gov API (existing)
  }
}

// UK Implementation (future)
class UKJurisdictionResolver implements IJurisdictionResolver {
  country_code = 'GB';

  getJurisdictionLevels() {
    return [
      { id: 'national', name: 'Parliament', searchable: false },
      { id: 'constituency', name: 'Constituency', searchable: true },
      { id: 'council', name: 'Local Council', searchable: true }
    ];
  }

  // Would integrate with UK Parliament API
}

// Generic fallback
class GenericJurisdictionResolver implements IJurisdictionResolver {
  getJurisdictionLevels() {
    return [
      { id: 'country', name: 'Country', searchable: true },
      { id: 'region', name: 'Region/State', searchable: true },
      { id: 'city', name: 'City', searchable: true }
    ];
  }

  // Uses Nominatim only, no office resolution
}
```

### Country Detection Strategy

```typescript
function detectCountry(input: string, userLocation?: InferredLocation): string {
  // 1. Explicit country in input ("UK housing crisis")
  const explicitCountry = extractCountryFromText(input);
  if (explicitCountry) return explicitCountry;

  // 2. Country-specific terms ("Congress" → US, "Parliament" → UK/etc)
  const impliedCountry = inferCountryFromTerms(input);
  if (impliedCountry) return impliedCountry;

  // 3. User's location (if available)
  if (userLocation?.country_code) return userLocation.country_code;

  // 4. Default to US (current user base)
  return 'US';
}
```

---

## Implementation Phases

### Phase 1: Agent Schema Extension (1-2 days)
- Add `needs_clarification`, `clarification_questions`, `inferred_context` to schema
- Update prompt with clarification protocol
- Agent can now return questions instead of generating

### Phase 2: UI Component (2-3 days)
- Create `ClarificationPanel.svelte`
- Integrate with `UnifiedObjectiveEntry.svelte`
- Wire up location picker with existing `LocationAutocomplete`

### Phase 3: Conversation Loop (1-2 days)
- API endpoint handles clarification → answer → regenerate flow
- Track conversation state (interactionId already exists)

### Phase 4: Global Abstraction (3-5 days)
- Extract `IJurisdictionResolver` interface
- Refactor US-specific code into `USJurisdictionResolver`
- Create `GenericJurisdictionResolver` for non-US countries

### Phase 5: Testing & Refinement (2-3 days)
- Test with ambiguous inputs
- Tune confidence thresholds
- A/B test clarification vs. no-clarification flows

---

## Metrics to Track

1. **Clarification Rate**: % of inputs that trigger questions
   - Target: 10-20% (too high = too aggressive, too low = not helping)

2. **Skip Rate**: % of users who skip clarification
   - Target: <30% (high skip = questions aren't useful)

3. **Downstream Accuracy**: % of decision-makers that users accept without edits
   - Compare clarified vs. non-clarified flows

4. **Time to Complete**: Seconds from raw input to subject line acceptance
   - Clarification should add <10s on average

---

## Examples

### Example 1: Clear Input (No Clarification)
**Input:** "SF's 28-day housing policy makes it impossible to help homeless people get permanent housing"

**Agent Analysis:**
- Location: San Francisco, CA (confidence: 0.95)
- Scope: Local (confidence: 0.9)
- Target: Government (confidence: 0.85)

**Result:** Generate immediately, no questions.

### Example 2: Ambiguous Location (Ask)
**Input:** "rent is out of control and landlords are getting away with murder"

**Agent Analysis:**
- Location: None detected (confidence: 0.0)
- Scope: Could be local or state (confidence: 0.4)
- Target: Government or landlord associations (confidence: 0.6)

**Clarification:**
```json
{
  "needs_clarification": true,
  "clarification_questions": [
    {
      "id": "location",
      "question": "Where is this happening?",
      "type": "location_picker",
      "preselected": null,
      "required": true
    },
    {
      "id": "target_type",
      "question": "Who should address this?",
      "type": "single_choice",
      "options": [
        {"value": "government", "label": "Government (rent control, tenant protections)"},
        {"value": "corporate", "label": "Landlord/Property company directly"}
      ],
      "preselected": "government"
    }
  ],
  "inferred_context": {
    "detected_location": null,
    "detected_scope": null,
    "detected_target_type": "government",
    "confidence": 0.33
  }
}
```

### Example 3: Ambiguous Scope (Ask)
**Input:** "tuition hikes are destroying students"

**Agent Analysis:**
- Location: None (confidence: 0.0)
- Scope: Could be specific university or national policy (confidence: 0.3)
- Target: Could be university admin or Congress (confidence: 0.4)

**Clarification:**
```json
{
  "needs_clarification": true,
  "clarification_questions": [
    {
      "id": "scope",
      "question": "Is this about...",
      "type": "chips",
      "options": [
        {"value": "institution", "label": "A specific university"},
        {"value": "state", "label": "State university system"},
        {"value": "national", "label": "National student debt policy"}
      ],
      "preselected": "national"
    }
  ]
}
```

---

## Sources

- [Agentic AI Design Patterns](https://research.aimultiple.com/agentic-ai-design-patterns/) - Human-in-the-loop pattern
- [ICLR 2025 Paper on Clarifying Questions](https://proceedings.iclr.cc/paper_files/paper/2025/file/97e2df4bb8b2f1913657344a693166a2-Paper-Conference.pdf) - Double-turn training
- [Zendesk AI Best Practices](https://support.zendesk.com/hc/en-us/articles/9424547622298-Best-practices-for-creating-and-using-generative-procedures-for-AI-agents-with-agentic-AI) - When to ask clarifying questions
