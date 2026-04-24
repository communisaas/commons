# Template Variable Roadmap

**Status**: Phase 1 (Simple Variables) ✅ IMPLEMENTED | Phase 2 (Data Providers) 🔮 FUTURE

---

## Phase 1: Simple, User-Driven Variables ✅ IMPLEMENTED

Our templates use straightforward placeholder variables that users understand and can fill in themselves:

- **Personal context**: `[Your Story]`, `[Your Connection]`, `[Your Experience]`
- **Local references**: `[Your City]`, `[Your District]`, `[Your Representative]`
- **Specific entities**: `[Company Name]`, `[University]`, `[Organization]`
- **Basic data**: `[Amount]`, `[Date]`, `[Location]`

These are intentionally simple. Users know their own context better than any API.

## Current Reality

### Variables in Templates:

```typescript
interface TemplateVariable {
	name: string; // [Your City]
	type: 'text' | 'number' | 'date' | 'select';
	required: boolean;
	placeholder?: string; // Help text for users
	validation?: RegExp; // Optional validation
}
```

### Resolution Strategy:

1. **User fills in** - They know their context
2. **Smart defaults** - Pre-fill from user profile when available
3. **Validation only** - Ensure format is correct
4. **No external APIs** - Keep it simple and reliable

## Implementation

### Variable Types

```typescript
type VariableType =
	| 'personal' // User's personal story/experience
	| 'location' // City, district, region
	| 'entity' // Company, organization name
	| 'numeric' // Amounts, quantities
	| 'temporal' // Dates, time periods
	| 'selection'; // Pre-defined options
```

### User Experience

1. **Template Selection** - User picks relevant template
2. **Variable Highlighting** - Clear visual indicators for fillable fields
3. **Inline Editing** - Click to edit directly in preview
4. **Smart Suggestions** - From user's profile/history
5. **Validation Feedback** - Immediate, helpful error messages

### Variable Processing

```typescript
interface VariableProcessor {
	extract(template: string): Variable[];
	validate(variable: Variable, value: string): ValidationResult;
	substitute(template: string, values: Map<string, string>): string;
	getSuggestions(variable: Variable, user: User): string[];
}
```

**Processing flow:**

1. Extract variables from template
2. Present fillable form to user
3. Validate input as user types
4. Substitute values into final message
5. Store for future reuse

### Smart Defaults

Pre-fill variables when possible:

```typescript
class SmartDefaults {
	getDefault(variable: Variable, user: User): string | undefined {
		switch (variable.type) {
			case 'location':
				return user.city || user.district;
			case 'representative':
				return user.representatives?.[0]?.name;
			case 'date':
				return new Date().toLocaleDateString();
			default:
				return undefined;
		}
	}
}
```

### Storage & Reuse

Save user's variable values for future use:

```typescript
interface SavedVariable {
	userId: string;
	variableName: string;
	value: string;
	templateId?: string;
	lastUsed: Date;
	useCount: number;
}
```

Benefits:

- Faster template sending
- Consistent messaging
- Personal variable library
- Privacy preserved (stored locally or encrypted)

---

## Phase 2: Data Provider Integration 🔮 FUTURE ROADMAP

Everything below this line represents future vision for verified data integration.

### Core Infrastructure (Planned)

**Files to create:**

- `src/lib/server/data-providers/`
  - `census.ts`—Census/ACS API
  - `bls.ts`—Bureau of Labor Statistics
  - `hud.ts`—HUD housing data
  - `civic.ts`—Google Civic Information
  - `cms.ts`—Healthcare provider data
  - `sec.ts`—Corporate information
  - `mit-living-wage.ts`: Living wage calculator

- `src/lib/server/variable-resolver.ts`: Main resolution engine
- `src/lib/server/agent-resolver.ts`: AI orchestration layer
- `src/lib/server/resolution-cache.ts`: Cache expensive API calls

### Database Schema Updates

```ts
// convex/schema.ts
resolvedVariables: defineTable({
  templateId: v.id("templates"),
  userId: v.id("users"),
  variable: v.string(),
  value: v.string(),
  source: v.any(),
  confidence: v.number(),
  resolvedAt: v.number(),
  expiresAt: v.number(),
}).index("by_template_user_variable", ["templateId", "userId", "variable"]);
```

### Testing Strategy

- Mock data providers for unit tests
- Integration tests with real APIs (rate limited)
- Agent safety tests (no hallucination)
- Fallback scenario coverage

## Priority Order

1. **Census/BLS integration**—Core economic data
2. **Google Civic API**—Elected officials
3. **HUD data**—Housing costs
4. **Healthcare providers**—CMS integration
5. **Corporate data**—SEC EDGAR
6. **University data**—IPEDS
7. **Living wage**—MIT calculator API
8. **Agent orchestration**—Tie it all together

## Success Metrics

- All template variables resolve or explicitly fail
- Every value has source attribution
- No hallucinated data ever
- Cache hit rate > 80% for common queries
- Resolution time < 2s for full template

## The Vision

User clicks "Send Message" and in milliseconds:

- Location determines relevant data sources
- Real rent prices, real wages, real officials
- Every number cited and verified
- Template becomes powerful truth-telling tool
- No bullshit, only facts

This is how we transform templates from aspirational placeholders into weapons of verified truth.

## Clojure-Inspired Functional Paradigm

The resolution system follows functional programming principles inspired by Clojure:

### Pure Functions

Each resolver is a pure function with no side effects:

```typescript
const rentResolver = compose(extractLocation, queryHUDData, formatCurrency, addSourceAttribution);
```

### Immutable Data Flow

Template resolution creates new data structures, never mutates:

```typescript
const resolved = template
  |> parseVariables
  |> mapResolvers
  |> awaitResolution
  |> applyToTemplate
```

### Lazy Evaluation

Variables resolve on-demand, not eagerly:

```typescript
const lazyResolvers = new Map(variables.map((v) => [v, () => resolveVariable(v)]));
```

### Composable Transformations

Complex resolutions built from simple functions:

```typescript
const livingWageResolver = pipe(
	getUserLocation,
	getFamilySize,
	queryMITCalculator,
	adjustForLocalCost,
	formatWithSource
);
```

This functional approach ensures:

- Predictable resolution behavior
- Easy testing of individual components
- Safe agent composition
- No hidden state or side effects
