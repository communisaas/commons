/**
 * Canonical seed vibes — the user inputs that drive the template pipeline.
 *
 * Each vibe is a short policy description that gets processed through:
 *   subject line → decision maker resolution → message generation → moderation
 *
 * To add a new template, add a vibe here and re-run:
 *   npx tsx scripts/seed-with-agents.ts
 */

export type { Vibe } from './lib/seed-pipeline';

export const VIBES: Vibe[] = [
	// ── US Federal ────────────────────────────────────────────────────────
	{
		vibe: "The VA's telehealth program served 2.4 million veterans last year and cut wait times by 40%. It works. Fund the expansion to every rural clinic in the country.",
		fallbackCategory: 'healthcare',
		countryCode: 'US',
		audienceGuidance: "Target Secretary of Veterans Affairs, Under Secretary for Health (VHA), Executive Director of Office of Connected Care, Director of Office of Rural Health, and relevant Senate/House Veterans' Affairs Committee leadership — congressional representatives are routed separately via CWC"
	},
	{
		vibe: "Kids spend 7 hours a day online. Companies harvest 72 million data points per child per year. Federal privacy law hasn't updated since 1998 — COPPA is older than the kids it's supposed to protect.",
		fallbackCategory: 'technology',
		countryCode: 'US',
		audienceGuidance: "Focus on executive branch leadership and relevant agency heads — congressional routing is handled separately via CWC"
	},

	// ── US State ──────────────────────────────────────────────────────────
	{
		vibe: "Colorado's universal preschool program costs $322 million and saves families $336 million in childcare. Every dollar returns $4.30 in reduced remediation and lifetime earnings. Every state should replicate this.",
		fallbackCategory: 'education',
		countryCode: 'US',
		locationHint: { state: 'CO', displayName: 'Colorado' },
		scopeHint: 'national',
		audienceGuidance: "Focus on governor's office, relevant state agency directors, and committee chairs — federal congressional routing handled separately"
	},
	{
		vibe: "Oregon's drug treatment courts cost $7,100 less per person than incarceration. Recidivism dropped 31%. Taxpayers save money, families stay together, outcomes improve across every metric.",
		fallbackCategory: 'criminal-justice',
		countryCode: 'US',
		locationHint: { state: 'OR', displayName: 'Oregon' },
		audienceGuidance: "Focus on governor's office, relevant state agency directors, and committee chairs — federal congressional routing handled separately"
	},

	// ── US Municipal ──────────────────────────────────────────────────────
	{
		vibe: "Portland approved 3D-printed homes at $160K each when traditional construction costs $450K. Austin's community land trusts created 1,200 permanently affordable homes. Why are most cities still banning both?",
		fallbackCategory: 'housing',
		countryCode: 'US',
		locationHint: { state: 'OR', city: 'Portland', displayName: 'Portland, OR' },
		audienceGuidance: "Focus on city/county officials, department heads, and relevant board members — federal congressional routing handled separately"
	},
	{
		vibe: "When Seoul tore down a highway and restored the Cheonggyecheon stream, property values rose 25% and air quality improved 35%. Dallas, Rochester, and Syracuse are considering the same. Urban freeways are scars, not infrastructure.",
		fallbackCategory: 'infrastructure',
		countryCode: 'US',
		audienceGuidance: "Focus on federal agency heads (DOT, FHWA) and city officials leading removal projects — congressional routing handled separately"
	},

	// ── Canadian Federal ──────────────────────────────────────────────────
	{
		vibe: "Canada's national parks generate $3.3 billion in visitor spending on a $900 million Parks Canada budget — a 3.6x return. But there's a $3.6 billion maintenance backlog. Investing in parks literally pays for itself.",
		fallbackCategory: 'environment',
		countryCode: 'CA'
	},
	{
		vibe: "Express Entry processes skilled worker applications in 6 months. The US employment green card backlog is 1.8 million people deep — some wait 134 years. Canada proves fast, fair immigration processing is a policy choice.",
		fallbackCategory: 'immigration',
		countryCode: 'US'
	},

	// ── Canadian Provincial ───────────────────────────────────────────────
	{
		vibe: "Ontario public libraries run free coding bootcamps that have placed 2,400 people in tech jobs since 2022. No tuition, no debt, no waitlist — just a library card. Scale it province-wide.",
		fallbackCategory: 'education',
		countryCode: 'CA',
		locationHint: { state: 'ON', displayName: 'Ontario' }
	},
	{
		vibe: "First Nations communities in BC generate 40% of the province's clean energy. They receive 3% of resource extraction revenue from their own territories. If reconciliation means anything, the revenue sharing has to match the contribution.",
		fallbackCategory: 'indigenous-rights',
		countryCode: 'CA',
		locationHint: { state: 'BC', displayName: 'British Columbia' }
	},

	// ── Canadian Municipal ────────────────────────────────────────────────
	{
		vibe: "Montreal's BIXI bike-share program cut downtown car trips by 12% and saves $14 million per year in healthcare costs from reduced pollution. It costs the city $5 per resident per year.",
		fallbackCategory: 'transportation',
		countryCode: 'CA',
		locationHint: { state: 'QC', city: 'Montreal', displayName: 'Montreal, QC' }
	},

	// ── Corporate ─────────────────────────────────────────────────────────
	{
		vibe: "Apple holds $162 billion in cash reserves. Their retail employees start at $22/hour. Fifteen minutes of Apple's daily interest income equals one retail worker's entire annual salary.",
		fallbackCategory: 'labor',
		countryCode: 'US',
		targetHint: 'corporate'
	}
];
