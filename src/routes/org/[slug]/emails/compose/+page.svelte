<script lang="ts">
	import { onDestroy } from 'svelte';
	import { enhance } from '$app/forms';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { env } from '$env/dynamic/public';
	import { Datum, Ratio } from '$lib/design';
	import { FEATURES } from '$lib/config/features';
	import { formatCapabilityClusters } from '$lib/data/capability-clusters';
	import {
		buildSendReadiness,
		buildStudioDraftHandoffRows,
		formatGateEvidence,
		getGateEvidence,
		type CapabilityState,
		type SendReadinessMode,
		type StudioDraftHandoffRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments
	} from '$lib/data/capability-state-labels';
	import {
		deleteOrgEmailComposeDraft,
		getOrgEmailComposeDraft,
		type OrgEmailComposeDraft
	} from '$lib/stores/orgEmailComposeDraft';
	import {
		PLATFORM_EXPORT_PROFILES,
		formatPeopleSourceLabel
	} from '$lib/data/platform-export-profiles';
	import type { PageData, ActionData } from './$types';
	import type { Editor as EditorType } from '@tiptap/core';
	import type { BlastProgress } from '$lib/services/client-blast-sender';
	import type { Id } from '$convex/_generated/dataModel';

	type DeliveryContractRow = {
		label: string;
		state: CapabilityState;
		action: string;
		effect: string;
		gate: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};
	type RecipientSourceRow = {
		source: string;
		label: string;
		count: number;
	};
	let { data, form }: { data: PageData; form: ActionData } = $props();

	let subject = $state('');
	let bodyHtml = $state('');
	let fromName = $state(data.org.name);
	let fromEmail = $state(`${data.org.slug}@commons.email`);
	let campaignId = $state('');
	let verifiedFilter = $state('any');
	let selectedTagIds = $state<string[]>([]);
	let selectedSegmentIds = $state<string[]>([]);
	let recipientCount = $state(data.subscribedCount);
	// svelte-ignore state_referenced_locally
	let recipientSourceCounts = $state<Record<string, number>>(
		coerceRecipientSourceCounts(data.recipientSourceCounts)
	);
	let countLoading = $state(false);
	let sending = $state(false);
	let showPreview = $state(false);

	// Client-direct send state
	const CLIENT_DIRECT_THRESHOLD = 500;
	let showPassphraseDialog = $state(false);
	let passphrase = $state('');
	let passphraseError = $state('');
	let blastProgress = $state<BlastProgress | null>(null);
	let blastResult = $state<{
		sent: number;
		failed: number;
		errors: Array<{ emailHash: string; error: string }>;
	} | null>(null);
	let pendingBlastData = $state<{
		blastId: string;
		orgId: string;
		fromEmail: string;
		fromName: string;
		subject: string;
		bodyHtml: string;
	} | null>(null);
	// Surfaces preflight failures (e.g., dispatch-claim 503) before the blast
	// reaches Lambda — operator-actionable error message instead of a confusing
	// 403 mid-blast.
	let blastError = $state<string | null>(null);

	const hasOrgKey = $derived(!!data.orgKeyVerifier);
	const canPublish = $derived(
		data.membership.role === 'owner' || data.membership.role === 'editor'
	);
	const base = $derived(`/org/${data.org.slug}`);
	const emailDeliveryHref = $derived(`${base}/emails/compose#email-delivery`);
	const emailProxyGate = getGateEvidence('CP-2', ['T2-2'], {
		name: 'Email send proxy',
		dependency: 'AWS Lambda deploy + BLAST receipts secret sync'
	});
	const abAutomationGate = getGateEvidence('CP-ab-automated-dispatch', ['T1-6b'], {
		name: 'A/B automated dispatch',
		downstream: 1,
		dependency: 'Idempotent test-cohort and winning-remainder send runner'
	});
	const smsDispatchGate = getGateEvidence('CP-sms-dispatch', ['T2-1'], {
		name: 'SMS dispatch',
		downstream: 2,
		dependency: 'Client-side phone decryptor + Twilio proxy'
	});
	const eventArtifactGate = getGateEvidence('CP-event-artifacts', ['T6-7'], {
		name: 'Event artifacts',
		downstream: 1,
		dependency: 'Calendar-provider sync, QR check-in, and anchored event receipts'
	});
	const workflowEffectsGate = getGateEvidence('CP-workflow-execution', ['T1-9a'], {
		name: 'Bounded workflow runner',
		downstream: 3,
		dependency: 'Trigger dispatch + tag/branch/delay runner'
	});
	const congressionalLaunchGate = getGateEvidence('CP-congressional-launch', ['NEW-A-7'], {
		name: 'Congressional launch gate',
		dependency: 'CWC production credentials + proof-authority launch flag'
	});
	const messageProofGate = getGateEvidence('CP-message-proof-binding', ['T4-2', 'T4-7'], {
		name: 'Artifact proof binding',
		downstream: 3,
		dependency: 'Drafted artifact proof attachment and writer proof plumbing'
	});

	// A/B testing state
	let abEnabled = $state(false);
	let subjectA = $state('');
	let subjectB = $state('');
	let bodyHtmlA = $state('');
	let bodyHtmlB = $state('');
	let activeVariant = $state<'A' | 'B'>('A');
	let splitPct = $state(50);
	let testDuration = $state('4h');
	let winnerMetric = $state('open');
	let testGroupPct = $state(20);
	const mergeFieldPattern =
		/\{\{(?:firstName|lastName|email|postalCode|verificationStatus|tierLabel|tierContext)\}\}/g;
	const platformSourceIds = new Set<string>(
		PLATFORM_EXPORT_PROFILES.map((profile) => profile.source)
	);

	function coerceRecipientSourceCounts(value: unknown): Record<string, number> {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
		const counts: Record<string, number> = {};
		for (const [source, count] of Object.entries(value)) {
			if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
				counts[source] = count;
			}
		}
		return counts;
	}

	function recipientSourceLabel(source: string): string {
		if (source === 'unknown') return 'Unknown source';
		return formatPeopleSourceLabel(source, { style: 'record', fallback: 'Other source' });
	}

	function countMergeFields(value: string): number {
		return value.match(mergeFieldPattern)?.length ?? 0;
	}

	const recipientSourceRows = $derived<RecipientSourceRow[]>(
		Object.entries(recipientSourceCounts)
			.map(([source, count]) => ({
				source,
				count,
				label: recipientSourceLabel(source)
			}))
			.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
	);
	const topRecipientSource = $derived(recipientSourceRows[0] ?? null);
	const platformRecipientSourceCount = $derived(
		recipientSourceRows.reduce(
			(total, row) => total + (platformSourceIds.has(row.source) ? row.count : 0),
			0
		)
	);
	const recipientPlatformProfileCount = $derived(
		recipientSourceRows.filter((row) => platformSourceIds.has(row.source)).length
	);
	const recipientSourceState = $derived<CapabilityState>(
		recipientSourceRows.length > 0 ? 'live' : 'partial'
	);

	const mergeFieldCount = $derived(
		countMergeFields(subject) +
			countMergeFields(bodyHtml) +
			countMergeFields(subjectA) +
			countMergeFields(subjectB) +
			countMergeFields(bodyHtmlA) +
			countMergeFields(bodyHtmlB)
	);
	const hasMergeFields = $derived(mergeFieldCount > 0);
	const mergeFieldsBlockClientSend = $derived(
		hasMergeFields && !FEATURES.EMAIL_CLIENT_DIRECT_MERGE
	);
	const clientDirectConfigured = $derived(Boolean(env.PUBLIC_SES_PROXY_URL));
	const emailDeliveryGround = $derived({
		subscribedCount: recipientCount,
		clientDirectThreshold: CLIENT_DIRECT_THRESHOLD,
		sesProxyConfigured: clientDirectConfigured,
		orgKeyConfigured: hasOrgKey,
		serverDispatchRuntimeReady: data.serverDispatchRuntimeReady,
		serverDispatchRuntimeMissing: data.serverDispatchRuntimeMissing,
		serverDispatchRuntimeDependency: data.serverDispatchRuntimeDependency,
		serverDispatchRuntimeMessage: data.serverDispatchRuntimeMessage
	});
	const congressionalDelivery = $derived(data.spaces.operating?.congressionalDelivery ?? null);
	const sendReadiness = $derived(
		buildSendReadiness({
			base,
			emailDeliveryHref,
			canPublish,
			emailDelivery: emailDeliveryGround,
			congressionalDelivery,
			fallbackSubscribedCount: data.subscribedCount,
			features: {
				EMAIL_CLIENT_DIRECT_MERGE: FEATURES.EMAIL_CLIENT_DIRECT_MERGE,
				EMAIL_SERVER_DISPATCH: FEATURES.EMAIL_SERVER_DISPATCH,
				AB_TESTING: FEATURES.AB_TESTING,
				SMS_DISPATCH: FEATURES.SMS_DISPATCH,
				EVENTS: FEATURES.EVENTS,
				WORKFLOW_EXECUTION: FEATURES.WORKFLOW_EXECUTION,
				CONGRESSIONAL: FEATURES.CONGRESSIONAL
			},
			gates: {
				emailProxyGate,
				abAutomationGate,
				smsDispatchGate,
				eventArtifactGate,
				workflowEffectsGate,
				congressionalLaunchGate
			}
		})
	);
	const sendReadinessModes = $derived<SendReadinessMode[]>(sendReadiness.modes);
	const sendBoundarySummary = $derived(sendReadiness.sendBoundarySummary);
	const sendBoundaryGateSummary = $derived(sendReadiness.sendBoundaryGate);
	const serverDispatchRuntimeArmed = $derived(
		FEATURES.EMAIL_SERVER_DISPATCH && data.serverDispatchRuntimeReady
	);
	const browserDirectExecutable = $derived(
		sendReadiness.browserDirectState === 'partial' && !mergeFieldsBlockClientSend
	);
	const verificationContextState = $derived<CapabilityState>(
		verifiedFilter === 'any' ? 'partial' : 'live'
	);

	function requiredSendMode(
		modes: SendReadinessMode[],
		key: SendReadinessMode['key']
	): SendReadinessMode {
		const mode = modes.find((candidate) => candidate.key === key);
		if (!mode) throw new Error(`Missing send readiness mode: ${key}`);
		return mode;
	}

	const browserDirectMode = $derived(requiredSendMode(sendReadinessModes, 'browser-direct'));
	const serverDispatchMode = $derived(requiredSendMode(sendReadinessModes, 'server-email'));
	const abContinuationMode = $derived(requiredSendMode(sendReadinessModes, 'ab-automation'));
	const mergePersonalizationState = $derived<CapabilityState>(
		!hasMergeFields ? 'live' : sendReadiness.clientDirectMergeState
	);
	const mergePersonalizationGate = $derived(
		!hasMergeFields
			? 'No personalization gate currently blocks this message.'
			: sendReadiness.clientDirectMergeGate
	);
	const abContinuationState = $derived<CapabilityState>(
		data.abTestingAllowed ? abContinuationMode.state : 'gated'
	);
	const deliveryContractRows = $derived<DeliveryContractRow[]>([
		{
			label: 'Browser-direct email',
			state: mergeFieldsBlockClientSend ? 'gated' : browserDirectMode.state,
			action:
				browserDirectMode.state === 'partial' ? 'send from browser' : browserDirectMode.action,
			effect: mergeFieldsBlockClientSend
				? 'Browser-direct send is blocked for this message because the client-direct merge runner is not armed; preserve the draft or use a runtime-ready server send.'
				: browserDirectMode.effect,
			gate: mergeFieldsBlockClientSend
				? 'Personalized browser sends require EMAIL_CLIENT_DIRECT_MERGE plus the org-key and SES proxy path; remove merge fields, preserve the draft, or use server dispatch when runtime-ready.'
				: browserDirectMode.unlock,
			metric: {
				value: recipientCount,
				label: 'recipient cohort',
				cite: 'people summary + recipient filter count'
			}
		},
		{
			label: 'Server dispatch',
			state: serverDispatchMode.state,
			action: serverDispatchMode.action,
			effect: serverDispatchMode.effect,
			gate: serverDispatchMode.unlock,
			metric: {
				value: recipientCount,
				label: 'recipient cohort',
				cite: 'recipient filter count'
			}
		},
		{
			label: 'Audience source basis',
			state: recipientSourceState,
			action: recipientSourceRows.length > 0 ? 'read source basis' : 'import source',
			effect: topRecipientSource
				? `${topRecipientSource.label} is the largest source in the selected cohort; ${platformRecipientSourceCount} recipients carry recognized platform-profile origin.`
				: 'The selected cohort has no preserved source counts yet; send readiness still uses the recipient filter count.',
			gate:
				recipientSourceRows.length > 0
					? `Source counts come from email.countRecipientsForFilter after subscribed, tag, segment, and verification filters; ${recipientPlatformProfileCount} platform profiles are represented.`
					: 'Import People through CSV profiles, widgets, or organic signup before claiming audience-origin evidence.',
			metric: {
				value: platformRecipientSourceCount,
				label: 'platform-origin recipients',
				cite: 'email.countRecipientsForFilter sourceCounts'
			}
		},
		{
			label: 'A/B continuation',
			state: abContinuationState,
			action: data.abTestingAllowed ? abContinuationMode.action : 'read experiment boundary',
			effect: data.abTestingAllowed
				? abContinuationMode.effect
				: 'A/B setup requires an eligible plan and an armed continuation gate.',
			gate: data.abTestingAllowed
				? abContinuationMode.unlock
				: formatGateEvidence(abAutomationGate, {
						prefix: 'Starter plan or above plus the A/B continuation gate is required.'
					}),
			metric: {
				value: recipientCount,
				label: 'candidate cohort',
				cite: 'recipient filter count + emailAbTestCohorts'
			}
		},
		{
			label: 'Merge personalization',
			state: mergePersonalizationState,
			action: mergePersonalizationState === 'live' ? 'use body' : 'remove tokens',
			effect: !hasMergeFields
				? 'No merge tokens are present, so direct send is not blocked by personalization.'
				: FEATURES.EMAIL_CLIENT_DIRECT_MERGE
					? 'Client-direct send resolves supported tokens after recipient decrypt, using one-recipient Lambda calls when personalization is present.'
					: 'Preview can render tokens with sample context, but browser-direct personalization stays draft-only until the client merge runner is armed; server dispatch still owns its own runtime gate.',
			gate: mergePersonalizationGate,
			metric: {
				value: mergeFieldCount,
				label: 'merge tokens',
				cite: 'EMAIL_CLIENT_DIRECT_MERGE'
			}
		},
		{
			label: 'Verification context',
			state: verificationContextState,
			action: verifiedFilter === 'any' ? 'qualify cohort' : 'include proof block',
			effect:
				verifiedFilter === 'verified'
					? 'The cohort is constrained to verified people, so the proof block can state the count exactly.'
					: verifiedFilter === 'unverified'
						? 'The cohort is constrained to unverified people, so the proof block stays exact.'
						: 'Mixed verification cohorts omit aggregate proof rather than approximate a count.',
			gate:
				verifiedFilter === 'any'
					? 'Choose a verification filter before claiming a cohort-level verification number.'
					: 'Filter-scoped verification block is generated by compileEmailShell.',
			metric: {
				value: recipientCount,
				label: verifiedFilter === 'any' ? 'mixed cohort' : `${verifiedFilter} cohort`,
				cite: 'compileEmailShell verificationBlock'
			}
		}
	]);
	const deliveryStateCounts = $derived(
		deliveryContractRows.reduce(
			(acc, row) => {
				acc[row.state] += 1;
				return acc;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const deliverySegments = $derived(operatorCapabilityStateRatioSegments(deliveryStateCounts));

	function deliveryStateLabel(state: CapabilityState): string {
		return operatorCapabilityStateLabel(state);
	}

	function deliveryActionLabel(row: DeliveryContractRow): string {
		return operatorCapabilityActionLabel(row.state, row.action, { appendReadyArrow: true });
	}

	function studioHandoffActionLabel(row: StudioDraftHandoffRow): string {
		return operatorCapabilityActionLabel(row.state, row.action, { appendReadyArrow: true });
	}

	// Draft auto-save
	interface ComposeDraft {
		subject: string;
		bodyHtml: string;
		fromName: string;
		campaignId: string;
		verifiedFilter: string;
		selectedTagIds: string[];
		selectedSegmentIds: string[];
		savedAt: number;
	}

	let draftRestored = $state(false);
	let studioDraftRestored = $state<OrgEmailComposeDraft | null>(null);
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	const draftKey = $derived(`draft:compose:${data.org.id}`);
	const studioDraftId = $derived($page.url.searchParams.get('studioDraft') ?? '');
	const studioDraftSourceCount = $derived(studioDraftRestored?.metadata.sourceCount ?? 0);
	const studioDraftEvaluatedSourceCount = $derived(
		studioDraftRestored?.metadata.evaluatedSourceCount ?? 0
	);
	const studioDraftSearchOnlySourceCount = $derived(
		studioDraftRestored?.metadata.searchOnlySourceCount ??
			Math.max(0, studioDraftSourceCount - studioDraftEvaluatedSourceCount)
	);
	const studioHandoffRows = $derived<StudioDraftHandoffRow[]>(
		studioDraftRestored
			? buildStudioDraftHandoffRows({
					destination: 'email-composer',
					targetCount: studioDraftRestored.metadata.decisionMakerCount,
					evaluatedSourceCount: studioDraftEvaluatedSourceCount,
					searchOnlySourceCount: studioDraftSearchOnlySourceCount,
					scopeLabel: studioDraftRestored.metadata.geographicScopeLabel ?? null,
					scopeBasis: studioDraftRestored.metadata.geographicScopeBasis ?? null,
					scopeSource: studioDraftRestored.metadata.geographicScopeSource ?? null,
					scopeMetricCite: 'orgEmailComposeDraft geographicScope',
					recoveryJobPresent: Boolean(studioDraftRestored.metadata.messageJobId),
					recoveryJobStatus: studioDraftRestored.metadata.messageJobStatus ?? null,
					recoveryMetricCite: 'orgEmailComposeDraft messageJobId/inputHash',
					traceHandle: studioDraftRestored.metadata.messageTraceId
						? studioDraftRestored.metadata.messageTraceId.slice(0, 8)
						: null,
					traceMetricCite: 'orgEmailComposeDraft messageTraceId',
					draftEffect:
						'Studio supplied the subject and body; this composer now owns cohort selection, preview, and send confirmation.',
					draftMetricCite: 'orgEmailComposeDraft studioDraft',
					messageProofGate
				})
			: []
	);
	const studioHandoffStateCounts = $derived(
		studioHandoffRows.reduce(
			(acc, row) => {
				acc[row.state] += 1;
				return acc;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<CapabilityState, number>
		)
	);
	const studioHandoffSegments = $derived(
		operatorCapabilityStateRatioSegments(studioHandoffStateCounts)
	);

	// Restore a STUDIO handoff before the generic composer draft restore. This is
	// a one-time import: STUDIO has already saved the generated subject/body; the
	// org email composer now owns audience selection, preview, and send.
	let hasAppliedStudioDraft = false;
	$effect(() => {
		const draftId = studioDraftId;
		if (!browser || hasAppliedStudioDraft || !draftId) return;
		hasAppliedStudioDraft = true;

		const draft = getOrgEmailComposeDraft(draftId);
		if (!draft) return;

		subject = draft.subject;
		bodyHtml = draft.bodyHtml;
		studioDraftRestored = draft;
		draftRestored = false;
		if (editor) editor.commands.setContent(bodyHtml);
		deleteOrgEmailComposeDraft(draftId);

		try {
			const url = new URL(window.location.href);
			url.searchParams.delete('studioDraft');
			window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
		} catch {
			// URL cleanup is non-critical; the one-time guard prevents re-import loops.
		}
	});

	// Restore draft on mount (runs once)
	let hasRestoredDraft = false;
	$effect(() => {
		if (!browser || hasRestoredDraft) return;
		hasRestoredDraft = true;
		try {
			const saved = localStorage.getItem(draftKey);
			if (!saved) return;
			const draft: ComposeDraft = JSON.parse(saved);
			// Discard drafts older than 7 days
			if (Date.now() - draft.savedAt > 7 * 24 * 60 * 60 * 1000) {
				localStorage.removeItem(draftKey);
				return;
			}
			// Only restore if current form is empty
			if (subject || bodyHtml) return;
			subject = draft.subject || '';
			bodyHtml = draft.bodyHtml || '';
			fromName = draft.fromName || data.org.name;
			campaignId = draft.campaignId || '';
			verifiedFilter = draft.verifiedFilter || 'any';
			selectedTagIds = draft.selectedTagIds || [];
			selectedSegmentIds = draft.selectedSegmentIds || [];
			draftRestored = true;
		} catch {
			/* corrupted data, ignore */
		}
	});

	// Auto-save on change (debounced 2s)
	$effect(() => {
		// Track all saveable fields
		const _s = subject;
		const _b = bodyHtml;
		const _f = fromName;
		const _c = campaignId;
		const _v = verifiedFilter;
		const _t = selectedTagIds;
		const _seg = selectedSegmentIds;

		if (!browser) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			// Don't save empty drafts
			if (!subject && !bodyHtml) return;
			const draft: ComposeDraft = {
				subject,
				bodyHtml,
				fromName,
				campaignId,
				verifiedFilter,
				selectedTagIds,
				selectedSegmentIds,
				savedAt: Date.now()
			};
			try {
				localStorage.setItem(draftKey, JSON.stringify(draft));
			} catch {
				/* quota exceeded, ignore */
			}
		}, 2000);
	});

	// Warn before unload if form has content
	$effect(() => {
		if (!browser) return;
		function handleBeforeUnload(e: BeforeUnloadEvent) {
			if (subject.trim() || bodyHtml.trim()) {
				e.preventDefault();
			}
		}
		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => window.removeEventListener('beforeunload', handleBeforeUnload);
	});

	// Tiptap editor
	let editorElement: HTMLElement | undefined = $state();
	let editor: EditorType | undefined = $state();

	$effect(() => {
		if (!browser || !editorElement) return;

		let editorInstance: EditorType;

		(async () => {
			const { Editor } = await import('@tiptap/core');
			const { default: StarterKit } = await import('@tiptap/starter-kit');
			const { default: Link } = await import('@tiptap/extension-link');
			const { default: TextAlign } = await import('@tiptap/extension-text-align');
			const { default: Underline } = await import('@tiptap/extension-underline');

			// Guard: element may have been removed during async import
			if (!editorElement) return;

			editorInstance = new Editor({
				element: editorElement,
				extensions: [
					StarterKit,
					Link.configure({
						openOnClick: false,
						HTMLAttributes: { class: 'text-teal-400 underline' }
					}),
					TextAlign.configure({
						types: ['heading', 'paragraph']
					}),
					Underline
				],
				content: bodyHtml || '',
				editorProps: {
					attributes: {
						class:
							'prose prose-invert prose-sm max-w-none px-4 py-3 min-h-[18rem] focus:outline-none text-text-primary leading-relaxed'
					}
				},
				onUpdate: ({ editor: e }) => {
					bodyHtml = e.getHTML();
				}
			});

			editor = editorInstance;
		})();

		return () => {
			if (editorInstance) {
				editorInstance.destroy();
			}
		};
	});

	onDestroy(() => {
		if (editor) {
			editor.destroy();
		}
	});

	const previewHtml = $derived(
		form && 'previewHtml' in form ? (form as { previewHtml: string }).previewHtml : null
	);
	const previewSubject = $derived(
		form && 'previewSubject' in form ? (form as { previewSubject: string }).previewSubject : null
	);
	const errorMsg = $derived(form && 'error' in form ? (form as { error: string }).error : null);
	const errorCode = $derived(
		form && 'errorCode' in form ? (form as { errorCode: string }).errorCode : null
	);
	const errorDraftHref = $derived(
		form && 'draftHref' in form ? (form as { draftHref: string }).draftHref : null
	);

	function toggleTag(tagId: string) {
		if (selectedTagIds.includes(tagId)) {
			selectedTagIds = selectedTagIds.filter((id) => id !== tagId);
		} else {
			selectedTagIds = [...selectedTagIds, tagId];
		}
	}

	function toggleSegment(segmentId: string) {
		if (selectedSegmentIds.includes(segmentId)) {
			selectedSegmentIds = selectedSegmentIds.filter((id) => id !== segmentId);
		} else {
			selectedSegmentIds = [...selectedSegmentIds, segmentId];
		}
	}

	// Debounced auto-recount when filters change
	let isFirstRun = true;
	let countDebounceTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const _v = verifiedFilter;
		const _t = selectedTagIds;
		const _seg = selectedSegmentIds;

		if (isFirstRun) {
			isFirstRun = false;
			return;
		}

		if (countDebounceTimer) clearTimeout(countDebounceTimer);
		countDebounceTimer = setTimeout(() => {
			const countForm = document.querySelector('form[action="?/count"]') as HTMLFormElement;
			if (countForm) countForm.requestSubmit();
		}, 500);
	});

	const mergeFieldHints = [
		{ field: '{{firstName}}', desc: "Recipient's first name" },
		{ field: '{{lastName}}', desc: "Recipient's last name" },
		{ field: '{{postalCode}}', desc: "Recipient's postal code" },
		{
			field: '{{tierContext}}',
			desc: 'Verification context, e.g., "You\'re one of 43 Established advocates in District 6"'
		}
	];

	function insertMergeField(field: string) {
		if (editor) {
			editor.chain().focus().insertContent(field).run();
		}
	}

	function clearComposerDraft(): void {
		subject = '';
		bodyHtml = '';
		fromName = data.org.name;
		campaignId = '';
		verifiedFilter = 'any';
		selectedTagIds = [];
		selectedSegmentIds = [];
		studioDraftRestored = null;
		draftRestored = false;
		if (editor) editor.commands.clearContent();
		if (browser) {
			try {
				localStorage.removeItem(draftKey);
			} catch {
				/* ignore */
			}
		}
	}

	// Toolbar helpers
	function setLink() {
		if (!editor) return;
		const previousUrl = editor.getAttributes('link').href || '';
		const url = prompt('Enter URL:', previousUrl);
		if (url === null) return; // cancelled
		if (url === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
		} else {
			editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
		}
	}

	// Force reactivity for toolbar active states
	let editorRevision = $state(0);
	$effect(() => {
		if (!editor) return;
		const handler = () => {
			editorRevision++;
		};
		editor.on('transaction', handler);
		return () => {
			editor?.off('transaction', handler);
		};
	});

	function isActive(
		name: string | Record<string, unknown>,
		attrs?: Record<string, unknown>
	): boolean {
		// read editorRevision to trigger reactivity
		void editorRevision;
		if (typeof name === 'object') {
			return editor?.isActive(name) ?? false;
		}
		return editor?.isActive(name, attrs) ?? false;
	}

	// Tiptap outputs <p></p> for empty content, so check for real content
	const hasBody = $derived(bodyHtml.replace(/<[^>]*>/g, '').trim().length > 0);

	async function startClientDirectSend(blastData: typeof pendingBlastData) {
		if (!blastData) return;

		const { getOrPromptOrgKey } = await import('$lib/services/org-key-manager');

		// Try cached org key first
		let orgKey = data.orgKeyVerifier
			? await getOrPromptOrgKey(data.org.id, data.orgKeyVerifier)
			: null;

		if (!orgKey) {
			// Need passphrase — show dialog and wait
			pendingBlastData = blastData;
			showPassphraseDialog = true;
			return;
		}

		await executeClientSend(orgKey, blastData);
	}

	async function onPassphraseSubmit() {
		if (!passphrase.trim() || !pendingBlastData || !data.orgKeyVerifier) return;

		passphraseError = '';

		try {
			const { deriveAndCacheOrgKey } = await import('$lib/services/org-key-manager');
			const orgKey = await deriveAndCacheOrgKey(passphrase, data.org.id, data.orgKeyVerifier);

			if (!orgKey) {
				passphraseError = 'Wrong passphrase. Please try again.';
				return;
			}

			showPassphraseDialog = false;
			passphrase = '';
			await executeClientSend(orgKey, pendingBlastData);
		} catch (err) {
			passphraseError = err instanceof Error ? err.message : 'Key derivation failed';
		}
	}

	async function executeClientSend(
		orgKey: CryptoKey,
		blastData: NonNullable<typeof pendingBlastData>
	) {
		const { sendBlastFromClient } = await import('$lib/services/client-blast-sender');
		const { useConvexClient } = await import('convex-sveltekit');
		const { api } = await import('$lib/convex');

		const convex = useConvexClient();

		sending = true;
		blastError = null; // clear any stale preflight error from a previous attempt
		blastProgress = {
			total: 0,
			sent: 0,
			failed: 0,
			currentBatch: 0,
			totalBatches: 0,
			status: 'fetching-credentials'
		};

		try {
			// Fetch encrypted supporters via Convex client — pass blastId so the
			// recipientFilter persisted at compose time is enforced at load
			// (F-119 closure: filter is no longer just a count-time UI hint).
			const supporters = await convex.query(api.blasts.getEncryptedSupportersForBlast, {
				orgSlug: data.org.slug,
				blastId: blastData.blastId as Id<'emailBlasts'>
			});

			// Fetch dispatch claim once per blast (caller-cohort
			// validation). Claim is server-signed and binds (orgId, blastId,
			// allowedHashes[]); Lambda enforces per-recipient before SES
			// dispatch. Failure here means we cannot guarantee cohort
			// validation; surface as a hard error so the operator knows.
			// Dispatch claim is REQUIRED — Lambda will reject any send without
			// it. Surface every failure mode (including 503 from a misconfigured
			// BLAST_DISPATCH_SECRET) as a hard error so operators see the root
			// cause instead of a confusing 403 from Lambda mid-blast.
			let dispatchClaim: string;
			try {
				const claimResp = await fetch(
					`/api/blast/${blastData.blastId}/dispatch-claim?orgSlug=${encodeURIComponent(data.org.slug)}`
				);
				if (!claimResp.ok) {
					if (claimResp.status === 503) {
						throw new Error(
							'Bulk-send dispatch is not configured (operator: set BLAST_DISPATCH_SECRET on both SvelteKit and Lambda env)'
						);
					}
					throw new Error(`Dispatch claim fetch failed: ${claimResp.status}`);
				}
				const parsed = await claimResp.json();
				if (typeof parsed.claim !== 'string' || parsed.claim.length === 0) {
					throw new Error('Dispatch claim response missing `claim` field');
				}
				dispatchClaim = parsed.claim;
			} catch (err) {
				console.error('[blast] failed to fetch dispatch claim', err);
				blastError = err instanceof Error ? err.message : 'Failed to authorize blast send';
				sending = false;
				blastProgress = null;
				return;
			}

			// Update blast to sending
			await convex.mutation(api.blasts.updateClientBlastProgress, {
				orgSlug: data.org.slug,
				blastId: blastData.blastId as Id<'emailBlasts'>,
				status: 'sending',
				totalSent: 0,
				totalBounced: 0,
				totalRecipients: supporters.length
			});

			const result = await sendBlastFromClient({
				orgSlug: data.org.slug,
				orgId: blastData.orgId,
				blastId: blastData.blastId,
				orgKey,
				subject: blastData.subject,
				bodyHtml: blastData.bodyHtml,
				fromEmail: blastData.fromEmail,
				fromName: blastData.fromName,
				lambdaUrl: env.PUBLIC_SES_PROXY_URL || '',
				encryptedSupporters: supporters,
				dispatchClaim,
				onProgress: (p) => {
					blastProgress = p;
				},
				onBatchReceipts: async (receipts) => {
					try {
						await convex.mutation(api.blasts.recordBlastReceipts, {
							orgSlug: data.org.slug,
							blastId: blastData.blastId as Id<'emailBlasts'>,
							receipts
						});
					} catch (err) {
						// Receipt persistence is best-effort — a transient Convex
						// failure must not block the in-flight send. Surface in the
						// error log; the next batch will still attempt to write.
						console.error('[blast] failed to persist receipts batch', err);
					}
				},
				resolveUnsubscribeUrls: async (supporterIds) => {
					// Vend per-recipient unsubscribe URLs from the SvelteKit endpoint
					// so the HMAC secret stays server-side. The endpoint pulls the
					// authoritative orgId from the blast row (not from the caller),
					// which prevents cross-org token vending. Failure here surfaces
					// in the sender as "no List-Unsubscribe header for this batch" —
					// the bulk send still proceeds (Lambda falls back to SendEmail).
					const resp = await fetch(
						`/api/blast/${blastData.blastId}/unsubscribe-tokens?orgSlug=${encodeURIComponent(data.org.slug)}`,
						{
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({
								supporters: supporterIds.map((supporterId) => ({ supporterId }))
							})
						}
					);
					if (!resp.ok) {
						throw new Error(`Token endpoint ${resp.status}`);
					}
					const { urls } = (await resp.json()) as { urls: string[] };
					return urls;
				}
			});

			// Finalize blast status
			await convex.mutation(api.blasts.updateClientBlastProgress, {
				orgSlug: data.org.slug,
				blastId: blastData.blastId as Id<'emailBlasts'>,
				status: result.failed === result.total ? 'failed' : 'sent',
				totalSent: result.sent,
				totalBounced: result.failed,
				totalRecipients: result.total
			});

			blastResult = result;

			// Clear draft
			if (browser) {
				try {
					localStorage.removeItem(draftKey);
				} catch {}
			}
		} catch (err) {
			blastProgress = { ...blastProgress!, status: 'error' };
			blastResult = {
				sent: blastProgress?.sent ?? 0,
				failed: blastProgress?.total ?? 0,
				errors: [{ emailHash: '', error: err instanceof Error ? err.message : 'Send failed' }]
			};
		} finally {
			sending = false;
			pendingBlastData = null;
		}
	}
