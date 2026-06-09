<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import {
		PEOPLE_IMPORT_FIELD_ALIASES,
		detectPlatformExportProfile,
		normalizePlatformExportHeader,
		type PlatformExportProfile
	} from '$lib/data/platform-export-profiles';
	import { formatCapabilityClusters } from '$lib/data/capability-clusters';
	import {
		buildPlatformIntakeReadiness,
		buildPeopleSourceProvenanceReadiness,
		formatGateEvidence,
		getGateEvidence,
		type PlatformIntakeProfileRow,
		type PlatformIntakeStageRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateRatioSegments
	} from '$lib/data/capability-state-labels';
	import { Datum, Ratio } from '$lib/design';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// ── Wizard state ──────────────────────────────────────────
	type Step = 'upload' | 'mapping' | 'confirm';
	type IntakeCapabilityState = 'live' | 'partial' | 'draft-only' | 'gated';
	type IntakeContractRow = {
		label: string;
		state: IntakeCapabilityState;
		phase: string;
		cluster: string;
		action: string;
		effect: string;
		gate: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};
	type IntakePressureReadout = {
		id: 'recognized-exports' | 'source-custody' | 'direct-sync-boundary';
		label: string;
		title: string;
		state: IntakeCapabilityState;
		href: string;
		action: string;
		detail: string;
		gate: string;
		source: string;
		metric: {
			value: number | null;
			label: string;
			cite: string;
		};
	};
	let step = $state<Step>('upload');

	// ── Upload state ──────────────────────────────────────────
	let file = $state<File | null>(null);
	let dragOver = $state(false);
	let parseError = $state<string | null>(null);

	// ── Parsed data ───────────────────────────────────────────
	let headers = $state<string[]>([]);
	let rows = $state<string[][]>([]);

	// ── Column mapping ────────────────────────────────────────
	let columnMapping = $state<Record<number, string>>({});
	let detectedPlatform = $state<PlatformExportProfile | null>(null);

	// ── Import state ──────────────────────────────────────────
	let importing = $state(false);

	// ── Available mapping targets ─────────────────────────────
	const FIELD_OPTIONS = [
		{ value: 'skip', label: 'Skip' },
		{ value: 'email', label: 'Email' },
		{ value: 'name', label: 'Full Name' },
		{ value: 'first_name', label: 'First Name' },
		{ value: 'last_name', label: 'Last Name' },
		{ value: 'postalCode', label: 'Postal Code' },
		{ value: 'stateCode', label: 'State / Province Code' },
		{ value: 'congressionalDistrict', label: 'Congressional District' },
		{ value: 'phone', label: 'Phone' },
		{ value: 'country', label: 'Country' },
		{ value: 'tags', label: 'Tags' },
		{ value: 'can_message', label: 'Email consent / status' },
		{ value: 'sms_consent', label: 'SMS consent / status' },
		{ value: 'email_consent_source', label: 'Email consent source' },
		{ value: 'email_consented_at', label: 'Email consent date' },
		{ value: 'email_consent_text', label: 'Email consent text' },
		{ value: 'sms_consent_source', label: 'SMS consent source' },
		{ value: 'sms_consented_at', label: 'SMS consent date' },
		{ value: 'sms_consent_text', label: 'SMS consent text' },
		{ value: 'custom', label: 'Encrypted custom field' }
	];

	// ── Derived values ────────────────────────────────────────
	const previewRows = $derived(rows.slice(0, 5));
	const totalRows = $derived(rows.length);
	const mappedFields = $derived(Object.values(columnMapping).filter((v) => v !== 'skip'));
	const hasEmailMapping = $derived(mappedFields.includes('email'));
	const customFieldColumnCount = $derived(
		mappedFields.filter((field) => field === 'custom').length
	);
	const consentEvidenceColumnCount = $derived(
		mappedFields.filter((field) =>
			[
				'can_message',
				'sms_consent',
				'email_consent_source',
				'email_consented_at',
				'email_consent_text',
				'sms_consent_source',
				'sms_consented_at',
				'sms_consent_text'
			].includes(field)
		).length
	);
	const platformApiGate = getGateEvidence('CP-platform-api-sync', ['T1-3'], {
		name: 'Direct platform sync',
		downstream: 1,
		dependency: 'Encrypted credential custody + direct sync execution'
	});
	const platformApiSync = $derived(data.spaces.operating?.platformApiSync ?? null);
	const platformIntakeReadiness = $derived(
		buildPlatformIntakeReadiness({
			base: `/org/${data.org.slug}`,
			platformApiGate,
			platformApiSync
		})
	);
	const peopleSourceProvenanceReadiness = $derived(
		buildPeopleSourceProvenanceReadiness({
			base: `/org/${data.org.slug}`,
			sourceCounts: data.spaces.base?.sourceCounts ?? null,
			totalPeople: data.spaces.base?.total ?? null,
			platformApiGate
		})
	);
	const platformProfileRows = $derived<PlatformIntakeProfileRow[]>(platformIntakeReadiness.rows);
	const platformIntakeStageRows = $derived<PlatformIntakeStageRow[]>(
		platformIntakeReadiness.stageRows
	);
	const platformExportProfileCount = $derived(platformIntakeReadiness.profileCount);
	const platformProfileStateCounts = $derived(
		platformProfileRows
			.flatMap((row) => [row.csvState, row.apiState])
			.reduce(
				(acc, state) => {
					acc[state] += 1;
					return acc;
				},
				{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<IntakeCapabilityState, number>
			)
	);
	const platformProfileSegments = $derived(
		operatorCapabilityStateRatioSegments(platformProfileStateCounts, {
			labelSuffix: ' source-custody contracts'
		})
	);
	const exportRecognitionStage = $derived(
		platformIntakeStageRows.find((row) => row.id === 'export-recognition') ?? null
	);
	const directPlatformSyncStage = $derived(
		platformIntakeStageRows.find((row) => row.id === 'direct-api-runner') ?? null
	);
	const intakePressureReadouts = $derived<IntakePressureReadout[]>([
		{
			id: 'recognized-exports',
			label: 'Recognized exports',
			title: `${platformIntakeReadiness.csvContractCount}/${platformIntakeReadiness.profileCount} CSV contracts`,
			state: exportRecognitionStage?.state ?? platformIntakeReadiness.state,
			href: exportRecognitionStage?.href ?? `/org/${data.org.slug}/supporters/import#csv-intake`,
			action: exportRecognitionStage?.action ?? 'upload CSV export',
			detail:
				exportRecognitionStage?.effect ??
				`${platformIntakeReadiness.csvContractCount} CSV source-custody contracts preserve origin and header evidence across recognized exports.`,
			gate:
				exportRecognitionStage?.gate ?? 'Export-header recognition is armed for CSV export intake.',
			source: 'buildPlatformIntakeReadiness',
			metric: {
				value: platformIntakeReadiness.csvContractCount,
				label: 'CSV contracts',
				cite: 'buildPlatformIntakeReadiness'
			}
		},
		{
			id: 'source-custody',
			label: 'Source custody',
			title: peopleSourceProvenanceReadiness.signal,
			state: peopleSourceProvenanceReadiness.state,
			href: peopleSourceProvenanceReadiness.href,
			action: peopleSourceProvenanceReadiness.action,
			detail: peopleSourceProvenanceReadiness.detail,
			gate: peopleSourceProvenanceReadiness.gate,
			source: 'buildPeopleSourceProvenanceReadiness',
			metric: {
				value: peopleSourceProvenanceReadiness.platformProfilePeopleCount,
				label: 'profile-origin people',
				cite: 'supporters.getSummaryStats.sourceCounts'
			}
		},
		{
			id: 'direct-sync-boundary',
			label: 'Direct sync boundary',
			title: directPlatformSyncStage?.handoff ?? 'Direct sync execution',
			state: directPlatformSyncStage?.state ?? platformIntakeReadiness.state,
			href:
				directPlatformSyncStage?.href ??
				`/org/${data.org.slug}/supporters/import/platform-api#platform-sync-boundary`,
			action: directPlatformSyncStage?.action ?? 'read sync boundary',
			detail:
				directPlatformSyncStage?.effect ??
				`${platformIntakeReadiness.apiBoundaryCount} direct sync paths remain dependency-first.`,
			gate: directPlatformSyncStage?.gate ?? platformIntakeReadiness.gate,
			source: 'getPlatformApiSyncReadiness',
			metric: {
				value: platformIntakeReadiness.apiBoundaryCount,
				label: 'sync boundaries',
				cite: 'buildPlatformIntakeReadiness'
			}
		}
	]);
	const detectedSourceLabel = $derived(
		detectedPlatform?.label ?? (headers.length > 0 ? 'CSV / unknown export' : 'No file loaded')
	);
	const batchCount = $derived(totalRows > 0 ? Math.ceil(totalRows / 100) : 0);
	const intakeContractRows = $derived<IntakeContractRow[]>([
		{
			label: 'Export recognition',
			state: 'live',
			phase: 'GROUND',
			cluster: 'C-data-sovereignty / C-reach',
			action: 'recognize export',
			effect: `${platformIntakeReadiness.signal} can be detected from headers; unknown CSV remains importable through manual mapping.`,
			gate: platformIntakeReadiness.boundary,
			metric: {
				value: platformExportProfileCount,
				label: 'recognized profiles',
				cite: 'src/lib/data/platform-export-profiles.ts'
			}
		},
		{
			label: 'Person key',
			state: hasEmailMapping ? 'live' : 'gated',
			phase: 'GROUND',
			cluster: 'C-reach / C-data-sovereignty',
			action: hasEmailMapping ? 'import people' : 'map email',
			effect: hasEmailMapping
				? 'An email column is mapped, so rows can become People records.'
				: 'No person record is imported until an email column is mapped.',
			gate: hasEmailMapping
				? 'Email key mapped for this file.'
				: 'Map at least one column to Email before import.',
			metric: {
				value: hasEmailMapping ? 1 : 0,
				label: 'email key',
				cite: 'columnMapping'
			}
		},
		{
			label: 'Source custody',
			state: headers.length > 0 ? 'live' : 'partial',
			phase: 'GROUND',
			cluster: 'C-data-sovereignty / C-composability',
			action: 'preserve source',
			effect: `${detectedSourceLabel} will be stored as People source metadata; consent columns use strictest-wins merging.`,
			gate: 'Imported people keep source custody; custom field typing and >5,000-row resume remain outside this path.',
			metric: {
				value: detectedPlatform ? 1 : headers.length > 0 ? 0 : null,
				label: 'detected profile',
				cite: 'detectPlatformExportProfile'
			}
		},
		{
			label: 'Consent evidence custody',
			state:
				consentEvidenceColumnCount > 0 ? 'partial' : headers.length > 0 ? 'draft-only' : 'gated',
			phase: 'GROUND',
			cluster: 'C-reach / C-data-sovereignty',
			action: consentEvidenceColumnCount > 0 ? 'preserve consent evidence' : 'map consent evidence',
			effect:
				consentEvidenceColumnCount > 0
					? `${consentEvidenceColumnCount} consent status/source/date/text columns will be carried into aggregate reach evidence.`
					: headers.length > 0
						? 'Consent can be imported as status plus source/date/text evidence; phone numbers alone are never treated as opt-in.'
						: 'Upload an export before mapping consent status or evidence columns.',
			gate: 'Consent evidence is custody ground for reach claims; it is not double opt-in, statutory legal advice, or carrier-dispatch permission by itself.',
			metric: {
				value: consentEvidenceColumnCount || null,
				label: 'consent columns',
				cite: 'columnMapping consent evidence'
			}
		},
		{
			label: 'Custom field custody',
			state: customFieldColumnCount > 0 ? 'live' : headers.length > 0 ? 'partial' : 'gated',
			phase: 'GROUND',
			cluster: 'C-data-sovereignty',
			action: customFieldColumnCount > 0 ? 'preserve fields' : 'map custom fields',
			effect:
				customFieldColumnCount > 0
					? `${customFieldColumnCount} columns will be sealed as encrypted custom-field JSON on each imported person.`
					: headers.length > 0
						? 'Platform-specific columns stay skipped unless marked as encrypted custom fields.'
						: 'Upload an export before choosing which nonstandard columns Commons should preserve.',
			gate:
				customFieldColumnCount > 0
					? 'Custom fields are custody-only: no field typing, segmentation, or schema governance is claimed.'
					: 'Choose Encrypted custom field for columns Commons should carry forward.',
			metric: {
				value: customFieldColumnCount || null,
				label: 'custom columns',
				cite: 'columnMapping custom'
			}
		},
		{
			label: 'Encrypted batch write',
			state: totalRows > 0 && hasEmailMapping ? 'live' : 'gated',
			phase: 'GROUND',
			cluster: 'C-verification / C-data-sovereignty',
			action: totalRows > 0 && hasEmailMapping ? 'write batches' : 'prepare import',
			effect:
				'Rows write through supporters.importWithEncryption in 100-row batches after mapping and validation.',
			gate:
				totalRows > 0 && hasEmailMapping
					? 'Editor role, valid file, mapped email, and encrypted supporter write path are present.'
					: 'Upload a CSV and map Email before the encrypted write path is armed.',
			metric: {
				value: batchCount || null,
				label: '100-row batches',
				cite: 'BATCH_SIZE'
			}
		},
		{
			label: 'Direct platform sync',
			state: 'gated',
			phase: 'GROUND',
			cluster: 'C-composability / C-data-sovereignty',
			action: 'read sync boundary',
			effect: platformIntakeReadiness.futureLift,
			gate: platformIntakeReadiness.gate,
			metric: {
				value: null,
				label: 'sync boundaries',
				cite: 'CP-platform-api-sync'
			}
		}
	]);
	const intakeStateCounts = $derived(
		intakeContractRows.reduce(
			(acc, row) => {
				acc[row.state] += 1;
				return acc;
			},
			{ live: 0, partial: 0, 'draft-only': 0, gated: 0 } as Record<IntakeCapabilityState, number>
		)
	);
	const intakeStateSegments = $derived(operatorCapabilityStateRatioSegments(intakeStateCounts));

	const fileSizeDisplay = $derived(() => {
		if (!file) return '';
		const bytes = file.size;
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	});

	// ── Simple client-side CSV parser ─────────────────────────
	function clientParseCSV(text: string): { headers: string[]; rows: string[][] } {
		// Strip BOM
		const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

		const result: string[][] = [];
		let row: string[] = [];
		let field = '';
		let inQuotes = false;
		let i = 0;

		while (i < input.length) {
			const ch = input[i];
			if (inQuotes) {
				if (ch === '"') {
					if (i + 1 < input.length && input[i + 1] === '"') {
						field += '"';
						i += 2;
					} else {
						inQuotes = false;
						i++;
					}
				} else {
					field += ch;
					i++;
				}
			} else {
				if (ch === '"') {
					inQuotes = true;
					i++;
				} else if (ch === ',') {
					row.push(field);
					field = '';
					i++;
				} else if (ch === '\r') {
					row.push(field);
					field = '';
					if (row.length > 0) result.push(row);
					row = [];
					i++;
					if (i < input.length && input[i] === '\n') i++;
				} else if (ch === '\n') {
					row.push(field);
					field = '';
					if (row.length > 0) result.push(row);
					row = [];
					i++;
				} else {
					field += ch;
					i++;
				}
			}
		}
		if (field || row.length > 0) {
			row.push(field);
			result.push(row);
		}

		if (result.length === 0) return { headers: [], rows: [] };
		const hdrs = result[0].map((h) => h.trim());
		const dataRows = result.slice(1).filter((r) => r.some((c) => c.trim() !== ''));
		return { headers: hdrs, rows: dataRows };
	}

	// ── File handling ─────────────────────────────────────────
	function handleFile(f: File) {
		if (!f.name.toLowerCase().endsWith('.csv')) {
			parseError = 'Please select a .csv file.';
			return;
		}
		if (f.size > 10 * 1024 * 1024) {
			parseError = 'File too large. Maximum size is 10MB.';
			return;
		}

		file = f;
		parseError = null;

		const reader = new FileReader();
		reader.onload = (e) => {
			const text = e.target?.result as string;
			if (!text) {
				parseError = 'Could not read file.';
				return;
			}

			const parsed = clientParseCSV(text);
			if (parsed.headers.length === 0) {
				parseError = 'CSV appears to be empty.';
				return;
			}
			if (parsed.rows.length === 0) {
				parseError = 'CSV has headers but no data rows.';
				return;
			}

			headers = parsed.headers;
			rows = parsed.rows;

			// Auto-detect mappings
			const mapping: Record<number, string> = {};
			for (let i = 0; i < parsed.headers.length; i++) {
				const normalized = normalizePlatformExportHeader(parsed.headers[i]);
				const match = PEOPLE_IMPORT_FIELD_ALIASES[normalized];
				mapping[i] = match ?? 'skip';
			}
			columnMapping = mapping;

			detectedPlatform = detectPlatformExportProfile(parsed.headers);

			step = 'mapping';
		};
		reader.onerror = () => {
			parseError = 'Error reading file.';
		};
		reader.readAsText(f);
	}

	function onFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		const f = input.files?.[0];
		if (f) handleFile(f);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		const f = e.dataTransfer?.files[0];
		if (f) handleFile(f);
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
	}

	function onDragLeave() {
		dragOver = false;
	}

	// ── Mapping helpers ───────────────────────────────────────
	function updateMapping(index: number, value: string) {
		columnMapping = { ...columnMapping, [index]: value };
	}

	function preserveUnmappedAsCustomFields() {
		const next = { ...columnMapping };
		for (let i = 0; i < headers.length; i++) {
			if (!next[i] || next[i] === 'skip') next[i] = 'custom';
		}
		columnMapping = next;
	}

	function getMappingLabel(field: string): string {
		return FIELD_OPTIONS.find((o) => o.value === field)?.label ?? field;
	}

	function stateLabel(state: IntakeCapabilityState): string {
		return operatorCapabilityStateLabel(state);
	}

	function actionFor(state: IntakeCapabilityState, action: string): string {
		return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });
	}

	function actionLabel(row: IntakeContractRow): string {
		return actionFor(row.state, row.action);
	}

	// ── Navigation ────────────────────────────────────────────
	function goToUpload() {
		step = 'upload';
		file = null;
		headers = [];
		rows = [];
		columnMapping = {};
		detectedPlatform = null;
		parseError = null;
	}

	function goToConfirm() {
		step = 'confirm';
	}

	function goToMapping() {
		step = 'mapping';
	}

	// Attach file to hidden input when on confirm step
	onMount(() => {
		return $effect.root(() => {
			$effect(() => {
				if (step === 'confirm' && file && !form?.success) {
					const input = document.getElementById('hidden-csv-input') as HTMLInputElement;
					if (input && file) {
						const dt = new DataTransfer();
						dt.items.add(file);
						input.files = dt.files;
					}
				}
			});
		});
	});
