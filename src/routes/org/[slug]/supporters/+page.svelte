<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { Download, Upload } from '@lucide/svelte';
	import VerificationPipeline from '$lib/components/org/VerificationPipeline.svelte';
	import SegmentBuilder from '$lib/components/segments/SegmentBuilder.svelte';
	import {
		PEOPLE_SOURCE_FILTER_OPTIONS,
		formatPeopleSourceLabel
	} from '$lib/data/platform-export-profiles';
	import {
		matchesSupporterQuery,
		parseSearchQuery,
		passesStructuralFilters,
		searchCoverage
	} from '$lib/core/org/supporter-search';
	import type { DecryptedSupporterRow } from '$lib/core/org/supporter-export';
	import { Datum } from '$lib/design';
	import type { PageData } from './$types';

	type TagView = { id: string; name: string; supporterCount?: number };
	type PeopleLedgerMetric = {
		value: number | null;
		label: string;
	};
	/** Row decrypted in this browser for search, with its creation time. */
	type SearchRow = DecryptedSupporterRow & { createdAt: string };
	/** What the table renders — same shape for server pages and search results. */
	type TableRow = {
		id: string;
		name: string;
		email: string;
		identityVerified: boolean;
		postalCode: string | null;
		emailStatus: string;
		source: string | null;
		tags: Array<{ name: string }>;
		createdAt: string | null;
	};

	let { data }: { data: PageData } = $props();
	const tags = $derived((data.tags ?? []) as TagView[]);

	// ── Client-side PII decryption ──
	let decryptedPii = $state<Record<string, { email: string; name: string; phone: string }>>({});

	$effect(() => {
		decryptSupporterPii(data.supporters);
	});

	async function decryptSupporterPii(supporters: typeof data.supporters) {
		try {
			const { getOrPromptOrgKey } = await import('$lib/services/org-key-manager');
			const { decryptOrgPii } = await import('$lib/core/crypto/org-pii-encryption');

			const verifierData = data.encryption;
			if (!verifierData?.orgKeyVerifier) return;

			const orgKey = await getOrPromptOrgKey(data.org.id, verifierData.orgKeyVerifier);
			if (!orgKey) return;

			const results: Record<string, { email: string; name: string; phone: string }> = {};
			for (const s of supporters) {
				const entityId = `supporter:${s.id}`;
				const emailHash = s.emailHash ?? '';
				let email = '',
					name = '',
					phone = '';
				try {
					if (s.encryptedEmail && emailHash) {
						email = await decryptOrgPii(
							JSON.parse(s.encryptedEmail),
							orgKey,
							emailHash,
							entityId,
							'email'
						);
					}
				} catch {
					/* decryption failed */
				}
				try {
					if (s.encryptedName && emailHash) {
						name = await decryptOrgPii(
							JSON.parse(s.encryptedName),
							orgKey,
							emailHash,
							entityId,
							'name'
						);
					}
				} catch {
					/* decryption failed */
				}
				try {
					if (s.encryptedPhone && emailHash) {
						phone = await decryptOrgPii(
							JSON.parse(s.encryptedPhone),
							orgKey,
							emailHash,
							entityId,
							'phone'
						);
					}
				} catch {
					/* decryption failed */
				}
				results[s.id] = { email, name, phone };
			}
			decryptedPii = results;
		} catch {
			// Org key not available — show [encrypted]
		}
	}

	// Helper to get decrypted value or fallback
	function pii(supporterId: string, field: 'email' | 'name' | 'phone'): string {
		return decryptedPii[supporterId]?.[field] || '\u2014';
	}

	// \u2500\u2500 CSV takeout (decrypted in this browser, downloaded as files) \u2500\u2500
	let exporting = $state(false);
	let exportStatus = $state('');
	let exportNotice = $state('');
	let exportError = $state('');
	let showPassphraseDialog = $state(false);
	let passphraseIntent = $state<'export' | 'search'>('export');
	let passphraseInput = $state('');
	let passphraseError = $state('');

	async function startExport() {
		if (exporting) return;
		exportError = '';
		exportNotice = '';

		const verifier = data.encryption?.orgKeyVerifier;
		if (!verifier) {
			exportError = 'Set up the organization passphrase before exporting.';
			return;
		}

		try {
			const { getOrPromptOrgKey } = await import('$lib/services/org-key-manager');
			const orgKey = await getOrPromptOrgKey(data.org.id, verifier);
			if (!orgKey) {
				passphraseIntent = 'export';
				showPassphraseDialog = true;
				return;
			}
			await runExport(orgKey);
		} catch (err) {
			exportError = err instanceof Error ? err.message : 'Export failed.';
		}
	}

	async function onPassphraseSubmit() {
		const verifier = data.encryption?.orgKeyVerifier;
		if (!passphraseInput.trim() || !verifier) return;
		passphraseError = '';
		try {
			const { deriveAndCacheOrgKey } = await import('$lib/services/org-key-manager');
			const orgKey = await deriveAndCacheOrgKey(passphraseInput, data.org.id, verifier);
			if (!orgKey) {
				passphraseError = 'Wrong passphrase. Please try again.';
				return;
			}
			showPassphraseDialog = false;
			passphraseInput = '';
			void decryptSupporterPii(data.supporters);
			if (passphraseIntent === 'export') {
				await runExport(orgKey);
			} else {
				searchLocked = false;
				await runSearchWithKey(orgKey);
			}
		} catch (err) {
			passphraseError = err instanceof Error ? err.message : 'Key derivation failed';
		}
	}

	async function runExport(orgKey: CryptoKey) {
		exporting = true;
		exportError = '';
		exportNotice = '';
		try {
			const [
				{
					fetchAllSupporters,
					decryptSupporterRows,
					buildSupporterCsv,
					buildTakeoutSidecar,
					exportSummary,
					takeoutFilenames,
					downloadTextFile
				},
				{ getConvexClient },
				{ api }
			] = await Promise.all([
				import('$lib/core/org/supporter-export'),
				import('convex-sveltekit'),
				import('$lib/convex')
			]);

			const convex = getConvexClient();

			exportStatus = 'Fetching rows\u2026';
			const records = await fetchAllSupporters(
				async (cursor) => {
					const result = await convex.query(api.supporters.list, {
						orgSlug: data.org.slug,
						paginationOpts: { cursor, numItems: 100 }
					});
					return {
						supporters: result.supporters.map((s) => ({ ...s, id: s._id as string })),
						nextCursor: result.nextCursor,
						hasMore: result.hasMore
					};
				},
				(fetched) => {
					exportStatus = `Fetched ${fmt(fetched)} rows\u2026`;
				}
			);

			const rows = await decryptSupporterRows(records, orgKey, (done, total) => {
				exportStatus = `Decrypted ${fmt(done)} of ${fmt(total)}\u2026`;
			});

			const segmentsResult = await convex
				.query(api.segments.list, { slug: data.org.slug })
				.catch(() => ({ segments: [] }));

			const filenames = takeoutFilenames(data.org.slug);
			downloadTextFile(buildSupporterCsv(rows), filenames.csv, 'text/csv');
			downloadTextFile(
				buildTakeoutSidecar({
					org: { slug: data.org.slug, name: data.org.name },
					tags: tags.map((t) => ({ name: t.name, supporterCount: t.supporterCount })),
					segments: (segmentsResult.segments ?? []).map(
						(s: { name: string; filters: unknown; createdAt?: number; updatedAt?: number }) => ({
							name: s.name,
							filters: s.filters,
							createdAt: s.createdAt,
							updatedAt: s.updatedAt
						})
					)
				}),
				filenames.sidecar,
				'application/json'
			);

			const total = Math.max(data.total ?? 0, rows.length);
			exportNotice = exportSummary(rows.length, total).message;
		} catch (err) {
			exportError = err instanceof Error ? err.message : 'Export failed.';
		} finally {
			exporting = false;
			exportStatus = '';
		}
	}

	// Segment builder toggle
	let showSegmentBuilder = $state(false);

	// Tag manager state
	let showTagManager = $state(false);
	let newTagName = $state('');
	let tagError = $state('');
	let editingTagId = $state<string | null>(null);
	let editingTagName = $state('');
	let deletingTagId = $state<string | null>(null);

	// Local state for "load more" accumulation
	const allSupporters = $derived(data.supporters);
	const hasMore = $derived(data.hasMore);
	const nextCursor = $derived(data.nextCursor);
	let loadingMore = $state(false);

	// Filter helpers
	function updateFilter(key: string, value: string | null) {
		const url = new URL($page.url);
		if (value) {
			url.searchParams.set(key, value);
		} else {
			url.searchParams.delete(key);
		}
		// Reset cursor when filters change
		url.searchParams.delete('cursor');
		goto(url.toString(), { replaceState: true, keepFocus: true });
	}

	function removeFilter(key: string) {
		updateFilter(key, null);
	}

	// Active filter chips
	const activeChips = $derived(buildActiveChips());

	function buildActiveChips(): Array<{ key: string; label: string }> {
		const chips: Array<{ key: string; label: string }> = [];
		if (data.filters.status) chips.push({ key: 'status', label: `Status: ${data.filters.status}` });
		if (data.filters.verified)
			chips.push({
				key: 'verified',
				label: data.filters.verified === 'true' ? 'Verified' : 'Unverified'
			});
		if (data.filters.source)
			chips.push({ key: 'source', label: `Source: ${sourceLabel(data.filters.source)}` });
		if (data.filters.tagId) {
			const tag = tags.find((t) => t.id === data.filters.tagId);
			if (tag) chips.push({ key: 'tag', label: `Tag: ${tag.name}` });
		}
		return chips;
	}

	// Load more
	async function loadMore() {
		if (!nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const url = new URL($page.url);
			url.searchParams.set('cursor', nextCursor);
			const response = await fetch(url.toString(), {
				headers: { accept: 'application/json' }
			});
			// SvelteKit provides page data when fetching with the same URL
			// We need to use goto and accumulate instead
			// Actually, let's use the __data.json endpoint
			const dataUrl = new URL($page.url);
			dataUrl.searchParams.set('cursor', nextCursor);
			// Navigate but capture the data
			goto(dataUrl.toString(), { replaceState: true, keepFocus: true, noScroll: true });
		} catch {
			// ignore
		} finally {
			loadingMore = false;
		}
	}

	// Role check
	const canEdit = $derived(data.membership.role === 'owner' || data.membership.role === 'editor');

	// ── Free-text search (matches against rows decrypted in this browser) ──
	// The org key never reaches the server, so substring search runs here over
	// client-decrypted rows. A complete email address skips the scan and asks
	// the server for the one row with that org-scoped email hash.
	let searchInputValue = $state('');
	let activeQuery = $state('');
	let searchDebounce: ReturnType<typeof setTimeout> | undefined;

	let scanState = $state<'idle' | 'running' | 'done' | 'error'>('idle');
	let scanRows = $state<SearchRow[]>([]);
	let searchLocked = $state(false);
	let searchError = $state('');
	let emailLookup = $state<{ email: string; row: SearchRow | null; pending: boolean } | null>(
		null
	);

	const parsedQuery = $derived(parseSearchQuery(activeQuery));
	const searchActive = $derived(parsedQuery.kind !== 'empty');
	const searchEngaged = $derived(searchActive && !searchLocked);
	const canSearch = $derived(canEdit && Boolean(data.encryption?.orgKeyVerifier));

	function onSearchInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		searchInputValue = value;
		clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => {
			activeQuery = value;
		}, 250);
	}

	function clearSearch() {
		clearTimeout(searchDebounce);
		searchInputValue = '';
		activeQuery = '';
	}

	$effect(() => {
		const parsed = parsedQuery;
		if (parsed.kind === 'empty') return;
		void ensureSearchData(parsed);
	});

	async function ensureSearchData(parsed: ReturnType<typeof parseSearchQuery>) {
		const verifier = data.encryption?.orgKeyVerifier;
		if (!verifier) return;
		try {
			const { getOrPromptOrgKey } = await import('$lib/services/org-key-manager');
			const orgKey = await getOrPromptOrgKey(data.org.id, verifier);
			if (!orgKey) {
				searchLocked = true;
				return;
			}
			searchLocked = false;
			await runSearchWithKey(orgKey, parsed);
		} catch (err) {
			searchError = err instanceof Error ? err.message : 'Search failed.';
		}
	}

	async function runSearchWithKey(
		orgKey: CryptoKey,
		parsed: ReturnType<typeof parseSearchQuery> = parseSearchQuery(activeQuery)
	) {
		if (parsed.kind === 'email') {
			if (emailLookup?.email !== parsed.email) {
				await lookupByEmail(parsed.email, orgKey);
			}
		} else if (parsed.kind === 'text' && (scanState === 'idle' || scanState === 'error')) {
			await scanAllRows(orgKey);
		}
	}

	/**
	 * Decrypt the whole reachable list once, page by page, so text queries can
	 * match against plaintext that exists only in this browser.
	 */
	async function scanAllRows(orgKey: CryptoKey) {
		scanState = 'running';
		searchError = '';
		scanRows = [];
		try {
			const [{ fetchAllSupporters, decryptSupporterRows }, { getConvexClient }, { api }] =
				await Promise.all([
					import('$lib/core/org/supporter-export'),
					import('convex-sveltekit'),
					import('$lib/convex')
				]);
			const convex = getConvexClient();
			const collected: SearchRow[] = [];
			await fetchAllSupporters(async (cursor) => {
				const result = await convex.query(api.supporters.list, {
					orgSlug: data.org.slug,
					paginationOpts: { cursor, numItems: 100 }
				});
				const records = result.supporters.map((s) => ({ ...s, id: s._id as string }));
				const decrypted = await decryptSupporterRows(records, orgKey);
				collected.push(
					...decrypted.map((row, i) => ({
						...row,
						createdAt: new Date(result.supporters[i]._creationTime).toISOString()
					}))
				);
				scanRows = [...collected];
				return { supporters: records, nextCursor: result.nextCursor, hasMore: result.hasMore };
			});
			scanState = 'done';
		} catch (err) {
			scanState = 'error';
			searchError = err instanceof Error ? err.message : 'Search failed.';
		}
	}

	/**
	 * Exact-email path: hash the address with the org-scoped hash in this
	 * browser and ask the server for the one matching row — no scan, no
	 * plaintext on the wire.
	 */
	async function lookupByEmail(email: string, orgKey: CryptoKey) {
		emailLookup = { email, row: null, pending: true };
		searchError = '';
		try {
			const [
				{ computeOrgScopedEmailHash },
				{ decryptSupporterRows },
				{ getConvexClient },
				{ api }
			] = await Promise.all([
				import('$lib/core/crypto/org-scoped-hash'),
				import('$lib/core/org/supporter-export'),
				import('convex-sveltekit'),
				import('$lib/convex')
			]);
			const convex = getConvexClient();
			const emailHash = await computeOrgScopedEmailHash(data.org.id, email);
			const match = await convex.query(api.supporters.searchByEmail, {
				orgSlug: data.org.slug,
				emailHash
			});
			if (!match) {
				emailLookup = { email, row: null, pending: false };
				return;
			}
			const full = await convex.query(api.supporters.get, {
				orgSlug: data.org.slug,
				supporterId: match._id
			});
			const [row] = await decryptSupporterRows([{ ...full, id: full._id as string }], orgKey);
			emailLookup = {
				email,
				row: row ? { ...row, createdAt: new Date(full._creationTime).toISOString() } : null,
				pending: false
			};
		} catch (err) {
			emailLookup = { email, row: null, pending: false };
			searchError = err instanceof Error ? err.message : 'Search failed.';
		}
	}

	const emailLookupSettled = $derived(
		parsedQuery.kind === 'email' &&
			emailLookup !== null &&
			emailLookup.email === parsedQuery.email &&
			!emailLookup.pending
	);

	// Search narrows WITHIN the active structural filters, not around them.
	const searchTagName = $derived(
		data.filters.tagId ? (tags.find((t) => t.id === data.filters.tagId)?.name ?? null) : undefined
	);

	const searchCriteria = $derived({
		emailStatus: data.filters.status || undefined,
		verified:
			data.filters.verified === 'true'
				? true
				: data.filters.verified === 'false'
					? false
					: undefined,
		source: data.filters.source || undefined,
		tagName: searchTagName ?? undefined
	});

	const searchMatches = $derived.by((): SearchRow[] => {
		if (!searchEngaged) return [];
		// Tag filter set but the tag no longer exists — nothing can match it.
		if (searchTagName === null) return [];
		const pool =
			parsedQuery.kind === 'email'
				? emailLookup && emailLookup.email === parsedQuery.email && emailLookup.row
					? [emailLookup.row]
					: []
				: scanRows.filter((row) => matchesSupporterQuery(row, parsedQuery));
		return pool.filter((row) => passesStructuralFilters(row, searchCriteria));
	});

	const coverage = $derived.by(() => {
		if (!searchEngaged || parsedQuery.kind !== 'text' || searchError) return null;
		return searchCoverage({
			scannedCount: scanRows.length,
			totalCount: data.total ?? 0,
			scanning: scanState === 'running' || scanState === 'idle'
		});
	});

	const peopleLedgerMetrics = $derived<PeopleLedgerMetric[]>([
		{ value: data.total, label: 'people' },
		{ value: data.summary.postal, label: 'with addresses' },
		{ value: data.summary.district, label: 'with districts' },
		{ value: data.summary.verified, label: 'identity verified' },
		{ value: data.emailHealth.subscribed, label: 'subscribed' }
	]);

	// Verification status helper
	function verificationState(s: {
		identityVerified: boolean;
		postalCode: string | null;
	}): 'Verified' | 'Resolved' | 'Imported' {
		if (s.identityVerified) return 'Verified';
		if (s.postalCode) return 'Resolved';
		return 'Imported';
	}

	// One table shape for both sources: the server page (decrypted per-row
	// above) and client-side search matches.
	const tableRows = $derived.by((): TableRow[] => {
		if (searchEngaged) {
			return searchMatches.map((row) => ({
				id: row.id,
				name: row.name || '—',
				email: row.email || '—',
				identityVerified: row.identityVerified,
				postalCode: row.postalCode || null,
				emailStatus: row.emailStatus || 'subscribed',
				source: row.source || null,
				tags: row.tags.map((name) => ({ name })),
				createdAt: row.createdAt
			}));
		}
		return allSupporters.map((s) => ({
			id: s.id,
			name: pii(s.id, 'name'),
			email: pii(s.id, 'email'),
			identityVerified: s.identityVerified,
			postalCode: s.postalCode,
			emailStatus: s.emailStatus,
			source: s.source,
			tags: s.tags,
			createdAt: s.createdAt
		}));
	});

	function sourceLabel(source: string | null): string {
		return formatPeopleSourceLabel(source ?? 'unknown', {
			style: 'record',
			fallback: 'Unknown source'
		});
	}

	function sourceFilterLabel(source: string): string {
		return formatPeopleSourceLabel(source, { fallback: source || 'Unknown source' });
	}

	function buildSourceFilterOptions(
		sourceCounts: Record<string, number> | null | undefined
	): Array<{ value: string; label: string }> {
		const knownSources = new Set(PEOPLE_SOURCE_FILTER_OPTIONS.map((option) => option.value));
		const extraSources = Object.keys(sourceCounts ?? {})
			.filter(
				(source) =>
					source &&
					!knownSources.has(source as (typeof PEOPLE_SOURCE_FILTER_OPTIONS)[number]['value'])
			)
			.sort((a, b) => sourceFilterLabel(a).localeCompare(sourceFilterLabel(b)))
			.map((source) => ({ value: source, label: sourceFilterLabel(source) }));

		return [...PEOPLE_SOURCE_FILTER_OPTIONS, ...extraSources];
	}

	const sourceRows = $derived(
		Object.entries(data.sourceCounts ?? {})
			.filter(([, count]) => count > 0)
			.map(([source, count]) => ({
				source,
				count,
				label: sourceLabel(source)
			}))
			.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
	);
	const visibleSourceRows = $derived(sourceRows.slice(0, 4));

	// Relative time formatting
	function relativeTime(iso: string): string {
		const now = Date.now();
		const then = new Date(iso).getTime();
		const diffMs = now - then;
		const diffMin = Math.floor(diffMs / 60000);
		const diffHr = Math.floor(diffMs / 3600000);
		const diffDay = Math.floor(diffMs / 86400000);

		if (diffMin < 1) return 'just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		if (diffHr < 24) return `${diffHr}h ago`;
		if (diffDay < 7) return `${diffDay}d ago`;

		const d = new Date(iso);
		return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}

	// Format number with commas
	function fmt(n: number): string {
		return n.toLocaleString('en-US');
	}

	// Email status filters
	const emailStatuses = ['subscribed', 'unsubscribed', 'bounced', 'complained'] as const;

	const sourceOptions = $derived(buildSourceFilterOptions(data.sourceCounts));

	// The list query scans at most `scanLimit` rows per org. When the org has
	// more, only the most recent window comes back — say so plainly instead of
	// presenting a truncated list as the whole roster.
	const scanCapped = $derived(Boolean(data.scanCapped));
	const scanLimit = $derived(data.scanLimit ?? 10000);
