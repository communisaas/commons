import { generateDraftId, templateDraftStore } from '$lib/stores/templateDraft';
import { canonicalizeTemplateSlug } from '$convex/lib/templateInputBudget';
import { deriveTopicsFromSubject } from '$lib/utils/authoring-inputs';
import { orgCampaignDrafts, orgEmailComposeDrafts } from '$lib/stores/orgDraftStore';
import type { GeoScope } from '$lib/core/agents/types';
import type { OrgProcess } from '$lib/components/org/os/orgOS.svelte';
import type { ActiveMessageJob } from '$lib/core/agents/message-job-recovery';
import { createEmptyTemplateFormData } from '$lib/types/template';
import type {
	ProcessedDecisionMaker,
	Source,
	TemplateDraftOrigin,
	TemplateFormData
} from '$lib/types/template';

const SOURCE_EVALUATION_FALLBACK_PREFIX = 'Evaluation unavailable';

function isEvaluatedSource(source: Source): boolean {
	return (
		Boolean(source.incentive_position) &&
		!(source.credibility_rationale ?? '').startsWith(SOURCE_EVALUATION_FALLBACK_PREFIX)
	);
}

function evaluatedSourceCount(sources: Source[]): number {
	return sources.filter(isEvaluatedSource).length;
}

function toProcessedDecisionMaker(
	dm: OrgProcess['decisionMakers'][number]
): ProcessedDecisionMaker {
	return {
		name: dm.name,
		title: dm.title,
		organization: dm.organization,
		email: dm.email,
		provenance: dm.provenance || 'Resolved by the org Studio authoring loop.',
		reasoning: dm.reasoning || 'Selected from the Studio decision-maker resolution stream.',
		isAiResolved: dm.isAiResolved,
		// Confidence is a measurement the resolution agent computes; the bridge
		// carries it verbatim and never derives one from email presence.
		confidence: dm.confidence,
		source: dm.source,
		source_url: dm.source_url,
		recencyCheck: dm.recencyCheck,
		positionSourceDate: dm.positionSourceDate,
		inputWindow: dm.inputWindow,
		emailGrounded: dm.emailGrounded,
		emailSource: dm.emailSource,
		emailSourceTitle: dm.emailSourceTitle,
		contactNotes: dm.contactNotes,
		discovered: dm.discovered,
		accountabilityOpener: dm.accountabilityOpener,
		roleCategory: dm.roleCategory,
		relevanceRank: dm.relevanceRank,
		publicActions: dm.publicActions ? [...dm.publicActions] : undefined,
		personalPrompt: dm.personalPrompt,
		publicRecipientProvenance: dm.publicRecipientProvenance
			? { ...dm.publicRecipientProvenance }
			: undefined,
		// A deliverability verdict comes only from the real email-verification step; the
		// bridge carries what that step produced and never derives one from email presence.
		emailVerified: dm.emailVerified
	};
}

function cloneActiveMessageJob(proc: OrgProcess): ActiveMessageJob | null {
	if (!proc.activeMessageJob) return null;
	return {
		jobId: proc.activeMessageJob.jobId,
		inputHash: proc.activeMessageJob.inputHash,
		status: proc.activeMessageJob.status,
		startedAt: proc.activeMessageJob.startedAt,
		recoveryKeyRef: proc.activeMessageJob.recoveryKeyRef,
		traceId: proc.activeMessageJob.traceId
	};
}

function buildTemplateDraftOrigin(proc: OrgProcess): TemplateDraftOrigin {
	const origin: TemplateDraftOrigin = {
		source: 'studio',
		handoff: 'public-action-template',
		label: 'Public action draft from Studio',
		processId: proc.id,
		processTitle: proc.title,
		createdAt: Date.now(),
		effect:
			'Studio supplied the objective, resolved targets, sources, scope, authored artifact, recovery handle, and trace id; the public creator owns edits and publish confirmation.',
		sourceRef: 'saveStudioProcessAsTemplateDraft'
	};
	// Scope provenance is carried only when the process resolved it — an empty
	// label or basis stays absent rather than becoming an empty string.
	if (proc.geographicScopeLabel) origin.scopeLabel = proc.geographicScopeLabel;
	if (proc.geographicScopeBasis) origin.scopeBasis = proc.geographicScopeBasis;
	return origin;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function safeHref(url: string): string | null {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
	} catch {
		return null;
	}
}

