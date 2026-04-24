# ThoughtStream 2.0 Integration Guide

Complete integration example for Commons agent visualization.

## Full Integration Example

```svelte
<!-- src/routes/send/+page.svelte -->
<script lang="ts">
  import { ThoughtStream, KeyMoments, DetailDrawer } from '$lib/components/thoughts';
  import { ThoughtEmitter } from '$lib/core/thoughts/emitter';
  import type { ThoughtSegment, PhaseState, Citation, ActionTrace, KeyMoment } from '$lib/core/thoughts/types';
  import type { ParsedDocument } from '$lib/server/reducto/types';
  import { getReductoClient } from '$lib/server/reducto/client';

  // ============================================================================
  // State Management
  // ============================================================================

  // Thought stream state
  let segments = $state<ThoughtSegment[]>([]);
  let phases = $state<PhaseState[]>([]);
  let keyMoments = $state<KeyMoment[]>([]);
  let streaming = $state(false);

  // Detail drawer state
  let drawerOpen = $state(false);
  let drawerContent = $state<Citation | ActionTrace | null>(null);
  let drawerDocument = $state<ParsedDocument | null>(null);

  // Track L3 state for stream de-emphasis
  let detailDrawer: { isL3Active: boolean };

  // ============================================================================
  // CRITICAL: Document Map for L2/L3 Previews
  // ============================================================================
  //
  // This Map stores fetched ParsedDocuments keyed by documentId.
  // When a citation has sourceType='document' and documentId, AND that documentId
  // exists in this Map, InlineCitation will show the L2 hover preview.
  //
  // The data flows through the component tree:
  // ThoughtStream -> PhaseContainer -> ThoughtSegment -> InlineCitation
  //
  let documents = $state(new Map<string, ParsedDocument>());

  // Loading state for document fetches
  let loadingDocuments = $state(new Set<string>());

  // Initialize ThoughtEmitter
  const emitter = new ThoughtEmitter((segment) => {
    segments = [...segments, segment];
  });

  // ============================================================================
  // Event Handlers
  // ============================================================================

  function handleCitationClick(citation: Citation) {
    drawerContent = citation;
    drawerDocument = null; // Reset document when opening citation
    drawerOpen = true;
  }

  function handleActionExpand(action: ActionTrace) {
    drawerContent = action;
    drawerDocument = null;
    drawerOpen = true;
  }

  function handleMomentClick(moment: KeyMoment) {
    // Option 1: Scroll to segment in stream
    const element = document.querySelector(`[data-segment-id="${moment.segmentId}"]`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Option 2: Open in detail drawer if it's a citation
    if (moment.type === 'citation' && moment.metadata?.citation) {
      drawerContent = moment.metadata.citation as Citation;
      drawerDocument = null;
      drawerOpen = true;
    }
  }

  // Handle L3 document request from CitationDetail
  // This fetches from the API and updates both the Map (for L2 previews) and drawer
  async function handleRequestDocument(documentId: string) {
    // Skip if already loading
    if (loadingDocuments.has(documentId)) return;

    // Check cache first
    const cached = documents.get(documentId);
    if (cached) {
      drawerDocument = cached;
      return;
    }

    // Fetch from API
    loadingDocuments.add(documentId);
    loadingDocuments = new Set(loadingDocuments); // Trigger reactivity

    try {
      const response = await fetch(`/api/documents/${documentId}`);
      const result = await response.json();

      if (result.success && result.data?.document) {
        const doc = result.data.document as ParsedDocument;
        // Update the Map (triggers reactivity for L2 previews)
        documents.set(documentId, doc);
        documents = new Map(documents); // Trigger reactivity
        // Set for L3 view in drawer
        drawerDocument = doc;
      }
    } catch (error) {
      console.error('Document fetch failed:', error);
    } finally {
      loadingDocuments.delete(documentId);
      loadingDocuments = new Set(loadingDocuments);
    }
  }

  // Handle "View Full" from DocumentPreview (L2 hover preview)
  function handleViewFullDocument(doc: ParsedDocument) {
    drawerDocument = doc;
    drawerOpen = true;
    handleDocumentView(doc, null);
  }

  // Capture Key Moment when user enters L3 document view
  function handleDocumentView(doc: ParsedDocument, sourceCitation: Citation | null) {
    const moment: KeyMoment = {
      id: crypto.randomUUID(),
      type: 'document', // L3 document engagement
      label: `${doc.title.slice(0, 30)}${doc.title.length > 30 ? '...' : ''}`,
      icon: '📑',
      segmentId: sourceCitation?.id || doc.id,
      metadata: { documentId: doc.id, documentTitle: doc.title, sourceCitationId: sourceCitation?.id }
    };
    keyMoments = [...keyMoments, moment];
  }

  function closeDrawer() {
    drawerOpen = false;
    // Keep content for smooth exit animation
    setTimeout(() => {
      drawerContent = null;
      drawerDocument = null;
    }, 300);
  }

  // ============================================================================
  // Agent Execution
  // ============================================================================

  async function runAgent(userMessage: string, targetType: string) {
    streaming = true;
    segments = [];
    phases = [];

    try {
      // PHASE 1: Role Discovery
      emitter.startPhase('role-discovery');
      emitter.think('Identifying relevant decision-maker roles...');

      await simulateDelay(500);

      const research = emitter.startResearch('Apple Inc.', 'corporate');
      research.addFinding('VP Environmental Policy role identified');
      research.addFinding('Reports to CEO and oversees sustainability initiatives');

      await simulateDelay(400);
      research.complete('Found relevant leadership roles');

      emitter.completePhase();

      // PHASE 2: Person Lookup
      emitter.startPhase('person-lookup');
      emitter.think('Finding individuals in identified roles...');

      await simulateDelay(500);

      // Create citation with documentId for L2/L3 features
      // When documentId is provided AND sourceType is 'document':
      // - L2: Hover preview shows DocumentPreview card
      // - L3: "View Full Document" button opens document analysis
      const citation = emitter.cite("Apple's Leadership Page", {
        url: 'https://apple.com/leadership',
        excerpt: 'Lisa Jackson, VP Environmental Policy, leads Apple\'s efforts on climate and sustainability.',
        documentId: 'doc-apple-leadership', // Enables L2/L3 features
        sourceType: 'document' // Explicit type (or inferred from documentId)
      });

      await simulateDelay(300);
      emitter.insight('Lisa Jackson (VP Environmental Policy) is the key decision-maker.', {
        citations: [citation]
      });

      emitter.completePhase();

      // PHASE 3: Context Retrieval (optional)
      emitter.startPhase('context');
      emitter.think('Retrieving relevant intelligence from knowledge base...');

      await simulateDelay(400);

      const retrieval = emitter.startRetrieval('climate policy corporate sustainability Apple');
      await simulateDelay(600);
      retrieval.addFinding('Found 15 relevant intelligence items');
      retrieval.complete('Retrieved context on climate policy and corporate sustainability');

      emitter.completePhase();

      // PHASE 4: Recommendation
      emitter.startPhase('recommendation');
      emitter.think('Preparing final recommendation...');

      await simulateDelay(500);

      emitter.recommend(
        'Lisa Jackson — VP Environmental Policy at Apple Inc.',
        { pin: true }
      );

      emitter.completePhase();

      // Update phases and key moments
      phases = emitter.getPhases();
      keyMoments = emitter.getKeyMoments();

    } catch (error) {
      console.error('Agent execution failed:', error);
      emitter.think(`Error: ${error.message}`, { emphasis: 'muted' });
    } finally {
      streaming = false;
    }
  }

  function simulateDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================================
  // Auto-start for demo
  // ============================================================================

  import { onMount } from 'svelte';

  onMount(() => {
    // Auto-run agent for demo
    runAgent('I want to advocate for stronger climate action', 'corporate');
  });
</script>

<!-- ============================================================================
     Layout
     ============================================================================ -->

<div class="agent-workspace flex h-screen flex-col">
  <!-- Header -->
  <header class="border-b border-surface-border bg-surface-base px-6 py-4">
    <h1 class="text-2xl font-bold text-text-primary">Agent Thought Stream Demo</h1>
    <p class="mt-1 text-sm text-text-secondary">
      Real-time visualization of agent reasoning with progressive disclosure
    </p>
  </header>

  <!-- Main content -->
  <main class="flex flex-1 overflow-hidden">
    <!-- Thought stream (takes full width when drawer closed, shrinks when open) -->
    <!-- De-emphasize to 40% opacity when L3 document view is active -->
    <div
      class="flex-1 overflow-hidden transition-all duration-300"
      class:mr-[480px]={drawerOpen && !detailDrawer?.isL3Active}
      class:mr-[720px]={drawerOpen && detailDrawer?.isL3Active}
      style:opacity={detailDrawer?.isL3Active ? 0.4 : 1}
      style:transition="opacity 300ms ease, margin-right 300ms ease"
    >
      <!--
        CRITICAL: Pass documents Map and onViewFullDocument for L2/L3 features
        - documents: Enables L2 hover previews on document citations
        - onViewFullDocument: Opens document in L3 full view
      -->
      <ThoughtStream
        {segments}
        {phases}
        {streaming}
        {documents}
        oncitationclick={handleCitationClick}
        onactionexpand={handleActionExpand}
        onViewFullDocument={handleViewFullDocument}
      />
    </div>

    <!-- Detail drawer (slides in from right) -->
    <!-- Supports L1/L2 citation/action detail and L3 document analysis -->
    <DetailDrawer
      bind:this={detailDrawer}
      bind:open={drawerOpen}
      content={drawerContent}
      parsedDocument={drawerDocument}
      onclose={closeDrawer}
      onrequestdocument={handleRequestDocument}
      ondocumentview={handleDocumentView}
    />
  </main>

  <!-- Key moments footer (sticky at bottom) -->
  <KeyMoments
    moments={keyMoments}
    onmomentclick={handleMomentClick}
  />
</div>

<style>
  /* Ensure full viewport height */
  .agent-workspace {
    height: 100vh;
    max-height: 100vh;
  }
</style>
```

