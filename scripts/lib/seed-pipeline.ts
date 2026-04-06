/**
 * Shared seed pipeline — the core logic for processing vibes into template snapshots.
 *
 * Used by both seed-with-agents.ts and seed-org-templates.ts.
 */

import { createHash } from 'crypto';

import { generateSubjectLine } from '$lib/core/agents/agents/subject-line';
import { resolveDecisionMakers } from '$lib/core/agents/agents/decision-maker';
import { generateMessage } from '$lib/core/agents/agents/message-writer';
import type { DecisionMaker } from '$lib/core/agents/types';
import type { ResolveContext } from '$lib/core/agents/providers/types';

// Lazy-import moderation — it uses $env/dynamic/private which only resolves in SvelteKit.
// Falls back to auto-approve when unavailable.
async function tryModerate(title: string, messageBody: string): Promise<{ approved: boolean; summary: string; rejection_reason?: string }> {
	try {
		const { moderateTemplate } = await import('$lib/core/server/moderation/index');
		return await moderateTemplate({ title, message_body: messageBody });
	} catch {
		return { approved: true, summary: 'moderation unavailable (skipped)' };
	}
}

// ============================================================================
// Vibe Interface (superset — orgSlug is optional)
// ============================================================================

export interface Vibe {
	vibe: string;
	fallbackCategory: string;
	countryCode: 'US' | 'CA';
	targetHint?: string;
	locationHint?: { state?: string; city?: string; displayName?: string };
	/** Override audience scope. When set, controls who sees the template
	 *  independently of locationHint (which remains as agent research context). */
	scopeHint?: 'national' | 'state' | 'local';
	audienceGuidance?: string;
	orgSlug?: string;
}

// ============================================================================
// Snapshot Shape
// ============================================================================

/**
 * Convex-aligned scope object — matches the `scopes[]` validator in schema.ts
 */
export interface ConvexScope {
	countryCode: string;
	regionCode?: string;
	localityCode?: string;
	districtCode?: string;
	displayText: string;
	scopeLevel: string; // 'country' | 'region' | 'locality' | 'district'
	confidence: number;
	extractionMethod: string;
}

/**
 * Convex-aligned jurisdiction object — matches the `jurisdictions[]` validator in schema.ts
 */
export interface ConvexJurisdiction {
	jurisdictionType: string; // 'federal' | 'state' | 'county' | 'city'
	stateCode?: string;
	congressionalDistrict?: string;
	countyName?: string;
	cityName?: string;
}

/**
 * CWC config — matches CwcConfig in src/lib/types/templateConfig.ts
 * Only present on templates with deliveryMethod === 'cwc'
 *
 * - enabled: gates CWC delivery for this template
 * - priority: hint for delivery ordering (not in CWC XML spec)
 * - tracking_enabled: whether to record delivery acknowledgements
 * - office_codes: if set, restrict delivery to these MemberOffice codes
 */
export interface SeedCwcConfig {
	enabled: boolean;
	priority?: 'normal' | 'high' | 'urgent';
	tracking_enabled?: boolean;
	office_codes?: string[];
}

export interface TemplateSnapshot {
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
	cwcConfig?: SeedCwcConfig;
	contentHash: string;
	approved: boolean;
	decisionMakers: SnapshotDecisionMaker[];
	scopes: ConvexScope[];
	jurisdictions: ConvexJurisdiction[];
	orgSlug?: string;
}

export interface SnapshotDecisionMaker {
	name: string;
	title: string;
	organization: string;
	email: string;
	reasoning: string;
	confidence: number;
	// Phase 4: Accountability & Classification
	roleCategory?: string;
	relevanceRank?: number;
	accountabilityOpener?: string;
	publicActions?: string[];
	personalPrompt?: string;
	// Email provenance
	emailGrounded?: boolean;
	emailSource?: string;
	emailSourceTitle?: string;
}

// ============================================================================
// Helpers
// ============================================================================

