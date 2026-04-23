# Phase 1: Privacy-Preserving Civic Intelligence That Goes Viral

> **STATUS: HISTORICAL** — January 2025 planning document. The product has evolved significantly since this was written. See [`product-roadmap.md`](product-roadmap.md) for current timeline and priorities, and [`index.md`](index.md) for how the Person Layer and Org Layer now structure the product.
>
> ⚠️ **2026-04-23 audit — specific items that will mislead if taken at face value:**
>
> - The "3 months to launch" schedule below is obsolete: **Phases 0–2 shipped 2026-03** (see `product-roadmap.md`, `docs/implementation-status.md`).
> - The narrative that `self.xyz` / `Didit` were "removed in Cycle 15" (~line 18) is **imprecise**. The W3C Digital Credentials API (mDL) is the sole active intake, but `'self.xyz' | 'didit'` **remain as enum values** on `verificationMethod` for backward compatibility with stored records (`src/lib/core/identity/session-credentials.ts:2-4`, `convex/schema.ts`).
> - Congressional delivery is **feature-gated off** (`FEATURES.CONGRESSIONAL=false` in `src/lib/config/features.ts:24`). Any text below that implies CWC delivery is live describes code-complete-but-flag-off state.
> - `FEATURES.DEBATE=false` and `FEATURES.PASSKEY=false`. `WALLET=true`, `SHADOW_ATLAS_VERIFICATION=true`.
> - Backend is **Convex-only** (Prisma / Postgres / Hyperdrive removed as of 2026-04). Any query samples below written in Prisma syntax are historical.
> - Advocacy-partnership / viral-seeding success metrics ("1 template with 10K actions", "Sunrise / Justice Dems integration") were **not pursued** in that form; the product shipped on the campaigns + email + networks rails instead.

**Date**: 2025-01-08
**Context**: Synthesis of brutalist critique + our actual implementation + social media virality
**Timeline**: 3 months to launch

---

## What We're Actually Building (Not What Brutalist Thought)

### The Core Product

**Privacy-preserving constituent intelligence at legislative district granularity**

**How it works**:
1. User verifies address (Census API + mDL via Digital Credentials API; self.xyz and Didit.me removed in Cycle 15)
2. System computes legislative districts (US House, State Senate, City Council, etc.)
3. User generates ZK proof: "I'm a verified constituent of CA-12"
4. User browses/customizes templates
5. System tracks aggregate: "5,247 constituents in CA-12 care about housing"
6. **User shares template link on social media**
7. Template goes viral → more constituents verify → aggregate count grows

**What makes this different**:
- **Privacy**: We don't track individuals, only district-level aggregates
- **Intelligence**: Template creators see which districts have critical mass
- **Virality**: Shareable template links (`/s/support-housing-reform`) with Open Graph

---

## The Latent Majority on Social Media

### Who They Are

**Not the 3% who already use Democracy.io/Resistbot**

**The 40% who**:
- Read political content on Twitter/Instagram/TikTok
- Feel strongly about issues (housing, climate, healthcare)
- Don't know how to translate anger into action
- Would share a template link if it resonated
- Won't fill out long forms or create accounts

**The brutalist was right**: Organizing requires trust, relationships, years of work (KC tenant strike: 247 days)

**But we're not building organizing tools** - we're building **low-friction civic action that spreads via social**

---

## How Templates Go Viral (The Missing Piece)

### The Share Flow (Already Built, Just Needs Emphasis)

**1. User journey**:
```
User sees template link on Twitter → clicks → lands on /s/[slug]
    ↓
Verifies address (30 seconds via Census API)
    ↓
Customizes template with [Personal Connection] (1 minute)
    ↓
Sends to representative (1 click)
    ↓
Shares link: "I just told [Rep Name] to support housing reform. You should too: [link]"
    ↓
Their followers see it → cycle repeats
```

**2. What makes it shareable**:
- **Open Graph previews** (rich cards on Twitter/Facebook/Instagram)
- **"5,247 people have taken action"** (social proof)
- **"Takes 2 minutes"** (low friction)
- **Personal connection** (not generic petition)

**3. What drives virality**:
- **Anger** (housing crisis, climate crisis, healthcare crisis)
- **Moral clarity** ("this is obviously wrong")
- **Actionability** ("I can do something in 2 minutes")
- **Social proof** ("5,247 people already did this")

---

## Anti-Doxxing via Automated Moderation (We Have This)

### The 3-Layer Content Moderation System

