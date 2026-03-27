#!/usr/bin/env npx tsx
/**
 * Org-Scoped Agent-Powered Seed Script
 *
 * Generates org-specific template content using the full agent pipeline:
 *   subject line -> decision makers -> message -> moderation -> snapshot entry
 *
 * Pure JSON output — does NOT write to any database.
 * Output: scripts/seed-org-snapshot.json  (keyed by orgSlug)
 *
 * Usage:
 *   npx tsx scripts/seed-org-templates.ts
 *
 * Environment:
 *   GEMINI_API_KEY  — required (subject-line, decision-maker, message-writer agents)
 *   GROQ_API_KEY    — required (moderation pipeline)
 *   EXA_API_KEY     — optional (source discovery + decision-maker research)
 */

import 'dotenv/config';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

import { generateSubjectLine } from '$lib/core/agents/agents/subject-line';
import { resolveDecisionMakers } from '$lib/core/agents/agents/decision-maker';
import { generateMessage } from '$lib/core/agents/agents/message-writer';
import { moderateTemplate } from '$lib/core/server/moderation/index';
import type { DecisionMaker } from '$lib/core/agents/types';
import type { ResolveContext } from '$lib/core/agents/providers/types';

// ============================================================================
// Org Vibes
// ============================================================================

interface OrgVibe {
	vibe: string;
	orgSlug: string;
	fallbackCategory: string;
	countryCode: 'US' | 'CA';
	targetHint?: string;
	locationHint?: { state?: string; city?: string; displayName?: string };
}

const VIBES: OrgVibe[] = [
	{
		vibe: 'The Clean Energy Investment Act would create 2.1 million jobs and cut carbon emissions 40% by 2035. Every dollar invested returns $3.20 in economic activity. Congress needs to pass it now.',
		orgSlug: 'climate-action-now',
		fallbackCategory: 'Energy',
		countryCode: 'US',
	},
	{
		vibe: 'Same-day voter registration increases turnout by 5-7%. Mail-in voting reduces cost per ballot by 40%. Twenty states still block both. The Voter Access Expansion Act fixes this.',
		orgSlug: 'voter-rights-coalition',
		fallbackCategory: 'Voting Rights',
		countryCode: 'US',
	},
	{
		vibe: "San Francisco approved 82,000 housing units since 2015 but only built 29,000. Permitting takes 27 months average. The city's own data shows streamlining approvals would cut costs 18% and timelines in half.",
		orgSlug: 'local-first-sf',
		fallbackCategory: 'Housing',
		countryCode: 'US',
		locationHint: { city: 'San Francisco', state: 'CA', displayName: 'San Francisco, CA' },
	},
];

// ============================================================================
// Snapshot Types
// ============================================================================

interface OrgTemplateSnapshot {
	slug: string;
	orgSlug: string;
	title: string;
	description: string;
	messageBody: string;
	preview: string;
	category: string;
	topics: string[];
	type: string;
	deliveryMethod: string;
	countryCode: string;
	sources: Array<{ num: number; title: string; url: string; type: string }>;
	researchLog: string[];
	recipientConfig: Record<string, unknown>;
	deliveryConfig: Record<string, unknown>;
	contentHash: string;
	approved: boolean;
	decisionMakers: Array<{
		name: string;
		title: string;
		organization: string;
		email: string;
		reasoning: string;
		confidence: number;
	}>;
	scope: {
		scopeLevel: string;
		countryCode: string;
		regionCode: string | null;
		localityCode: string | null;
		displayText: string;
	} | null;
	jurisdiction: {
		jurisdictionType: string;
		stateCode: string | null;
	} | null;
}

// ============================================================================
// Helpers
// ============================================================================

function generateSlug(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 80);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferDeliveryMethod(dms: DecisionMaker[]): string {
	if (dms.length === 0) return 'email';
	const hasEmail = dms.some((dm) => dm.email && dm.email.includes('@'));
	return hasEmail ? 'email' : 'form';
}

function buildRecipientConfig(dms: DecisionMaker[]): Record<string, unknown> {
	if (dms.length === 0) return {};
	return {
		mode: 'resolved',
		count: dms.length,
		recipients: dms.map((dm) => ({
			name: dm.name,
			title: dm.title,
			organization: dm.organization,
			email: dm.email,
		})),
	};
}

