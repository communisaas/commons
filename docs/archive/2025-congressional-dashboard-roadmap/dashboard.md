# Congressional Dashboard Implementation Plan

**Timeline:** Week 15-16 (immediately before Phase 2 launch)
**Purpose:** Give congressional offices a dedicated interface to manage constituent messages from Commons
**Status:** Not started - detailed plan for future implementation

---

## Executive Summary

Congressional offices need a **dedicated dashboard** separate from the public template interface. This allows staff to:

1. **Authenticate** with official `.senate.gov` / `.house.gov` email addresses
2. **View incoming messages** from verified constituents via CWC API
3. **Filter and search** messages by topic, district, verification status
4. **Track metrics** on constituent engagement and template adoption
5. **Export data** for integration with existing constituent management systems

**Key insight:** This is a **B2B product** for congressional staff, not the B2C template creator interface. Design for professional workflow efficiency, not consumer engagement.

---

## Architecture

### Authentication Flow

```
Congressional Staff
  ↓
  enters @senate.gov / @house.gov email
  ↓
  receives verification link via email
  ↓
  clicks link → creates session
  ↓
  Dashboard access granted
```

**Security requirements:**
- Email domain validation (only `.senate.gov`, `.house.gov`, `.gov` whitelisted domains)
- Magic link authentication (no passwords - staff use existing email security)
- Session management via `@oslojs/crypto` (same as public interface)
- Rate limiting on email sends (prevent abuse)

**Backend tables (`convex/schema.ts`):**

```ts
congressionalUsers: defineTable({
  email: v.string(),            // .senate.gov / .house.gov
  emailVerified: v.boolean(),
  officeType: v.string(),       // 'senate' | 'house' | 'governor' | 'state_leg'
  state: v.string(),            // Two-letter state code
  district: v.optional(v.string()), // House district number
  officeName: v.optional(v.string()),
  lastLogin: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_email", ["email"])
  .index("by_state_district", ["state", "district"]);

congressionalSessions: defineTable({
  userId: v.id("congressionalUsers"),
  token: v.string(),
  expiresAt: v.number(),
  createdAt: v.number(),
})
  .index("by_token", ["token"])
  .index("by_expires", ["expiresAt"]);
```

---

## Dashboard UI Components

### 1. Message Inbox (`/dashboard/congressional/inbox`)

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ Congressional Dashboard - Office of Sen. Jane Smith (CA)    │
├─────────────────────────────────────────────────────────────┤
│ [All] [Unread: 47] [Flagged] [Archived]                   │
│                                                             │
│ Filters:                                                    │
│ [Topic: All ▼] [District: All ▼] [Date: Last 30 days ▼]  │
│ [Verified Only ✓] [High Priority Only]                     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ★ Climate Action Now Act - Support Requested            │ │
│ │ From: 234 verified constituents | CA-12                 │ │
│ │ Template: "Support H.R. 1234 Climate Action"            │ │
│ │ Sent: 2h ago | Priority: High                           │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Healthcare Reform - Expand Medicare Coverage            │ │
│ │ From: 89 verified constituents | CA-12                  │ │
│ │ Template: "Medicare Dental & Vision Coverage"           │ │
│ │ Sent: 5h ago | Priority: Medium                         │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [Load More] [Export CSV] [Mark All Read]                   │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- **Aggregation by template** - Show "234 constituents sent this message" instead of 234 individual rows
- **Unread count badge** - Real-time updates via WebSocket or polling
- **Filtering** - Topic, district, date range, verification status
- **Flagging** - Staff can flag high-priority messages
- **Archiving** - Remove from inbox without deleting

**API endpoint:**
```typescript
GET /api/congressional/messages?state=CA&district=12&status=unread&limit=50
```

