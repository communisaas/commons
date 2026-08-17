<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Building2, Mail, ExternalLink, Copy, Check, ChevronDown, X, Plus } from '@lucide/svelte';
	import type { ProcessedDecisionMaker } from '$lib/types/template';
	import { isValidEmail } from '$lib/utils/decision-maker-processing';
	import { formatInputWindow } from '$lib/core/agents/input-window';
	import { describeContactRoute } from '$lib/core/agents/contact-route-verdict';
	import { orderTargetsForDisplay, routeEvidenceFor } from '$lib/core/agents/target-order';
	import { describeMeasuredRoute } from '$lib/core/agents/reach-census';
	import {
		ORG_ORDER_BASIS,
		UNRESOLVED_ORG_LABEL,
		compareOrgLabels
	} from '$lib/core/agents/org-order';

	interface Props {
		decisionMakers: ProcessedDecisionMaker[];
		onremove?: (index: number) => void;
		onupdateemail?: (index: number, email: string) => void;
	}

	let { decisionMakers, onremove, onupdateemail }: Props = $props();

	// Track which members have the email input open
	let emailInputOpen = $state<Set<number>>(new Set());
	let emailInputValues = $state<Map<number, string>>(new Map());
	let emailErrors = $state<Map<number, string>>(new Map());

	function openEmailInput(originalIndex: number) {
		emailInputOpen = new Set([...emailInputOpen, originalIndex]);
		emailInputValues = new Map([...emailInputValues, [originalIndex, '']]);
		emailErrors = new Map([...emailErrors].filter(([k]) => k !== originalIndex));
	}

	function cancelEmailInput(originalIndex: number) {
		emailInputOpen = new Set([...emailInputOpen].filter((i) => i !== originalIndex));
		emailInputValues = new Map([...emailInputValues].filter(([k]) => k !== originalIndex));
		emailErrors = new Map([...emailErrors].filter(([k]) => k !== originalIndex));
	}

	function submitEmail(originalIndex: number) {
		const email = emailInputValues.get(originalIndex)?.trim() || '';
		if (!email) return;
		if (!isValidEmail(email)) {
			emailErrors = new Map([...emailErrors, [originalIndex, 'Enter a valid email address']]);
			return;
		}
		onupdateemail?.(originalIndex, email);
		cancelEmailInput(originalIndex);
	}

	// Group decision-makers by organization
	const groupedByOrg = $derived(() => {
		const groups = new Map<
			string,
			{ org: string; members: Array<ProcessedDecisionMaker & { originalIndex: number }> }
		>();

		decisionMakers.forEach((dm, index) => {
			const orgKey = dm.organization.toLowerCase().trim();
			if (!groups.has(orgKey)) {
				groups.set(orgKey, { org: dm.organization, members: [] });
			}
			groups.get(orgKey)!.members.push({ ...dm, originalIndex: index });
		});

		// Order the rows INSIDE each card by how the institution published the
		// address — the one axis this tree measures (`routeProvenance`). Ordering
		// runs after the `originalIndex` decoration above so that index still
		// addresses `decisionMakers`, which `onremove`/`onupdateemail` depend on,
		// and `orderTargetsForDisplay` returns the same object references in a new
		// array, so nothing here is cloned or mutated. Rows that tie — every row
		// in a single-provenance group, and every hand-typed address — hold their
		// input order.
		for (const group of groups.values()) {
			group.members = orderTargetsForDisplay(group.members);
		}

		// Order the institution cards alphabetically by name, and say so on screen
		// (ORG_ORDER_BASIS). This order is arbitrary with respect to power BY DESIGN: no
		// measured basis for institutional standing exists in this tree. `deriveStanding`
		// (src/lib/core/agents/seat-route.ts:249-274) accepts two measured bases,
		// `pageStatedRole` and `registryRoleField`, and nothing in the pipeline produces
		// either — revisit this order when a producer for one of them lands.
		//
		// Do not "improve" this with a model scalar. The model's relevance-rank field is the
		// tempting wrong answer: it is on the wire
		// (src/routes/api/agents/stream-decision-makers/+server.ts:372), it is named
		// "relevance", and it defaults to 99 for unrouted rows
		// (src/lib/core/agents/agents/decision-maker-accountability.ts:170) — sorting by it
		// would quietly sink exactly the rows a person most needs to judge. It is deliberately
		// not spelled out or imported here so a grep for it over this file stays empty.
		// Nothing counted, inferred, or scored may order these cards.
		return Array.from(groups.values()).sort((a, b) => compareOrgLabels(a.org, b.org));
	});

	// The same pure derivation that produced the order produces the sentence, keyed
	// by the SOURCE index so the markup does no per-render classification work and
	// an ordered row can never be labelled from a different row's evidence.
	const routeEvidenceByIndex = $derived(
		new Map(decisionMakers.map((dm, index) => [index, routeEvidenceFor(dm)]))
	);

	// Track which orgs are expanded (all expanded by default). Effects do not
	// run during SSR, so the initialization flag also keeps the first rendered
	// response expanded instead of withholding every contact-route finding.
	let expandedOrgs = $state<Set<string>>(new Set());
	let expandedOrgsInitialized = $state(false);

	// Initialize all as expanded
	$effect(() => {
		const allOrgs = new Set(groupedByOrg().map((g) => g.org));
		expandedOrgs = allOrgs;
		expandedOrgsInitialized = true;
	});

	// Track copy state per email
	let copiedEmail = $state<string | null>(null);
	let copyTimeout: ReturnType<typeof setTimeout> | null = null;

	async function copyEmail(email: string) {
		await navigator.clipboard.writeText(email);
		copiedEmail = email;

		// Clear existing timeout
		if (copyTimeout !== null) {
			clearTimeout(copyTimeout);
		}

		copyTimeout = setTimeout(() => {
			if (copiedEmail === email) copiedEmail = null;
			copyTimeout = null;
		}, 2000);
	}

	onDestroy(() => {
		if (copyTimeout !== null) {
			clearTimeout(copyTimeout);
		}
	});

	function toggleOrg(org: string) {
		const newSet = expandedOrgsInitialized
			? new Set(expandedOrgs)
			: new Set(groupedByOrg().map((group) => group.org));
		if (newSet.has(org)) {
			newSet.delete(org);
		} else {
			newSet.add(org);
		}
		expandedOrgs = newSet;
		expandedOrgsInitialized = true;
	}
