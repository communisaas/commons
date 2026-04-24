# Commons Growth Strategy: From Civic Tool to Viral Movement

**Date**: 2025-01-08
**Status**: HISTORICAL / PARTIALLY SUPERSEDED
**Goal**: Transform grassroots civic action into self-sustaining viral growth

> **STATUS: HISTORICAL** — Written January 2025, before ZK infrastructure, debate markets, and voter-protocol existed. Core sharing thesis remains directionally valid. Revenue projections (Phase 2: "token appreciation", "challenge markets", "platform fees") are **superseded** by [`economics.md`](economics.md) and [`monetization-policy.md`](monetization-policy.md). Gamification proposals contradict the current design thesis: "Engagement tiers are structural, not gamified. Earned through civic labor, not badges" (`product-roadmap.md`). Read for the sharing/viral loop ideas; ignore the revenue and gamification sections.

---

## The Core Problem: Civic Action Doesn't Go Viral

**Current reality**:
- People send congressional messages → nothing visible happens
- No social proof of impact
- No reason to share
- No network effects
- Dead-end user experience

**Result**: Linear growth, high churn, no compounding returns

---

## The Strategic Pivot: Civic Action as Social Currency

### Core Insight: Make Every Action Shareable

**What if every civic message becomes a shareable artifact?**

When someone sends a message to Congress, they get:
1. **Public proof-of-action** (zero-knowledge verified)
2. **Shareable impact card** (Twitter/Instagram/TikTok optimized)
3. **Reputation score** (gamified civic engagement)
4. **Network visualization** (see who else took action)

**Viral loop**:
```
User sends message
  → Gets shareable card: "I just told my rep about rent prices 📊"
  → Posts to Twitter/Instagram/TikTok
  → Friends see: "Oh, I can do that too" + template link
  → Friends click, land on Commons
  → New users send messages
  → Repeat
```

---

## Phase 1: Shareable Impact Cards — DESIGN COMPLETE, NOT YET IMPLEMENTED

### What We Build

**After sending a congressional message, user gets**:

```
┌─────────────────────────────────────────────┐
│  ✅ Message Delivered to Rep. Nancy Pelosi  │
│                                             │
│  📊 Subject: Affordable Housing Crisis      │
│  📍 San Francisco, CA-11                    │
│  🗓️  January 8, 2025                        │
│                                             │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                             │
│  🔒 Verified via zero-knowledge proof       │
│  🏆 Civic Action #47 · 127 reputation pts   │
│                                             │
│  [Share on Twitter] [Share on Instagram]    │
│  [Copy Template Link]                       │
│                                             │
│  "Took 30 seconds. Join me → [link]"       │
└─────────────────────────────────────────────┘
```

**Technical implementation**:

1. **Impact card generator** (Canvas API):
   - Beautiful, tweet-optimized (1200x628px)
   - Minimal text, maximum visual impact
   - Customizable colors/themes
   - Zero-knowledge proof badge

2. **One-click sharing**:
   - Pre-filled tweet with card + template link
   - Instagram story template (9:16 format)
   - TikTok caption template
   - WhatsApp/SMS share

3. **Template link tracking**:
   - Unique referral codes per user
   - Track conversions: card view → template use
   - Leaderboard: "Top 10 organizers this week"

**Files to create**:
- `/src/lib/components/social/ImpactCard.svelte` - Card generator
- `/src/lib/components/social/ShareButtons.svelte` - One-click sharing
- `/src/routes/api/social/generate-card/+server.ts` - Server-side canvas rendering
- `/src/routes/api/social/track-referral/+server.ts` - Referral tracking

**Schema additions** (Convex `convex/schema.ts`):
```typescript
shareableCards: defineTable({
  userId: v.id('users'),
  templateId: v.id('templates'),
  deliveryId: v.id('campaignDeliveries'), // Proof of delivery

  // Card metadata
  imageUrl: v.string(),            // Generated card image
  shareCount: v.number(),
  viewCount: v.number(),
  conversionCount: v.number(),

  // Referral tracking
  referralCode: v.string(),
  referredUsers: v.array(v.id('users')),
})
  .index('by_user', ['userId'])
  .index('by_referral_code', ['referralCode']) // unique enforced at mutation layer
```

### Why This Works

**Psychological triggers**:
- ✅ **Social proof**: "127 people in SF already did this"
- ✅ **FOMO**: "Your neighbors are taking action, are you?"
- ✅ **Status**: "I'm a civic action leader (47 actions)"
- ✅ **Simplicity**: "Took 30 seconds, you can too"

