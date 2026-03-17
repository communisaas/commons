/**
 * Source Evaluator — Gemini Incentive-Aware Source Ranking
 *
 * Evaluates source candidates using Gemini with structured JSON output.
 * Assesses incentive alignment, source order, claim specificity, geographic
 * precision, and temporal relevance — producing credibility rationales that
 * the message writer uses to cite sources intelligently.
 *
 * Key design: grounding is DISABLED. The evaluator receives pre-fetched
 * content and provenance signals — its job is judgment, not search.
 * responseSchema guarantees structured output (no JSON extraction fragility).
 *
 * @module agents/source-evaluator
 */

import { generate } from '../gemini-client';
import type { SourceCandidate, EvaluatedSource, TokenUsage } from '../types';
import { extractTokenUsage } from '../gemini-client';

// ============================================================================
// Schema
// ============================================================================

/**
 * Gemini-compatible responseSchema for structured source evaluation output.
 * Guarantees valid JSON — no regex extraction, no grounding-json parsing.
 */
const SOURCE_EVALUATION_SCHEMA = {
	type: 'object',
	properties: {
		sources: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					candidate_index: {
						type: 'integer',
						description: 'Zero-based index into the candidates array'
					},
					title: { type: 'string' },
					url: { type: 'string' },
					type: {
						type: 'string',
						enum: ['journalism', 'research', 'government', 'legal', 'advocacy', 'other']
					},
					snippet: {
						type: 'string',
						description: 'Brief description of what this source covers'
					},
					relevance: {
						type: 'string',
						description: 'How this source supports the message'
					},
					date: { type: 'string', description: 'Publication date if available' },
					publisher: { type: 'string' },
					excerpt: {
						type: 'string',
						description: 'The strongest specific claim or data point from the source'
					},
					credibility_rationale: {
						type: 'string',
						description: 'Why this source is credible for this specific message to these decision-makers'
					},
					incentive_position: {
						type: 'string',
						enum: ['adversarial', 'neutral', 'aligned'],
						description: 'Source creator incentive relationship to the citizen position'
					},
					source_order: {
						type: 'string',
						enum: ['primary', 'secondary', 'opinion'],
						description: 'Whether this is a primary data producer or secondary reporting'
					}
				},
				required: [
					'candidate_index',
					'title',
					'url',
					'type',
					'relevance',
					'credibility_rationale',
					'incentive_position',
					'source_order'
				]
			}
		}
	},
	required: ['sources']
};

// ============================================================================
// Prompt Construction
// ============================================================================

function buildEvaluatorPrompt(
	candidates: SourceCandidate[],
	context: {
		subjectLine: string;
		coreMessage: string;
		topics: string[];
		geographicScope?: { type: string; country?: string; subdivision?: string; locality?: string };
		decisionMakers?: Array<{ name: string; title: string; organization: string }>;
	}
): string {
	// Location context
	let locationContext = '';
	if (context.geographicScope) {
		const geo = context.geographicScope;
		if (geo.locality) {
			locationContext = `Geographic Focus: ${geo.locality}, ${geo.subdivision || ''} ${geo.country || ''}`.trim();
		} else if (geo.subdivision) {
			locationContext = `Geographic Focus: ${geo.subdivision}, ${geo.country || ''}`.trim();
		} else if (geo.country) {
			locationContext = `Geographic Focus: ${geo.country}`;
		}
	}

	// Decision maker context
	const decisionMakerContext = context.decisionMakers?.length
		? context.decisionMakers.map(dm => `${dm.name}, ${dm.title} at ${dm.organization}`).join('; ')
		: 'Not specified';

	// Format candidates with provenance
	const candidateBlocks = candidates.map((c, i) => {
		const parts = [
			`[${i}] ${c.title}`,
			`    URL: ${c.url}`,
			`    Published: ${c.publishedDate || 'Unknown'}`,
			`    Publisher: ${c.provenance.publisher}`,
			`    Source Order: ${c.provenance.sourceOrder}`,
			`    Search Stratum: ${c.stratum}`
		];

		if (c.provenance.orgDescription) {
			parts.push(`    Org: ${c.provenance.orgDescription}`);
		}
		if (c.provenance.fundingDisclosure) {
			parts.push(`    Funding: ${c.provenance.fundingDisclosure}`);
		}
		if (c.provenance.advocacyIndicators.length > 0) {
			parts.push(`    Advocacy Signals: ${c.provenance.advocacyIndicators.join('; ')}`);
		}
		if (c.provenance.hasMethodology) {
			parts.push(`    Has methodology section`);
		}
		if (c.provenance.author) {
			parts.push(`    Author: ${c.provenance.author}`);
		}

		parts.push('');
		parts.push(`    CONTENT EXCERPT:`);
		parts.push(`    ${c.excerpt}`);

		return parts.join('\n');
	}).join('\n\n---\n\n');

	return `You are evaluating sources for a civic message. Your job is not to rank by prestige — it is to assess which sources would be most credible TO THE DECISION-MAKER receiving this message.

## Message Context
Subject: ${context.subjectLine}
Core Message: ${context.coreMessage}
Topics: ${context.topics.join(', ')}
${locationContext ? locationContext + '\n' : ''}Decision-Makers: ${decisionMakerContext}

## Candidates

${candidateBlocks}

## Evaluation Criteria

For each candidate, assess:

1. **Incentive alignment** — Does the source's creator benefit from the claims being true, false, or alarming? A source with incentive AGAINST the citizen's position whose data still supports it is maximally credible (adversarial citation). A source with incentive aligned with the position is weaker (confirmation source). Flag sources where the incentive structure suggests the framing may be misleading even if specific data points are accurate.

2. **Source order** — Is this a primary data producer (collected the data, ran the study, passed the legislation) or secondary reporting (article about someone else's data)? Primary sources carry more weight. If secondary, does it cite its primary source?

3. **Claim specificity** — Does the excerpt contain specific, citable facts (numbers, dates, vote counts, findings) or general assertions? Decision-makers dismiss vague claims. Specific data points from the source's own expertise domain are strongest.

4. **Geographic precision** — Is the source about this specific jurisdiction, or is it national/general data being applied locally? Local data about local issues is more credible to local decision-makers than national statistics.

5. **Temporal relevance** — Is the data current enough to be actionable? A source from the current legislative session is more relevant than one from two sessions ago.

Select the 3-6 strongest sources. For each, provide:
- A credibility_rationale explaining why this source is credible for THIS specific message to THESE specific decision-makers
- The source's incentive_position (adversarial, neutral, or aligned) relative to the citizen's position
- The source_order (primary, secondary, or opinion)
- A snippet summarizing the source's core contribution
- An excerpt containing the strongest specific claim from the content that the message writer should cite
- The source type (journalism, research, government, legal, advocacy, or other)

Use the candidate_index field to reference which candidate you are evaluating (zero-based index).`;
}