**Response:**
```json
{
  "messages": [
    {
      "id": "msg_abc123",
      "template_id": "tpl_xyz789",
      "template_title": "Support H.R. 1234 Climate Action",
      "category": "Environment",
      "constituent_count": 234,
      "verified_count": 234,
      "district": "CA-12",
      "latest_sent_at": "2025-10-22T14:30:00Z",
      "priority": "high",
      "is_read": false,
      "is_flagged": false
    }
  ],
  "total": 47,
  "unread_count": 47
}
```

---

### 2. Message Detail View (`/dashboard/congressional/messages/[id]`)

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ ← Back to Inbox                                             │
├─────────────────────────────────────────────────────────────┤
│ Support H.R. 1234 Climate Action Now Act                    │
│ Category: Environment | Priority: High                      │
│                                                             │
│ 234 verified constituents from CA-12 sent this message      │
│ Latest: 2 hours ago | First: 3 days ago                     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Message Content:                                            │
│                                                             │
│ Dear Senator Smith,                                         │
│                                                             │
│ I am writing to urge your support for H.R. 1234, the       │
│ Climate Action Now Act. As a resident of San Francisco,    │
│ I have witnessed firsthand the impacts of climate change.  │
│                                                             │
│ This legislation would:                                     │
│ - Reduce carbon emissions by 50% by 2030                   │
│ - Create green jobs in our community                       │
│ - Protect our environment for future generations           │
│                                                             │
│ Please vote YES on this critical bill.                     │
│                                                             │
│ Thank you for your time.                                    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Constituent Demographics:                                   │
│ Total: 234 | Verified: 234 (100%)                          │
│ Districts: CA-12 (100%)                                     │
│ Age range: 18-65+ (distribution chart)                     │
│ Engagement: 89% first-time senders, 11% repeat senders     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ [Mark as Read] [Flag] [Archive] [Export Details]           │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- Full message body display
- Constituent count aggregation
- Demographic breakdown (age, district, verification status)
- Timeline of when messages were sent
- Export individual message details

---

### 3. Analytics Dashboard (`/dashboard/congressional/analytics`)

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ Congressional Analytics - Office of Sen. Jane Smith (CA)    │
├─────────────────────────────────────────────────────────────┤
│ Overview (Last 30 days):                                    │
│                                                             │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│ │   3,482     │ │   98.2%     │ │    47       │           │
│ │ Total Msgs  │ │  Verified   │ │ Templates   │           │
│ └─────────────┘ └─────────────┘ └─────────────┘           │
│                                                             │
│ Message Volume Over Time:                                   │
│ [Line chart showing daily message volume]                   │
│                                                             │
│ Top Issues (by message count):                             │
│ 1. Climate Action (1,234 messages)                         │
│ 2. Healthcare Reform (892 messages)                        │
│ 3. Education Funding (567 messages)                        │
│ 4. Immigration Policy (421 messages)                       │
│ 5. Economic Policy (368 messages)                          │
│                                                             │
│ Template Adoption:                                          │
│ [Bar chart showing most-used templates]                    │
│                                                             │
│ Constituent Engagement:                                     │
│ - First-time senders: 76%                                  │
│ - Repeat senders: 24%                                      │
│ - Average messages per constituent: 1.3                    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ [Export Full Report] [Download CSV] [Share Analytics]      │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- Message volume trends
- Top issues by category
- Template adoption metrics
- Constituent engagement patterns
- Export to CSV for integration with existing tools

**API endpoint:**
```typescript
GET /api/congressional/analytics?state=CA&district=12&period=30d
```

**Response:**
```json
{
  "period": {
    "start": "2025-09-22T00:00:00Z",
    "end": "2025-10-22T23:59:59Z"
  },
  "totals": {
    "message_count": 3482,
    "verified_count": 3419,
    "verification_rate": 0.982,
    "template_count": 47,
    "constituent_count": 2683
  },
  "volume_by_day": [
    { "date": "2025-10-22", "count": 156 },
    { "date": "2025-10-21", "count": 143 }
  ],
  "top_issues": [
    { "category": "Environment", "count": 1234, "templates": 12 },
    { "category": "Healthcare", "count": 892, "templates": 8 }
  ],
  "engagement": {
    "first_time_senders": 0.76,
    "repeat_senders": 0.24,
    "avg_messages_per_constituent": 1.3
  }
}
```