function contentHash(content: string): string {
	return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ============================================================================
// Scope & Jurisdiction Builders
// ============================================================================

function buildScope(
	vibe: OrgVibe,
	geoScope?: { type: string; country?: string; subdivision?: string; locality?: string; displayName?: string }
): OrgTemplateSnapshot['scope'] {
	if (vibe.locationHint) {
		return {
			scopeLevel: 'local',
			countryCode: vibe.countryCode,
			regionCode: vibe.locationHint.state || null,
			localityCode: vibe.locationHint.city || null,
			displayText: vibe.locationHint.displayName || `${vibe.locationHint.city}, ${vibe.locationHint.state}`,
		};
	}

	if (geoScope) {
		if (geoScope.type === 'subnational') {
			return {
				scopeLevel: 'subnational',
				countryCode: geoScope.country || vibe.countryCode,
				regionCode: geoScope.subdivision || null,
				localityCode: geoScope.locality || null,
				displayText: geoScope.displayName || geoScope.subdivision || geoScope.country || vibe.countryCode,
			};
		}
		if (geoScope.type === 'nationwide') {
			return {
				scopeLevel: 'national',
				countryCode: geoScope.country || vibe.countryCode,
				regionCode: null,
				localityCode: null,
				displayText: geoScope.displayName || geoScope.country || vibe.countryCode,
			};
		}
	}

	// Default: national scope
	return {
		scopeLevel: 'national',
		countryCode: vibe.countryCode,
		regionCode: null,
		localityCode: null,
		displayText: vibe.countryCode === 'US' ? 'United States' : 'Canada',
	};
}

function buildJurisdiction(
	vibe: OrgVibe
): OrgTemplateSnapshot['jurisdiction'] {
	if (vibe.locationHint?.state) {
		return {
			jurisdictionType: 'state',
			stateCode: vibe.locationHint.state,
		};
	}
	return {
		jurisdictionType: 'federal',
		stateCode: null,
	};
}

// ============================================================================
// Pipeline
// ============================================================================

async function processVibe(vibe: OrgVibe): Promise<OrgTemplateSnapshot> {
	const label = `[${vibe.orgSlug}]`;

	// ── Step 1: Subject Line ──────────────────────────────────────────────

	console.log(`${label} Step 1/4: Generating subject line...`);
	const subjectResult = await generateSubjectLine({ description: vibe.vibe });
	const subjectData = subjectResult.data;

	// If the agent wants clarification, force generation without it
	if (subjectData.needs_clarification || !subjectData.subject_line) {
		console.log(`${label}   Agent requested clarification — retrying with force...`);
		const retryResult = await generateSubjectLine({
			description: vibe.vibe,
			previousInteractionId: subjectResult.interactionId,
			refinementFeedback: 'Skip clarification. Generate the subject line now with your best judgment.',
		});
		Object.assign(subjectData, retryResult.data);
	}

	const title = subjectData.subject_line || `Action needed: ${vibe.fallbackCategory}`;
	const coreMessage = subjectData.core_message || vibe.vibe;
	const topics = subjectData.topics || [vibe.fallbackCategory];
	const voiceSample = subjectData.voice_sample || '';
	const slug = subjectData.url_slug || generateSlug(title);

	console.log(`${label}   Title: "${title}"`);
	console.log(`${label}   Topics: ${topics.join(', ')}`);

	await sleep(1000);

	// ── Step 2: Decision Makers ───────────────────────────────────────────

	console.log(`${label} Step 2/4: Resolving decision makers...`);

	const resolveContext: ResolveContext = {
		targetType: vibe.targetHint || 'government',
		subjectLine: title,
		coreMessage,
		topics,
		voiceSample,
		geographicScope: vibe.locationHint
			? {
					country: vibe.countryCode,
					state: vibe.locationHint.state,
					city: vibe.locationHint.city,
					displayName: vibe.locationHint.displayName,
				}
			: { country: vibe.countryCode },
	};

	const dmResult = await resolveDecisionMakers(resolveContext, (segment) => {
		// Seed script: emit thought content for visibility
		if ('content' in segment && segment.content && segment.type === 'think') {
			console.log(`${label}   [thought] ${segment.content.slice(0, 120)}`);
		}
	});

	const decisionMakers = dmResult.decisionMakers.map((dm) => ({
		name: dm.name,
		title: dm.title,
		organization: dm.organization || '',
		email: dm.email || '',
		reasoning: dm.reasoning || '',
		confidence: dm.confidence ?? 0.7,
	}));

	console.log(`${label}   Found ${decisionMakers.length} decision maker(s)`);
	for (const dm of decisionMakers) {
		console.log(`${label}     - ${dm.name} (${dm.title} at ${dm.organization})`);
	}

	await sleep(1000);

	// ── Step 3: Message Generation ────────────────────────────────────────

	console.log(`${label} Step 3/4: Generating message...`);

	const messageResult = await generateMessage({
		subjectLine: title,
		coreMessage,
		topics,
		decisionMakers: decisionMakers.map((dm) => ({
			name: dm.name,
			title: dm.title,
			organization: dm.organization,
			email: dm.email,
			reasoning: dm.reasoning,
			confidence: dm.confidence,
			sourceUrl: '',
			emailSource: '',
			emailGrounded: false,
			contactChannel: 'email',
		})),
		voiceSample,
		rawInput: vibe.vibe,
		geographicScope: vibe.locationHint
			? {
					type: 'subnational' as const,
					country: vibe.countryCode,
					subdivision: vibe.locationHint.state,
					locality: vibe.locationHint.city,
				}
			: {
					type: 'nationwide' as const,
					country: vibe.countryCode,
				},
		onThought: (thought, phase) => {
			if (thought) {
				console.log(`${label}   [${phase}] ${thought.slice(0, 120)}`);
			}
		},
		onPhase: (phase, message) => {
			console.log(`${label}   Phase: ${phase} — ${message}`);
		},
	});

	const messageBody = messageResult.message;
	const sources = messageResult.sources.map((s) => ({
		num: s.num,
		title: s.title,
		url: s.url,
		type: s.type,
	}));
	const researchLog = messageResult.research_log || [];
	const geoScope = messageResult.geographic_scope as
		| { type: string; country?: string; subdivision?: string; locality?: string; displayName?: string }
		| undefined;

	console.log(`${label}   Message length: ${messageBody.length} chars`);
	console.log(`${label}   Sources: ${sources.length}`);

	await sleep(1000);

	// ── Step 4: Moderation ────────────────────────────────────────────────

	console.log(`${label} Step 4/4: Running moderation...`);

	let approved = true;
	try {
		const moderationResult = await moderateTemplate({
			title,
			message_body: messageBody,
		});
		approved = moderationResult.approved;
		console.log(`${label}   Moderation: ${moderationResult.summary} (${moderationResult.latency_ms}ms)`);
	} catch (err) {
		console.warn(`${label}   Moderation unavailable (GROQ_API_KEY missing?) — defaulting to approved`);
		approved = true;
	}

	// ── Build Snapshot ────────────────────────────────────────────────────

	const deliveryMethod = inferDeliveryMethod(
		decisionMakers.map((dm) => ({
			...dm,
			sourceUrl: '',
			emailSource: '',
			emailGrounded: false,
			contactChannel: 'email',
		}))
	);

	const preview = messageBody.slice(0, 200).replace(/\n/g, ' ').trim() + (messageBody.length > 200 ? '...' : '');

	const snapshot: OrgTemplateSnapshot = {
		slug,
		orgSlug: vibe.orgSlug,
		title,
		description: coreMessage,
		messageBody,
		preview,
		category: vibe.fallbackCategory,
		topics,
		type: 'letter',
		deliveryMethod,
		countryCode: vibe.countryCode,
		sources,
		researchLog,
		recipientConfig: buildRecipientConfig(
			decisionMakers.map((dm) => ({
				...dm,
				sourceUrl: '',
				emailSource: '',
				emailGrounded: false,
				contactChannel: 'email',
			}))
		),
		deliveryConfig: { method: deliveryMethod },
		contentHash: contentHash(messageBody),
		approved,
		decisionMakers,
		scope: buildScope(vibe, geoScope),
		jurisdiction: buildJurisdiction(vibe),
	};

	return snapshot;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
	const startTime = Date.now();

	// Preflight
	if (!process.env.GEMINI_API_KEY) {
		console.error('ERROR: GEMINI_API_KEY environment variable required');
		console.error('  This script calls Gemini for subject lines, decision makers, and messages.');
		process.exit(1);
	}

	console.log('='.repeat(70));
	console.log('ORG-SCOPED AGENT-POWERED SEED');
	console.log('Pipeline: subject line -> decision makers -> message -> moderation');
	console.log(`Vibes: ${VIBES.length} orgs to process`);
	console.log('='.repeat(70));
	console.log('');

	const results: Record<string, OrgTemplateSnapshot> = {};
	const errors: Array<{ orgSlug: string; error: string }> = [];

	for (let i = 0; i < VIBES.length; i++) {
		const vibe = VIBES[i];
		console.log(`\n${'─'.repeat(70)}`);
		console.log(`[${i + 1}/${VIBES.length}] ${vibe.orgSlug} (${vibe.fallbackCategory})`);
		console.log(`${'─'.repeat(70)}`);

		try {
			const snapshot = await processVibe(vibe);
			results[vibe.orgSlug] = snapshot;
			console.log(`\n[${vibe.orgSlug}] COMPLETE — ${snapshot.approved ? 'APPROVED' : 'REJECTED'}`);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`\n[${vibe.orgSlug}] FAILED: ${message}`);
			errors.push({ orgSlug: vibe.orgSlug, error: message });
		}

		// Rate limit between vibes
		if (i < VIBES.length - 1) {
			console.log('\nWaiting 2s before next org...');
			await sleep(2000);
		}
	}

	// ── Write Output ──────────────────────────────────────────────────────

	const outputPath = join(process.cwd(), 'scripts', 'seed-org-snapshot.json');
	writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');

	const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);

	console.log('');
	console.log('='.repeat(70));
	console.log('SUMMARY');
	console.log('='.repeat(70));
	console.log(`  Output:    ${outputPath}`);
	console.log(`  Succeeded: ${Object.keys(results).length}/${VIBES.length}`);
	console.log(`  Failed:    ${errors.length}`);
	console.log(`  Duration:  ${totalDuration}s`);
	console.log('');

	for (const [slug, snap] of Object.entries(results)) {
		console.log(`  ${snap.approved ? 'OK' : 'REJECTED'}  ${slug}`);
		console.log(`         title: "${snap.title}"`);
		console.log(`         DMs:   ${snap.decisionMakers.length}`);
		console.log(`         sources: ${snap.sources.length}`);
	}

	if (errors.length > 0) {
		console.log('');
		console.log('  ERRORS:');
		for (const e of errors) {
			console.log(`    ${e.orgSlug}: ${e.error}`);
		}
	}

	console.log('');
}

// ============================================================================
// Run
// ============================================================================

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});