## L2/L3 Document Preview Wiring

The document preview system requires proper wiring through the component tree:

```
ThoughtStream ─┬─ documents Map ──────► PhaseContainer ──► ThoughtSegment ──► InlineCitation
               └─ onViewFullDocument ─► PhaseContainer ──► ThoughtSegment ──► InlineCitation
```

### Key Concepts:

1. **documents Map**: A reactive `Map<string, ParsedDocument>` that caches fetched documents
   - When a citation has `sourceType='document'` AND `documentId`, InlineCitation checks this Map
   - If the document exists in the Map, the L2 hover preview shows on mouse enter (300ms delay)

2. **Fetching Documents**: Use the `/api/documents/[id]` endpoint
   ```typescript
   const response = await fetch(`/api/documents/${documentId}`);
   const result = await response.json();
   if (result.success) {
     documents.set(documentId, result.data.document);
     documents = new Map(documents); // Trigger Svelte 5 reactivity
   }
   ```

3. **Creating Document Citations**: Set `documentId` and optionally `sourceType`:
   ```typescript
   const citation = emitter.cite('Document Title', {
     url: 'https://...',
     excerpt: 'Relevant text...',
     documentId: 'doc-123', // Enables L2/L3 features
     sourceType: 'document' // Optional: inferred from documentId
   });
   ```

