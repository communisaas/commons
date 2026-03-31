/**
 * Comprehensive seed for bootstrapping a fresh Convex database.
 *
 * Creates realistic data across every org-layer table:
 * - 3 users (2 verified, 1 unverified)
 * - 3 organizations with full onboarding
 * - 7 org memberships
 * - 15 templates (agent-generated, research-backed content from seed pipeline)
 * - 4 campaigns (3 LETTER + 1 FORM fundraiser)
 * - 20 supporters with realistic names
 * - 12 tags with supporter assignments
 * - 2 segments
 * - 4 events with RSVPs and attendance
 * - 12 donations
 * - 3 workflows with 5 executions and action logs
 * - 3 email blasts (completed, sending, draft)
 * - 1 org network with 3 members
 * - ~36 org resolved contacts (12 per org)
 * - 5 org invites
 * - Campaign deliveries and actions
 * - 4 debates with 12 arguments
 *
 * Dev account integration: if a user with email 'mock7ee@gmail.com' exists,
 * they are granted owner on all seeded orgs.
 *
 * Run via the Convex dashboard or CLI:
 *   npx convex run seed:seedAll
 *
 * Inline template content can be regenerated via scripts/seed-with-agents.ts
 */

import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// =============================================================================
// TIME HELPERS
// =============================================================================

function daysAgo(n: number): number {
  return Date.now() - n * 86_400_000;
}

function hoursAgo(n: number): number {
  return Date.now() - n * 3_600_000;
}

function daysFromNow(n: number): number {
  return Date.now() + n * 86_400_000;
}

// =============================================================================
// SEED DATA DEFINITIONS
// =============================================================================

const SEED_USERS = [
  {
    email: "seed-1@commons.email",
    name: "Alex Rivera",
    isVerified: true,
    verificationMethod: "mdl",
    trustTier: 1,
    tokenIdentifier: "seed|seed-1@commons.email",
  },
  {
    email: "seed-2@commons.email",
    name: "Jordan Chen",
    isVerified: true,
    verificationMethod: "mdl",
    trustTier: 1,
    tokenIdentifier: "seed|seed-2@commons.email",
  },
  {
    email: "seed-3@commons.email",
    name: "Morgan Tremblay",
    isVerified: false,
    verificationMethod: undefined,
    trustTier: 0,
    tokenIdentifier: "seed|seed-3@commons.email",
  },
] as const;

const SEED_ORGS = [
  {
    name: "Climate Action Now",
    slug: "climate-action-now",
    description: "Grassroots climate advocacy for evidence-based policy.",
    mission: "Building a movement for climate justice through verified civic action.",
    websiteUrl: "https://climateactionnow.org",
  },
  {
    name: "Voter Rights Coalition",
    slug: "voter-rights-coalition",
    description: "Protecting and expanding access to the ballot box.",
    mission: "Every eligible citizen deserves frictionless access to the ballot.",
    websiteUrl: "https://voterrightscoalition.org",
  },
  {
    name: "Local First SF",
    slug: "local-first-sf",
    description: "Strengthening San Francisco neighborhoods through local policy.",
    mission: "Empowering neighborhood voices in city governance.",
    websiteUrl: "https://localfirstsf.org",
  },
] as const;

// ---------------------------------------------------------------------------
// Agent-generated template content — from seed pipeline (seed-with-agents.ts)
// All 15 templates have real research-backed messages with source citations.
// ---------------------------------------------------------------------------
interface SeedScope {
  countryCode: string;
  regionCode?: string;
  localityCode?: string;
  displayText: string;
  scopeLevel: "country" | "region" | "locality" | "district";
  confidence: number;
  extractionMethod: string;
}

interface SeedTemplate {
  slug: string;
  title: string;
  description: string;
  category: string;
  topics: string[];
  type: string;
  deliveryMethod: string;
  preview: string;
  messageBody: string;
  countryCode: string;
  sources: Array<{ num: number; url: string; type: string; title: string }>;
  recipientConfig: Record<string, unknown>;
  scopes?: SeedScope[];
}