**Already built**:
- Layer 1: OpenAI GPT-4
- Layer 2: Google Gemini 3 Flash OR Anthropic Claude 3.5 Haiku
- Layer 3: Human review (if consensus < 67%)

**What it prevents**:
- ❌ Templates with personal addresses (auto-rejected)
- ❌ Templates naming specific organizers (auto-rejected)
- ❌ Templates with identifying information that could enable doxxing
- ❌ Toxic content, threats, hate speech

**How it works**:
```typescript
interface ModerationCriteria {
  auto_reject_if: {
    toxicity_score: > 0.7,
    contains_personal_info: true,  // ← ANTI-DOXXING
    contains_addresses: true,      // ← ANTI-DOXXING
    spam_patterns: true
  },

  auto_approve_if: {
    all_agents_approve: true,
    toxicity_score: < 0.2,
    no_personal_info: true,        // ← ANTI-DOXXING
    grammar_score: > 0.8
  },

  human_review_if: {
    split_decision: true,
    borderline_toxicity: 0.4-0.7,
    potential_doxxing: true         // ← ESCALATE TO HUMAN
  }
}
```

**The brutalist said**: "Anti-doxxing is total fantasy at solo-dev scale"

**But**: We're not protecting individual organizers from targeted doxxing (that's hard). We're preventing templates themselves from containing doxxing info (that's automated moderation, which we have).

---

## Who Has Pull in the Feeds (Network Effects)

### The Cold Start Problem

**Initial seeding** (Week 1-4):
1. **Partner with existing advocates**: Sunrise Movement, Justice Democrats, tenant unions have Twitter followings
2. **One viral template**: "Tell your rep to support rent control" shared by activist with 50K followers
3. **Template hits 1,000 actions**: Social proof creates more sharing
4. **Network effect kicks in**: Users share → their followers share → exponential

**What causes things to appear in feeds**:
- **Engagement** (likes, retweets, comments)
- **Recency** (posted in last few hours)
- **Social proof** ("5,247 people took action")
- **Moral urgency** ("housing crisis is killing people")
- **Shareability** (rich Open Graph preview, clear call-to-action)

### The Advocacy Ecosystem

**Who has pull**:
- **Activist accounts** (Sunrise Movement: 250K Twitter followers)
- **Progressive influencers** (AOC: 13M Twitter followers, Bernie: 19M)
- **Issue-focused accounts** (housing advocates, climate activists, healthcare justice)
- **Local activists** (smaller accounts but trusted in their communities)

**Our strategy**:
1. **Build template for their issue**: Housing, climate, healthcare
2. **Show aggregate data**: "12,000 constituents in swing districts already acted"
3. **They share**: "Tell your rep to support [issue]. 12K people already have: [link]"
4. **Their followers act**: Link spreads, aggregate count grows
5. **More social proof**: "Now 15K people" → more sharing

---

## The Viral Loop (How Templates Spread)

### Template Lifecycle (Revised for Virality)

**Creation**:
- Advocacy group creates template: "Tell [Rep Name] to support rent control"
- 3-layer AI moderation (auto-approve if passes, prevents doxxing)
- Published with shareable URL: `/s/support-rent-control`

**Initial seed**:
- Advocacy group tweets: "The rent is too damn high. Tell your rep: [link]"
- 1,000 followers click, 300 take action
- Each shares: "I just told [Rep Name] to support rent control. You should too: [link]"

**Viral growth**:
- Their followers see shares (3,000 impressions)
- 500 click, 150 take action
- Template now shows: "450 people have taken action"
- Social proof accelerates sharing

**Critical mass**:
- Template hits 5,000 actions
- Template creators see: "5,000 constituents in 50 districts"
- Politicians see: "5,000 verified constituents contacted me about this"
- Media covers: "Thousands flood Congress with rent control messages"

