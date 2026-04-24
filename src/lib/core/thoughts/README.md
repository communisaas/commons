# Structured Thought Emission

Agent-side service and type definitions for reasoning visualization with progressive disclosure.

## Overview

This module provides the core data model for making agent thinking visible and explorable. Instead of raw text streaming, agents emit **structured thought segments** with:

- **Progressive disclosure** - Click to expand for more detail (L1, L2, L3 depth layers)
- **Inline citations** - References to sources with expandable excerpts
- **Action traces** - Research and retrieval operations with visibility into what the agent did
- **Key moments** - Important items pinned to a persistent footer

## Key Types

### `ThoughtSegment`

The fundamental unit of agent reasoning.

```typescript
interface ThoughtSegment {
  id: string;
  timestamp: number;
  type: 'reasoning' | 'action' | 'citation' | 'insight' | 'recommendation';
  phase: string;  // e.g., 'research', 'context', 'drafting'
  content: string;

  expandable: boolean;
  expansion?: ThoughtExpansion;
  citations?: Citation[];
  action?: ActionTrace;

  emphasis?: 'normal' | 'highlight' | 'muted';
  pinToKeyMoments?: boolean;
}
```

**Example:**

```typescript
const thought: ThoughtSegment = {
  id: 'thought-1',
  timestamp: Date.now(),
  type: 'reasoning',
  phase: 'research',
  content: 'Apple has committed to carbon neutrality by 2030.',
  expandable: true,
  expansion: {
    summary: 'According to their 2025 Environmental Report...',
    details: {
      type: 'source_metadata',
      data: { reportUrl: 'https://...', pageNumber: 12 }
    }
  },
  citations: [{
    id: 'cite-1',
    label: "Apple's 2025 Report",
    url: 'https://...',
    excerpt: 'We are committed to carbon neutrality...',
    sourceType: 'intelligence'
  }],
  emphasis: 'highlight'
};
```

### `Citation`

A reference to a source within thought content.

```typescript
interface Citation {
  id: string;
  label: string;
  url?: string;
  excerpt: string;
  sourceType: 'intelligence' | 'document' | 'organization' | 'web';
  intelligenceId?: string; // Convex intelligence item
  documentId?: string;     // Reducto-parsed document
}
```

### `ActionTrace`

Details of a research or retrieval action.

```typescript
interface ActionTrace {
  type: 'research' | 'retrieve' | 'analyze' | 'search';
  target: string;
  targetType?: ActionTargetType;
  status: 'pending' | 'complete' | 'error';
  startTime: number;
  endTime?: number;

  // Research-specific
  pagesVisited?: PageVisit[];
  findings?: string[];

  // Retrieval-specific
  query?: string;
  resultsCount?: number;
  topResults?: RetrievalResult[];

  error?: string;
}
```

**Example (Research):**

```typescript
const researchTrace: ActionTrace = {
  type: 'research',
  target: 'Apple Inc.',
  targetType: 'corporate',
  status: 'complete',
  startTime: Date.now(),
  endTime: Date.now() + 2000,
  pagesVisited: [
    { url: 'https://apple.com/sustainability', title: 'Sustainability', relevant: true }
  ],
  findings: [
    'Lisa Jackson leads Environmental Policy',
    'Committed to carbon neutrality by 2030'
  ]
};
```

**Example (Retrieval):**

```typescript
const retrievalTrace: ActionTrace = {
  type: 'retrieve',
  target: 'climate policy',
  status: 'complete',
  startTime: Date.now(),
  endTime: Date.now() + 500,
  query: 'climate policy corporate sustainability',
  resultsCount: 15,
  topResults: [
    { id: 'intel-1', title: 'Apple announces...', score: 0.89 }
  ]
};
```

### `KeyMoment`

Important item pinned to Key Moments footer.

```typescript
interface KeyMoment {
  id: string;
  type: 'citation' | 'action' | 'insight' | 'decision_maker';
  label: string;
  icon: string;
  segmentId: string;
}
```

### `PhaseState`

Track progression through agent reasoning phases.

```typescript
interface PhaseState {
  name: string;
  status: 'pending' | 'active' | 'complete';
  startTime?: number;
  endTime?: number;
}
```

## Progressive Disclosure Layers

The thought system supports progressive disclosure of information:

| Layer | Content | Source | Access |
|-------|---------|--------|--------|
| Surface | Agent synthesis | Gemini reasoning | Always visible |
| L1 | Citations/excerpts | Convex intelligence cache | Click inline citation |
| L2 | Research trace | Google Search grounding | Click action segment |
| L3 | Full documents | Reducto parse | "View full document" |

## Usage in Components

```svelte
<script lang="ts">
  import type { ThoughtSegment, Citation, ActionTrace } from '$lib/core/thoughts';

  interface Props {
    segment: ThoughtSegment;
  }

  let { segment }: Props = $props();

  function handleCitationClick(citation: Citation) {
    // Open DetailDrawer with citation details (L1)
  }

  function handleActionExpand(action: ActionTrace) {
    // Open DetailDrawer with research trace (L2)
  }
</script>

<div class="thought-segment">
  {#if segment.type === 'action'}
    <ActionSegment {segment.action} onexpand={handleActionExpand} />
  {:else}
    <p class="content">
      {@html renderWithCitations(segment.content, segment.citations, handleCitationClick)}
    </p>
  {/if}
</div>
```

## Streaming Events

The `ThoughtStreamEvent` type enables real-time updates:

```typescript
type ThoughtStreamEvent =
  | { type: 'segment'; segment: ThoughtSegment }
  | { type: 'phase'; phase: PhaseState }
  | { type: 'key_moment'; moment: KeyMoment }
  | { type: 'complete'; totalSegments: number; duration: number }
  | { type: 'error'; error: string };
```

Use in a streaming context:

```typescript
async function* emitThoughts(): AsyncGenerator<ThoughtStreamEvent> {
  yield { type: 'phase', phase: { name: 'Research', status: 'active' } };

  yield {
    type: 'segment',
    segment: { /* ... */ }
  };

  yield {
    type: 'key_moment',
    moment: { id: 'moment-1', type: 'citation', /* ... */ }
  };

  yield {
    type: 'complete',
    totalSegments: 10,
    duration: 5000
  };
}
```

## Design Philosophy

These types embody a **designer's sensibility** combined with **technical rigor**:

1. **User mental model first** - Types reflect how users think about agent reasoning, not implementation details
2. **Progressive disclosure** - Don't overwhelm; reveal depth on demand
3. **Semantic clarity** - Type names and fields communicate intent without documentation
4. **Accessibility-ready** - Structure supports screen readers and keyboard navigation
5. **Performance-conscious** - Optional fields and lazy loading enable smooth streaming

## Related Files

- `/src/lib/core/agents/providers/types.ts` - Provider interfaces
- `/src/lib/core/agents/types.ts` - Agent type definitions

## ThoughtEmitter Service

The `ThoughtEmitter` class provides a clean API for agents to emit structured thoughts:

```typescript
import { ThoughtEmitter } from '$lib/core/thoughts';

const emitter = new ThoughtEmitter((segment) => {
  // Send segment to UI
  console.log('New thought:', segment.content);
});

// Phase management
emitter.startPhase('research');

// Emit thoughts
emitter.think('Analyzing Apple Inc. sustainability leadership...');
emitter.insight('Lisa Jackson is the right decision-maker.');
emitter.recommend('Contact Lisa Jackson at Apple Inc.');

// Research actions
const research = emitter.startResearch('Apple Inc.', 'corporate');
research.addFinding('Lisa Jackson leads Environmental Policy');
research.complete('Found key leadership information');

// Citations
const citation = emitter.cite("Apple's 2025 Report", {
  url: 'https://...',
  excerpt: 'Committed to carbon neutrality...'
});

emitter.think('Apple has committed to carbon neutrality by 2030.', {
  citations: [citation]
});

// Access state
const keyMoments = emitter.getKeyMoments();
const phases = emitter.getPhases();
```

See `example.ts` for comprehensive usage examples.

## Files

- `types.ts` - Type definitions for all thought-related structures
- `emitter.ts` - ThoughtEmitter service implementation
- `example.ts` - Comprehensive usage examples
- `index.ts` - Module exports

## Next Steps

1. ✅ Build ThoughtEmitter service (Task #10)
2. ✅ Build AgentMemoryService for RAG (Task #11)
3. Build ThoughtStream 2.0 UI components (Task #12)
4. Build KeyMoments and DetailDrawer (Task #13)
