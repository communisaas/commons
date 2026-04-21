<script lang="ts">
	import type { PageData } from './$types';
	import type { VerificationPacket } from '$lib/types/verification-packet';
	import { goto } from '$app/navigation';
	import { Datum } from '$lib/design';
	import VerificationPacketComponent from '$lib/components/org/VerificationPacket.svelte';

	let { data }: { data: PageData } = $props();

	const user = $derived(data.user);
	const orgs = $derived(user?.orgMemberships ?? []);

	// Specimen: real CA-12 verification packet with H3 cells
	const ca12Boundary: GeoJSON.Polygon = {
		type: 'Polygon',
		coordinates: [[
			[-122.510, 37.708], [-122.505, 37.725], [-122.503, 37.758],
			[-122.498, 37.778], [-122.483, 37.808], [-122.455, 37.812],
			[-122.420, 37.812], [-122.392, 37.810], [-122.370, 37.798],
			[-122.357, 37.788], [-122.356, 37.768], [-122.382, 37.748],
			[-122.393, 37.732], [-122.400, 37.718], [-122.420, 37.710],
			[-122.452, 37.708], [-122.480, 37.708], [-122.510, 37.708]
		]]
	};

	const specimenPacket: VerificationPacket = {
		verified: 248,
		total: 248,
		verifiedPct: 100,
		districtCount: 1,
		authorship: { individual: 196, shared: 52, unknown: 0, explicit: true },
		dateRange: { earliest: '2026-02-12', latest: '2026-03-04', spanDays: 21 },
		identityBreakdown: { govId: 156, addressVerified: 92, emailOnly: 0, unverified: 0 },
		gds: 0.94,
		ald: 0.79,
		temporalEntropy: 3.2,
		burstVelocity: 1.8,
		cai: 0.72,
		tiers: [
			{ tier: 1, label: 'New', count: 68 },
			{ tier: 2, label: 'Active', count: 85 },
			{ tier: 3, label: 'Established', count: 62 },
			{ tier: 4, label: 'Veteran', count: 33 },
		],
		geography: [{ hash: 'ca12', count: 248 }],
		cells: [
			{ h3: '87283082cffffff', count: 48 },  // Mission + Noe Valley
			{ h3: '872830958ffffff', count: 26 },  // Sunset
			{ h3: '87283082affffff', count: 24 },  // SOMA
			{ h3: '87283095bffffff', count: 22 },  // Richmond
			{ h3: '87283082dffffff', count: 18 },  // Castro
			{ h3: '872830828ffffff', count: 16 },  // Tenderloin
			{ h3: '872830829ffffff', count: 16 },  // Western Addition
			{ h3: '87283082bffffff', count: 15 },  // North Beach
			{ h3: '872830825ffffff', count: 14 },  // Bayview
			{ h3: '872830952ffffff', count: 13 },  // Excelsior
			{ h3: '872830876ffffff', count: 13 },  // Marina
			{ h3: '872830874ffffff', count: 12 },  // Presidio Heights
			{ h3: '87283082effffff', count: 11 },  // Potrero Hill
		],
		temporal: {
			bins: [2, 4, 8, 14, 18, 25, 30, 42, 38, 35, 28, 22, 18, 12, 8, 5, 3],
			startMs: new Date('2026-02-12T00:00:00Z').getTime(),
			binWidthMs: 3600000 * 24  // daily bins for the specimen
		},
		lastUpdated: '2026-03-04T18:00:00Z'
	};

	// Creation form state (returning users)
	let showCreate = $state(false);
	let orgName = $state('');
	let orgSlug = $state('');
	let slugEdited = $state(false);
	let submitting = $state(false);
	let errorMsg = $state('');

	// Waitlist state (argument CTA)
	let waitlistEmail = $state('');
	let waitlistSubmitting = $state(false);
	let waitlistSubmitted = $state(false);
	let waitlistError = $state('');

	function deriveSlug(name: string): string {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, '')
			.replace(/\s+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 48);
	}

	function handleNameInput(e: Event): void {
		const val = (e.target as HTMLInputElement).value;
		orgName = val;
		if (!slugEdited) {
			orgSlug = deriveSlug(val);
		}
	}

	function handleSlugInput(e: Event): void {
		const val = (e.target as HTMLInputElement).value;
		orgSlug = val.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 48);
		slugEdited = true;
	}

	function openCreate(): void {
		showCreate = true;
		orgName = '';
		orgSlug = '';
		slugEdited = false;
		errorMsg = '';
	}

	async function handleCreate(): Promise<void> {
		if (!orgName.trim() || !orgSlug.trim()) return;

		submitting = true;
		errorMsg = '';

		try {
			const res = await fetch('/api/org', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: orgName.trim(), slug: orgSlug.trim() })
			});

			if (!res.ok) {
				const body = await res.json().catch(() => null);
				if (res.status === 409) {
					errorMsg = 'That slug is taken. Try another.';
				} else {
					errorMsg = body?.message || 'Something went wrong.';
				}
				return;
			}

			const { slug } = await res.json();
			await goto(`/org/${slug}`);
		} finally {
			submitting = false;
		}
	}

	async function handleWaitlist(): Promise<void> {
		if (!waitlistEmail.trim()) return;

		waitlistSubmitting = true;
		waitlistError = '';

		try {
			const res = await fetch('/api/waitlist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: waitlistEmail.trim() })
			});

			if (!res.ok) {
				const body = await res.json().catch(() => null);
				waitlistError = body?.message || 'Something went wrong. Try again.';
				return;
			}

			waitlistSubmitted = true;
		} catch {
			waitlistError = 'Network error. Try again.';
		} finally {
			waitlistSubmitting = false;
		}
	}

	async function handleRequestAccess(): Promise<void> {
		waitlistSubmitting = true;
		waitlistError = '';

		try {
			const res = await fetch('/api/waitlist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});

			if (!res.ok) {
				waitlistError = 'Something went wrong. Try again.';
				return;
			}

			waitlistSubmitted = true;
		} catch {
			waitlistError = 'Network error. Try again.';
		} finally {
			waitlistSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>Organizations | Commons</title>
	<meta
		name="description"
		content="312 signatures, no proof. A petition counts names; a verification packet documents constituents — each individually authored, identity-proven, district-matched, screened for duplicates."
	/>
</svelte:head>

<div class="org-page">
	<a href="/" class="back-link">&larr; commons.email</a>

	{#if orgs.length > 0}
		<!-- ═══ RETURNING USER ═══ -->
		<div class="org-page__inner">
			<h1 class="page-heading">Your organizations</h1>

			<div class="org-list">
				{#each orgs as org}
					<a href="/org/{org.orgSlug}" class="org-card">
						{#if org.orgAvatar}
							<img src={org.orgAvatar} alt="" class="org-card__avatar" />
						{:else}
							<div class="org-card__avatar org-card__avatar--fallback">
								{org.orgName.charAt(0).toUpperCase()}
							</div>
						{/if}
						<div class="org-card__info">
							<span class="org-card__name">{org.orgName}</span>
							<span class="org-card__meta">
								{org.role}{#if org.activeCampaignCount > 0}
									&middot; {org.activeCampaignCount} active
								{/if}
							</span>
						</div>
						<span class="org-card__arrow" aria-hidden="true">&rarr;</span>
					</a>
				{/each}
			</div>

			{#if showCreate}
				<form class="create-form" onsubmit={(e) => { e.preventDefault(); handleCreate(); }}>
					<label class="create-form__label">
						<span class="create-form__label-text">Name</span>
						<input
							type="text"
							class="create-form__input"
							placeholder="Acme Coalition"
							value={orgName}
							oninput={handleNameInput}
							maxlength="100"
							required
						/>
					</label>
					<label class="create-form__label">
						<span class="create-form__label-text">Slug</span>
						<div class="create-form__slug-row">
							<span class="create-form__slug-prefix">/org/</span>
							<input
								type="text"
								class="create-form__input create-form__input--slug"
								placeholder="acme-coalition"
								value={orgSlug}
								oninput={handleSlugInput}
								maxlength="48"
								required
							/>
						</div>
					</label>
					{#if errorMsg}
						<p class="create-form__error">{errorMsg}</p>
					{/if}
					<div class="create-form__actions">
						<button type="button" class="create-form__cancel" onclick={() => { showCreate = false; }}>Cancel</button>
						<button type="submit" class="cta" disabled={submitting || !orgName.trim() || !orgSlug.trim()}>
							{submitting ? 'Creating...' : 'Create'}
						</button>
					</div>
				</form>
			{:else}
				<button class="create-link" onclick={openCreate}>
					Create new organization
				</button>
			{/if}
		</div>
	{:else}
		<!-- ═══ ARGUMENT ═══ -->
		<article class="argument">

			<!-- ═══════════════════════════════════════════
			     BEAT 1 — THE PROBLEM (empirical, cited)
			     ═══════════════════════════════════════════ -->
			<section class="beat beat--problem" aria-labelledby="problem-heading">
				<h1 id="problem-heading" class="problem__thesis">
					<span class="problem__stat"><Datum value={312} /></span> signatures. No proof any of them live in the district.
				</h1>

				<p class="problem__bridge">
					Staffers discount volume when authorship, constituency, and specificity are opaque.
				</p>

				<p class="problem__counter">
					Only <span class="problem__stat problem__stat--weak"><Datum value={51} />%</span> of Congressional staff say form emails influence undecided votes. Half believe those messages are sent <em>without</em> the constituent's knowledge. <span class="problem__stat problem__stat--weak"><Datum value={92} />%</span> say individualized emails DO influence &mdash; which is the filter staffers apply.
				</p>

				<p class="problem__citation">
					CMF, <cite>Citizen-Centric Advocacy</cite> (2017); CMF 2004/2015 longitudinal staff panel
				</p>
			</section>

			<!-- ═══════════════════════════════════════════
			     BEAT 2 — THE EVIDENCE (gap artifact)
			     Inbox spray pattern: 300 identical subjects
			     ═══════════════════════════════════════════ -->
			<section class="beat beat--evidence" aria-labelledby="evidence-heading">
				<h2 id="evidence-heading" class="beat__heading">What the staffer actually sees</h2>
				<p class="beat__subheading">
					Shared-office mailbox, <span class="beat__subheading-num"><Datum value={6} /></span>-minute window, one morning in March.
				</p>

				<figure class="inbox-artifact" aria-label="Congressional staff shared inbox showing mass-mail spray pattern">
					<div class="inbox-artifact__chrome">
						<span class="inbox-artifact__dot"></span>
						<span class="inbox-artifact__dot"></span>
						<span class="inbox-artifact__dot"></span>
						<span class="inbox-artifact__chrome-label">staff@house.gov &middot; Inbox</span>
					</div>

					<div class="inbox-artifact__toolbar">
						<span class="inbox-artifact__filter">Sort: received</span>
						<span class="inbox-artifact__count">
							<span class="inbox-artifact__count-num"><Datum value={312} /></span> unread
						</span>
					</div>

					<ul class="inbox-artifact__list" role="list">
						<li class="inbox-row">
							<span class="inbox-row__time">9:04</span>
							<span class="inbox-row__from">M. Alvarez</span>
							<span class="inbox-row__subject">Oppose HR 5421 &mdash; Clean Water Funding Cut</span>
						</li>
						<li class="inbox-row">
							<span class="inbox-row__time">9:04</span>
							<span class="inbox-row__from">J. Okafor</span>
							<span class="inbox-row__subject">Oppose HR 5421 &mdash; Clean Water Funding Cut</span>
						</li>
						<li class="inbox-row">
							<span class="inbox-row__time">9:05</span>
							<span class="inbox-row__from">S. Park</span>
							<span class="inbox-row__subject">Oppose HR 5421 &mdash; Clean Water Funding Cut</span>
						</li>
						<li class="inbox-row">
							<span class="inbox-row__time">9:05</span>
							<span class="inbox-row__from">D. Thompson</span>
							<span class="inbox-row__subject">Oppose HR 5421 &mdash; Clean Water Funding Cut</span>
						</li>
						<li class="inbox-row">
							<span class="inbox-row__time">9:06</span>
							<span class="inbox-row__from">L. Nguyen</span>
							<span class="inbox-row__subject">Oppose HR 5421 &mdash; Clean Water Funding Cut</span>
						</li>
						<li class="inbox-row inbox-row--dim">
							<span class="inbox-row__time">9:06</span>
							<span class="inbox-row__from">A. Patel</span>
							<span class="inbox-row__subject">Oppose HR 5421 &mdash; Clean Water Funding Cut</span>
						</li>
						<li class="inbox-row inbox-row--dimmer">
							<span class="inbox-row__time">9:07</span>
							<span class="inbox-row__from">R. Chen</span>
							<span class="inbox-row__subject">Oppose HR 5421 &mdash; Clean Water Funding Cut</span>
						</li>
						<li class="inbox-row inbox-row--dimmest">
							<span class="inbox-row__time">9:07</span>
							<span class="inbox-row__from">B. Ito</span>
							<span class="inbox-row__subject">Oppose HR 5421 &mdash; Clean Water Funding Cut</span>
						</li>
						<li class="inbox-row__ellipsis">&mdash; 304 more, identical subject line &mdash;</li>
					</ul>
				</figure>

				<p class="evidence__caption">
					Auto-grouped by the CRM as one campaign. Sampled, totaled, filed. No identity check. No district proof. Half of staff report these campaigns are sent without the constituent's knowledge.
				</p>
				<p class="evidence__citation">
					CMF 2004/2015 longitudinal staff panel
				</p>
				<p class="evidence__citation">
					Walker &amp; Le, <cite>Socius</cite> 2023 &middot; astroturf campaigns measurably harm trust in legitimate advocacy orgs
				</p>
			</section>

			<!-- ═══════════════════════════════════════════
			     BEAT 3 — THE MECHANISM (specimen + staff-filter mapping)
			     ═══════════════════════════════════════════ -->
			<section class="beat beat--mechanism" aria-labelledby="mechanism-heading">
				<h2 id="mechanism-heading" class="beat__heading">What Commons delivers instead</h2>
				<p class="beat__subheading">
					A petition counts names. A verification packet documents constituents &mdash; each individually authored, identity-proven, district-matched, screened for duplicates.
				</p>

				<div class="mechanism__layout">
					<div class="mechanism__specimen-block">
						<p class="mechanism__provenance">
							Example packet &middot; CA-12 &middot; Feb 2026
						</p>

						<VerificationPacketComponent
							packet={specimenPacket}
							boundary={ca12Boundary}
							interactive
						/>
					</div>

					<!-- Staff-filter mapping: each specimen field → the question it answers, with a citation -->
					<dl class="filter-map" aria-label="How each field maps to the staff intake filter it answers">
					<div class="filter-map__row">
						<dt class="filter-map__field">Identity</dt>
						<dd class="filter-map__answer">answers the staffer's first filter:</dd>
						<dd class="filter-map__question">&ldquo;Is this person real?&rdquo;</dd>
						<dd class="filter-map__citation">CMF 2004/2015 &middot; 78% of staff say it is &ldquo;helpful&rdquo; or &ldquo;very helpful&rdquo; when advocacy campaigns reveal their identity</dd>
					</div>
					<div class="filter-map__row">
						<dt class="filter-map__field">Geography</dt>
						<dd class="filter-map__answer">answers:</dd>
						<dd class="filter-map__question">&ldquo;Are they in my district?&rdquo;</dd>
						<dd class="filter-map__citation">CMF 2017 &middot; 91% of staff weight district-specific impact information</dd>
					</div>
					<div class="filter-map__row">
						<dt class="filter-map__field">Authorship</dt>
						<dd class="filter-map__answer">answers:</dd>
						<dd class="filter-map__question">&ldquo;Did they actually write this?&rdquo;</dd>
						<dd class="filter-map__citation">CMF 2004/2015 &middot; 53% of staff say form campaigns are sent without the constituent's knowledge</dd>
					</div>
					<div class="filter-map__row">
						<dt class="filter-map__field">Timing</dt>
						<dd class="filter-map__answer">answers:</dd>
						<dd class="filter-map__question">&ldquo;Is this organic or manufactured?&rdquo;</dd>
						<dd class="filter-map__citation">Walker &amp; Le, Socius 2023 &middot; staffers can distinguish organic constituent engagement from coordinated astroturf by arrival patterns</dd>
					</div>
					<div class="filter-map__row">
						<dt class="filter-map__field">Screening</dt>
						<dd class="filter-map__answer">answers:</dd>
						<dd class="filter-map__question">&ldquo;Is this astroturf?&rdquo;</dd>
						<dd class="filter-map__citation">Walker &amp; Le, Socius 2023 &middot; unverified submissions measurably harm trust in legitimate orgs</dd>
					</div>
				</dl>
				</div>
			</section>

			<!-- ═══════════════════════════════════════════
			     BEAT 3b — THE PLATFORM (full stack, not a bolt-on)
			     ═══════════════════════════════════════════ -->
			<section class="beat beat--platform" aria-labelledby="platform-heading">
				<h2 id="platform-heading" class="beat__heading">One platform, not one more tool.</h2>
				<p class="beat__subheading">
					Verification is the foundation, not an add-on. Every tool an advocacy org runs today &mdash; built in, built around verified constituent voice.
				</p>

				<div class="platform__grid">
					<div class="platform__tile">
						<span class="platform__tile-name">Supporters</span>
						<span class="platform__tile-desc">Import from Action Network, EveryAction, NationBuilder, CSV. District-match on import.</span>
					</div>
					<div class="platform__tile">
						<span class="platform__tile-name">Campaigns</span>
						<span class="platform__tile-desc">Each campaign assembles a proof packet. Every action verified and attributed.</span>
					</div>
					<div class="platform__tile">
						<span class="platform__tile-name">Email</span>
						<span class="platform__tile-desc">Blasts, sequences, deliverability tracking. Segmented by verification tier.</span>
					</div>
					<div class="platform__tile">
						<span class="platform__tile-name">SMS &amp; Calls</span>
						<span class="platform__tile-desc">Verified constituent targeting. 10DLC-ready.</span>
					</div>
					<div class="platform__tile">
						<span class="platform__tile-name">Events</span>
						<span class="platform__tile-desc">Mobilize and coordinate. Attendance feeds the verification funnel.</span>
					</div>
					<div class="platform__tile">
						<span class="platform__tile-name">Fundraising</span>
						<span class="platform__tile-desc">Contributions, donor management, compliance reporting.</span>
					</div>
					<div class="platform__tile">
						<span class="platform__tile-name">Legislation</span>
						<span class="platform__tile-desc">Track bills, monitor votes, trigger campaigns on activity.</span>
					</div>
					<div class="platform__tile">
						<span class="platform__tile-name">Decision Makers</span>
						<span class="platform__tile-desc">Follow across jurisdictions. Build scorecards. Prove accountability.</span>
					</div>
					<div class="platform__tile">
						<span class="platform__tile-name">Automation</span>
						<span class="platform__tile-desc">Verification-gated workflows. Multi-step sequences. Conditional triggers.</span>
					</div>
				</div>
			</section>

			<!-- ═══════════════════════════════════════════
			     BEAT 4 — INTERNATIONAL REACH
			     ═══════════════════════════════════════════ -->
			<section class="beat beat--reach" aria-labelledby="reach-heading">
				<h2 id="reach-heading" class="beat__heading">One packet model across fragmented intake.</h2>
				<p class="beat__subheading">
					Commons delivers verified packets across US Congress, state legislatures, federal agencies, and local boards.
				</p>

				<ul class="reach__list" role="list">
					<li class="reach__item">U.S. Congress</li>
					<li class="reach__item"><a href="/org/for/state-legislature" class="reach__link">State legislatures</a></li>
					<li class="reach__item"><a href="/org/for/agency-rulemaking" class="reach__link">Federal agency dockets</a></li>
					<li class="reach__item">Governor's offices</li>
					<li class="reach__item">County boards</li>
					<li class="reach__item"><a href="/org/for/local-government" class="reach__link">City councils</a></li>
					<li class="reach__item">School boards</li>
					<li class="reach__item">Water districts</li>
					<li class="reach__item">Transit authorities</li>
				</ul>

				<p class="reach__international">
					<span class="reach__international-label">International adapters shipping 2026:</span> UK Parliament, EU Parliament, Bundestag e-petitions.
				</p>

				<p class="reach__footer">
					<span class="reach__stat"><Datum value={24} /></span> U.S. boundary types live today &middot; <span class="reach__stat"><Datum value={90887} /></span> local government entities covered.
				</p>
				<p class="reach__citation">
					U.S. Census Bureau Local Governments 2022 &middot; regulations.gov v4 &middot; UK petition.parliament.uk, EU ECI, Bundestag e-petitions
				</p>
			</section>

			<!-- ═══════════════════════════════════════════
			     BEAT 5 — THE INCUMBENT WINDOW
			     ═══════════════════════════════════════════ -->
			<section class="beat beat--window" aria-labelledby="window-heading">
				<h2 id="window-heading" class="window__pull-quote">
					The progressive data stack is being renegotiated. Eighty of the largest coalition data-operations orgs are running RFPs for its replacement.
				</h2>

				<p class="window__body">
					The incumbent voter-file platform has shed engineering capacity and is priced for enterprises its customers no longer are. Switching costs &mdash; list migration, integration rewiring, staff retraining &mdash; kept orgs in place. The 2026 RFP window is when those costs get shared across the coalition rather than borne alone.
				</p>

				<p class="window__citation">
					The Movement Cooperative next-generation voter DB RFP (80+ member orgs) &middot; Higher Ground Labs, <cite>Where do we go from here?</cite> (2024) &middot; Sifry, <cite>Living with VANxiety</cite> (2023)
				</p>
			</section>

			<!-- ═══════════════════════════════════════════
			     BEAT 6 — BETA ACCESS
			     ═══════════════════════════════════════════ -->
			<section class="beat beat--access" aria-labelledby="access-heading">
				<h2 id="access-heading" class="beat__heading">Private beta. Founding organizations.</h2>
				<p class="beat__subheading">
					We're onboarding advocacy organizations individually &mdash; not self-serve, not a free trial. Direct access to the engineering team. Your use case shapes the platform.
				</p>

				<dl class="access__points">
					<div class="access__point">
						<dt class="access__point-label">Import</dt>
						<dd class="access__point-desc">Bring your supporter list. We district-match and start the verification funnel on day one.</dd>
					</div>
					<div class="access__point">
						<dt class="access__point-label">Ship</dt>
						<dd class="access__point-desc">Produce your first verified proof packet during the beta period.</dd>
					</div>
					<div class="access__point">
						<dt class="access__point-label">Shape</dt>
						<dd class="access__point-desc">Founding partners get a permanent voice in the roadmap. Your feedback directly informs the product.</dd>
					</div>
				</dl>
			</section>

			<!-- ═══════════════════════════════════════════
			     BEAT 7 — TERMINAL CTA (waitlist)
			     ═══════════════════════════════════════════ -->
			<section class="beat beat--cta">
				{#if waitlistSubmitted}
					<div class="access__confirmed">
						<p class="access__confirmed-text">You're on the list. We'll be in touch.</p>
					</div>
				{:else if user}
					<button class="cta" onclick={handleRequestAccess} disabled={waitlistSubmitting}>
						{waitlistSubmitting ? 'Requesting...' : 'Request beta access'}
					</button>
					{#if waitlistError}
						<p class="waitlist-form__error">{waitlistError}</p>
					{/if}
				{:else}
					<form class="waitlist-form" onsubmit={(e) => { e.preventDefault(); handleWaitlist(); }}>
						<div class="waitlist-form__row">
							<input
								type="email"
								class="waitlist-form__input"
								placeholder="you@yourorg.org"
								bind:value={waitlistEmail}
								required
							/>
							<button type="submit" class="cta" disabled={waitlistSubmitting || !waitlistEmail.trim()}>
								{waitlistSubmitting ? 'Joining...' : 'Join the waitlist'}
							</button>
						</div>
						{#if waitlistError}
							<p class="waitlist-form__error">{waitlistError}</p>
						{/if}
						<p class="waitlist-form__note">No spam. We'll reach out when we're ready to onboard your org.</p>
					</form>
				{/if}
			</section>
		</article>
	{/if}
</div>

<style>
	/* ═══════════════════════════════════════════
	   ORG-V2 — argument, not pitch
	   Warm cream ground. Specimen + inbox are the only
	   bounded artifacts. Everything else sits on ground.
	   ═══════════════════════════════════════════ */

	.org-page {
		min-height: 100vh;
		padding: 1.5rem 1.5rem 4rem;
		background: oklch(0.995 0.004 55);
	}

	@media (min-width: 640px) {
		.org-page { padding: 2rem 2rem 5rem; }
	}

	@media (min-width: 1024px) {
		.org-page {
			padding: 2.5rem 3rem 6rem;
			padding-inline: max(3rem, calc(50% - 27rem));
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* ═══ BACK LINK ═══ */
	.back-link {
		display: inline-block;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.52 0.02 250);
		text-decoration: none;
		margin-bottom: 3rem;
		transition: color 200ms ease-out;
	}

	.back-link:hover { color: oklch(0.35 0.06 180); }

	@media (min-width: 640px) {
		.back-link { margin-bottom: 4rem; }
	}

	/* ═══ RETURNING USER (preserved from /org) ═══ */
	.org-page__inner {
		max-width: 28rem;
		width: 100%;
	}

	.page-heading {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.25rem, 1.188rem + 0.31vw, 1.5rem);
		font-weight: 700;
		color: oklch(0.2 0.03 250);
		margin: 0 0 1.5rem;
	}

	.org-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.org-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border-radius: 6px;
		border: 1px solid oklch(0.92 0.01 250);
		background: oklch(0.99 0.003 250);
		text-decoration: none;
		transition: border-color 200ms ease-out, background 200ms ease-out;
	}

	.org-card:hover {
		border-color: oklch(0.8 0.04 180);
		background: oklch(0.98 0.008 180 / 0.5);
	}

	.org-card__avatar {
		width: 2rem;
		height: 2rem;
		border-radius: 6px;
		object-fit: cover;
		flex-shrink: 0;
	}

	.org-card__avatar--fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		background: oklch(0.92 0.06 180);
		color: oklch(0.4 0.12 180);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.org-card__info {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		flex: 1;
	}

	.org-card__name {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		color: oklch(0.25 0.02 250);
	}

	.org-card__meta {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.5 0.02 250);
		text-transform: capitalize;
	}

	.org-card__arrow {
		font-size: 0.875rem;
		color: oklch(0.6 0.02 250);
		flex-shrink: 0;
		transition: transform 150ms ease-out, color 150ms ease-out;
	}

	.org-card:hover .org-card__arrow {
		transform: translateX(2px);
		color: oklch(0.45 0.08 180);
	}

	.create-link {
		display: inline-block;
		margin-top: 1.25rem;
		padding: 0;
		border: none;
		background: transparent;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.5 0.06 180);
		cursor: pointer;
		transition: color 150ms ease-out;
	}

	.create-link:hover { color: oklch(0.38 0.1 180); }

	/* ═══════════════════════════════════════════
	   ARGUMENT — the composed surface
	   ═══════════════════════════════════════════ */
	.argument {
		width: 100%;
		max-width: 54rem;
	}

	.beat {
		max-width: 42rem;
	}

	/* Differentiated beat gaps — the narrative arc specifies cognitive pacing.
	   hero→evidence: tight coupling (same argument, different angle)
	   evidence→mechanism: moderate (from problem to proposal)
	   mechanism→reach: large (from specimen to system)
	   reach→window: moderate (from system to market moment)
	   window→price: largest (biggest cognitive pivot — now the commercial frame)
	   price→CTA: tight (action follows price directly) */
	.beat--problem { margin-bottom: 2rem; }
	.beat--evidence { margin-bottom: 2.75rem; max-width: 54rem; }
	.beat--mechanism { margin-bottom: 2.5rem; max-width: 54rem; }
	.beat--platform { margin-bottom: 2.5rem; max-width: 54rem; }
	.beat--reach { margin-bottom: 2.5rem; }
	.beat--window { margin-bottom: 4.25rem; }
	.beat--price { margin-bottom: 1.5rem; max-width: 54rem; } /* legacy — kept for specificity */

	@media (min-width: 768px) {
		.beat--problem { margin-bottom: 2.5rem; }
		.beat--evidence { margin-bottom: 3.5rem; }
		.beat--mechanism { margin-bottom: 3rem; }
		.beat--platform { margin-bottom: 3.5rem; }
		.beat--reach { margin-bottom: 3rem; }
		.beat--window { margin-bottom: 5.5rem; }
		.beat--price { margin-bottom: 2rem; }
	}

	.beat__eyebrow {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		font-weight: 400;
		line-height: 1.5;
		color: oklch(0.55 0.01 250);
		margin: 0 0 1.25rem;
		letter-spacing: 0.02em;
	}

	.beat__eyebrow-num {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: oklch(0.35 0.02 250);
	}

	.beat__heading {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.375rem, 1.1rem + 1.2vw, 1.75rem);
		line-height: 1.22;
		font-weight: 700;
		color: oklch(0.2 0.03 250);
		margin: 0 0 0.625rem;
		letter-spacing: -0.01em;
		max-width: 36rem;
	}

	.beat__subheading {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.55;
		font-weight: 400;
		color: oklch(0.42 0.015 250);
		margin: 0 0 1.75rem;
		max-width: 36rem;
	}

	.beat__subheading-num {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: oklch(0.3 0.02 250);
	}

	/* ═══════════════════════════════════════════
	   BEAT 1 — THE PROBLEM
	   ═══════════════════════════════════════════ */
	.problem__thesis {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.5rem, 1.05rem + 2.2vw, 2.375rem);
		line-height: 1.18;
		font-weight: 700;
		color: oklch(0.18 0.03 250);
		margin: 0 0 1.5rem;
		letter-spacing: -0.015em;
		max-width: 36rem;
	}

	.problem__stat {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		color: oklch(0.35 0.12 165);
	}

	.problem__stat--weak {
		color: oklch(0.5 0.01 250);
	}

	.problem__bridge {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.0625rem, 0.98rem + 0.5vw, 1.1875rem);
		line-height: 1.5;
		font-weight: 500;
		color: oklch(0.32 0.02 250);
		margin: 0 0 1.125rem;
		max-width: 34rem;
	}

	.problem__counter {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1rem, 0.95rem + 0.4vw, 1.125rem);
		line-height: 1.55;
		font-weight: 400;
		color: oklch(0.32 0.02 250);
		margin: 0 0 1.25rem;
		max-width: 34rem;
	}

	.problem__counter em {
		font-style: italic;
		color: oklch(0.22 0.03 250);
		font-weight: 500;
	}

	.problem__citation {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		line-height: 1.55;
		color: oklch(0.55 0.01 250);
		margin: 0;
		letter-spacing: 0.01em;
	}

	.problem__citation cite {
		font-style: italic;
	}

	/* ═══════════════════════════════════════════
	   BEAT 2 — INBOX ARTIFACT
	   White on cream. Earns a border + subtle shadow.
	   ═══════════════════════════════════════════ */
	.inbox-artifact {
		margin: 0 0 1.25rem;
		max-width: 42rem;
		background: #ffffff;
		border: 1px solid oklch(0.88 0.006 250);
		box-shadow:
			0 1px 2px oklch(0.15 0.01 250 / 0.04),
			0 4px 14px oklch(0.15 0.01 250 / 0.06);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.3 0.01 250);
		overflow: hidden;
	}

	.inbox-artifact__chrome {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0.4rem 0.625rem;
		background: oklch(0.96 0.003 250);
		border-bottom: 1px solid oklch(0.91 0.005 250);
	}

	.inbox-artifact__dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: oklch(0.82 0.004 250);
	}

	.inbox-artifact__chrome-label {
		margin-left: 0.625rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		color: oklch(0.55 0.01 250);
		letter-spacing: 0.02em;
	}

	.inbox-artifact__toolbar {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: 0.5rem 0.875rem;
		border-bottom: 1px solid oklch(0.93 0.005 250);
		background: oklch(0.985 0.003 250);
	}

	.inbox-artifact__filter {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		color: oklch(0.5 0.01 250);
	}

	.inbox-artifact__count {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		color: oklch(0.42 0.015 250);
	}

	.inbox-artifact__count-num {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: oklch(0.22 0.03 250);
	}

	.inbox-artifact__list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.inbox-row {
		display: grid;
		grid-template-columns: 2.25rem 5rem 1fr;
		gap: 0.5rem;
		padding: 0.5rem 0.875rem;
		border-bottom: 1px solid oklch(0.945 0.004 250);
		font-size: 0.6875rem;
		line-height: 1.4;
		align-items: baseline;
	}

	@media (min-width: 480px) {
		.inbox-row {
			grid-template-columns: 2.5rem 6rem 1fr;
			gap: 0.625rem;
			padding: 0.4375rem 0.875rem;
		}
	}

	.inbox-row__time {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		color: oklch(0.62 0.01 250);
		font-variant-numeric: tabular-nums;
	}

	.inbox-row__from {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-weight: 600;
		color: oklch(0.22 0.03 250);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.inbox-row__subject {
		font-family: 'Satoshi', system-ui, sans-serif;
		color: oklch(0.38 0.015 250);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.inbox-row--dim { opacity: 0.78; }
	.inbox-row--dimmer { opacity: 0.55; }
	.inbox-row--dimmest { opacity: 0.35; }

	.inbox-row__ellipsis {
		list-style: none;
		padding: 0.75rem 0.875rem 0.875rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		font-weight: 500;
		color: oklch(0.48 0.015 250);
		letter-spacing: 0.03em;
		text-align: center;
		background: oklch(0.98 0.003 250);
		border-top: 1px solid oklch(0.93 0.005 250);
	}

	.evidence__caption {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.55;
		color: oklch(0.32 0.02 250);
		margin: 0 0 1rem;
		max-width: 42rem;
	}

	.evidence__citation {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		line-height: 1.55;
		color: oklch(0.55 0.01 250);
		margin: 0;
		letter-spacing: 0.01em;
	}

	.evidence__citation + .evidence__citation {
		margin-top: 0.375rem;
	}

	.evidence__citation cite { font-style: italic; }

	/* ═══════════════════════════════════════════
	   BEAT 3 — MECHANISM (specimen + filter map)
	   Side-by-side at lg: specimen (left) + filter map (right)
	   ═══════════════════════════════════════════ */
	.mechanism__layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: 2.5rem;
	}

	@media (min-width: 1024px) {
		.mechanism__layout {
			grid-template-columns: 5fr 4fr;
			gap: 2.5rem;
			align-items: start;
		}
	}

	.mechanism__specimen-block {
		margin-bottom: 0;
		max-width: none;
	}

	.mechanism__provenance {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		font-weight: 400;
		line-height: 1.5;
		color: oklch(0.58 0.008 250);
		margin: 0 0 0.625rem;
		letter-spacing: 0.02em;
	}

	.specimen {
		margin: 0;
		padding: 0;
		background: #ffffff;
		border: 1px solid oklch(0.84 0.008 250);
		box-shadow:
			0 1px 2px oklch(0.15 0.01 250 / 0.05),
			0 4px 16px oklch(0.15 0.01 250 / 0.07);
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		line-height: 1.6;
		color: oklch(0.3 0.02 250);
	}

	@media (min-width: 640px) {
		.specimen { font-size: 0.8125rem; }
	}

	.specimen__title {
		padding: 0.625rem 1.25rem;
		font-size: 0.5625rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: oklch(0.5 0.012 250);
		border-bottom: 1px solid oklch(0.91 0.006 250);
		background: oklch(0.985 0.002 250);
	}

	@media (min-width: 640px) {
		.specimen__title {
			padding: 0.75rem 2rem;
			font-size: 0.625rem;
		}
	}

	.specimen__meta { padding: 1.125rem 1.25rem 0; }

	@media (min-width: 640px) {
		.specimen__meta { padding: 1.375rem 2rem 0; }
	}

	.specimen__row {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 0.125rem;
	}

	@media (max-width: 479px) {
		.specimen__row { flex-direction: column; gap: 0; }
	}

	.specimen__label {
		color: oklch(0.55 0.01 250);
		min-width: 5.5rem;
		flex-shrink: 0;
	}

	.specimen__value {
		color: oklch(0.2 0.02 250);
		font-weight: 500;
	}

	.specimen__divider {
		height: 1px;
		background: oklch(0.91 0.006 250);
		margin: 0.875rem 1.25rem;
	}

	@media (min-width: 640px) {
		.specimen__divider { margin: 1rem 2rem; }
	}

	.specimen__hero {
		padding: 1rem 1.25rem 1.25rem;
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	@media (min-width: 640px) {
		.specimen__hero { padding: 1.5rem 2rem 1.75rem; }
	}

	.specimen__count {
		font-size: 2.5rem;
		font-weight: 700;
		color: oklch(0.35 0.12 165);
		line-height: 1;
	}

	@media (min-width: 640px) {
		.specimen__count { font-size: 3.25rem; }
	}

	.specimen__count-label {
		font-size: 0.6875rem;
		color: oklch(0.48 0.01 250);
		font-weight: 400;
		line-height: 1.35;
	}

	.specimen__evidence {
		padding: 0 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.4375rem;
	}

	@media (min-width: 640px) {
		.specimen__evidence { padding: 0 2rem; }
	}

	/* ═══ Self-labeling stacked segments ═══
	   The bar IS the legend. Each segment contains its label + count.
	   Depth = visual weight: darker segment = deeper verification.
	   No separate legend. No chart convention. The visualization
	   is the information. */
	.specimen__section-label {
		font-size: 0.5625rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: oklch(0.5 0.012 250);
		margin: 0.25rem 0 0.375rem;
	}

	@media (min-width: 640px) {
		.specimen__section-label { font-size: 0.625rem; }
	}

	.specimen__section-label:first-child {
		margin-top: 0;
	}

	.specimen__stack {
		display: flex;
		height: 2rem;
		border-radius: 3px;
		overflow: hidden;
		gap: 1px;
		background: oklch(0.91 0.005 250);
	}

	@media (min-width: 640px) {
		.specimen__stack { height: 2.25rem; }
	}

	.specimen__stack-seg {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 0.5rem;
		min-width: 3rem;
		overflow: hidden;
		gap: 0.25rem;
	}

	.specimen__stack-name {
		font-size: 0.5625rem;
		font-weight: 500;
		letter-spacing: 0.02em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
	}

	@media (min-width: 640px) {
		.specimen__stack-name { font-size: 0.625rem; }
	}

	.specimen__stack-count {
		font-weight: 700;
		font-size: 0.75rem;
		flex-shrink: 0;
	}

	@media (min-width: 640px) {
		.specimen__stack-count { font-size: 0.8125rem; }
	}

	/* Deep: government ID, individual voice — proven, authoritative */
	.specimen__stack-seg--deep {
		background: oklch(0.38 0.1 170);
		color: oklch(0.97 0.005 170);
	}

	/* Mid: address verified — moderate depth, supportive */
	.specimen__stack-seg--mid {
		background: oklch(0.92 0.04 175);
		color: oklch(0.25 0.03 250);
	}

	/* Muted: shared template — absence of original voice */
	.specimen__stack-seg--muted {
		background: oklch(0.94 0.005 250);
		color: oklch(0.4 0.015 250);
	}

	/* District map — real MapLibre + Protomaps tiles */
	.specimen__map-container {
		height: 160px;
		margin: 0.25rem 0;
		border-radius: 3px;
		overflow: hidden;
		border: 1px solid oklch(0.91 0.006 250);
	}

	@media (min-width: 640px) {
		.specimen__map-container { height: 200px; }
	}

	.specimen__geo-meta {
		font-size: 0.625rem;
		color: oklch(0.5 0.01 250);
		padding-top: 0.25rem;
		margin: 0;
	}

	@media (min-width: 640px) {
		.specimen__geo-meta { font-size: 0.6875rem; }
	}

	/* Temporal arrival — Pulse sparkline with date context */
	.specimen__temporal-row {
		display: flex;
		align-items: flex-end;
		gap: 0.75rem;
		padding: 0.25rem 0 0;
	}

	@media (max-width: 479px) {
		.specimen__temporal-row {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.25rem;
		}
	}

	.specimen__temporal-caption {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.specimen__temporal-range {
		font-size: 0.6875rem;
		font-weight: 500;
		color: oklch(0.32 0.015 250);
	}

	.specimen__temporal-detail {
		font-size: 0.5625rem;
		color: oklch(0.52 0.008 250);
	}

	@media (min-width: 640px) {
		.specimen__temporal-range { font-size: 0.75rem; }
		.specimen__temporal-detail { font-size: 0.625rem; }
	}

	.specimen__seal {
		margin-top: 1rem;
		padding: 0.75rem 1.25rem;
		border-top: 1px solid oklch(0.88 0.01 165 / 0.4);
		background: oklch(0.97 0.008 165 / 0.35);
	}

	@media (min-width: 640px) {
		.specimen__seal { padding: 0.875rem 2rem; }
	}

	.specimen__seal-text {
		font-size: 0.6875rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		font-weight: 500;
		color: oklch(0.4 0.05 165);
	}

	@media (min-width: 640px) {
		.specimen__seal-text { font-size: 0.75rem; }
	}

	/* ═══ FILTER MAP — specimen field → staff question → citation ═══
	   Mobile: stronger row separation, field owns its own line, question is the visual peak.
	   Desktop: rows can breathe wider, same stacking. */
	.filter-map {
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	@media (min-width: 640px) {
		.filter-map { gap: 1.5rem; }
	}

	.filter-map__row {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.375rem;
		padding-top: 1.25rem;
		border-top: 1.5px solid oklch(0.84 0.008 250);
	}

	@media (min-width: 640px) {
		.filter-map__row {
			gap: 0.125rem;
			padding-top: 1.125rem;
			border-top-width: 1px;
			border-top-color: oklch(0.88 0.006 250);
		}
	}

	.filter-map__row:first-child {
		padding-top: 0;
		border-top: none;
	}

	.filter-map__field {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: oklch(0.35 0.12 165);
		margin: 0 0 0.125rem;
	}

	.filter-map__answer {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.4;
		font-weight: 400;
		color: oklch(0.5 0.015 250);
		margin: 0;
	}

	.filter-map__question {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.125rem, 1rem + 0.6vw, 1.25rem);
		line-height: 1.3;
		font-weight: 600;
		color: oklch(0.18 0.03 250);
		font-style: italic;
		margin: 0.125rem 0 0.5rem;
		letter-spacing: -0.005em;
	}

	.filter-map__citation {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		line-height: 1.55;
		color: oklch(0.55 0.01 250);
		margin: 0;
		letter-spacing: 0.01em;
	}

	/* ═══════════════════════════════════════════
	   BEAT 3b — PLATFORM (full stack grid)
	   ═══════════════════════════════════════════ */
	.platform__grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.25rem 1.5rem;
	}

	@media (min-width: 768px) {
		.platform__grid {
			grid-template-columns: repeat(3, 1fr);
			gap: 1.5rem 2.5rem;
		}
	}

	.platform__tile {
		display: flex;
		flex-direction: column;
		gap: 0.3125rem;
	}

	.platform__tile-name {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: oklch(0.22 0.03 250);
	}

	.platform__tile-desc {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: oklch(0.48 0.015 250);
	}

	/* ═══════════════════════════════════════════
	   BEAT 4 — REACH
	   ═══════════════════════════════════════════ */
	.reach__list {
		list-style: none;
		margin: 0 0 2rem;
		padding: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem 1.25rem;
		max-width: 42rem;
	}

	@media (min-width: 480px) {
		.reach__list {
			gap: 0.625rem 2.5rem;
		}
	}

	@media (min-width: 768px) {
		.reach__list {
			grid-template-columns: repeat(3, 1fr);
			gap: 0.75rem 2.5rem;
		}
	}

	.reach__item {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(0.9375rem, 0.85rem + 0.6vw, 1.25rem);
		font-weight: 700;
		line-height: 1.3;
		color: oklch(0.22 0.03 250);
		letter-spacing: -0.005em;
	}

	.reach__link {
		color: inherit;
		text-decoration: none;
		border-bottom: 1px solid oklch(0.82 0.06 180 / 0.5);
		transition: border-bottom-color 150ms ease-out, color 150ms ease-out;
	}

	.reach__link:hover {
		color: oklch(0.38 0.11 180);
		border-bottom-color: oklch(0.45 0.1 180);
	}

	.reach__link:focus-visible {
		outline: 2px solid oklch(0.48 0.2 280);
		outline-offset: 2px;
		border-radius: 2px;
	}

	.reach__item--future {
		color: oklch(0.5 0.02 250);
		font-weight: 500;
	}

	.reach__item-soon {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: oklch(0.5 0.1 180);
		margin-left: 0.375rem;
		vertical-align: 0.1em;
	}

	.reach__international {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		line-height: 1.5;
		font-weight: 400;
		color: oklch(0.52 0.012 250);
		margin: 0 0 1.5rem;
		max-width: 42rem;
	}

	.reach__international-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: oklch(0.55 0.01 250);
	}

	.reach__footer {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.55;
		font-weight: 400;
		color: oklch(0.38 0.015 250);
		margin: 0 0 0.75rem;
		max-width: 40rem;
	}

	.reach__stat {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		color: oklch(0.22 0.03 250);
	}

	.reach__citation {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		line-height: 1.55;
		color: oklch(0.55 0.01 250);
		margin: 0;
		letter-spacing: 0.01em;
		max-width: 42rem;
	}

	/* ═══════════════════════════════════════════
	   BEAT 5 — INCUMBENT WINDOW
	   ═══════════════════════════════════════════ */
	.window__pull-quote {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: clamp(1.3125rem, 1rem + 1.6vw, 1.75rem);
		line-height: 1.28;
		font-weight: 600;
		color: oklch(0.2 0.03 250);
		margin: 0 0 1.25rem;
		padding-left: 1.125rem;
		border-left: 2px solid oklch(0.55 0.12 165);
		letter-spacing: -0.01em;
		max-width: 36rem;
	}

	.window__body {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 1rem;
		line-height: 1.6;
		font-weight: 400;
		color: oklch(0.32 0.02 250);
		margin: 0 0 1.25rem;
		max-width: 36rem;
	}

	.window__citation {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.75rem;
		line-height: 1.55;
		color: oklch(0.55 0.01 250);
		margin: 0;
		letter-spacing: 0.01em;
		max-width: 40rem;
	}

	.window__citation cite { font-style: italic; }

	/* ═══════════════════════════════════════════
	   BEAT 6 — BETA ACCESS
	   ═══════════════════════════════════════════ */
	.beat--access {
		margin-bottom: 1.5rem;
	}

	@media (min-width: 768px) {
		.beat--access { margin-bottom: 2rem; }
	}

	.access__points {
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	@media (min-width: 640px) {
		.access__points {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 2rem;
		}
	}

	.access__point {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.access__point-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: oklch(0.35 0.12 165);
		margin: 0;
	}

	.access__point-desc {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		line-height: 1.55;
		color: oklch(0.38 0.015 250);
		margin: 0;
	}

	.access__confirmed {
		padding: 1.25rem 1.5rem;
		border-radius: 6px;
		border: 1px solid oklch(0.82 0.08 165 / 0.4);
		background: oklch(0.97 0.01 165 / 0.3);
	}

	.access__confirmed-text {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 600;
		color: oklch(0.32 0.08 165);
		margin: 0;
	}

	/* ═══════════════════════════════════════════
	   BEAT 7 — CTA (waitlist)
	   ═══════════════════════════════════════════ */
	.beat--cta {
		margin-top: 2rem;
		max-width: 32rem;
	}

	.waitlist-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.waitlist-form__row {
		display: flex;
		gap: 0.5rem;
	}

	@media (max-width: 479px) {
		.waitlist-form__row {
			flex-direction: column;
		}
	}

	.waitlist-form__input {
		flex: 1;
		min-width: 0;
		padding: 0.75rem 1rem;
		border-radius: 4px;
		border: 1px solid oklch(0.84 0.008 250);
		background: white;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		color: oklch(0.2 0.02 250);
		outline: none;
		transition: border-color 150ms ease-out;
	}

	.waitlist-form__input:focus {
		border-color: oklch(0.65 0.1 180);
	}

	.waitlist-form__input::placeholder {
		color: oklch(0.65 0.01 250);
	}

	.waitlist-form__error {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.5 0.15 25);
		margin: 0;
	}

	.waitlist-form__note {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		color: oklch(0.58 0.01 250);
		margin: 0;
	}

	/* ═══════════════════════════════════════════
	   SHARED: CTA + FORM
	   ═══════════════════════════════════════════ */
	.cta {
		display: inline-block;
		padding: 0.75rem 1.5rem;
		min-height: 44px;
		border-radius: 4px;
		border: 1px solid oklch(0.45 0.1 180);
		background: oklch(0.42 0.1 180);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		color: #ffffff;
		cursor: pointer;
		transition: background 150ms ease-out, border-color 150ms ease-out;
	}

	.cta:hover {
		background: oklch(0.38 0.11 180);
		border-color: oklch(0.38 0.11 180);
	}

	.cta:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.create-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.25rem;
		border-radius: 6px;
		border: 1px solid oklch(0.88 0.015 180 / 0.4);
		background: oklch(0.985 0.005 180 / 0.5);
	}

	.create-form__label {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.create-form__label-text {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		font-weight: 600;
		color: oklch(0.42 0.02 250);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.create-form__input {
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		border: 1px solid oklch(0.88 0.02 250);
		background: white;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		color: oklch(0.2 0.02 250);
		outline: none;
		transition: border-color 150ms ease-out;
	}

	.create-form__input:focus {
		border-color: oklch(0.65 0.1 180);
	}

	.create-form__input::placeholder {
		color: oklch(0.7 0.01 250);
	}

	.create-form__slug-row {
		display: flex;
		align-items: center;
	}

	.create-form__slug-prefix {
		padding: 0.5rem 0 0.5rem 0.75rem;
		border-radius: 6px 0 0 6px;
		border: 1px solid oklch(0.88 0.02 250);
		border-right: none;
		background: oklch(0.96 0.005 250);
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.8125rem;
		color: oklch(0.5 0.02 250);
		user-select: none;
	}

	.create-form__input--slug {
		border-radius: 0 6px 6px 0;
		flex: 1;
		min-width: 0;
		font-family: 'JetBrains Mono', monospace;
	}

	.create-form__error {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.5 0.15 25);
		margin: 0;
	}

	.create-form__actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 0.25rem;
	}

	.create-form__cancel {
		padding: 0.5rem 1rem;
		border: none;
		background: transparent;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.5 0.02 250);
		cursor: pointer;
		transition: color 150ms ease-out;
	}

	.create-form__cancel:hover {
		color: oklch(0.3 0.02 250);
	}
</style>