**Growth mechanics**:
- ✅ **Viral coefficient**: Each user brings 0.3-0.5 new users (industry standard for social sharing)
- ✅ **Network effects**: More users = more templates = more value
- ✅ **Compounding**: Every action creates a shareable card, increasing exposure

**Why different from existing civic tech**:
- Resistbot: No visual sharing (SMS only)
- 5 Calls: No proof of action
- Democracy.io: No social features
- Countable: No referral tracking

**We're the first to make civic action inherently shareable.**

---

## Phase 2: Template Discovery via Social 🔮 SPECULATIVE

> **STATUS: SPECULATIVE** — Not implemented. No timeline commitment. Included as strategic exploration, not a roadmap item.

### The Problem: Template Discovery Sucks

**Current flow**:
```
User lands on homepage
  → Sees generic templates
  → "Meh, not relevant to me"
  → Leaves
```

**New flow with social discovery**:
```
User sees friend's impact card on Twitter
  → "Oh, Sarah sent a message about housing"
  → Clicks template link
  → Lands on pre-filled template (Sarah's issue)
  → "This is exactly what I care about!"
  → Sends message in 30 seconds
  → Gets own shareable card
  → Posts to social
  → Repeat
```

### What We Build

**Social-optimized template pages**:

1. **Template landing pages** (`/t/[slug]`):
   - SEO-optimized title: "Tell Your Rep: Stop Rent Gouging in San Francisco"
   - Open Graph tags (Twitter card preview)
   - Social proof: "1,247 people sent this message"
   - Recent senders: "Sarah, Mike, and 15 others sent this today"
   - One-click send (OAuth required)

2. **Template collections** (`/c/[category]`):
   - "Housing Crisis in California"
   - "Healthcare Affordability"
   - "Climate Action Now"
   - Each collection has social sharing

3. **Trending templates**:
   - Real-time updates based on send volume
   - "🔥 Trending in San Francisco: [template]"
   - Algorithm: spike detection (3x normal send rate)

**Files to create**:
- `/src/routes/t/[slug]/+page.svelte` - Template landing page
- `/src/routes/c/[category]/+page.svelte` - Template collections
- `/src/lib/components/template/TrendingBadge.svelte` - Trending indicator
- `/src/lib/components/template/SocialProof.svelte` - "X people sent this"

**Data queries** (Convex):
```typescript
// Trending templates (spike detection)
// Count recent submissions per template via by_template_created index,
// then rank client-side or via an aggregation.
const recent = await ctx.db
  .query('submissions')
  .withIndex('by_created_at', q => q.gte('createdAt', yesterday))
  .collect();

const countsByTemplate = new Map<Id<'templates'>, number>();
for (const sub of recent) {
  countsByTemplate.set(sub.templateId, (countsByTemplate.get(sub.templateId) ?? 0) + 1);
}

const trendingIds = [...countsByTemplate.entries()]
  .sort(([, a], [, b]) => b - a)
  .slice(0, 10)
  .map(([id]) => id);

const trending = await Promise.all(trendingIds.map(id => ctx.db.get(id)));
```

### Why This Works

**Removes friction**:
- No browsing templates
- Friend pre-validated relevance
- Social trust (if Sarah cares, I care)
- One-click action

**Viral mechanics**:
- Every template is a landing page
- Every landing page converts visitors
- Every conversion creates shareable card
- Every card brings more visitors

**SEO benefits**:
- `/t/stop-rent-gouging-sf` ranks for "rent gouging san francisco"
- Social proof increases dwell time
- Backlinks from Twitter/Instagram
- Google sees engagement signals

---

## Phase 3: Gamification & Leaderboards 🔮 SPECULATIVE

> **STATUS: SPECULATIVE** — Not implemented. No timeline commitment. Included as strategic exploration, not a roadmap item.

### The Hook: Civic Engagement as Competition

**Current problem**:
- Civic action feels like screaming into void
- No feedback loop
- No sense of progress
- No community

**Solution: Make it a game**

### Leaderboard System

**Global leaderboards**:
1. **Top organizers** (by referrals):
   - "Sarah brought 47 people to Commons"
   - "Unlock 'Community Organizer' badge at 50 referrals"

2. **Top cities** (by per-capita action):
   - "San Francisco: 2.3% of population took action"
   - "Burlington, VT: 3.1% of population (🥇 #1)"

3. **Top issues** (by template send count):
   - "Housing: 12,483 messages sent"
   - "Climate: 9,271 messages sent"

