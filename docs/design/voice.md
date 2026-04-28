# Language & Voice Guidelines

**Direct. Specific. Institutional.**

This document defines how Commons communicates. State what is. Show what exists. Don't justify, don't hedge, don't decorate. The cypherpunk substrate is present in the engineering (ZK proofs, client-side encryption, sovereign identity) — the voice has matured toward civic precision.

---

## Core Principles

### 1. Confident & Direct

**State what is. Don't explain, justify, or defend.**

❌ "Find campaigns in your area"
✅ "Issues in CA-11"

❌ "We'll show you the most relevant local campaigns"
✅ "Bills in California"

❌ "Stay informed about important issues"
✅ "Track bills"

### 2. Technical Details in Popovers, Not Primary Copy

**Primary UI: Simple statement of fact.**
**Popover/tooltip: Technical mechanism for those who care.**

❌ "Your address stays in your browser. We use IP geolocation to show local issues—less accurate but doesn't require permission."
✅ Primary: "Issues in your district"
✅ Popover: "Location inferred from IP. Enable browser location for district-level accuracy."

❌ "We track template views to show you what's trending. Your address and identity verification happen in your browser and encrypted TEE environments—we never see them."
✅ Primary: "Trending bills"
✅ Popover (post-enclave deployment): "View count tracked. Your identity/address stay local or encrypted in TEE."
✅ Popover (current, pre-enclave): "View count tracked. Address fields transit our servers briefly during district resolution, then are discarded; only the district hash is retained."

### 3. Don't Wear Cypherpunk on Our Sleeve

**Users don't need to know the mechanism unless they ask.**

❌ "UltraHonk zero-knowledge proofs verify you live in the district without revealing your address"
✅ Primary: "Verify residency"
✅ Popover: "Zero-knowledge proof. Congress sees verification, not your address."

❌ "Your message is encrypted in your browser, decrypted only inside an AWS Nitro Enclave (hardware-isolated environment), then sent to Congress via their official API"
✅ Primary: "Send to Congress"
✅ Popover: "Encrypted delivery via AWS Nitro Enclave to congressional offices."

### 4. No Pre-Defending

**Don't apologize for what we are. Don't explain what we're not.**

❌ "We'll show you the most relevant local campaigns without tracking you"
✅ "Bills in CA-11"

