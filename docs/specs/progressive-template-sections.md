# Progressive Template Sections: Implementation Spec

> **STATUS: ASPIRATIONAL** — Design spec. Not yet implemented.

**Status:** In Progress
**Owner:** Engineering
**Last Updated:** 2025-01-12

> **Design reconciliation (2026-04-30):** This is an older aspirational spec.
> Follow `docs/design/design-system.md`, `docs/design/voice.md`, and
> `docs/specs/SPATIAL-BROWSE-SPEC.md` for current browse-surface direction.
> Person-layer language uses "templates" or location names, not "campaigns."
> Container radius normalizes to `rounded-lg` (8px), white/gradient card
> treatment must be earned, and non-core colors are local categorical signals
> only.

## Executive Summary

Replace hard toggle + clickable breadcrumb with auto-grouped template sections that unlock progressively as user provides more precise location data. Zero cognitive load, familiar pattern (Netflix/YouTube), drives location funnel completion.

## User Cognition Model

### Core Insight

Users scan **top-to-bottom**, not bottom-to-top. Local templates buried at position #47 = invisible, even if algorithmically "relevant."

### Mental Model

Users think in **geographic tiers**, not relevance scores:
1. "What's happening in my district?" (most tangible)
2. "What's happening in my city?"
3. "What's happening in my state?"
4. "What's happening nationwide?" (least tangible, highest momentum)

### Progressive Disclosure Pattern

**Sections unlock as precision increases** → Creates tangible value for each funnel step:

```
Stage 1: IP (Country + State)
├─ Statewide (12)
├─ Nationwide (50)
└─ 23 templates in your city -> Enter address

Stage 2: GPS (City)
├─ In Your City (5)          ← NEW
├─ Statewide (12)
├─ Nationwide (50)
└─ 3 templates in your district -> Verify address

Stage 3: Verified (District)
├─ In Your District (3)      ← NEW
├─ In Your City (5)
├─ Statewide (12)
└─ Nationwide (50)
```

Each funnel step = **more granular coordination unlocked** = tangible reward.

## Current Architecture

```
LocationFilter.svelte
  ↓ emits Template[] via onFilterChange()
+page.svelte
  ↓ stores in locationFilteredTemplates
  ↓ combines with channel filtering
TemplateList.svelte                   TemplatePreview.svelte
  ↓ renders flat list                   ↓ shows selected template
  ↓ [LEFT: md:col-span-1]               ↓ [RIGHT: md:col-span-2]
```

**Layout:**
- Desktop: 2-column grid (list left, preview right)
- Mobile: List view, preview opens in modal on click

**Problems:**
1. Clickable breadcrumb changes `forcedPrecision` but templates don't update
2. Toggle button (`showLocalOnly`) is implementation detail leaking into UX
3. High-momentum national templates bury low-momentum local templates
4. No visual feedback for funnel progression

## Proposed Architecture

```
LocationFilter.svelte
  ↓ emits TemplateGroup[] via onFilterChange()
  ↓ groups reflect user's current precision
+page.svelte
  ↓ stores groups, combines with channel filtering
  ↓ flattens for selection logic
TemplateList.svelte                   TemplatePreview.svelte
  ↓ renders sections with headers     ↓ shows selected template
  ↓ [LEFT: md:col-span-1]             ↓ [RIGHT: md:col-span-2]
```

**Interaction Model:**

```
┌─────────────────────┬────────────────────────────────────┐
│ In Your District    │                                    │
│ 🏛️ Contact Rep      │   [PREVIEW PANE]                   │
│ ✓ SELECTED          │                                    │
│                     │   Template: Contact Rep            │
│ In Your City        │   Message: Dear Representative...  │
│ 🏛️ SF Housing       │                                    │
│ 🏛️ BART Expansion   │   [Send Message Button]            │
│                     │                                    │
│ Nationwide          │                                    │
│ 🏛️ Medicare         │                                    │
│ 🏛️ Climate          │                                    │
└─────────────────────┴────────────────────────────────────┘
     Scan & Click              Immediate Preview
```

**User Flow:**
1. Eyes scan sections top-to-bottom (local first)
2. User clicks template in any section
3. Preview loads instantly on right (desktop) or modal (mobile)
4. Section grouping **only affects list view**, not preview

**Benefits:**
1. Zero cognitive load (no toggles, no clicks)
2. Progressive disclosure drives funnel completion
3. Local guaranteed visible (cold start solved)
4. Adaptive (sections disappear if empty)
5. **Preview works exactly as before** - no changes needed