</script>

<div class="space-y-5">
	<!-- Header -->
	<div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
		<div class="min-w-0 space-y-3">
			<h1 class="text-text-primary text-xl font-semibold">People</h1>
			<div class="flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2" aria-label="People counts">
				{#each peopleLedgerMetrics as metric (metric.label)}
					<span
						class="text-text-secondary inline-flex min-w-0 items-baseline gap-1 font-mono text-[0.68rem] tracking-wider uppercase"
					>
						<Datum value={metric.value} />
						<span>{metric.label}</span>
					</span>
				{/each}
			</div>
		</div>
		<div class="flex items-center gap-3 md:justify-end">
			{#if canEdit}
				<button
					type="button"
					disabled={exporting}
					onclick={startExport}
					class="border-surface-border-strong bg-surface-raised text-text-secondary hover:bg-surface-overlay inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Download size={16} strokeWidth={1.8} aria-hidden="true" />
					{exporting ? exportStatus || 'Exporting…' : 'Export CSV'}
				</button>
				<a
					href="/org/{data.org.slug}/supporters/import"
					class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500"
				>
					<Upload size={16} strokeWidth={1.8} aria-hidden="true" />
					Import people
				</a>
			{/if}
		</div>
	</div>

	<!-- Scan-cap notice: the list reflects only the most recent window -->
	{#if scanCapped}
		<p class="text-text-tertiary text-sm" role="status">
			Showing the {fmt(scanLimit)} most recent supporters — older ones aren't listed here.
		</p>
	{/if}

	<!-- Export outcome -->
	{#if exportNotice}
		<p class="text-text-tertiary text-sm" role="status">
			{exportNotice} Names, emails, and phones were decrypted in this browser — nothing left it.
		</p>
	{:else if exportError}
		<p class="text-sm text-red-400" role="alert">{exportError}</p>
	{/if}

	<!-- Passphrase dialog for client-side decryption (export + search) -->
	{#if showPassphraseDialog}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
			<div
				class="border-surface-border-strong bg-surface-raised w-full max-w-sm space-y-4 rounded-md border p-6"
			>
				<div>
					<h3 class="text-text-primary text-base font-semibold">Enter organization passphrase</h3>
					<p class="text-text-tertiary mt-1 text-sm">
						{#if passphraseIntent === 'export'}
							Your passphrase decrypts people data in this browser for the download. It is never
							sent to our servers.
						{:else}
							Your passphrase decrypts people data in this browser so you can search it. It is
							never sent to our servers.
						{/if}
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
						bind:value={passphraseInput}
						placeholder="Organization passphrase"
						class="border-surface-border-strong bg-surface-base text-text-primary placeholder-text-quaternary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
					/>
					<div class="mt-4 flex gap-3">
						<button
							type="button"
							class="border-surface-border-strong bg-surface-overlay text-text-primary hover:border-text-quaternary flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
							onclick={() => {
								showPassphraseDialog = false;
								passphraseInput = '';
								passphraseError = '';
							}}
						>
							Cancel
						</button>
						<button
							type="submit"
							class="flex-1 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:opacity-50"
							disabled={!passphraseInput.trim()}
						>
							{passphraseIntent === 'export' ? 'Unlock & Export' : 'Unlock & Search'}
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}

	<!-- Verification Pipeline Hero -->
	{#if data.total > 0}
		<div id="people-verification">
			<VerificationPipeline
				total={data.total}
				postalResolved={data.summary.postal}
				districtVerified={data.summary.district}
				identityVerified={data.summary.verified}
			/>
		</div>
	{/if}

	<!-- Source custody -->
	{#if data.total > 0}
		<div
			id="people-source-provenance"
			aria-label="People source custody"
			class="border-surface-border bg-surface-base flex flex-col gap-3 rounded-md border px-5 py-4"
		>
			<div class="flex flex-wrap items-center gap-3">
				<span class="text-text-secondary text-xs font-medium">Where your people came from</span>
			</div>
			{#if visibleSourceRows.length > 0}
				<div class="flex flex-wrap items-center gap-2">
					{#each visibleSourceRows as row}
						<span
							class="bg-surface-overlay text-text-tertiary inline-flex min-w-0 items-center gap-2 rounded px-2 py-1 text-xs"
						>
							<span class="truncate">{row.label}</span>
							<span class="font-mono tabular-nums">{fmt(row.count)}</span>
						</span>
					{/each}
					{#if sourceRows.length > visibleSourceRows.length}
						<span class="text-text-quaternary text-xs"
							>+{sourceRows.length - visibleSourceRows.length} sources</span
						>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Consent-bound Reach -->
	{#if data.total > 0}
		<div
			id="email-health"
			aria-label="Consent-bound reach"
			class="border-surface-border bg-surface-base flex flex-col gap-3 rounded-md border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
		>
			<div class="min-w-0 space-y-1">
				<div class="flex flex-wrap items-center gap-3">
					<span class="text-text-secondary text-xs font-medium">Email reach</span>
				</div>
			</div>
			<div class="flex flex-wrap items-center gap-4">
				<span class="inline-flex items-center gap-1.5 text-xs">
					<span class="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
					<span class="text-text-tertiary">{fmt(data.emailHealth.subscribed)} subscribed</span>
				</span>
				<span class="inline-flex items-center gap-1.5 text-xs">
					<span class="inline-block h-2 w-2 rounded-full bg-yellow-500"></span>
					<span class="text-text-tertiary">{fmt(data.emailHealth.unsubscribed)} unsubscribed</span>
				</span>
				<span class="inline-flex items-center gap-1.5 text-xs">
					<span class="inline-block h-2 w-2 rounded-full bg-red-500"></span>
					<span class="text-text-tertiary">{fmt(data.emailHealth.bounced)} bounced</span>
				</span>
				<span class="inline-flex items-center gap-1.5 text-xs">
					<span class="inline-block h-2 w-2 rounded-full bg-red-700"></span>
					<span class="text-text-tertiary">{fmt(data.emailHealth.complained)} complained</span>
				</span>
			</div>
		</div>
	{/if}

	<!-- Search -->
	{#if canSearch}
		<div class="space-y-2">
			<div class="relative">
				<svg
					class="text-text-tertiary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
					/>
				</svg>
				<input
					type="text"
					aria-label="Search people by name, email, postal code, or phone"
					placeholder="Search by name, email, postal code, or phone…"
					value={searchInputValue}
					oninput={onSearchInput}
					class="participation-input py-2 pr-4 pl-10 text-sm"
				/>
			</div>
			{#if searchActive}
				{#if searchLocked}
					<p class="text-text-tertiary text-sm">
						People data is encrypted on this device.
						<button
							type="button"
							class="text-teal-400 transition-colors hover:text-teal-300"
							onclick={() => {
								passphraseIntent = 'search';
								showPassphraseDialog = true;
							}}
						>
							Enter the organization passphrase
						</button>
						to search names, emails, and phones.
					</p>
				{:else if searchError}
					<p class="text-sm text-red-400" role="alert">{searchError}</p>
				{:else if parsedQuery.kind === 'email' && !emailLookupSettled}
					<p class="text-text-tertiary text-sm" role="status">Checking that exact email…</p>
				{:else if coverage && coverage.message}
					<p class="text-text-tertiary text-sm" role="status">{coverage.message}</p>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- Filter bar -->
	<div id="people-segments" class="flex flex-wrap items-center gap-3">
		<!-- Verification toggle (primary filter) -->
		<div class="border-surface-border flex items-center gap-1 rounded-lg border p-0.5">
			<button
				type="button"
				class="rounded-md px-3 py-1.5 text-xs transition-colors {!data.filters.verified
					? 'bg-surface-overlay text-text-primary'
					: 'text-text-tertiary hover:text-text-secondary'}"
				onclick={() => removeFilter('verified')}
			>
				All
			</button>
			<button
				type="button"
				class="rounded-md px-3 py-1.5 text-xs transition-colors {data.filters.verified === 'true'
					? 'bg-surface-overlay text-text-primary'
					: 'text-text-tertiary hover:text-text-secondary'}"
				onclick={() => updateFilter('verified', 'true')}
			>
				Verified
			</button>
			<button
				type="button"
				class="rounded-md px-3 py-1.5 text-xs transition-colors {data.filters.verified === 'false'
					? 'bg-surface-overlay text-text-primary'
					: 'text-text-tertiary hover:text-text-secondary'}"
				onclick={() => updateFilter('verified', 'false')}
			>
				Unverified
			</button>
		</div>

		<!-- Email status pills -->
		<div class="border-surface-border flex items-center gap-1 rounded-lg border p-0.5">
			<button
				type="button"
				class="rounded-md px-3 py-1.5 text-xs transition-colors {!data.filters.status
					? 'bg-surface-overlay text-text-primary'
					: 'text-text-tertiary hover:text-text-secondary'}"
				onclick={() => removeFilter('status')}
			>
				All
			</button>
			{#each emailStatuses as status}
				<button
					type="button"
					class="rounded-md px-3 py-1.5 text-xs capitalize transition-colors {data.filters
						.status === status
						? 'bg-surface-overlay text-text-primary'
						: 'text-text-tertiary hover:text-text-secondary'}"
					onclick={() => updateFilter('status', status)}
				>
					{status}
				</button>
			{/each}
		</div>

		<!-- Tag dropdown -->
		{#if tags.length > 0}
			<select
				class="border-surface-border bg-surface-raised text-text-tertiary rounded-lg border px-3 py-1.5 text-xs transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
				onchange={(e) => {
					const val = (e.target as HTMLSelectElement).value;
					updateFilter('tag', val || null);
				}}
			>
				<option value="" selected={!data.filters.tagId}>Any tag</option>
				{#each tags as tag}
					<option value={tag.id} selected={data.filters.tagId === tag.id}>{tag.name}</option>
				{/each}
			</select>
		{/if}

		<!-- Tag custody toggle (editor+) -->
		{#if canEdit}
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors {showTagManager
					? 'border-teal-500/30 bg-teal-500/10 text-teal-400'
					: 'border-surface-border text-text-tertiary hover:text-text-secondary hover:border-surface-border-strong'}"
				onclick={() => (showTagManager = !showTagManager)}
			>
				<svg
					class="h-3.5 w-3.5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"
					/>
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6z" />
				</svg>
				Tag custody
			</button>
		{/if}

		<!-- Source dropdown -->
		<select
			class="border-surface-border bg-surface-raised text-text-tertiary rounded-lg border px-3 py-1.5 text-xs transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
			onchange={(e) => {
				const val = (e.target as HTMLSelectElement).value;
				updateFilter('source', val || null);
			}}
		>
			<option value="" selected={!data.filters.source}>All sources</option>
			{#each sourceOptions as opt}
				<option value={opt.value} selected={data.filters.source === opt.value}>{opt.label}</option>
			{/each}
		</select>

		<!-- Cohort posture toggle -->
		<button
			type="button"
			class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors {showSegmentBuilder
				? 'border-teal-500/30 bg-teal-500/10 text-teal-400'
				: 'border-surface-border text-text-tertiary hover:text-text-secondary hover:border-surface-border-strong'}"
			onclick={() => (showSegmentBuilder = !showSegmentBuilder)}
		>
			<svg
				class="h-3.5 w-3.5"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z"
				/>
			</svg>
			Cohort posture
		</button>
	</div>

	<!-- Cohort posture panel -->
	{#if showSegmentBuilder}
		<div class="bg-surface-base border-surface-border rounded-md border p-5">
			<SegmentBuilder
				orgSlug={data.org.slug}
				{tags}
				campaigns={data.campaigns}
				showBulkActions={true}
				civicGeographyBoundary="Geography filters use imported state and congressional districts, plus districts recorded when people take action."
			/>
		</div>
	{/if}

	<!-- Tag custody panel -->
	{#if showTagManager && canEdit}
		<div class="bg-surface-base border-surface-border space-y-4 rounded-md border p-5">
			<div class="flex items-center justify-between">
				<h2 class="text-text-primary text-sm font-medium">Tag custody</h2>
				<button
					type="button"
					class="text-text-quaternary hover:text-text-tertiary transition-colors"
					title="Close tag manager"
					onclick={() => (showTagManager = false)}
				>
					<svg
						class="h-4 w-4"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<!-- Create new tag -->
			<form
				method="POST"
				action="?/createTag"
				use:enhance={() => {
					tagError = '';
					return async ({ result }) => {
						if (result.type === 'failure') {
							tagError = (result.data as { error?: string })?.error ?? 'Failed to create tag';
						} else if (result.type === 'success') {
							newTagName = '';
							tagError = '';
							// Invalidate to reload data
							goto($page.url.toString(), { replaceState: true, invalidateAll: true });
						}
					};
				}}
				class="flex items-center gap-2"
			>
				<input
					type="text"
					name="name"
					bind:value={newTagName}
					placeholder="Row tag name..."
					class="participation-input flex-1 px-3 py-1.5 text-sm"
				/>
				<button
					type="submit"
					disabled={!newTagName.trim()}
					class="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<svg
						class="h-3.5 w-3.5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
					</svg>
					Add tag
				</button>
			</form>
			{#if tagError}
				<p class="text-xs text-red-400">{tagError}</p>
			{/if}

			<!-- Tag list -->
			{#if tags.length === 0}
				<p class="text-text-quaternary text-sm">No tags yet. Create one above.</p>
			{:else}
				<div
					class="divide-surface-border border-surface-border divide-y overflow-hidden rounded-lg border"
				>
					{#each tags as tag (tag.id)}
						<div
							class="bg-surface-raised hover:bg-surface-overlay group flex items-center justify-between px-3 py-2 transition-colors"
						>
							{#if editingTagId === tag.id}
								<!-- Inline rename form -->
								<form
									method="POST"
									action="?/renameTag"
									use:enhance={() => {
										return async ({ result }) => {
											if (result.type === 'failure') {
												tagError =
													(result.data as { error?: string })?.error ?? 'Failed to rename tag';
											} else if (result.type === 'success') {
												editingTagId = null;
												editingTagName = '';
												tagError = '';
												goto($page.url.toString(), { replaceState: true, invalidateAll: true });
											}
										};
									}}
									class="flex flex-1 items-center gap-2"
								>
									<input type="hidden" name="tagId" value={tag.id} />
									<input
										type="text"
										name="name"
										bind:value={editingTagName}
										class="participation-input flex-1 px-2 py-1 text-sm"
									/>
									<button
										type="submit"
										disabled={!editingTagName.trim() || editingTagName.trim() === tag.name}
										class="text-xs text-teal-400 transition-colors hover:text-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
									>
										Save
									</button>
									<button
										type="button"
										class="text-text-quaternary hover:text-text-tertiary text-xs transition-colors"
										onclick={() => {
											editingTagId = null;
											editingTagName = '';
											tagError = '';
										}}
									>
										Cancel
									</button>
								</form>
							{:else if deletingTagId === tag.id}
								<!-- Delete confirmation -->
								<div class="flex flex-1 items-center gap-2">
									<span class="text-xs text-red-400"
										>Delete "{tag.name}"? This removes it from {tag.supporterCount} person{tag.supporterCount ===
										1
											? ''
											: 's'}.</span
									>
									<form
										method="POST"
										action="?/deleteTag"
										use:enhance={() => {
											return async ({ result }) => {
												if (result.type === 'failure') {
													tagError =
														(result.data as { error?: string })?.error ?? 'Failed to delete tag';
												} else if (result.type === 'success') {
													deletingTagId = null;
													tagError = '';
													goto($page.url.toString(), { replaceState: true, invalidateAll: true });
												}
											};
										}}
										class="inline-flex items-center gap-2"
									>
										<input type="hidden" name="tagId" value={tag.id} />
										<button
											type="submit"
											class="text-xs font-medium text-red-400 transition-colors hover:text-red-300"
										>
											Confirm
										</button>
									</form>
									<button
										type="button"
										class="text-text-quaternary hover:text-text-tertiary text-xs transition-colors"
										onclick={() => {
											deletingTagId = null;
											tagError = '';
										}}
									>
										Cancel
									</button>
								</div>
							{:else}
								<!-- Normal display -->
								<div class="flex min-w-0 flex-1 items-center gap-2">
									<span
										class="bg-surface-overlay text-text-secondary inline-flex items-center rounded-full px-2 py-0.5 text-xs"
									>
										{tag.name}
									</span>
									<span class="text-text-quaternary font-mono text-xs tabular-nums">
										{tag.supporterCount}
									</span>
								</div>
								<div
									class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
								>
									<button
										type="button"
										class="text-text-quaternary hover:text-text-secondary hover:bg-surface-overlay rounded p-1 transition-colors"
										title="Rename tag"
										onclick={() => {
											editingTagId = tag.id;
											editingTagName = tag.name;
											tagError = '';
										}}
									>
										<svg
											class="h-3.5 w-3.5"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="2"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z"
											/>
										</svg>
									</button>
									<button
										type="button"
										class="text-text-quaternary hover:bg-surface-overlay rounded p-1 transition-colors hover:text-red-400"
										title="Delete tag"
										onclick={() => {
											deletingTagId = tag.id;
											tagError = '';
										}}
									>
										<svg
											class="h-3.5 w-3.5"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="2"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
											/>
										</svg>
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Active filter chips -->
	{#if activeChips.length > 0}
		<div class="flex flex-wrap items-center gap-2">
			{#each activeChips as chip}
				<button
					type="button"
					class="bg-surface-overlay text-text-secondary hover:bg-surface-raised inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors"
					onclick={() => removeFilter(chip.key)}
				>
					{chip.label}
					<svg
						class="h-3 w-3"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			{/each}
			{#if activeChips.length > 1}
				<button
					type="button"
					class="text-text-quaternary hover:text-text-tertiary text-xs transition-colors"
					onclick={() => {
						const url = new URL($page.url);
						url.search = '';
						clearSearch();
						goto(url.toString(), { replaceState: true });
					}}
				>
					Clear all
				</button>
			{/if}
		</div>
	{/if}

	<!-- Table -->
	{#if tableRows.length === 0 && searchEngaged}
		<!-- Search states: still scanning, or genuinely no match -->
		<div class="bg-surface-base border-surface-border rounded-md border p-8 text-center">
			{#if parsedQuery.kind === 'email'}
				{#if !emailLookupSettled}
					<p class="text-text-tertiary text-sm">Checking that exact email…</p>
				{:else}
					<p class="text-text-tertiary text-sm">No one on the list has that email.</p>
				{/if}
			{:else if scanState === 'running' || scanState === 'idle'}
				<p class="text-text-tertiary text-sm">Searching…</p>
			{:else}
				<p class="text-text-tertiary text-sm">No one matches “{activeQuery.trim()}”.</p>
				{#if activeChips.length > 0}
					<p class="text-text-quaternary mt-1 text-sm">
						Filters are still applied — clear them to widen the search.
					</p>
				{/if}
			{/if}
		</div>
	{:else if tableRows.length === 0}
		<!-- Empty state -->
		<div class="bg-surface-base border-surface-border rounded-md border p-12 text-center">
			<div
				class="bg-surface-overlay mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
			>
				<svg
					class="text-text-quaternary h-6 w-6"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.5"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
					/>
				</svg>
			</div>
			<p class="text-text-tertiary mb-1 text-sm">No people yet.</p>
			<p class="text-text-tertiary text-sm">
				{#if canEdit}
					<a
						href="/org/{data.org.slug}/supporters/import"
						class="text-teal-400 transition-colors hover:text-teal-300"
						>Import from CSV or platform export</a
					> to get started.
				{:else}
					Ask an editor to import people.
				{/if}
			</p>
		</div>
	{:else}
		<div class="border-surface-border overflow-hidden rounded-md border">
			<div class="overflow-x-auto">
				<table class="w-full text-left">
					<thead>
						<tr class="border-surface-border bg-surface-raised border-b">
							<th
								class="text-text-tertiary w-24 px-4 py-3 text-xs font-medium tracking-wider uppercase"
								>Status</th
							>
							<th class="text-text-tertiary px-4 py-3 text-xs font-medium tracking-wider uppercase"
								>Name</th
							>
							<th class="text-text-tertiary px-4 py-3 text-xs font-medium tracking-wider uppercase"
								>Email</th
							>
							<th
								class="text-text-tertiary hidden px-4 py-3 text-xs font-medium tracking-wider uppercase lg:table-cell"
								>Postal</th
							>
							<th
								class="text-text-tertiary hidden px-4 py-3 text-xs font-medium tracking-wider uppercase xl:table-cell"
								>Tags</th
							>
							<th
								class="text-text-tertiary hidden w-16 px-4 py-3 text-xs font-medium tracking-wider uppercase lg:table-cell"
								>Source</th
							>
							<th
								class="text-text-tertiary hidden w-24 px-4 py-3 text-xs font-medium tracking-wider uppercase md:table-cell"
								>Added</th
							>
						</tr>
					</thead>
					<tbody class="divide-surface-border divide-y">
						{#each tableRows as supporter (supporter.id)}
							{@const vState = verificationState(supporter)}
							<tr class="hover:bg-surface-raised group transition-colors">
								<!-- Verification status -->
								<td class="px-4 py-3">
									{#if vState === 'Verified'}
										<span class="inline-flex items-center gap-1.5">
											<span class="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
											<span class="text-xs text-emerald-400">Verified</span>
										</span>
									{:else if vState === 'Resolved'}
										<span class="inline-flex items-center gap-1.5">
											<span
												class="inline-block h-2.5 w-2.5 rounded-full border-2 border-teal-500 bg-teal-500/30"
											></span>
											<span class="text-xs text-teal-400">Resolved</span>
										</span>
									{:else}
										<span class="inline-flex items-center gap-1.5">
											<span class="bg-text-quaternary inline-block h-2.5 w-2.5 rounded-full"></span>
											<span class="text-text-tertiary text-xs">Imported</span>
										</span>
									{/if}
								</td>

								<!-- Name -->
								<td class="px-4 py-3">
									<a
										href="/org/{data.org.slug}/supporters/{supporter.id}"
										class="text-text-primary text-sm transition-colors hover:text-teal-400"
									>
										{supporter.name}
									</a>
								</td>

								<!-- Email with status dot -->
								<td class="px-4 py-3">
									<div class="flex min-w-0 items-center gap-1.5">
										{#if supporter.emailStatus === 'unsubscribed'}
											<span
												class="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-yellow-500"
											></span>
										{:else if supporter.emailStatus === 'bounced'}
											<span class="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500"
											></span>
										{:else if supporter.emailStatus === 'complained'}
											<span class="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500"
											></span>
										{/if}
										<span
											class="max-w-48 truncate text-sm {supporter.emailStatus === 'complained'
												? 'text-text-tertiary line-through'
												: 'text-text-tertiary'}"
										>
											{supporter.email}
										</span>
									</div>
								</td>

								<!-- Postal -->
								<td class="hidden px-4 py-3 lg:table-cell">
									<span class="text-text-tertiary font-mono text-sm tabular-nums"
										>{supporter.postalCode || '\u2014'}</span
									>
								</td>

								<!-- Tags -->
								<td class="hidden px-4 py-3 xl:table-cell">
									{#if supporter.tags.length > 0}
										<div class="flex flex-wrap items-center gap-1">
											{#each supporter.tags.slice(0, 3) as tag}
												<span
													class="bg-surface-overlay text-text-tertiary inline-flex items-center rounded-full px-2 py-0.5 text-xs"
												>
													{tag.name}
												</span>
											{/each}
											{#if supporter.tags.length > 3}
												<span class="text-text-quaternary text-xs"
													>+{supporter.tags.length - 3} more</span
												>
											{/if}
										</div>
									{:else}
										<span class="text-text-quaternary">&mdash;</span>
									{/if}
								</td>

								<!-- Source -->
								<td class="hidden px-4 py-3 lg:table-cell">
									<span
										class="bg-surface-overlay text-text-tertiary inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] uppercase"
									>
										{sourceLabel(supporter.source)}
									</span>
								</td>

								<!-- Added -->
								<td class="hidden px-4 py-3 md:table-cell">
									<span class="text-text-quaternary font-mono text-xs tabular-nums"
										>{supporter.createdAt ? relativeTime(supporter.createdAt) : '—'}</span
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>

		<!-- Load more -->
		{#if hasMore && !searchEngaged}
			<div class="flex justify-center pt-2">
				<button
					type="button"
					disabled={loadingMore}
					class="border-surface-border-strong bg-surface-raised text-text-secondary hover:bg-surface-overlay hover:border-surface-border-strong inline-flex items-center gap-2 rounded-lg border px-5 py-2.5 text-sm transition-colors disabled:opacity-50"
					onclick={loadMore}
				>
					{#if loadingMore}
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
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
							></path>
						</svg>
						Loading...
					{:else}
						Load more
					{/if}
				</button>
			</div>
		{/if}
	{/if}
</div>