❌ "Your privacy is our top priority"
✅ (Remove entirely—show don't tell)

❌ "We take security seriously"
✅ (Remove entirely—it's obvious or it's not)

### 5. Imperative Voice

**Commands, not suggestions.**

❌ "You can browse templates"
✅ "Browse templates"

❌ "Messages may be delivered to congressional offices"
✅ "Send to Congress"

❌ "Your voice could make a difference"
✅ "Send your position"

---

## Vocabulary

### Avoid → Use Instead

| Avoid | Use Instead | Reasoning |
|-------|-------------|-----------|
| campaigns (person layer) | (just location name) | "Campaigns" is politically loaded, implies fundraising/elections |
| issues | (just location name) | "Issues" feels heavy, problem-focused, politically loaded |
| privacy-focused | your data stays in your browser | Specific mechanism > vague claim |
| secure | encrypted, zero-knowledge, TEE-based | Specific technology > vague promise |
| community | users, people | "Community" is corporate-speak |
| platform | app, site, tool | "Platform" is tech jargon |
| content | messages, templates, bills | "Content" is corporate-speak |
| engagement | actions, messages sent, proofs generated | "Engagement" is marketing speak |
| user-friendly | direct, fast, simple | Show don't tell |
| innovative | (describe what it actually does) | Meaningless adjective |
| seamless | (remove entirely) | Filler word |
| solutions | tools, methods, approaches | Corporate buzzword |
| empower | enable, let you, you can | Condescending verb |

**Org-layer exception:** "Campaign" is a valid noun in org-layer UI where it refers to the specific technical object — a named set of verified actions targeting decision-makers. It is NOT valid as marketing copy, hero text, or person-layer language. Person-layer equivalent: "template" or location name.

### Geographic Scope Language

**Be specific about jurisdiction levels:**

- **Federal**: "All 50 states + DC + territories"
- **State**: "California", "New York" (use state name)
- **District**: "CA-11", "NY-14" (use district code)
- **County/City**: "San Francisco County", "Austin" (when applicable)

**Examples:**

❌ "Find campaigns in your area"
❌ "Issues in CA-11"
✅ "CA-11" (district known - just location name)
✅ "California" (state known - just location name)
✅ "Nationwide" (no location data)

**Reasoning**: Templates speak for themselves. Location is just a filter, not a category. Coordination count is the signal ("47 coordinating in California"), not a label like "campaigns" or "issues."

### International Users

**For non-US users with no legislative adapter:**

❌ "This service is only available in the US"
✅ "US Congress only for now. Building adapters for other legislatures—check back soon."

**For non-US users with legislative adapter (future):**

✅ "Switch to UK Parliament" (if UK adapter exists)
✅ "Issues in Ontario" (if Canadian provincial adapter exists)

---

## UI Patterns: Primary + Popover

### Privacy Messaging

**Primary: What the user sees.**
**Popover: Technical details for those who click.**

**Example 1: Location detection**
- Primary: "Issues in CA-11"
- Popover: "Location from IP (city-level). Enable browser location for district accuracy."

**Example 2: Message delivery**
- Primary: "Send to Congress"
- Popover: "Encrypted in browser → AWS Nitro Enclave → Congressional office API"

**Example 3: Identity verification**
- Primary: "Verify residency"
- Popover: "Zero-knowledge proof. We see verification, not your address."

### Feature Descriptions

**Primary: What it does.**
**Popover: How it works.**

**Example 1: Content moderation**
- Primary: "Agent-reviewed templates"
- Popover: "Automated 2-layer pipeline: Llama Prompt Guard 2 (injection) + gpt-oss-safeguard-20b (safety) via Groq."

**Example 2: Reputation tracking**
- Primary: "Earn reputation"
- Popover: "On-chain ERC-8004 on Scroll zkEVM. Token rewards in Phase 2."

**Example 3: Proof generation**
- Primary: "Generating proof"
- Popover: "Noir ZK proof in AWS Nitro Enclave (2-5s)"

### Error Messages

**Primary: What happened + What to do.**
**Popover: Why it happened.**

**Example 1: Location timeout**
- Primary: "Location timeout. Try IP detection instead."
- Popover: "Browser location service took >10s to respond."

**Example 2: Verification failed**
- Primary: "Verification failed. Tap 'Try again' or use a different document."
- Popover: "mDL verification requires a supported state digital wallet. See supported states."

**Example 3: Database corruption**
- Primary: "Reloading to fix database schema."
- Popover: "IndexedDB corrupted—likely from previous version."

### Permission Requests

**Primary: What you're enabling.**
**Popover: What happens with the data.**

**Example 1: Location permission**
- Primary: "Enable location for district-level accuracy"
- Popover: "District vs. state from IP. Data stays in browser."

**Example 2: Notifications**
- Primary: "Enable delivery notifications"
- Popover: "Notified when Congress receives message. Check manually anytime."

### Loading States

**Show current action. Time estimate if >2 seconds.**

❌ "Loading..."
✅ "Generating proof (2-5s)"

❌ "Please wait"
✅ "Geocoding address"

❌ "Processing"
✅ "Encrypting message"

---

## Copy Patterns

### Call-to-Action Buttons

**Be specific about the action:**

❌ "Get Started"
✅ "Verify Identity"

❌ "Continue"
✅ "Send to Congress"

❌ "Learn More"
✅ "See How It Works"

❌ "Sign Up"
✅ "Create Account" or "Verify with Digital ID"

### Navigation Labels

❌ "Dashboard"
✅ "Your Messages" or "Reputation"

❌ "Explore"
✅ "Browse Issues"

❌ "Profile"
✅ "Account" or "Settings"

### Placeholder Text

**Show format, not instructions:**

❌ "Enter your address"
✅ "123 Main St, Austin, TX 78701"

❌ "Type your message"
✅ "I support this bill because..."

❌ "Search"
✅ "Search bills, reps, districts"

### Empty States

**What's missing + What to do:**

❌ "No campaigns found"
✅ "No templates in CA-11 yet. Browse federal issues or create your own."

❌ "Nothing here"
✅ "You haven't sent any messages yet. Browse templates to get started."

---

## Example Rewrites

### LocationFilter.svelte

**Current (WRONG):**
```svelte
<h3>Find campaigns in your area</h3>
<p>We'll show you the most relevant local campaigns without tracking you</p>
```

**Fixed (CORRECT):**
```svelte
<h1>
  {congressionalDistrict || countyName || stateName || 'Nationwide'}
</h1>
<p class="text-sm text-slate-600">
  {coordinationCount} coordinating here
</p>
```

**Why**: No category labels ("campaigns", "issues"). Location is the filter. Coordination count is the signal. Templates speak for themselves.

### Identity Verification Flow

**Current (WRONG):**
```svelte
<p>Verify your identity to access premium features</p>
```

**Fixed (CORRECT):**
```svelte
<button>
  Verify residency
  <InfoIcon tooltip="Zero-knowledge proof. We see verification, not your address. Congress sees your full message + address." />
</button>
```

### Template Browser Header

**Current (WRONG):**
```svelte
<h1>Browse Campaigns</h1>
<p>Discover important issues and make your voice heard</p>
```

**Fixed (CORRECT):**
```svelte
<h1>
  {#if congressionalDistrict}
    {congressionalDistrict}
  {:else if countyName}
    {countyName}
  {:else if stateName}
    {stateName}
  {:else}
    Nationwide
  {/if}
</h1>
<p class="text-sm">
  {coordinationCount} coordinating
</p>
```

**Why**: Just the location. No "in", no "bills", no "campaigns". Coordination count shows activity. Templates below explain what people are working on.

---

## The Acquisition Register

voice.md defines two registers: primary UI (confident statements) and popovers (technical detail). Both assume an authenticated user inside the product. The acquisition surface — the org landing page, the homepage for a first-time visitor — is a third register.

**The acquisition surface speaks to someone who doesn't use Commons yet.** They may never have heard of verification packets. They will leave in 3 seconds if the page feels like another SaaS pitch.

### Principles

- **Show the artifact, not the description.** Don't explain what Commons is. Show what it produces. The proof specimen IS the pitch.
- **Show the gap, not the feature.** Don't enumerate capabilities. Show what the visitor currently sends (undifferentiated email count) next to what they could send (verification packet with proof). The gap IS the argument.
- **Show one capability in full resolution.** Not a feature grid. Not a comparison table. One thing, completely rendered, so the visitor can evaluate it in 5 seconds.
- **Price as punchline.** Price only lands after value is established. After the specimen, after the gap: "Free. $0." The price IS the punchline.
- **No superlatives.** Let the specimen speak. "No other platform produces this" is the closest to a claim — and only if it's true.

### What the acquisition surface is NOT

- Feature matrix
- Pricing comparison table
- Testimonial carousel
- Animated hero with abstract shapes
- "Trusted by X organizations" social proof bar
- Dense prose paragraphs enumerating capabilities

### Relationship to anti-manipulation

Anti-manipulation still applies. The acquisition surface does not tell the visitor how to feel. It shows what exists and lets them feel what they feel. The distinction: manipulation says "your voice matters!" Specificity says "248 verified constituents in your district." One is emotional extraction. The other is evidence.

The anti-marketing stance (refuse to try to create desire) applies to product surfaces. It does not apply to the acquisition surface. The acquisition surface earns attention through specificity — which is a form of respect, not a form of selling.

See [ORG-ACQUISITION-SURFACE.md](ORG-ACQUISITION-SURFACE.md) for the full acquisition surface design philosophy.

---

## Anti-Patterns to Avoid

### 1. Over-Explaining in Primary UI

❌ "Your address stays in your browser. We use IP geolocation to show local issues—less accurate but doesn't require permission."
✅ Primary: "Issues in CA-11"
✅ Popover: "Location from IP. Enable browser location for district accuracy."

### 2. Wearing Cypherpunk on Our Sleeve

❌ "UltraHonk zero-knowledge proofs verify you live in the district"
✅ Primary: "Verify residency"
✅ Popover: "Zero-knowledge proof. We verify residency without storing your address. Congress sees your message + address when you send."

### 3. Pre-Defending Privacy Choices

❌ "We track template views to show you what's trending. Your address and identity verification happen in your browser—we never see them."
✅ Primary: "Trending bills"
✅ Popover: "View count tracked. Your identity/address stay local."

### 4. Hedging Language

❌ "We try to protect your privacy"
❌ "We aim to provide accurate results"
✅ (Remove entirely—show through design)

### 5. Marketing Superlatives

❌ "Revolutionary privacy technology"
❌ "Industry-leading security"
✅ (Remove entirely—mechanism speaks for itself)

### 6. Emotional Manipulation

❌ "Your voice matters!"
❌ "Join thousands making a difference"
✅ "Send to Congress" (action, not emotion)

### 7. Unnecessary Politeness

❌ "Please consider verifying your identity"
❌ "If you wouldn't mind..."
✅ "Verify identity" (imperative, no filler)

---

## Writing Checklist

Before shipping copy, verify:

**Primary UI:**
- [ ] No corporate buzzwords (campaigns¹, platform, engagement, seamless, innovative) — ¹org-layer UI may use "campaign" as a technical noun; see vocabulary table
- [ ] No hedging language (try to, aim to, strive for)
- [ ] No marketing superlatives (best, revolutionary, industry-leading)
- [ ] No passive voice (will be delivered → we deliver)
- [ ] No emotional manipulation (your voice matters → send your position)
- [ ] No over-explaining (technical details go in popovers)
- [ ] No pre-defending (don't explain what we're not)
- [ ] Imperative voice (Browse issues, not You can browse)
- [ ] Geographic scope clear (CA-11, California, Federal)

**Popovers/Tooltips:**
- [ ] Technical mechanism explained concisely
- [ ] Trade-offs acknowledged if relevant
- [ ] No marketing fluff (just the facts)
- [ ] Maximum 2 sentences

---

## Voice Examples by Component Type

### Authentication

❌ "Sign in to continue"
✅ "Verify with Google" or "Create session"

❌ "Secure login"
✅ "OAuth via Google/Facebook/Twitter"

### Templates

❌ "Popular campaigns"
✅ "Most used templates this week"

❌ "Trending issues"
✅ "Bills with most messages sent"

### Reputation

❌ "Your impact score"
✅ "On-chain reputation: 47 verified messages"

❌ "Earn badges"
✅ "Reputation earned per verified delivery"

### Analytics

❌ "Community engagement metrics"
✅ "Messages sent: 1,247 | Delivered: 1,198 | Failed: 49"

❌ "User activity"
✅ "Active users today: 342"

---

## When Technical Details Matter

**Primary UI = Confident statement.**
**Popover = Technical mechanism for those who care.**

**Don't frontload explanations. Let users opt-in to details.**

### Example: Message delivery flow

> ⚠️ F-1.2 honesty pass (2026-04-25): the AWS Nitro Enclave deployment is on
> the roadmap; the active resolver today is `LocalConstituentResolver`
> (in-process on the server). Voice-guide copy below reflects the *intended*
> flow once the enclave ships — DO NOT use this language in shipping UI until
> the enclave is deployed. For shipping copy today, see "CORRECT (current
> reality, 2026-04)" below.