## Data Structures

### TemplateGroup

```typescript
// src/lib/types/template.ts

export interface TemplateGroup {
  /** Section title (e.g., "In Your District", "Nationwide") */
  title: string;

  /** Templates in this tier */
  templates: Template[];

  /** Minimum relevance score for this tier (for internal sorting) */
  minScore: number;

  /** Precision level this group represents */
  level: 'district' | 'city' | 'county' | 'state' | 'nationwide';

  /** Number of people coordinating in this tier (for display) */
  coordinationCount: number;
}
```

### NextTierPreview

```typescript
// src/lib/types/template.ts

export interface NextTierPreview {
  /** Number of templates in next tier */
  count: number;

  /** Geographic level (e.g., "city", "district") */
  level: string;

  /** Call-to-action text */
  cta: string;

  /** Button action text */
  action: string;

  /** Callback when user clicks */
  onClick: () => void;
}
```

## Implementation Phases

### Phase 1: LocationFilter Changes

**File:** `src/lib/components/landing/template/LocationFilter.svelte`

#### 1.1 Remove Old Controls

```typescript
// DELETE these state variables:
let showLocalOnly = $state(false);
let forcedPrecision = $state<PrecisionLevel | null>(null);

// DELETE breadcrumb click handlers:
function handleBreadcrumbClick(level: PrecisionLevel) { ... }

// DELETE toggle button in template
```

#### 1.2 Make Breadcrumb Informational Only

```svelte
<!-- BEFORE: Clickable buttons -->
<button onclick={() => handleBreadcrumbClick('state')} ...>
  {breadcrumbState}
</button>

<!-- AFTER: Informational spans -->
<span class="rounded-md px-3 py-1.5 font-medium text-slate-700">
  {breadcrumbState}
</span>
```

Keep the visual breadcrumb for **context** (where you are), remove interactivity.

#### 1.3 Update Callback Interface

```typescript
// BEFORE:
interface LocationFilterProps {
  templates: Template[];
  onFilterChange: (filtered: Template[]) => void;
}

// AFTER:
interface LocationFilterProps {
  templates: Template[];
  onFilterChange: (groups: TemplateGroup[]) => void;
}
```

#### 1.4 Implement Grouping Logic

```typescript
// Replace the existing $effect() with:

$effect(() => {
  if (!inferredLocation) {
    // No location → Show only nationwide
    onFilterChange([
      {
        title: 'Nationwide',
        templates: templates.filter(t =>
          !t.applicable_countries ||
          t.applicable_countries.length === 0
        ),
        minScore: 0.3,
        level: 'nationwide',
        coordinationCount: 0 // Calculate from templates
      }
    ]);
    return;
  }

  // Country boundary enforcement (for legislative adapter separation)
  const countryFiltered = templates.filter((template) => {
    if (template.applicable_countries && template.applicable_countries.length > 0) {
      return (
        inferredLocation.country_code &&
        template.applicable_countries.includes(inferredLocation.country_code)
      );
    }
    return true; // International/no country specified
  });

  // Filter templates to only those with jurisdictions (for scoring)
  const templatesWithJurisdictions = countryFiltered.filter(
    (t): t is TemplateWithJurisdictions =>
      'jurisdictions' in t && Array.isArray(t.jurisdictions)
  );

  // Score templates by location relevance
  const scored = scoreTemplatesByRelevance(templatesWithJurisdictions, inferredLocation);

  // Apply behavioral boosting
  getTemplateViewCounts()
    .then((viewCounts) => {
      const boosted = boostByUserBehavior(scored, viewCounts);

      // Group by precision tier
      const groups = createTemplateGroups(boosted, inferredLocation);

      onFilterChange(groups);
    })
    .catch((error) => {
      console.warn('[LocationFilter] Failed to apply behavioral boosting:', error);
      // Fallback to location-only scoring
      const groups = createTemplateGroups(scored, inferredLocation);
      onFilterChange(groups);
    });
});
```

#### 1.5 Create Grouping Function

