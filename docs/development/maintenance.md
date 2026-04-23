# Codebase Maintenance Standards

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** The "Development
> Discipline" + "Code Organization" sections remain sound. The
> database + backup + deploy sections describe the removed Prisma
> stack. Concrete corrections:
>
> - **Database:** Convex-only. `npm run db:migrate`, `db:generate`,
>   `db:push`, `db:seed` do not exist in `package.json`. Active seed
>   is `npm run seed` → `npx convex run seed:seedAll`. Schema is
>   `convex/schema.ts`, not Prisma.
> - **Backups:** `scripts/backup-db.ts` + `scripts/restore-db.ts`
>   were deleted 2026-04-21. Postgres backup GitHub Actions workflows
>   are gone. Use `npx convex export` / Convex dashboard for DR.
>   Pinning-provider migration (Storacha sunset 2026-05-31) is an
>   additional DR task — see
>   `docs/runbooks/DISASTER-RECOVERY.md` (also banner'd).
> - **Crons:** All 15 jobs live in `convex/crons.ts` (Convex native
>   scheduler). No HTTP `/api/cron/*` endpoints, no GitHub Actions
>   cron workflows. The three cron workflows
>   (`analytics-snapshot.yml`, `bounce-report-processing.yml`,
>   `legislation-crons.yml`) were deleted 2026-03-28.
> - **Deploy:** Frontend via `npm run build && wrangler pages deploy
>   .svelte-kit/cloudflare`. Backend via
>   `npx convex deploy --env-file .env.production` (the `-y` flag
>   silently fails for prod — always pass `--env-file`).
> - **Feature flags:** `FEATURES.CONGRESSIONAL=false`,
>   `DEBATE=false`, `PASSKEY=false` — aspirational framing elsewhere
>   in this doc should be read as code-complete-but-gated.

## Development Discipline

### Core Principles

1. **Code Must Compile** - All changes must pass `npm run check` before consideration
2. **Incremental Progress** - Make small, verifiable improvements rather than sweeping changes
3. **Documentation Accuracy** - Documentation reflects actual code state, not aspirational goals
4. **Type Safety** - Maintain TypeScript strict mode compliance throughout

### Quality Gates

**Before any commit:**

```bash
npm run check    # Must pass - no TypeScript errors
npm run lint     # Must pass - code style compliance
npm run test     # Must pass - no broken functionality
```

**Before any deployment:**

```bash
npm run build    # Must complete successfully
npm run preview  # Manual verification of build
```

### Change Management

**Approved Modification Patterns:**

1. **Type Definitions** - Add interfaces, never use `any` except for external API responses
2. **Error Handling** - Centralize via established patterns (`apiClient.ts`, `ErrorBoundary.svelte`)
3. **Import Organization** - Use `$lib/` absolute imports for cross-directory references
4. **Component Structure** - Follow existing patterns in `/lib/components/`

**Prohibited Actions:**

1. **Breaking Type Safety** - No `any` types without explicit justification
2. **Duplicate Systems** - No parallel implementations of existing functionality
3. **Performance Theater** - No complex solutions without measured performance benefit
4. **Documentation Inflation** - No aspirational documentation without corresponding implementation

### Architecture Constraints

**SvelteKit 5 + TypeScript + Tailwind CSS Stack:**

- Server-side rendering with progressive enhancement
- Type-safe API routes with proper error handling
- Component-scoped styles with Tailwind utility classes
- Session-based authentication via `@oslojs/crypto`

**Database Layer:**

- pgvector (Postgres) with Prisma ORM
- Migrations managed via `npm run db:migrate`
- Type generation via `npm run db:generate`

**External Integrations:**

- Congressional data via Congress.gov API
- OAuth providers (Google, Facebook, Twitter, LinkedIn, Discord — routes exist for all 5)
- Address validation via Census Bureau Geocoding API

## Implementation Standards

### Code Organization

**File Structure:**

```
src/lib/
├── core/                    # Production-ready code only
│   ├── auth/               # Authentication (OAuth, sessions)
│   ├── templates/          # Template CRUD and delivery
│   ├── congress/           # US Congressional features
│   ├── api/                # Single unified API client
│   └── db.ts               # Database client
│
├── experimental/            # Research & prototypes
│   ├── political-field/    # Political field analytics
│   ├── cascade/            # Viral cascade modeling
│   ├── sheaf/              # Sheaf fusion theory
│   └── percolation/        # Percolation engine
│
├── features/                # Feature-flagged implementations
│   ├── ai-suggestions/     # AI features (OFF by default)
│   ├── variable-resolver/  # ROADMAP.md implementation (OFF)
│   └── analytics/          # Advanced analytics (BETA)
│
└── shared/                  # Used by all layers
    ├── types/              # TypeScript types
    ├── utils/              # Pure utility functions
    └── constants/          # App constants
```

**Import Hierarchy:**

```typescript
// External packages
import { createEventDispatcher } from 'svelte';
import { fade } from 'svelte/transition';

// Internal absolute imports
import { api } from '$lib/utils/apiClient';
import type { Template } from '$lib/types/template';

// Relative imports (same directory only)
import './ComponentStyles.css';
```

### Error Handling

**API Interactions:**

```typescript
// Use centralized API client
const { api } = await import('$lib/utils/apiClient');
const result = await api.post('/api/endpoint', data);

if (!result.success) {
	// Handle error state
	return { error: result.error };
}
```

**Component Boundaries:**

```svelte
<!-- Wrap error-prone sections -->
<ErrorBoundary fallback="detailed" showRetry={true}>
	<ComplexComponent />
</ErrorBoundary>
```

### State Management

**Modal System:**

```typescript
import { modalSystem } from '$lib/stores/modalSystem';

// Open modal
modalSystem.open('template_modal', { templateId: 'abc123' });

// Close modal
modalSystem.close();
```

**Timer Coordination:**

```typescript
import { coordinated } from '$lib/utils/timerCoordinator';

// Coordinated timing
const timerId = coordinated.setTimeout(
	() => {
		// Cleanup handled automatically
	},
	1000,
	'feedback',
	componentId
);
```

## Quality Assurance

### Type Safety Verification

**Prohibited Patterns:**

```typescript
// NEVER
const data = response as any;
const user = event.locals.user as User;

// ALWAYS
const data: ApiResponse<TemplateData> = await api.get('/api/templates');
const user = event.locals.user; // Already typed via app.d.ts
```

**Required Type Coverage:**

- All function parameters and return types
- All API request/response interfaces
- All component prop types
- All store state interfaces

### Performance Guidelines

**Lazy Loading:**

```typescript
// Dynamic imports for large utilities
const { heavyFunction } = await import('$lib/utils/heavyModule');
```

**Memory Management:**

```typescript
// Timer cleanup
onDestroy(() => {
	timerCoordinator.clearComponentTimers(componentId);
});

// Event listener cleanup
onDestroy(() => {
	cleanupFunctions.forEach((cleanup) => cleanup());
});
```

## Documentation Maintenance

### Documentation Types

1. **Technical Specifications** - Architecture decisions and implementation details
2. **API Documentation** - Endpoint specifications and response formats
3. **Development Guides** - Setup, debugging, and contribution workflows
4. **User Documentation** - Feature explanations and usage instructions

### Accuracy Requirements

**Living Documentation:**

- Code examples must compile and execute
- API documentation reflects actual endpoint behavior
- Architecture diagrams match current implementation
- Performance claims backed by measurements

**Review Process:**

- Documentation updates accompany code changes
- Examples tested in development environment
- External links verified quarterly
- Screenshots updated with UI changes

## Continuous Improvement

### Monitoring

**Code Quality Metrics:**

- TypeScript strict mode compliance: 100%
- Test coverage: >80% for critical paths
- Bundle size: <500KB initial load
- Performance budget: <3s initial page load

**Error Tracking:**

- Client-side errors via `ErrorBoundary` system
- Server-side errors via structured logging
- Performance monitoring via Web Vitals
- User experience feedback via analytics

### Evolution Strategy

**Incremental Enhancement:**

1. Identify specific pain points through usage data
2. Design minimal viable improvements
3. Implement with feature flags
4. Measure impact before full rollout
5. Document learnings for future improvements

**Technology Updates:**

- Framework updates: Test thoroughly in staging
- Dependency updates: Security patches immediate, features quarterly
- API changes: Maintain backward compatibility for 2 versions
- Database migrations: Reversible and tested