**Personal dashboard**:
```
┌─────────────────────────────────────────────┐
│  Your Civic Impact                          │
│                                             │
│  🏆 Reputation: 127 points                  │
│  📊 Rank: #42 in San Francisco              │
│  🎯 Next badge: Community Organizer (47/50) │
│                                             │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                             │
│  Recent Actions:                            │
│  ✅ Rent Control - Jan 8                    │
│  ✅ Climate Bill - Jan 5                    │
│  ✅ Healthcare - Jan 2                      │
│                                             │
│  People You've Brought:                     │
│  👥 Sarah, Mike, Alex (+3 more)             │
│                                             │
│  [Share Your Impact] [Invite Friends]       │
└─────────────────────────────────────────────┘
```

**Badge system**:
- 🥉 **Civic Starter**: 1 message sent
- 🥈 **Engaged Citizen**: 5 messages sent
- 🥇 **Activist**: 20 messages sent
- 🏆 **Community Organizer**: 50 referrals
- 💎 **Movement Leader**: 200 referrals

**Schema** (Convex `convex/schema.ts`):
```typescript
userStats: defineTable({
  userId: v.id('users'),

  // Action stats
  messagesSent: v.number(),
  reputationPoints: v.number(),
  referralCount: v.number(),

  // Rankings
  cityRank: v.optional(v.number()),
  nationalRank: v.optional(v.number()),

  // Badges
  badges: v.array(v.string()), // Array of badge IDs
})
  .index('by_user', ['userId']),

badges: defineTable({
  name: v.string(),
  description: v.string(),
  requirement: v.object({ messagesSent: v.optional(v.number()) }),
  icon: v.string(),             // Emoji or icon name
  rarity: v.union(              // common, uncommon, rare, legendary
    v.literal('common'),
    v.literal('uncommon'),
    v.literal('rare'),
    v.literal('legendary'),
  ),
}),
```

### Why This Works

**Engagement loops**:
- Check dashboard daily (see rank)
- Send messages to climb leaderboard
- Invite friends to get badges
- Compare with friends (social competition)

**Retention mechanics**:
- **Day 1**: Send first message, get "Civic Starter" badge
- **Day 3**: See "You're #147 in SF, send 2 more messages to reach #100"
- **Day 7**: "You've brought 3 people! 2 more for Community Organizer badge"
- **Day 14**: "You're now #42 in SF! Share your impact?"
- **Day 30**: "You're a Movement Leader! 🏆"

**Social proof amplification**:
- Leaderboard screenshots are shareable
- "I'm #1 in my city for civic action" → viral post
- Badge announcements: "Just unlocked Movement Leader! 💎"

---

## Phase 4: Network Visualization 🔮 SPECULATIVE

> **STATUS: SPECULATIVE** — Not implemented. No timeline commitment. Included as strategic exploration, not a roadmap item.

### The Vision: See Your Impact Ripple Out

**Concept**: Show users the network effect of their actions

**Interactive graph**:
```
        You (center)
       /  |  \
    Sarah Mike Alex
    / |    |    \
  Tom Lisa ... ...
```

**Features**:
1. **Your network tree**:
   - See everyone you brought to Commons
   - See everyone they brought
   - 3 levels deep (you → friends → friends-of-friends)

2. **Impact metrics**:
   - "You've influenced 47 civic actions"
   - "Your network sent 127 congressional messages"
   - "Your ripple effect: 3 degrees of separation"

3. **Live updates**:
   - "Sarah just brought Mike!" (notification)
   - Watch network grow in real-time
   - Celebrate milestones: "Your network hit 100 people!"

**Technical implementation**:
- D3.js force-directed graph
- WebSocket for live updates
- Graph database (Neo4j?) or Postgres with recursive CTEs

**Files to create**:
- `/src/lib/components/network/NetworkGraph.svelte` - D3.js visualization
- `/src/routes/api/network/tree/+server.ts` - Fetch network data
- `/src/lib/stores/network.ts` - Real-time network updates

### Why This Works

**Psychological impact**:
- **Visible impact**: "I didn't just send a message, I started a movement"
- **Pride**: "Look at this network I built"
- **Motivation**: "I want to grow this bigger"

**Shareability**:
- Network visualization screenshots
- "I built a network of 47 civic activists" → viral post
- Visual proof of impact

**Retention**:
- Check network graph daily
- See new nodes appear
- Feel ownership of growing movement

---

## Growth Model Projections (Speculative)

### Viral Coefficient Calculation