```typescript
function createTemplateGroups(
  scored: ScoredTemplate[],
  location: InferredLocation
): TemplateGroup[] {
  const groups: TemplateGroup[] = [];

  // Determine user's precision level
  const hasDistrict = !!location.congressional_district;
  const hasCity = !!location.city_name;
  const hasCounty = !!location.county_fips;
  const hasState = !!location.state_code;

  // District tier (score >= 1.0)
  if (hasDistrict) {
    const districtTemplates = scored
      .filter(s => s.score >= 1.0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.template as Template);

    if (districtTemplates.length > 0) {
      groups.push({
        title: `In Your District (${districtTemplates.length})`,
        templates: districtTemplates,
        minScore: 1.0,
        level: 'district',
        coordinationCount: districtTemplates.reduce((sum, t) => sum + (t.send_count || 0), 0)
      });
    }
  }

  // City tier (score 0.7-0.9)
  if (hasCity || hasCounty) {
    const cityTemplates = scored
      .filter(s => s.score >= 0.7 && s.score < 1.0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.template as Template);

    if (cityTemplates.length > 0) {
      const cityName = location.city_name
        ? toTitleCase(location.city_name)
        : location.county_name
          ? toTitleCase(location.county_name)
          : 'Your Area';

      groups.push({
        title: `In ${cityName} (${cityTemplates.length})`,
        templates: cityTemplates,
        minScore: 0.7,
        level: 'city',
        coordinationCount: cityTemplates.reduce((sum, t) => sum + (t.send_count || 0), 0)
      });
    }
  }

  // State tier (score 0.5-0.6)
  if (hasState) {
    const stateTemplates = scored
      .filter(s => s.score >= 0.5 && s.score < 0.7)
      .sort((a, b) => b.score - a.score)
      .map(s => s.template as Template);

    if (stateTemplates.length > 0) {
      const stateName = breadcrumbState || location.state_code;

      groups.push({
        title: `In ${stateName} (${stateTemplates.length})`,
        templates: stateTemplates,
        minScore: 0.5,
        level: 'state',
        coordinationCount: stateTemplates.reduce((sum, t) => sum + (t.send_count || 0), 0)
      });
    }
  }

  // Nationwide tier (score 0.3-0.4)
  const nationwideTemplates = scored
    .filter(s => s.score >= 0.3 && s.score < 0.5)
    .sort((a, b) => b.score - a.score)
    .map(s => s.template as Template);

  if (nationwideTemplates.length > 0) {
    groups.push({
      title: `Nationwide (${nationwideTemplates.length})`,
      templates: nationwideTemplates,
      minScore: 0.3,
      level: 'nationwide',
      coordinationCount: nationwideTemplates.reduce((sum, t) => sum + (t.send_count || 0), 0)
    });
  }

  return groups;
}
```

### Phase 2: TemplateList Changes

**File:** `src/lib/components/landing/template/TemplateList.svelte`

#### 2.1 Update Props Interface

```typescript
// BEFORE:
interface Props {
  templates: Template[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
}

// AFTER:
interface Props {
  groups: TemplateGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
}

const { groups, selectedId, onSelect, loading = false }: Props = $props();
```

#### 2.2 Update Rendering Logic

```svelte
<div class="space-y-6 md:space-y-8" data-testid="template-list">
  {#if loading}
    <!-- Loading State using SkeletonTemplate -->
    {#each Array(3) as _, index}
      <SkeletonTemplate variant="list" animate={true} classNames="template-loading-{index}" />
    {/each}
  {:else if groups.length === 0}
    <!-- Empty state -->
    <div class="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center">
      <div class="mb-3 text-slate-400">
        <svg class="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <h3 class="mb-1 text-sm font-medium text-slate-900">No templates here yet</h3>
      <p class="text-xs text-slate-600">Someone has to move first. Start one.</p>
    </div>
  {:else}
    {#each groups as group (group.title)}
      <!-- Section Header -->
      <div class="space-y-3 md:space-y-4">
        <h3 class="text-sm font-semibold text-slate-700 uppercase tracking-wide">
          {group.title}
        </h3>

        <!-- Templates in this section -->
        <div class="space-y-3 md:space-y-4">
          {#each group.templates as template, index (template.id)}
            {@const isCongressional = template.deliveryMethod === 'cwc'}
            {@const isHovered = hoveredTemplate === template.id}

            <button
              type="button"
              data-template-button
              data-template-id={template.id}
              data-testid="template-button-{template.id}"
              class="relative flex w-full items-start justify-between gap-3 rounded-md border-2 border-l-4 p-3 text-left transition-all duration-200 hover:scale-[1.02] hover:shadow-lg md:p-4"
              style="will-change: transform; backface-visibility: hidden;"
              class:cursor-pointer={selectedId !== template.id}
              class:cursor-default={selectedId === template.id}
              class:border-direct-400={selectedId === template.id && !isCongressional}
              class:border-congressional-400={selectedId === template.id && isCongressional}
              class:bg-direct-50={selectedId === template.id && !isCongressional}
              class:bg-congressional-50={selectedId === template.id && isCongressional}
              class:border-slate-200={selectedId !== template.id && !isHovered}
              class:border-slate-300={selectedId !== template.id && isHovered}
              class:border-l-congressional-500={isCongressional}
              class:border-l-direct-500={!isCongressional}
              onmouseenter={() => handleTemplateHover(template.id, true)}
              onmouseleave={() => handleTemplateHover(template.id, false)}
              onclick={() => onSelect(template.id)}
              onkeydown={(e) => handleKeydown(e, template.id, index)}
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge variant={isCongressional ? 'congressional' : 'direct'} size="sm">
                    {isCongressional ? 'US Congress' : 'Email'}
                  </Badge>
                  <span class="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 md:text-sm">
                    {template.category}
                  </span>
                </div>

                <h3 class="mt-2 truncate font-medium text-gray-900 md:mt-3">
                  {template.title}
                </h3>

                <p class="mb-2 line-clamp-2 text-xs text-gray-600 md:mb-3 md:text-sm">
                  {template.description}
                </p>

                <MessageMetrics {template} />
              </div>

              <!-- Mobile indicator -->
              <div class="shrink-0 text-slate-400 md:hidden">
                <ChevronRight class="h-5 w-5" />
              </div>
            </button>
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</div>
```

