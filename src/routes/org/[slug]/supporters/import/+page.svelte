<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// ── Wizard state ──────────────────────────────────────────
	type Step = 'upload' | 'mapping' | 'confirm';
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
	let isActionNetworkFormat = $state(false);

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
		{ value: 'phone', label: 'Phone' },
		{ value: 'country', label: 'Country' },
		{ value: 'tags', label: 'Tags' },
		{ value: 'can_message', label: 'Can Message (AN)' }
	];

	// Auto-detect column mappings from header names
	const HEADER_ALIASES: Record<string, string> = {
		email: 'email',
		email_address: 'email',
		'email address': 'email',
		e_mail: 'email',
		name: 'name',
		full_name: 'name',
		'full name': 'name',
		first_name: 'first_name',
		'first name': 'first_name',
		last_name: 'last_name',
		'last name': 'last_name',
		postal_code: 'postalCode',
		postalcode: 'postalCode',
		zip: 'postalCode',
		zip_code: 'postalCode',
		'zip code': 'postalCode',
		zipcode: 'postalCode',
		phone: 'phone',
		phone_number: 'phone',
		'phone number': 'phone',
		country: 'country',
		tags: 'tags',
		tag: 'tags',
		can_message: 'can_message'
	};

	// Action Network export headers (case-insensitive)
	const AN_HEADERS = new Set([
		'email address',
		'first name',
		'last name',
		'zip code',
		'tags',
		'can_message'
	]);

	// ── Derived values ────────────────────────────────────────
	const previewRows = $derived(rows.slice(0, 5));
	const totalRows = $derived(rows.length);
	const mappedFields = $derived(
		Object.values(columnMapping).filter((v) => v !== 'skip')
	);
	const hasEmailMapping = $derived(mappedFields.includes('email'));

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
				const normalized = parsed.headers[i].toLowerCase().trim();
				const match = HEADER_ALIASES[normalized];
				mapping[i] = match ?? 'skip';
			}
			columnMapping = mapping;

			// Detect Action Network format
			const headerLower = new Set(parsed.headers.map((h) => h.toLowerCase().trim()));
			const anMatchCount = [...AN_HEADERS].filter((h) => headerLower.has(h)).length;
			isActionNetworkFormat = anMatchCount >= 4;

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

	function getMappingLabel(field: string): string {
		return FIELD_OPTIONS.find((o) => o.value === field)?.label ?? field;
	}

	// ── Navigation ────────────────────────────────────────────
	function goToUpload() {
		step = 'upload';
		file = null;
		headers = [];
		rows = [];
		columnMapping = {};
		isActionNetworkFormat = false;
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
		<nav class="flex items-center gap-2 text-sm text-text-tertiary mb-4">
			<a href="/org/{data.org.slug}/supporters" class="hover:text-text-secondary transition-colors">
				Supporters
			</a>
			<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
			</svg>
			<span class="text-text-tertiary">Import</span>
		</nav>
		<h1 class="text-xl font-semibold text-text-primary">Import Supporters</h1>
		<p class="text-sm text-text-tertiary mt-1">Bring your supporters from anywhere — upload a CSV or connect a platform.</p>
	</div>

	<!-- ── CSV Upload Section (hero) ──────────────────────────── -->
	<div class="rounded-md border border-surface-border bg-surface-base p-5">
		<div class="flex items-center gap-3 mb-4">
			<div class="w-9 h-9 rounded-lg bg-teal-500/15 flex items-center justify-center flex-shrink-0">
				<svg class="w-5 h-5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
				</svg>
			</div>
			<div>
				<p class="text-sm font-medium text-text-primary">Upload CSV</p>
				<p class="text-xs text-text-tertiary">Import a spreadsheet export from any platform, CRM, or mailing list.</p>
			</div>
		</div>

	<!-- Step indicators -->
	<div class="flex items-center gap-2 text-xs text-text-tertiary">
		<span class="flex items-center gap-1.5 {step === 'upload' ? 'text-teal-400' : 'text-text-tertiary'}">
			<span
				class="w-5 h-5 rounded-full flex items-center justify-center font-mono text-xs border
				{step === 'upload' ? 'border-teal-400 text-teal-400' : step === 'mapping' || step === 'confirm' ? 'border-teal-600 bg-teal-600 text-white' : 'border-surface-border-strong text-text-tertiary'}"
			>
				{#if step === 'mapping' || step === 'confirm'}
					<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
					</svg>
				{:else}
					1
				{/if}
			</span>
			Upload
		</span>
		<div class="w-8 h-px bg-surface-overlay"></div>
		<span class="flex items-center gap-1.5 {step === 'mapping' ? 'text-teal-400' : 'text-text-tertiary'}">
			<span
				class="w-5 h-5 rounded-full flex items-center justify-center font-mono text-xs border
				{step === 'mapping' ? 'border-teal-400 text-teal-400' : step === 'confirm' ? 'border-teal-600 bg-teal-600 text-white' : 'border-surface-border-strong text-text-tertiary'}"
			>
				{#if step === 'confirm'}
					<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
					</svg>
				{:else}
					2
				{/if}
			</span>
			Map Columns
		</span>
		<div class="w-8 h-px bg-surface-overlay"></div>
		<span class="flex items-center gap-1.5 {step === 'confirm' ? 'text-teal-400' : 'text-text-tertiary'}">
			<span
				class="w-5 h-5 rounded-full flex items-center justify-center font-mono text-xs border
				{step === 'confirm' ? 'border-teal-400 text-teal-400' : 'border-surface-border-strong text-text-tertiary'}"
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
			class="relative rounded-md border-2 border-dashed p-12 text-center transition-colors cursor-pointer
				{dragOver ? 'border-teal-400 bg-teal-500/5' : 'border-surface-border-strong hover:border-text-quaternary bg-surface-base'}"
			onclick={() => document.getElementById('csv-file-input')?.click()}
			onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('csv-file-input')?.click(); }}
		>
			<input
				id="csv-file-input"
				type="file"
				accept=".csv"
				class="hidden"
				onchange={onFileInput}
			/>

			<svg class="w-10 h-10 mx-auto text-text-quaternary mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
			</svg>

			<p class="text-sm text-text-secondary">Drag and drop a CSV file, or click to browse</p>
			<p class="text-xs text-text-quaternary mt-2">Accepts .csv files up to 10MB</p>
		</div>

		{#if parseError}
			<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
				{parseError}
			</div>
		{/if}

	<!-- ── STEP 2: Column Mapping ──────────────────────────── -->
	{:else if step === 'mapping'}
		{#if isActionNetworkFormat}
			<div class="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300">
				<span class="font-medium">Action Network format detected.</span>
				Columns have been auto-mapped from AN export headers.
			</div>
		{/if}

		<!-- File info -->
		<div class="flex items-center justify-between rounded-lg border border-surface-border bg-surface-base px-4 py-3">
			<div class="flex items-center gap-3">
				<svg class="w-5 h-5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
				</svg>
				<div>
					<p class="text-sm text-text-primary">{file?.name ?? 'file.csv'}</p>
					<p class="text-xs text-text-tertiary">{fileSizeDisplay()} &middot; <span class="font-mono">{totalRows.toLocaleString()}</span> rows detected</p>
				</div>
			</div>
			<button onclick={goToUpload} class="text-xs text-text-tertiary hover:text-text-secondary transition-colors">
				Change file
			</button>
		</div>

		<!-- Column mappings -->
		<div class="rounded-md border border-surface-border bg-surface-base divide-y divide-surface-border">
			<div class="px-4 py-3">
				<p class="text-xs font-mono uppercase tracking-wider text-text-tertiary">Column Mapping</p>
			</div>

			{#each headers as header, i}
				<div class="px-4 py-3 flex items-center justify-between gap-4">
					<div class="flex items-center gap-3 min-w-0">
						<span class="text-xs font-mono text-text-quaternary w-6 text-right shrink-0">{i + 1}</span>
						<span class="text-sm text-text-secondary truncate">"{header}"</span>
						<svg class="w-4 h-4 text-text-quaternary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
						</svg>
					</div>
					<select
						value={columnMapping[i] ?? 'skip'}
						onchange={(e) => updateMapping(i, (e.target as HTMLSelectElement).value)}
						class="rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-1.5 text-sm text-text-primary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors min-w-[160px]"
					>
						{#each FIELD_OPTIONS as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>
			{/each}
		</div>

		{#if !hasEmailMapping}
			<div class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
				An "Email" column mapping is required to import supporters.
			</div>
		{/if}

		<!-- Preview table -->
		{#if previewRows.length > 0}
			<div class="rounded-md border border-surface-border bg-surface-base overflow-hidden">
				<div class="px-4 py-3 border-b border-surface-border">
					<p class="text-xs font-mono uppercase tracking-wider text-text-tertiary">
						Preview <span class="text-text-quaternary">(first {previewRows.length} rows)</span>
					</p>
				</div>
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-surface-border">
								{#each headers as header, i}
									<th
										class="px-3 py-2 text-left text-xs font-medium whitespace-nowrap
										{columnMapping[i] && columnMapping[i] !== 'skip' ? 'text-teal-400' : 'text-text-quaternary'}"
									>
										{header}
										{#if columnMapping[i] && columnMapping[i] !== 'skip'}
											<span class="text-teal-600 ml-1">({getMappingLabel(columnMapping[i])})</span>
										{/if}
									</th>
								{/each}
							</tr>
						</thead>
						<tbody class="divide-y divide-surface-border">
							{#each previewRows as row}
								<tr>
									{#each headers as _, i}
										<td
											class="px-3 py-2 text-xs whitespace-nowrap max-w-[200px] truncate
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
				{hasEmailMapping ? 'hover:bg-teal-500' : 'opacity-50 cursor-not-allowed'}"
			>
				Continue
			</button>
			<button
				onclick={goToUpload}
				class="rounded-lg px-4 py-2.5 text-sm text-text-tertiary hover:text-text-primary transition-colors"
			>
				Back
			</button>
		</div>

	<!-- ── STEP 3: Confirm + Import ────────────────────────── -->
	{:else if step === 'confirm'}

		{#if form?.success}
			<!-- Success summary -->
			<div class="rounded-md border border-teal-500/30 bg-teal-500/10 p-6 space-y-4">
				<div class="flex items-center gap-3">
					<svg class="w-6 h-6 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<p class="text-lg font-medium text-teal-300">Import Complete</p>
				</div>

				<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
					<div class="rounded-lg border border-surface-border bg-surface-base p-3">
						<p class="font-mono tabular-nums text-2xl font-bold text-text-primary">{form.summary.imported}</p>
						<p class="text-xs text-text-tertiary">Imported</p>
					</div>
					<div class="rounded-lg border border-surface-border bg-surface-base p-3">
						<p class="font-mono tabular-nums text-2xl font-bold text-text-primary">{form.summary.updated}</p>
						<p class="text-xs text-text-tertiary">Updated</p>
					</div>
					<div class="rounded-lg border border-surface-border bg-surface-base p-3">
						<p class="font-mono tabular-nums text-2xl font-bold text-text-primary">{form.summary.skipped}</p>
						<p class="text-xs text-text-tertiary">Skipped</p>
					</div>
					<div class="rounded-lg border border-surface-border bg-surface-base p-3">
						<p class="font-mono tabular-nums text-2xl font-bold text-text-primary">{form.summary.tags_created}</p>
						<p class="text-xs text-text-tertiary">Tags Created</p>
					</div>
				</div>

				{#if form.summary.errors && form.summary.errors.length > 0}
					<div class="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
						<p class="text-sm font-medium text-amber-300 mb-2">Row errors ({form.summary.errors.length})</p>
						<ul class="text-xs text-amber-400/80 space-y-1 font-mono max-h-40 overflow-y-auto">
							{#each form.summary.errors as err}
								<li>{err}</li>
							{/each}
						</ul>
					</div>
				{/if}

				<div class="flex items-center gap-3 pt-2">
					<a
						href="/org/{data.org.slug}/supporters"
						class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-500 transition-colors"
					>
						View Supporters
					</a>
					<button
						onclick={goToUpload}
						class="rounded-lg px-4 py-2.5 text-sm text-text-tertiary hover:text-text-primary transition-colors"
					>
						Import Another File
					</button>
				</div>
			</div>

		{:else}
			<!-- Pre-import confirmation -->
			{#if form?.error}
				<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
					{form.error}
				</div>
			{/if}

			<!-- Summary of what will happen -->
			<div class="rounded-md border border-surface-border bg-surface-base p-6 space-y-4">
				<p class="text-xs font-mono uppercase tracking-wider text-text-tertiary">Import Summary</p>

				<div class="space-y-2">
					<div class="flex items-center justify-between text-sm">
						<span class="text-text-tertiary">File</span>
						<span class="text-text-primary">{file?.name}</span>
					</div>
					<div class="flex items-center justify-between text-sm">
						<span class="text-text-tertiary">Total rows</span>
						<span class="font-mono text-text-primary">{totalRows.toLocaleString()}</span>
					</div>
					<div class="flex items-center justify-between text-sm">
						<span class="text-text-tertiary">Mapped columns</span>
						<span class="font-mono text-text-primary">{mappedFields.length}</span>
					</div>
					{#if isActionNetworkFormat}
						<div class="flex items-center justify-between text-sm">
							<span class="text-text-tertiary">Source format</span>
							<span class="text-teal-400">Action Network</span>
						</div>
					{/if}
				</div>

				<div class="border-t border-surface-border pt-4">
					<p class="text-xs text-text-tertiary">
						Mapped fields:
						{#each mappedFields as field, i}
							<span class="text-text-tertiary">{getMappingLabel(field)}{i < mappedFields.length - 1 ? ', ' : ''}</span>
						{/each}
					</p>
				</div>

				<div class="border-t border-surface-border pt-4 text-xs text-text-quaternary space-y-1">
					<p>Existing supporters will be updated only where their current data is empty.</p>
					<p>Email status uses strictest-wins merging (complained > bounced > unsubscribed > subscribed).</p>
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
				<input
					id="hidden-csv-input"
					type="file"
					name="csv_file"
					class="hidden"
				/>
				<!-- Column mapping as JSON -->
				<input
					type="hidden"
					name="column_mapping"
					value={JSON.stringify(columnMapping)}
				/>

				<div class="flex items-center gap-3 pt-2">
					<button
						type="submit"
						disabled={importing}
						class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors
						{importing ? 'opacity-60 cursor-wait' : 'hover:bg-teal-500'}"
					>
						{#if importing}
							<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
							Importing...
						{:else}
							Import {totalRows.toLocaleString()} supporters
						{/if}
					</button>
					<button
						type="button"
						onclick={goToMapping}
						disabled={importing}
						class="rounded-lg px-4 py-2.5 text-sm text-text-tertiary hover:text-text-primary transition-colors"
					>
						Back
					</button>
				</div>
			</form>
		{/if}
	{/if}
	</div>

	<!-- ── Platform Connectors ────────────────────────────────── -->
	<div class="space-y-3">
		<div>
			<p class="text-xs font-mono uppercase tracking-wider text-text-tertiary">Platform Connectors</p>
			<p class="text-xs text-text-quaternary mt-1">Sync supporters directly from a platform via API.</p>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			<!-- Action Network -->
			<a
				href="/org/{data.org.slug}/supporters/import/action-network"
				class="flex items-center gap-4 rounded-md border border-surface-border bg-surface-base p-4 hover:border-surface-border-strong hover:bg-surface-overlay transition-colors group"
			>
				<div class="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center flex-shrink-0">
					<svg class="w-5 h-5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
					</svg>
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium text-text-primary group-hover:text-text-primary transition-colors">Action Network</p>
					<p class="text-xs text-text-tertiary">Sync supporters, tags, and actions via OSDI API.</p>
				</div>
				<svg class="w-4 h-4 text-text-quaternary group-hover:text-text-tertiary transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
				</svg>
			</a>

			<!-- EveryAction (coming soon) -->
			<div
				class="flex items-center gap-4 rounded-md border border-surface-border bg-surface-base p-4 opacity-50 cursor-default"
			>
				<div class="w-10 h-10 rounded-lg bg-surface-overlay flex items-center justify-center flex-shrink-0">
					<svg class="w-5 h-5 text-text-quaternary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
					</svg>
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium text-text-tertiary">EveryAction</p>
					<p class="text-xs text-text-quaternary">Coming soon</p>
				</div>
			</div>

			<!-- NationBuilder (coming soon) -->
			<div
				class="flex items-center gap-4 rounded-md border border-surface-border bg-surface-base p-4 opacity-50 cursor-default"
			>
				<div class="w-10 h-10 rounded-lg bg-surface-overlay flex items-center justify-center flex-shrink-0">
					<svg class="w-5 h-5 text-text-quaternary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
					</svg>
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium text-text-tertiary">NationBuilder</p>
					<p class="text-xs text-text-quaternary">Coming soon</p>
				</div>
			</div>
		</div>
	</div>
</div>

