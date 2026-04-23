# Supporter Import Architecture

> **STATUS: CSV shipped — Action Network connector is state-only (no worker).**

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** CSV path is production-ready
> and ~85% of this spec is accurate against code. Concrete corrections:
>
> - **Action Network OSDI sync is NOT operational.** The `anSync` object
>   on `organizations` stores API key, `status`, `syncType`,
>   `totalResources`, `processedResources`, `currentResource`, and
>   counters; the `connectAnSync` / `startAnSync` / `disconnectAnSync`
>   mutations set state, but **no background worker consumes it** —
>   there is no job that actually calls the AN OSDI API, paginates
>   `people`, `taggings`, or `action_history`. Treat §2.2 as a design
>   target. Orgs must export CSV from AN for now.
> - **SMS phone filtering via `smsStatus` is unwired.** Schema field
>   exists; `updateSmsStatus` enforces STOP keyword; **no segment
>   filter / list query** actually scopes recipients by `smsStatus`.
>   Per implementation-status.md known-gaps table.
> - **Dedup key is `(orgId, emailHash)`**, not `(orgId, email)`.
>   Email addresses are never stored in plaintext; the indexed column
>   is `emailHash`, an org-scoped salted hash of the normalized email
>   (`computeOrgScopedEmailHash(orgId, normalizedEmail)`, index
>   `by_orgId_emailHash` on supporters).
> - **Encryption happens server-side in the Convex action layer.** The
>   `importWithEncryption` action accepts plaintext PII, unseals the
>   org key in the action, encrypts per-field with entity-bound AAD,
>   and stores ciphertext. The "client encrypts before upload" framing
>   (if read into any section) is wrong.
> - **CSV field mapping accepts more aliases than the spec lists.**
>   Live aliases include `sms_consent` / `can_text` / `sms_status` /
>   `sms_opt_in` / `can_message` (SMS consent + email opt-out
>   inference) and `country` (location). `Subscription Status` is
>   inferred from `can_message` (false/0/no → unsubscribed) rather
>   than a direct column.

**Status:** Shipped
**Author:** Architecture
**Created:** 2026-03-06
**Updated:** 2026-03-13
**Depends on:** Org Data Model, List Management, Campaign System, Shadow Atlas, ZK Identity
**Research:** `docs/research/action-network-migration-research.md`

**Status:** Shipped
**Author:** Architecture
**Created:** 2026-03-06
**Updated:** 2026-03-13
**Depends on:** Org Data Model, List Management, Campaign System, Shadow Atlas, ZK Identity
**Research:** `docs/research/action-network-migration-research.md`

---

## Problem

An advocacy org has 40,000 supporters on another platform. They've seen what verified constituent messages do to a staffer's attention. They want to move. The question is not "why switch" — the verification packet answers that. The question is "how do I bring my people without losing years of organizing history?"

Every competitor answers this question with "export CSV, import CSV, rebuild everything." That's a 6-month project. Most orgs never start.

This spec defines an import architecture with two tiers:

1. **CSV upload** — the universal path. Works for any platform, any data source, any org. Drag-drop, field mapping, done.
2. **Platform connectors** — accelerators for specific platforms. Automated API sync, incremental updates, richer data extraction. Action Network is the first connector; the architecture supports adding others (EveryAction, NationBuilder, etc.) as demand warrants.

Both paths feed the same canonical importer. The import is:
- **Incremental** — run both systems in parallel, move supporters in waves
- **Data-complete** — action history, tags, subscription state, custom fields all transfer
- **Verification-additive** — imported data arrives unverified; the system progressively layers verification onto imported supporters as they take their first verified action
- **Reversible** — org can export everything back out at any time, in any format

---

## 1. What Moves, What Doesn't

### Portable (Commons imports)

| Source Resource | Commons Destination | Notes |
|---|---|---|
| Contacts / people | `Supporter` | Email, name, postal code, phone, custom fields, subscription status |
| Tags / lists | `Tag` | Flat string mapping, preserved exactly |
| Custom fields | `Supporter.customFields` | JSON blob, schema preserved |
| Petitions (metadata) | `Campaign` (type: LETTER) | Title, description, target. Signatures become action history. |
| Events (metadata) | `Campaign` (type: EVENT) | Title, description, location, date. RSVPs become action history. |
| Advocacy campaigns | `Campaign` (type: LETTER) | Title, targets, letter template |
| Forms | `Campaign` (type: FORM) | Title, description, custom fields |
| Action history | `SupporterAction` | Who signed/attended/submitted/donated, when, which action |
| Subscription status | `Supporter.emailStatus` | subscribed / unsubscribed / bounced / complained — **must preserve exactly** |
| Email statistics | `ImportedEmailStats` | Aggregate per-message: sent, opens, clicks, bounces. For historical reference only. |

