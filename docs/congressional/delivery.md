# Message Delivery - Protocol Participation

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** This doc describes an
> aspirational multi-tenant delivery model (CWC + email templates + OAuth
> Sent-folder verification) that was not built as written. The live
> pipeline is **congressional-only (CWC via Convex), ZK-gated, and
> currently feature-flagged off**. Read these deltas before trusting any
> specific section:
>
> - **Feature flag:** `FEATURES.CONGRESSIONAL = false`
>   (`src/lib/config/features.ts:24`). Delivery code exists; UI entrypoints
>   do not render.
> - **Identity:** ZK-proof gated via `locals.user.verified_at`. There is
>   **no OAuth Sent-folder email verification** — no `verifyEmailDelivery()`,
>   no Sent-folder scan. Active intake is mDL (W3C Digital Credentials API);
>   `self.xyz` / `Didit` persist only as legacy enum values.
> - **DB layer:** Prisma / Postgres sections are obsolete. Schema is in
>   `convex/schema.ts`. Fields like `api_provider` and `recipient_emails`
>   on templates **do not exist** — the live shape is
>   `deliveryMethod: string` + `deliveryConfig: any` +
>   `recipientConfig: any`.
> - **Routing logic (`template.delivery_method === 'email'` branch):**
>   not in code. `deliverToCongress` is CWC-only.
> - **Retry logic:** actual implementation uses distributed CAS guards
>   (`claimForDelivery`, `updateDeliveryStatus`), attempt counters, and a
>   15-minute stuck-sweeper cron — not the simple 3-retry exponential
>   backoff described here.
> - **CWC file locations:** `src/lib/core/legislative/adapters/cwc/...`
>   paths listed in the appendix **do not exist**. Live code is in
>   `convex/_cwcXml.ts` and `convex/submissions.ts`. See also
>   `docs/adr/WP-008-house-cwc-delivery-fix.md` (House requires an
>   IP-whitelisted proxy).
> - **TEE:** Planned, not deployed. `LocalConstituentResolver` is the
>   active resolver in production.
> - **Demo status:** When no CWC creds are configured, submissions are
>   marked `deliveryStatus: 'demo'` (not documented below).

**What users care about**: Did my message have impact? Can I see that impact?

**What the protocol delivers**: Track your civic actions, see coordination with others, build reputation for participation.

**What users don't care about**: Backend implementation details (API vs email, cryptographic verification).

---

## Who You Can Contact

**Anyone who makes decisions affecting communities**:

- **Large legislatures**: US Congress, state legislatures, European Parliament, UK Parliament
- **Local government**: City councils, school boards, county boards, planning commissions
- **Corporations**: Customer service, C-suite, boards, investor relations
- **HOAs**: Homeowner association boards (24.8M homes, 62M residents)
- **Universities**: Administration, boards of trustees, department chairs
- **Healthcare**: Hospital administration, insurance companies, patient advocacy
- **Nonprofits**: Leadership, boards, program managers

**The key difference isn't who you contact - it's whether you participate in the protocol.**


---

## How It Works (Two Options)

### Option 1: Join the Protocol (Recommended)

**Connect your email via OAuth**

**What you get**:
- **Track your civic impact**: See all messages you've sent, who you've contacted
- **Coordination visibility**: "5,000 people contacted Senator Warren this week about housing"
- **Build reputation**: On-chain record of civic participation (ERC-8004)
- **Collective power**: Your voice combines with others for measurable impact
- **One-click sending**: We verify delivery, you get credit

**How it works**:
1. Connect your email (Gmail, Outlook, etc.) via OAuth
2. Customize your message
3. Click "Send" - we handle everything
4. We verify delivery via zero-knowledge OAuth access (read Sent folder only)
5. You get credit, reputation updates on-chain, impact tracking

