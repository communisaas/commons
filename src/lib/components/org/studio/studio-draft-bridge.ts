import { generateDraftId, templateDraftStore } from '$lib/stores/templateDraft';
import { saveOrgEmailComposeDraft } from '$lib/stores/orgEmailComposeDraft';
import { saveOrgCampaignDraft } from '$lib/stores/orgCampaignDraft';
import type { GeoScope } from '$lib/core/agents/types';
import type { OrgProcess } from '$lib/components/org/os/orgOS.svelte';
import type { ActiveMessageJob } from '$lib/core/agents/message-job-recovery';
import type {
	ProcessedDecisionMaker,
	Source,
	TemplateDraftOrigin,
	TemplateFormData
} from '$lib/types/template';

const SOURCE_EVALUATION_FALLBACK_PREFIX = 'Evaluation unavailable';

function topicsFromIntent(proc: OrgProcess): string[] {
	return proc.intent.subjectLine
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((part) => part.length > 3)
		.slice(0, 5);
}

function slugFromTitle(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 72);
	return slug || `studio-action-${Date.now().toString(36)}`;
}

function toTemplateSource(source: Source): Source {
	return {
		num: source.num,
		title: source.title,
		url: source.url,
		type: source.type
	};
}

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
		provenance: 'Resolved by the org Studio authoring loop.',
		reasoning: 'Selected from the Studio decision-maker resolution stream.',
		isAiResolved: true,
		confidence: dm.email ? 0.85 : 0.55,
		emailVerified: dm.email ? 'risky' : undefined
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
	return {
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

	const formData: TemplateFormData = {
		objective: {
			rawInput: proc.intent.coreMessage,
			title: proc.intent.subjectLine,
			description: proc.intent.coreMessage,
			domain: '',
			slug: slugFromTitle(proc.intent.subjectLine),
			topics: topicsFromIntent(proc),
			voiceSample: proc.intent.coreMessage,
			audienceGuidance: proc.intent.audienceGuidance,
			aiGenerated: false
		},
		audience: {
			decisionMakers,
			recipientEmails,
			includesCongress: false,
			customRecipients: [],
			resolvedForSubject: proc.intent.subjectLine
		},
		content: {
			preview: proc.composedMessage,
			variables: [],
			sources: proc.sources.map(toTemplateSource),
			researchLog: proc.entries.map((entry) =>
				entry.kind === 'thought'
					? `[${entry.stage}] ${entry.content}`
					: `[${entry.stage}] ${entry.action}: ${entry.title}`
			),
			geographicScope: proc.geographicScope ?? { type: 'nationwide', country: 'US' },
			aiGenerated: true,
			edited: false,
			generatedForSubject: proc.intent.subjectLine,
			activeMessageJob: cloneActiveMessageJob(proc),
			draftOrigin: buildTemplateDraftOrigin(proc)
		},
		review: {}
	};

	templateDraftStore.saveDraft(draftId, formData, 'content');
	return draftId;
}

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
export function saveStudioProcessAsCampaignDraft(proc: OrgProcess): string {
	const targets = geoScopeToTargets(proc.geographicScope);
	return saveOrgCampaignDraft({
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
	});
}

export function saveStudioProcessAsOrgEmailDraft(proc: OrgProcess): string {
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

	return saveOrgEmailComposeDraft({
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
	});
}