export function generateSlug(title: string, maxLen = 80): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, maxLen);
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function contentHash(title: string, body: string): string {
	return createHash('sha256')
		.update(title + '\0' + body)
		.digest('hex')
		.slice(0, 40);
}

function inferDeliveryMethod(
	targetType: string | null,
	countryCode: string,
	geoScope: string | null
): string {
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
	decisionMakers: SnapshotDecisionMaker[],
	deliveryMethod: string
): Record<string, unknown> {
	const dmArray = decisionMakers.map((dm) => ({
		name: dm.name,
		role: dm.title,
		shortName: dm.name.split(' ').pop(),
		organization: dm.organization,
		email: dm.email,
		// Phase 4: Accountability & Classification
		...(dm.roleCategory ? { roleCategory: dm.roleCategory } : {}),
		...(dm.relevanceRank != null ? { relevanceRank: dm.relevanceRank } : {}),
		...(dm.accountabilityOpener ? { accountabilityOpener: dm.accountabilityOpener } : {}),
		...(dm.publicActions?.length ? { publicActions: dm.publicActions } : {}),
		...(dm.personalPrompt ? { personalPrompt: dm.personalPrompt } : {}),
		// Email provenance
		...(dm.emailGrounded ? { emailGrounded: dm.emailGrounded } : {}),
		...(dm.emailSource ? { emailSource: dm.emailSource } : {}),
		...(dm.emailSourceTitle ? { emailSourceTitle: dm.emailSourceTitle } : {}),
	}));

	if (deliveryMethod === 'cwc') {
		return {
			reach: 'district-based',
			chambers: ['house', 'senate'],
			cwcRouting: true,
			decisionMakers: dmArray
		};
	}
	return {
		reach: 'location-specific',
		decisionMakers: dmArray,
		emails: decisionMakers.map((dm) => dm.email).filter(Boolean)
	};
}

function inferScopeLevel(
	detectedScope: string | null | undefined,
	vibe: Vibe
): string {
	// Explicit scope override takes priority
	if (vibe.scopeHint) return vibe.scopeHint;

	if (detectedScope) {
		// Validate detected scope against available location data
		if (detectedScope === 'local' && !vibe.locationHint?.city) {
			// No city data — fall through to state check
		} else if (detectedScope === 'state' && !vibe.locationHint?.state) {
			return 'national';
		} else {
			return detectedScope;
		}
	}
	if (vibe.locationHint?.city) return 'local';
	if (vibe.locationHint?.state) return 'state';
	return 'national';
}

function deriveTargetType(
	detectedTarget: string | null | undefined,
	vibe: Vibe
): string {
	if (vibe.targetHint) return vibe.targetHint;
	if (detectedTarget) return detectedTarget;
	return 'government';
}

function buildScopeDisplayText(vibe: Vibe, scopeLevel: string): string {
	if (vibe.locationHint?.displayName) return vibe.locationHint.displayName;
	if (scopeLevel === 'national' || scopeLevel === 'nationwide') {
		return vibe.countryCode === 'CA' ? 'Canada' : 'United States';
	}
	return vibe.countryCode;
}

// ============================================================================
// Core Pipeline: Process a Single Vibe
// ============================================================================

export interface ProcessVibeOptions {
	vibe: Vibe;
	/** Display label for logging, e.g. "[3/12]" or "[climate-action-now]" */
	label: string;
}