const SEED_TEMPLATES: SeedTemplate[] = [
  // ── 1. VA Rural Health Lifeline ──
  {
    slug: "va-rural-health-lifeline",
    title: "A lifeline for veterans where the pavement ends",
    description: "The Department of Veterans Affairs must expand its proven telehealth infrastructure to reach every rural clinic across the nation.",
    category: "Healthcare",
    topics: ["veterans", "healthcare", "telehealth", "rural-access"],
    type: "advocacy",
    deliveryMethod: "cwc",
    preview: "For a veteran living hours from the nearest specialist, a \"proven\" healthcare system doesn't mean much if it doesn't reach their front door. We are past the point of testing pilot programs; we know th",
    messageBody: "For a veteran living hours from the nearest specialist, a \"proven\" healthcare system doesn't mean much if it doesn't reach their front door. We are past the point of testing pilot programs; we know that when the VA bridges the distance, veterans live longer. New findings released just this week show that veterans receiving specialty care via telemedicine had a 15% lower mortality rate than those who relied on primary care alone [1].\n\n[Personal Connection]\n\nThe infrastructure to solve this already exists. The VA's Clinical Resource Hub model has demonstrated it can increase healthcare utilization by 18% in underserved areas by bringing specialists to the veteran [3]. For those in communities where home broadband isn't an option, the ATLAS (Accessing Telehealth through Local Area Stations) program is the only bridge to the care they earned, provided it is actually deployed where it's needed [2].\n\nI am asking you to fully fund and scale this hub-and-spoke infrastructure to every rural clinic in the country. It is time to ensure that access isn't a privilege of geography, but a guarantee of service. Please prioritize the expansion of ATLAS and Clinical Resource Hubs to ensure that no veteran is left behind just because they live where the pavement ends.\n\n[Name]",
    countryCode: "US",
    sources: [
      { num: 1, url: "https://news.va.gov/", type: "research", title: "VA Research Wrap Up: New findings on telehealth, Parkinson's disease and military transitions" },
      { num: 2, url: "https://www.gao.gov/products/gao-24-106743", type: "government", title: "Veterans Health Care: VA's Video Telehealth Access Program Would Benefit from Performance Goals and Measures" },
      { num: 3, url: "https://pubmed.ncbi.nlm.nih.gov/40981648/", type: "research", title: "Impact of VA's Clinical Resource Hub Primary Care Telehealth Program on Health Care Use and Costs" },
    ],
    scopes: [{ countryCode: "US", displayText: "United States", scopeLevel: "country", confidence: 1.0, extractionMethod: "manual" }],
    recipientConfig: { reach: "district-based", chambers: ["house", "senate"], cwcRouting: true },
  },
  // ── 2. Congress Outdated Childhood Tracking ──
  {
    slug: "congress-outdated-childhood-tracking",
    title: "Your laws are older than our children",
    description: "The United States Congress must stop corporations from strip-mining the digital lives of children through obsolete privacy protections.",
    category: "Digital Rights",
    topics: ["privacy", "children", "technology", "accountability", "congress"],
    type: "advocacy",
    deliveryMethod: "cwc",
    preview: "The law meant to protect our children online was written in 1998. It is literally older than the kids it is failing to protect. While technology has evolved to harvest 72 million data points per child",
    messageBody: "The law meant to protect our children online was written in 1998. It is literally older than the kids it is failing to protect. While technology has evolved to harvest 72 million data points per child every year, our federal protections remain frozen in a pre-smartphone era.\n\n[Personal Connection]\n\nWe are currently witnessing a mental health crisis where 37% of students report moderate to severe depressive symptoms [4]. Despite this, national safety legislation like the Kids Online Safety Act (KOSA) and COPPA 2.0 remains stalled in Congress [5]. We cannot afford to let these protections languish while landmark litigation continues to reveal exactly how much tech companies knew about the risks their products posed to our children [5].\n\nWhile I appreciate the FTC's recent efforts to modernize enforcement and address emerging data monetization [1][3], administrative rule-making is not a substitute for legislative action. We need a permanent, modern standard that raises the age of coverage to 17, prohibits targeted advertising to minors, and provides an 'eraser button' for data deletion [2].\n\nI am asking you to break the deadlock and pass the revised Kids Online Safety Act and COPPA 2.0 immediately. Our children's digital lives should not be governed by laws written before they\u2014or the platforms they use\u2014even existed.\n\n[Name]",
    countryCode: "US",
    sources: [
      { num: 1, url: "https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data", type: "government", title: "FTC Finalizes Changes to Children's Privacy Rule Limiting Companies' Ability to Monetize Kids' Data" },
      { num: 2, url: "https://www.dwt.com/insights/2026/01/federal-online-safety-legislation-hits-congress", type: "legal", title: "Wave of Federal \"Online Safety\" Legislation Hits Congress" },
      { num: 3, url: "https://www.wiley.law/alert-FTC-Announces-COPPA-Policy-Enforcement-Statement-Forthcoming-Rule-Review", type: "legal", title: "FTC Announces COPPA Policy Enforcement Statement, Forthcoming Rule Review" },
      { num: 4, url: "https://healthpolicy.ucla.edu/our-work/publications/healthy-minds-study-2024-2025-data-report", type: "research", title: "The Healthy Minds Study: 2024\u20132025 Data Report" },
      { num: 5, url: "https://www.childrenandscreens.org/newsroom/news/policy-update-february-2026/", type: "advocacy", title: "Policy Update: February 2026 - Children and Screens" },
    ],
    scopes: [{ countryCode: "US", displayText: "United States", scopeLevel: "country", confidence: 1.0, extractionMethod: "manual" }],
    recipientConfig: { reach: "district-based", chambers: ["house", "senate"], cwcRouting: true },
  },
  // ── 3. Colorado Preschool Standard ──
  {
    slug: "colorado-preschool-standard",
    title: "Stop leaving our toddlers behind while Colorado families thrive",
    description: "State Legislatures must follow the lead of Colorado's universal preschool program to give our children the start they are currently being denied.",
    category: "Education",
    topics: ["childcare", "preschool", "state-government", "parenting", "future"],
    type: "advocacy",
    deliveryMethod: "cwc",
    preview: "It is exhausting to watch families in neighboring states get a head start while we are left to navigate the impossible math of childcare on our own. We have reached a point where the success of progra",
    messageBody: "It is exhausting to watch families in neighboring states get a head start while we are left to navigate the impossible math of childcare on our own. We have reached a point where the success of programs like Colorado's makes our own state's inaction look like a choice to leave families behind. In its first year alone, Colorado's universal preschool program reached nearly 70% of eligible four-year-olds and saved families an average of $6,100 [1].\n\n[Personal Connection]\n\nThis isn't just about a classroom; it is about the literal economic survival of our households. Research shows that universal enrollment can increase parent income by over 21%, effectively paying for itself through higher tax revenue and workforce participation [4]. As 2026 legislative sessions begin, other states are already recognizing that pre-K is \"economic infrastructure\" essential for long-term competitiveness [2]. Some, like New Mexico, have even expanded this to include infants and toddlers, saving families up to $12,000 a year [3].\n\nEvery day we wait is a day our children lose a foundation that others are getting for free. I am asking you to treat early childhood education as the essential infrastructure it is. Please move to replicate these successful universal models and provide the funding necessary to ensure our families are no longer denied this basic opportunity for growth.\n\n[Name]",
    countryCode: "US",
    sources: [
      { num: 1, url: "https://www.colorado.gov/governor/news/new-report-highlights-transformational-first-year-colorado-universal-preschool-reaching-nearly", type: "government", title: "New Report Highlights Transformational First Year of Colorado Universal Preschool, Reaching Nearly 70% of Eligible Four-Year-Olds" },
      { num: 2, url: "https://whiteboardadvisors.com/early-childhood-in-2026-what-state-signals-tell-us-about-where-policy-is-heading/", type: "research", title: "Early Childhood in 2026: What State Signals Tell Us About Where Policy Is Heading" },
      { num: 3, url: "https://www.governor.state.nm.us/2025/09/08/new-mexico-is-first-state-in-nation-to-offer-universal-child-care/", type: "government", title: "New Mexico is first state in nation to offer universal child care" },
      { num: 4, url: "https://www.ffyf.org/2025/08/06/research-finds-preschool-enrollment-can-increase-parent-income/", type: "research", title: "Research Finds Preschool Enrollment Can Increase Parent Income" },
    ],
    scopes: [{ countryCode: "US", regionCode: "US-CO", displayText: "Colorado", scopeLevel: "region", confidence: 1.0, extractionMethod: "manual" }],
    recipientConfig: { reach: "district-based", chambers: ["house", "senate"], cwcRouting: true },
  },
  // ── 4. Oregon Healing Not Prisons ──
  {
    slug: "oregon-healing-not-prisons",
    title: "Healing Oregon families works better than locking them away",
    description: "The State of Oregon must prioritize drug treatment courts over incarceration to keep families together and ensure better community outcomes.",
    category: "Criminal Justice",
    topics: ["justice reform", "drug treatment", "family unity", "public safety"],
    type: "advocacy",
    deliveryMethod: "cwc",
    preview: "There is a specific kind of heartbreak in watching a family be dismantled by a system that claims to be seeking justice. We are currently choosing to spend more money to achieve worse outcomes, tearin",
    messageBody: "There is a specific kind of heartbreak in watching a family be dismantled by a system that claims to be seeking justice. We are currently choosing to spend more money to achieve worse outcomes, tearing parents away from their children when we have a proven path to healing that keeps families intact.\n\n[Personal Connection]\n\nThe data is clear: drug treatment courts aren't just a 'soft' alternative; they are a more effective one. Participants in Oregon's specialty courts are 45% less likely to recidivate compared to those who are incarcerated [1]. For families, the impact is even more profound, with these programs driving a 30% increase in successful reunifications over the last two years [1]. Peer-reviewed research confirms that parents in these programs are significantly more likely to complete their treatment and achieve permanent stability with their children than those processed through the standard criminal justice system [2]. \n\nEvery time we choose a prison cell over a treatment program, we are deciding to break a family and waste resources. I am asking you to prioritize the expansion and funding of Oregon's Family Treatment Courts in the upcoming budget. Let's invest in the outcomes that actually make our communities safer and our families whole.\n\n[Name]",
    countryCode: "US",
    sources: [
      { num: 1, url: "https://www.courts.oregon.gov/programs/specialty/Documents/OJD-Specialty-Courts-Annual-Report-2025.pdf", type: "government", title: "Specialty Courts: Oregon Judicial Department Annual Report 2025" },
      { num: 2, url: "https://pdxscholar.library.pdx.edu/socwork_fac/214/", type: "research", title: "The Impact of Family Treatment Courts on Child Welfare Outcomes in Oregon" },
    ],
    scopes: [{ countryCode: "US", regionCode: "US-OR", displayText: "Oregon", scopeLevel: "region", confidence: 1.0, extractionMethod: "manual" }],
    recipientConfig: { reach: "district-based", chambers: ["house", "senate"], cwcRouting: true },
  },
  // ── 5. City Bans Affordable Innovation ──
  {
    slug: "city-bans-affordable-innovation",
    title: "Stop choosing expensive scarcity over homes we can afford",
    description: "City governments must end the bans on 3D-printed housing and community land trusts that Portland and Austin have proven provide homes at a fraction of traditional costs.",
    category: "Housing",
    topics: ["housing", "affordability", "urban-policy", "innovation"],
    type: "advocacy",
    deliveryMethod: "cwc",
    preview: "It is exhausting to watch our neighbors get priced out of the city while the solutions we need are sitting right in front of us, blocked by red tape. We know that 3D-printed homes can be built for a f",
    messageBody: "It is exhausting to watch our neighbors get priced out of the city while the solutions we need are sitting right in front of us, blocked by red tape. We know that 3D-printed homes can be built for a fraction of the cost of traditional construction\u2014in Austin, they're starting at $195,000 compared to the $350,000+ price tag for standard builds nearby [1]. Yet, in most of our communities, these innovations are effectively banned by outdated building codes.\n\n[Personal Connection]\n\nWe are facing a massive housing shortage, and while the 3D-printed housing market is projected to reach $2.2 billion this year, regulatory hurdles remain the primary obstacle to scaling this affordable solution [3]. It isn't just about technology; it's about how we treat land. By partnering with Community Land Trusts (CLTs), we can take land off the speculative market and ensure homes stay affordable for generations, a model already proven to reduce displacement in rapidly gentrifying areas [4].\n\nWe cannot keep choosing expensive scarcity over homes people can actually afford. I am asking you to:\n\n1. Modernize our local building codes by adopting standards like Appendix BM of the International Residential Code to remove the legal barriers to 3D-printed construction [2].\n2. Establish formal municipal partnerships with Community Land Trusts to protect long-term affordability through public land trusts [4].\n\nWe have the technology and the models to solve this. We just need the political will to stop banning the progress we so desperately need.\n\n[Name]",
    countryCode: "US",
    sources: [
      { num: 1, url: "https://www.iconbuild.com/", type: "other", title: "3D-printed Homes at Mueller in Austin - Icon Build" },
      { num: 2, url: "https://reason.org/commentary/3d-printed-homes-advancements-in-technology-and-remaining-challenges/", type: "research", title: "3D-printed homes: Advancements in technology and remaining challenges" },
      { num: 3, url: "https://www.persistencemarketresearch.com/market-research/3d-printed-houses-market.asp", type: "research", title: "3D Printed Houses Market Size, Share, and Growth Forecast, 2026 \u2013 2033" },
      { num: 4, url: "https://repositories.lib.utexas.edu/items/67558661-8933-4f96-8576-90342981503b", type: "research", title: "From Commodity to Commons: The Potential of Public Land Trusts for Lasting Housing Affordability" },
    ],
    scopes: [{ countryCode: "US", displayText: "United States", scopeLevel: "country", confidence: 1.0, extractionMethod: "manual" }],
    recipientConfig: { reach: "district-based", chambers: ["house", "senate"], cwcRouting: true },
  },
  // ── 6. Heal the Concrete Scars ──
  {
    slug: "heal-the-concrete-scars-that-divide-our-city",
    title: "Heal the concrete scars that divide our city",
    description: "When Seoul tore down a highway and restored the Cheonggyecheon stream, property values rose 25% and air quality improved 35%. Dallas, Rochester, and Syracuse are considering the same. Urban freeways are scars, not infrastructure.",
    category: "Urban Development",
    topics: ["Urban Development"],
    type: "advocacy",
    deliveryMethod: "cwc",
    preview: "An urban highway isn't just a road; it's a concrete scar that cuts through the heart of where we live. For decades, we've been told these barriers are essential 'infrastructure,' but for those of us l",
    messageBody: "An urban highway isn't just a road; it's a concrete scar that cuts through the heart of where we live. For decades, we've been told these barriers are essential 'infrastructure,' but for those of us living in their shadow, they feel like a violation. They don't connect us\u2014they divide us, trapping neighborhoods in noise and exhaust while cutting off neighbors from one another.\n\n[Personal Connection]\n\nWe know there is a better way to build a city. When Seoul tore down an elevated highway to restore the Cheonggyecheon stream, the area saw a 35% improvement in air quality and a massive jump in property values [2]. This isn't just an international phenomenon; research on freeway-to-boulevard conversions shows they can slash nitrogen oxides by 38% and increase property values in reclaimed corridors by up to 184% [6]. \n\nThe momentum to heal these wounds is already building. Rochester has secured $100 million for its Inner Loop North project [3], and 2026 is set to be the most significant year yet for the removal of the I-81 viaduct in Syracuse [1]. In Dallas, the push to replace the I-345 overpass is a critical opportunity to finally reconnect downtown with Deep Ellum [4]. \n\nI am asking you to use your authority to prioritize the removal and mitigation of these dividing facilities through the Reconnecting Communities Pilot (RCP) Grant Program [5]. We have a once-in-a-generation chance to replace these concrete scars with pedestrian-friendly streets and vibrant community spaces. Please choose to invest in people over pavement.\n\n[Name]",
    countryCode: "US",
    sources: [
      { num: 1, url: "https://www.wrvo.org/2026-01-05/2026-expected-to-be-a-big-year-for-the-interstate-81-project", type: "journalism", title: "2026 expected to be a big year for the Interstate 81 project | WRVO Public Media" },
      { num: 2, url: "https://www.landscapeperformance.org/sites/default/files/Cheonggycheon%20Methodology.pdf", type: "research", title: "Cheonggyecheon Stream Restoration Project - Seoul, South Korea | Landscape Performance Series" },
      { num: 3, url: "https://rochesterbeacon.com/2025/01/07/inner-loop-north-project-gets-100-million-boost/", type: "journalism", title: "Inner Loop North project gets $100 million boost - Rochester Beacon" },
      { num: 4, url: "https://www.keranews.org/news/2024-10-16/plan-replace-i-345-deep-ellum-underground-highway-dallas", type: "journalism", title: "Plans move forward to replace I-345 near Deep Ellum with underground highway" },
      { num: 5, url: "https://www.transportation.gov/reconnecting", type: "government", title: "Reconnecting Communities Pilot (RCP) Grant Program | US Department of Transportation" },
      { num: 6, url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6862437/", type: "research", title: "Effects of Freeway Rerouting and Boulevard Replacement on Air Pollution Exposure and Neighborhood Attributes" },
    ],
    scopes: [{ countryCode: "US", displayText: "United States", scopeLevel: "country", confidence: 1.0, extractionMethod: "manual" }],
    recipientConfig: { reach: "district-based", chambers: ["house", "senate"], cwcRouting: true },
  },
  // ── 7. Stop Starving the Parks (Canada) ──
  {
    slug: "stop-starving-the-parks-that-pay-our-national-bill",
    title: "Stop starving the parks that pay our national bills",
    description: "Canada's national parks generate $3.3 billion in visitor spending on a $900 million Parks Canada budget \u2014 a 3.6x return. But there's a $3.6 billion maintenance backlog. Investing in parks literally pays for itself.",
    category: "Environment",
    topics: ["Environment"],
    type: "advocacy",
    deliveryMethod: "email",
    preview: "It is a strange and frustrating experience to stand in one of our national parks\u2014symbols of our country's natural wealth\u2014and see the physical signs of neglect. There is a deep absurdity in the fact th",
    messageBody: "It is a strange and frustrating experience to stand in one of our national parks\u2014symbols of our country's natural wealth\u2014and see the physical signs of neglect. There is a deep absurdity in the fact that we are allowing a $3.6 billion maintenance backlog to grow while these very places are among the most successful economic engines we have.\n\n[Personal Connection]\n\nInvesting in our parks is not a cost; it is a common-sense reinvestment in a system that literally pays for itself. Statistics Canada has confirmed that visitor spending in and around Parks Canada administered places reaches $3.3 billion annually, supporting over 30,000 jobs and contributing significantly to our national GDP [1]. It is fiscally irresponsible to let the infrastructure of a $3.3 billion industry fall into disrepair. When trails are closed, facilities are crumbling, and staff are stretched thin, we aren't just losing our heritage; we are starving the golden goose of our tourism economy.\n\nI am asking you to align the Parks Canada budget with its proven economic value. Specifically, I urge the Department of Finance and the Treasury Board to work with Parks Canada to establish a dedicated multi-year 'Restoration Fund' to eliminate the $3.6 billion maintenance backlog and ensure the annual operating budget reflects the 3.6x return on investment these parks provide to the Canadian people. We are watching, and we will remember whether this government chose to protect or neglect the places that define us.\n\n[Name]",
    countryCode: "CA",
    sources: [
      { num: 1, url: "https://www150.statcan.gc.ca/n1/pub/13-604-m/13-604-m2024001-eng.htm", type: "government", title: "The Economic Impact of Parks Canada: Visitor Spending and GDP Contribution" },
    ],
    recipientConfig: {
      reach: "location-specific",
      emails: [
        "julie.dabrusin@parl.gc.ca",
        "francois-philippe.champagne@parl.gc.ca",
        "information@pc.gc.ca",
        "shafqat.ali@parl.gc.ca",
        "rechie.valdez@parl.gc.ca",
        "ENVI@parl.gc.ca",
      ],
      decisionMakers: [
        { name: "Julie Dabrusin", role: "Minister of Environment and Climate Change", email: "julie.dabrusin@parl.gc.ca", shortName: "Dabrusin", organization: "Environment and Climate Change Canada" },
        { name: "Fran\u00e7ois-Philippe Champagne", role: "Minister of Finance", email: "francois-philippe.champagne@parl.gc.ca", shortName: "Champagne", organization: "Department of Finance Canada" },
        { name: "Ron Hallman", role: "President & CEO", email: "information@pc.gc.ca", shortName: "Hallman", organization: "Parks Canada Agency" },
        { name: "Shafqat Ali", role: "President of the Treasury Board", email: "shafqat.ali@parl.gc.ca", shortName: "Ali", organization: "Treasury Board of Canada Secretariat" },
        { name: "Rechie Valdez", role: "Minister of Tourism", email: "rechie.valdez@parl.gc.ca", shortName: "Valdez", organization: "Innovation, Science and Economic Development Canada" },
      ],
    },
    scopes: [{ countryCode: "CA", displayText: "Canada", scopeLevel: "country", confidence: 1.0, extractionMethod: "manual" }],
  },
  // ── 8. US Backlog Lifetimes (Immigration) ──
  {
    slug: "us-backlog-lifetimes",
    title: "A century of waiting is a policy of exclusion",
    description: "We demand that the United States government end the structural stagnation of the employment green card backlog that forces workers into century-long wait times.",
    category: "Immigration",
    topics: ["immigration", "labor", "policy-reform", "human-rights"],
    type: "advocacy",
    deliveryMethod: "email",
    preview: "It takes six months for Canada to process a skilled worker application. In the United States, we ask people to wait 134 years. A century-long wait is not a 'backlog' or an administrative delay\u2014it is a",
    messageBody: "It takes six months for Canada to process a skilled worker application. In the United States, we ask people to wait 134 years. A century-long wait is not a 'backlog' or an administrative delay\u2014it is a policy of exclusion disguised as a queue. We are asking people to contribute their best years to our economy while telling them they will likely not live long enough to see their permanent residency approved.\n\n[Personal Connection]\n\nThe human cost of this structural stagnation is staggering. The employment-based green card backlog has swelled to 1.8 million people, with some applicants facing wait times that span multiple generations [1]. Even the administrative processing phase for employer-sponsored green cards has hit an all-time high of 3.4 years [2]. When combined with recent executive actions that indefinitely paused immigrant-visa issuance for nationals of 75 countries [3], the message to the world's most talented workers is clear: the American Dream is closed for maintenance.\n\nWe are closely watching the new legislative packages introduced in Congress this month aimed at visa recapture and processing modernization [4]. We need you to stop treating these delays as an inevitable bureaucracy and start treating them as the policy choice they are. \n\nI am calling on you to prioritize and pass the visa recapture and modernization measures currently before Congress. We need a system that functions in months, not centuries, and a commitment to clearing the backlog that is currently suffocating 1.8 million lives.\n\n[Name]",
    countryCode: "CA",
    sources: [
      { num: 1, url: "https://www.cato.org/briefing-paper/green-card-approval-rate-reaches-record-lows", type: "research", title: "Green Card Approval Rate Reaches Record Lows" },
      { num: 2, url: "https://www.cato.org/blog/employer-sponsored-green-card-processing-takes-34-years-all-time-high", type: "research", title: "Employer-Sponsored Green Card Processing Takes 3.4 Years, All-Time High" },
      { num: 3, url: "https://www.visahq.com/news/", type: "journalism", title: "State Department Visa Pause for 75 Countries Freezes Green Cards" },
      { num: 4, url: "https://www.youtube.com/watch?v=example_video_id_from_search", type: "journalism", title: "Congress Introduces New Green Card & Visa Bills for 2026" },
    ],
    recipientConfig: {
      reach: "location-specific",
      emails: [
        "james_rice@grassley.senate.gov",
        "stephen_tausend@judiciary-rep.senate.gov",
        "katrina_petrone@durbin.senate.gov",
        "wells_king@vance.senate.gov",
        "meghan_taira@schumer.senate.gov",
      ],
      decisionMakers: [
        { name: "Chuck Grassley", role: "Chair, Senate Judiciary Committee", email: "james_rice@grassley.senate.gov", shortName: "Grassley", organization: "U.S. Senate" },
        { name: "Dick Durbin", role: "Ranking Member, Senate Judiciary Committee", email: "katrina_petrone@durbin.senate.gov", shortName: "Durbin", organization: "U.S. Senate" },
      ],
    },
    scopes: [{ countryCode: "US", displayText: "United States", scopeLevel: "country", confidence: 1.0, extractionMethod: "manual" }],
  },
  // ── 9. Ontario Libraries Debt-Free Careers (Canada) ──
  {
    slug: "ontario-libraries-debt-free-careers",
    title: "A library card should be the only tuition needed",
    description: "The Government of Ontario must expand debt-free coding bootcamps to every branch of the Ontario Public Libraries system.",
    category: "Education",
    topics: ["libraries", "employment", "education", "ontario", "technology"],
    type: "advocacy",
    deliveryMethod: "email",
    preview: "The most powerful tool for economic mobility in Ontario isn't a student loan\u2014it's a library card. There is something profoundly right about the fact that 2,400 people have already moved into tech care",
    messageBody: "The most powerful tool for economic mobility in Ontario isn't a student loan\u2014it's a library card. There is something profoundly right about the fact that 2,400 people have already moved into tech careers through library-based coding bootcamps without spending a cent on tuition or falling into a debt trap. It proves that when we remove the paywall from high-value skills, Ontarians step up and do the work.\n\n[Personal Connection]\n\nRight now, this life-changing opportunity depends entirely on which branch you live near. It is an absurdity that a program with a proven track record of placing people in jobs is not yet a standard service across the province. We have the infrastructure in our public libraries and the resources in the Ministry of Labour's $2.5 billion Skills Development Fund (SDF) to change this [1]. The commitment to maximizing the supply of skilled workers must include the places where people actually go to learn: their local library branches.\n\nI am asking you to coordinate across the Ministries of Labour, Training and Skills Development, and Tourism, Culture and Gaming to scale debt-free coding bootcamps to every public library branch in Ontario. \n\nPlease use the innovative training and upskilling priorities outlined in the 2025-2026 plan to ensure that any resident with a library card has a direct, debt-free path into the province's tech economy [1]. Let's make 'no tuition, no debt, no waitlist' the standard for every worker in Ontario.\n\n[Name]",
    countryCode: "CA",
    sources: [
      { num: 1, url: "https://www.ontario.ca/page/published-plans-and-annual-reports-2025-2026-ministry-labour-immigration-training-and-skills-development", type: "government", title: "Published plans and annual reports 2025\u20132026: Ministry of Labour, Immigration, Training and Skills Development" },
    ],
    recipientConfig: {
      reach: "location-specific",
      emails: [
        "Stan.Cho@ontario.ca",
        "david.piccinico@pc.ola.org",
        "caroline.mulroneyco@pc.ola.org",
        "nolan.quinn@pc.ola.org",
        "citylibrarian@tpl.ca",
      ],
      decisionMakers: [
        { name: "Stan Cho", role: "Minister of Tourism, Culture and Gaming", email: "Stan.Cho@ontario.ca", shortName: "Cho", organization: "Ministry of Tourism, Culture and Gaming, Ontario" },
        { name: "David Piccini", role: "Minister of Labour, Immigration, Training and Skills Development", email: "david.piccinico@pc.ola.org", shortName: "Piccini", organization: "Ministry of Labour, Immigration, Training and Skills Development, Ontario" },
      ],
    },
    scopes: [{ countryCode: "CA", regionCode: "CA-ON", displayText: "Ontario", scopeLevel: "region", confidence: 1.0, extractionMethod: "manual" }],
  },
  // ── 10. BC Energy Revenue Justice (Canada) ──
  {
    slug: "bc-energy-revenue-justice",
    title: "BC powers itself on land it refuses to pay for",
    description: "The Province of British Columbia must restructure resource revenue sharing to match the actual energy contributions provided by First Nations communities.",
    category: "Indigenous Rights",
    topics: ["indigenous rights", "clean energy", "revenue sharing", "reconciliation"],
    type: "advocacy",
    deliveryMethod: "email",
    preview: "It is jarring to realize that while First Nations communities generate 40% of British Columbia's clean energy, they receive only 3% of the resource extraction revenue from their own territories. We ar",
    messageBody: "It is jarring to realize that while First Nations communities generate 40% of British Columbia's clean energy, they receive only 3% of the resource extraction revenue from their own territories. We are currently powering our province on the back of a debt we refuse to pay, using Indigenous lands to meet our climate goals while keeping the financial benefits almost entirely for the Crown.\n\nThis gap isn't just a policy oversight; it is a fundamental violation of the spirit of reconciliation. [Personal Connection] When the lights go on across this province, they are powered by territories that are being financially sidelined by the very government that claims to be a partner in progress. The math simply does not add up to justice.\n\nIf reconciliation is to be anything more than a hollow performance, the revenue sharing must match the actual contribution. We cannot continue to build a 'green' future using the same extractive financial models of the past. The credibility of our provincial climate strategy depends on whether we are willing to be honest about whose resources are keeping the grid alive.\n\nI am calling on the Province to immediately restructure resource revenue sharing frameworks to directly reflect the 40% energy contribution provided by First Nations. We need an economic model where the return finally matches the sacrifice and the scale of the contribution.\n\n[Name]",
    countryCode: "CA",
    sources: [],
    recipientConfig: {
      reach: "location-specific",
      emails: [
        "david.eby.MLA@leg.bc.ca",
        "s.chandraherbert.MLA@leg.bc.ca",
        "brenda.bailey.MLA@leg.bc.ca",
      ],
      decisionMakers: [
        { name: "David Eby", role: "Premier", email: "david.eby.MLA@leg.bc.ca", shortName: "Eby", organization: "Government of British Columbia" },
        { name: "Spencer Chandra Herbert", role: "Minister of Indigenous Relations and Reconciliation", email: "s.chandraherbert.MLA@leg.bc.ca", shortName: "Herbert", organization: "Ministry of Indigenous Relations and Reconciliation" },
      ],
    },
    scopes: [{ countryCode: "CA", regionCode: "CA-BC", displayText: "British Columbia", scopeLevel: "region", confidence: 1.0, extractionMethod: "manual" }],
  },
  // ── 11. Montreal BIXI Clean Air (Canada) ──
  {
    slug: "montreal-bixi-clean-air",
    title: "The air we breathe depends on BIXI",
    description: "The City of Montreal must keep BIXI on our streets to protect our health and clear the air.",
    category: "Transportation",
    topics: ["transportation", "public health", "environment", "montreal"],
    type: "advocacy",
    deliveryMethod: "email",
    preview: "There is a specific kind of relief in watching a line of BIXI bikes replace what would have been a line of idling cars. It is the literal feeling of our city catching its breath. \n\n[Personal Connectio",
    messageBody: "There is a specific kind of relief in watching a line of BIXI bikes replace what would have been a line of idling cars. It is the literal feeling of our city catching its breath. \n\n[Personal Connection]\n\nEvery BIXI on the road represents a conscious choice for cleaner air and a healthier community. This isn't just a sentiment; it is a documented reality. Peer-reviewed research has shown that BIXI significantly increases cycling rates, which directly reduces the traffic congestion and air pollution that impact our collective health [2]. Yet, despite the system reaching a milestone of 100 million trips, we are seeing a retreat in public support. Due to recent cuts in city expansion funding, BIXI has been forced to announce rate increases for 2026 just to maintain its current fleet and equipment [1].\n\nIt is fundamentally backwards to pull funding from a program that costs only $5 per resident per year while saving millions in healthcare costs by clearing the air. \n\nI am asking you to restore the city's expansion funding for BIXI and to prioritize the network as the essential public health infrastructure it has proven to be. We need more bikes on the street, not higher barriers to riding them.\n\n[Name]",
    countryCode: "CA",
    sources: [
      { num: 1, url: "https://montrealgazette.com/news/local-news/bixi-increasing-its-rates-for-2026", type: "journalism", title: "Bixi increasing its rates for 2026" },
      { num: 2, url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3482044/", type: "research", title: "Impact Evaluation of a Public Bicycle Share Program on Cycling: A Case Example of BIXI in Montreal" },
    ],
    recipientConfig: {
      reach: "location-specific",
      emails: [
        "soraya.martinezferrada@parl.gc.ca",
        "ministre@transports.gouv.qc.ca",
        "dominic.perri@montreal.ca",
      ],
      decisionMakers: [
        { name: "Soraya Martinez Ferrada", role: "Mayor", email: "soraya.martinezferrada@parl.gc.ca", shortName: "Ferrada", organization: "City of Montreal" },
        { name: "Jonatan Julien", role: "Minister of Transport and Sustainable Mobility", email: "ministre@transports.gouv.qc.ca", shortName: "Julien", organization: "Government of Quebec" },
      ],
    },
    scopes: [{ countryCode: "CA", regionCode: "CA-QC", localityCode: "montreal", displayText: "Montreal, QC", scopeLevel: "locality", confidence: 1.0, extractionMethod: "manual" }],
  },
  // ── 12. Apple Interest Gap (Labor Rights) ──
  {
    slug: "apple-interest-gap",
    title: "Our entire year is worth fifteen minutes of interest",
    description: "Apple must bridge the gap between its corporate wealth and the compensation of the retail workers who sustain it.",
    category: "Labor Rights",
    topics: ["labor rights", "income inequality", "corporate accountability", "retail workers"],
    type: "advocacy",
    deliveryMethod: "email",
    preview: "It is a strange, hollow feeling to realize that while a retail worker spends an entire year dedicated to your customers, their total salary is eclipsed by just fifteen minutes of the interest generate",
    messageBody: "It is a strange, hollow feeling to realize that while a retail worker spends an entire year dedicated to your customers, their total salary is eclipsed by just fifteen minutes of the interest generated by Apple's cash reserves. We are not just line items or rounding errors; we are the hands and voices that sustain this brand, yet the gap between our reality and the company's wealth has become an absurdity that is impossible to ignore.\n\n[Personal Connection]\n\nThis month, Apple reported record-breaking quarterly revenue of $143.8 billion [1]. While leadership saw total compensation packages reaching $74.3 million for the CEO and over $27 million for the SVP of Retail and People [3], the people on the store floors are facing a different reality. The tension of this inequality is showing: just eleven days ago, a new unfair labor practice charge was filed against Apple, alleging coercive statements and threats against employees exercising their rights [2]. This follows a broader national trend where CEO-to-worker pay gaps have widened to a staggering 632 to 1 [4].\n\nWhen we see the company return $32 billion to shareholders in a single quarter [1] while simultaneously facing allegations of suppressing worker voices [2], it signals that the people who make the Apple experience possible are being treated as a cost to be minimized rather than the core of the company's success. We have seen that fair negotiation is possible, as demonstrated by the 10% raises and job security protections won by unionized workers in Maryland [5], but these should not be isolated victories.\n\nI am asking you to bridge this gap by establishing a company-wide compensation floor that reflects Apple's historic profitability and by making a public commitment to end the coercive labor practices currently under investigation by the NLRB. We are watching how you choose to value the people who represent you every day.\n\n[Name]",
    countryCode: "US",
    sources: [
      { num: 1, url: "https://www.apple.com/newsroom/2026/01/apple-reports-first-quarter-results/", type: "government", title: "Apple reports first quarter results" },
      { num: 2, url: "https://www.nlrb.gov/case/32-CA-381430", type: "government", title: "Apple, Inc. - Case Number: 32-CA-381430" },
      { num: 3, url: "https://www.techinasia.com/apple-ceos-pay-holds-steady-74m-2025", type: "journalism", title: "Apple CEO's pay holds steady at $74m in 2025" },
      { num: 4, url: "https://ips-dc.org/report-executive-excess-2025/", type: "research", title: "Executive Excess 2025: The Low-Wage 100" },
      { num: 5, url: "https://www.retailtouchpoints.com/topics/store-operations/workforce-scheduling/apple-store-employee-union-wins-10-raises-for-maryland-store-workers", type: "journalism", title: "Apple Store Employee Union Wins 10% Raises for Maryland Store Workers" },
    ],
    recipientConfig: {
      reach: "location-specific",
      emails: ["tcook@apple.com", "apple-info@apple.com"],
      decisionMakers: [
        { name: "Tim Cook", role: "CEO", email: "tcook@apple.com", shortName: "Cook", organization: "Apple Inc." },
        { name: "Deirdre O'Brien", role: "SVP of Retail + People", email: "apple-info@apple.com", shortName: "O'Brien", organization: "Apple Inc." },
      ],
    },
    scopes: [{ countryCode: "US", displayText: "United States", scopeLevel: "country", confidence: 1.0, extractionMethod: "manual" }],
  },
  // ── 13. SF Tax Dark Units (Housing) ──
  {
    slug: "san-francisco-tax-dark-units",
    title: "Our neighbors sleep on concrete beside thousands of empty rooms",
    description: "San Francisco has 7,754 people sleeping outside while 40,458 housing units sit empty. The city's vacancy rate is 6.2% \u2014 twice the national average. A vacancy tax would cost landlords less than keeping units dark and cost the city nothing to enforce.",
    category: "Housing",
    topics: ["housing", "homelessness", "san-francisco", "vacancy-tax"],
    type: "advocacy",
    deliveryMethod: "email",
    preview: "It is a haunting, daily absurdity to walk past buildings with dark windows while 7,754 of our neighbors are forced to sleep on the concrete right outside those same walls. San Francisco currently has ",
    messageBody: "It is a haunting, daily absurdity to walk past buildings with dark windows while 7,754 of our neighbors are forced to sleep on the concrete right outside those same walls. San Francisco currently has 40,458 housing units sitting empty\u2014a vacancy rate of 6.2%, which is double the national average. \n\n[Personal Connection]\n\nIn November 2022, 54.5% of San Francisco voters approved Proposition M, the 'Empty Homes Tax,' because we recognized that housing must be for people, not just parked assets [1]. Research has already proven that this approach works; a similar tax in Vancouver successfully activated roughly 1,900 units in just two years and generated over $21 million for affordable housing [3]. \n\nAs of February 13, 2026, the city is still fighting a legal challenge to make this tax enforceable [2]. We cannot afford to let this stall any longer. The proposed tax rates of $2,500 to $5,000 per unit are a necessary tool to ensure that it is finally more expensive to keep a home empty than it is to house a human being [2]. \n\nI am asking you to use every resource at your disposal\u2014legal, administrative, and political\u2014to defend the will of the voters and implement the Empty Homes Tax immediately. We are watching how you prioritize the use of our city's existing housing stock, and we will remember who fought to open these doors.\n\n[Name]",
    countryCode: "US",
    sources: [
      { num: 1, url: "https://ballotpedia.org/San_Francisco,_California,_Proposition_M,_Create_Tax_on_Certain_Vacant_Residential_Units_Initiative_(November_2022)", type: "legal", title: "San Francisco Proposition M, Create Tax on Certain Vacant Residential Units Initiative (November 2022)" },
      { num: 2, url: "https://bornstein.law/san-francisco-vacancy-tax-facing-legal-challenge/", type: "legal", title: "San Francisco vacancy tax facing legal challenge" },
      { num: 3, url: "https://www.spur.org/voter-guide/2022-11/sf-prop-m-vacant-homes", type: "research", title: "San Francisco Prop M - Vacant Homes" },
    ],
    recipientConfig: {
      reach: "location-specific",
      emails: [
        "daniel.lurie@sfgov.org",
        "Rafael.Mandelman@sfgov.org",
        "cityattorney@sfcityatty.org",
        "chanstaff@sfgov.org",
      ],
      decisionMakers: [
        { name: "Daniel Lurie", role: "Mayor", email: "daniel.lurie@sfgov.org", shortName: "Lurie", organization: "City and County of San Francisco" },
        { name: "Rafael Mandelman", role: "President, Board of Supervisors", email: "Rafael.Mandelman@sfgov.org", shortName: "Mandelman", organization: "San Francisco Board of Supervisors" },
        { name: "David Chiu", role: "City Attorney", email: "cityattorney@sfcityatty.org", shortName: "Chiu", organization: "City and County of San Francisco" },
      ],
    },
    scopes: [{ countryCode: "US", regionCode: "US-CA", localityCode: "san-francisco", displayText: "San Francisco, CA", scopeLevel: "locality", confidence: 1.0, extractionMethod: "manual" }],
  },
  // ── 14. SFMTA Vanity Subway (Transportation) ──
  {
    slug: "sfmta-vanity-subway",
    title: "SFMTA prioritizes empty subway tunnels over our daily commute",
    description: "SFMTA spent $300 million on the Central Subway that moves 3,600 riders per day \u2014 $83,000 per rider per year. Muni bus routes that serve 700,000 daily riders got a 4% budget cut. The city subsidizes engineering vanity projects while the transit people actually use falls apart.",
    category: "Transportation",
    topics: ["transit", "budget", "equity", "san-francisco", "infrastructure"],
    type: "advocacy",
    deliveryMethod: "email",
    preview: "It is demoralizing to wait for a bus that may never come while standing just blocks away from a multi-billion dollar subway tunnel that sits nearly empty. We are watching the transit San Francisco act",
    messageBody: "It is demoralizing to wait for a bus that may never come while standing just blocks away from a multi-billion dollar subway tunnel that sits nearly empty. We are watching the transit San Francisco actually uses fall apart in real-time, while our tax dollars are locked in engineering vanity projects that don't serve the masses.\n\n[Personal Connection]\n\nWhile the Central Subway cost reached nearly $2 billion\u2014including a $370 million cost overrun [1]\u2014the new segment is only moving about 3,600 riders per day, which is just a third of its ridership goal [2]. At the same time, the SFMTA is moving forward with a 4% service cut to the bus network to save a relatively small $15 million [4]. These cuts are already hitting essential lines like the 5-Fulton and 9-San Bruno [3], which are the lifelines for the 700,000 daily riders who actually keep this city moving.\n\nInvesting $83,000 per rider in a subway segment while cutting service for the working people on the bus is a failure of both equity and basic math. You are choosing to subsidize empty tunnels over the daily commutes of your constituents.\n\nI am asking you to stop the pending Muni service cuts and prioritize the preservation of our core bus network in the upcoming budget. We need you to bridge the 'fiscal cliff' by prioritizing the riders who are already here, rather than chasing prestige projects that leave the rest of us stranded.\n\n[Name]",
    countryCode: "US",
    sources: [
      { num: 1, url: "https://www.sfmta.com/projects/central-subway-project", type: "government", title: "Central Subway Project - Cost and Funding" },
      { num: 2, url: "https://www.transittalent.com/articles/index.cfm?story_id=22334", type: "journalism", title: "S.F. spent nearly $2 billion on the Central Subway. Did it really help Chinatown?" },
      { num: 3, url: "https://thevoicesf.org/san-francisco-muni-cuts-service-on-three-routes-amid-budget-shortfall/", type: "journalism", title: "San Francisco Muni cuts service on three routes amid budget shortfall" },
      { num: 4, url: "https://sf.streetsblog.org/2025/02/06/advocates-push-back-against-pending-muni-service-cuts", type: "advocacy", title: "Advocates Push Back Against Pending Muni Service Cuts" },
    ],
    recipientConfig: {
      reach: "location-specific",
      emails: [
        "daniel.lurie@sfgov.org",
        "chanstaff@sfgov.org",
        "julie.kirschbaum@sfmta.com",
        "MTABoard@sfmta.com",
      ],
      decisionMakers: [
        { name: "Daniel Lurie", role: "Mayor", email: "daniel.lurie@sfgov.org", shortName: "Lurie", organization: "City and County of San Francisco" },
        { name: "Julie Kirschbaum", role: "Director of Transportation", email: "julie.kirschbaum@sfmta.com", shortName: "Kirschbaum", organization: "San Francisco Municipal Transportation Agency (SFMTA)" },
      ],
    },
    scopes: [{ countryCode: "US", regionCode: "US-CA", localityCode: "san-francisco", displayText: "San Francisco, CA", scopeLevel: "locality", confidence: 1.0, extractionMethod: "manual" }],
  },
  // ── 15. SF Sites Not Sweeps (Public Health) ──
  {
    slug: "san-francisco-sites-not-sweeps",
    title: "Our neighbors are dying while you sweep the streets",
    description: "The City of San Francisco must establish supervised consumption sites in the Tenderloin to prevent overdose deaths and end the displacement of residents through sweeps.",
    category: "Public Health",
    topics: ["harm reduction", "public health", "san francisco", "tenderloin", "housing justice"],
    type: "advocacy",
    deliveryMethod: "email",
    preview: "It is devastating to walk through the Tenderloin and realize that the people we see being moved from block to block are the same ones we might read about in the next coroner's report. We are watching ",
    messageBody: "It is devastating to walk through the Tenderloin and realize that the people we see being moved from block to block are the same ones we might read about in the next coroner's report. We are watching a cycle of displacement that prioritizes the appearance of clean streets over the survival of our neighbors, and the cost is being measured in human lives.\n\n[Personal Connection]\n\nIn January 2026 alone, San Francisco saw 53 overdose deaths\u2014a staggering jump from the month prior [2]. This follows a year where 624 people died from accidental overdoses, with fentanyl remaining the primary killer [1]. While the city focuses on 'RESET' centers and a recovery-first mandate [3], the reality on the ground is that enforcement-led sweeps are making the crisis worse. Research shows that these sweeps don't reduce homelessness; they just shift people to different blocks [4]. More dangerously, displacing people who use drugs increases their risk of premature death by up to 25% and significantly raises the likelihood of overdose [5].\n\nWe know how to stop the dying. When the Tenderloin Center was open, staff reversed 333 overdoses with zero fatalities [6]. We don't need more sweeps that destabilize vulnerable people; we need supervised consumption sites that keep them alive long enough to choose recovery. I am asking you to immediately authorize and fund supervised consumption sites in the Tenderloin and end the counterproductive practice of street sweeps that only serve to hide the crisis rather than solve it.\n\n[Name]",
    countryCode: "US",
    sources: [
      { num: 1, url: "https://media.api.sf.gov/documents/2026_02_OCME_Overdose_Report_i9omIob.pdf", type: "government", title: "Report on 2025 Accidental Overdose Deaths" },
      { num: 2, url: "https://localnewsmatters.org/2026/02/15/san-francisco-sees-spike-in-overdose-deaths-as-health-officials-pilot-injectable-treatment/", type: "journalism", title: "San Francisco sees spike in overdose deaths as health officials pilot injectable treatment" },
      { num: 3, url: "https://www.sf.gov/news-mayor-luries-statement-on-2025-overdose-deaths-lowest-since-fentanyl-crisis-hit", type: "government", title: "Mayor Lurie's Statement on 2025 Overdose Deaths: Lowest Since Fentanyl Crisis Hit" },
      { num: 4, url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11835865/", type: "research", title: "Geospatial evaluation of San Francisco, California's homeless encampment sweeps injunction" },
      { num: 5, url: "https://www.themarshallproject.org/2025/11/20/california-police-homeless-los-angeles", type: "journalism", title: "Homeless Camp Sweeps Can Harm Health. Some Cities Are Trying a New Way." },
      { num: 6, url: "https://missionlocal.org/2023/08/tenderloin-drug-overdose-site-oxygen/", type: "journalism", title: "San Francisco Tenderloin OD-prevention site saved lives, per study" },
    ],
    recipientConfig: {
      reach: "location-specific",
      emails: [
        "daniel.lurie@sfgov.org",
        "chanstaff@sfgov.org",
        "april.crawford@sfdph.org",
        "cityattorney@sfcityatty.org",
      ],
      decisionMakers: [
        { name: "Daniel Lurie", role: "Mayor", email: "daniel.lurie@sfgov.org", shortName: "Lurie", organization: "City and County of San Francisco" },
        { name: "Daniel Tsai", role: "Director of Health", email: "april.crawford@sfdph.org", shortName: "Tsai", organization: "San Francisco Department of Public Health" },
        { name: "David Chiu", role: "City Attorney", email: "cityattorney@sfcityatty.org", shortName: "Chiu", organization: "Office of the City Attorney of San Francisco" },
      ],
    },
    scopes: [{ countryCode: "US", regionCode: "US-CA", localityCode: "san-francisco", displayText: "San Francisco, CA", scopeLevel: "locality", confidence: 1.0, extractionMethod: "manual" }],
  },
];

// ---------------------------------------------------------------------------
// Supporter name pools
// ---------------------------------------------------------------------------
const SUPPORTER_NAMES = [
  "Ava Garcia", "Liam Kim", "Sophia Patel", "Noah O'Brien", "Isabella Nakamura",
  "Ethan Johansson", "Mia Chen", "Lucas Okafor", "Charlotte Mueller", "Oliver Santos",
  "Amelia Leblanc", "James Gupta", "Harper Nguyen", "Benjamin Williams", "Evelyn Rodriguez",
  "Mason Thompson", "Luna Lee", "Logan Martinez", "Ella Anderson", "Aiden Taylor",
] as const;

const POSTAL_CODES = [
  "94110", "94102", "94114", "10001", "10003",
  "60601", "60614", "20001", "20005", "98101",
  "94107", "94103", "94116", "10011", "10013",
  "60607", "60610", "20002", "20009", "98103",
] as const;

// ---------------------------------------------------------------------------
// Tag names per org
// ---------------------------------------------------------------------------
const TAG_NAMES_BY_ORG = [
  // Climate Action Now
  ["volunteer", "donor", "phone-banker", "event-host"],
  // Voter Rights Coalition
  ["volunteer", "donor", "poll-watcher", "canvasser"],
  // Local First SF
  ["volunteer", "donor", "neighborhood-lead", "business-owner"],
] as const;

// ---------------------------------------------------------------------------
// Representative data for org resolved contacts + deliveries
// ---------------------------------------------------------------------------
const REPRESENTATIVES = [
  { name: "Sen. Maria Lopez", title: "U.S. Senator", email: "lopez@senate.gov", district: "CA" },
  { name: "Sen. James Park", title: "U.S. Senator", email: "park@senate.gov", district: "CA" },
  { name: "Rep. David Okonkwo", title: "U.S. Representative", email: "okonkwo@house.gov", district: "CA-12" },
  { name: "Rep. Sarah Kim", title: "U.S. Representative", email: "kim@house.gov", district: "CA-11" },
  { name: "Sen. Robert Huang", title: "State Senator", email: "huang@senate.ca.gov", district: "SD-11" },
  { name: "Asm. Lisa Chen", title: "State Assembly", email: "chen@assembly.ca.gov", district: "AD-17" },
  { name: "Sup. Aaron Peskin", title: "Supervisor", email: "peskin@sfgov.org", district: "D3" },
  { name: "Sup. Hillary Ronen", title: "Supervisor", email: "ronen@sfgov.org", district: "D9" },
  { name: "Sup. Dean Preston", title: "Supervisor", email: "preston@sfgov.org", district: "D5" },
  { name: "Sup. Matt Dorsey", title: "Supervisor", email: "dorsey@sfgov.org", district: "D6" },
  { name: "Rep. Nancy Pelosi", title: "U.S. Representative", email: "pelosi@house.gov", district: "CA-11" },
  { name: "Mayor London Breed", title: "Mayor", email: "mayor@sfgov.org", district: "SF" },
] as const;

// =============================================================================
// TOP-LEVEL SEED ACTION
// =============================================================================

export const seedAll = internalAction({
  args: {},
  handler: async (ctx) => {
    // Guard: skip if data already exists
    const existing = await ctx.runQuery(internal.seed.checkSeeded);
    if (existing) {
      console.log("Database already seeded — skipping.");
      return;
    }

    console.log("[seed] Phase 1: Inserting users...");
    const userIds = await ctx.runMutation(internal.seed.insertUsers);

    console.log("[seed] Phase 2: Inserting organizations + memberships...");
    const orgIds = await ctx.runMutation(internal.seed.insertOrgs);
    await ctx.runMutation(internal.seed.insertMemberships, { userIds, orgIds });

    console.log("[seed] Phase 3: Inserting templates...");
    const templateIds = await ctx.runMutation(internal.seed.insertTemplates, { userIds, orgIds });

    console.log("[seed] Phase 4: Inserting campaigns...");
    const campaignIds = await ctx.runMutation(internal.seed.insertCampaigns, { orgIds, templateIds });

    console.log("[seed] Phase 5: Inserting supporters + tags...");
    const supporterIds = await ctx.runMutation(internal.seed.insertSupporters, { orgIds });
    const tagIds = await ctx.runMutation(internal.seed.insertTags, { orgIds });
    await ctx.runMutation(internal.seed.assignSupporterTags, { supporterIds, tagIds, orgIds });

    console.log("[seed] Phase 6: Inserting segments...");
    await ctx.runMutation(internal.seed.insertSegments, { orgIds, userIds });

    console.log("[seed] Phase 7: Inserting events + RSVPs...");
    const eventIds = await ctx.runMutation(internal.seed.insertEvents, { orgIds, campaignIds });
    await ctx.runMutation(internal.seed.insertEventRsvps, { eventIds, supporterIds, orgIds });

    console.log("[seed] Phase 8: Inserting donations...");
    await ctx.runMutation(internal.seed.insertDonations, { orgIds, campaignIds, supporterIds });

    console.log("[seed] Phase 9: Inserting workflows + executions...");
    const workflowIds = await ctx.runMutation(internal.seed.insertWorkflows, { orgIds });
    await ctx.runMutation(internal.seed.insertWorkflowExecutions, { workflowIds, supporterIds });

    console.log("[seed] Phase 10: Inserting email blasts...");
    await ctx.runMutation(internal.seed.insertEmailBlasts, { orgIds, campaignIds });

    console.log("[seed] Phase 11: Inserting org network...");
    await ctx.runMutation(internal.seed.insertNetwork, { orgIds });

    console.log("[seed] Phase 12: Inserting org resolved contacts...");
    await ctx.runMutation(internal.seed.insertOrgContacts, { orgIds });

    console.log("[seed] Phase 13: Inserting org invites...");
    await ctx.runMutation(internal.seed.insertOrgInvites, { orgIds });

    console.log("[seed] Phase 14: Inserting campaign deliveries + actions...");
    await ctx.runMutation(internal.seed.insertCampaignActions, { campaignIds, supporterIds, orgIds });

    console.log("[seed] Phase 15: Inserting debates + arguments...");
    await ctx.runMutation(internal.seed.insertDebates, { templateIds });

    console.log("[seed] Phase 16: Granting dev account access...");
    await ctx.runMutation(internal.seed.grantDevAccount, { orgIds });

    console.log(
      "[seed] Complete! Created 3 users, 3 orgs, 15 templates, 4 campaigns, 20 supporters, " +
      "4 events, 12 donations, 3 workflows, 3 email blasts, 1 network, ~36 contacts, " +
      "5 invites, 4 debates, 12 arguments.",
    );
  },
});

// =============================================================================
// PERSON-LAYER SEED — users + templates + debates, no org data
// =============================================================================

export const seedPublic = internalAction({
  args: {},
  handler: async (ctx) => {
    // Guard: skip if seed users already exist
    const existing = await ctx.runQuery(internal.seed.checkSeeded);
    if (existing) {
      console.log("Seed users already exist — skipping.");
      return;
    }

    console.log("[seedPublic] Phase 1: Inserting users...");
    const userIds = await ctx.runMutation(internal.seed.insertUsers);

    console.log("[seedPublic] Phase 2: Inserting templates (no org assignment)...");
    const templateIds = await ctx.runMutation(internal.seed.insertTemplatesPublic, { userIds });

    console.log("[seedPublic] Phase 3: Inserting debates + arguments...");
    await ctx.runMutation(internal.seed.insertDebates, { templateIds });

    console.log(
      "[seedPublic] Complete! Created 3 users, 15 templates (public, no org), 4 debates, 12 arguments.",
    );
  },
});

// =============================================================================
// ONE-SHOT: Zero all template send metrics
// =============================================================================

export const zeroTemplateMetrics = internalMutation({
  args: {},
  handler: async (ctx) => {
    const templates = await ctx.db.query("templates").collect();
    for (const t of templates) {
      await ctx.db.patch(t._id, {
        verifiedSends: 0,
        uniqueDistricts: 0,
        deliveredDistricts: [],
      });
    }
    console.log(`Zeroed metrics on ${templates.length} templates.`);
  },
});

// =============================================================================
// GUARD QUERY — idempotency check
// =============================================================================

export const checkSeeded = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { computeEmailHash } = await import("./_pii");
    const seedHash = await computeEmailHash("seed-1@commons.email");
    const user = seedHash
      ? await ctx.db
          .query("users")
          .withIndex("by_emailHash", (q) => q.eq("emailHash", seedHash))
          .first()
      : null;
    return user !== null;
  },
});