---

## Implementation Tasks (Week 15-16)

### Week 15: Authentication + Inbox

**Database & Backend:**
- [ ] Define `congressionalUsers` and `congressionalSessions` tables in `convex/schema.ts`
- [ ] Implement email domain validation (`.senate.gov`, `.house.gov` whitelist)
- [ ] Build magic link authentication system
- [ ] Create session management with `@oslojs/crypto`
- [ ] Rate limiting for email sends (5 per hour per IP)

**API Endpoints:**
- [ ] `POST /api/congressional/auth/request-link` - Send magic link
- [ ] `GET /api/congressional/auth/verify?token=...` - Verify and create session
- [ ] `GET /api/congressional/messages` - Fetch inbox messages
- [ ] `PATCH /api/congressional/messages/:id/read` - Mark as read
- [ ] `PATCH /api/congressional/messages/:id/flag` - Flag message

**UI Components:**
- [ ] `CongressionalLogin.svelte` - Email entry + magic link flow
- [ ] `CongressionalNav.svelte` - Dashboard navigation
- [ ] `MessageInbox.svelte` - Message list with filters
- [ ] `MessageCard.svelte` - Individual message preview
- [ ] `FilterBar.svelte` - Topic, district, date filters

**Testing:**
- [ ] Integration tests for magic link auth
- [ ] Test email domain validation
- [ ] Test message aggregation by template
- [ ] Test filtering and search

---

### Week 16: Message Detail + Analytics

**API Endpoints:**
- [ ] `GET /api/congressional/messages/:id` - Full message details
- [ ] `GET /api/congressional/analytics` - Analytics dashboard data
- [ ] `GET /api/congressional/export/csv` - Export messages to CSV

**UI Components:**
- [ ] `MessageDetail.svelte` - Full message view
- [ ] `ConstituentDemographics.svelte` - Age, district breakdown
- [ ] `AnalyticsDashboard.svelte` - Charts and metrics
- [ ] `VolumeChart.svelte` - Message volume over time (Chart.js)
- [ ] `TopIssuesChart.svelte` - Category breakdown

**Data Aggregation:**
- [ ] Aggregate messages by template ID
- [ ] Calculate verification rates
- [ ] Generate time-series data for charts
- [ ] Build CSV export pipeline

**Testing:**
- [ ] E2E test for full dashboard flow (Playwright)
- [ ] Test analytics calculations
- [ ] Test CSV export format
- [ ] Test real-time updates (if using WebSocket)

---

## Technical Stack

**Frontend:**
- SvelteKit 5 + Runes
- Tailwind CSS + shadcn-svelte UI components
- Chart.js for analytics visualizations
- `@sveltejs/enhanced-img` for optimized images

**Backend:**
- SvelteKit API routes / Convex functions
- Convex reactive database (queries, mutations, actions)
- `@oslojs/crypto` for session management
- `nodemailer` for magic link emails

**Database:**
- Convex (existing)
- New tables: `congressionalUsers`, `congressionalSessions`
- Indexes on `email`, `state`, `district`, `expiresAt`

**Email Service:**
- AWS SES (already configured for CWC delivery)
- Magic link template with office branding
- Rate limiting to prevent abuse

---

## Security Considerations

### Email Domain Validation

**Whitelist approach:**
```typescript
const ALLOWED_DOMAINS = [
  'senate.gov',
  'house.gov',
  'mail.house.gov',
  'gov' // State-level offices
];

function isValidCongressionalEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return ALLOWED_DOMAINS.some(allowed => domain === allowed || domain.endsWith(`.${allowed}`));
}
```

**Why this matters:**
- Prevent unauthorized access to constituent messages
- Ensure only verified congressional staff can view data
- Comply with constituent privacy expectations

### Session Security

