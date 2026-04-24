# Legislative Abstraction Layer

> **STATUS: ASPIRATIONAL** — `src/lib/core/legislative/types.ts` foundation exists; adapter implementations (US Congress, UK Parliament, EU) are planned.

> ⚠️ **ADDENDUM (2026-04-23 audit) — what's actually in the repo, so
> nobody tries to import from it:**
>
> - Under `src/lib/core/legislative/`, **only `types.ts` exists**. There
>   is no `adapters/`, `registry.ts`, `base.ts`, `models/`,
>   `delivery/pipeline.ts`, or `resolution/variables.ts`. The
>   `adapterRegistry` shown in usage examples does not exist at runtime.
> - **Live US delivery is not routed through the abstraction.** CWC
>   submission lives in `convex/submissions.ts` + `convex/_cwcXml.ts`
>   (+ House proxy envs) and is gated by `FEATURES.CONGRESSIONAL=false`.
>   There is no `src/lib/core/legislative/adapters/us-congress.ts`.
> - **Location resolvers (postcode/ZIP → district) are live** for US,
>   CA, GB, AU at `src/lib/core/location/resolvers/*`. **Representative
>   lookup for CA/GB/AU is a stub**: `rep-lookup.ts:~26-34` returns
>   `[]`. US reps come through Census + Congress.gov helpers outside
>   any adapter pattern.
> - **Phantom API routes listed in §6** (`/api/address/lookup`,
>   `/api/submit`) are not in the codebase. Real endpoints:
>   `/api/location/resolve-address`, `/api/geographic/resolve`,
>   `/api/v1/representatives`, `/api/submissions/create`.
> - **Phantom component dirs** (`src/lib/components/landing/template/`,
>   `src/lib/components/template/`, `src/lib/components/submission/`)
>   do not exist. Template components live under
>   `src/lib/components/templates/`.
> - **Congressional_Office → Legislative_Office / Representative /
>   Jurisdiction migration is not underway.** External-API lookups on
>   demand is the current pattern; planned tables were never created.

---

**Governance-neutral infrastructure for delivering civic messages to any legislature worldwide.**

## Architecture Overview

The legislative abstraction layer separates civic action logic from country-specific delivery mechanisms. Users interact with a universal API, while adapters handle jurisdiction-specific requirements.

```
User Action
    ↓
Template System
    ↓
[Legislative Abstraction Layer]
    ├── Adapter Registry (country code → adapter)
    ├── Address Lookup (location → representatives)
    ├── Variable Resolution (template → personalized message)
    └── Delivery Pipeline (message → official submission)
```

## Core Components

### 1. Adapter Registry

**Location**: `src/lib/core/legislative/adapters/registry.ts`

Dynamically selects the correct adapter based on country code:

```typescript
const adapter = await adapterRegistry.getAdapter('US'); // Returns USCongressAdapter
const adapter = await adapterRegistry.getAdapter('UK'); // Returns UKParliamentAdapter
const adapter = await adapterRegistry.getAdapter('FR'); // Returns GenericLegislativeAdapter (fallback)
```

**Currently Registered**:
- `US` → USCongressAdapter (CWC API integration)
- `UK`, `GB` → UKParliamentAdapter (placeholder implementation)
- All others → GenericLegislativeAdapter (mailto fallback)

### 2. Base Adapter Interface

**Location**: `src/lib/core/legislative/adapters/base.ts`

All adapters implement the `LegislativeAdapter` abstract class:

```typescript
abstract class LegislativeAdapter {
  abstract readonly country_code: string;
  abstract readonly name: string;
  abstract readonly supported_methods: string[];

  // System information
  abstract getSystemInfo(): Promise<LegislativeSystem>;
  abstract getCapabilities(): Promise<DeliveryCapability>;

  // Representative lookup
  abstract lookupRepresentativesByAddress(address: Address): Promise<Representative[]>;
  abstract validateRepresentative(representative: Representative): Promise<boolean>;

  // Message delivery
  abstract deliverMessage(request: DeliveryRequest): Promise<DeliveryResult>;

  // Formatting utilities
  abstract formatRepresentativeName(rep: Representative): string;
  abstract formatOfficeTitle(office: Office): string;
}
```

### 3. Data Models

**Location**: `src/lib/core/legislative/models/index.ts`

Universal data structures across all legislative systems:

#### Representative
```typescript
interface Representative {
  id: string;
  office_id: string;
  name: string;
  party?: string;
  bioguide_id?: string;
  external_ids?: Record<string, string>;
  term_start?: Date;
  term_end?: Date;
  is_current: boolean;
}
```

#### Office
```typescript
interface Office {
  id: string;
  jurisdiction_id: string;
  role: string;
  title: string;
  chamber?: string;
  level: 'national' | 'state' | 'provincial' | 'municipal' | 'district';
  contact_methods: ContactMethod[];
  is_active: boolean;
}
```

#### LegislativeSystem
```typescript
interface LegislativeSystem {
  country_code: string;
  name: string;
  type: 'parliamentary' | 'congressional' | 'hybrid' | 'other';
  chambers: Chamber[];
  primary_language?: string;
  supported_languages?: string[];
}
```

### 4. Delivery Pipeline

**Location**: `src/lib/core/legislative/delivery/pipeline.ts`