### Demo Page

See `/demo/thought-stream` for a complete working example with mock documents.

## Minimal Integration

For basic usage without drawer:

```svelte
<script lang="ts">
  import { ThoughtStream } from '$lib/components/thoughts';
  import { ThoughtEmitter } from '$lib/core/thoughts/emitter';

  let segments = $state([]);
  let phases = $state([]);

  const emitter = new ThoughtEmitter((segment) => {
    segments = [...segments, segment];
  });

  async function runAgent() {
    emitter.startPhase('research');
    emitter.think('Analyzing targets...');

    const research = emitter.startResearch('Apple Inc.', 'corporate');
    research.addFinding('Found Lisa Jackson as VP Environmental Policy');
    research.complete('Research complete');

    emitter.completePhase();
    phases = emitter.getPhases();
  }
</script>

<ThoughtStream {segments} {phases} streaming={true} />
```

## Server-Side Integration

For real Gemini agent streaming:

```typescript
// src/lib/agents/decision-maker-agent.ts
import { ThoughtEmitter } from '$lib/core/thoughts/emitter';
import type { ThoughtSegment } from '$lib/core/thoughts/types';

export async function executeDecisionMakerAgent(
  userMessage: string,
  targetType: string,
  onThought: (segment: ThoughtSegment) => void
): Promise<AgentResult> {

  const emitter = new ThoughtEmitter(onThought);

  // Phase 1: Role Discovery
  emitter.startPhase('role-discovery');
  emitter.think('Identifying relevant decision-maker roles...');

  const research = emitter.startResearch(intent.targetEntity, targetType);

  const rolesResult = await gemini.identifyRoles(intent.targetEntity, targetType);

  for (const finding of rolesResult.findings) {
    research.addFinding(finding);
  }

  research.complete(`Identified ${rolesResult.roles.length} relevant roles`);
  emitter.completePhase();

  // Phase 2: Person Lookup
  emitter.startPhase('person-lookup');
  emitter.think('Finding individuals in identified roles...');

  const personsResult = await gemini.findPersons(rolesResult.roles, intent.targetEntity);

  for (const person of personsResult.decisionMakers) {
    emitter.insight(`${person.name} — ${person.title} at ${person.organization}`);
  }

  emitter.completePhase();

  // Phase 3: Context (optional)
  emitter.startPhase('context');

  const retrieval = emitter.startRetrieval(intent.query);
  const intelligenceItems = await vectorSearch(intent.query);

  retrieval.addFinding(`Retrieved ${intelligenceItems.length} relevant items`);
  retrieval.complete('Context retrieval complete');

  emitter.completePhase();

  // Phase 4: Recommendation
  emitter.startPhase('recommendation');
  emitter.think('Preparing final recommendations...');

  for (const dm of personsResult.decisionMakers) {
    emitter.recommend(`${dm.name} — ${dm.title} at ${dm.organization}`, { pin: true });
  }

  emitter.completePhase();

  return {
    decisionMakers: personsResult.decisionMakers,
    phases: emitter.getPhases(),
    keyMoments: emitter.getKeyMoments()
  };
}
```