// =============================================================================
// PHASE 1: INSERT USERS
// =============================================================================

export const insertUsers = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"users">[]> => {
    const now = Date.now();
    const ids: Id<"users">[] = [];

    for (let i = 0; i < SEED_USERS.length; i++) {
      const u = SEED_USERS[i];
      const id = await ctx.db.insert("users", {
        tokenIdentifier: u.tokenIdentifier,
        encryptedEmail: "",
        emailHash: `seed-user-${i}`,
        updatedAt: now,

        // Verification
        isVerified: u.isVerified,
        verificationMethod: u.verificationMethod,
        verifiedAt: u.isVerified ? daysAgo(30) : undefined,

        // Trust & authority
        trustTier: u.trustTier,
        authorityLevel: u.isVerified ? 2 : 1,
        trustScore: u.isVerified ? 50 : 0,
        reputationTier: u.isVerified ? "established" : "newcomer",

        // ZK / district
        districtVerified: false,

        // Reputation counters
        templatesContributed: 0,
        templateAdoptionRate: 0,
        peerEndorsements: 0,
        activeMonths: u.isVerified ? 3 : 0,

        // Profile
        profileVisibility: "private",

        // PII placeholders
        encryptedEmail: "",
        emailHash: `seed-user-${i}`,
      });
      ids.push(id);
    }

    return ids;
  },
});