Orchestrates the full message delivery flow:
1. Validate user and template data
2. Lookup representatives by address
3. Resolve template variables
4. Format message for delivery system
5. Submit through adapter-specific channels
6. Return delivery receipt

### 5. Variable Resolution

**Location**: `src/lib/core/legislative/resolution/variables.ts`

Handles template variable substitution:
- User-provided values (personal stories, local data)
- Auto-populated values (representative names, districts)
- Smart defaults from user profile

## Implemented Adapters

### US Congress Adapter ✅

**Location**: `src/lib/core/legislative/adapters/us-congress.ts`

**Integration**: Communicating with Congress (CWC) API

**Features**:
- Census Bureau Geocoding API for address → congressional district
- Congress.gov API for representative lookup
- CWC XML generation and submission
- Certified delivery receipts
- Support for House + Senate

**CWC Integration Details**: See `src/lib/core/legislative/adapters/cwc/`
- `cwcAdapter.ts` - Main CWC API client
- `xmlBuilder.ts` - XML payload generation
- `fieldMapper.ts` - Field validation and mapping
- `types.ts` - CWC-specific type definitions

### UK Parliament Adapter 🔧

**Location**: `src/lib/core/legislative/adapters/uk-parliament.ts`

**Status**: Placeholder implementation (not yet functional)

**Planned Features**:
- Postcode → constituency lookup
- MP contact form integration
- House of Commons + House of Lords support

### Generic Adapter 🔮

**Location**: `src/lib/core/legislative/adapters/generic.ts`

**Fallback**: Mailto-based delivery for unsupported countries

Opens user's email client with pre-filled message. No certified delivery.

## Usage Example

```typescript
import { adapterRegistry } from '$lib/core/legislative/adapters/registry';

// Get adapter for user's country
const adapter = await adapterRegistry.getAdapter(user.country_code);

// Lookup representatives
const representatives = await adapter.lookupRepresentativesByAddress({
  street: user.address,
  city: user.city,
  state: user.state,
  postal_code: user.zip,
  country_code: user.country_code
});

// Deliver message
const result = await adapter.deliverMessage({
  template: resolvedTemplate,
  user: user,
  representative: representatives[0],
  office: representatives[0].offices[0],
  personalized_message: finalMessage
});

if (result.success) {
  console.log('Message delivered:', result.message_id);
}
```

## Adding New Adapters

To add support for a new country:

1. **Create adapter class**:
```typescript
// src/lib/core/legislative/adapters/canadian-parliament.ts
import { LegislativeAdapter } from './base';

export class CanadianParliamentAdapter extends LegislativeAdapter {
  readonly country_code = 'CA';
  readonly name = 'Canadian Parliament';
  readonly supported_methods = ['api', 'email'];

  async getSystemInfo(): Promise<LegislativeSystem> {
    return {
      country_code: 'CA',
      name: 'Parliament of Canada',
      type: 'parliamentary',
      chambers: [
        { name: 'House of Commons', type: 'lower', seat_count: 338 },
        { name: 'Senate', type: 'upper', seat_count: 105 }
      ]
    };
  }

  // Implement other required methods...
}
```

2. **Register in registry**:
```typescript
// src/lib/core/legislative/adapters/registry.ts
this.adapters.set('CA', new CanadianParliamentAdapter());
```

3. **Add tests**:
```typescript
// tests/integration/legislative-canada.test.ts
describe('Canadian Parliament Adapter', () => {
  it('should lookup MPs by postal code', async () => {
    // Test implementation
  });
});
```

## Delivery Capabilities

Each adapter reports its capabilities:

```typescript
interface DeliveryCapability {
  country_code: string;
  methods: ('email' | 'form' | 'api' | 'postal')[];
  tier: number; // 1=direct API, 2=form/scraping, 3=mailto fallback
  certified_delivery?: boolean;
  delivery_receipt?: boolean;
  address_validation?: boolean;
}
```

**Tier 1** (Best): Direct API integration with certified delivery (US Congress CWC)
**Tier 2** (Good): Form submission or scraping with delivery confirmation
**Tier 3** (Basic): Mailto fallback, no verification

## Integration Points

### Frontend Components
- Template selection: `src/lib/components/landing/template/`
- Message composition: `src/lib/components/template/`
- Submission UI: `src/lib/components/submission/`

### API Endpoints
- Address lookup: `/api/address/lookup`
- Representative search: `/api/user/representatives`
- Message submission: `/api/submit` (calls delivery pipeline)

### Data Model
All data structures live in `convex/schema.ts`:
- `representatives` table (current) — flattened bioguide + office contact info.
- Planned: a unified `legislativeOffices`, `representatives`, `jurisdictions` split when the abstraction layer is built out (see §Roadmap).

## Roadmap

**Near Term**:
- Complete UK Parliament adapter with real API integration
- Add Canadian Parliament adapter
- Migrate US adapter to new unified schema

**Medium Term**:
- European Parliament integration
- Australian Parliament
- Westminster-based countries (New Zealand, India)

**Long Term**:
- Municipal/local government adapters
- State/provincial legislatures
- International organizations (UN, EU)

## References

- **CWC API Documentation**: See `docs/congressional/cwc-integration.md`
- **Governance Adapters Vision**: See `docs/governance-adapters.md`
- **Code Location**: `src/lib/core/legislative/`

---

This abstraction layer enables Commons to scale globally while maintaining a simple, consistent user experience across all legislative systems.