**Assumptions**:
- 30% of users share impact card (industry standard for social features)
- 20% of people who see card click through (Twitter average)
- 50% of click-throughs send a message (high-intent traffic)

**Math**:
```
Viral coefficient = 0.30 × 0.20 × 0.50 = 0.03

Wait, that's terrible. Let me recalculate with better assumptions:

Viral coefficient = (% who share) × (click-through rate) × (conversion rate)
                  = 0.50 × 0.15 × 0.40
                  = 0.03

Still bad. Need to increase sharing rate.

BETTER MODEL (with gamification):
- 70% share impact card (because of badges/leaderboards)
- 15% click-through (Twitter average)
- 60% conversion (social proof + pre-filled template)

Viral coefficient = 0.70 × 0.15 × 0.60 = 0.063

That's 6.3% growth per user, which means:
- 100 users → 106 users (next cycle)
- Still not viral (need >1.0 for exponential growth)

ULTIMATE MODEL (with all features):
- 80% share (gamification + network visualization)
- 20% click-through (optimized cards)
- 70% conversion (social proof + one-click send)

Viral coefficient = 0.80 × 0.20 × 0.70 = 0.112

That's 11.2% growth per user.

To hit viral coefficient >1.0:
- Need 100% sharing rate (impossible)
- OR 50% click-through (impossible)
- OR multiple sharing channels

REALISTIC MULTI-CHANNEL MODEL:
- Twitter: 0.70 × 0.15 × 0.60 = 0.063
- Instagram: 0.50 × 0.10 × 0.50 = 0.025
- WhatsApp: 0.40 × 0.30 × 0.70 = 0.084
- Total: 0.172 (17.2% growth per user)

Still not viral, but sustainable growth.
```

**Reality check**: Civic tech rarely achieves viral growth (k>1.0)

**Exceptions**:
- Ice Bucket Challenge (k=2.0) - but not civic tech, just viral
- Marriage Equality memes (k=1.5) - tied to Supreme Court decision
- George Floyd protests (k=3.0+) - reactive to event

**Sustainable growth strategy**:
- Aim for k=0.3-0.5 (compound growth)
- Combine with SEO (organic acquisition)
- Partner with organizers (direct outreach)
- PR/media coverage (step-function jumps)

---

## Implementation Roadmap (Speculative — no timeline commitment)

### Phase 1: Shareable Cards (Weeks 1-2)

**Week 1**:
- [ ] Impact card generator (Canvas API)
- [ ] Database schema for ShareableCard
- [ ] Referral tracking system
- [ ] Share button UI

**Week 2**:
- [ ] Twitter card optimization
- [ ] Instagram story templates
- [ ] Conversion tracking
- [ ] A/B test card designs

**Success metrics**:
- 30%+ of users share impact card
- 10%+ click-through rate on shared cards
- 40%+ conversion rate (card view → message sent)

### Phase 2: Social Discovery (Weeks 3-6)

**Week 3-4**:
- [ ] Template landing pages (`/t/[slug]`)
- [ ] SEO optimization (meta tags, structured data)
- [ ] Social proof display ("1,247 people sent this")
- [ ] Open Graph tags for Twitter/Facebook previews

**Week 5-6**:
- [ ] Template collections (`/c/[category]`)
- [ ] Trending algorithm (spike detection)
- [ ] Real-time send counts
- [ ] Category pages with SEO

**Success metrics**:
- 50%+ of new users come via template links (not homepage)
- 60%+ conversion rate on template landing pages
- 10%+ of templates go "trending" each week

### Phase 3: Gamification (Weeks 7-12)

**Week 7-8**:
- [ ] UserStats database schema
- [ ] Badge system (5 initial badges)
- [ ] Personal dashboard
- [ ] Reputation point calculation

**Week 9-10**:
- [ ] Leaderboards (global, city, issue)
- [ ] Ranking algorithm (daily updates)
- [ ] Badge unlock notifications
- [ ] Shareable achievement cards

**Week 11-12**:
- [ ] Badge progression UI
- [ ] Leaderboard page
- [ ] Achievement sharing
- [ ] A/B test gamification variants

**Success metrics**:
- 70%+ of users check dashboard weekly
- 50%+ of users share badge unlocks
- 30%+ increase in repeat engagement

### Phase 4: Network Viz (Weeks 13-20)

**Week 13-16**:
- [ ] Network graph database queries
- [ ] D3.js visualization
- [ ] WebSocket real-time updates
- [ ] Network metrics calculation

**Week 17-20**:
- [ ] Interactive graph controls
- [ ] Network milestone notifications
- [ ] Shareable network screenshots
- [ ] Mobile-optimized view