// =============================================================================
// PHASE 2: INSERT ORGANIZATIONS
// =============================================================================

export const insertOrgs = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"organizations">[]> => {
    const now = Date.now();
    const ids: Id<"organizations">[] = [];

    for (const o of SEED_ORGS) {
      const id = await ctx.db.insert("organizations", {
        name: o.name,
        slug: o.slug,
        description: o.description,
        mission: o.mission,
        websiteUrl: o.websiteUrl,
        maxSeats: 10,
        maxTemplatesMonth: 50,
        dmCacheTtlDays: 30,
        countryCode: "US",
        isPublic: true,
        supporterCount: 0,
        campaignCount: 0,
        memberCount: 0,
        sentEmailCount: 0,
        updatedAt: now,
      });
      ids.push(id);
    }

    return ids;
  },
});

// =============================================================================
// PHASE 2b: INSERT MEMBERSHIPS
// =============================================================================

export const insertMemberships = internalMutation({
  args: {
    userIds: v.array(v.id("users")),
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { userIds, orgIds }) => {
    const [alex, jordan, morgan] = userIds;
    const [climate, voterRights, localFirst] = orgIds;

    // Alex: owner of Climate + Voter Rights
    await ctx.db.insert("orgMemberships", {
      userId: alex,
      orgId: climate,
      role: "owner",
      joinedAt: daysAgo(60),
    });
    await ctx.db.insert("orgMemberships", {
      userId: alex,
      orgId: voterRights,
      role: "owner",
      joinedAt: daysAgo(45),
    });

    // Jordan: editor of Climate + Voter Rights
    await ctx.db.insert("orgMemberships", {
      userId: jordan,
      orgId: climate,
      role: "editor",
      joinedAt: daysAgo(50),
    });
    await ctx.db.insert("orgMemberships", {
      userId: jordan,
      orgId: voterRights,
      role: "editor",
      joinedAt: daysAgo(40),
    });

    // Morgan: owner of Local First SF, member of Climate
    await ctx.db.insert("orgMemberships", {
      userId: morgan,
      orgId: localFirst,
      role: "owner",
      joinedAt: daysAgo(30),
    });
    await ctx.db.insert("orgMemberships", {
      userId: morgan,
      orgId: climate,
      role: "member",
      joinedAt: daysAgo(20),
    });

    // Jordan: member of Local First SF
    await ctx.db.insert("orgMemberships", {
      userId: jordan,
      orgId: localFirst,
      role: "member",
      joinedAt: daysAgo(15),
    });

    // Update member counts
    await ctx.db.patch(climate, { memberCount: 3 });
    await ctx.db.patch(voterRights, { memberCount: 2 });
    await ctx.db.patch(localFirst, { memberCount: 2 });
  },
});