### Not portable (rebuilt or abandoned)

| Resource | Why | Mitigation |
|---|---|---|
| Automation workflows | Platform-specific, not exportable via API or UI | Org rebuilds in Commons automation |
| Email HTML templates | API returns content but not design | Org re-creates in Commons WYSIWYG editor |
| Embedded page JS/CSS | Platform-hosted, not exportable | Commons provides equivalent embeddable widgets |
| Payment processor tokens | Processor-specific, not portable | Recurring donors re-authorize via Stripe |
| Page analytics (per-page) | Limited export | Historical stats imported as reference |
| Proprietary ML scores | Platform-specific add-ons | Engagement tiers replace predictions with non-fakeable signal |

---

## 2. Import Architecture

### 2.1 Two Import Tiers

**Tier 1: CSV Upload (any org, any source platform)**

The org exports CSVs from their current platform's report builder or admin UI. Commons ingests them.

```
Org exports from source platform:
  Contact report (all contacts)      → supporters.csv
  Per-action reports (signatures,    → action-history/*.csv
    attendances, submissions, etc.)
  Email statistics                   → email-stats.csv

Org uploads to Commons:
  /admin/import → drag-drop CSV → field mapping UI → preview → import
```

Field mapping is semi-automatic. Commons recognizes common column names (`Email Address`, `First Name`, `Postal Code`, `Tags`, `Subscription Status`) and maps them. Custom fields appear as unmapped — org assigns them.

**Tier 2: Platform Connectors (automated API sync)**

Platform connectors extract directly from source platform APIs. The org provides their API credentials.

#### Action Network Connector

The first platform connector. AN uses the OSDI standard (HAL+JSON).

```
Org enters AN API key in /admin/import/action-network
  → Commons paginates all resources (4 req/sec, 25/page)
  → Full extraction: ~90-120 min for 100K contacts + 200 actions
  → Progress bar with resource-level status
  → Incremental: re-run syncs only modified_date > last_sync
```

API sync is the premium path. It captures everything CSV cannot: full per-person action history across all action types, reconstructed into a unified timeline.

#### Adding Future Connectors

The connector architecture is straightforward: implement the extraction interface (paginate resources, map to canonical schema, support incremental sync via timestamp filter). Candidates include EveryAction (SOAP/REST hybrid), NationBuilder (REST + webhooks), and Mailchimp (REST). Each connector is a separate module feeding the same canonical importer.

### 2.2 Import Pipeline

```
                    CSV Upload           Platform Connector
                        |                       |
                        v                       v
                 ┌──────────────┐    ┌──────────────────┐
                 │ Field Mapper │    │  API Extractor    │
                 │ (UI-assisted)│    │ (background job)  │
                 └──────┬───────┘    └────────┬─────────┘
                        |                      |
                        v                      v
                 ┌─────────────────────────────────┐
                 │        Canonical Importer         │
                 │                                   │
                 │  1. Dedup on email (per-org)       │
                 │  2. Preserve subscription status   │
                 │  3. Map tags (create if new)       │
                 │  4. Store custom fields as JSON    │
                 │  5. Create SupporterAction records │
                 │  6. Flag: imported = true          │
                 │  7. Flag: verified = false         │
                 └──────────────┬────────────────────┘
                                |
                                v
                 ┌──────────────────────────┐
                 │   Supporter (imported)    │
                 │                           │
                 │   email: jane@example.com │
                 │   source: 'action_network'│
                 │   imported_at: timestamp  │
                 │   verified: false         │
                 │   engagement_tier: null   │
                 │   identity_commitment: null│
                 └──────────────────────────┘
```

The `source` field records the origin platform (e.g., `action_network`, `nationbuilder`, `csv_upload`, `everyaction`). This enables per-source analytics and segment filtering.

### 2.3 Subscription Status Preservation

**This is the hardest constraint.** CAN-SPAM and CASL require that unsubscribe/bounce/complaint status carry across platforms. If someone unsubscribed on their previous platform, they are unsubscribed on Commons. Period.

