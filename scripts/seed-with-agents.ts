#!/usr/bin/env npx tsx
/**
 * Agent-Powered Seed Script
 *
 * Generates template content by running each vibe through the full agent pipeline:
 *   subject line -> decision makers -> message -> moderation
 *
 * Writes output to scripts/seed-snapshot.json as { [slug]: TemplateSnapshot }.
 * Does NOT write to any database.
 *
 * Usage:
 *   npx tsx scripts/seed-with-agents.ts
 *   VIBE_LIMIT=3 npx tsx scripts/seed-with-agents.ts   # first N only
 *
 * Required: GEMINI_API_KEY
 * Optional: GROQ_API_KEY (moderation), EXA_API_KEY (source discovery), VIBE_LIMIT
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
// Vibe Interface
// ============================================================================

interface Vibe {
	vibe: string;
	fallbackCategory: string;
	countryCode: 'US' | 'CA';
	targetHint?: string;
	locationHint?: { state?: string; city?: string; displayName?: string };
}

// ============================================================================
// Snapshot Shape
// ============================================================================

interface TemplateSnapshot {
	slug: string;
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
// All 12 Vibes
// ============================================================================

const VIBES: Vibe[] = [
	// US Federal
	{
		vibe: "The VA's telehealth program served 2.4 million veterans last year and cut wait times by 40%. It works. Fund the expansion to every rural clinic in the country.",
		fallbackCategory: 'healthcare',
		countryCode: 'US'
	},
	{
		vibe: "Kids spend 7 hours a day online. Companies harvest 72 million data points per child per year. Federal privacy law hasn't updated since 1998 — COPPA is older than the kids it's supposed to protect.",
		fallbackCategory: 'technology',
		countryCode: 'US'
	},

	// US State
	{
		vibe: "Colorado's universal preschool program costs $322 million and saves families $336 million in childcare. Every dollar returns $4.30 in reduced remediation and lifetime earnings. Every state should replicate this.",
		fallbackCategory: 'education',
		countryCode: 'US',
		locationHint: { state: 'CO', displayName: 'Colorado' }
	},
	{
		vibe: "Oregon's drug treatment courts cost $7,100 less per person than incarceration. Recidivism dropped 31%. Taxpayers save money, families stay together, outcomes improve across every metric.",
		fallbackCategory: 'criminal-justice',
		countryCode: 'US',
		locationHint: { state: 'OR', displayName: 'Oregon' }
	},

	// US Municipal
	{
		vibe: "Portland approved 3D-printed homes at $160K each when traditional construction costs $450K. Austin's community land trusts created 1,200 permanently affordable homes. Why are most cities still banning both?",
		fallbackCategory: 'housing',
		countryCode: 'US',
		locationHint: { state: 'OR', city: 'Portland', displayName: 'Portland, OR' }
	},
	{
		vibe: "When Seoul tore down a highway and restored the Cheonggyecheon stream, property values rose 25% and air quality improved 35%. Dallas, Rochester, and Syracuse are considering the same. Urban freeways are scars, not infrastructure.",
		fallbackCategory: 'infrastructure',
		countryCode: 'US'
	},

	// Canadian Federal
	{
		vibe: "Canada's national parks generate $3.3 billion in visitor spending on a $900 million Parks Canada budget — a 3.6x return. But there's a $3.6 billion maintenance backlog. Investing in parks literally pays for itself.",
		fallbackCategory: 'environment',
		countryCode: 'CA'
	},
	{
		vibe: "Express Entry processes skilled worker applications in 6 months. The US employment green card backlog is 1.8 million people deep — some wait 134 years. Canada proves fast, fair immigration processing is a policy choice.",
		fallbackCategory: 'immigration',
		countryCode: 'CA'
	},

	// Canadian Provincial
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

	// Canadian Municipal
	{
		vibe: "Montreal's BIXI bike-share program cut downtown car trips by 12% and saves $14 million per year in healthcare costs from reduced pollution. It costs the city $5 per resident per year.",
		fallbackCategory: 'transportation',
		countryCode: 'CA',
		locationHint: { state: 'QC', city: 'Montreal', displayName: 'Montreal, QC' }
	},

	// Corporate
	{
		vibe: "Apple holds $162 billion in cash reserves. Their retail employees start at $22/hour. Fifteen minutes of Apple's daily interest income equals one retail worker's entire annual salary.",
		fallbackCategory: 'labor',
		countryCode: 'US',
		targetHint: 'corporate'
	}
];

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
		.slice(0, 50);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferDeliveryMethod(
	targetType: string | null,
	countryCode: string,
	geoScope: string | null
): string {
	// CWC (contact your rep via Congress Web Contact) for US federal government
	if (
		countryCode === 'US' &&
		targetType === 'government' &&
		(geoScope === 'national' || geoScope === 'nationwide')
	) {
		return 'cwc';
	}
	return 'email';
}

function buildRecipientConfig(
	decisionMakers: Array<{
		name: string;
		title: string;
		organization: string;
		email: string;
		reasoning: string;
		confidence: number;
	}>,
	deliveryMethod: string
): Record<string, unknown> {
	if (deliveryMethod === 'cwc') {
		return { reach: 'district-based' };
	}
	return {
		decisionMakers: decisionMakers.map((dm) => ({
			name: dm.name,
			title: dm.title,
			organization: dm.organization,
			email: dm.email
		}))
	};
}

function contentHash(title: string, body: string): string {
	return createHash('sha256')
		.update(title + '\0' + body)
		.digest('hex')
		.slice(0, 40);
}

/**
 * Infer the geographic scope level from agent-detected scope and vibe hints.
 */