</script>

<div id="email-compose" class="scroll-mt-24 space-y-6">
	<!-- Header -->
	<div class="flex items-center gap-4">
		<a
			href="/org/{data.org.slug}/emails"
			class="text-text-tertiary hover:text-text-secondary transition-colors"
			aria-label="Back to email delivery"
		>
			<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
				/>
			</svg>
		</a>
		<div>
			<h1 class="text-text-primary text-xl font-semibold">Compose delivery</h1>
			<p class="text-text-tertiary mt-1 text-sm">
				Author a proof-aware email and send only through an armed path.
			</p>
		</div>
	</div>

	{#if errorMsg}
		<div class="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
			<p>{errorMsg}</p>
			{#if errorCode === 'email_server_dispatch_dependency_missing' && errorDraftHref}
				<a
					href={errorDraftHref}
					class="mt-2 inline-flex font-medium text-red-200 underline underline-offset-4"
				>
					Open preserved draft
				</a>
			{/if}
		</div>
	{/if}

	{#if studioDraftRestored}
		<div
			class="studio-handoff-contract"
			aria-label="Studio email composer handoff contract"
			data-state="draft-only"
		>
			<div class="studio-handoff-top">
				<div class="studio-handoff-main">
					<p class="studio-handoff-kicker">Studio provenance:</p>
					<h2 class="studio-handoff-title">Email composer draft from Studio</h2>
					<p class="studio-handoff-copy">
						Subject and body came from Studio. Choose recipients, preview, then send only through an
						armed email path.
					</p>
				</div>
				<div class="studio-handoff-counts" aria-label="Studio handoff counts">
					<span>
						<Datum
							value={studioDraftRestored.metadata.decisionMakerCount}
							cite="orgEmailComposeDraft metadata.decisionMakerCount"
						/>
						targets
					</span>
					<span>
						<Datum
							value={studioDraftEvaluatedSourceCount}
							cite="orgEmailComposeDraft metadata.evaluatedSourceCount"
						/>
						evaluated sources
					</span>
					{#if studioDraftSearchOnlySourceCount > 0}
						<span>
							<Datum
								value={studioDraftSearchOnlySourceCount}
								cite="orgEmailComposeDraft metadata.searchOnlySourceCount"
							/>
							search-only
						</span>
					{/if}
				</div>
			</div>
			<Ratio segments={studioHandoffSegments} height={8} />
			<div class="studio-handoff-facts" aria-label="Studio provenance handles">
				{#if studioDraftRestored.metadata.messageTraceId}
					<span>trace {studioDraftRestored.metadata.messageTraceId.slice(0, 8)}</span>
				{:else if studioDraftRestored.metadata.messageJobId}
					<span>job {studioDraftRestored.metadata.messageJobId.slice(0, 8)}</span>
				{:else}
					<span>no trace handle</span>
				{/if}
				{#if studioDraftRestored.metadata.messageJobStatus}
					<span>recovery {studioDraftRestored.metadata.messageJobStatus}</span>
				{/if}
				{#if studioDraftRestored.metadata.geographicScopeLabel}
					<span>scope {studioDraftRestored.metadata.geographicScopeLabel}</span>
				{/if}
			</div>
			<div class="studio-handoff-list">
				{#each studioHandoffRows as row (row.label)}
					<div class="studio-handoff-row" data-state={row.state}>
						<div class="studio-handoff-row-main">
							<span class="studio-handoff-row-name">{row.label}</span>
							<span class="studio-handoff-row-cluster">
								{formatCapabilityClusters(row.clusters)}
							</span>
							<span class="studio-handoff-row-effect">{row.effect}</span>
						</div>
						<span class="studio-handoff-row-state">{deliveryStateLabel(row.state)}</span>
						<span class="studio-handoff-row-metric">
							<Datum value={row.metric.value} cite={row.metric.cite} />
							<span>{row.metric.label}</span>
						</span>
						<span class="studio-handoff-row-action">{studioHandoffActionLabel(row)}</span>
						<span class="studio-handoff-row-gate">{row.gate}</span>
					</div>
				{/each}
			</div>
			<button type="button" class="studio-handoff-discard" onclick={clearComposerDraft}>
				Discard prefill
			</button>
		</div>
	{/if}

	{#if draftRestored}
		<div
			class="flex items-center justify-between rounded-md border border-teal-500/20 bg-teal-500/5 px-4 py-2.5"
		>
			<p class="text-sm text-teal-400">Draft restored from your last session</p>
			<button
				type="button"
				class="text-text-tertiary hover:text-text-secondary text-xs transition-colors"
				onclick={clearComposerDraft}
			>
				Discard
			</button>
		</div>
	{/if}

	<!-- Preview modal -->
	{#if showPreview && previewHtml}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
			<div
				class="border-surface-border-strong bg-surface-raised flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-md border"
			>
				<div class="border-surface-border flex items-center justify-between border-b px-4 py-3">
					<div>
						<p class="text-text-primary text-sm font-medium">Email Preview</p>
						{#if previewSubject}
							<p class="text-text-tertiary mt-0.5 text-xs">Subject: {previewSubject}</p>
						{/if}
					</div>
					<button
						type="button"
						class="text-text-tertiary hover:text-text-primary transition-colors"
						aria-label="Close preview"
						onclick={() => (showPreview = false)}
					>
						<svg
							class="h-5 w-5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="1.5"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div class="flex-1 overflow-auto p-1">
					<iframe
						srcdoc={previewHtml}
						title="Email preview"
						class="h-full min-h-[400px] w-full rounded border-0"
						sandbox=""
					></iframe>
				</div>
			</div>
		</div>
	{/if}

	<!-- Passphrase dialog for client-direct send -->
	{#if showPassphraseDialog}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
			<div
				class="border-surface-border-strong bg-surface-raised w-full max-w-sm space-y-4 rounded-md border p-6"
			>
				<div>
					<h3 class="text-text-primary text-base font-semibold">Enter organization passphrase</h3>
					<p class="text-text-tertiary mt-1 text-sm">
						Your passphrase decrypts recipient emails in this browser. It is never sent to our
						servers.
					</p>
				</div>

				{#if passphraseError}
					<div
						class="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
					>
						{passphraseError}
					</div>
				{/if}

				<form
					onsubmit={(e) => {
						e.preventDefault();
						onPassphraseSubmit();
					}}
				>
					<input
						type="password"
						bind:value={passphrase}
						placeholder="Organization passphrase"
						class="border-surface-border-strong bg-surface-base text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
						autofocus
					/>
					<div class="mt-4 flex gap-3">
						<button
							type="button"
							class="border-surface-border-strong bg-surface-overlay text-text-primary hover:bg-surface-overlay hover:border-text-quaternary flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
							onclick={() => {
								showPassphraseDialog = false;
								passphrase = '';
								passphraseError = '';
								pendingBlastData = null;
							}}
						>
							Cancel
						</button>
						<button
							type="submit"
							class="flex-1 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:opacity-50"
							disabled={!passphrase.trim()}
						>
							Unlock & Send
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
		<!-- Main form -->
		<div class="space-y-6 lg:col-span-2">
			<!-- From / Subject -->
			<div
				id="email-compose-fields"
				class="border-surface-border bg-surface-base scroll-mt-24 space-y-4 rounded-md border p-6"
			>
				<div class="grid grid-cols-2 gap-4">
					<div>
						<label for="fromName" class="text-text-secondary mb-1.5 block text-sm font-medium"
							>From Name</label
						>
						<input
							id="fromName"
							type="text"
							bind:value={fromName}
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
							placeholder="Organization name"
						/>
					</div>
					<div>
						<label for="fromEmail" class="text-text-secondary mb-1.5 block text-sm font-medium"
							>From Email</label
						>
						<input
							id="fromEmail"
							type="email"
							bind:value={fromEmail}
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
							placeholder="noreply@commons.email"
						/>
					</div>
				</div>

				{#if !abEnabled}
					<div>
						<label for="subject" class="text-text-secondary mb-1.5 block text-sm font-medium"
							>Subject Line</label
						>
						<input
							id="subject"
							type="text"
							bind:value={subject}
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
							placeholder="Your email subject..."
						/>
					</div>
				{:else}
					<div class="space-y-3">
						<div class="flex items-center gap-2">
							<span class="text-text-secondary text-sm font-medium">Subject Lines</span>
							<span
								class="rounded-md border border-teal-500/20 bg-teal-500/15 px-2 py-0.5 font-mono text-xs text-teal-400"
								>A/B Test</span
							>
						</div>
						<div>
							<label for="subjectA" class="text-text-tertiary mb-1 block text-xs font-medium"
								>Variant A</label
							>
							<input
								id="subjectA"
								type="text"
								bind:value={subjectA}
								class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
								placeholder="Subject line A..."
							/>
						</div>
						<div>
							<label for="subjectB" class="text-text-tertiary mb-1 block text-xs font-medium"
								>Variant B</label
							>
							<input
								id="subjectB"
								type="text"
								bind:value={subjectB}
								class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
								placeholder="Subject line B..."
							/>
						</div>
					</div>
				{/if}

				<div>
					<label for="campaignId" class="text-text-secondary mb-1.5 block text-sm font-medium">
						Link to action record
						<span class="text-text-tertiary font-normal">(optional)</span>
					</label>
					<select
						id="campaignId"
						bind:value={campaignId}
						class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
					>
						<option value="">No action record</option>
						{#each data.campaigns as campaign}
							<option value={campaign.id}>
								{campaign.title} ({campaign.status})
							</option>
						{/each}
					</select>
				</div>
			</div>

			{#if abEnabled}
				<!-- A/B Variant Tabs for Body -->
				<div class="border-surface-border bg-surface-base flex gap-1 rounded-lg border p-1">
					<button
						type="button"
						class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors {activeVariant ===
						'A'
							? 'bg-surface-border-strong/50 text-teal-400'
							: 'text-text-tertiary hover:text-text-primary'}"
						onclick={() => {
							if (activeVariant === 'A') return;
							bodyHtmlB = bodyHtml;
							activeVariant = 'A';
							bodyHtml = bodyHtmlA;
							if (editor) editor.commands.setContent(bodyHtmlA || '');
						}}
					>
						Variant A Body
					</button>
					<button
						type="button"
						class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors {activeVariant ===
						'B'
							? 'bg-surface-border-strong/50 text-teal-400'
							: 'text-text-tertiary hover:text-text-primary'}"
						onclick={() => {
							if (activeVariant === 'B') return;
							bodyHtmlA = bodyHtml;
							activeVariant = 'B';
							bodyHtml = bodyHtmlB;
							if (editor) editor.commands.setContent(bodyHtmlB || '');
						}}
					>
						Variant B Body
					</button>
				</div>
			{/if}

			<!-- Body editor -->
			<div
				id="email-compose-body"
				class="border-surface-border bg-surface-base scroll-mt-24 space-y-4 rounded-md border p-6"
			>
				<div class="flex items-center justify-between">
					<label class="text-text-secondary block text-sm font-medium">Email Body</label>
					<div class="flex items-center gap-1">
						{#each mergeFieldHints as hint}
							<button
								type="button"
								class="text-text-tertiary hover:bg-surface-overlay rounded px-2 py-1 font-mono text-xs transition-colors hover:text-teal-400"
								title={hint.desc}
								onclick={() => insertMergeField(hint.field)}
							>
								{hint.field}
							</button>
						{/each}
					</div>
				</div>

				<!-- Tiptap editor -->
				<div
					class="tiptap-wrapper border-surface-border-strong bg-surface-raised overflow-hidden rounded-lg border transition-colors focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500"
				>
					<!-- Toolbar -->
					{#if editor}
						<div
							class="border-surface-border-strong bg-surface-overlay flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5"
						>
							<!-- Bold -->
							<button
								type="button"
								title="Bold"
								class="rounded p-1.5 transition-colors {isActive('bold')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleBold().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2.5"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"
									/><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"
									/></svg
								>
							</button>
							<!-- Italic -->
							<button
								type="button"
								title="Italic"
								class="rounded p-1.5 transition-colors {isActive('italic')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleItalic().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M10 4h4m-2 0l-4 16m-2 0h4m4-16l-4 16"
									/></svg
								>
							</button>
							<!-- Underline -->
							<button
								type="button"
								title="Underline"
								class="rounded p-1.5 transition-colors {isActive('underline')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleUnderline().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M7 4v7a5 5 0 0010 0V4M5 20h14"
									/></svg
								>
							</button>
							<!-- Strikethrough -->
							<button
								type="button"
								title="Strikethrough"
								class="rounded p-1.5 transition-colors {isActive('strike')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleStrike().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M16 4c-.5-1.5-2.2-2-4-2-2.2 0-4 1.1-4 3 0 .8.3 1.5.8 2M4 12h16M8 20c.5 1.5 2.2 2 4 2 2.2 0 4-1.1 4-3 0-.8-.3-1.5-.8-2"
									/></svg
								>
							</button>

							<span class="bg-surface-border-strong mx-1 h-5 w-px"></span>

							<!-- H1 -->
							<button
								type="button"
								title="Heading 1"
								class="rounded px-1.5 py-1 text-xs font-bold transition-colors {isActive(
									'heading',
									{ level: 1 }
								)
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
							>
								H1
							</button>
							<!-- H2 -->
							<button
								type="button"
								title="Heading 2"
								class="rounded px-1.5 py-1 text-xs font-bold transition-colors {isActive(
									'heading',
									{ level: 2 }
								)
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
							>
								H2
							</button>
							<!-- H3 -->
							<button
								type="button"
								title="Heading 3"
								class="rounded px-1.5 py-1 text-xs font-bold transition-colors {isActive(
									'heading',
									{ level: 3 }
								)
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
							>
								H3
							</button>

							<span class="bg-surface-border-strong mx-1 h-5 w-px"></span>

							<!-- Bullet list -->
							<button
								type="button"
								title="Bullet list"
								class="rounded p-1.5 transition-colors {isActive('bulletList')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleBulletList().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
									/></svg
								>
							</button>
							<!-- Ordered list -->
							<button
								type="button"
								title="Ordered list"
								class="rounded p-1.5 transition-colors {isActive('orderedList')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleOrderedList().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M10 6h11M10 12h11M10 18h11"
									/><text
										x="2"
										y="8"
										fill="currentColor"
										font-size="7"
										font-weight="bold"
										stroke="none">1</text
									><text
										x="2"
										y="14"
										fill="currentColor"
										font-size="7"
										font-weight="bold"
										stroke="none">2</text
									><text
										x="2"
										y="20"
										fill="currentColor"
										font-size="7"
										font-weight="bold"
										stroke="none">3</text
									></svg
								>
							</button>

							<span class="bg-surface-border-strong mx-1 h-5 w-px"></span>

							<!-- Link -->
							<button
								type="button"
								title="Link"
								class="rounded p-1.5 transition-colors {isActive('link')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => setLink()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
									/></svg
								>
							</button>
							<!-- Blockquote -->
							<button
								type="button"
								title="Blockquote"
								class="rounded p-1.5 transition-colors {isActive('blockquote')
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().toggleBlockquote().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 10h4a1 1 0 011 1v4a1 1 0 01-1 1H3a1 1 0 01-1-1v-4a1 1 0 011-1zm0 0V7a4 4 0 014-4m7 7h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4a1 1 0 011-1zm0 0V7a4 4 0 014-4"
									/></svg
								>
							</button>

							<span class="bg-surface-border-strong mx-1 h-5 w-px"></span>

							<!-- Align left -->
							<button
								type="button"
								title="Align left"
								class="rounded p-1.5 transition-colors {isActive({ textAlign: 'left' })
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().setTextAlign('left').run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 6h18M3 12h12M3 18h18"
									/></svg
								>
							</button>
							<!-- Align center -->
							<button
								type="button"
								title="Align center"
								class="rounded p-1.5 transition-colors {isActive({ textAlign: 'center' })
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().setTextAlign('center').run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 6h18M6 12h12M3 18h18"
									/></svg
								>
							</button>
							<!-- Align right -->
							<button
								type="button"
								title="Align right"
								class="rounded p-1.5 transition-colors {isActive({ textAlign: 'right' })
									? 'bg-surface-border-strong/50 text-teal-400'
									: 'text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30'}"
								onclick={() => editor?.chain().focus().setTextAlign('right').run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M3 6h18M6 12h18M3 18h18"
									/></svg
								>
							</button>

							<span class="bg-surface-border-strong mx-1 h-5 w-px"></span>

							<!-- Clear formatting -->
							<button
								type="button"
								title="Clear formatting"
								class="text-text-tertiary hover:text-text-primary hover:bg-surface-border-strong/30 rounded p-1.5 transition-colors"
								onclick={() => editor?.chain().focus().clearNodes().unsetAllMarks().run()}
							>
								<svg
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
									/></svg
								>
							</button>
						</div>
					{/if}

					<!-- Editor content area -->
					<div bind:this={editorElement} class="tiptap-editor"></div>
				</div>

				<!-- Verification context notice -->
				<div
					class="border-surface-border-strong/50 bg-surface-overlay flex items-start gap-3 rounded-lg border px-4 py-3"
				>
					<svg
						class="mt-0.5 h-4 w-4 flex-shrink-0 text-teal-400"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
						/>
					</svg>
					<div>
						<p class="text-text-secondary text-xs font-medium">
							Verification context is cohort-bound
						</p>
						<p class="text-text-tertiary mt-0.5 text-xs">
							{#if verifiedFilter === 'verified'}
								This send can include an exact verified-cohort block because the recipient filter is
								constrained to verified people.
							{:else if verifiedFilter === 'unverified'}
								This send can include an exact unverified-cohort block. It will not imply proof
								weight the cohort does not carry.
							{:else}
								Mixed verification cohorts omit aggregate proof rather than approximate a number.
								Filter to verified people before claiming cohort-level proof.
							{/if}
						</p>
					</div>
				</div>

				{#if hasMergeFields && !FEATURES.EMAIL_CLIENT_DIRECT_MERGE}
					<div class="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3">
						<p class="text-xs font-medium text-amber-300">Browser-direct merge is draft-only</p>
						<p class="text-text-tertiary mt-1 text-xs">
							Preview resolves supported tokens with sample context. Browser-to-Lambda
							personalization needs the client merge runner, while server-side personalization still
							depends on the server dispatch runtime gate.
						</p>
					</div>
				{:else if hasMergeFields}
					<div class="rounded-md border border-teal-500/30 bg-teal-500/10 px-4 py-3">
						<p class="text-xs font-medium text-teal-300">
							Merge fields will personalize at send time
						</p>
						<p class="text-text-tertiary mt-1 text-xs">
							The browser decrypts each recipient, resolves supported tokens, and sends personalized
							messages one recipient at a time through the Lambda path.
						</p>
					</div>
				{/if}
			</div>
		</div>

		<!-- Sidebar: Filters + Actions -->
		<div class="space-y-6">
			<!-- Recipient filters -->
			<div
				id="email-recipients"
				class="border-surface-border bg-surface-base scroll-mt-24 space-y-4 rounded-md border p-6"
			>
				<div class="flex items-center justify-between">
					<h3 class="text-text-secondary text-sm font-medium">Recipients</h3>
				</div>

				<!-- Verification filter -->
				<div>
					<label for="verified" class="text-text-tertiary mb-1.5 block text-xs font-medium"
						>Verification Status</label
					>
					<select
						id="verified"
						bind:value={verifiedFilter}
						class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
					>
						<option value="any">Any status</option>
						<option value="verified">Verified only</option>
						<option value="unverified">Unverified only</option>
					</select>
				</div>

				<!-- Saved segment filter -->
				{#if data.segments.length > 0}
					<div>
						<p class="text-text-tertiary mb-1.5 text-xs font-medium">People segments</p>
						<div class="flex flex-wrap gap-2">
							{#each data.segments as segment (segment.id)}
								<button
									type="button"
									class="rounded-md border px-2.5 py-1 text-xs transition-colors {selectedSegmentIds.includes(
										segment.id
									)
										? 'border-teal-500/30 bg-teal-500/20 text-teal-400'
										: 'bg-surface-overlay text-text-tertiary border-surface-border-strong hover:border-text-quaternary'}"
									onclick={() => toggleSegment(segment.id)}
								>
									{segment.name}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Tag filter -->
				{#if data.tags.length > 0}
					<div>
						<p class="text-text-tertiary mb-1.5 text-xs font-medium">Tags</p>
						<div class="flex flex-wrap gap-2">
							{#each data.tags as tag (tag.id)}
								<button
									type="button"
									class="rounded-md border px-2.5 py-1 text-xs transition-colors {selectedTagIds.includes(
										tag.id
									)
										? 'border-teal-500/30 bg-teal-500/20 text-teal-400'
										: 'bg-surface-overlay text-text-tertiary border-surface-border-strong hover:border-text-quaternary'}"
									onclick={() => toggleTag(tag.id)}
								>
									{tag.name}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Recipient count -->
				<form
					method="POST"
					action="?/count"
					use:enhance={() => {
						countLoading = true;
						return async ({ result, update }) => {
							countLoading = false;
							if (result.type === 'success' && result.data && 'count' in result.data) {
								recipientCount = result.data.count as number;
								if ('sourceCounts' in result.data) {
									recipientSourceCounts = coerceRecipientSourceCounts(result.data.sourceCounts);
								}
							}
							await update({ reset: false });
						};
					}}
				>
					<input type="hidden" name="verified" value={verifiedFilter} />
					{#each selectedSegmentIds as segmentId}
						<input type="hidden" name="segmentIds" value={segmentId} />
					{/each}
					{#each selectedTagIds as tagId}
						<input type="hidden" name="tagIds" value={tagId} />
					{/each}
					<button
						type="submit"
						class="border-surface-border-strong bg-surface-overlay text-text-secondary hover:bg-surface-overlay hover:border-text-quaternary w-full rounded-lg border px-3 py-2 text-sm transition-colors"
						disabled={countLoading}
					>
						{#if countLoading}
							Counting...
						{:else}
							Update Count
						{/if}
					</button>
				</form>

				<div class="bg-surface-overlay rounded-lg px-4 py-3 text-center">
					<p class="text-text-primary font-mono text-2xl tabular-nums">
						{recipientCount.toLocaleString()}
					</p>
					<p class="text-text-tertiary mt-0.5 text-xs">subscribed recipients</p>
				</div>

				<div
					class="border-surface-border-strong/60 bg-surface-overlay rounded-lg border px-3 py-3"
					aria-label="Selected cohort source basis"
				>
					<div class="flex items-start justify-between gap-3">
						<div>
							<p class="text-text-secondary text-xs font-semibold">Source basis</p>
							<p class="text-text-tertiary mt-0.5 text-[11px]">
								Filtered People source counts, no plaintext identity.
							</p>
						</div>
						<span class="text-text-tertiary font-mono text-[11px]">
							<Datum
								value={platformRecipientSourceCount}
								cite="email.countRecipientsForFilter sourceCounts"
							/>
							platform
						</span>
					</div>
					{#if recipientSourceRows.length > 0}
						<div class="mt-3 grid gap-2">
							{#each recipientSourceRows.slice(0, 4) as row (row.source)}
								<div class="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 text-xs">
									<span class="text-text-tertiary truncate">{row.label}</span>
									<span class="text-text-primary font-mono tabular-nums">
										<Datum value={row.count} cite="selected cohort source count" />
									</span>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-text-tertiary mt-3 text-xs">
							No source counts are available for this selected cohort.
						</p>
					{/if}
				</div>
			</div>

			<!-- A/B Test Toggle -->
			{#if data.abTestingAllowed}
				<div
					id="email-ab-test"
					class="border-surface-border bg-surface-base scroll-mt-24 space-y-4 rounded-md border p-6"
				>
					<div class="flex items-center justify-between">
						<div>
							<h3 class="text-text-secondary text-sm font-medium">A/B Test</h3>
							<p class="text-text-tertiary mt-0.5 text-xs">
								Create linked variants; continuation is draft-only
							</p>
						</div>
						<button
							type="button"
							class="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 {abEnabled
								? 'bg-teal-500'
								: 'bg-text-quaternary'}"
							role="switch"
							aria-checked={abEnabled}
							aria-label="Toggle A/B draft variants"
							onclick={() => {
								abEnabled = !abEnabled;
								if (abEnabled) {
									subjectA = subject;
									subjectB = '';
									bodyHtmlA = bodyHtml;
									bodyHtmlB = '';
									activeVariant = 'A';
								} else {
									subject = subjectA || subject;
									bodyHtml = bodyHtmlA || bodyHtml;
								}
							}}
						>
							<span
								class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 {abEnabled
									? 'translate-x-4'
									: 'translate-x-0'}"
							></span>
						</button>
					</div>

					{#if abEnabled}
						<div class="border-surface-border space-y-3 border-t pt-2">
							<div>
								<label for="testGroupPct" class="text-text-tertiary mb-1 block text-xs font-medium"
									>Test group size</label
								>
								<select
									id="testGroupPct"
									bind:value={testGroupPct}
									class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
								>
									<option value={10}>10% test, 90% follow-up</option>
									<option value={20}>20% test, 80% follow-up</option>
									<option value={30}>30% test, 70% follow-up</option>
									<option value={50}>50% test, 50% follow-up</option>
								</select>
							</div>
							<div>
								<label for="splitPct" class="text-text-tertiary mb-1 block text-xs font-medium"
									>Test split (A/B)</label
								>
								<select
									id="splitPct"
									bind:value={splitPct}
									class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
								>
									<option value={50}>50 / 50</option>
									<option value={60}>60 / 40</option>
									<option value={70}>70 / 30</option>
								</select>
							</div>
							<div>
								<label for="testDuration" class="text-text-tertiary mb-1 block text-xs font-medium"
									>Winner check window</label
								>
								<select
									id="testDuration"
									bind:value={testDuration}
									class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
								>
									<option value="1h">1 hour</option>
									<option value="4h">4 hours</option>
									<option value="24h">24 hours</option>
								</select>
							</div>
							<div>
								<label for="winnerMetric" class="text-text-tertiary mb-1 block text-xs font-medium"
									>Pick winner by</label
								>
								<select
									id="winnerMetric"
									bind:value={winnerMetric}
									class="border-surface-border-strong bg-surface-raised text-text-primary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
								>
									<option value="open">Open rate</option>
									<option value="click">Click rate</option>
								</select>
							</div>
							<div class="bg-surface-overlay text-text-tertiary rounded-lg px-3 py-2.5 text-xs">
								{Math.round((recipientCount * testGroupPct) / 100)} in test group ({Math.round(
									(((recipientCount * testGroupPct) / 100) * splitPct) / 100
								)} A,
								{Math.round((((recipientCount * testGroupPct) / 100) * (100 - splitPct)) / 100)} B). Remainder
								{Math.round((recipientCount * (100 - testGroupPct)) / 100)} stays held as an exact continuation
								cohort.
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Actions -->
			<div
				id="email-delivery"
				class="border-surface-border bg-surface-base scroll-mt-24 space-y-3 rounded-md border p-6"
			>
				<div class="delivery-contract" aria-label="Email delivery capability contract">
					<div class="delivery-contract-head">
						<div>
							<p class="delivery-contract-kicker">Delivery contract</p>
							<h3 class="delivery-contract-title">Send only what is armed</h3>
						</div>
						<div class="delivery-contract-count">
							<Datum value={recipientCount} cite="recipient filter count" />
							<span>recipients</span>
						</div>
					</div>
					<div
						class="delivery-boundary"
						data-state={sendReadiness.state}
						aria-label="Shared email send readiness boundary"
					>
						<div class="delivery-boundary-main">
							<span class="delivery-boundary-kicker">shared readiness</span>
							<span class="delivery-boundary-summary">{sendBoundarySummary}</span>
						</div>
						<div class="delivery-boundary-facts">
							<span>
								<Datum value={sendReadiness.heldCount} cite="buildSendReadiness heldCount" />
								held
							</span>
							<span>{sendReadiness.heldModeSummary}</span>
							<span>{sendReadiness.browserDirectSignal}</span>
							<span>{sendBoundaryGateSummary}</span>
						</div>
					</div>
					<Ratio segments={deliverySegments} height={8} />
					<div class="delivery-contract-list">
						{#each deliveryContractRows as row (row.label)}
							<div class="delivery-contract-row" data-state={row.state}>
								<div class="delivery-contract-main">
									<span class="delivery-contract-name">{row.label}</span>
									<span class="delivery-contract-effect">{row.effect}</span>
								</div>
								<span class="delivery-contract-state">{deliveryStateLabel(row.state)}</span>
								<span class="delivery-contract-metric">
									<Datum value={row.metric.value} cite={row.metric.cite} />
									<span>{row.metric.label}</span>
								</span>
								<span class="delivery-contract-action">{deliveryActionLabel(row)}</span>
								<span class="delivery-contract-gate">{row.gate}</span>
							</div>
						{/each}
					</div>
				</div>

				<!-- Preview -->
				<form
					method="POST"
					action="?/preview"
					use:enhance={() => {
						return async ({ update }) => {
							await update({ reset: false });
							showPreview = true;
						};
					}}
				>
					<input type="hidden" name="subject" value={abEnabled ? subjectA : subject} />
					<input
						type="hidden"
						name="bodyHtml"
						value={abEnabled ? (activeVariant === 'A' ? bodyHtml : bodyHtmlA) : bodyHtml}
					/>
					<button
						type="submit"
						class="border-surface-border-strong bg-surface-overlay text-text-primary hover:bg-surface-overlay hover:border-text-quaternary w-full rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
						disabled={!hasBody}
					>
						Preview Email{abEnabled ? ` (${activeVariant})` : ''}
					</button>
				</form>

				{#if abEnabled}
					<!-- A/B Send -->
					<form
						method="POST"
						action="?/sendAbTest"
						use:enhance={({ cancel }) => {
							if (activeVariant === 'A') bodyHtmlA = bodyHtml;
							else bodyHtmlB = bodyHtml;
							if (
								!confirm(
									`Create A/B draft variants for ${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? '' : 's'}? The test cohort will be snapshotted; exact dispatch is controlled from the A/B detail runner when server dispatch is armed.`
								)
							) {
								cancel();
								return;
							}
							sending = true;
							if (browser) {
								try {
									localStorage.removeItem(draftKey);
								} catch {}
							}
							return async ({ update }) => {
								sending = false;
								await update({ reset: false });
							};
						}}
					>
						<input type="hidden" name="subjectA" value={subjectA} />
						<input type="hidden" name="subjectB" value={subjectB} />
						<input
							type="hidden"
							name="bodyHtmlA"
							value={activeVariant === 'A' ? bodyHtml : bodyHtmlA}
						/>
						<input
							type="hidden"
							name="bodyHtmlB"
							value={activeVariant === 'B' ? bodyHtml : bodyHtmlB}
						/>
						<input type="hidden" name="fromName" value={fromName} />
						<input type="hidden" name="fromEmail" value={fromEmail} />
						<input type="hidden" name="campaignId" value={campaignId} />
						<input type="hidden" name="verified" value={verifiedFilter} />
						<input type="hidden" name="splitPct" value={splitPct} />
						<input type="hidden" name="testGroupPct" value={testGroupPct} />
						<input type="hidden" name="testDuration" value={testDuration} />
						<input type="hidden" name="winnerMetric" value={winnerMetric} />
						{#each selectedSegmentIds as segmentId}
							<input type="hidden" name="segmentIds" value={segmentId} />
						{/each}
						{#each selectedTagIds as tagId}
							<input type="hidden" name="tagIds" value={tagId} />
						{/each}
						<button
							type="submit"
							class="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
							disabled={!canPublish ||
								!subjectA.trim() ||
								!subjectB.trim() ||
								recipientCount < 4 ||
								sending}
						>
							{#if sending}
								Creating A/B drafts...
							{:else if !canPublish}
								Editor role required
							{:else}
								Create A/B drafts
							{/if}
						</button>
						<p class="text-text-quaternary mt-2 text-center text-xs">
							This creates linked draft variants with exact test-cohort filters. Sent-sibling winner
							marking can create the held-back remainder draft; automated side effects remain gated
							by server dispatch.
						</p>
					</form>
				{:else if browserDirectExecutable}
					<!-- Client-Direct Send (<500 recipients, org key configured) -->
					{#if blastProgress && sending}
						<!-- Progress indicator -->
						<div class="space-y-3">
							<div class="flex items-center justify-between text-sm">
								<span class="text-text-secondary">
									{#if blastProgress.status === 'fetching-credentials'}
										Preparing credentials...
									{:else if blastProgress.status === 'decrypting'}
										Decrypting emails...
									{:else if blastProgress.status === 'sending'}
										Sending batch {blastProgress.currentBatch}/{blastProgress.totalBatches}...
									{:else if blastProgress.status === 'complete'}
										Complete
									{:else}
										Error
									{/if}
								</span>
								<span class="text-text-tertiary font-mono text-xs">
									{blastProgress.sent} sent, {blastProgress.failed} failed / {blastProgress.total}
								</span>
							</div>
							<div class="bg-surface-border-strong h-2 w-full rounded-full">
								<div
									class="h-2 rounded-full transition-all duration-300 {blastProgress.failed > 0
										? 'bg-amber-500'
										: 'bg-teal-500'}"
									style="width: {blastProgress.total > 0
										? Math.round(
												((blastProgress.sent + blastProgress.failed) / blastProgress.total) * 100
											)
										: 0}%"
								></div>
							</div>
						</div>
					{:else if blastResult}
						<!-- Result summary -->
						<div class="space-y-2">
							<div
								class="rounded-lg border px-4 py-3 {blastResult.failed === 0
									? 'border-teal-500/30 bg-teal-500/10'
									: 'border-amber-500/30 bg-amber-500/10'}"
							>
								<p
									class="text-sm font-medium {blastResult.failed === 0
										? 'text-teal-400'
										: 'text-amber-400'}"
								>
									{blastResult.sent} sent{blastResult.failed > 0
										? `, ${blastResult.failed} failed`
										: ''}
								</p>
							</div>
							<button
								type="button"
								class="border-surface-border-strong bg-surface-overlay text-text-primary hover:bg-surface-overlay hover:border-text-quaternary w-full rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
								onclick={() => goto(`/org/${data.org.slug}/emails`)}
							>
								Back to delivery records
							</button>
						</div>
					{:else}
						<form
							method="POST"
							action="?/createClientDraft"
							use:enhance={({ cancel }) => {
								if (
									!confirm(
										`Send email to ${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? '' : 's'}? Emails will be decrypted and sent from this browser.`
									)
								) {
									cancel();
									return;
								}
								sending = true;
								return async ({ result, update }) => {
									if (result.type === 'success' && result.data && 'blastId' in result.data) {
										const blastData = result.data as {
											blastId: string;
											orgId: string;
											fromEmail: string;
											fromName: string;
											subject: string;
											bodyHtml: string;
										};
										sending = false;
										await startClientDirectSend(blastData);
									} else {
										sending = false;
										await update({ reset: false });
									}
								};
							}}
						>
							<input type="hidden" name="subject" value={subject} />
							<input type="hidden" name="bodyHtml" value={bodyHtml} />
							<input type="hidden" name="fromName" value={fromName} />
							<input type="hidden" name="fromEmail" value={fromEmail} />
							<input type="hidden" name="campaignId" value={campaignId} />
							<input type="hidden" name="verified" value={verifiedFilter} />
							{#each selectedSegmentIds as segmentId}
								<input type="hidden" name="segmentIds" value={segmentId} />
							{/each}
							{#each selectedTagIds as tagId}
								<input type="hidden" name="tagIds" value={tagId} />
							{/each}
							<button
								type="submit"
								class="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
								disabled={!subject.trim() ||
									!hasBody ||
									!canPublish ||
									recipientCount === 0 ||
									sending ||
									mergeFieldsBlockClientSend}
							>
								{#if sending}
									Preparing...
								{:else if !canPublish}
									Editor role required
								{:else if mergeFieldsBlockClientSend}
									Remove merge fields to send
								{:else}
									Send email to {recipientCount.toLocaleString()} recipient{recipientCount === 1
										? ''
										: 's'}
								{/if}
							</button>
							{#if blastError}
								<div
									class="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
								>
									{blastError}
								</div>
							{/if}
							<p class="text-text-quaternary mt-2 text-center text-xs">
								Emails decrypted in this browser, never on our servers
							</p>
						</form>
					{/if}
				{:else}
					<!-- Server-side dispatch queues only when runtime dependencies are present. -->
					<form
						method="POST"
						action="?/send"
						use:enhance={({ cancel }) => {
							const verb = serverDispatchRuntimeArmed ? 'Send email' : 'Create delivery draft';
							const note = serverDispatchRuntimeArmed
								? 'Each email includes your verification proof.'
								: 'It will not send until server-side email runtime dependencies are ready.';
							if (
								!confirm(
									`${verb} for ${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? '' : 's'}? ${note}`
								)
							) {
								cancel();
								return;
							}
							sending = true;
							if (browser) {
								try {
									localStorage.removeItem(draftKey);
								} catch {}
							}
							return async ({ update }) => {
								sending = false;
								await update({ reset: false });
							};
						}}
					>
						<input type="hidden" name="subject" value={subject} />
						<input type="hidden" name="bodyHtml" value={bodyHtml} />
						<input type="hidden" name="fromName" value={fromName} />
						<input type="hidden" name="fromEmail" value={fromEmail} />
						<input type="hidden" name="campaignId" value={campaignId} />
						<input type="hidden" name="verified" value={verifiedFilter} />
						{#each selectedSegmentIds as segmentId}
							<input type="hidden" name="segmentIds" value={segmentId} />
						{/each}
						{#each selectedTagIds as tagId}
							<input type="hidden" name="tagIds" value={tagId} />
						{/each}
						<button
							type="submit"
							class="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
							disabled={!subject.trim() ||
								!hasBody ||
								!canPublish ||
								recipientCount === 0 ||
								sending}
						>
							{#if sending}
								{serverDispatchRuntimeArmed ? 'Sending...' : 'Creating draft...'}
							{:else if !canPublish}
								Editor role required
							{:else}
								{serverDispatchRuntimeArmed
									? `Send email to ${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? '' : 's'}`
									: 'Create delivery draft'}
							{/if}
						</button>
						{#if !serverDispatchRuntimeArmed}
							<p class="text-text-quaternary mt-2 text-center text-xs">
								Server-side dispatch is dependency-bound in this runtime. This stores a draft; it
								does not send.
							</p>
						{:else if recipientCount >= CLIENT_DIRECT_THRESHOLD}
							<p class="text-text-quaternary mt-2 text-center text-xs">
								Large blast -- will be processed via our server-side delivery worker
								(hardware-isolated enclave is on the roadmap)
							</p>
						{/if}
					</form>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.studio-handoff-contract {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		border: 1px solid oklch(0.72 0.11 180 / 0.42);
		border-radius: 0.5rem;
		background: var(--surface-base, oklch(0.993 0.003 60));
		padding: 1rem;
	}

	.studio-handoff-contract[data-state='draft-only'] {
		border-color: oklch(0.78 0.12 82 / 0.62);
		background: oklch(0.985 0.006 70);
	}

	.studio-handoff-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.studio-handoff-main {
		display: grid;
		gap: 0.2rem;
		min-width: 0;
	}

	.studio-handoff-kicker,
	.studio-handoff-counts,
	.studio-handoff-facts,
	.studio-handoff-row-state,
	.studio-handoff-row-action,
	.studio-handoff-row-metric,
	.studio-handoff-discard {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.2;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.studio-handoff-kicker,
	.studio-handoff-facts,
	.studio-handoff-row-state {
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.studio-handoff-title {
		margin: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.95rem;
		font-weight: 750;
		line-height: 1.25;
	}

	.studio-handoff-copy {
		margin: 0;
		color: var(--text-secondary, oklch(0.42 0.015 60));
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.78rem;
		line-height: 1.4;
	}

	.studio-handoff-counts {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.45rem;
		color: var(--text-secondary, oklch(0.42 0.015 60));
		text-align: right;
	}

	.studio-handoff-counts span,
	.studio-handoff-row-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
	}

	.studio-handoff-facts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.75rem;
	}

	.studio-handoff-list {
		display: grid;
		gap: 0.25rem;
	}

	.studio-handoff-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.35rem;
		padding: 0.625rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.72));
	}

	@media (min-width: 860px) {
		.studio-handoff-row {
			grid-template-columns: minmax(10rem, 1fr) 5.25rem 7.75rem auto minmax(0, 1.15fr);
			align-items: baseline;
		}
	}

	.studio-handoff-row-main {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
	}

	.studio-handoff-row-name {
		color: var(--text-primary, oklch(0.25 0.01 60));
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.25;
	}

	.studio-handoff-row-effect,
	.studio-handoff-row-cluster,
	.studio-handoff-row-gate {
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.72rem;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}

	.studio-handoff-row-cluster {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.58rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.studio-handoff-row-action {
		color: oklch(0.5 0.012 60);
		text-transform: none;
		letter-spacing: 0;
		white-space: nowrap;
	}

	.studio-handoff-row[data-state='live'] .studio-handoff-row-state,
	.studio-handoff-row[data-state='live'] .studio-handoff-row-action {
		color: var(--coord-verified, #10b981);
	}

	.studio-handoff-row[data-state='partial'] .studio-handoff-row-state,
	.studio-handoff-row[data-state='partial'] .studio-handoff-row-action {
		color: var(--coord-route-solid, #3bc4b8);
	}

	.studio-handoff-row[data-state='draft-only'] {
		border-top-style: dashed;
	}

	.studio-handoff-row[data-state='draft-only'] .studio-handoff-row-state,
	.studio-handoff-row[data-state='draft-only'] .studio-handoff-row-action {
		color: oklch(0.62 0.12 78);
	}

	.studio-handoff-row[data-state='gated'] {
		border-top-style: dashed;
	}

	.studio-handoff-row[data-state='gated'] .studio-handoff-row-state,
	.studio-handoff-row[data-state='gated'] .studio-handoff-row-action {
		color: oklch(0.48 0.02 60);
	}

	.studio-handoff-discard {
		align-self: flex-start;
		border: 0;
		background: transparent;
		padding: 0;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		cursor: pointer;
		letter-spacing: 0;
		text-transform: none;
	}

	.studio-handoff-discard:hover,
	.studio-handoff-discard:focus-visible {
		color: var(--text-secondary, oklch(0.42 0.015 60));
		outline: none;
	}

	@media (max-width: 640px) {
		.studio-handoff-top {
			flex-direction: column;
		}

		.studio-handoff-counts {
			justify-content: flex-start;
			text-align: left;
		}

		.studio-handoff-row-action {
			white-space: normal;
		}
	}

	.delivery-contract {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding-bottom: 0.875rem;
		border-bottom: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
	}

	.delivery-contract-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}

	.delivery-contract-kicker,
	.delivery-boundary-kicker,
	.delivery-contract-state,
	.delivery-contract-action {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1.2;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.delivery-contract-kicker {
		color: oklch(0.52 0.012 250);
	}

	.delivery-boundary {
		display: grid;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.78));
		border-radius: 0.5rem;
		background: var(--surface-overlay, oklch(0.96 0.006 65));
	}

	.delivery-boundary[data-state='draft-only'],
	.delivery-boundary[data-state='gated'] {
		border-style: dashed;
	}

	.delivery-boundary-main {
		display: grid;
		gap: 0.2rem;
	}

	.delivery-boundary-kicker {
		color: oklch(0.52 0.012 250);
	}

	.delivery-boundary-summary {
		font-size: 0.78rem;
		font-weight: 650;
		line-height: 1.35;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.delivery-boundary-facts {
		display: grid;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		line-height: 1.35;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	@media (min-width: 860px) {
		.delivery-boundary {
			grid-template-columns: minmax(0, 1fr) minmax(11rem, 0.8fr);
			align-items: start;
		}
	}

	.delivery-contract-title {
		margin: 0.125rem 0 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.95rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.delivery-contract-count,
	.delivery-contract-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
		white-space: nowrap;
	}

	.delivery-contract-list {
		display: grid;
		gap: 0.25rem;
	}

	.delivery-contract-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.35rem;
		padding: 0.625rem 0;
		border-top: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.72));
	}

	@media (min-width: 860px) {
		.delivery-contract-row {
			grid-template-columns: minmax(10rem, 1fr) 5.25rem 7.75rem auto minmax(0, 1.15fr);
			align-items: baseline;
		}
	}

	.delivery-contract-main {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.15rem;
	}

	.delivery-contract-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 700;
		line-height: 1.25;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	.delivery-contract-effect,
	.delivery-contract-gate {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.72rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.56 0.012 60));
	}

	.delivery-contract-action {
		color: oklch(0.5 0.012 60);
		text-transform: none;
		letter-spacing: 0;
		white-space: nowrap;
	}

	.delivery-contract-row[data-state='live'] .delivery-contract-state,
	.delivery-contract-row[data-state='live'] .delivery-contract-action {
		color: var(--coord-verified, #10b981);
	}

	.delivery-contract-row[data-state='partial'] .delivery-contract-state,
	.delivery-contract-row[data-state='partial'] .delivery-contract-action {
		color: var(--coord-route-solid, #3bc4b8);
	}

	.delivery-contract-row[data-state='draft-only'] {
		border-top-style: dashed;
	}

	.delivery-contract-row[data-state='draft-only'] .delivery-contract-state,
	.delivery-contract-row[data-state='draft-only'] .delivery-contract-action {
		color: oklch(0.62 0.12 78);
	}

	.delivery-contract-row[data-state='gated'] {
		border-top-style: dashed;
	}

	.delivery-contract-row[data-state='gated'] .delivery-contract-state,
	.delivery-contract-row[data-state='gated'] .delivery-contract-action {
		color: oklch(0.48 0.02 60);
	}

	/* Tiptap ProseMirror editor styles */
	:global(.tiptap-editor .ProseMirror) {
		min-height: 18rem;
		padding: 0.75rem 1rem;
		font-size: 0.875rem;
		line-height: 1.625;
		color: var(--text-primary);
		outline: none;
	}

	:global(.tiptap-editor .ProseMirror p) {
		margin-bottom: 0.5rem;
	}

	:global(.tiptap-editor .ProseMirror h1) {
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 0.75rem;
		margin-top: 1rem;
		line-height: 1.25;
	}

	:global(.tiptap-editor .ProseMirror h2) {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 0.5rem;
		margin-top: 0.75rem;
		line-height: 1.3;
	}

	:global(.tiptap-editor .ProseMirror h3) {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--text-secondary);
		margin-bottom: 0.5rem;
		margin-top: 0.75rem;
		line-height: 1.4;
	}

	:global(.tiptap-editor .ProseMirror ul) {
		list-style-type: disc;
		padding-left: 1.5rem;
		margin-bottom: 0.5rem;
	}

	:global(.tiptap-editor .ProseMirror ol) {
		list-style-type: decimal;
		padding-left: 1.5rem;
		margin-bottom: 0.5rem;
	}

	:global(.tiptap-editor .ProseMirror li) {
		margin-bottom: 0.25rem;
	}

	:global(.tiptap-editor .ProseMirror blockquote) {
		border-left: 3px solid var(--surface-border-strong);
		padding-left: 1rem;
		color: var(--text-tertiary);
		margin: 0.75rem 0;
		font-style: italic;
	}

	:global(.tiptap-editor .ProseMirror a) {
		color: #2dd4bf; /* teal-400 */
		text-decoration: underline;
	}

	:global(.tiptap-editor .ProseMirror code) {
		background: var(--surface-overlay);
		border-radius: 0.25rem;
		padding: 0.15rem 0.35rem;
		font-size: 0.8em;
		font-family: ui-monospace, monospace;
		color: var(--text-secondary);
	}

	:global(.tiptap-editor .ProseMirror pre) {
		background: var(--surface-raised);
		border: 1px solid var(--surface-border-strong);
		border-radius: 0.5rem;
		padding: 0.75rem 1rem;
		margin: 0.75rem 0;
		overflow-x: auto;
	}

	:global(.tiptap-editor .ProseMirror pre code) {
		background: none;
		padding: 0;
		border-radius: 0;
	}

	:global(.tiptap-editor .ProseMirror hr) {
		border: none;
		border-top: 1px solid var(--surface-border-strong);
		margin: 1rem 0;
	}

	/* Placeholder */
	:global(.tiptap-editor .ProseMirror p.is-editor-empty:first-child::before) {
		content: 'Write your email content here...';
		float: left;
		color: var(--text-quaternary);
		pointer-events: none;
		height: 0;
	}
</style>
