<script lang="ts">
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';

	const labels = getJurisdictionLabels();
</script>

<svelte:head>
	<title>Coordination Integrity Scores | Commons</title>
	<meta name="description" content="How Commons measures whether campaign participation is organic, diverse, and sustained." />
	<meta property="og:type" content="article" />
	<meta property="og:url" content="https://commons.email/about/integrity" />
	<meta property="og:title" content="Coordination Integrity Scores | Commons" />
	<meta property="og:description" content="How Commons measures whether campaign participation is organic, diverse, and sustained." />
</svelte:head>

<div class="mx-auto max-w-3xl space-y-12">
	<header class="space-y-4">
		<p class="text-[10px] font-mono uppercase tracking-wider text-text-quaternary">Methodology</p>
		<h1 class="text-3xl font-bold text-text-primary">Coordination Integrity Scores</h1>
		<p class="text-base text-text-secondary leading-relaxed">
			Commons computes five coordination readings from campaign data for the organization running the campaign. These diagnostics measure whether participation is organic, diverse, and sustained &mdash; or manufactured, concentrated, and bursty. They are not included in the message a recipient receives, and no reading is self-reported.
		</p>
		<p class="text-sm text-text-tertiary leading-relaxed">
			These readings can invert: a machine-distributed campaign can score higher than an organic one. They are diagnostics for the organization running the campaign, not a measure of legitimacy. No action available. Both directions of this reading are ambiguous.
		</p>
	</header>

	<!-- GDS -->
	<section class="space-y-3 border-t border-surface-border pt-8">
		<div class="flex items-baseline justify-between">
			<h2 class="text-lg font-semibold text-text-primary">Geographic Diversity Score</h2>
			<span class="font-mono text-xs text-text-quaternary">GDS</span>
		</div>
		<p class="text-sm text-text-secondary leading-relaxed">
			Measures how spread out participants are across legislative districts. Computed as <code class="font-mono text-xs bg-surface-overlay px-1.5 py-0.5 rounded">1 &minus; HHI</code>, where HHI is the Herfindahl&ndash;Hirschman Index &mdash; the sum of each district's share squared.
		</p>
		<div class="overflow-hidden rounded-lg border border-surface-border">
			<table class="w-full text-sm">
				<thead><tr class="bg-surface-overlay text-text-tertiary text-left">
					<th class="px-4 py-2 font-mono font-medium">Score</th><th class="px-4 py-2 font-medium">Interpretation</th>
				</tr></thead>
				<tbody class="divide-y divide-surface-border">
					<tr><td class="px-4 py-2 font-mono">0.90+</td><td class="px-4 py-2 text-text-secondary">Actions span many districts evenly</td></tr>
					<tr><td class="px-4 py-2 font-mono">0.50&ndash;0.89</td><td class="px-4 py-2 text-text-secondary">Actions span several districts, with some district clustering</td></tr>
					<tr><td class="px-4 py-2 font-mono">&lt; 0.50</td><td class="px-4 py-2 text-text-secondary">Concentrated in few districts</td></tr>
				</tbody>
			</table>
		</div>
		<p class="text-xs text-text-tertiary">Privacy: Computed from one-way district hashes, never addresses. No minimum-count floor is applied to districts, so a district with one action can appear. Neighborhood-level (H3 cell) counts are withheld below 5 actions.</p>
	</section>

	<!-- ALD -->
	<section class="space-y-3 border-t border-surface-border pt-8">
		<div class="flex items-baseline justify-between">
			<h2 class="text-lg font-semibold text-text-primary">Message Authenticity</h2>
			<span class="font-mono text-xs text-text-quaternary">ALD</span>
		</div>
		<p class="text-sm text-text-secondary leading-relaxed">
			Measures how many message hashes are distinct. Computed as the ratio of unique message hashes to total message hashes; repeated hashes lower the ratio.
		</p>
		<div class="overflow-hidden rounded-lg border border-surface-border">
			<table class="w-full text-sm">
				<thead><tr class="bg-surface-overlay text-text-tertiary text-left">
					<th class="px-4 py-2 font-mono font-medium">Score</th><th class="px-4 py-2 font-medium">Interpretation</th>
				</tr></thead>
				<tbody class="divide-y divide-surface-border">
					<tr><td class="px-4 py-2 font-mono">0.90+</td><td class="px-4 py-2 text-text-secondary">At least 90% as many distinct message hashes as messages</td></tr>
					<tr><td class="px-4 py-2 font-mono">0.50&ndash;0.89</td><td class="px-4 py-2 text-text-secondary">Between 50% and 89% as many distinct message hashes as messages</td></tr>
					<tr><td class="px-4 py-2 font-mono">&lt; 0.50</td><td class="px-4 py-2 text-text-secondary">Fewer than 50% as many distinct message hashes as messages</td></tr>
				</tbody>
			</table>
		</div>
		<p class="text-xs text-text-tertiary">Privacy: Only message hashes are compared, never content.</p>
	</section>

	<!-- Temporal Entropy -->
	<section class="space-y-3 border-t border-surface-border pt-8">
		<div class="flex items-baseline justify-between">
			<h2 class="text-lg font-semibold text-text-primary">Timing Pattern</h2>
			<span class="font-mono text-xs text-text-quaternary">H(t)</span>
		</div>
		<p class="text-sm text-text-secondary leading-relaxed">
			Measures how participation is distributed over time using Shannon entropy over hourly buckets.
		</p>
		<div class="overflow-hidden rounded-lg border border-surface-border">
			<table class="w-full text-sm">
				<thead><tr class="bg-surface-overlay text-text-tertiary text-left">
					<th class="px-4 py-2 font-mono font-medium">Normalized</th><th class="px-4 py-2 font-medium">Interpretation</th>
				</tr></thead>
				<tbody class="divide-y divide-surface-border">
					<tr><td class="px-4 py-2 font-mono">0.65+</td><td class="px-4 py-2 text-text-secondary">Actions are distributed across multiple hourly buckets</td></tr>
					<tr><td class="px-4 py-2 font-mono">0.33&ndash;0.64</td><td class="px-4 py-2 text-text-secondary">Actions have some temporal spread and some clustering</td></tr>
					<tr><td class="px-4 py-2 font-mono">&lt; 0.33</td><td class="px-4 py-2 text-text-secondary">Nearly all actions in a narrow time window</td></tr>
				</tbody>
			</table>
		</div>
	</section>

	<!-- Burst Velocity -->
	<section class="space-y-3 border-t border-surface-border pt-8">
		<div class="flex items-baseline justify-between">
			<h2 class="text-lg font-semibold text-text-primary">Action Rate</h2>
			<span class="font-mono text-xs text-text-quaternary">BV</span>
		</div>
		<p class="text-sm text-text-secondary leading-relaxed">
			The ratio of the peak hourly action count to the average count across hourly buckets that contain actions.
		</p>
		<div class="overflow-hidden rounded-lg border border-surface-border">
			<table class="w-full text-sm">
				<thead><tr class="bg-surface-overlay text-text-tertiary text-left">
					<th class="px-4 py-2 font-mono font-medium">Score</th><th class="px-4 py-2 font-medium">Interpretation</th>
				</tr></thead>
				<tbody class="divide-y divide-surface-border">
					<tr><td class="px-4 py-2 font-mono">1.0&ndash;2.0</td><td class="px-4 py-2 text-text-secondary">The peak hourly count is up to twice the active-hour average</td></tr>
					<tr><td class="px-4 py-2 font-mono">2.0&ndash;5.0</td><td class="px-4 py-2 text-text-secondary">The peak hourly count is between two and five times the active-hour average</td></tr>
					<tr><td class="px-4 py-2 font-mono">5.0+</td><td class="px-4 py-2 text-text-secondary">The peak hourly count is at least five times the active-hour average</td></tr>
				</tbody>
			</table>
		</div>
	</section>

	<!-- CAI -->
	<section class="space-y-3 border-t border-surface-border pt-8">
		<div class="flex items-baseline justify-between">
			<h2 class="text-lg font-semibold text-text-primary">Engagement Depth</h2>
			<span class="font-mono text-xs text-text-quaternary">CAI</span>
		</div>
		<p class="text-sm text-text-secondary leading-relaxed">
			The ratio of actions from participants in the Veteran and Pillar tiers to actions from participants in the Active tier. It describes the participation-history mix recorded by Commons.
		</p>
		<div class="overflow-hidden rounded-lg border border-surface-border">
			<table class="w-full text-sm">
				<thead><tr class="bg-surface-overlay text-text-tertiary text-left">
					<th class="px-4 py-2 font-mono font-medium">Score</th><th class="px-4 py-2 font-medium">Interpretation</th>
				</tr></thead>
				<tbody class="divide-y divide-surface-border">
					<tr><td class="px-4 py-2 font-mono">0.50+</td><td class="px-4 py-2 text-text-secondary">Veteran- and Pillar-tier actions amount to at least half the Active-tier action count</td></tr>
					<tr><td class="px-4 py-2 font-mono">0.10&ndash;0.49</td><td class="px-4 py-2 text-text-secondary">Veteran- and Pillar-tier actions amount to between one tenth and just under half the Active-tier action count</td></tr>
					<tr><td class="px-4 py-2 font-mono">&lt; 0.10</td><td class="px-4 py-2 text-text-secondary">Veteran- and Pillar-tier actions amount to less than one tenth of the Active-tier action count</td></tr>
				</tbody>
			</table>
		</div>
		<p class="text-xs text-text-tertiary">Engagement tiers (0&ndash;4) measure platform participation history, not identity verification level.</p>
	</section>

	<!-- Privacy -->
	<section class="space-y-3 border-t border-surface-border pt-8">
		<h2 class="text-lg font-semibold text-text-primary">What These Scores Never Reveal</h2>
		<ul class="list-disc pl-5 space-y-2 text-sm text-text-secondary">
			<li><strong class="text-text-primary">No individual addresses.</strong> Geographic diversity is computed from hashed district identifiers. The hash cannot be reversed to an address.</li>
			<li><strong class="text-text-primary">No message content.</strong> Message authenticity compares SHA-256 hashes. No text is stored or compared.</li>
			<li><strong class="text-text-primary">No individual attribution.</strong> Scores are aggregates. There is no way to trace a score back to a specific person.</li>
			<li><strong class="text-text-primary">Privacy floors are specific.</strong> Neighborhood-level (H3 cell) counts and engagement-tier counts are withheld below 5 entries; district-level counts have no minimum-count floor.</li>
		</ul>
	</section>

	<!-- Data practices (F-1.2 honesty pass) -->
	<section class="space-y-3 border-t border-surface-border pt-8" id="data-practices">
		<h2 class="text-lg font-semibold text-text-primary">What Commons Does With Your Data</h2>
		<p class="text-sm text-text-secondary">
			Plain-language summary of how we collect, use, and retain personal data.
			Full Terms of Service and Privacy Policy documents are forthcoming; until
			they ship, this section is the canonical disclosure on the Commons domain.
			Companion technical detail lives in our
			<a class="underline" href="https://github.com/communisaas/commons/blob/main/docs/security/KNOWN-LIMITATIONS.md">
				security limitations doc
			</a>.
		</p>
		<ul class="list-disc pl-5 space-y-2 text-sm text-text-secondary">
			<li>
				<strong class="text-text-primary">Legal basis (GDPR Art. 6(1)):</strong> we
				process address fields under our legitimate interest in district verification
				(Art. 6(1)(f)) and your account email under contract performance for
				authentication (Art. 6(1)(b)). For users in the EU/UK we honor the standard
				GDPR rights (access, rectification, erasure, portability, objection); contact
				information is on the homepage.
			</li>
			<li>
				<strong class="text-text-primary">Address fields — mDL path:</strong> when you
				verify with a state-issued mobile driver's license, your wallet shares postal
				code, city, and state with our servers. Those fields are used to derive your
				{labels.legislativeAdjective} district and may be represented afterward as encrypted
				ground-vault material and disclosed district/cell metadata. We do not store
				identity documents or keep plaintext address fields at rest.
			</li>
			<li>
				<strong class="text-text-primary">Address fields — Shadow Atlas path:</strong>
				your browser computes a cryptographic commitment to your district. Approximate
				coordinates may transit our servers briefly so we can confirm the district mapping
				is authentic. After successful attestation, the address can be saved as encrypted
				ground-vault material for future delivery.
			</li>
			<li>
				<strong class="text-text-primary">What we persist:</strong> a one-way district
				hash, disclosed district/cell metadata, encrypted ground-vault material, your
				account email (for sign-in and anti-sybil), engagement-tier counters, the actions
				you take through the platform, and operational logs stripped of plaintext address
				fields.
			</li>
			<li>
				<strong class="text-text-primary">Hardware-isolated processing (TEE / enclave)</strong>
				is on the roadmap; today the address-resolution and proof-witness paths run in
				our standard server runtime. Our retention commitment for raw address fields
				(seconds, not minutes) holds in both architectures.
			</li>
			<li>
				<strong class="text-text-primary">We do not currently sell your data, and we
				have no plans to.</strong> If our practices change in any way that would
				constitute a "sale" or "share for cross-context behavioral advertising" under
				CCPA, we will provide at least 30 days' notice via in-product banner and email
				before the change takes effect. We do not use third-party advertising
				trackers. We use minimal first-party analytics and operational telemetry.
			</li>
			<li>
				<strong class="text-text-primary">mDL verification</strong> is currently
				feature-flagged off; the surface is not reachable in production. When it goes
				live, replay and relay limits are documented in our
				<a class="underline" href="https://github.com/communisaas/commons/blob/main/docs/security/KNOWN-LIMITATIONS.md#f-13--mdoc-deviceauth-nonce-binding-partial-closure-2026-04-25">
					KNOWN-LIMITATIONS
				</a>
				file (F-1.3). Full DeviceAuth verification (T3) is a launch checkpoint.
			</li>
		</ul>
	</section>

	<footer class="border-t border-surface-border pt-8 pb-12 text-center">
		<p class="text-xs text-text-quaternary">
			commons.email &mdash; verification-backed civic coordination
		</p>
	</footer>
</div>