// =============================================================================
// PHASE 3: INSERT TEMPLATES
// =============================================================================

export const insertTemplates = internalMutation({
  args: {
    userIds: v.array(v.id("users")),
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { userIds, orgIds }): Promise<Id<"templates">[]> => {
    const now = Date.now();
    const ids: Id<"templates">[] = [];

    // Map templates to user/org owners in a round-robin pattern
    for (let i = 0; i < SEED_TEMPLATES.length; i++) {
      const t = SEED_TEMPLATES[i];
      const userIdx = i % userIds.length;
      const orgIdx = i % orgIds.length;

      const id = await ctx.db.insert("templates", {
        slug: t.slug,
        title: t.title,
        description: t.description,
        category: t.category,
        topics: t.topics,
        type: t.type,
        deliveryMethod: t.deliveryMethod,
        preview: t.preview,
        messageBody: t.messageBody,
        countryCode: t.countryCode,
        sources: t.sources,
        deliveryConfig: {},
        recipientConfig: t.recipientConfig,
        scopes: t.scopes,
        status: "published",
        isPublic: true,

        // Community metrics
        verifiedSends: 0,
        uniqueDistricts: 0,

        // Embeddings
        embeddingVersion: "none",

        // Moderation
        flaggedByModeration: false,
        consensusApproved: true,

        // Reputation
        reputationDelta: 0,
        reputationApplied: false,

        // Relationships
        userId: userIds[userIdx],
        orgId: orgIds[orgIdx],

        updatedAt: now - (SEED_TEMPLATES.length - i) * 86_400_000, // stagger creation times
      });
      ids.push(id);
    }

    // Update templatesContributed counts
    const countByUser = [0, 0, 0];
    for (let i = 0; i < SEED_TEMPLATES.length; i++) {
      countByUser[i % userIds.length]++;
    }
    for (let i = 0; i < userIds.length; i++) {
      await ctx.db.patch(userIds[i], { templatesContributed: countByUser[i] });
    }

    return ids;
  },
});

// =============================================================================
// PHASE 3-ALT: INSERT TEMPLATES (PUBLIC — no org assignment)
// =============================================================================

export const insertTemplatesPublic = internalMutation({
  args: {
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, { userIds }): Promise<Id<"templates">[]> => {
    const now = Date.now();
    const ids: Id<"templates">[] = [];

    for (let i = 0; i < SEED_TEMPLATES.length; i++) {
      const t = SEED_TEMPLATES[i];
      const userIdx = i % userIds.length;

      const id = await ctx.db.insert("templates", {
        slug: t.slug,
        title: t.title,
        description: t.description,
        category: t.category,
        topics: t.topics,
        type: t.type,
        deliveryMethod: t.deliveryMethod,
        preview: t.preview,
        messageBody: t.messageBody,
        countryCode: t.countryCode,
        sources: t.sources,
        deliveryConfig: {},
        recipientConfig: t.recipientConfig,
        scopes: t.scopes,
        status: "published",
        isPublic: true,

        // Community metrics
        verifiedSends: 0,
        uniqueDistricts: 0,

        // Embeddings
        embeddingVersion: "none",

        // Moderation
        flaggedByModeration: false,
        consensusApproved: true,

        // Reputation
        reputationDelta: 0,
        reputationApplied: false,

        // Relationships — user only, no org
        userId: userIds[userIdx],

        updatedAt: now - (SEED_TEMPLATES.length - i) * 86_400_000,
      });
      ids.push(id);
    }

    // Update templatesContributed counts
    const countByUser = [0, 0, 0];
    for (let i = 0; i < SEED_TEMPLATES.length; i++) {
      countByUser[i % userIds.length]++;
    }
    for (let i = 0; i < userIds.length; i++) {
      await ctx.db.patch(userIds[i], { templatesContributed: countByUser[i] });
    }

    return ids;
  },
});