</script>

<div class="space-y-6">
	<!-- Header -->
	<div>
		<nav class="text-text-tertiary mb-4 flex items-center gap-2 text-sm">
			<a href="/org/{data.org.slug}/supporters" class="hover:text-text-secondary transition-colors">
				People ledger
			</a>
			<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
			</svg>
			<span class="text-text-tertiary">Import</span>
		</nav>
		<h1 class="text-text-primary text-xl font-semibold">Import people</h1>
		<p class="text-text-tertiary mt-1 text-sm">
			Bring people into Commons through the shipped CSV path; platform APIs stay visibly gated.
		</p>
	</div>

	<section
		class="border-surface-border bg-surface-base space-y-4 rounded-md border p-5"
		aria-label="People import capability contract"
	>
		<div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
			<div>
				<p class="text-text-tertiary font-mono text-xs tracking-wider uppercase">Import contract</p>
				<h2 class="text-text-primary mt-1 text-base font-semibold">
					Exports become source custody
				</h2>
				<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
					{platformIntakeReadiness.effect}
					{platformIntakeReadiness.boundary}
				</p>
				<a
					href="/org/{data.org.slug}/supporters/import/platform-api"
					class="text-text-secondary hover:text-text-primary mt-3 inline-flex text-sm font-semibold transition-colors"
				>
					Read sync boundary
				</a>
			</div>
			<div class="flex items-center gap-4">
				<span class="text-text-tertiary flex items-baseline gap-1.5 font-mono text-xs">
					<Datum value={platformExportProfileCount} cite="PLATFORM_EXPORT_PROFILES.length" />
					<span>profiles</span>
				</span>
				<span class="text-text-tertiary flex items-baseline gap-1.5 font-mono text-xs">
					<Datum value={totalRows || null} cite="clientParseCSV rows" />
					<span>rows</span>
				</span>
			</div>
		</div>

		<Ratio segments={intakeStateSegments} height={8} />

		<div class="grid gap-3 md:grid-cols-3" aria-label="Source portability pressure">
			{#each intakePressureReadouts as readout (readout.id)}
				<a
					href={readout.href}
					data-state={readout.state}
					data-sveltekit-preload-data="off"
					class="border-surface-border bg-surface-base hover:border-surface-border-strong grid min-h-[10.5rem] content-start gap-2 rounded-md border px-3 py-3 transition-colors focus:ring-1 focus:ring-teal-400/50 focus:outline-none"
					aria-label="{readout.label}: {stateLabel(
						readout.state
					)}. {readout.detail} Gate: {readout.gate}"
				>
					<span class="text-text-tertiary font-mono text-[10px] tracking-wider uppercase">
						{readout.label}
					</span>
					<span class="text-text-primary text-sm font-semibold">{readout.title}</span>
					<span class="text-text-secondary flex items-baseline gap-1.5 font-mono text-xs">
						<Datum value={readout.metric.value} cite={readout.metric.cite} />
						<span>{readout.metric.label}</span>
					</span>
					<span class="text-text-tertiary text-xs">{readout.detail}</span>
					<span class="text-text-quaternary text-xs">{readout.gate}</span>
					<span class="text-text-secondary font-mono text-xs"
						>{actionFor(readout.state, readout.action)}</span
					>
					<span class="text-text-quaternary font-mono text-[10px]">{readout.source}</span>
				</a>
			{/each}
		</div>

		<div class="divide-surface-border divide-y">
			{#each intakeContractRows as row (row.label)}
				<div
					class="grid gap-2 py-3 text-sm lg:grid-cols-[minmax(10rem,1fr)_5.5rem_minmax(8rem,0.8fr)_auto_minmax(0,1.2fr)] lg:items-baseline"
					data-state={row.state}
				>
					<div class="min-w-0">
						<p class="text-text-primary font-medium">{row.label}</p>
						<p class="text-text-tertiary mt-0.5 text-xs">{row.effect}</p>
					</div>
					<span class="font-mono text-[10px] tracking-wider text-teal-300 uppercase">
						{stateLabel(row.state)}
					</span>
					<span class="text-text-tertiary font-mono text-[10px] tracking-wider uppercase">
						{formatCapabilityClusters(row.cluster)}
					</span>
					<span class="text-text-secondary font-mono text-xs whitespace-nowrap">
						{actionLabel(row)}
					</span>
					<span class="text-text-tertiary text-xs">{row.gate}</span>
					<span
						class="text-text-quaternary flex items-baseline gap-1.5 font-mono text-xs lg:col-start-3"
					>
						<Datum value={row.metric.value} cite={row.metric.cite} />
						<span>{row.metric.label}</span>
					</span>
				</div>
			{/each}
		</div>
	</section>

	<!-- ── CSV Upload Section (hero) ──────────────────────────── -->
	<div id="csv-intake" class="border-surface-border bg-surface-base rounded-md border p-5">
		<div class="mb-4 flex items-center gap-3">
			<div class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-teal-500/15">
				<svg
					class="h-5 w-5 text-teal-400"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
					/>
				</svg>
			</div>
			<div>
				<p class="text-text-primary text-sm font-medium">CSV export intake</p>
				<p class="text-text-tertiary text-xs">
					Import a spreadsheet export from any incumbent tool or mailing list.
				</p>
			</div>
		</div>

		<!-- Step indicators -->
		<div class="text-text-tertiary flex items-center gap-2 text-xs">
			<span
				class="flex items-center gap-1.5 {step === 'upload'
					? 'text-teal-400'
					: 'text-text-tertiary'}"
			>
				<span
					class="flex h-5 w-5 items-center justify-center rounded-full border font-mono text-xs
				{step === 'upload'
						? 'border-teal-400 text-teal-400'
						: step === 'mapping' || step === 'confirm'
							? 'border-teal-600 bg-teal-600 text-white'
							: 'border-surface-border-strong text-text-tertiary'}"
				>
					{#if step === 'mapping' || step === 'confirm'}
						<svg
							class="h-3 w-3"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="3"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
						</svg>
					{:else}
						1
					{/if}
				</span>
				Upload
			</span>
			<div class="bg-surface-overlay h-px w-8"></div>
			<span
				class="flex items-center gap-1.5 {step === 'mapping'
					? 'text-teal-400'
					: 'text-text-tertiary'}"
			>
				<span
					class="flex h-5 w-5 items-center justify-center rounded-full border font-mono text-xs
				{step === 'mapping'
						? 'border-teal-400 text-teal-400'
						: step === 'confirm'
							? 'border-teal-600 bg-teal-600 text-white'
							: 'border-surface-border-strong text-text-tertiary'}"
				>
					{#if step === 'confirm'}
						<svg
							class="h-3 w-3"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="3"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
						</svg>
					{:else}
						2
					{/if}
				</span>
				Map Columns
			</span>
			<div class="bg-surface-overlay h-px w-8"></div>
			<span
				class="flex items-center gap-1.5 {step === 'confirm'
					? 'text-teal-400'
					: 'text-text-tertiary'}"
			>
				<span
					class="flex h-5 w-5 items-center justify-center rounded-full border font-mono text-xs
				{step === 'confirm'
						? 'border-teal-400 text-teal-400'
						: 'border-surface-border-strong text-text-tertiary'}"
				>
					3
				</span>
				Import
			</span>
		</div>

		<!-- ── STEP 1: Upload ──────────────────────────────────── -->
		{#if step === 'upload'}
			<div
				role="button"
				tabindex="0"
				ondrop={onDrop}
				ondragover={onDragOver}
				ondragleave={onDragLeave}
				class="relative cursor-pointer rounded-md border-2 border-dashed p-12 text-center transition-colors
				{dragOver
					? 'border-teal-400 bg-teal-500/5'
					: 'border-surface-border-strong hover:border-text-quaternary bg-surface-base'}"
				onclick={() => document.getElementById('csv-file-input')?.click()}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ')
						document.getElementById('csv-file-input')?.click();
				}}
			>
				<input
					id="csv-file-input"
					type="file"
					accept=".csv"
					class="hidden"
					onchange={onFileInput}
				/>

				<svg
					class="text-text-quaternary mx-auto mb-4 h-10 w-10"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
					/>
				</svg>

				<p class="text-text-secondary text-sm">Drag and drop a CSV file, or click to browse</p>
				<p class="text-text-quaternary mt-2 text-xs">Accepts .csv files up to 10MB</p>
			</div>

			{#if parseError}
				<div
					class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
				>
					{parseError}
				</div>
			{/if}

			<!-- ── STEP 2: Column Mapping ──────────────────────────── -->
		{:else if step === 'mapping'}
			{#if detectedPlatform}
				<div
					class="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300"
				>
					<span class="font-medium">{detectedPlatform.label} export detected.</span>
					Columns have been auto-mapped from known platform headers.
				</div>
			{/if}

			<!-- File info -->
			<div
				class="border-surface-border bg-surface-base flex items-center justify-between rounded-lg border px-4 py-3"
			>
				<div class="flex items-center gap-3">
					<svg
						class="text-text-tertiary h-5 w-5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
						/>
					</svg>
					<div>
						<p class="text-text-primary text-sm">{file?.name ?? 'file.csv'}</p>
						<p class="text-text-tertiary text-xs">
							{fileSizeDisplay()} &middot;
							<span class="font-mono">{totalRows.toLocaleString()}</span> rows detected
						</p>
					</div>
				</div>
				<button
					onclick={goToUpload}
					class="text-text-tertiary hover:text-text-secondary text-xs transition-colors"
				>
					Change file
				</button>
			</div>

			<!-- Column mappings -->
			<div
				class="border-surface-border bg-surface-base divide-surface-border divide-y rounded-md border"
			>
				<div class="px-4 py-3">
					<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<p class="text-text-tertiary font-mono text-xs tracking-wider uppercase">
								Column Mapping
							</p>
							<p class="text-text-quaternary mt-1 text-xs">
								Use encrypted custom fields for platform-specific history Commons should preserve.
							</p>
						</div>
						<button
							type="button"
							onclick={preserveUnmappedAsCustomFields}
							class="border-surface-border-strong bg-surface-raised text-text-secondary hover:text-text-primary rounded-md border px-3 py-1.5 text-xs transition-colors"
						>
							Preserve unmapped
						</button>
					</div>
				</div>

				{#each headers as header, i}
					<div class="flex items-center justify-between gap-4 px-4 py-3">
						<div class="flex min-w-0 items-center gap-3">
							<span class="text-text-quaternary w-6 shrink-0 text-right font-mono text-xs"
								>{i + 1}</span
							>
							<span class="text-text-secondary truncate text-sm">"{header}"</span>
							<svg
								class="text-text-quaternary h-4 w-4 shrink-0"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="1.5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
								/>
							</svg>
						</div>
						<select
							value={columnMapping[i] ?? 'skip'}
							onchange={(e) => updateMapping(i, (e.target as HTMLSelectElement).value)}
							class="border-surface-border-strong bg-surface-raised text-text-primary min-w-[160px] rounded-lg border px-3 py-1.5 text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
						>
							{#each FIELD_OPTIONS as opt}
								<option value={opt.value}>{opt.label}</option>
							{/each}
						</select>
					</div>
				{/each}
			</div>

			{#if !hasEmailMapping}
				<div
					class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
				>
					An "Email" column mapping is required to import people.
				</div>
			{/if}

			<!-- Preview table -->
			{#if previewRows.length > 0}
				<div class="border-surface-border bg-surface-base overflow-hidden rounded-md border">
					<div class="border-surface-border border-b px-4 py-3">
						<p class="text-text-tertiary font-mono text-xs tracking-wider uppercase">
							Preview <span class="text-text-quaternary">(first {previewRows.length} rows)</span>
						</p>
					</div>
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-surface-border border-b">
									{#each headers as header, i}
										<th
											class="px-3 py-2 text-left text-xs font-medium whitespace-nowrap
										{columnMapping[i] && columnMapping[i] !== 'skip' ? 'text-teal-400' : 'text-text-quaternary'}"
										>
											{header}
											{#if columnMapping[i] && columnMapping[i] !== 'skip'}
												<span class="ml-1 text-teal-600">({getMappingLabel(columnMapping[i])})</span
												>
											{/if}
										</th>
									{/each}
								</tr>
							</thead>
							<tbody class="divide-surface-border divide-y">
								{#each previewRows as row}
									<tr>
										{#each headers as _, i}
											<td
												class="max-w-[200px] truncate px-3 py-2 text-xs whitespace-nowrap
											{columnMapping[i] && columnMapping[i] !== 'skip' ? 'text-text-primary' : 'text-text-quaternary'}"
											>
												{row[i] ?? ''}
											</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}

			<!-- Navigation -->
			<div class="flex items-center gap-3 pt-2">
				<button
					onclick={goToConfirm}
					disabled={!hasEmailMapping}
					class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors
				{hasEmailMapping ? 'hover:bg-teal-500' : 'cursor-not-allowed opacity-50'}"
				>
					Continue
				</button>
				<button
					onclick={goToUpload}
					class="text-text-tertiary hover:text-text-primary rounded-lg px-4 py-2.5 text-sm transition-colors"
				>
					Back
				</button>
			</div>

			<!-- ── STEP 3: Confirm + Import ────────────────────────── -->
		{:else if step === 'confirm'}
			{#if form?.success}
				<!-- Success summary -->
				<div class="space-y-4 rounded-md border border-teal-500/30 bg-teal-500/10 p-6">
					<div class="flex items-center gap-3">
						<svg
							class="h-6 w-6 text-teal-400"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="2"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
							/>
						</svg>
						<p class="text-lg font-medium text-teal-300">Import Complete</p>
					</div>

					<div class="grid grid-cols-2 gap-4 md:grid-cols-4">
						<div class="border-surface-border bg-surface-base rounded-lg border p-3">
							<p class="text-text-primary font-mono text-2xl font-bold tabular-nums">
								{form.summary.imported}
							</p>
							<p class="text-text-tertiary text-xs">Imported</p>
						</div>
						<div class="border-surface-border bg-surface-base rounded-lg border p-3">
							<p class="text-text-primary font-mono text-2xl font-bold tabular-nums">
								{form.summary.updated}
							</p>
							<p class="text-text-tertiary text-xs">Updated</p>
						</div>
						<div class="border-surface-border bg-surface-base rounded-lg border p-3">
							<p class="text-text-primary font-mono text-2xl font-bold tabular-nums">
								{form.summary.skipped}
							</p>
							<p class="text-text-tertiary text-xs">Skipped</p>
						</div>
						<div class="border-surface-border bg-surface-base rounded-lg border p-3">
							<p class="text-text-primary font-mono text-2xl font-bold tabular-nums">
								{form.summary.tags_created}
							</p>
							<p class="text-text-tertiary text-xs">Tags Created</p>
						</div>
					</div>

					<div class="border-surface-border bg-surface-base rounded-md border px-4 py-3">
						<div class="grid gap-3 sm:grid-cols-2">
							<div>
								<p class="text-text-tertiary text-xs font-medium">Source profile</p>
								<p class="text-text-primary mt-1 text-sm">{form.summary.source}</p>
							</div>
							<div>
								<p class="text-text-tertiary text-xs font-medium">Encrypted custom fields</p>
								<p class="text-text-primary mt-1 font-mono text-sm">
									{form.summary.custom_fields ?? 0}
								</p>
							</div>
							<div>
								<p class="text-text-tertiary text-xs font-medium">Consent evidence rows</p>
								<p class="text-text-primary mt-1 font-mono text-sm">
									{form.summary.consent_evidence ?? 0}
								</p>
							</div>
						</div>
					</div>

					{#if form.summary.errors && form.summary.errors.length > 0}
						<div class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
							<p class="mb-2 text-sm font-medium text-amber-300">
								Row errors ({form.summary.errors.length})
							</p>
							<ul class="max-h-40 space-y-1 overflow-y-auto font-mono text-xs text-amber-400/80">
								{#each form.summary.errors as err}
									<li>{err}</li>
								{/each}
							</ul>
						</div>
					{/if}

					<div class="flex items-center gap-3 pt-2">
						<a
							href="/org/{data.org.slug}/supporters"
							class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
						>
							View people ledger
						</a>
						<button
							onclick={goToUpload}
							class="text-text-tertiary hover:text-text-primary rounded-lg px-4 py-2.5 text-sm transition-colors"
						>
							Import Another File
						</button>
					</div>
				</div>
			{:else}
				<!-- Pre-import confirmation -->
				{#if form?.error}
					<div
						class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
					>
						{form.error}
					</div>
				{/if}

				<!-- Summary of what will happen -->
				<div class="border-surface-border bg-surface-base space-y-4 rounded-md border p-6">
					<p class="text-text-tertiary font-mono text-xs tracking-wider uppercase">
						Import Summary
					</p>

					<div class="space-y-2">
						<div class="flex items-center justify-between text-sm">
							<span class="text-text-tertiary">File</span>
							<span class="text-text-primary">{file?.name}</span>
						</div>
						<div class="flex items-center justify-between text-sm">
							<span class="text-text-tertiary">Total rows</span>
							<span class="text-text-primary font-mono">{totalRows.toLocaleString()}</span>
						</div>
						<div class="flex items-center justify-between text-sm">
							<span class="text-text-tertiary">Mapped columns</span>
							<span class="text-text-primary font-mono">{mappedFields.length}</span>
						</div>
						<div class="flex items-center justify-between text-sm">
							<span class="text-text-tertiary">Encrypted custom fields</span>
							<span class="text-text-primary font-mono">{customFieldColumnCount}</span>
						</div>
						<div class="flex items-center justify-between text-sm">
							<span class="text-text-tertiary">Consent evidence columns</span>
							<span class="text-text-primary font-mono">{consentEvidenceColumnCount}</span>
						</div>
						{#if detectedPlatform}
							<div class="flex items-center justify-between text-sm">
								<span class="text-text-tertiary">Source format</span>
								<span class="text-teal-400">{detectedPlatform.label}</span>
							</div>
						{/if}
					</div>

					<div class="border-surface-border border-t pt-4">
						<p class="text-text-tertiary text-xs">
							Mapped fields:
							{#each mappedFields as field, i}
								<span class="text-text-tertiary"
									>{getMappingLabel(field)}{i < mappedFields.length - 1 ? ', ' : ''}</span
								>
							{/each}
						</p>
					</div>

					<div class="border-surface-border text-text-quaternary space-y-1 border-t pt-4 text-xs">
						<p>Existing people fill empty custody fields; suppression status can only tighten.</p>
						<p>
							Email status uses strictest-wins merging (complained > bounced > unsubscribed >
							subscribed).
						</p>
						<p>
							Consent source/date/text become aggregate reach evidence, not legal clearance or
							carrier dispatch proof.
						</p>
						<p>Custom fields are stored as encrypted JSON and are not yet typed or segmentable.</p>
					</div>
				</div>

				<!-- Import form -->
				<form
					method="POST"
					action="?/import"
					enctype="multipart/form-data"
					use:enhance={() => {
						importing = true;
						return async ({ update }) => {
							importing = false;
							await update();
						};
					}}
				>
					<!-- Re-attach the file via a hidden file input that we populate -->
					<input id="hidden-csv-input" type="file" name="csv_file" class="hidden" />
					<!-- Column mapping as JSON -->
					<input type="hidden" name="column_mapping" value={JSON.stringify(columnMapping)} />

					<div class="flex items-center gap-3 pt-2">
						<button
							type="submit"
							disabled={importing}
							class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors
						{importing ? 'cursor-wait opacity-60' : 'hover:bg-teal-500'}"
						>
							{#if importing}
								<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
									<circle
										class="opacity-25"
										cx="12"
										cy="12"
										r="10"
										stroke="currentColor"
										stroke-width="4"
									></circle>
									<path
										class="opacity-75"
										fill="currentColor"
										d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
									></path>
								</svg>
								Importing...
							{:else}
								Import {totalRows.toLocaleString()} people
							{/if}
						</button>
						<button
							type="button"
							onclick={goToMapping}
							disabled={importing}
							class="text-text-tertiary hover:text-text-primary rounded-lg px-4 py-2.5 text-sm transition-colors"
						>
							Back
						</button>
					</div>
				</form>
			{/if}
		{/if}
	</div>

	<!-- ── Platform Export Profiles ───────────────────────────── -->
	<div class="space-y-3">
		<div>
			<p class="text-text-tertiary font-mono text-xs tracking-wider uppercase">
				Platform export profiles
			</p>
			<p class="text-text-quaternary mt-1 text-xs">
				{platformIntakeReadiness.signal} are tracked as CSV and API contracts. {platformIntakeReadiness.detail}
			</p>
		</div>

		<Ratio segments={platformProfileSegments} height={8} />

		<div class="grid gap-3 sm:grid-cols-2">
			{#each platformProfileRows as row (row.source)}
				<div class="border-surface-border bg-surface-base rounded-md border p-4">
					<div class="flex items-start justify-between gap-3">
						<div>
							<p class="text-text-primary text-sm font-medium">{row.label}</p>
							<p class="text-text-tertiary mt-1 text-xs">
								{row.fingerprint} headers map into People and preserve source.
							</p>
							<p class="text-text-quaternary mt-1 text-xs">
								Sync proof: {row.apiProofSummary}
							</p>
						</div>
						<span class="text-text-tertiary font-mono text-[10px] tracking-wider uppercase"
							>{formatCapabilityClusters(row.clusters)}</span
						>
					</div>
					<div class="mt-3 flex flex-wrap gap-2">
						<a
							href={row.csvHref}
							data-sveltekit-preload-data="off"
							class="rounded border border-teal-500/30 bg-teal-500/10 px-2 py-1 font-mono text-[10px] tracking-wider text-teal-300 uppercase transition-colors hover:border-teal-400/60 hover:bg-teal-500/15 focus:ring-1 focus:ring-teal-400/50 focus:outline-none"
						>
							CSV profile · {stateLabel(row.csvState)}
						</a>
						<a
							href={row.apiHref}
							data-sveltekit-preload-data="off"
							class="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-mono text-[10px] tracking-wider text-amber-300 uppercase transition-colors hover:border-amber-400/60 hover:bg-amber-500/15 focus:ring-1 focus:ring-amber-400/50 focus:outline-none"
						>
							Direct sync · {stateLabel(row.apiState)}
						</a>
						<span class="text-text-quaternary flex items-baseline gap-1.5 font-mono text-xs">
							<Datum value={row.matchCount} cite="platform export profile header signatures" />
							<span>signals</span>
						</span>
						<span class="text-text-quaternary flex items-baseline gap-1.5 font-mono text-xs">
							<Datum value={row.apiProofCount} cite="direct sync proof checklist" />
							<span>sync checks</span>
						</span>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