```typescript
type EmailStatus = 'subscribed' | 'unsubscribed' | 'bounced' | 'complained';

// Import rule: strictest status wins
function resolveEmailStatus(sourceStatus: string, existingStatus?: EmailStatus): EmailStatus {
  const severity: Record<EmailStatus, number> = {
    'subscribed': 0,
    'unsubscribed': 1,
    'bounced': 2,
    'complained': 3    // complaint = permanent suppression
  };

  const mapped = mapSourceStatus(sourceStatus);  // normalize platform-specific strings
  if (!existingStatus) return mapped;
  return severity[mapped] > severity[existingStatus] ? mapped : existingStatus;
}
```

Subscribers who bounced or complained on their previous platform are permanently suppressed on Commons. This protects the org's sender reputation on SES.

### 2.4 Deduplication

Dedup key: `(orgId, email)`. If a supporter already exists (from a previous import or organic signup), the import merges:

- Tags: union (additive, never removes existing tags)
- Custom fields: merge (import values fill nulls, don't overwrite existing)
- Action history: union (deduplicated by action + timestamp)
- Subscription status: strictest wins (see above)
- Name, postal code: import fills nulls, doesn't overwrite

---

## 3. The Verification Bridge

This is where import becomes transformation. Imported supporters arrive as unverified rows. Commons progressively layers verification as supporters engage.

### 3.1 Imported Supporter States

```
IMPORTED (tier null)
  │
  │  Supporter receives first Commons campaign email
  │  Clicks action link
  │  Enters postal code on campaign page
  │
  ├─→ POSTAL-RESOLVED (tier 0: New)
  │     Postal Bubble renders district(s)
  │     identityCommitment: null
  │     Districts: resolved from postal code
  │
  │  Supporter optionally scans mDL
  │
  └─→ VERIFIED (tier 0+)
        mDL → identity commitment → ZK proof
        identityCommitment: set
        Districts: cryptographically proven
        Engagement tier: 0 (New), progresses with actions
```

The org's dashboard shows this progression:

```
SUPPORTER VERIFICATION STATUS
─────────────────────────────
Total imported:     40,000
Postal-resolved:     8,247  (20.6%)
Fully verified:      1,834  ( 4.6%)

Tier distribution (verified only):
  New (0):          1,412
  Active (1):         318
  Established (2):     89
  Veteran (3):         15
  Pillar (4):           0
```

This is the import's value proposition visualized. The org watches their unverified list transform into a verified constituency — and the verification packet they can send to decision-makers grows with every supporter who takes a verified action.

### 3.2 Imported Action History and Engagement Credit

Imported action history represents real civic labor. A supporter who signed 47 petitions and attended 12 events on another platform has demonstrated engagement — but it's unverified.

**Design decision: imported actions do NOT count toward engagement tier.**

Engagement tiers are protocol-level, on-chain, nullifier-verified. Imported CSV rows are not. Granting tier credit for unverified data would compromise the invariant that tiers represent cryptographically proven civic labor.

What imported history DOES provide:
- **Context for the org:** "This supporter was highly active on their previous platform" informs targeting
- **Motivation signal:** Show the supporter their history and what tier they'd reach with verified actions: "You took 47 actions previously. 5 verified actions on Commons would make you Active (tier 1)."
- **Segment filter:** `source: 'action_network'` + `imported_action_count > 10` identifies power users for priority outreach

### 3.3 The First Verified Action

The moment an imported supporter takes their first verified action on Commons, they cross the bridge:

1. Supporter clicks campaign link in org email
2. Enters postal code → Postal Bubble renders district(s)
3. Optionally scans mDL → identity commitment generated
4. Sends verified letter → ZK proof → on-chain → nullifier recorded
5. `Supporter.identityCommitment` set (links to ZK identity layer)
6. `Supporter.verified = true`
7. Engagement tier: 0 (New) — first on-chain action
8. Verification packet for this campaign now includes this supporter

The org watches: one more row moves from "imported" to "verified." The verification packet grows. The imported list is becoming a verified constituency.

---

## 4. Parallel Operation

Most orgs can't cut over instantly. They need to run their old platform and Commons in parallel during transition. This spec supports three parallel operation modes.

### 4.1 Shadow Mode (weeks 1-4)

- Import data into Commons
- Org continues sending from their current platform
- Commons dashboard shows imported data but org doesn't send from Commons yet
- Org explores: creates test campaigns, previews verification packets
- No risk — the current platform is still primary

### 4.2 Split Mode (weeks 4-12)

- Org sends some campaigns from their old platform, some from Commons
- New supporters added to Commons directly (via embeddable widgets on org website)
- Periodic re-sync (if using a platform connector) captures new signups on the old platform
- Org compares: old platform campaign metrics vs. Commons verified campaign metrics

### 4.3 Primary Mode (weeks 12+)

- Commons is primary sending platform
- Old platform kept read-only for historical reference
- Org updates embedded action pages to Commons widgets
- Remaining old-platform-only supporters get "welcome to Commons" email with first verified action CTA

### 4.4 Incremental Re-Sync (Platform Connectors)

For API-connected orgs, Commons supports incremental sync:

```
GET /api/v2/people?filter=modified_date gt '2026-03-01'

→ Only fetch people modified since last sync
→ Merge into existing Supporter records
→ New signups on old platform appear in Commons within sync interval
→ Default interval: daily (configurable)
```

This means the org doesn't have to choose a hard cutover date. Supporters flow from the old platform to Commons continuously until the old platform is decommissioned.

---

## 5. Embedded Page Replacement

Embedded action pages are a major lock-in vector for platforms like Action Network. Orgs have iframes scattered across their website — petition pages, event RSVPs, letter campaigns.

### 5.1 Commons Embeddable Widget

```html
<!-- Platform embed (current — e.g., Action Network) -->
<div id="can-petition-area-xyz"></div>
<script src="https://actionnetwork.org/widgets/v5/petition/xyz"></script>

<!-- Commons embed (replacement) -->
<iframe
  src="https://commons.email/embed/campaign/[slug]"
  style="width:100%;border:none;min-height:400px"
  loading="lazy"
></iframe>
```

The Commons embed provides:
- Postal code entry → Postal Bubble district resolution
- Optional mDL verification
- Letter/petition/event action
- Verified action count (ticking, spring physics, mono font)
- postMessage API for parent page integration

### 5.2 Redirect Strategy

For orgs with hundreds of embedded pages, Commons provides a redirect mapping:

```
/admin/import/redirects

Old URL                                         → Commons URL
actionnetwork.org/petitions/climate-bill-2026   → commons.email/s/climate-bill-2026
actionnetwork.org/events/town-hall-march-15     → commons.email/s/town-hall-march-15
```

The org updates their website embeds over time. For social media links that can't be updated (shared on Twitter/Facebook months ago), the org can set up server-side redirects from their own domain.

---

## 6. Data Export (Reversibility)

Commons is not a roach motel. Everything in, everything out.

### 6.1 Full Export

`/admin/export` produces:

```
commons-export-2026-03-06/
  supporters.csv              # All supporters with all fields
  tags.csv                    # Tag definitions
  supporter-tags.csv          # Tag assignments
  campaigns.csv               # Campaign metadata
  actions.csv                 # Full action history (all types, unified)
  email-stats.csv             # Per-campaign email metrics
  custom-fields-schema.json   # Custom field definitions
  verification-summary.json   # Verification stats (no PII)
```

### 6.2 API Export

RESTful API, free on all tiers, no rate cap. Every resource that can be imported can be exported. OSDI-compatible response format available for orgs migrating TO another OSDI-compatible system.

### 6.3 The Asymmetry

What Commons exports that no other platform can:
- **Verification status** per supporter (verified / postal-resolved / imported)
- **Engagement tier** per supporter (on-chain, non-fakeable)
- **Coordination integrity scores** per campaign (GDS, ALD, temporal entropy)
- **Debate market outcomes** per campaign (consensus, winning arguments, scores)

This data is portable but not reproducible elsewhere. An org that leaves Commons loses the verification layer — but they keep a record of what was verified.

---

## 7. Import UI

### 7.1 Import Dashboard

```
/admin/import
───────────────────────────────────────────────

  Import Supporters

  ┌─────────────────────────────────────────┐
  │                                         │
  │   [CSV Upload]     [Action Network]     │
  │                                         │
  │   Drop CSV files   Connect via API      │
  │   or click to      for automated        │
  │   browse            extraction           │
  │                                         │
  │   Works with any   More connectors      │
  │   platform export  coming soon          │
  │                                         │
  └─────────────────────────────────────────┘

  Previous imports:

  Source              Records   Date         Status
  ─────────────────────────────────────────────────
  action_network      40,247   2026-03-01   Complete
    └ incremental      1,834   2026-03-06   Complete
  csv_upload           2,100   2026-02-15   Complete
```

### 7.2 Field Mapping (CSV path)

```
/admin/import/map
───────────────────────────────────────────────

  Map Fields                          supporters.csv

  Source Column            →    Commons Field
  ─────────────────────────────────────────
  Email Address            →    email           (auto)
  First Name               →    firstName       (auto)
  Last Name                →    lastName        (auto)
  Zip Code                 →    postalCode      (auto)
  Phone Number             →    phone           (auto)
  Tags                     →    tags            (auto)
  Subscription Status      →    emailStatus     (auto)
  Custom: Org Role         →    [select field ▼]
  Custom: Chapter          →    [select field ▼]

  [Preview 25 rows]  [Import 40,247 records →]
```

### 7.3 Verification Progress

The org's dashboard shows import health alongside verification progress. This is not a separate "import" tab — it's integrated into the primary dashboard because verification IS the dashboard.

```
/admin/dashboard
───────────────────────────────────────────────

  Supporters                    Verification

  40,247 total                  1,834 verified (4.6%)
  38,413 imported               8,247 postal-resolved (20.5%)
   1,834 organic                  ▓▓░░░░░░░░░░░░░░░░░░

  Tier Distribution (verified)

   0 New          1,412  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
   1 Active         318  ▓▓▓▓
   2 Established     89  ▓
   3 Veteran         15  ░
   4 Pillar           0

  Next milestone: 2,000 verified (166 to go)
  At current rate: ~12 days
```

---

## 8. Implementation Sequence

### Wave 1: CSV Import (P0)

- `SupporterImport` model: tracks import batches
- CSV parser with common column name recognition
- Field mapping UI
- Dedup on (orgId, email)
- Subscription status preservation
- Tag import (create-if-new)
- Custom field JSON storage

### Wave 2: Action Network Connector (P0)

- AN API client (OSDI, HAL+JSON, pagination)
- Background job: full extraction with progress tracking
- Incremental sync (modified_date filter)
- Rate limiting (4 req/sec)
- Action history reconstruction (per-person unified timeline)

### Wave 3: Embeddable Widgets (P1)

- `/embed/campaign/[slug]` route
- iframe + postMessage API
- Postal Bubble integration
- Verified action count display
- Widget customization (colors, size)

### Wave 4: Export (P1)

- Full CSV export (all resources)
- API export endpoints
- OSDI-compatible response format option
- Verification data in exports

### Wave 5: Additional Platform Connectors (P2)

- Connector interface formalized
- EveryAction connector (if demand warrants)
- NationBuilder connector (if demand warrants)
- Mailchimp connector (contact-only, no campaign history)

### Wave 6: Automation Migration Guide (P2)

- Documentation: mapping platform automation workflows to Commons event-driven workflows
- Template library: common automation patterns (welcome series, engagement escalation)
- Not automated — orgs rebuild manually with guidance

---

## 9. Open Questions

1. **Should Commons charge for platform connectors?** CSV import is free on all tiers. API sync via connectors is more valuable (automated, incremental, complete). Could be a Starter+ feature. But migration friction should be as low as possible — maybe free for first 90 days.

2. **API key security.** The org enters their source platform API key into Commons. Commons stores it encrypted for incremental sync. Should there be a "sync once and delete key" option for orgs uncomfortable with ongoing API access?

3. **Imported supporter notifications.** When an imported supporter takes their first verified action, should the org get a notification? ("Jane Doe just verified — she was a power user on her previous platform with 47 actions.") This is valuable but risks re-identifying supporters.

4. **Historical email metrics.** Source platform email stats (opens, clicks, bounces) are imported for historical reference. Should they appear in the Commons analytics dashboard or in a separate "import history" view? Mixing verified and unverified metrics could confuse the dashboard.

5. **Cross-org dedup.** If Sierra Club and NRDC both import from the same source platform, the same supporter may exist in both orgs. This is correct (org-scoped). But when that supporter verifies, their identity commitment is protocol-level. Should protocol-level dedup surface to the org? Probably not — the org sees their own supporter list, not the protocol's identity set.