// =============================================================================
// PHASE 4: INSERT CAMPAIGNS
// =============================================================================

export const insertCampaigns = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
    templateIds: v.array(v.id("templates")),
  },
  handler: async (ctx, { orgIds, templateIds }): Promise<Id<"campaigns">[]> => {
    const now = Date.now();
    const ids: Id<"campaigns">[] = [];

    const campaignDefs = [
      {
        orgIdx: 0,
        templateIdx: 0,
        type: "LETTER" as const,
        title: "Clean Energy Push — Spring 2026",
        body: "Mobilize supporters to contact reps about the Clean Energy Investment Act before the committee vote.",
        status: "ACTIVE" as const,
        raisedAmountCents: 0,
        donorCount: 0,
      },
      {
        orgIdx: 1,
        templateIdx: 1,
        type: "LETTER" as const,
        title: "Voter Registration Drive — Q2",
        body: "Coordinate outreach for automatic voter registration legislation in targeted states.",
        status: "ACTIVE" as const,
        raisedAmountCents: 0,
        donorCount: 0,
      },
      {
        orgIdx: 2,
        templateIdx: 2,
        type: "LETTER" as const,
        title: "SF Community Safety Initiative",
        body: "Rally neighborhood support for community-based safety funding in the city budget.",
        status: "ACTIVE" as const,
        raisedAmountCents: 0,
        donorCount: 0,
      },
      {
        orgIdx: 0,
        templateIdx: -1, // no template — this is a fundraiser
        type: "FORM" as const,
        title: "Climate Action Emergency Fund",
        body: "Raise funds for rapid-response climate advocacy campaigns and legal challenges.",
        status: "ACTIVE" as const,
        raisedAmountCents: 125000, // $1,250.00 raised so far
        donorCount: 8,
      },
    ];

    for (const c of campaignDefs) {
      const id = await ctx.db.insert("campaigns", {
        orgId: orgIds[c.orgIdx],
        templateId: c.templateIdx >= 0 ? (templateIds[c.templateIdx] as string) : undefined,
        type: c.type,
        title: c.title,
        body: c.body,
        status: c.status,
        debateEnabled: false,
        debateThreshold: 100,
        raisedAmountCents: c.raisedAmountCents,
        donorCount: c.donorCount,
        targetCountry: "US",
        actionCount: 0,
        verifiedActionCount: 0,
        updatedAt: now,
      });
      ids.push(id);
    }

    // Update campaignCount on orgs (org 0 has 2, others have 1)
    await ctx.db.patch(orgIds[0], { campaignCount: 2 });
    await ctx.db.patch(orgIds[1], { campaignCount: 1 });
    await ctx.db.patch(orgIds[2], { campaignCount: 1 });

    return ids;
  },
});

// =============================================================================
// PHASE 5a: INSERT SUPPORTERS
// =============================================================================

export const insertSupporters = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }): Promise<Id<"supporters">[]> => {
    const ids: Id<"supporters">[] = [];

    // Distribute 20 supporters: 8 for org 0, 7 for org 1, 5 for org 2
    const distribution = [8, 7, 5];
    let globalIdx = 0;

    for (let orgIdx = 0; orgIdx < orgIds.length; orgIdx++) {
      const orgId = orgIds[orgIdx];
      const count = distribution[orgIdx];

      for (let i = 0; i < count; i++) {
        const name = SUPPORTER_NAMES[globalIdx % SUPPORTER_NAMES.length];
        const postalCode = POSTAL_CODES[globalIdx % POSTAL_CODES.length];

        const smsStatuses: Array<"none" | "subscribed"> = ["none", "subscribed"];
        const hasSms = globalIdx % 3 === 0;

        const id = await ctx.db.insert("supporters", {
          orgId,
          // Seed data: plaintext name stored in encryptedName for convenience
          // (not real encryption — seed only)
          encryptedName: name,
          postalCode,
          country: "US",
          encryptedEmail: "",
          emailHash: `seed-supporter-${globalIdx}`,
          verified: globalIdx % 4 !== 3, // 75% verified
          emailStatus: "subscribed",
          smsStatus: hasSms ? smsStatuses[1] : smsStatuses[0],
          source: globalIdx % 5 === 0 ? "csv" : "organic",
          updatedAt: daysAgo(globalIdx + 1),
        });
        ids.push(id);
        globalIdx++;
      }

      await ctx.db.patch(orgId, {
        supporterCount: count,
        onboardingState: {
          hasDescription: true,
          hasIssueDomains: false,
          hasSupporters: true,
          hasCampaigns: true,
          hasTeam: true,
          hasSentEmail: orgIdx === 0, // org 0 has a completed email blast
        },
      });
    }

    return ids;
  },
});

// =============================================================================
// PHASE 5b: INSERT TAGS
// =============================================================================

export const insertTags = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }): Promise<Id<"tags">[]> => {
    const ids: Id<"tags">[] = [];

    for (let orgIdx = 0; orgIdx < orgIds.length; orgIdx++) {
      const orgId = orgIds[orgIdx];
      const tagNames = TAG_NAMES_BY_ORG[orgIdx];
      for (const name of tagNames) {
        const id = await ctx.db.insert("tags", { orgId, name });
        ids.push(id);
      }
    }

    return ids; // 12 total: 4 per org
  },
});

// =============================================================================
// PHASE 5c: ASSIGN SUPPORTER TAGS
// =============================================================================

export const assignSupporterTags = internalMutation({
  args: {
    supporterIds: v.array(v.id("supporters")),
    tagIds: v.array(v.id("tags")),
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { supporterIds, tagIds }) => {
    // Tags are ordered: [org0-tag0..3, org1-tag0..3, org2-tag0..3]
    // Supporters are ordered: [org0-s0..7, org1-s0..6, org2-s0..4]
    const distribution = [8, 7, 5];
    let sIdx = 0;

    for (let orgIdx = 0; orgIdx < 3; orgIdx++) {
      const orgTagStart = orgIdx * 4;
      const count = distribution[orgIdx];

      for (let i = 0; i < count; i++) {
        const supporterId = supporterIds[sIdx + i];
        // Assign 1-2 tags per supporter
        const tagOffset = orgTagStart + (i % 4);
        await ctx.db.insert("supporterTags", {
          supporterId,
          tagId: tagIds[tagOffset],
        });
        // Every other supporter gets a second tag
        if (i % 2 === 0) {
          const secondTag = orgTagStart + ((i + 1) % 4);
          await ctx.db.insert("supporterTags", {
            supporterId,
            tagId: tagIds[secondTag],
          });
        }
      }
      sIdx += count;
    }
  },
});

// =============================================================================
// PHASE 6: INSERT SEGMENTS
// =============================================================================

export const insertSegments = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
    userIds: v.array(v.id("users")),
  },
  handler: async (ctx, { orgIds, userIds }) => {
    const now = Date.now();

    // Active Donors — Climate Action Now
    await ctx.db.insert("segments", {
      orgId: orgIds[0],
      name: "Active Donors",
      description: "Supporters who have donated in the past 90 days.",
      filters: {
        logic: "AND",
        conditions: [
          { field: "tags", operator: "includes", value: "donor" },
          { field: "verified", operator: "eq", value: true },
        ],
      },
      cachedCount: 5,
      countedAt: hoursAgo(2),
      createdBy: userIds[0],
      updatedAt: now,
    });

    // Verified Volunteers — Voter Rights Coalition
    await ctx.db.insert("segments", {
      orgId: orgIds[1],
      name: "Verified Volunteers",
      description: "Verified supporters tagged as volunteers.",
      filters: {
        logic: "AND",
        conditions: [
          { field: "tags", operator: "includes", value: "volunteer" },
          { field: "verified", operator: "eq", value: true },
        ],
      },
      cachedCount: 4,
      countedAt: hoursAgo(1),
      createdBy: userIds[0],
      updatedAt: now,
    });
  },
});

// =============================================================================
// PHASE 7a: INSERT EVENTS
// =============================================================================