**WRONG (over-explaining in primary UI):**
```
Your address is encrypted in your browser using XChaCha20-Poly1305,
sent to an AWS Nitro Enclave that generates a Noir zero-knowledge proof,
then deleted. The proof goes on-chain. Your address never touches our servers.
```

**CORRECT (target architecture — post-enclave deployment):**
- Primary: "Send to Congress"
- Popover: "Encrypted in browser → AWS Nitro Enclave → Congressional office API. Congress receives your message + address. ZK proof of residency goes on-chain."

**CORRECT (current reality, 2026-04):**
- Primary: "Send to Congress"
- Popover: "Encrypted in browser → our delivery worker → Congressional office API. Hardware-isolated enclave is on the roadmap. ZK proof of residency goes on-chain."

### Example: Location detection

**WRONG (defensive explanation):**
```
IP geolocation is less private than browser geolocation, but it works
immediately without permissions. You can upgrade to browser location anytime.
```

**CORRECT (confident primary + transparent popover):**
- Primary: "CA-11" (just the location)
- Popover: "Location from IP. GPS for county precision."

### Example: OAuth login

**WRONG (pre-defending choice):**
```
OAuth login links your Google/Facebook account to your session.
We store the OAuth token but never see your password.
Alternative: Use passkey authentication for phishing-resistant login.
```

**CORRECT (confident primary + optional details):**
- Primary: "Continue with Google"
- Popover: "OAuth token stored. Password never seen. Passkey auth coming in Phase 2."

---

## Show Don't Tell

**Don't announce you're privacy-focused. Just be privacy-focused.**

❌ "We're committed to protecting your privacy"
✅ (Show through design: local-first data, optional popovers explaining encryption)

❌ "Your data is completely private and secure"
✅ Primary: "Verify residency"
✅ Popover: "ZK proof. We verify without storing address. Congress sees message + address when sent."

**Confidence comes from mechanism, not marketing copy.**