#### 2.3 Update Keyboard Navigation

```typescript
function handleKeydown(event: KeyboardEvent, templateId: string, index: number) {
  // Flatten all templates across groups for navigation
  const allTemplates = groups.flatMap(g => g.templates);
  const flatIndex = allTemplates.findIndex(t => t.id === templateId);

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onSelect(templateId);
    const customEvent = new CustomEvent('movePreviewFocus');
    window.dispatchEvent(customEvent);
  } else if (event.key === 'Tab' && event.shiftKey) {
    if (flatIndex === 0) return;
    event.preventDefault();
    const buttons = document.querySelectorAll('[data-template-button]');
    const prevButton = buttons[flatIndex - 1] as HTMLElement;
    prevButton?.focus();
  } else if (event.key === 'Tab' && !event.shiftKey) {
    if (flatIndex === allTemplates.length - 1) {
      if (templateId === selectedId) return;
      event.preventDefault();
      const customEvent = new CustomEvent('movePreviewFocus');
      window.dispatchEvent(customEvent);
      return;
    }
    event.preventDefault();
    const buttons = document.querySelectorAll('[data-template-button]');
    const nextButton = buttons[flatIndex + 1] as HTMLElement;
    nextButton?.focus();
  }
}
```

### Phase 3: Parent Component Changes

**File:** `src/routes/+page.svelte`

#### 3.1 Update State

```typescript
// BEFORE:
let locationFilteredTemplates = $state<Template[]>([]);

// AFTER:
let locationFilteredGroups = $state<TemplateGroup[]>([]);
```

#### 3.2 Update Callback

```typescript
// BEFORE:
function handleLocationFilterChange(filtered: Template[]) {
  locationFilteredTemplates = filtered;
}

// AFTER:
function handleLocationFilterChange(groups: TemplateGroup[]) {
  locationFilteredGroups = groups;
}
```

#### 3.3 Flatten Groups for Selection Logic

```typescript
// Flatten groups to template array for selection/filtering
const locationFilteredTemplates = $derived(
  locationFilteredGroups.flatMap(g => g.templates)
);

// Keep existing channel filtering logic:
const filteredTemplates = $derived(
  locationFilteredTemplates.length > 0
    ? channelFilteredTemplates.filter((t) =>
        locationFilteredTemplates.some((filtered) => filtered.id === t.id)
      )
    : channelFilteredTemplates
);
```

#### 3.4 Create Filtered Groups for Display

```typescript
// Regroup after channel filtering
const filteredGroups = $derived(
  locationFilteredGroups
    .map(group => ({
      ...group,
      templates: group.templates.filter(t =>
        filteredTemplates.some(ft => ft.id === t.id)
      )
    }))
    .filter(group => group.templates.length > 0)
);
```

#### 3.5 Pass Groups to TemplateList

```svelte
<TemplateList
  groups={filteredGroups}
  selectedId={templateStore.selectedId}
  onSelect={handleTemplateSelect}
  loading={isLoading}
/>
```

### Phase 4: Preview Card (Next Tier Teaser)

**File:** `src/lib/components/landing/template/LocationFilter.svelte`

Add AFTER template browser, BEFORE end of file:

```svelte
<!-- Next Tier Preview Card -->
{#if nextTierPreview}
  <div class="mt-8 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-6">
    <div class="flex items-start gap-4">
      <!-- Icon -->
      <div class="flex-shrink-0">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
          <svg class="h-6 w-6 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 min-w-0">
        <p class="text-lg font-bold text-slate-900">
          {nextTierPreview.count} {nextTierPreview.count === 1 ? 'template' : 'templates'} in your {nextTierPreview.level}
        </p>
        <p class="mt-1 text-sm text-slate-700">
          {nextTierPreview.cta}
        </p>
      </div>

      <!-- Action Button -->
      <button
        onclick={nextTierPreview.onClick}
        class="flex-shrink-0 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-teal-700 active:scale-95"
      >
        {nextTierPreview.action} →
      </button>
    </div>
  </div>
{/if}
```

Calculate `nextTierPreview`:

```typescript
const nextTierPreview = $derived.by((): NextTierPreview | null => {
  if (!inferredLocation) return null;

  const hasDistrict = !!inferredLocation.congressional_district;
  const hasCity = !!inferredLocation.city_name || !!inferredLocation.county_fips;
  const hasState = !!inferredLocation.state_code;

  // If user has state but no city → Preview city tier
  if (hasState && !hasCity && !hasDistrict) {
    const cityTemplateCount = templates.filter(t => {
      // Templates with city/county jurisdictions
      if (!('jurisdictions' in t)) return false;
      return (t.jurisdictions as TemplateJurisdiction[]).some(j =>
        j.jurisdiction_type === 'city' || j.jurisdiction_type === 'county'
      );
    }).length;

    if (cityTemplateCount > 0) {
      return {
        count: cityTemplateCount,
        level: 'city',
        cta: 'Share your location to see templates in your community',
        action: 'Enable GPS',
        onClick: handleUpdateLocation
      };
    }
  }

  // If user has city but no district → Preview district tier
  if (hasCity && !hasDistrict) {
    const districtTemplateCount = templates.filter(t => {
      if (!('jurisdictions' in t)) return false;
      return (t.jurisdictions as TemplateJurisdiction[]).some(j =>
        !!j.congressional_district
      );
    }).length;

    if (districtTemplateCount > 0) {
      return {
        count: districtTemplateCount,
        level: 'district',
        cta: 'Verify your address to contact your US House representative',
        action: 'Verify address',
        onClick: () => (showAddressModal = true)
      };
    }
  }

  return null;
});
```

## Visual Design

### Section Headers

```
IN YOUR DISTRICT (3)
├─ Font: 12px, semibold, uppercase, tracking-wide
├─ Color: text-slate-700
└─ Spacing: 24px margin-bottom
```

### Template Cards

No changes - maintain existing design.

### Next Tier Preview Card

```
┌─────────────────────────────────────────────────────┐
│      23 templates in your city                     │
│      Share your location to see templates in your  │
│      community                            Enable GPS│
└─────────────────────────────────────────────────────┘
├─ Border: 2px dashed slate-200
├─ Background: slate-50
├─ Icon: optional, only if it clarifies precision
└─ Button: teal route/action color, rounded-lg
```

## User Testing Checkpoints

### Checkpoint 1: Scan Behavior

**Test:** Give user IP-level precision (state only).
**Expect:** Eyes land on "Statewide" section first, scan down to "Nationwide".
**Fail:** Eyes search for specific template, miss sections entirely.

### Checkpoint 2: Progressive Unlock

**Test:** User provides GPS → City section appears.
**Expect:** "Oh, there's stuff near me now!" (tangible reward).
**Fail:** User doesn't notice new section.

### Checkpoint 3: Desire Creation

**Test:** User sees preview card: "23 templates in your city".
**Expect:** User clicks "Enable GPS" to unlock.
**Fail:** User ignores preview card.

### Checkpoint 4: Empty Sections

**Test:** User in rural area with no local templates.
**Expect:** Only "Nationwide" section visible. Graceful.
**Fail:** User sees empty "In Your City (0)" section (confusing).

## Performance Considerations

### Scoring Performance

- **Current:** Score all templates once per location change
- **Impact:** O(n × m) where n = templates, m = jurisdictions per template
- **Optimization:** Memoize scored results until location changes

### Grouping Performance

- **Current:** Group scored templates by tier
- **Impact:** O(n) single pass through scored array
- **Optimization:** None needed - fast enough

### Re-render Performance