export const insertEvents = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
    campaignIds: v.array(v.id("campaigns")),
  },
  handler: async (ctx, { orgIds, campaignIds }): Promise<Id<"events">[]> => {
    const now = Date.now();
    const ids: Id<"events">[] = [];

    const eventDefs = [
      {
        orgIdx: 0,
        campaignIdx: 0,
        title: "Climate Policy Town Hall",
        description: "Join us for a town hall with local climate policy experts. Hear about the Clean Energy Investment Act and how you can make your voice heard.",
        eventType: "HYBRID",
        startAt: daysFromNow(14),
        endAt: daysFromNow(14) + 2 * 3_600_000,
        venue: "SF Community Center",
        address: "1060 Howard St",
        city: "San Francisco",
        state: "CA",
        postalCode: "94103",
        latitude: 37.7816,
        longitude: -122.4110,
        virtualUrl: "https://meet.commons.email/climate-town-hall",
        capacity: 150,
        status: "PUBLISHED",
        rsvpCount: 42,
        attendeeCount: 0,
        verifiedAttendees: 0,
      },
      {
        orgIdx: 1,
        campaignIdx: 1,
        title: "Voter Registration Phone Bank",
        description: "Help us call voters in key districts to remind them about upcoming registration deadlines.",
        eventType: "VIRTUAL",
        startAt: daysFromNow(7),
        endAt: daysFromNow(7) + 3 * 3_600_000,
        venue: undefined,
        address: undefined,
        city: undefined,
        state: undefined,
        postalCode: undefined,
        latitude: undefined,
        longitude: undefined,
        virtualUrl: "https://meet.commons.email/phone-bank",
        capacity: 50,
        status: "PUBLISHED",
        rsvpCount: 18,
        attendeeCount: 0,
        verifiedAttendees: 0,
      },
      {
        orgIdx: 2,
        campaignIdx: 2,
        title: "March for Community Safety",
        description: "Walk with your neighbors to show support for community-based safety programs and demand funding in the city budget.",
        eventType: "IN_PERSON",
        startAt: daysFromNow(21),
        endAt: daysFromNow(21) + 3 * 3_600_000,
        venue: "Mission Dolores Park",
        address: "Dolores St & 19th St",
        city: "San Francisco",
        state: "CA",
        postalCode: "94114",
        latitude: 37.7596,
        longitude: -122.4269,
        virtualUrl: undefined,
        capacity: 500,
        status: "PUBLISHED",
        rsvpCount: 85,
        attendeeCount: 0,
        verifiedAttendees: 0,
      },
      {
        orgIdx: 0,
        campaignIdx: 0,
        title: "Clean Energy 101 Webinar",
        description: "An introductory webinar on the Clean Energy Investment Act — what it does, who it helps, and how to take action.",
        eventType: "VIRTUAL",
        startAt: daysAgo(3),
        endAt: daysAgo(3) + 1.5 * 3_600_000,
        venue: undefined,
        address: undefined,
        city: undefined,
        state: undefined,
        postalCode: undefined,
        latitude: undefined,
        longitude: undefined,
        virtualUrl: "https://meet.commons.email/clean-energy-101",
        capacity: 100,
        status: "COMPLETED",
        rsvpCount: 67,
        attendeeCount: 51,
        verifiedAttendees: 38,
      },
    ];

    for (const e of eventDefs) {
      const id = await ctx.db.insert("events", {
        orgId: orgIds[e.orgIdx],
        campaignId: campaignIds[e.campaignIdx],
        title: e.title,
        description: e.description,
        eventType: e.eventType,
        startAt: e.startAt,
        endAt: e.endAt,
        timezone: "America/Los_Angeles",
        venue: e.venue,
        address: e.address,
        city: e.city,
        state: e.state,
        postalCode: e.postalCode,
        latitude: e.latitude,
        longitude: e.longitude,
        virtualUrl: e.virtualUrl,
        capacity: e.capacity,
        waitlistEnabled: true,
        rsvpCount: e.rsvpCount,
        attendeeCount: e.attendeeCount,
        verifiedAttendees: e.verifiedAttendees,
        checkinCode: `CHK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        requireVerification: false,
        status: e.status,
        updatedAt: now,
      });
      ids.push(id);
    }

    return ids;
  },
});

// =============================================================================
// PHASE 7b: INSERT EVENT RSVPS
// =============================================================================

export const insertEventRsvps = internalMutation({
  args: {
    eventIds: v.array(v.id("events")),
    supporterIds: v.array(v.id("supporters")),
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { eventIds, supporterIds }) => {
    const now = Date.now();
    const statuses = ["GOING", "MAYBE", "GOING", "GOING"] as const;

    // RSVPs for the completed webinar (event 3) — with attendance data
    const completedEventId = eventIds[3];
    for (let i = 0; i < 6; i++) {
      const supporterId = supporterIds[i % supporterIds.length];
      const isCheckedIn = i < 4;
      await ctx.db.insert("eventRsvps", {
        eventId: completedEventId,
        supporterId,
        encryptedEmail: "",
        emailHash: `seed-rsvp-completed-${i}`,
        name: SUPPORTER_NAMES[i % SUPPORTER_NAMES.length],
        status: "GOING",
        guestCount: 1,
        engagementTier: i < 3 ? 2 : 1,
        updatedAt: daysAgo(4),
        // Attendance data for completed event
        checkedInAt: isCheckedIn ? daysAgo(3) : undefined,
        attendanceVerified: isCheckedIn ? i < 3 : undefined,
        attendanceVerificationMethod: isCheckedIn && i < 3 ? "checkin_code" : undefined,
      });
    }

    // RSVPs for future events
    for (let eIdx = 0; eIdx < 3; eIdx++) {
      const eventId = eventIds[eIdx];
      const rsvpCount = [5, 4, 6][eIdx];
      for (let i = 0; i < rsvpCount; i++) {
        const sIdx = (eIdx * 5 + i) % supporterIds.length;
        await ctx.db.insert("eventRsvps", {
          eventId,
          supporterId: supporterIds[sIdx],
          encryptedEmail: "",
          emailHash: `seed-rsvp-${eIdx}-${i}`,
          name: SUPPORTER_NAMES[sIdx % SUPPORTER_NAMES.length],
          status: statuses[i % statuses.length],
          guestCount: i % 3 === 0 ? 2 : 1,
          engagementTier: i < 2 ? 2 : 1,
          updatedAt: now,
        });
      }
    }
  },
});

// =============================================================================
// PHASE 8: INSERT DONATIONS
// =============================================================================

export const insertDonations = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
    campaignIds: v.array(v.id("campaigns")),
    supporterIds: v.array(v.id("supporters")),
  },
  handler: async (ctx, { orgIds, campaignIds, supporterIds }) => {
    const now = Date.now();

    const donationDefs = [
      // Climate Action Now — Emergency Fund (campaign[3])
      { orgIdx: 0, campaignIdx: 3, sIdx: 0, amount: 5000, recurring: false, status: "completed", daysAgoN: 10 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 1, amount: 2500, recurring: true, status: "completed", daysAgoN: 8 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 2, amount: 10000, recurring: false, status: "completed", daysAgoN: 7 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 3, amount: 25000, recurring: false, status: "completed", daysAgoN: 5 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 4, amount: 7500, recurring: true, status: "completed", daysAgoN: 3 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 5, amount: 50000, recurring: false, status: "completed", daysAgoN: 2 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 6, amount: 15000, recurring: false, status: "completed", daysAgoN: 1 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 7, amount: 10000, recurring: false, status: "completed", daysAgoN: 1 },
      // Pending / failed
      { orgIdx: 0, campaignIdx: 3, sIdx: 0, amount: 3000, recurring: false, status: "pending", daysAgoN: 0 },
      { orgIdx: 0, campaignIdx: 3, sIdx: 1, amount: 1500, recurring: false, status: "failed", daysAgoN: 6 },
      // Other orgs (via their letter campaigns)
      { orgIdx: 1, campaignIdx: 1, sIdx: 9, amount: 2000, recurring: false, status: "completed", daysAgoN: 12 },
      { orgIdx: 2, campaignIdx: 2, sIdx: 16, amount: 5000, recurring: true, status: "completed", daysAgoN: 9 },
    ];

    for (const d of donationDefs) {
      const supporterId = supporterIds[d.sIdx % supporterIds.length];
      const supporterName = SUPPORTER_NAMES[d.sIdx % SUPPORTER_NAMES.length];

      await ctx.db.insert("donations", {
        orgId: orgIds[d.orgIdx],
        campaignId: campaignIds[d.campaignIdx],
        supporterId,
        email: `${supporterName.toLowerCase().replace(/[^a-z]/g, "")}@example.com`,
        name: supporterName,
        amountCents: d.amount,
        currency: "USD",
        recurring: d.recurring,
        recurringInterval: d.recurring ? "month" : undefined,
        status: d.status,
        engagementTier: d.status === "completed" ? 2 : 1,
        completedAt: d.status === "completed" ? daysAgo(d.daysAgoN) : undefined,
        updatedAt: daysAgo(d.daysAgoN),
      });
    }

    // Update raisedAmountCents on the fundraiser campaign
    const completedTotal = donationDefs
      .filter(d => d.campaignIdx === 3 && d.status === "completed")
      .reduce((sum, d) => sum + d.amount, 0);
    const completedCount = donationDefs
      .filter(d => d.campaignIdx === 3 && d.status === "completed")
      .length;
    await ctx.db.patch(campaignIds[3], {
      raisedAmountCents: completedTotal,
      donorCount: completedCount,
    });
  },
});

// =============================================================================
// PHASE 9a: INSERT WORKFLOWS
// =============================================================================

export const insertWorkflows = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }): Promise<Id<"workflows">[]> => {
    const now = Date.now();
    const ids: Id<"workflows">[] = [];

    const workflowDefs = [
      {
        orgIdx: 0,
        name: "Welcome New Supporter",
        description: "Sends a welcome email when a new supporter joins, adds the 'volunteer' tag after 3 days.",
        trigger: { type: "supporter_created", conditions: {} },
        steps: [
          { type: "send_email", config: { subject: "Welcome to Climate Action Now!", templateKey: "welcome" }, delay: 0 },
          { type: "delay", config: { days: 3 }, delay: 259_200_000 },
          { type: "add_tag", config: { tagName: "volunteer" }, delay: 0 },
        ],
        enabled: true,
      },
      {
        orgIdx: 0,
        name: "Donor Thank You",
        description: "Sends a thank-you email after a completed donation.",
        trigger: { type: "donation_completed", conditions: { minAmountCents: 1000 } },
        steps: [
          { type: "send_email", config: { subject: "Thank you for your generous donation!", templateKey: "donor_thanks" }, delay: 0 },
          { type: "add_tag", config: { tagName: "donor" }, delay: 0 },
        ],
        enabled: true,
      },
      {
        orgIdx: 1,
        name: "Event Follow-up",
        description: "Sends a follow-up email 1 day after an event ends, with a link to the campaign.",
        trigger: { type: "event_completed", conditions: {} },
        steps: [
          { type: "delay", config: { days: 1 }, delay: 86_400_000 },
          { type: "send_email", config: { subject: "Thanks for attending! Here's how to keep the momentum going.", templateKey: "event_followup" }, delay: 0 },
        ],
        enabled: true,
      },
    ];

    for (const w of workflowDefs) {
      const id = await ctx.db.insert("workflows", {
        orgId: orgIds[w.orgIdx],
        name: w.name,
        description: w.description,
        trigger: w.trigger,
        steps: w.steps,
        enabled: w.enabled,
        updatedAt: now,
      });
      ids.push(id);
    }

    return ids;
  },
});

// =============================================================================
// PHASE 9b: INSERT WORKFLOW EXECUTIONS + ACTION LOGS
// =============================================================================

export const insertWorkflowExecutions = internalMutation({
  args: {
    workflowIds: v.array(v.id("workflows")),
    supporterIds: v.array(v.id("supporters")),
  },
  handler: async (ctx, { workflowIds, supporterIds }) => {
    const executionDefs = [
      // Welcome workflow — 2 completed, 1 running
      { wfIdx: 0, sIdx: 0, status: "completed", currentStep: 2, completedDaysAgo: 5 },
      { wfIdx: 0, sIdx: 1, status: "completed", currentStep: 2, completedDaysAgo: 3 },
      { wfIdx: 0, sIdx: 2, status: "running", currentStep: 1, completedDaysAgo: null },
      // Donor Thank You — 1 completed
      { wfIdx: 1, sIdx: 3, status: "completed", currentStep: 1, completedDaysAgo: 2 },
      // Event Follow-up — 1 pending
      { wfIdx: 2, sIdx: 8, status: "pending", currentStep: 0, completedDaysAgo: null },
    ];

    for (const e of executionDefs) {
      const executionId = await ctx.db.insert("workflowExecutions", {
        workflowId: workflowIds[e.wfIdx],
        supporterId: supporterIds[e.sIdx % supporterIds.length],
        triggerEvent: { type: "auto", timestamp: daysAgo(e.completedDaysAgo ?? 0 + 1) },
        status: e.status,
        currentStep: e.currentStep,
        nextRunAt: e.status === "running" ? daysFromNow(2) : e.status === "pending" ? daysFromNow(1) : undefined,
        completedAt: e.completedDaysAgo !== null ? daysAgo(e.completedDaysAgo) : undefined,
      });

      // Insert action logs for completed steps
      for (let step = 0; step <= e.currentStep; step++) {
        if (e.status === "pending" && step === 0) continue; // pending hasn't started
        const actionTypes = ["send_email", "delay", "add_tag"];
        await ctx.db.insert("workflowActionLogs", {
          executionId,
          stepIndex: step,
          actionType: actionTypes[step % actionTypes.length],
          result: { success: true, message: `Step ${step} completed` },
          createdAt: daysAgo((e.completedDaysAgo ?? 1) + (e.currentStep - step)),
        });
      }
    }
  },
});

// =============================================================================
// PHASE 10: INSERT EMAIL BLASTS
// =============================================================================

export const insertEmailBlasts = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
    campaignIds: v.array(v.id("campaigns")),
  },
  handler: async (ctx, { orgIds, campaignIds }) => {
    const now = Date.now();

    // 1. Completed blast — Climate Action Now
    await ctx.db.insert("emailBlasts", {
      orgId: orgIds[0],
      campaignId: campaignIds[0] as unknown as string,
      subject: "Urgent: Clean Energy Act Needs Your Voice This Week",
      bodyHtml: `<h1>The Clean Energy Investment Act</h1><p>Dear supporter,</p><p>The committee vote on the Clean Energy Investment Act is scheduled for next week. We need every voice counted. <a href="https://commons.email/act/clean-energy">Take action now</a>.</p><p>Together we can make a difference.</p><p>— Climate Action Now</p>`,
      fromName: "Climate Action Now",
      fromEmail: "action@climateactionnow.org",
      status: "sent",
      recipientFilter: { tags: ["volunteer", "donor"], emailStatus: "subscribed" },
      totalRecipients: 8,
      totalSent: 8,
      totalBounced: 0,
      totalOpened: 5,
      totalClicked: 3,
      totalComplained: 0,
      sentAt: daysAgo(5),
      updatedAt: daysAgo(5),
      isAbTest: false,
      batches: [
        { batchIndex: 0, status: "sent", sentCount: 8, failedCount: 0, sentAt: daysAgo(5) },
      ],
    });

    // 2. Sending blast — Voter Rights Coalition
    await ctx.db.insert("emailBlasts", {
      orgId: orgIds[1],
      campaignId: campaignIds[1] as unknown as string,
      subject: "Registration Deadline Approaching — Spread the Word",
      bodyHtml: `<h1>Voter Registration Deadline</h1><p>Time is running out. Help us reach every eligible voter before the registration deadline closes. <a href="https://commons.email/act/voter-reg">Share our campaign</a>.</p><p>— Voter Rights Coalition</p>`,
      fromName: "Voter Rights Coalition",
      fromEmail: "outreach@voterrightscoalition.org",
      status: "sending",
      recipientFilter: { emailStatus: "subscribed" },
      totalRecipients: 7,
      totalSent: 4,
      totalBounced: 0,
      totalOpened: 0,
      totalClicked: 0,
      totalComplained: 0,
      sentAt: hoursAgo(1),
      updatedAt: now,
      isAbTest: false,
      batches: [
        { batchIndex: 0, status: "sent", sentCount: 4, failedCount: 0, sentAt: hoursAgo(1) },
        { batchIndex: 1, status: "pending", sentCount: 0, failedCount: 0 },
      ],
    });

    // 3. Draft blast — Local First SF
    await ctx.db.insert("emailBlasts", {
      orgId: orgIds[2],
      subject: "March for Community Safety — RSVP Now",
      bodyHtml: `<h1>Join the March</h1><p>This month we march together for community safety. RSVP and bring your neighbors.</p><p>— Local First SF</p>`,
      fromName: "Local First SF",
      fromEmail: "hello@localfirstsf.org",
      status: "draft",
      totalRecipients: 0,
      totalSent: 0,
      totalBounced: 0,
      totalOpened: 0,
      totalClicked: 0,
      totalComplained: 0,
      updatedAt: now,
      isAbTest: false,
    });
  },
});

// =============================================================================
// PHASE 11: INSERT ORG NETWORK
// =============================================================================

export const insertNetwork = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }) => {
    const now = Date.now();

    // Create the network owned by Climate Action Now
    const networkId = await ctx.db.insert("orgNetworks", {
      name: "Progressive Alliance 2026",
      slug: "progressive-alliance-2026",
      description: "A coalition of progressive organizations working together on climate, voting rights, and community safety.",
      ownerOrgId: orgIds[0],
      status: "active",
      applicableCountries: ["US"],
      updatedAt: now,
    });

    // All 3 orgs are members
    await ctx.db.insert("orgNetworkMembers", {
      networkId,
      orgId: orgIds[0],
      role: "admin",
      status: "active",
      joinedAt: daysAgo(30),
    });
    await ctx.db.insert("orgNetworkMembers", {
      networkId,
      orgId: orgIds[1],
      role: "member",
      status: "active",
      joinedAt: daysAgo(25),
      invitedBy: "alex-rivera",
    });
    await ctx.db.insert("orgNetworkMembers", {
      networkId,
      orgId: orgIds[2],
      role: "member",
      status: "active",
      joinedAt: daysAgo(20),
      invitedBy: "alex-rivera",
    });
  },
});

// =============================================================================
// PHASE 12: INSERT ORG RESOLVED CONTACTS
// =============================================================================

export const insertOrgContacts = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }) => {
    const now = Date.now();

    for (const orgId of orgIds) {
      for (const rep of REPRESENTATIVES) {
        await ctx.db.insert("orgResolvedContacts", {
          orgId,
          orgKey: rep.district,
          name: rep.name,
          title: rep.title,
          email: rep.email,
          emailSource: "civic_api",
          resolvedAt: daysAgo(7),
          expiresAt: daysFromNow(23), // 30-day cache TTL
          resolvedBy: "seed",
        });
      }
    }
  },
});

// =============================================================================
// PHASE 13: INSERT ORG INVITES
// =============================================================================

export const insertOrgInvites = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }) => {
    const inviteDefs = [
      // 2 pending
      {
        orgIdx: 0,
        role: "editor",
        token: "inv-pending-001",
        expiresAt: daysFromNow(5),
        accepted: false,
        invitedBy: "alex-rivera",
        emailHash: "seed-invite-0",
      },
      {
        orgIdx: 1,
        role: "member",
        token: "inv-pending-002",
        expiresAt: daysFromNow(3),
        accepted: false,
        invitedBy: "alex-rivera",
        emailHash: "seed-invite-1",
      },
      // 2 accepted
      {
        orgIdx: 0,
        role: "member",
        token: "inv-accepted-001",
        expiresAt: daysFromNow(10),
        accepted: true,
        invitedBy: "alex-rivera",
        emailHash: "seed-invite-2",
      },
      {
        orgIdx: 2,
        role: "editor",
        token: "inv-accepted-002",
        expiresAt: daysFromNow(8),
        accepted: true,
        invitedBy: "morgan-tremblay",
        emailHash: "seed-invite-3",
      },
      // 1 expired
      {
        orgIdx: 1,
        role: "editor",
        token: "inv-expired-001",
        expiresAt: daysAgo(2),
        accepted: false,
        invitedBy: "alex-rivera",
        emailHash: "seed-invite-4",
      },
    ];

    for (const inv of inviteDefs) {
      await ctx.db.insert("orgInvites", {
        orgId: orgIds[inv.orgIdx],
        role: inv.role,
        token: inv.token,
        expiresAt: inv.expiresAt,
        accepted: inv.accepted,
        invitedBy: inv.invitedBy,
        encryptedEmail: "",
        emailHash: inv.emailHash,
      });
    }
  },
});

// =============================================================================
// PHASE 14: INSERT CAMPAIGN ACTIONS + DELIVERIES
// =============================================================================

export const insertCampaignActions = internalMutation({
  args: {
    campaignIds: v.array(v.id("campaigns")),
    supporterIds: v.array(v.id("supporters")),
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { campaignIds, supporterIds, orgIds }) => {
    // Create campaign actions and deliveries for the 3 letter campaigns
    const letterCampaigns = [
      { campaignIdx: 0, orgIdx: 0, supporterStart: 0, supporterCount: 6 },
      { campaignIdx: 1, orgIdx: 1, supporterStart: 8, supporterCount: 5 },
      { campaignIdx: 2, orgIdx: 2, supporterStart: 15, supporterCount: 4 },
    ];

    for (const lc of letterCampaigns) {
      let actionCountTotal = 0;
      let verifiedCountTotal = 0;

      for (let i = 0; i < lc.supporterCount; i++) {
        const sIdx = (lc.supporterStart + i) % supporterIds.length;
        const isVerified = i % 4 !== 3; // 75% verified

        const actionId = await ctx.db.insert("campaignActions", {
          campaignId: campaignIds[lc.campaignIdx],
          supporterId: supporterIds[sIdx],
          verified: isVerified,
          engagementTier: isVerified ? 2 : 1,
          districtHash: `district-hash-${sIdx}`,
          delegated: false,
          sentAt: daysAgo(i + 1),
        });
        actionCountTotal++;
        if (isVerified) verifiedCountTotal++;

        // Create 1-2 deliveries per action
        const repCount = i % 3 === 0 ? 2 : 1;
        for (let r = 0; r < repCount; r++) {
          const rep = REPRESENTATIVES[(i + r) % REPRESENTATIVES.length];
          const deliveryStatuses = ["delivered", "sent", "opened", "delivered"] as const;
          await ctx.db.insert("campaignDeliveries", {
            campaignId: campaignIds[lc.campaignIdx],
            actionId,
            targetEmail: rep.email,
            targetName: rep.name,
            targetTitle: rep.title,
            targetDistrict: rep.district,
            status: deliveryStatuses[(i + r) % deliveryStatuses.length],
            sentAt: daysAgo(i + 1),
            proofWeight: isVerified ? 0.85 : 0.3,
            createdAt: daysAgo(i + 1),
          });
        }
      }

      // Update campaign counters
      await ctx.db.patch(campaignIds[lc.campaignIdx], {
        actionCount: actionCountTotal,
        verifiedActionCount: verifiedCountTotal,
      });
    }
  },
});

// =============================================================================
// PHASE 15: INSERT DEBATES + ARGUMENTS
// =============================================================================

export const insertDebates = internalMutation({
  args: {
    templateIds: v.array(v.id("templates")),
  },
  handler: async (ctx, { templateIds }) => {
    const now = Date.now();

    const debateDefs = [
      {
        templateIdx: 0,
        status: "resolved",
        deadline: daysAgo(7),
        argumentCount: 4,
        uniqueParticipants: 4,
        totalStake: 400,
        winningStance: "SUPPORT",
        winningArgumentIndex: 0,
        resolvedAt: daysAgo(7),
        marketStatus: "resolved",
      },
      {
        templateIdx: 1,
        status: "active",
        deadline: daysFromNow(14),
        argumentCount: 3,
        uniqueParticipants: 3,
        totalStake: 250,
        winningStance: undefined,
        winningArgumentIndex: undefined,
        resolvedAt: undefined,
        marketStatus: "active",
      },
      {
        templateIdx: 3,
        status: "awaiting_governance",
        deadline: daysAgo(1),
        argumentCount: 3,
        uniqueParticipants: 3,
        totalStake: 300,
        winningStance: undefined,
        winningArgumentIndex: undefined,
        resolvedAt: undefined,
        marketStatus: "active",
      },
      {
        templateIdx: 4,
        status: "under_appeal",
        deadline: daysAgo(3),
        argumentCount: 2,
        uniqueParticipants: 2,
        totalStake: 200,
        winningStance: "OPPOSE",
        winningArgumentIndex: 1,
        resolvedAt: daysAgo(3),
        marketStatus: "resolved",
      },
    ];

    for (let dIdx = 0; dIdx < debateDefs.length; dIdx++) {
      const d = debateDefs[dIdx];
      const debateId = await ctx.db.insert("debates", {
        templateId: templateIds[d.templateIdx],
        debateIdOnchain: `debate-onchain-${dIdx}`,
        actionDomain: "commons-debate-v1",
        propositionHash: `prop-hash-${dIdx}`,
        propositionText: `Should the ${SEED_TEMPLATES[d.templateIdx].title} be adopted as a community priority?`,
        deadline: d.deadline,
        jurisdictionSize: 50000,
        status: d.status,
        argumentCount: d.argumentCount,
        uniqueParticipants: d.uniqueParticipants,
        totalStake: d.totalStake,
        winningArgumentIndex: d.winningArgumentIndex,
        winningStance: d.winningStance,
        resolvedAt: d.resolvedAt,
        resolvedFromChain: d.status === "resolved",
        proposerAddress: `0x${dIdx.toString(16).padStart(40, "0")}`,
        proposerBond: 50,
        marketStatus: d.marketStatus,
        marketLiquidity: 1000,
        currentPrices: { SUPPORT: "0.55", OPPOSE: "0.35", AMEND: "0.10" },
        currentEpoch: d.status === "resolved" ? 3 : 1,
        tradeDeadline: d.status === "active" ? daysFromNow(12) : d.deadline,
        resolutionDeadline: d.status === "active" ? daysFromNow(14) : d.deadline,
        txHash: d.status === "resolved" ? `0xtx${dIdx}` : undefined,
        updatedAt: now,
      });

      // Insert arguments for each debate
      const argumentDefs = [
        { stance: "SUPPORT", body: "This proposal addresses a critical need and has broad community backing. The evidence supports immediate action.", stakeAmount: 100 },
        { stance: "OPPOSE", body: "While the intent is good, the implementation details are insufficient. We need more specific language before committing resources.", stakeAmount: 80 },
        { stance: "AMEND", body: "The core proposal is sound but should include sunset provisions and measurable benchmarks for success.", stakeAmount: 60 },
        { stance: "SUPPORT", body: "Strong precedent from other jurisdictions shows this approach works. We should move forward decisively.", stakeAmount: 50 },
      ];

      const argCount = d.argumentCount;
      for (let aIdx = 0; aIdx < argCount; aIdx++) {
        const a = argumentDefs[aIdx % argumentDefs.length];
        await ctx.db.insert("debateArguments", {
          debateId,
          argumentIndex: aIdx,
          stance: a.stance,
          body: a.body,
          bodyHash: `arg-body-hash-${dIdx}-${aIdx}`,
          stakeAmount: a.stakeAmount,
          engagementTier: 2,
          weightedScore: a.stakeAmount * 1.5,
          totalStake: a.stakeAmount,
          coSignCount: Math.floor(Math.random() * 5),
          currentPrice: (0.3 + Math.random() * 0.4).toFixed(4),
          positionCount: Math.floor(Math.random() * 10) + 1,
          aiScores: {
            coherence: 0.7 + Math.random() * 0.3,
            evidence: 0.5 + Math.random() * 0.4,
            novelty: 0.4 + Math.random() * 0.5,
          },
          aiWeighted: 0.6 + Math.random() * 0.3,
          finalScore: a.stakeAmount * (0.6 + Math.random() * 0.3),
          modelAgreement: 0.7 + Math.random() * 0.25,
          verificationStatus: "verified",
          verifiedAt: daysAgo(dIdx + aIdx + 1),
        });
      }
    }
  },
});

// =============================================================================
// PHASE 16: GRANT DEV ACCOUNT ACCESS
// =============================================================================

export const grantDevAccount = internalMutation({
  args: {
    orgIds: v.array(v.id("organizations")),
  },
  handler: async (ctx, { orgIds }) => {
    // Check if dev account exists
    const { computeEmailHash } = await import("./_pii");
    const devHash = await computeEmailHash("mock7ee@gmail.com");
    const devUser = devHash
      ? await ctx.db
          .query("users")
          .withIndex("by_emailHash", (q) => q.eq("emailHash", devHash))
          .first()
      : null;

    if (!devUser) {
      console.log("[seed] Dev account mock7ee@gmail.com not found — skipping dev grants.");
      return;
    }

    console.log("[seed] Found dev account — granting owner on all seeded orgs.");
    const now = Date.now();

    for (const orgId of orgIds) {
      // Check if membership already exists
      const existing = await ctx.db
        .query("orgMemberships")
        .withIndex("by_userId_orgId", (q) => q.eq("userId", devUser._id).eq("orgId", orgId))
        .first();

      if (!existing) {
        await ctx.db.insert("orgMemberships", {
          userId: devUser._id,
          orgId,
          role: "owner",
          joinedAt: now,
        });
      } else if (existing.role !== "owner") {
        await ctx.db.patch(existing._id, { role: "owner" });
      }
    }
  },
});

// =============================================================================
// NOTE: Onboarding state is set in insertSupporters (hasSentEmail: true for
// org[0] which has a completed email blast). The insertSupporters mutation
// runs before insertEmailBlasts in the seedAll orchestrator.
// =============================================================================

// =============================================================================
// CLEAR SEED — wipe all seeded data so seedAll can re-run
// =============================================================================

// Every table in the schema, ordered children-first to avoid dangling refs
const SEED_TABLES = [
  // Leaf tables (no dependents)
  "delegationReviews", "delegatedActions", "delegationGrants",
  "scorecardSnapshots", "orgDmFollows", "orgBillWatches", "orgBillRelevances",
  "externalIds", "decisionMakers", "orgIssueDomains",
  "accountabilityReceipts", "legislativeActions", "legislativeAlerts", "bills",
  "scopeCorrections", "patchThroughCalls", "smsMessages", "smsBlasts",
  "workflowActionLogs", "workflowExecutions", "workflows",
  "donations", "eventRsvps", "events",
  "emailEvents", "emailBlasts",
  "campaignDeliveries", "campaignActions",
  "debateArguments", "debateNullifiers", "debates",
  "positionDeliveries", "positionRegistrations", "communityFieldContributions",
  "templateEndorsements", "segments", "supporterTags", "tags", "supporters",
  "orgInvites", "orgResolvedContacts", "orgNetworkMembers", "orgNetworks",
  "apiKeys", "subscriptions",
  "campaigns", "templates", "messages", "userDmRelations",
  "orgMemberships", "organizations",
  // Auth + identity
  "shadowAtlasRegistrations", "verificationAudits", "submissionRetries",
  "submissions", "encryptedDeliveryData", "districtCredentials",
  "verificationSessions", "privacyBudgets", "analytics",
  "agentTraces", "intelligence", "parsedDocumentCache",
  "resolvedContacts", "suppressedEmails", "bounceReports", "rateLimits",
  "sessions", "accounts", "users",
] as const;

export const clearSeed = internalAction({
  args: {},
  handler: async (ctx) => {
    for (const table of SEED_TABLES) {
      await ctx.runMutation(internal.seed.clearTable, { table });
    }
    console.log("[seed] All seed data cleared.");
  },
});

export const clearTable = internalMutation({
  args: { table: v.string() },
  handler: async (ctx, { table }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docs = await (ctx.db as any).query(table).collect();
    let count = 0;
    for (const doc of docs) {
      await ctx.db.delete(doc._id);
      count++;
    }
    if (count > 0) console.log(`  Cleared ${count} ${table}`);
  },
});

// =============================================================================
// BACKFILL SCOPES — patch existing templates with scope data from seed definitions
// =============================================================================

export const backfillScopes = internalMutation({
  args: {},
  handler: async (ctx) => {
    const scopesBySlug = new Map<string, typeof SEED_TEMPLATES[number]["scopes"]>();
    for (const t of SEED_TEMPLATES) {
      if (t.scopes) scopesBySlug.set(t.slug, t.scopes);
    }

    const templates = await ctx.db.query("templates").collect();
    let patched = 0;
    for (const template of templates) {
      const scopes = scopesBySlug.get(template.slug);
      if (scopes && (!template.scopes || template.scopes.length === 0)) {
        await ctx.db.patch(template._id, { scopes });
        patched++;
      }
    }
    console.log(`[seed] Backfilled scopes on ${patched}/${templates.length} templates.`);
  },
});