## SvelteKit Server Endpoint

```typescript
// src/routes/api/agent/+server.ts
import { json } from '@sveltejs/kit';
import { executeDecisionMakerAgent } from '$lib/agents/decision-maker-agent';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const { message, targetType } = await request.json();

  const segments: ThoughtSegment[] = [];

  const result = await executeDecisionMakerAgent(
    message,
    targetType,
    (segment) => {
      segments.push(segment);
      // For SSE streaming, emit segment here
    }
  );

  return json({
    segments,
    phases: result.phases,
    keyMoments: result.keyMoments,
    draft: result.draft
  });
};
```

## Real-Time Streaming (SSE)

For live streaming updates to the UI:

```typescript
// Server: src/routes/api/agent/stream/+server.ts
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const message = url.searchParams.get('message');
  const targetType = url.searchParams.get('targetType');

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      await executeDecisionMakerAgent(
        message,
        targetType,
        (segment) => {
          // Send segment as SSE event
          const data = JSON.stringify({ type: 'segment', segment });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }
      );

      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
};
```

```svelte
<!-- Client: Consume SSE stream -->
<script lang="ts">
  import { ThoughtStream } from '$lib/components/thoughts';
  import type { ThoughtSegment } from '$lib/core/thoughts/types';

  let segments = $state<ThoughtSegment[]>([]);
  let streaming = $state(false);

  async function streamAgent(message: string, targetType: string) {
    streaming = true;
    segments = [];

    const eventSource = new EventSource(
      `/api/agent/stream?message=${encodeURIComponent(message)}&targetType=${targetType}`
    );

    eventSource.addEventListener('message', (event) => {
      const { type, segment } = JSON.parse(event.data);

      if (type === 'segment') {
        segments = [...segments, segment];
      }
    });

    eventSource.addEventListener('error', () => {
      eventSource.close();
      streaming = false;
    });

    eventSource.addEventListener('close', () => {
      eventSource.close();
      streaming = false;
    });
  }
</script>

<ThoughtStream {segments} phases={[]} {streaming} />
```