**Privacy**:
- OAuth access is read-only (Sent folder only)
- Zero-knowledge verification (we verify template was sent, don't read full content)
- You can revoke access anytime
- Your address stays private (zero-knowledge proofs for congressional messages)

**This is the voter-protocol** - impact tracking, reputation, coordination.

---

### Option 2: Send Without Tracking

**Don't connect OAuth**

**What you get**:
- Message still gets sent
- No verification, no credit, no reputation
- No impact tracking or coordination visibility
- Outside the voter-protocol

**How it works**:
1. Customize your message
2. Click "Send" - your email client opens
3. You send from your own email
4. We can't verify you sent it (no OAuth access)
5. No impact tracking, no reputation credit

**Trade-off**: You're outside the protocol. No civic impact tracking, no coordination visibility, no reputation building.

**User mental model**:
- **Join protocol**: "I want to track my civic impact and see coordination with others"
- **Send without tracking**: "I just want to send this message once, don't care about tracking"

---

## Technical Implementation (How the Protocol Works)

### For Congressional Messages (Zero-Knowledge District Verification)

**When you send to large legislatures** (Congress, state legislatures):

1. **Address verification** (zero-knowledge proof):
   - You enter your address
   - We generate cryptographic proof you're in the district
   - Congressional office gets proof, NOT your address
   - Can't be forged, preserves privacy

2. **Message delivery**:
   - We deliver message + zero-knowledge proof
   - Congressional office verifies proof cryptographically
   - They know you're a verified constituent without seeing your address

3. **Protocol participation** (if you connected OAuth):
   - We verify delivery
   - Reputation updates on-chain (ERC-8004)
   - Impact tracking in your dashboard
   - Coordination visibility ("5,000 constituents contacted Senator Warren")

**Privacy guarantees**:
- Address verified via zero-knowledge proof (we don't store plaintext)
- Congressional office sees district verification, not address
- OAuth access is read-only (Sent folder only for verification)

---

### For All Other Messages (OAuth Verification)

**When you send to anyone else** (local gov, corporations, HOAs, universities, nonprofits):

1. **Message sending**:
   - Option A (with OAuth): We send on your behalf, verify delivery
   - Option B (without OAuth): Your email client opens, you send manually

2. **Protocol participation** (only with OAuth):
   - We verify you sent the message (zero-knowledge Sent folder check)
   - Reputation updates on-chain
   - Impact tracking in your dashboard
   - Coordination visibility

3. **Without OAuth**:
   - Message gets sent from your email
   - We can't verify delivery
   - No reputation credit, no impact tracking
   - Outside the voter-protocol

**Privacy guarantees** (with OAuth):
- OAuth access is read-only (Sent folder only)
- Zero-knowledge verification (we verify template was sent, don't read full message)
- You can revoke access anytime

---

## What This Means for Template Creators

### When creating a template:

**You specify WHO to contact, not HOW to deliver:**

Templates can target ANY decision-maker:
- Large legislatures (Congress, state legislatures, parliaments)
- Local government (city councils, school boards, county boards)
- Corporations (customer service, C-suite, boards)
- HOAs (homeowner association boards)
- Universities (administration, boards)
- Healthcare (hospitals, insurance companies)
- Nonprofits (leadership, boards)

**Examples**:
- "Tell your Senator to support housing bill"
- "Contact your city council about zoning reform"
- "Message your HOA board about fee increases"
- "Email your university administration about tuition"
- "Contact corporate customer service about product issues"
- "Reach all your elected officials + corporate stakeholders about climate" (multi-target)

**The protocol handles the rest:**
- For congressional messages: Zero-knowledge district verification + delivery
- For all messages: OAuth verification (if user connected), reputation credit, impact tracking
- Users don't choose "delivery method" - they just send, protocol handles it

---

## Technical Implementation (For Developers)

### Database Schema:

```prisma
model Template {
  target_level        String    // "federal" | "state" | "local" | "corporate" | "nonprofit" | "multi"
  target_body         String?   // "us_congress" | "ca_legislature" | "sf_city_council" | "hoa_board" | "corporate_board"
  delivery_method     String    // "api" | "email" | "hybrid"

  // For API delivery:
  api_provider        String?   // "cwc" | "state_api"

  // For email delivery:
  recipient_emails    String[]  // ["council@cityofsf.gov", "ceo@corp.com", "hoa-board@example.com"]
}
```

### Routing Logic:

```typescript
async function sendMessage(template: Template, user: User) {
  if (template.delivery_method === 'api') {
    // Large legislature - official API delivery
    const district = await voterClient.resolveDistrict(user.address);
    const recipients = await getOfficials(district, template.target_body);
    return await officialAPI.sendMessage(recipients, template.message);
  }

  if (template.delivery_method === 'email') {
    // Direct contact (open to any decision-maker) - email delivery with OAuth verification
    const mailtoUrl = buildMailtoUrl({
      to: template.recipient_emails,
      subject: template.subject,
      body: template.message
    });

    return {
      action: 'mailto',
      url: mailtoUrl,
      requiresVerification: true,
      verificationInstructions: 'We\'ll check your Sent folder to verify delivery'
    };
  }
}
```

### User Flow (Frontend):

```typescript
// User clicks "Send Message" button
function handleSendMessage(template: Template) {
  if (template.delivery_method === 'api') {
    // Show address collection modal
    showModal('AddressCollectionModal', {
      onSubmit: async (address) => {
        const result = await sendViaAPI(template, address);
        showConfirmation(`✓ Message delivered to ${result.recipient}`);
      }
    });
  }

  if (template.delivery_method === 'email') {
    // Show email verification modal
    showModal('EmailVerificationModal', {
      onConnect: async (oauthToken) => {
        const mailtoUrl = await getMailtoUrl(template);
        window.location.href = mailtoUrl; // Opens email client

        // Background: Verify email was sent
        await verifyEmailDelivery(oauthToken, template);
        showConfirmation('✓ Delivery verified');
      }
    });
  }
}
```

---

## Privacy Guarantees

### When You Join the Protocol (OAuth Connected)

**For Congressional Messages**:
- **Address verification**: Zero-knowledge proof (we don't store plaintext address)
- **Congressional office sees**: Cryptographic proof of district membership, NOT your address
- **OAuth access**: Read-only Sent folder (to verify you sent the message)
- **What we verify**: Template was sent, message epistemically intact
- **What we DON'T read**: Full email content (zero-knowledge verification)

**For All Other Messages**:
- **OAuth access**: Read-only Sent folder only
- **What we verify**: You sent a message matching the template to the specified recipient
- **Zero-knowledge verification**: We verify template was sent (possibly with modifications), message epistemically intact
- **What we DON'T access**: Your Inbox, contacts, full email history

**User control**:
- Revoke OAuth access anytime
- OAuth is read-only (we can't send on your behalf without your action)
- You can see exactly what access we have

---

### When You Send Without Tracking (No OAuth)

**Privacy**:
- We don't access your email at all
- No OAuth connection
- No verification, no tracking

**Trade-off**:
- Outside the voter-protocol
- No impact tracking, no reputation credit
- No coordination visibility

---

## Roadmap (Protocol Expansion)

### Phase 1 (Current): Foundation

**What's live**:
- ✅ US Congress (zero-knowledge district verification)
- ✅ OAuth verification (impact tracking, reputation, coordination)
- ✅ Contact ANY decision-maker (large legislatures, local gov, corporations, HOAs, universities, nonprofits)
- ✅ Protocol participation (join for tracking, or send without tracking)

**Status**: Live in production

---

### Phase 2 (Next 3-6 months): Expand Verification

**Planned**:
- State legislatures (district verification + APIs where available)
- Multi-tier targeting (federal + state + local in one message)
- Enhanced coordination visibility (district-level, issue-level aggregation)

**Example**: "Contact all your representatives (Senator + State Rep + City Council) about housing"

**Protocol enhancement**: More coordination data, better impact visualization

---

### Phase 3 (6-12 months): International + Coordination Features

**Planned**:
- UK Parliament, European Parliament, Canadian Parliament (district verification)
- Coordination features: See when others in your district are taking action
- Impact metrics: Track policy changes correlated with constituent action

**Challenge**: Each country has different verification systems

**Protocol enhancement**: Cross-border coordination, global civic action tracking

---

### Phase 4 (12+ months): Scale + Enhanced Verification

**Planned**:
- Google Transparency & Accountability Center (TAC) partnership (enhanced email verification at scale)
- Corporate accountability infrastructure (scale verification for any entity)
- Advanced coordination: Threshold-based campaigns ("5,000 people commit, then we all send")

**Protocol enhancement**: Better verification, more sophisticated coordination mechanics

---

## For Congressional Offices

**Understanding the voter-protocol**:

### What you receive:
- **Cryptographically verified constituent messages** (zero-knowledge proof of district membership)
- **Aggregate coordination data**: "5,000 constituents in your district contacted you about housing this week"
- **Issue tracking**: Volume, sentiment, constituent priority by topic
- **Not spam**: Each message proves district membership (cryptographically unforgeable)

### Privacy architecture:
- Constituents' addresses verified via zero-knowledge proofs (UltraHonk/Noir ZK circuits)
- You see proof of district membership, NOT plaintext addresses
- Can't be forged, can't be faked, cryptographically secure

### Why these messages are different:
- **Not astroturfing**: Each message proves real district membership
- **Coordination visibility**: You can see constituent coordination (5,000 people = political pressure)
- **Verified participation**: Every sender joined the voter-protocol (OAuth verified, reputation tracked)
- **Platform prevents spam**: Rate limiting, content moderation, cryptographic verification

### Dashboard access:
See `/docs/congressional/dashboard.md` for office dashboard setup (view messages, coordination data, issue tracking)

---

## Cross-References

**District verification (voter-protocol)** → See `/docs/integration.md`

**Zero-knowledge proofs** → See `/docs/architecture/decision-record.md`

**Email verification roadmap** → See `/docs/strategy/delivery-verification.md`

**CWC API technical details** → See Appendix below

**Template system** → See `/docs/features/templates.md`

**Power structures** → See `/docs/research/power-structures.md`

---

## Bottom Line

**What users care about**: "Did my message have impact? Can I track it?"

**The voter-protocol delivers**:
- **Impact tracking**: See all your civic actions over time
- **Coordination visibility**: "5,000 people contacted Senator Warren about housing"
- **Reputation building**: On-chain record of civic participation (ERC-8004)
- **Collective power**: Your voice combines with others for measurable impact

**Two ways to participate**:

### Join the Protocol (Recommended)
- Connect email via OAuth
- One-click sending, automatic verification
- Impact tracking, reputation credit, coordination visibility
- **This is the voter-protocol utility**

### Send Without Tracking
- Don't connect OAuth
- Message gets sent, but no verification
- No impact tracking, no reputation, outside the protocol

**Who you can contact**: ANYONE making decisions that affect communities (large legislatures, local gov, corporations, HOAs, universities, healthcare, nonprofits)

**Key insight**: Users don't care about "cryptographic verification" or "delivery methods." They care about **seeing their civic impact and coordinating with others.**

**The protocol makes that possible.**

---

## Appendix: CWC API Technical Reference

### XML Message Formats

#### House Format (CWC 2.0)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CWC version="2.0">
    <MessageHeader>
        <MessageId>comm_1234567890_tpl_abc123_rep_H001234</MessageId>
        <Timestamp>2025-10-12T19:35:00Z</Timestamp>
        <DeliveryAgent>
            <Name>Commons Advocacy Platform</Name>
            <Email>cwc@commons.email</Email>
            <Phone>+1-555-CWC-MAIL</Phone>
        </DeliveryAgent>
        <OfficeCode>CA12_HOUSE</OfficeCode>
    </MessageHeader>
    <ConstituentData>
        <Name>
            <First>Jane</First>
            <Last>Constituent</Last>
        </Name>
        <Address>
            <Street>123 Main Street</Street>
            <City>San Francisco</City>
            <State>CA</State>
            <Zip>94102</Zip>
        </Address>
        <Email>jane@example.com</Email>
        <Phone>555-123-4567</Phone>
    </ConstituentData>
    <MessageData>
        <Subject>Support for Climate Action Legislation</Subject>
        <Body>Dear Representative,

I'm writing to urge support for climate action legislation...

Sincerely,
Jane Constituent</Body>
        <MessageMetadata>
            <IntegrityHash>sha256:abc123...</IntegrityHash>
        </MessageMetadata>
    </MessageData>
</CWC>
```

#### Senate Format (Simplified CWC)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<CWC>
    <DeliveryId>comm_1234567890_tpl_abc123_sen_S000123</DeliveryId>
    <DeliveryAgent>
        <Name>Commons Advocacy Platform</Name>
        <Email>cwc@commons.email</Email>
        <Phone>+1-555-CWC-MAIL</Phone>
    </DeliveryAgent>
    <Constituent>
        <FirstName>Jane</FirstName>
        <LastName>Constituent</LastName>
        <ConstituentAddress>
            <Address>123 Main Street</Address>
            <City>San Francisco</City>
            <StateAbbreviation>CA</StateAbbreviation>
            <Zip>94102</Zip>
        </ConstituentAddress>
        <ConstituentEmail>jane@example.com</ConstituentEmail>
        <ConstituentPhone>555-123-4567</ConstituentPhone>
    </Constituent>
    <Message>
        <Subject>Support for Climate Action Legislation</Subject>
        <ConstituentMessage>Dear Senator,

I'm writing to urge support for climate action legislation...

Sincerely,
Jane Constituent</ConstituentMessage>
    </Message>
    <OfficeCode>CA_SENATE_FEINSTEIN</OfficeCode>
</CWC>
```

### Field Mapping Reference

#### Constituent Data Mapping

| Commons Field | CWC House Field | CWC Senate Field | Required |
|------------------|-----------------|------------------|----------|
| `user.name` | `ConstituentData.Name.First/Last` | `Constituent.FirstName/LastName` | Yes |
| `user.email` | `ConstituentData.Email` | `Constituent.ConstituentEmail` | Yes |
| `user.address.street` | `ConstituentData.Address.Street` | `ConstituentAddress.Address` | Yes |
| `user.address.city` | `ConstituentData.Address.City` | `ConstituentAddress.City` | Yes |
| `user.address.state` | `ConstituentData.Address.State` | `ConstituentAddress.StateAbbreviation` | Yes |
| `user.address.zip` | `ConstituentData.Address.Zip` | `ConstituentAddress.Zip` | Yes |
| `user.phone` | `ConstituentData.Phone` | `Constituent.ConstituentPhone` | Optional |

#### Message Data Mapping

| Commons Field | CWC House Field | CWC Senate Field | Required |
|------------------|-----------------|------------------|----------|
| `template.title` | `MessageData.Subject` | `Message.Subject` | Yes |
| `template.message_body` | `MessageData.Body` | `Message.ConstituentMessage` | Yes |

### Message ID Format

```
comm_{timestamp}_{userId}_{templateId}_{repBioguideId}

Example:
comm_1728764100_user_abc123_tpl_climate-action_H001234
```

**Components**:
- `comm_` - Commons identifier prefix
- Unix timestamp
- User ID (anonymized or hashed)
- Template ID
- Representative bioguide ID

### CWC Error Codes

```typescript
const CWC_ERROR_CODES = {
  'INVALID_OFFICE': 'Office code not recognized',
  'MISSING_FIELD': 'Required field missing from XML',
  'INVALID_ADDRESS': 'Address cannot be verified',
  'DUPLICATE_MESSAGE': 'Message ID already submitted',
  'RATE_LIMIT': 'Too many submissions from this user',
  'XML_MALFORMED': 'XML does not match schema',
  'UNAUTHORIZED': 'Invalid API credentials'
};
```

### Retry Logic Pattern

```typescript
async function submitWithRetry(
  xml: string,
  maxRetries: number = 3
): Promise<CWCResponse> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await submitToCWC({ xml });
      if (response.success) return response;

      // Don't retry on validation errors
      if (response.errors?.some(e => e.code.includes('INVALID'))) {
        throw new Error(`CWC validation failed: ${response.errors}`);
      }

    } catch (error) {
      if (attempt === maxRetries) throw error;
      await delay(Math.pow(2, attempt) * 1000); // Exponential backoff
    }
  }

  throw new Error('Max retries exceeded');
}
```

### Code Locations

**CWC Adapter**: `src/lib/core/legislative/adapters/cwc/cwcAdapter.ts`
**XML Builder**: `src/lib/core/legislative/adapters/cwc/xmlBuilder.ts`
**Field Mapper**: `src/lib/core/legislative/adapters/cwc/fieldMapper.ts`
**Type Definitions**: `src/lib/core/legislative/adapters/cwc/types.ts`
**Address Lookup**: `src/lib/core/congress/address-lookup.ts`