</script>

<div class="space-y-3">
	<!-- The order names its own basis. Suppressed below two groups: with one group
	     nothing was ordered, and stating an ordering basis for a list of one is its
	     own small lie. -->
	{#if groupedByOrg().length > 1}
		<p class="text-xs text-slate-500">{ORG_ORDER_BASIS}</p>
	{/if}
	{#each groupedByOrg() as group (group.org)}
		<div class="overflow-hidden rounded-lg border border-slate-200 bg-white">
			<!-- Organization Header -->
			<button
				type="button"
				onclick={() => toggleOrg(group.org)}
				class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
			>
				<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
					<Building2 class="h-5 w-5 text-slate-600" />
				</div>
				<div class="min-w-0 flex-1">
					<h4 class="truncate font-semibold text-slate-900">
						{group.org.trim() || UNRESOLVED_ORG_LABEL}
					</h4>
					<p class="text-sm text-slate-500">
						{group.members.length} decision-maker{group.members.length === 1 ? '' : 's'}
					</p>
				</div>
				<span
					class="transition-transform duration-200"
					class:rotate-180={!expandedOrgsInitialized || expandedOrgs.has(group.org)}
				>
					<ChevronDown class="h-5 w-5 text-slate-400" />
				</span>
			</button>

			<!-- Members List -->
			{#if !expandedOrgsInitialized || expandedOrgs.has(group.org)}
				<div class="border-t border-slate-100">
					{#each group.members as member, i (member.originalIndex)}
						<div
							class="group relative px-4 py-3 transition-colors hover:bg-slate-50"
							class:border-t={i > 0}
							class:border-slate-100={i > 0}
						>
							<!-- Person Row -->
							<div class="flex items-start gap-3">
								<!-- Indicator dot: green = has email, amber = needs email -->
								{#if member.email}
									<div class="mt-1.5 h-2 w-2 rounded-full bg-green-500 ring-2 ring-green-100"></div>
								{:else}
									<div class="mt-1.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-amber-100"></div>
								{/if}

								<!-- Person Info -->
								<div class="min-w-0 flex-1">
									<div class="flex items-baseline gap-2">
										<span class="font-medium text-slate-900">{member.name}</span>
										<span class="text-sm text-slate-500">{member.title}</span>
									</div>

									<!-- Why this person matters -->
									<p class="mt-1 text-sm text-slate-600">{member.reasoning}</p>

									<!-- Contact & Source Row -->
									<div class="mt-2 flex flex-wrap items-center gap-3 text-sm">
										{#if member.email}
											<button
												type="button"
												onclick={() => copyEmail(member.email!)}
												class="inline-flex items-center gap-1.5 text-slate-600 transition-colors hover:text-slate-900"
											>
												{#if copiedEmail === member.email}
													<Check class="h-3.5 w-3.5 text-green-600" />
													<span class="text-green-600">Copied</span>
												{:else}
													<Mail class="h-3.5 w-3.5" />
													<span class="font-mono text-xs">{member.email}</span>
													<Copy
														class="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-50"
													/>
												{/if}
											</button>
											<!-- How the institution published this address. One sentence, drawn
											     verbatim from the census vocabulary; never a badge, count, or color,
											     and never a claim that the address was verified. -->
											<span class="measured-route text-xs text-slate-500"
												>{describeMeasuredRoute(
													routeEvidenceByIndex.get(member.originalIndex) ?? {}
												)}</span
											>
										{:else if emailInputOpen.has(member.originalIndex)}
											<!-- Inline email input -->
											<div class="flex w-full items-center gap-2">
												<Mail class="h-3.5 w-3.5 text-slate-400" />
												<input
													type="email"
													placeholder="name@example.com"
													value={emailInputValues.get(member.originalIndex) || ''}
													oninput={(e) => {
														emailInputValues = new Map([
															...emailInputValues,
															[member.originalIndex, e.currentTarget.value]
														]);
														emailErrors = new Map(
															[...emailErrors].filter(([k]) => k !== member.originalIndex)
														);
													}}
													onkeydown={(e) => {
														if (e.key === 'Enter') submitEmail(member.originalIndex);
														if (e.key === 'Escape') cancelEmailInput(member.originalIndex);
													}}
													class="focus:border-participation-primary-400 focus:ring-participation-primary-400 flex-1 rounded border border-slate-300 px-2 py-1 text-base text-sm focus:ring-1 focus:outline-none md:text-sm"
												/>
												<button
													type="button"
													onclick={() => submitEmail(member.originalIndex)}
													class="bg-participation-primary-600 hover:bg-participation-primary-700 rounded px-2 py-1 text-xs font-medium text-white transition-colors"
												>
													Save
												</button>
												<button
													type="button"
													onclick={() => cancelEmailInput(member.originalIndex)}
													class="rounded px-2 py-1 text-xs text-slate-500 transition-colors hover:text-slate-700"
												>
													Cancel
												</button>
											</div>
											{#if emailErrors.get(member.originalIndex)}
												<p class="text-xs text-red-600">{emailErrors.get(member.originalIndex)}</p>
											{/if}
										{:else}
											<!-- No email — add email affordance -->
											<button
												type="button"
												onclick={() => openEmailInput(member.originalIndex)}
												class="inline-flex items-center gap-1.5 text-amber-600 transition-colors hover:text-amber-700"
											>
												<Plus class="h-3 w-3" />
												<span>Add email</span>
											</button>
											<span class="contact-route-status text-xs text-slate-500"
												>{describeContactRoute(member.contactRoute)}</span
											>
										{/if}

										<span class="text-xs text-slate-400"
											>{formatInputWindow(member.inputWindow)}</span
										>

										{#if member.source}
											<a
												href={member.source}
												target="_blank"
												rel="noopener noreferrer"
												class="text-participation-primary-600 hover:text-participation-primary-700 inline-flex items-center gap-1 transition-colors"
											>
												<ExternalLink class="h-3.5 w-3.5" />
												<span>Source</span>
											</a>
										{/if}
									</div>
								</div>

								<!-- Remove Button -->
								{#if onremove}
									<button
										type="button"
										onclick={() => onremove?.(member.originalIndex)}
										class="p-1 text-slate-400 opacity-0 transition-all group-hover:opacity-100 hover:text-red-600"
										title="Remove"
									>
										<X class="h-4 w-4" />
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</div>