**Magic link expiration:**
- Links expire after 15 minutes
- One-time use only (token invalidated after verification)
- Session duration: 7 days with rolling refresh

**Rate limiting:**
- Max 5 magic link requests per hour per email
- Max 10 login attempts per hour per IP
- Exponential backoff on repeated failures

### Data Privacy

**Constituent protection:**
- No PII displayed (per "Full ZK. No DB." architecture)
- Only verification status + district shown
- Messages aggregated by template (not individual senders)
- Export logs tracked for audit trail

---

## Integration with Existing Systems

### CWC API Message Tracking

**Flow:**
```
Commons TEE → CWC API → Congressional Office Email
                    ↓
              (webhook callback)
                    ↓
         Dashboard inbox update
```

**Webhook endpoint:**
```typescript
POST /api/congressional/webhooks/cwc-delivery

{
  "message_id": "msg_abc123",
  "template_id": "tpl_xyz789",
  "delivered_at": "2025-10-22T14:30:00Z",
  "recipient": {
    "office": "senate",
    "state": "CA",
    "district": null
  }
}
```

### CSV Export Format

**Compatible with existing constituent management systems:**

```csv
Date,Template,Category,Constituent Count,Verified Count,District,Priority,Status
2025-10-22,Support H.R. 1234 Climate Action,Environment,234,234,CA-12,High,Unread
2025-10-22,Medicare Coverage Expansion,Healthcare,89,89,CA-12,Medium,Read
```

---

## Success Metrics

**Week 15-16 Deliverables:**
1. ✅ Congressional staff can authenticate with `.senate.gov` / `.house.gov` email
2. ✅ Inbox displays aggregated messages by template
3. ✅ Filtering works (topic, district, date, verification status)
4. ✅ Message detail view shows full content + demographics
5. ✅ Analytics dashboard displays message volume + top issues
6. ✅ CSV export works for integration with existing tools

**Post-launch goals:**
- 10+ congressional offices using dashboard daily
- 90%+ message read rate within 48 hours
- Congressional staff feedback on feature requests
- Integration with existing constituent management systems

---

## Future Enhancements (Phase 2+)

**Advanced features (not Week 15-16):**
- **Reply functionality** - Staff can respond via Commons platform
- **Auto-tagging** - AI categorization of messages by policy area
- **Sentiment analysis** - Track constituent sentiment trends
- **Collaboration** - Multiple staff members per office
- **Mobile app** - iOS/Android for on-the-go access
- **Webhook integrations** - Zapier, Salesforce, Quorum
- **Advanced analytics** - Cohort analysis, retention metrics
- **Outcome tracking** - Did the bill pass? How did constituents react?

---

## Open Questions

**For user/stakeholder review:**

1. **Authentication method** - Magic links vs OAuth (Google Workspace)?
2. **Message retention** - How long should messages stay in dashboard? 90 days? 1 year?
3. **Privacy controls** - Should constituents opt-in to dashboard visibility?
4. **Multi-office access** - Should state directors see messages from all districts?
5. **Branding** - White-label for individual offices or Commons-branded?

---

## Dependencies

**Must be complete before Week 15:**
- Week 13-14: XChaCha20-Poly1305 + AWS Nitro Enclaves TEE ✅
- Week 9-12: CWC API integration + delivery confirmation ✅
- Phase B: Zero-knowledge proof verification on Scroll ✅

**External dependencies:**
- CWC API webhook support (confirm availability)
- AWS SES for magic link emails (already configured)
- Congressional office email domain access (pilot offices)

---

## Next Steps

**After this plan is approved:**

1. **Week 13-14:** Implement XChaCha20-Poly1305 + TEE (CURRENT PRIORITY)
2. **Week 15-16:** Implement congressional dashboard (this plan)
3. **Week 17:** Phase 2 launch preparation
4. **Week 18+:** Phase 2 token rewards + challenge markets

**Immediate action:** Focus on TEE implementation per IMPLEMENTATION-ROADMAP.md timeline.
