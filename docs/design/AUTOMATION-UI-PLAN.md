# Automation Workflow Builder UI — Design Plan

**Status**: Plan
**Date**: 2026-03-17
**Scope**: Redesign the workflow builder from the current minimal form into a visual, verification-first workflow builder

---

## 1. Current State

Routes already exist at `/org/[slug]/workflows/` with three pages:
- **List** (`+page.svelte`) — uses `WorkflowCard` component, links to detail/new
- **New** (`new/+page.svelte`) — basic form: name, trigger dropdown, flat step list with type-specific fields
- **Detail** (`[id]/+page.svelte`) — read-only view with `ExecutionTable` component, enable/disable/delete actions

Existing components in `src/lib/components/automation/`:
- `WorkflowCard.svelte` — list card with trigger label, step count, execution count
- `ExecutionTable.svelte` — tabular execution log with status badges

Backend is complete:
- 6 trigger types: `supporter_created`, `campaign_action`, `event_rsvp`, `event_checkin`, `donation_completed`, `tag_added`
- 5 step types: `send_email`, `add_tag`, `remove_tag`, `delay`, `condition`
- Executor with delay-pause/resume, condition branching via `thenStepIndex`/`elseStepIndex`
- API endpoints: `POST/GET /api/org/[slug]/workflows`, `PATCH/DELETE /api/org/[slug]/workflows/[id]`

### Problems with Current Builder

1. **Condition branching is raw numeric input** — user types step index numbers for then/else, no visual feedback
2. **Condition field is a free-text input** — should be a dropdown matching the three supported fields: `engagementTier`, `verified`, `hasTag`
3. **Condition operators don't match backend** — UI offers `equals/not_equals/gt/lt/contains` but backend only supports `eq/gte/lte/exists`
4. **Email step uses plain textarea** — no preview, no variable interpolation hints
5. **No visual flow** — steps render as a flat numbered list with no connectors showing execution order
6. **Delay step stores `duration`/`unit` but backend expects `delayMinutes`** — conversion needed on save
7. **No sidebar nav link** — workflows not in the org layout nav (only accessible by URL)
8. **Tag selector for trigger/steps falls back to raw ID input** — when tags are loaded, use chip selector consistent with SegmentBuilder pattern
9. **Campaign selector for `campaign_action` trigger is raw ID input** — should be a dropdown from org campaigns

---

## 2. Route Structure

No route changes needed. Keep existing structure:

| Route | Purpose |
|---|---|
| `/org/[slug]/workflows` | List all workflows with status, trigger, step count, execution count |
| `/org/[slug]/workflows/new` | Visual workflow builder (create) |
| `/org/[slug]/workflows/[id]` | Detail view with read-only flow visualization + execution history |

**Additional change**: Add "Workflows" to the sidebar nav in `+layout.svelte` (gated on `FEATURES.AUTOMATION`).

---

## 3. Component Architecture

### 3.1 New Components (in `src/lib/components/automation/`)

#### `WorkflowBuilder.svelte`
Top-level builder component. Manages the full workflow state and orchestrates sub-components.

```
Props:
  orgSlug: string
  tags: Array<{ id: string; name: string }>
  campaigns: Array<{ id: string; title: string }>
  initialWorkflow?: { name, description, trigger, steps }  // for edit mode

State:
  name: string
  description: string
  trigger: WorkflowTrigger
  steps: BuilderStep[]              // internal representation with UI-friendly fields
  saving: boolean
  errorMsg: string

Events:
  onSave(workflow) -> void
```

Renders: metadata section -> `TriggerSelector` -> `StepChain` -> save/cancel buttons

#### `TriggerSelector.svelte`
Dropdown for trigger type with contextual sub-fields.

```
Props:
  trigger: WorkflowTrigger (bindable)
  tags: Array<{ id: string; name: string }>
  campaigns: Array<{ id: string; title: string }>
```

Renders trigger type as a styled card with icon. When `tag_added` is selected, shows tag chip selector (reuse pattern from SegmentBuilder). When `campaign_action`, shows campaign dropdown.

#### `StepChain.svelte`
Vertical chain of step cards connected by flow lines.

```
Props:
  steps: BuilderStep[] (bindable)
  tags: Array<{ id: string; name: string }>

Methods exposed via bind:this:
  addStep(type?: StepType)
```

Renders each step as a `StepCard` with vertical connector lines between them. Handles drag-to-reorder (optional, can defer) and add/remove.

#### `StepCard.svelte`
Individual step editor. Type selector + type-specific form fields.