function inferScopeLevel(
	detectedScope: string | null | undefined,
	vibe: Vibe
): string {
	if (detectedScope) return detectedScope;
	if (vibe.locationHint?.city) return 'local';
	if (vibe.locationHint?.state) return 'state';
	return 'national';
}

/**
 * Derive the target type string for the decision-maker resolution context.
 */
function deriveTargetType(
	detectedTarget: string | null | undefined,
	vibe: Vibe
): string {
	if (vibe.targetHint) return vibe.targetHint;
	if (detectedTarget) return detectedTarget;
	return 'government';
}

/**
 * Build a scope display text from vibe location hints and country code.
 */
function buildScopeDisplayText(vibe: Vibe, scopeLevel: string): string {
	if (vibe.locationHint?.displayName) return vibe.locationHint.displayName;
	if (scopeLevel === 'national' || scopeLevel === 'nationwide') {
		return vibe.countryCode === 'CA' ? 'Canada' : 'United States';
	}
	return vibe.countryCode;
}

// ============================================================================
// Process a Single Vibe
// ============================================================================

async function processVibe(vibe: Vibe, index: number): Promise<TemplateSnapshot | null> {
	const label = `[${index + 1}/${VIBES.length}]`;
	console.log(`\n${label} Processing vibe: "${vibe.vibe.slice(0, 80)}..."`);

	// ── Phase 1: Subject Line Generation ──────────────────────────────────

	console.log(`${label} Phase 1: Generating subject line...`);

	let subjectResult = await generateSubjectLine({ description: vibe.vibe });
	let subjectData = subjectResult.data;

	// Handle needs_clarification — retry with explicit instruction (no human in the loop)
	if (subjectData.needs_clarification) {
		console.log(`${label}   Agent requested clarification — retrying with force...`);

		const conversationContext = {
			originalDescription: vibe.vibe,
			questionsAsked: subjectData.clarification_questions || [],
			inferredContext: subjectData.inferred_context,
			answers: {} as Record<string, string>
		};

		// Auto-fill answers from vibe hints
		for (const q of subjectData.clarification_questions || []) {
			if (q.type === 'location_picker' && vibe.locationHint?.displayName) {
				conversationContext.answers[q.id] = vibe.locationHint.displayName;
			} else if (q.id === 'scope' || q.id === 'target') {
				conversationContext.answers[q.id] = vibe.targetHint || 'government';
			}
		}

		subjectResult = await generateSubjectLine({
			description: vibe.vibe,
			conversationContext,
			previousInteractionId: subjectResult.interactionId
		});
		subjectData = subjectResult.data;
	}

	// If still no subject line after retry, bail
	if (!subjectData.subject_line) {
		console.error(`${label}   FAILED: No subject line generated. Skipping.`);
		return null;
	}

	const title = subjectData.subject_line;
	const coreMessage = subjectData.core_message || vibe.vibe;
	const topics = subjectData.topics || [vibe.fallbackCategory];
	const voiceSample = subjectData.voice_sample;
	const urlSlug = subjectData.url_slug;
	const inferredContext = subjectData.inferred_context;

	console.log(`${label}   Title: "${title}"`);
	console.log(`${label}   Topics: [${topics.join(', ')}]`);
	console.log(`${label}   Detected scope: ${inferredContext.detected_scope || 'unknown'}`);
	console.log(`${label}   Detected target: ${inferredContext.detected_target_type || 'unknown'}`);

	// ── Phase 2: Decision-Maker Resolution ────────────────────────────────

	console.log(`${label} Phase 2: Resolving decision makers...`);

	const targetType = deriveTargetType(inferredContext.detected_target_type, vibe);
	const scopeLevel = inferScopeLevel(inferredContext.detected_scope, vibe);

	const resolveContext: ResolveContext = {
		targetType,
		targetEntity: targetType === 'corporate'
			? (inferredContext.detected_location || undefined)
			: undefined,
		subjectLine: title,
		coreMessage,
		topics,
		voiceSample,
		geographicScope: {
			country: vibe.countryCode,
			state: vibe.locationHint?.state,
			city: vibe.locationHint?.city,
			displayName: vibe.locationHint?.displayName
		}
	};

	const thoughtSegments: string[] = [];
	const dmResult = await resolveDecisionMakers(resolveContext, (segment) => {
		if ('content' in segment && segment.content) {
			thoughtSegments.push(segment.content);
		}
	});

	const decisionMakers: Array<{
		name: string;
		title: string;
		organization: string;
		email: string;
		reasoning: string;
		confidence: number;
	}> = dmResult.decisionMakers.map((dm) => ({
		name: dm.name,
		title: dm.title,
		organization: dm.organization || '',
		email: dm.email || '',
		reasoning: dm.reasoning || '',
		confidence: dm.confidence ?? 0.5
	}));

	console.log(`${label}   Resolved ${decisionMakers.length} decision makers`);
	for (const dm of decisionMakers) {
		console.log(`${label}     - ${dm.name} (${dm.title} at ${dm.organization})`);
	}

	// ── Phase 3: Message Generation ───────────────────────────────────────

	console.log(`${label} Phase 3: Generating message...`);

	const messageDMs: DecisionMaker[] = decisionMakers.map((dm) => ({
		name: dm.name,
		title: dm.title,
		organization: dm.organization,
		email: dm.email,
		reasoning: dm.reasoning,
		sourceUrl: '',
		emailSource: '',
		emailGrounded: false,
		confidence: dm.confidence,
		contactChannel: 'email'
	}));

	const geoScope = vibe.locationHint?.city
		? { type: 'subnational' as const, country: vibe.countryCode, subdivision: vibe.locationHint?.state, locality: vibe.locationHint.city }
		: vibe.locationHint?.state
			? { type: 'subnational' as const, country: vibe.countryCode, subdivision: vibe.locationHint.state }
			: { type: 'nationwide' as const, country: vibe.countryCode };

	const messageResult = await generateMessage({
		subjectLine: title,
		coreMessage,
		topics,
		decisionMakers: messageDMs,
		voiceSample,
		rawInput: vibe.vibe,
		geographicScope: geoScope,
		onThought: (thought, phase) => {
			// Log but don't store — these are ephemeral
			if (phase === 'sources') {
				console.log(`${label}     [sources] ${thought.slice(0, 100)}`);
			}
		},
		onPhase: (phase, message) => {
			console.log(`${label}     [${phase}] ${message}`);
		}
	});

	const messageBody = messageResult.message;
	const sources = messageResult.sources.map((s) => ({
		num: s.num,
		title: s.title,
		url: s.url,
		type: s.type
	}));
	const researchLog = messageResult.research_log || [];

	console.log(`${label}   Message length: ${messageBody.length} chars`);
	console.log(`${label}   Sources: ${sources.length}`);

	// ── Phase 4: Moderation ───────────────────────────────────────────────

	console.log(`${label} Phase 4: Running moderation...`);

	let approved = true;

	try {
		const moderationResult = await moderateTemplate({
			title,
			message_body: messageBody
		});

		approved = moderationResult.approved;
		console.log(`${label}   Moderation: ${moderationResult.summary}`);

		if (!approved) {
			console.warn(`${label}   WARNING: Moderation rejected — ${moderationResult.rejection_reason}`);
		}
	} catch (err) {
		// Moderation requires GROQ_API_KEY — if missing, default to approved
		const errMsg = err instanceof Error ? err.message : String(err);
		console.warn(`${label}   Moderation unavailable (${errMsg}) — defaulting to approved`);
		approved = true;
	}

	// ── Build Snapshot ────────────────────────────────────────────────────

	const slug = generateSlug(urlSlug || title);
	const deliveryMethod = inferDeliveryMethod(
		inferredContext.detected_target_type,
		vibe.countryCode,
		inferredContext.detected_scope
	);
	const preview = messageBody.slice(0, 200).replace(/\n/g, ' ').trim();

	// Scope object
	const scopeObj = {
		scopeLevel,
		countryCode: vibe.countryCode,
		regionCode: vibe.locationHint?.state || null,
		localityCode: vibe.locationHint?.city || null,
		displayText: buildScopeDisplayText(vibe, scopeLevel)
	};

	// Jurisdiction (US/CA state-level vibes)
	const jurisdiction = vibe.locationHint?.state
		? {
				jurisdictionType: scopeLevel === 'local' ? 'municipal' : 'state',
				stateCode: vibe.locationHint.state
			}
		: null;

	const snapshot: TemplateSnapshot = {
		slug,
		title,
		description: coreMessage,
		messageBody,
		preview,
		category: vibe.fallbackCategory,
		topics,
		type: 'campaign',
		deliveryMethod,
		countryCode: vibe.countryCode,
		sources,
		researchLog,
		recipientConfig: buildRecipientConfig(decisionMakers, deliveryMethod),
		deliveryConfig: deliveryMethod === 'cwc'
			? { provider: 'cwc', formFill: true }
			: { provider: 'email' },
		contentHash: contentHash(title, messageBody),
		approved,
		decisionMakers,
		scope: scopeObj,
		jurisdiction
	};

	console.log(`${label} DONE -> slug: "${slug}"`);

	return snapshot;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
	const startTime = Date.now();

	// ── Preflight checks ──────────────────────────────────────────────────

	if (!process.env.GEMINI_API_KEY) {
		console.error('ERROR: GEMINI_API_KEY environment variable is required.');
		console.error('Get a key from: https://aistudio.google.com/apikey');
		process.exit(1);
	}

	const vibeLimit = process.env.VIBE_LIMIT ? parseInt(process.env.VIBE_LIMIT, 10) : VIBES.length;
	const vibesToProcess = VIBES.slice(0, vibeLimit);

	console.log('=== Agent-Powered Seed Script ===');
	console.log(`Processing ${vibesToProcess.length} of ${VIBES.length} vibes`);
	console.log(`GEMINI_API_KEY: ${'*'.repeat(8)}...${process.env.GEMINI_API_KEY.slice(-4)}`);
	console.log(`GROQ_API_KEY: ${process.env.GROQ_API_KEY ? 'present' : 'missing (moderation will be skipped)'}`);
	console.log(`EXA_API_KEY: ${process.env.EXA_API_KEY ? 'present' : 'missing (source discovery limited)'}`);
	console.log('');

	// ── Process vibes sequentially ────────────────────────────────────────

	const snapshots: Record<string, TemplateSnapshot> = {};
	const failures: Array<{ index: number; vibe: string; error: string }> = [];

	for (let i = 0; i < vibesToProcess.length; i++) {
		const vibe = vibesToProcess[i];

		try {
			const snapshot = await processVibe(vibe, i);

			if (snapshot) {
				snapshots[snapshot.slug] = snapshot;
			} else {
				failures.push({
					index: i,
					vibe: vibe.vibe.slice(0, 80),
					error: 'No subject line generated'
				});
			}
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			console.error(`\n[${i + 1}/${vibesToProcess.length}] FAILED: ${errMsg}`);
			failures.push({
				index: i,
				vibe: vibe.vibe.slice(0, 80),
				error: errMsg
			});
		}

		// Rate limit between vibes (5s) — skip after last one
		if (i < vibesToProcess.length - 1) {
			console.log(`\n--- Sleeping 5s (rate limit) ---`);
			await sleep(5000);
		}
	}

	// ── Write snapshot file ───────────────────────────────────────────────

	const outputPath = join(import.meta.dirname || process.cwd(), 'seed-snapshot.json');

	writeFileSync(outputPath, JSON.stringify(snapshots, null, 2), 'utf-8');

	// ── Summary ───────────────────────────────────────────────────────────

	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
	const successCount = Object.keys(snapshots).length;

	console.log('\n');
	console.log('='.repeat(60));
	console.log('  SEED SNAPSHOT COMPLETE');
	console.log('='.repeat(60));
	console.log(`  Output:     ${outputPath}`);
	console.log(`  Succeeded:  ${successCount} / ${vibesToProcess.length}`);
	console.log(`  Failed:     ${failures.length}`);
	console.log(`  Elapsed:    ${elapsed}s`);
	console.log('');

	if (successCount > 0) {
		console.log('  Slugs:');
		for (const slug of Object.keys(snapshots)) {
			const snap = snapshots[slug];
			const dmCount = snap.decisionMakers.length;
			const srcCount = snap.sources.length;
			const modTag = snap.approved ? 'approved' : 'REJECTED';
			console.log(`    - ${slug} (${dmCount} DMs, ${srcCount} sources, ${modTag})`);
		}
	}

	if (failures.length > 0) {
		console.log('');
		console.log('  Failures:');
		for (const f of failures) {
			console.log(`    [${f.index + 1}] ${f.vibe}...`);
			console.log(`        Error: ${f.error}`);
		}
	}

	console.log('');

	// Exit with error code if all vibes failed
	if (successCount === 0 && vibesToProcess.length > 0) {
		process.exit(1);
	}
}

// ============================================================================
// Run
// ============================================================================

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});