- **Current:** Svelte re-renders entire TemplateList on group change
- **Impact:** Each template card re-renders
- **Optimization:** Svelte's keyed {#each} prevents full DOM replacement

## Rollout Plan

1. **Alpha (internal):** Test with SF Bay Area templates
2. **Beta (10 users):** Test progressive unlock with real addresses
3. **Launch (all users):** Deploy to production

## Success Metrics

- **Funnel completion:** % users who verify address (target: +15%)
- **Template engagement:** % users who click templates (target: +10%)
- **Time to first click:** Seconds from page load to template click (target: -30%)
- **Scan depth:** % users who scroll past first section (target: 80%+)

## Edge Cases

### Edge Case 1: No Templates in Any Tier

**Scenario:** New geographic region, zero templates.
**Solution:** Show empty state: "No templates here yet. Start one."

### Edge Case 2: Only Nationwide Templates

**Scenario:** User has verified district, but only national templates exist.
**Solution:** Show single "Nationwide" section. No local sections.

### Edge Case 3: VPN Changes Location Mid-Session

**Scenario:** User's IP changes from CA → NY.
**Solution:** Location re-infers, sections update automatically.

### Edge Case 4: User Denies GPS Permission

**Scenario:** User clicks "Enable GPS" but denies browser permission.
**Solution:** Show error: "GPS permission denied. Try entering address instead."

## Future Enhancements

### Phase 2: Momentum Indicators

Add momentum badges to section headers:

```
IN YOUR CITY (5) 🔥 Trending
```

### Phase 3: Personalization

Add "For You" section based on behavioral signals:

```
For You (3)
├─ Templates you've viewed
├─ Templates similar to your interests
└─ Templates your connections shared
```

### Phase 4: Social Proof

Add faces to section headers:

```
IN YOUR DISTRICT (3)
👤👤👤 Sarah, John, and 1,234 others
```

## Appendix: Code Diffs

### A1: LocationFilter.svelte (Before/After)

**BEFORE (lines 398-476):**
```svelte
<!-- Progressive affordance buttons (3-step funnel) -->
<div class="mt-3 space-y-2">
  {#if !districtLabel && !locationLabel}
    <button onclick={handleUpdateLocation} ...>
      {isDetectingLocation ? 'Detecting...' : "See what's happening nearby →"}
    </button>
  {:else if !districtLabel && locationLabel}
    <!-- Coordination count + correction affordance + preview -->
    ...
  {:else if districtLabel}
    <!-- Filter toggle -->
    <button onclick={handleToggleFilter} ...>
      {showLocalOnly ? `Showing ${coordinationCount}` : `${coordinationCount} messages →`}
    </button>
  {/if}
</div>
```

**AFTER:**
```svelte
<!-- Progressive affordance buttons (3-step funnel) -->
<div class="mt-3 space-y-2">
  {#if !districtLabel && !locationLabel}
    <button onclick={handleUpdateLocation} ...>
      {isDetectingLocation ? 'Detecting...' : "See what's happening nearby →"}
    </button>
  {:else if !districtLabel && locationLabel}
    <!-- Correction affordance only -->
    <div class="flex items-center justify-center gap-2 text-sm">
      <button onclick={() => (showAddressModal = true)} ...>
        Not from {locationLabel}?
      </button>
      <span class="text-slate-400">·</span>
      <button onclick={() => (showAddressModal = true)} ...>
        Enter your address →
      </button>
    </div>
  {:else if districtLabel}
    <!-- Change address option -->
    <button onclick={() => (showAddressModal = true)} ...>
      Change location
    </button>
  {/if}
</div>
```

### A2: TemplateList.svelte (Before/After)

**BEFORE (lines 72-131):**
```svelte
<div class="space-y-3 md:space-y-4">
  {#each templates as template, index (template.id)}
    <button ...>{template.title}</button>
  {/each}
</div>
```

**AFTER:**
```svelte
<div class="space-y-6 md:space-y-8">
  {#each groups as group (group.title)}
    <div class="space-y-3 md:space-y-4">
      <h3 class="text-sm font-semibold text-slate-700 uppercase tracking-wide">
        {group.title}
      </h3>

      <div class="space-y-3 md:space-y-4">
        {#each group.templates as template, index (template.id)}
          <button ...>{template.title}</button>
        {/each}
      </div>
    </div>
  {/each}
</div>
```

## Sign-off

- [ ] Engineering: Implementation complete
- [ ] Design: Visual design approved
- [ ] Product: User flows validated
- [ ] QA: Test coverage complete
- [ ] Metrics: Success metrics tracked