## Performance Optimization

For long thought streams (>100 segments), consider virtual scrolling:

```svelte
<script lang="ts">
  import { ThoughtStream } from '$lib/components/thoughts';

  // Only render last 50 segments + currently visible phases
  const visibleSegments = $derived(
    segments.slice(-50)
  );
</script>

<ThoughtStream segments={visibleSegments} {phases} {streaming} />
```

## Testing

```typescript
// tests/thoughts/ThoughtStream.test.ts
import { render, screen } from '@testing-library/svelte';
import { ThoughtStream } from '$lib/components/thoughts';
import type { ThoughtSegment, PhaseState } from '$lib/core/thoughts/types';

describe('ThoughtStream', () => {
  it('renders segments grouped by phase', () => {
    const segments: ThoughtSegment[] = [
      {
        id: '1',
        timestamp: Date.now(),
        type: 'reasoning',
        phase: 'research',
        content: 'Analyzing targets...',
        expandable: false
      }
    ];

    const phases: PhaseState[] = [
      {
        name: 'research',
        status: 'active',
        startTime: Date.now()
      }
    ];

    render(ThoughtStream, { segments, phases });

    expect(screen.getByText('Research')).toBeInTheDocument();
    expect(screen.getByText('Analyzing targets...')).toBeInTheDocument();
  });

  it('emits citation click events', async () => {
    const handleCitationClick = vi.fn();

    const segments: ThoughtSegment[] = [
      {
        id: '1',
        timestamp: Date.now(),
        type: 'reasoning',
        phase: 'research',
        content: 'Apple committed to neutrality',
        expandable: true,
        citations: [{
          id: 'cite-1',
          label: 'Apple Report',
          url: 'https://apple.com',
          excerpt: 'We commit...',
          sourceType: 'web'
        }]
      }
    ];

    const { component } = render(ThoughtStream, {
      segments,
      phases: [],
      oncitationclick: handleCitationClick
    });

    const citationButton = screen.getByText('Apple Report');
    await citationButton.click();

    expect(handleCitationClick).toHaveBeenCalled();
  });
});
```

## Styling Customization

Override CSS variables for theming:

```css
/* Custom theme for thought stream */
.agent-workspace {
  --coord-route-solid: #00a896; /* Custom teal */
  --coord-share-solid: #6366f1; /* Keep indigo */
  --surface-base: oklch(0.99 0.003 60); /* Warmer background */
}
```

## Next Steps

1. **Integrate with Gemini agent** - Replace simulated delays with real API calls
2. **Add persistence** - Save thought streams to Convex for history
3. **Enable replay** - Allow users to replay agent reasoning at different speeds
4. **Export functionality** - Download thought stream as markdown or JSON
5. **Search/filter** - Find specific thoughts, citations, or phases
6. **Annotations** - Let users add comments to thoughts
7. **Sharing** - Share specific insights or complete streams
