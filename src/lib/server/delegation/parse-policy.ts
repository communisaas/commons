/**
 * Delegation Policy Parser — Gemini AI Integration
 *
 * Takes natural language policy descriptions and extracts structured
 * delegation constraints using the existing Gemini infrastructure.
 *
 * Example: "Sign climate petitions in my district, max 3 per day"
 * → { scope: 'campaign_sign', issueFilter: ['climate'], maxActionsPerDay: 3, ... }
 */

import { generate } from '$lib/core/agents/gemini-client';

export interface ParsedPolicy {
	scope: 'campaign_sign' | 'debate_position' | 'message_generate' | 'full';
	issueFilter: string[];
	orgFilter: string[];
	maxActionsPerDay: number;
	requireReviewAbove: number;
}

const POLICY_PARSE_SCHEMA = {
	type: 'object' as const,
	properties: {
		scope: {
			type: 'string' as const,
			enum: ['campaign_sign', 'debate_position', 'message_generate', 'full'],
			description: 'What the agent is allowed to do'
		},
		issueFilter: {
			type: 'array' as const,
			items: { type: 'string' as const },
			description:
				'Issue domains to restrict actions to (e.g., climate, housing, healthcare). Empty array means all issues.'
		},
		orgFilter: {
			type: 'array' as const,
			items: { type: 'string' as const },
			description:
				'Organization IDs or names to restrict actions to. Empty array means all orgs.'
		},
		maxActionsPerDay: {
			type: 'number' as const,
			description: 'Maximum number of actions per day (1-20). Default 5.'
		},
		requireReviewAbove: {
			type: 'number' as const,
			description:
				'Proof weight threshold above which human review is required. Default 10.'
		}
	},
	required: ['scope', 'issueFilter', 'orgFilter', 'maxActionsPerDay', 'requireReviewAbove']
};

const SYSTEM_INSTRUCTION = `You are a policy parser for a civic engagement platform's delegation system.

Users describe what they want an AI agent to do on their behalf in natural language.
Your job is to extract structured constraints from their description.

SCOPE values:
- "campaign_sign": Sign petitions and campaigns
- "debate_position": Take positions in debate markets
- "message_generate": Generate personalized messages to decision-makers
- "full": All of the above

RULES:
- If the user mentions signing, petitions, or campaigns → scope = "campaign_sign"
- If the user mentions debates, positions, or arguments → scope = "debate_position"
- If the user mentions messages, letters, or contacting officials → scope = "message_generate"
- If the user says "everything", "all actions", or is not specific → scope = "full"
- issueFilter should be lowercase topic words (e.g., "climate", "housing", "healthcare")
- If no specific issues mentioned, issueFilter = []
- orgFilter should only be populated if the user names specific organizations
- maxActionsPerDay defaults to 5, range 1-20
- requireReviewAbove defaults to 10
- Be conservative: if unclear, use narrower scope and lower limits`;

/**
 * Parse a natural language policy description into structured constraints.
 *
 * @param policyText - User's natural language policy description
 * @returns Structured delegation policy
 * @throws Error if Gemini API fails or returns unparseable result
 */
export async function parsePolicy(policyText: string): Promise<ParsedPolicy> {
	const prompt = `Parse this delegation policy into structured constraints:\n\n"${policyText}"`;

	const response = await generate(prompt, {
		systemInstruction: SYSTEM_INSTRUCTION,
		responseSchema: POLICY_PARSE_SCHEMA,
		temperature: 0.1
	});

	const text = response.text;
	if (!text) {
		throw new Error('[delegation/parse-policy] Empty response from Gemini');
	}

	const parsed = JSON.parse(text) as ParsedPolicy;

	// Validate and clamp values
	const validScopes = ['campaign_sign', 'debate_position', 'message_generate', 'full'] as const;
	if (!validScopes.includes(parsed.scope)) {
		parsed.scope = 'campaign_sign'; // conservative default
	}

	parsed.maxActionsPerDay = Math.max(1, Math.min(20, Math.round(parsed.maxActionsPerDay || 5)));
	parsed.requireReviewAbove = Math.max(0, parsed.requireReviewAbove ?? 10);
	parsed.issueFilter = (parsed.issueFilter || []).map((s) => s.toLowerCase().trim()).filter(Boolean);
	parsed.orgFilter = (parsed.orgFilter || []).filter(Boolean);

	return parsed;
}