```
Props:
  step: BuilderStep (bindable)
  index: number
  totalSteps: number
  tags: Array<{ id: string; name: string }>
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
```

Renders differently per step type:
- **send_email**: Subject input + body textarea with variable hint bar (`{{name}}`, `{{email}}`)
- **add_tag / remove_tag**: Tag chip selector (reuse SegmentBuilder tag pattern)
- **delay**: Number input + unit dropdown (minutes/hours/days), auto-converts to `delayMinutes` on save
- **condition**: Field dropdown + operator dropdown + value input + inline then/else step selectors

#### `ConditionBranch.svelte`
Handles the visual rendering of condition branching within the step chain.

```
Props:
  step: ConditionBuilderStep
  stepCount: number
  onUpdate: (field, operator, value, thenIdx, elseIdx) => void
```

### 3.2 Existing Components to Modify

- `WorkflowCard.svelte` — no changes needed
- `ExecutionTable.svelte` — no changes needed
- `+layout.svelte` — add "Workflows" nav item (gated on `FEATURES.AUTOMATION`)

### 3.3 Component Tree

```
/org/[slug]/workflows/new/+page.svelte
  └─ WorkflowBuilder
       ├─ Metadata (name + description inputs)
       ├─ TriggerSelector
       │    ├─ Trigger type dropdown
       │    └─ Tag chips / Campaign dropdown (conditional)
       └─ StepChain
            ├─ StepCard (send_email)
            │    └─ Subject + Body + Variable hints
            ├─ ── connector line ──
            ├─ StepCard (delay)
            │    └─ Duration + Unit
            ├─ ── connector line ──
            ├─ StepCard (condition)
            │    └─ ConditionBranch
            │         ├─ Field dropdown (engagementTier | verified | hasTag)
            │         ├─ Operator dropdown (eq | gte | lte | exists)
            │         ├─ Value input
            │         ├─ "If true → Step X" dropdown
            │         └─ "If false → Step Y" dropdown
            ├─ ── connector line ──
            ├─ StepCard (add_tag)
            │    └─ Tag chip selector
            └─ [+ Add Step] button (dashed border)
```

---

## 4. Visual Design

### 4.1 Step Chain Layout: Linear with Indented Branches

Use a **vertical linear layout** (not a tree/graph canvas). Each step is a card connected by a thin vertical line. This matches the sequential execution model in the backend.

```
┌─────────────────────────────────┐
│ ⚡ Trigger: New Supporter       │
└─────────────┬───────────────────┘
              │
┌─────────────▼───────────────────┐
│ 1  ✉ Send Email                 │
│    Subject: Welcome to [org]    │
│    Body: [textarea]             │
└─────────────┬───────────────────┘
              │
┌─────────────▼───────────────────┐
│ 2  ⏱ Wait                       │
│    [1] [hours ▾]                │
└─────────────┬───────────────────┘
              │
┌─────────────▼───────────────────┐
│ 3  ❓ Condition                  │
│    [verified ▾] [eq ▾] [true]   │
│    ┌─────────┐  ┌─────────┐    │
│    │ ✓ → #4  │  │ ✗ → #5  │    │
│    └─────────┘  └─────────┘    │
└─────────────┬───────────────────┘
              │
┌─────────────▼───────────────────┐
│ 4  🏷 Add Tag                   │
│    [Welcome ✕] [Verified ✕]     │
└─────────────┬───────────────────┘
              │
     ╌╌╌╌╌╌╌ + Add Step ╌╌╌╌╌╌╌
```

### 4.2 Condition Branching — Inline Pill Selectors

Condition steps do NOT render as a tree. Instead, they show two inline pill selectors:
- **If true** → dropdown of step numbers (with step type preview label)
- **If false** → dropdown of step numbers (with step type preview label)

This maps directly to the backend's `thenStepIndex`/`elseStepIndex` model. A full tree/canvas renderer would require a fundamentally different execution model.

The dropdown options render as: `"Step 4: Add Tag"`, `"Step 5: Send Email"`, `"End (complete)"` for jumping past the last step.

Color coding:
- **If true** pill: `bg-emerald-500/10 border-emerald-500/20 text-emerald-400`
- **If false** pill: `bg-amber-500/10 border-amber-500/20 text-amber-400`

### 4.3 Step Type Visual Indicators

Each step card has a left-border accent color and icon:

| Step Type | Icon | Left Border | Card Description |
|---|---|---|---|
| `send_email` | ✉ envelope | `border-l-blue-500` | Subject line + body textarea |
| `add_tag` | 🏷 tag+ | `border-l-emerald-500` | Tag chip selector |
| `remove_tag` | 🏷 tag- | `border-l-red-500` | Tag chip selector |
| `delay` | ⏱ clock | `border-l-amber-500` | Number + unit (minutes/hours/days) |
| `condition` | ❓ branch | `border-l-purple-500` | Field + operator + value + then/else selectors |