**Success metrics**:
- 40%+ of users view network graph
- 60%+ share network visualization
- 20%+ increase in referral rate

---

## What Success Looks Like

### 6 Months Post-Launch

**User metrics**:
- 10,000 active users
- 40% share impact cards
- 15% conversion rate from shared cards
- 60% monthly retention

**Growth metrics**:
- 20% month-over-month growth (organic + viral)
- Viral coefficient k=0.4 (sustainable growth)
- 50% of new users from social referrals

**Engagement metrics**:
- 3 messages sent per user (median)
- 70% of users return within 30 days
- 30% of users invite friends

### 12 Months Post-Launch

**User metrics**:
- 100,000 active users
- 50% share impact cards
- 20% conversion rate from shared cards
- 70% monthly retention

**Growth metrics**:
- 30% month-over-month growth
- Viral coefficient k=0.6
- 60% of new users from social referrals

**Engagement metrics**:
- 5 messages sent per user (median)
- 80% of users return within 30 days
- 40% of users invite friends

**Revenue (Phase 2)** — *SUPERSEDED: See [`economics.md`](economics.md) for current revenue model. No token exists. Revenue comes from org subscriptions metered on verified actions.*:
- ~~$1M monthly transaction volume (challenge markets)~~
- ~~$50K monthly revenue (platform fees)~~
- ~~$200K monthly revenue (token appreciation)~~

---

## Critical Success Factors

### What Must Be True

1. **Sharing is frictionless**:
   - One-click share to Twitter/Instagram
   - Beautiful, optimized cards
   - Pre-filled text

2. **Templates are high-quality**:
   - Curated by experts
   - Locally relevant
   - Timely (tied to news/events)

3. **Zero-knowledge proofs work**:
   - Fast (<5 seconds)
   - Reliable (99.9% success rate)
   - Privacy-preserving (no address leakage)

4. **OAuth is seamless**:
   - Google/Twitter login
   - One-click after first auth
   - No password friction

5. **Delivery is verified**:
   - Proof from CWC API
   - Transparent delivery status
   - Error handling (retries)

### What Could Kill Us

**Technical failure**:
- Zero-knowledge proofs too slow (>30 seconds)
- Delivery failures (Congressional offices block)
- OAuth issues (providers lock us out)

**Product failure**:
- Sharing doesn't work (bad cards, no virality)
- Templates irrelevant (poor curation)
- Gamification feels manipulative

**Market failure**:
- Users don't care about civic action
- Social proof doesn't motivate
- Network effects don't emerge

**Competitive failure**:
- Resistbot adds social features
- New entrant with better UX
- Congressional offices ban automated tools

---

## Next Steps

### Immediate Actions (This Week)

1. **User research** (2 days):
   - Interview 10 existing users
   - "Would you share your civic action on social media?"
   - "What would make you invite friends?"
   - "What motivates you to take civic action?"

2. **Competitive analysis** (1 day):
   - Audit Resistbot, 5 Calls, Democracy.io
   - What social features exist?
   - What sharing mechanics work?

3. **Design mockups** (2 days):
   - Impact card designs (3 variants)
   - Dashboard UI
   - Network visualization

### Week 2-3: MVP Development

1. **Impact card generator**
2. **Referral tracking**
3. **Share buttons**
4. **Template landing pages**

### Week 4: Launch & Iterate

1. **Beta launch** to 100 users
2. **Measure**: sharing rate, conversion rate, viral coefficient
3. **Iterate**: optimize card design, share copy, template pages
4. **Scale**: if k>0.3, roll out to all users

---

## Conclusion: The Path to Viral Civic Tech

**Civic action doesn't have to be invisible.**

By making every action shareable, we transform Commons from a tool into a movement.

**The flywheel**:
1. User sends message
2. Gets beautiful shareable card
3. Posts to social media
4. Friends see and join
5. Network effects compound
6. Civic action becomes status symbol

**The vision**:
- 1M Americans using Commons
- 100K civic messages sent per month
- Reputation as trusted civic infrastructure
- ~~Foundation for token-based governance (Phase 2)~~ *SUPERSEDED: No token. See [`monetization-policy.md`](monetization-policy.md).*

**This is how we make democracy participatory again.**

Not through top-down campaigns.
Not through guilt-based appeals.
But through social proof, verified identity, and network effects.

*Note: Original text referenced "gamification" — current design thesis explicitly rejects gamification in favor of structural engagement tiers earned through civic labor.*