export async function processVibe({ vibe, label }: ProcessVibeOptions): Promise<TemplateSnapshot | null> {
	// ── Phase 1: Subject Line Generation ──────────────────────────────────

	console.log(`${label} Phase 1: Generating subject line...`);

	let subjectResult = await generateSubjectLine({ description: vibe.vibe });
	let subjectData = subjectResult.data;

	// Handle needs_clarification — retry with explicit instruction
	if (subjectData.needs_clarification) {
		console.log(`${label}   Agent requested clarification — retrying with force...`);

		const conversationContext = {
			originalDescription: vibe.vibe,
			questionsAsked: subjectData.clarification_questions || [],
			inferredContext: subjectData.inferred_context,
			answers: {} as Record<string, string>
		};

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
		audienceGuidance: vibe.audienceGuidance,
		geographicScope: {
			country: vibe.countryCode,
			state: vibe.locationHint?.state,
			city: vibe.locationHint?.city,
			displayName: vibe.locationHint?.displayName
		}
	};

	const dmResult = await resolveDecisionMakers(resolveContext, (segment) => {
		if ('content' in segment && segment.content) {
			console.log(`${label}   [thought] ${segment.content.slice(0, 120)}`);
		}
	});

	const decisionMakers: SnapshotDecisionMaker[] = dmResult.decisionMakers.map((dm) => ({
		name: dm.name,
		title: dm.title,
		organization: dm.organization || '',
		email: dm.email || '',
		reasoning: dm.reasoning || '',
		confidence: dm.confidence ?? 0.5,
		// Phase 4: Accountability & Classification
		roleCategory: dm.roleCategory || undefined,
		relevanceRank: dm.relevanceRank ?? undefined,
		accountabilityOpener: dm.accountabilityOpener || undefined,
		publicActions: dm.publicActions?.length ? dm.publicActions : undefined,
		personalPrompt: dm.personalPrompt || undefined,
		// Email provenance
		emailGrounded: dm.emailGrounded || undefined,
		emailSource: dm.emailSource || undefined,
		emailSourceTitle: dm.emailSourceTitle || undefined
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

	const moderationResult = await tryModerate(title, messageBody);
	const approved = moderationResult.approved;
	console.log(`${label}   Moderation: ${moderationResult.summary}`);
	if (!approved) {
		console.warn(`${label}   WARNING: Moderation rejected — ${moderationResult.rejection_reason}`);
	}

	// ── Build Snapshot ────────────────────────────────────────────────────

	const slug = generateSlug(urlSlug || title);
	const deliveryMethod = inferDeliveryMethod(
		inferredContext.detected_target_type,
		vibe.countryCode,
		inferredContext.detected_scope
	);
	const preview = messageBody.slice(0, 200).replace(/\n/g, ' ').trim();

	// Map pipeline scope levels to Convex schema values
	const convexScopeLevel: Record<string, string> = {
		national: 'country',
		nationwide: 'country',
		state: 'region',
		local: 'locality',
	};

	// Only include region/locality in scope when the audience is actually scoped there
	// (scopeHint: 'national' means locationHint is reference context, not audience filter)
	const audienceIsNational = scopeLevel === 'national' || scopeLevel === 'nationwide';

	const scopes: ConvexScope[] = [{
		countryCode: vibe.countryCode,
		...(!audienceIsNational && vibe.locationHint?.state ? { regionCode: vibe.locationHint.state } : {}),
		...(!audienceIsNational && vibe.locationHint?.city ? { localityCode: vibe.locationHint.city } : {}),
		displayText: buildScopeDisplayText(vibe, scopeLevel),
		scopeLevel: convexScopeLevel[scopeLevel] || scopeLevel,
		confidence: 1.0,
		extractionMethod: 'agent-pipeline',
	}];

	const jurisdictions: ConvexJurisdiction[] = [];
	if (!audienceIsNational && vibe.locationHint?.state) {
		jurisdictions.push({
			jurisdictionType: scopeLevel === 'local' ? 'city' : 'state',
			stateCode: vibe.locationHint.state,
			...(vibe.locationHint?.city ? { cityName: vibe.locationHint.city } : {}),
		});
	} else {
		jurisdictions.push({ jurisdictionType: 'federal' });
	}

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
		...(deliveryMethod === 'cwc' ? {
			cwcConfig: {
				enabled: true,
				priority: 'normal' as const,
				tracking_enabled: true,
			}
		} : {}),
		contentHash: contentHash(title, messageBody),
		approved,
		decisionMakers,
		scopes,
		jurisdictions,
		orgSlug: vibe.orgSlug
	};

	console.log(`${label} DONE -> slug: "${slug}"`);

	return snapshot;
}