Icons will be SVG, not emoji — the above are placeholders for this document.

### 4.4 Design Tokens (Matching Existing Patterns)

- Card background: `bg-surface-base` (step cards), `bg-surface-raised` (page)
- Card border: `border-surface-border-strong/50` (matches existing step cards)
- Connector line: `border-surface-border` (2px, vertical)
- Input styling: `border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary`
- Labels: `text-text-tertiary text-sm font-medium`
- Add step button: dashed border pattern from SegmentBuilder (`border-dashed border-surface-border`)

### 4.5 Trigger Card

Rendered above the step chain as a distinct "start" node:
- Background: `bg-teal-500/5 border-teal-500/20`
- Shows trigger type with icon, plus any scoped fields (tag name, campaign title)
- Not removable (every workflow requires a trigger)

---

## 5. Data Flow

### 5.1 Internal Builder State

The builder uses a `BuilderStep` type that is friendlier than the backend types:

```typescript
type BuilderStep =
  | { type: 'send_email'; subject: string; body: string }
  | { type: 'add_tag' | 'remove_tag'; tagId: string }
  | { type: 'delay'; duration: number; unit: 'minutes' | 'hours' | 'days' }
  | { type: 'condition'; field: 'engagementTier' | 'verified' | 'hasTag';
      operator: 'eq' | 'gte' | 'lte' | 'exists';
      value: string | number | boolean;
      thenStep: number; elseStep: number };
```

### 5.2 Save Transform (BuilderStep[] -> WorkflowStep[])

On save, a `transformSteps()` function converts to the backend format:
- `delay`: `duration * multiplier(unit)` -> `delayMinutes`
- `condition`: `thenStep`/`elseStep` -> `thenStepIndex`/`elseStepIndex`, field/operator validated against backend set
- `send_email`: `subject` -> `emailSubject`, `body` -> `emailBody`

### 5.3 Load Transform (WorkflowStep[] -> BuilderStep[])

For edit mode (future), reverse the transform. `delayMinutes` -> best-fit unit (days if divisible by 1440, hours if by 60, else minutes).

---

## 6. What Can Be Reused

| Component/Pattern | From | Use In |
|---|---|---|
| Tag chip selector (multi-select) | `SegmentBuilder.svelte` L431-456 | Tag steps, tag trigger scoping |
| Campaign dropdown | `SegmentBuilder.svelte` L534-548 | Campaign trigger scoping |
| Input/select styling | All existing workflow pages | All form fields |
| Dashed add-button pattern | `SegmentBuilder.svelte` L570-579 | "Add Step" button |
| Error alert pattern | Existing `new/+page.svelte` L142-144 | Validation errors |
| Status badge pills | `WorkflowCard.svelte`, `ExecutionTable.svelte` | Condition then/else pills |
| Card border-radius + spacing | Existing step cards in `new/+page.svelte` | All step cards |
| `WorkflowCard.svelte` | Direct reuse, no changes | List page |
| `ExecutionTable.svelte` | Direct reuse, no changes | Detail page |
| TRIGGER_LABELS / STEP_LABELS maps | Duplicated in 3 files currently | Extract to shared constants file |

### Shared Constants Extraction

Create `src/lib/components/automation/constants.ts`:
```typescript
export const TRIGGER_LABELS: Record<string, string> = { ... };
export const STEP_LABELS: Record<string, string> = { ... };
export const CONDITION_FIELDS = [
  { value: 'engagementTier', label: 'Engagement Tier' },
  { value: 'verified', label: 'Verified' },
  { value: 'hasTag', label: 'Has Tag' }
] as const;
export const CONDITION_OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'gte', label: 'at least' },
  { value: 'lte', label: 'at most' },
  { value: 'exists', label: 'exists' }
] as const;
```

This eliminates the TRIGGER_LABELS duplication across `WorkflowCard`, `new/+page`, and `[id]/+page`.

---

## 7. Implementation Estimate