function messageToEmailHtml(proc: OrgProcess): string {
	const paragraphs = proc.composedMessage
		.split(/\n{2,}/)
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`);

	if (proc.sources.length === 0) return paragraphs.join('\n');

	const sourceItems = proc.sources
		.map((source) => {
			const href = safeHref(source.url);
			const title = escapeHtml(source.title || source.url);
			const label = `[${source.num}] ${title}`;
			return href ? `<li><a href="${escapeHtml(href)}">${label}</a></li>` : `<li>${label}</li>`;
		})
		.join('\n');

	return [
		...paragraphs,
		'<hr>',
		'<p><strong>Sources from Studio</strong></p>',
		`<ol>${sourceItems}</ol>`
	].join('\n');
}

export function saveStudioProcessAsTemplateDraft(proc: OrgProcess): string {
	const draftId = generateDraftId();
	const decisionMakers = proc.decisionMakers.map(toProcessedDecisionMaker);
	const recipientEmails = decisionMakers
		.map((dm) => dm.email)
		.filter((email): email is string => !!email);

	// Everything the process does not supply inherits from the shared blank
	// form, so "unset" here provably means the same values as a fresh citizen draft.
	const base = createEmptyTemplateFormData(proc.intent.coreMessage);
	const formData: TemplateFormData = {
		objective: {
			...base.objective,
			title: proc.intent.subjectLine,
			description: proc.intent.coreMessage,
			// '' when nothing survives — publish rejects an empty slug legibly.
			slug: canonicalizeTemplateSlug(proc.intent.subjectLine),
			topics: deriveTopicsFromSubject(proc.intent.subjectLine),
			voiceSample: proc.intent.coreMessage,
			audienceGuidance: proc.intent.audienceGuidance,
			aiGenerated: false
		},
		audience: {
			...base.audience,
			decisionMakers,
			recipientEmails,
			resolvedForSubject: proc.intent.subjectLine
		},
		content: {
			...base.content,
			preview: proc.composedMessage,
			sources: proc.sources,
			researchLog: proc.entries.map((entry) =>
				entry.kind === 'thought'
					? `[${entry.stage}] ${entry.content}`
					: `[${entry.stage}] ${entry.action}: ${entry.title}`
			),
			geographicScope: proc.geographicScope,
			aiGenerated: true,
			edited: false,
			generatedForSubject: proc.intent.subjectLine,
			activeMessageJob: cloneActiveMessageJob(proc),
			draftOrigin: buildTemplateDraftOrigin(proc)
		},
		review: base.review
	};

	templateDraftStore.saveDraft(draftId, formData, 'content');
	return draftId;
}

/**
 * What the Studio → public-template handoff does with a process field:
 * `carried` lands in the draft (directly or via draftOrigin), `derived` is
 * recomputable downstream from carried data, `process-local` belongs to the
 * loop's own lifecycle or telemetry and deliberately stays behind.
 */
export type StudioHandoffDisposition = 'carried' | 'derived' | 'process-local';

// Typed over every OrgProcess key, so adding a process field fails the build
// until its disposition is declared here.
export const STUDIO_TEMPLATE_HANDOFF: Record<keyof OrgProcess, StudioHandoffDisposition> = {
	id: 'carried', // draftOrigin.processId keeps the link back to the source process.
	title: 'carried', // draftOrigin.processTitle names the source process for the author.
	intent: 'carried', // Subject line, core message, and audience guidance fill the objective step.
	status: 'process-local', // Loop lifecycle; the draft is only ever written from a finished run.
	activeStage: 'process-local', // Live-pulse pointer for a running loop, meaningless at rest.
	stageLabel: 'process-local', // Display label for the running stage, meaningless at rest.
	entries: 'carried', // Flattened into content.researchLog as readable trace lines.
	decisionMakers: 'carried', // Mapped one-to-one into audience.decisionMakers, order preserved.
	droppedEmailless: 'process-local', // Resolution telemetry about contacts that never reached the draft.
	reachCensus: 'process-local', // Resolution telemetry stays behind the draft.
	resolutionStopReason: 'process-local', // Why resolution stopped; the draft holds the outcome, not the stop.
	resolutionStopDetail: 'process-local', // Prose detail for the resolution stop above.
	geographicScope: 'carried', // content.geographicScope, null-preserving — no scope is invented.
	geographicScopeLabel: 'derived', // displayGeoScope reproduces it from the scope; also on draftOrigin.scopeLabel for display.
	geographicScopeBasis: 'carried', // draftOrigin.scopeBasis shows the author why this scope was chosen.
	geographicScopeSource: 'process-local', // Resolution-path enum; the basis prose from the same producer already carries the distinction.
	sourceEvidenceObserved: 'process-local', // Whether stream telemetry arrived — a property of the run, not the sources.
	sourceEvidenceCount: 'derived', // Recomputable as content.sources.length.
	sourceEvidenceEvaluatedCount: 'derived', // The creator recomputes evaluated sources from content.sources.
	sourceEvidenceSearchOnlyCount: 'derived', // The creator recomputes search-only sources from content.sources.
	sourceEvidenceMode: 'process-local', // Discovery-vs-preverified telemetry about how the run gathered sources.
	sourceEvidenceEvaluationFallback: 'process-local', // Run-level flag; per-source fallback is visible in each credibility_rationale.
	sourceEvidenceCandidateCount: 'process-local', // Funnel telemetry for candidates that never became sources.
	sourceEvidenceFailedCount: 'process-local', // Funnel telemetry for fetches that failed during the run.
	sourceEvidenceSearchQueryCount: 'process-local', // Funnel telemetry for search volume during the run.
	sources: 'carried', // content.sources, lossless — every evaluation field survives.
	composedMessage: 'carried', // content.preview is the authored artifact itself.
	activeMessageJob: 'carried', // content.activeMessageJob keeps the recovery handle and trace id.
	restoredFromDevice: 'process-local', // Device-ledger restoration marker for the Studio registry, not the draft.
	errorMessage: 'process-local', // A failed run never reaches the handoff.
	startedAt: 'process-local', // Loop timing; the draft stamps its own createdAt on the origin.
	endedAt: 'process-local', // Loop timing; see startedAt.
	abort: 'process-local' // Live AbortController owned by the running loop; not serializable.
};

// Map the authoring scope to the campaign's coarse target fields. international
// → cleared (no country); nationwide → country; subnational → country + the
// subdivision (or locality), bounded to the create action's 64-char cap.
function geoScopeToTargets(scope: GeoScope | null | undefined): {
	targetCountry?: string;
	targetJurisdiction?: string;
} {
	if (!scope || scope.type === 'international') return {};
	if (scope.type === 'nationwide') return { targetCountry: scope.country };
	const jurisdiction = scope.subdivision ?? scope.locality;
	return {
		targetCountry: scope.country,
		targetJurisdiction: jurisdiction ? jurisdiction.slice(0, 64) : undefined
	};
}

/**
 * Studio → campaigns/new (congressional). Carries the campaign SHELL — title,
 * the PLAIN composed message (NOT the email-HTML serializer), type, and derived
 * targets — plus carried-count metadata for the "Draft from Studio" banner.
 */
export async function saveStudioProcessAsCampaignDraft(
	proc: OrgProcess,
	ownerId: string
): Promise<string | null> {
	const targets = geoScopeToTargets(proc.geographicScope);
	return await orgCampaignDrafts.save(
		{
			source: 'studio',
			title: proc.intent.subjectLine,
			body: proc.composedMessage,
			type: 'CONGRESSIONAL',
			targetCountry: targets.targetCountry,
			targetJurisdiction: targets.targetJurisdiction,
			createdAt: Date.now(),
			metadata: {
				processId: proc.id,
				title: proc.title,
				decisionMakerCount: proc.decisionMakers.length,
				sourceCount: proc.sources.length,
				geographicScopeLabel: proc.geographicScopeLabel
			}
		},
		ownerId
	);
}

export async function saveStudioProcessAsOrgEmailDraft(
	proc: OrgProcess,
	ownerId: string
): Promise<string | null> {
	const evaluatedSources = Math.max(
		0,
		proc.sourceEvidenceObserved
			? proc.sourceEvidenceEvaluatedCount
			: evaluatedSourceCount(proc.sources)
	);
	const searchOnlySources = Math.max(
		0,
		proc.sourceEvidenceObserved
			? proc.sourceEvidenceSearchOnlyCount
			: proc.sources.length - evaluatedSources
	);

	return await orgEmailComposeDrafts.save(
		{
			source: 'studio',
			subject: proc.intent.subjectLine,
			bodyHtml: messageToEmailHtml(proc),
			createdAt: Date.now(),
			metadata: {
				processId: proc.id,
				title: proc.title,
				decisionMakerCount: proc.decisionMakers.length,
				sourceCount: proc.sources.length,
				evaluatedSourceCount: evaluatedSources,
				searchOnlySourceCount: searchOnlySources,
				messageJobId: proc.activeMessageJob?.jobId,
				messageInputHash: proc.activeMessageJob?.inputHash,
				messageJobStatus: proc.activeMessageJob?.status,
				messageTraceId: proc.activeMessageJob?.traceId,
				geographicScopeLabel: proc.geographicScopeLabel,
				geographicScopeSource: proc.geographicScopeSource,
				geographicScopeBasis: proc.geographicScopeBasis
			}
		},
		ownerId
	);
}
