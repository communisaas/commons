# Frontend Architecture: SvelteKit 5 + Runes

**Commons's frontend implementation guide. Not blockchain—that's in [voter-protocol](https://github.com/communisaas/voter-protocol).**

This document covers SvelteKit 5 patterns, state management with runes, component architecture, and frontend-specific decisions. For blockchain integration, see `INTEGRATION-GUIDE.md`.

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** Versions (SvelteKit 2.57
> + Svelte 5.55), the design system pointer (`src/lib/design/*`), and
> the Convex-on-server posture are accurate. These specific examples
> drift from what the codebase actually does today — read them as
> target patterns, not the canonical implementation:
>
> - **Runes migration is incomplete.** Grep shows essentially no
>   `$props()` / `$state()` / `$bindable()` usage inside components;
>   components still use destructuring + callback props (Svelte 5
>   syntax) without runes. `Layout.svelte` has one `$derived`.
>   `src/lib/stores/templateDraft.ts` and `tooltip.ts` still use
>   legacy `writable()` / `readable()` from `svelte/store`. Treat
>   the "we migrated all stores to runes in September 2024" claim as
>   aspirational.
> - **API-route examples import from `$lib/core/db`** (Prisma). That
>   module does not exist. Real server handlers use
>   `serverQuery(api.*)` / `serverMutation(api.*)` from
>   `convex-sveltekit` (~599 call sites across the repo). See
>   `+page.server.ts` / `+layout.server.ts` for canonical shape.
> - **Callback props are destructuring syntax, not runes.** Props like
>   `{ onclick }` on `Button.svelte` are plain Svelte 5 destructuring —
>   the "`createEventDispatcher` → callback props" migration is real
>   but does not involve `$props()`.
> - **Convex integration is silent in this guide.** The
>   `convex-sveltekit` client, server `serverQuery` / `serverMutation`
>   wrappers, and `ctx.auth.getUserIdentity()` bridge deserve a section
>   but aren't documented here.

---

## Table of Contents

1. [Technology Stack](#technology-stack)
2. [SvelteKit 5 Architecture](#sveltekit-5-architecture)
3. [Runes-Based State Management](#runes-based-state-management)
4. [Component Patterns](#component-patterns)
5. [Routing & SSR](#routing--ssr)
6. [Form Handling](#form-handling)
7. [Type Safety](#type-safety)
8. [Performance Patterns](#performance-patterns)

---

## Technology Stack

**Core Framework:**
- **SvelteKit 5**: Meta-framework with SSR, routing, API routes
- **Svelte 5**: Component framework with runes (replacing stores)
- **TypeScript**: Strict type checking, zero `any` tolerance
- **Vite**: Build tool and dev server

**Styling:**
- **Tailwind CSS**: Utility-first CSS framework
- **Design System**: See `docs/design-system.md` for comprehensive design tokens

**Database & Backend:**
- **PostgreSQL**: Database via Hyperdrive connection pooling (accessed via Prisma ORM)
- **Prisma**: Type-safe database client
- **@oslojs/crypto**: Cryptographic session management

**Key Libraries:**
- **lucide-svelte**: Icon system
- **libsodium-wrappers**: Client-side XChaCha20-Poly1305 encryption
- **CodeMirror 6**: Template editor with variable highlighting

---

## SvelteKit 5 Architecture

### Directory Structure

```
src/
├── routes/              # SvelteKit file-based routing
│   ├── +page.svelte     # Landing page (/)
│   ├── +layout.svelte   # Root layout (auth state, global modals)
│   ├── s/               # Templates (/s/[slug])
│   │   └── [slug]/
│   │       ├── +page.ts       # Load template data
│   │       └── +page.svelte   # Template customization UI
│   ├── create/          # Template creator
│   └── api/             # API endpoints (+server.ts files)
│       ├── templates/
│       ├── auth/
│       └── cwc/
│
├── lib/
│   ├── components/      # Svelte components
│   │   ├── ui/          # Reusable UI primitives
│   │   ├── template/    # Template-specific components
│   │   ├── auth/        # OAuth & authentication UI
│   │   ├── landing/     # Landing page sections
│   │   └── layout/      # Layout components (Header, Footer)
│   │
│   ├── stores/          # Svelte 5 runes-based stores
│   │   ├── templates.svelte.ts    # Template catalog state
│   │   ├── modalSystem.svelte.ts  # Modal orchestration
│   │   └── toast.svelte.ts        # Toast notifications
│   │
│   ├── core/            # Production core logic
│   │   ├── auth/        # Session management, OAuth
│   │   ├── analytics/   # Funnel tracking
│   │   └── api/         # Unified API client
│   │
│   ├── types/           # TypeScript definitions
│   ├── utils/           # Utility functions
│   └── actions/         # Svelte actions
│
└── app.html             # HTML shell
```

### SSR vs Client-Side Rendering

**Server-Side Rendered (SSR):**
- Landing page (`/`) - SEO, fast initial paint
- Template pages (`/s/[slug]`) - Pre-fetch template data, meta tags
- OAuth callbacks - Server-side session creation

**Client-Side Rendered (CSR):**
- Template editor (`/create`) - Rich interactive UI
- Address collection modal - Client-side validation
- Message encryption - Browser-only cryptography (XChaCha20-Poly1305 to TEE for congressional delivery)
- ZK proof generation - Browser WASM Noir/UltraHonk proving (address never leaves browser)

**Progressive Enhancement Pattern:**

```typescript
// +page.ts (SSR data loading)
export async function load({ params, fetch }) {
  const response = await fetch(`/api/templates/${params.slug}`);
  const template = await response.json();

  return {
    template // Available immediately on page load
  };
}
```

```svelte
<!-- +page.svelte (hydrates with SSR data) -->
<script lang="ts">
  let { data } = $props(); // SSR data passed from load()

  // Client-side state
  let customizations = $state<Record<string, string>>({});
</script>

<TemplateEditor template={data.template} bind:customizations />
```

---

## Runes-Based State Management

**Svelte 5 runes replace Svelte 4 stores.** Runes provide reactive state without subscriptions.

### Core Runes

**`$state`** - Reactive state primitive:

```typescript
// ❌ Svelte 4 pattern (deprecated)
import { writable } from 'svelte/store';
const count = writable(0);

// ✅ Svelte 5 runes pattern
let count = $state(0);
```

**`$derived`** - Computed values:

```typescript
let templates = $state<Template[]>([]);
let publicTemplates = $derived(templates.filter(t => t.is_public));
```

**`$effect`** - Side effects:

```typescript
let searchQuery = $state('');

$effect(() => {
  // Runs whenever searchQuery changes
  console.log('Searching for:', searchQuery);
});
```

### Store Pattern (Svelte 5)

**Example: `stores/templates.svelte.ts`**

```typescript
interface TemplateState {
  templates: Template[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
}

function createTemplateStore() {
  const state = $state<TemplateState>({
    templates: [],
    selectedId: null,
    loading: false,
    error: null
  });

  return {
    // Getters (reactive)
    get templates() {
      return state.templates;
    },
    get loading() {
      return state.loading;
    },

    // Actions
    selectTemplate(id: string) {
      state.selectedId = id;
    },

    async fetchTemplates() {
      state.loading = true;
      try {
        const result = await templatesApi.list();
        state.templates = result.data;
        state.error = null;
      } catch (error) {
        state.error = 'Failed to fetch templates';
      } finally {
        state.loading = false;
      }
    }
  };
}

export const templateStore = createTemplateStore();
```

**Usage in components:**

```svelte
<script lang="ts">
  import { templateStore } from '$lib/stores/templates.svelte';
  import { onMount } from 'svelte';

  onMount(() => {
    templateStore.fetchTemplates();
  });
</script>

{#if templateStore.loading}
  <LoadingSpinner />
{:else}
  {#each templateStore.templates as template}
    <TemplateCard {template} />
  {/each}
{/if}
```

### Modal System (Advanced Pattern)

**Centralized modal orchestration:**

```typescript
// stores/modalSystem.svelte.ts
function createModalSystem() {
  const state = $state({
    activeModal: null as string | null,
    modalProps: {} as Record<string, unknown>
  });

  return {
    get activeModal() {
      return state.activeModal;
    },

    openModal(id: string, props?: Record<string, unknown>) {
      state.activeModal = id;
      state.modalProps = props || {};
    },

    closeModal() {
      state.activeModal = null;
      state.modalProps = {};
    }
  };
}

export const modalSystem = createModalSystem();
```

**Usage:**

```svelte
<script lang="ts">
  import { modalSystem } from '$lib/stores/modalSystem.svelte';

  function openAuth() {
    modalSystem.openModal('auth', {
      initialView: 'login'
    });
  }
</script>

<button onclick={openAuth}>Sign In</button>

<!-- Root layout manages modals -->
{#if modalSystem.activeModal === 'auth'}
  <AuthModal onClose={() => modalSystem.closeModal()} />
{/if}
```

---

## Component Patterns

### Props with Runes

**Svelte 5 props syntax:**

```svelte
<script lang="ts">
  import type { Template } from '$lib/types/template';

  // ✅ Svelte 5 pattern
  let {
    template,
    onSave = () => {},
    disabled = false
  }: {
    template: Template;
    onSave?: (data: CustomizationData) => void;
    disabled?: boolean;
  } = $props();

  // Reactive local state
  let customizations = $state<Record<string, string>>({});
</script>

<form onsubmit={() => onSave(customizations)}>
  <!-- Form fields -->
</form>
```

### Event Dispatch Pattern

**Svelte 5 uses callback props instead of `createEventDispatcher`:**

```svelte
<!-- ❌ Svelte 4 pattern (deprecated) -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  function handleClick() {
    dispatch('click', { data: 'value' });
  }
</script>

<!-- ✅ Svelte 5 pattern -->
<script lang="ts">
  let { onClick }: { onClick: (data: string) => void } = $props();
</script>

<button onclick={() => onClick('value')}>Click</button>
```

### Component Composition

**Slot pattern for flexible composition:**

```svelte
<!-- Card.svelte -->
<script lang="ts">
  let {
    title,
    children
  }: {
    title: string;
    children: Snippet;
  } = $props();
</script>

<div class="card">
  <h2>{title}</h2>
  {@render children()}
</div>
```

**Usage:**

```svelte
<Card title="Template Stats">
  <p>Sent: {template.send_count}</p>
  <p>Last sent: {template.last_sent_at}</p>
</Card>
```

---

## Routing & SSR

### Load Functions

**+page.ts (universal load):**

```typescript
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
  const template = await fetch(`/api/templates/${params.slug}`).then(r => r.json());

  return {
    template,
    meta: {
      title: template.title,
      description: template.description
    }
  };
};
```

**+page.server.ts (server-only load):**

```typescript
import type { PageServerLoad } from './$types';
import { db } from '$lib/core/db';

export const load: PageServerLoad = async ({ locals }) => {
  // Access server-only resources
  const user = locals.user;

  const templates = await db.template.findMany({
    where: { userId: user?.id }
  });

  return { templates };
};
```

### API Routes

**+server.ts pattern:**

```typescript
// src/routes/api/templates/+server.ts
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { db } from '$lib/core/db';

export const GET: RequestHandler = async () => {
  const templates = await db.template.findMany({
    where: { is_public: true }
  });

  return json({ templates });
};

export const POST: RequestHandler = async ({ request }) => {
  const data = await request.json();

  const template = await db.template.create({
    data: {
      ...data,
      status: 'draft'
    }
  });

  return json({ template }, { status: 201 });
};
```

---

## Form Handling

### Progressive Enhancement

**Form with client-side enhancement:**

```svelte
<script lang="ts">
  import { enhance } from '$app/forms';

  let submitting = $state(false);
  let error = $state<string | null>(null);
</script>

<form
  method="POST"
  action="/api/auth/login"
  use:enhance={() => {
    submitting = true;

    return async ({ result, update }) => {
      if (result.type === 'failure') {
        error = result.data?.message || 'Login failed';
      } else {
        await update();
      }
      submitting = false;
    };
  }}
>
  <input type="email" name="email" required />
  <button disabled={submitting}>
    {submitting ? 'Logging in...' : 'Log in'}
  </button>

  {#if error}
    <p class="error">{error}</p>
  {/if}
</form>
```

### Client-Side Validation

**Real-time validation pattern:**

```svelte
<script lang="ts">
  let email = $state('');
  let emailError = $derived(
    email && !email.includes('@')
      ? 'Invalid email'
      : null
  );
</script>

<input
  type="email"
  bind:value={email}
  class:error={emailError}
/>
{#if emailError}
  <p class="error-message">{emailError}</p>
{/if}
```

---

## Type Safety

### Strict TypeScript Configuration

**Zero tolerance for type violations:**

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true
  }
}
```

**Violations that cause instant PR rejection:**

- ❌ `any` type usage
- ❌ `@ts-ignore` comments
- ❌ `@ts-nocheck` comments
- ❌ Loose object casting (`data as SomeType`)

### Component Type Safety

**Typed props:**

```svelte
<script lang="ts">
  import type { Template } from '$lib/types/template';

  let {
    template,
    onComplete
  }: {
    template: Template;
    onComplete: (data: CompletionData) => void;
  } = $props();
</script>
```

**Typed stores:**

```typescript
const state = $state<TemplateState>({
  templates: [],
  selectedId: null,
  loading: false,
  error: null
});
```

---

## Performance Patterns

### Code Splitting

**Dynamic imports for heavy components:**

```svelte
<script lang="ts">
  import { browser } from '$app/environment';

  let CodeMirrorEditor: any;

  onMount(async () => {
    if (browser) {
      const module = await import('$lib/components/CodeMirrorEditor.svelte');
      CodeMirrorEditor = module.default;
    }
  });
</script>

{#if CodeMirrorEditor}
  <svelte:component this={CodeMirrorEditor} />
{/if}
```

### Lazy Loading

**Intersection Observer for images:**

```svelte
<script lang="ts">
  import { lazyLoad } from '$lib/actions/lazyLoad';
</script>

<img
  use:lazyLoad={{ src: template.imageUrl }}
  alt={template.title}
/>
```

### Debouncing

**Search input debouncing:**

```svelte
<script lang="ts">
  import { debounce } from '$lib/utils/debounce';

  let searchQuery = $state('');

  const performSearch = debounce((query: string) => {
    // API call
  }, 300);

  $effect(() => {
    performSearch(searchQuery);
  });
</script>

<input bind:value={searchQuery} placeholder="Search templates..." />
```

---

## Key Architectural Decisions

### Why Svelte 5 Runes?

**Previous (Svelte 4):** Stores with `subscribe()` pattern required manual cleanup, verbose boilerplate.

**Current (Svelte 5):** Runes provide automatic reactivity without subscriptions. Cleaner code, better TypeScript support, automatic cleanup.

**Migration:** We migrated all Svelte 4 stores to runes pattern in September 2024.

### Why SvelteKit?

- **File-based routing**: Intuitive, scales well
- **SSR + API routes**: Single codebase for frontend and backend
- **Progressive enhancement**: Forms work without JS
- **Type safety**: Full TypeScript integration with `$types`

### State Management Philosophy

**Local state first:** Use component `$state` for UI state (form inputs, toggles, etc.)

**Global stores for shared concerns:**
- `templateStore`: Template catalog (used across multiple routes)
- `modalSystem`: Modal orchestration (accessed from any component)
- `toast`: Notification system (global notifications)

**Server state via SvelteKit:** Authentication state, user session, database queries—handled by SvelteKit load functions, not client-side stores.

---

## Making Complexity Invisible

### The UX Principle

**What users think they're doing:**
> "I'm sending a message to my representative about healthcare."

**What's actually happening:**
> Browser generates Noir/UltraHonk zero-knowledge proof, encrypts witness to TEE public key, submits proof to Scroll L2 blockchain, sends encrypted blob to AWS Nitro Enclave for decryption and CWC API delivery, updates on-chain ERC-8004 reputation, and creates pseudonymous Message record in Postgres.

**Commons's job:**
> Make the second paragraph COMPLETELY INVISIBLE unless the user explicitly wants to see it.

### User Mental Model

1. Pick a template about an issue I care about
2. Add my personal story (30 seconds)
3. Click "Send to My Representatives"
4. Done. Message delivered anonymously.

**What user sees:**
```
⏳ Preparing anonymous delivery... (~10 seconds)
[Progress bar: 60%]
```

Then:
```
✅ Delivered anonymously to Representative Smith
```

**What user NEVER sees:** WASM proving, Noir circuits, Poseidon hashes, nullifiers, Merkle paths, TEE attestation, gas fees, blockchain transactions.

### The Invisible Work

**Identity Verification (30s-2min):**
- mDL via Digital Credentials API (sole provider; self.xyz and Didit.me removed in Cycle 15)
- Returns `identity_commitment` (Poseidon hash)
- Browser encrypts address to TEE public key (XChaCha20-Poly1305)
- Encrypted blob stored in Postgres
- TEE decrypts → geocodes → returns district ("TX-07")
- Session credential cached: "Verified TX-07 constituent"
- **User is verified - NEVER ASKED AGAIN**

**ZK Proof Generation (8-15s mobile, 600ms-2s desktop):**
- WASM module loaded (Noir/UltraHonk prover)
- Noir circuit initialized (depth=20 for ~1M leaves, or depth=18/22/24)
- Browser generates ZK proof: "I am ONE OF registered TX-07 residents"
- Proof DOESN'T reveal: which resident, which address, which leaf
- **User sees loading state with accurate time estimate**

**Encrypted Delivery:**
- Message encrypted in browser (XChaCha20-Poly1305)
- Sent to AWS Nitro Enclave (ARM Graviton, hypervisor-isolated)
- TEE decrypts inside hardware enclave
- Calls CWC API with plaintext address
- Receives delivery confirmation
- **Address destroyed (zeroed from memory)**
- **Congressional office sees: "Verified Constituent (TX-07)"**

**On-Chain Reputation:**
- Smart contract verifies ZK proof (~2.2M gas on Scroll L2)
- Checks nullifier not reused
- Updates ERC-8004 reputation (+1 Healthcare Policy)
- **Platform pays all gas fees**
- **User never interacts with blockchain directly**

### Progressive Disclosure

**Default view:** Simple, fast, obvious
```svelte
<TemplateCard>
  <h2>Support Medicare Expansion</h2>
  <p>247 constituents sent this template</p>
  <button>Add My Story →</button>
</TemplateCard>
```

**Hover state:** Aggregate context (optional)
```svelte
<Tooltip>
  <p>247 verified constituents sent variations</p>
  <p>82 unique congressional districts</p>
  <p>Average reputation: 8,740 in Healthcare Policy</p>
</Tooltip>
```

**Click "Details":** Full transparency (if user asks)
```svelte
<details>
  <summary>How is this anonymous?</summary>
  <section class="technical-details">
    <h3>Privacy Technology</h3>
    <ul>
      <li><strong>Zero-Knowledge Proofs:</strong> You prove you're a TX-07 constituent without revealing which one</li>
      <li><strong>Encrypted Delivery:</strong> Your address is encrypted in your browser, decrypted only inside a secure enclave</li>
      <li><strong>On-Chain Reputation:</strong> Your civic action score is tracked on Scroll blockchain, not linked to your identity</li>
      <li><strong>Pseudonymous Messaging:</strong> Congressional offices see "Verified TX-07 Constituent", not your name</li>
    </ul>
    <a href="/docs/privacy" class="learn-more">Learn more about our privacy architecture →</a>
  </section>
</details>
```

**Power user view:** Cryptographic audit trail (advanced users only)
```svelte
<details class="cryptographic-proof">
  <summary>Cryptographic Proof (Advanced)</summary>
  <section class="proof-details">
    <h3>Zero-Knowledge Proof</h3>
    <code class="proof-hex">{proofBytes.slice(0, 100)}...</code>

    <h3>Public Outputs</h3>
    <ul>
      <li><strong>District Root:</strong> <code>{publicOutputs.district_root}</code></li>
      <li><strong>Nullifier:</strong> <code>{publicOutputs.nullifier}</code></li>
      <li><strong>Action ID:</strong> <code>{publicOutputs.action_id}</code></li>
    </ul>

    <h3>On-Chain Verification</h3>
    <p>
      Scroll L2 Transaction:
      <a href="https://scroll.io/tx/{blockchainTxHash}" target="_blank">
        {blockchainTxHash.slice(0, 10)}...
      </a>
    </p>
  </section>
</details>
```

### The Golden Rule

**If explaining the technology is required for the user to trust it, the UX has failed.**

Trust comes from transparency WHEN ASKED, not from forcing users to understand Noir circuits.

---

## Next Steps

- **Template System**: See `docs/features/templates.md` for variable extraction, editor, moderation
- **Integrations**: See `docs/integration.md` for CWC API, OAuth, geocoding, mDL identity verification
- **Development**: See `docs/development/` for testing, seeding, deployment
- **Design System**: See `design-system.md` for comprehensive component library

---

*Commons | Frontend Architecture | 2026-03*