| File | Action | Est. LoC |
|---|---|---|
| `src/lib/components/automation/constants.ts` | New — shared labels/options | ~40 |
| `src/lib/components/automation/WorkflowBuilder.svelte` | New — orchestrator | ~120 |
| `src/lib/components/automation/TriggerSelector.svelte` | New — trigger card | ~80 |
| `src/lib/components/automation/StepChain.svelte` | New — step list + connectors + add | ~90 |
| `src/lib/components/automation/StepCard.svelte` | New — per-step editor | ~180 |
| `src/lib/components/automation/ConditionBranch.svelte` | New — condition fields + then/else | ~100 |
| `src/routes/org/[slug]/workflows/new/+page.svelte` | Rewrite — use WorkflowBuilder | ~40 (down from ~125) |
| `src/routes/org/[slug]/workflows/new/+page.server.ts` | Modify — also load campaigns | ~5 delta |
| `src/routes/org/[slug]/workflows/[id]/+page.svelte` | Modify — use shared constants, add flow visualization | ~30 delta |
| `src/routes/org/[slug]/+layout.svelte` | Modify — add Workflows nav item | ~10 delta |
| **Total new/changed** | | **~695 LoC** |

### Dependencies

- **No new npm packages required.** All rendering is vanilla Svelte + Tailwind.
- Drag-to-reorder is deferred (use Up/Down buttons initially, same as current). If added later, use a lightweight Svelte action — no library needed for simple list reorder.

---

## 8. Implementation Order

1. **Extract shared constants** (`constants.ts`) — eliminates duplication, needed by all new components
2. **TriggerSelector** — standalone, can be tested independently
3. **StepCard** — the most complex individual component (5 step type variants)
4. **ConditionBranch** — renders inside StepCard for condition type
5. **StepChain** — composes StepCards with connectors
6. **WorkflowBuilder** — orchestrates everything
7. **Wire into `new/+page.svelte`** — replace existing inline builder
8. **Add nav item** in layout
9. **Update detail page** to use shared constants

---

## 9. Test Plan

### 9.1 Unit Tests

| Test File | What to Test |
|-----------|-------------|
| `tests/unit/automation/workflow-builder.test.ts` | `transformSteps()`: delay unit conversion, condition field validation, email subject/body mapping |
| `tests/unit/automation/workflow-builder.test.ts` | `reverseTransformSteps()`: delayMinutes → best-fit unit, stepIndex → readable labels |
| `tests/unit/automation/trigger-selector.test.ts` | Trigger type dropdown renders all 6 types; tag trigger shows tag selector; campaign trigger shows campaign dropdown |
| `tests/unit/automation/step-card.test.ts` | Each step type renders correct fields; condition step shows field/operator/value with correct backend-aligned options |

### 9.2 Integration Tests

| Test | What to Verify |
|------|---------------|
| Create workflow end-to-end | Fill builder → save → verify API receives correctly transformed steps |
| Condition branching | Set then/else step indices → verify thenStepIndex/elseStepIndex in saved data |
| Delay conversion | Enter "2 hours" → verify API receives delayMinutes: 120 |
| Validation | Submit empty steps → verify 400 with error message |

### 9.3 Existing Test Coverage

The 4 existing test files (`workflow-crud.test.ts`, `workflow-engine.test.ts`, etc.) cover backend CRUD and execution. The new tests cover the **builder transform layer** — the gap between UI-friendly types and backend types.

---

## 10. Accessibility

### 10.1 Keyboard Navigation

- **Step chain**: Tab navigates between step cards; Enter opens/focuses the step editor
- **Step reorder**: Up/Down buttons are focusable and announce new position via `aria-live`
- **Add step**: Focusable dashed button at chain bottom; new step receives focus after insertion
- **Condition pills**: "If true" and "If false" dropdowns are standard `<select>` elements (not custom dropdowns)

### 10.2 Screen Reader Announcements

- Step cards: `role="group"` with `aria-label="Step {n}: {type label}"`
- Trigger card: `role="group"` with `aria-label="Trigger: {type label}"`
- Connector lines: `aria-hidden="true"` (decorative)
- Reorder: `aria-live="polite"` region announces "Step moved to position {n}"
- Add step: announces "Step {n} added: {type}"

### 10.3 Color Contrast

All step type accent colors (blue, emerald, red, amber, purple) meet WCAG AA contrast ratio (4.5:1) against the `bg-surface-base` card background. The border-left accent is decorative — step type is also conveyed via icon and label text.

---

## 11. Out of Scope (Deferred)

- **Drag-to-reorder** steps — keep Up/Down buttons for now
- **Rich text email editor** — plain textarea is sufficient; rich editor is an emails feature, not automation-specific
- **Workflow duplication/templates** — list page "duplicate" action
- **Execution replay/retry** — detail page action to re-run failed executions
- **Visual tree branching** — would require canvas/SVG renderer and a different execution model; linear with inline branch selectors is sufficient
- **Workflow versioning** — editing a live workflow's steps; for now, disable before editing