**Sustained pressure**:
- Template stays relevant (issue doesn't go away)
- New users discover via search/social
- Aggregate count grows to 20K, 50K, 100K
- Political pressure mounts

---

## Phase 1 Implementation (3 Months)

### Month 1: Core Viral Infrastructure

**Build**:
1. **Shareable template URLs** (`/s/[slug]`) - DONE
2. **Open Graph optimization** (rich social previews) - NEEDS WORK
3. **Social proof display** ("5,247 people have taken action") - NEW
4. **One-click sharing** (Twitter/Facebook/native share) - DONE
5. **Privacy-preserving analytics** (aggregate counts by district) - MOSTLY DONE

**Anti-doxxing** (via existing 3-layer moderation):
- Auto-reject templates with addresses, phone numbers, identifying info
- Human review for borderline cases
- Focus: Prevent templates from containing doxxable info (not protecting individual organizers)

**Success metric**: 10 templates with rich Open Graph previews, shareable URLs, social proof display

---

### Month 2: Template Seeding + Advocacy Partnerships

**Build**:
1. **10 high-quality templates** on urgent issues:
   - Housing: "Support rent control in your district"
   - Climate: "Demand Green New Deal funding"
   - Healthcare: "Expand Medicare coverage"
   - Labor: "Support union protection act"
   - Voting rights: "Pass voting rights legislation"

2. **Partner with advocacy groups**:
   - Sunrise Movement (climate)
   - Justice Democrats (progressive politics)
   - National Low Income Housing Coalition (housing)
   - Reach 3 advocacy groups, get 1 to test our platform

3. **Optimize for virality**:
   - A/B test Open Graph images
   - Test social proof messaging ("5,247 people" vs "Join 5,247 constituents")
   - Optimize share copy

**Success metric**: 1 template shared by advocacy group with 50K+ followers, 500 actions taken

---

### Month 3: Viral Optimization + Network Effects

**Build**:
1. **Viral mechanics**:
   - Post-action share prompts ("Share this with your followers")
   - Hashtag suggestions (#RentControl, #GreenNewDeal)
   - Twitter/Instagram-optimized share images

2. **Social proof amplification**:
   - "5,247 constituents in 23 swing districts have taken action"
   - "Representative [Name] has received 342 messages about this"
   - "This template is trending in your district"

3. **Network effect tracking**:
   - Referral tracking (who shared, how many clicked)
   - Viral coefficient measurement (each user brings X new users)
   - District-level heatmaps (which districts are engaging)

**Success metric**:
- 1 template goes viral (10K+ actions)
- Viral coefficient k > 1.0 (exponential growth)
- 3 advocacy groups actively using platform

---

## Privacy-Preserving Intelligence (The Value Prop for Advocates)

### What Advocacy Groups Get

**Dashboard showing**:
1. **Geographic intelligence**:
   - "12,000 constituents across 50 districts care about climate"
   - "CA-12 has 1,247 engaged constituents (highest)"
   - "15 swing districts have 200+ constituents each"

2. **Issue intelligence**:
   - "Housing templates: 25K actions across 100 districts"
   - "Climate templates: 18K actions across 80 districts"
   - "Healthcare templates: 30K actions across 120 districts"

3. **Temporal intelligence**:
   - "Housing engagement spiked 300% after rent increase news"
   - "Climate engagement steady at 1K actions/week"
   - "Healthcare engagement correlated with policy debates"

**What advocacy groups DON'T get**:
- ❌ Individual identities
- ❌ Addresses
- ❌ Email addresses
- ❌ Tracking across time
- ❌ Profiling

**Why this matters**:
- **Advocacy groups** want to know "where should we focus our $1M ad buy?"
- **We give them**: "15 swing districts with 200+ engaged constituents each"
- **We DON'T give them**: "Here are the 200 people in CA-12" (privacy-preserving)

---

## What Makes This Go Viral (The Psychology)

### The Emotional Triggers

**1. Anger** (primary driver):
- Housing crisis: "Rent is 60% of income, landlords are getting rich"
- Climate crisis: "We're destroying the planet for corporate profits"
- Healthcare crisis: "People dying because they can't afford insulin"

**2. Moral clarity**:
- "This is obviously wrong"
- "Someone should do something"
- "I can be that someone"

**3. Social proof**:
- "5,247 people already acted"
- "This is working"
- "I'm not alone"

**4. Efficacy**:
- "Takes 2 minutes"
- "Your rep will actually see this"
- "This creates real pressure"

**5. Identity**:
- "I'm the kind of person who takes action"
- "I care about this issue"
- "This reflects my values"

### The Sharing Dynamics

**Why people share**:
- **Signal values** ("I care about climate justice")
- **Call to action** ("You should do this too")
- **Social proof** ("5,247 people already acted")
- **Urgency** ("Act now before vote")

**What makes sharing easy**:
- **One-click share** (Twitter/Facebook/native)
- **Pre-written copy** ("I just told [Rep] to support [issue]")
- **Rich preview** (Open Graph image + description)
- **Social proof** ("Join 5,247 constituents")

---

## The Brutalist's Critique (Addressed)

### What They Got Right

**1. "You don't understand organizing"**
- **True**: We're not building organizing tools
- **But**: We're building viral civic engagement, which is different
- **KC tenant strike** (247 days, trust-based) vs **viral template** (2 minutes, social-based)

**2. "Timeline is fantasy for organizing"**
- **True**: Organizing takes years
- **But**: Viral templates can spread in weeks
- **We're not replacing KC Tenants**: We're building complementary infrastructure

**3. "You need to talk to users"**
- **True**: We need to validate with advocacy groups
- **Plan**: Month 2, partner with 3 advocacy groups, get 1 to test

### What They Got Wrong (Because They Misunderstood)

**1. "Anti-doxxing is fantasy at solo-dev scale"**
- **They thought**: Protecting individual organizers from targeted doxxing (hard)
- **We're actually doing**: Preventing templates from containing doxxing info (automated moderation, feasible)

**2. "You're building anonymous organizing tools"**
- **They thought**: Anonymous union cards, hiding from employers (impossible)
- **We're actually building**: Privacy-preserving aggregate intelligence (possible, valuable)

**3. "Power mapping is the only thing that works"**
- **They thought**: Databases are more important than crypto
- **We're building**: BOTH privacy-preserving intelligence AND power mapping (Phase 2)

---

## Success Metrics (Phase 1)

### Month 1 Metrics
- ✅ 10 templates with rich Open Graph previews
- ✅ Shareable URLs working (`/s/[slug]`)
- ✅ Social proof display ("X people have taken action")
- ✅ 3-layer moderation preventing doxxing

### Month 2 Metrics
- ✅ 1 advocacy group partnership (50K+ followers)
- ✅ 1 template shared by advocacy group
- ✅ 500 actions taken on partnered template
- ✅ Privacy-preserving analytics dashboard

### Month 3 Metrics
- ✅ 1 template viral (10K+ actions)
- ✅ Viral coefficient k > 1.0 (exponential growth)
- ✅ 3 advocacy groups actively using
- ✅ 50K+ aggregate actions across all templates

### What Success Looks Like
**End of Month 3**:
- 50K actions across 100 districts
- 10 high-quality templates on urgent issues
- 3 advocacy groups with 100K+ combined followers using platform
- 1 viral template proving the model works
- Privacy-preserving dashboard showing aggregate intelligence
- Media coverage: "New platform floods Congress with constituent messages"

---

## The Honest Assessment

### What We're Building

**NOT**: Organizing infrastructure (KC tenant strikes, union drives, multi-year campaigns)

**YES**: Viral civic engagement with privacy guarantees

**The difference**:
- **Organizing**: Requires trust, relationships, years (brutalist was right about this)
- **Viral civic engagement**: Requires emotional resonance, low friction, social proof (this we can build)

### What We Have

**95% of crypto infrastructure** (ZK proofs, Merkle trees, TEE):
- Privacy-preserving district verification ✅
- Anonymous aggregate intelligence ✅
- No individual tracking ✅

**95% of template infrastructure** (CodeMirror, moderation, sharing):
- 3-layer AI consensus moderation ✅
- Anti-doxxing via content filtering ✅
- Shareable URLs ✅
- Open Graph (needs optimization) ⚠️

**5% of advocacy partnerships**:
- Need to validate with advocacy groups ❌
- Need 1 viral template to prove model ❌
- Need network effects to kick in ❌

### What We Need

**Month 1**: Optimize viral infrastructure (Open Graph, social proof, sharing UX)

**Month 2**: Validate with advocacy groups (get 1 to test, get 500 actions)

**Month 3**: Prove viral model (1 template hits 10K actions, k > 1.0)

**The risk**: Advocacy groups don't adopt, templates don't go viral, model doesn't work

**The opportunity**: Templates DO go viral, k > 1.0, exponential growth, political pressure mounts

---

## Conclusion: Viral Civic Engagement, Not Organizing

**The brutalist brutalized our "organizing infrastructure"** - and they were right to.

**But we're not building organizing infrastructure** - we're building viral civic engagement.

**The difference**:
- KC tenant strike: 247 days, trust-based, material victories (rent caps)
- Viral template: 2 minutes, social-based, political pressure (constituent messages)

**Both are valuable. They're not the same thing.**

**Phase 1**: Build viral civic engagement (3 months, feasible)

**Phase 2**: Add power mapping database (6 months, advocacy groups want this)

**Phase 3**: Maybe add organizing tools (3 years, requires deep organizing expertise)

**For now**: Focus on viral civic engagement. Prove it works. Then expand.

**Success = 1 viral template proving the model + 3 advocacy groups actively using**

**That's enough for Phase 1.**