// ============================================================================
// Evaluator
// ============================================================================

export interface EvaluateSourcesResult {
	sources: EvaluatedSource[];
	tokenUsage?: TokenUsage;
}

/**
 * Evaluate source candidates using Gemini with structured JSON output.
 *
 * Uses generate() with responseSchema — guaranteed structured output,
 * no grounding, no JSON extraction fragility.
 *
 * @param candidates - Source candidates with content excerpts and provenance signals
 * @param context - Message context for evaluation (subject, message, topics, geo, decision-makers)
 * @param onThought - Optional callback for streaming evaluation progress
 * @returns Evaluated sources with credibility rationale and incentive analysis
 */
export async function evaluateSources(
	candidates: SourceCandidate[],
	context: {
		subjectLine: string;
		coreMessage: string;
		topics: string[];
		geographicScope?: { type: string; country?: string; subdivision?: string; locality?: string };
		decisionMakers?: Array<{ name: string; title: string; organization: string }>;
	},
	onThought?: (thought: string) => void
): Promise<EvaluateSourcesResult> {
	if (candidates.length === 0) {
		return { sources: [], tokenUsage: undefined };
	}

	console.debug('[source-evaluator] Evaluating', candidates.length, 'candidates...');

	const prompt = buildEvaluatorPrompt(candidates, context);

	const response = await generate(prompt, {
		temperature: 0.3,
		enableGrounding: false,
		responseSchema: SOURCE_EVALUATION_SCHEMA,
		maxOutputTokens: 65536,
		systemInstruction: 'You are a source credibility evaluator for civic messaging. Evaluate sources based on incentive alignment, not prestige. Output structured JSON.'
	});

	const tokenUsage = extractTokenUsage(response);

	// Parse the structured JSON response
	const responseText = response.text;
	if (!responseText) {
		console.error('[source-evaluator] Empty response from Gemini');
		return { sources: [], tokenUsage };
	}

	let parsed: { sources: Array<Record<string, unknown>> };
	try {
		parsed = JSON.parse(responseText);
	} catch (error) {
		console.error('[source-evaluator] Failed to parse response JSON:', error);
		return { sources: [], tokenUsage };
	}

	if (!parsed.sources || !Array.isArray(parsed.sources)) {
		console.error('[source-evaluator] Response missing sources array');
		return { sources: [], tokenUsage };
	}

	// Map response back to EvaluatedSource[], resolving candidate_index
	const evaluated: EvaluatedSource[] = [];

	for (const s of parsed.sources) {
		const idx = typeof s.candidate_index === 'number' ? s.candidate_index : -1;
		const candidate = idx >= 0 && idx < candidates.length ? candidates[idx] : null;

		evaluated.push({
			num: evaluated.length + 1,
			title: (s.title as string) || candidate?.title || 'Unknown',
			url: (s.url as string) || candidate?.url || '',
			type: (s.type as EvaluatedSource['type']) || 'other',
			snippet: (s.snippet as string) || '',
			relevance: (s.relevance as string) || '',
			date: (s.date as string) || candidate?.publishedDate,
			publisher: (s.publisher as string) || candidate?.provenance.publisher,
			excerpt: (s.excerpt as string) || candidate?.excerpt || '',
			credibility_rationale: (s.credibility_rationale as string) || '',
			incentive_position: (s.incentive_position as EvaluatedSource['incentive_position']) || 'neutral',
			source_order: (s.source_order as EvaluatedSource['source_order']) || 'secondary'
		});
	}

	onThought?.(`Evaluated ${evaluated.length} sources: ${evaluated.filter(s => s.incentive_position === 'adversarial').length} adversarial, ${evaluated.filter(s => s.incentive_position === 'neutral').length} neutral, ${evaluated.filter(s => s.incentive_position === 'aligned').length} aligned.`);

	console.debug('[source-evaluator] Evaluation complete:', {
		evaluated: evaluated.length,
		adversarial: evaluated.filter(s => s.incentive_position === 'adversarial').length,
		neutral: evaluated.filter(s => s.incentive_position === 'neutral').length,
		aligned: evaluated.filter(s => s.incentive_position === 'aligned').length
	});

	return { sources: evaluated, tokenUsage };
}
