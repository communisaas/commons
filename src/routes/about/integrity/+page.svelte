<svelte:head>
	<title>Coordination Integrity Scores | Commons</title>
	<meta name="description" content="How Commons measures whether campaign participation is organic, diverse, and sustained." />
</svelte:head>

<div class="mx-auto max-w-3xl space-y-12">
	<header class="space-y-4">
		<p class="text-[10px] font-mono uppercase tracking-wider text-text-quaternary">Methodology</p>
		<h1 class="text-3xl font-bold text-text-primary">Coordination Integrity Scores</h1>
		<p class="text-base text-text-secondary leading-relaxed">
			Every proof report delivered by Commons includes five integrity scores. These scores measure whether campaign participation is organic, diverse, and sustained &mdash; or manufactured, concentrated, and bursty. They are computed from real campaign data. No score is self-reported.
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
					<tr><td class="px-4 py-2 font-mono text-emerald-400">0.90+</td><td class="px-4 py-2 text-text-secondary">Actions span many districts evenly &mdash; strong geographic breadth</td></tr>
					<tr><td class="px-4 py-2 font-mono text-teal-400">0.50&ndash;0.89</td><td class="px-4 py-2 text-text-secondary">Moderate spread, some district clustering</td></tr>
					<tr><td class="px-4 py-2 font-mono text-text-quaternary">&lt; 0.50</td><td class="px-4 py-2 text-text-secondary">Concentrated in few districts</td></tr>
				</tbody>
			</table>
		</div>
		<p class="text-xs text-text-tertiary">Privacy: Computed from district hashes, not addresses. Districts with fewer than 5 actions are suppressed.</p>
	</section>

	<!-- ALD -->
	<section class="space-y-3 border-t border-surface-border pt-8">
		<div class="flex items-baseline justify-between">
			<h2 class="text-lg font-semibold text-text-primary">Message Authenticity</h2>
			<span class="font-mono text-xs text-text-quaternary">ALD</span>
		</div>
		<p class="text-sm text-text-secondary leading-relaxed">
			Measures how unique each participant's message is. Computed as the ratio of unique message hashes to total message hashes. When people write in their own words, it demonstrates genuine engagement.
		</p>
		<div class="overflow-hidden rounded-lg border border-surface-border">
			<table class="w-full text-sm">
				<thead><tr class="bg-surface-overlay text-text-tertiary text-left">
					<th class="px-4 py-2 font-mono font-medium">Score</th><th class="px-4 py-2 font-medium">Interpretation</th>
				</tr></thead>
				<tbody class="divide-y divide-surface-border">
					<tr><td class="px-4 py-2 font-mono text-emerald-400">0.90+</td><td class="px-4 py-2 text-text-secondary">Nearly every message is distinct &mdash; participants wrote their own words</td></tr>
					<tr><td class="px-4 py-2 font-mono text-teal-400">0.50&ndash;0.89</td><td class="px-4 py-2 text-text-secondary">Mix of personalized and template messages</td></tr>
					<tr><td class="px-4 py-2 font-mono text-text-quaternary">&lt; 0.50</td><td class="px-4 py-2 text-text-secondary">Most messages are identical copies</td></tr>
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
			Measures how evenly participation spreads over time using Shannon entropy over hourly buckets. Organic campaigns build over hours and days. Bot operations spike in minutes.
		</p>
		<div class="overflow-hidden rounded-lg border border-surface-border">
			<table class="w-full text-sm">
				<thead><tr class="bg-surface-overlay text-text-tertiary text-left">
					<th class="px-4 py-2 font-mono font-medium">Normalized</th><th class="px-4 py-2 font-medium">Interpretation</th>
				</tr></thead>
				<tbody class="divide-y divide-surface-border">
					<tr><td class="px-4 py-2 font-mono text-emerald-400">0.65+</td><td class="px-4 py-2 text-text-secondary">Sustained over many hours or days &mdash; organic growth</td></tr>
					<tr><td class="px-4 py-2 font-mono text-teal-400">0.33&ndash;0.64</td><td class="px-4 py-2 text-text-secondary">Some temporal spread, some bursts</td></tr>
					<tr><td class="px-4 py-2 font-mono text-text-quaternary">&lt; 0.33</td><td class="px-4 py-2 text-text-secondary">Nearly all actions in a narrow time window</td></tr>
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
			The ratio of peak hourly action count to average hourly count. This is the only inverted metric &mdash; lower is better. A steady pace indicates organic human engagement; extreme spikes suggest coordinated inorganic activity.
		</p>
		<div class="overflow-hidden rounded-lg border border-surface-border">
			<table class="w-full text-sm">
				<thead><tr class="bg-surface-overlay text-text-tertiary text-left">
					<th class="px-4 py-2 font-mono font-medium">Score</th><th class="px-4 py-2 font-medium">Interpretation</th>
				</tr></thead>
				<tbody class="divide-y divide-surface-border">
					<tr><td class="px-4 py-2 font-mono text-emerald-400">1.0&ndash;2.0</td><td class="px-4 py-2 text-text-secondary">Steady pace &mdash; actions flow in at a consistent rate</td></tr>
					<tr><td class="px-4 py-2 font-mono text-teal-400">2.0&ndash;5.0</td><td class="px-4 py-2 text-text-secondary">Some spikes, likely driven by media mentions or shares</td></tr>
					<tr><td class="px-4 py-2 font-mono text-amber-400">5.0+</td><td class="px-4 py-2 text-text-secondary">Extreme spike &mdash; may indicate coordinated inorganic activity</td></tr>
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
			The ratio of deeply engaged participants (Veterans + Pillars) to newer participants (Active tier). Measures whether the people behind a campaign have demonstrated sustained civic participation over time, or appeared for the first time.
		</p>
		<div class="overflow-hidden rounded-lg border border-surface-border">
			<table class="w-full text-sm">
				<thead><tr class="bg-surface-overlay text-text-tertiary text-left">
					<th class="px-4 py-2 font-mono font-medium">Score</th><th class="px-4 py-2 font-medium">Interpretation</th>
				</tr></thead>
				<tbody class="divide-y divide-surface-border">
					<tr><td class="px-4 py-2 font-mono text-emerald-400">0.50+</td><td class="px-4 py-2 text-text-secondary">Strong core of long-term engaged supporters</td></tr>
					<tr><td class="px-4 py-2 font-mono text-teal-400">0.10&ndash;0.49</td><td class="px-4 py-2 text-text-secondary">Mix of new and established participants</td></tr>
					<tr><td class="px-4 py-2 font-mono text-text-quaternary">&lt; 0.10</td><td class="px-4 py-2 text-text-secondary">Almost entirely new accounts &mdash; could be viral growth or manufactured</td></tr>
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
			<li><strong class="text-text-primary">Small groups are protected.</strong> Any aggregate with fewer than 5 entries is suppressed (k-anonymity).</li>
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
				congressional district and are discarded within seconds, before the response
				returns. We do not log them, do not persist them in databases, and do not
				back them up.
			</li>
			<li>
				<strong class="text-text-primary">Address fields — Shadow Atlas path:</strong>
				your full street address never leaves your device. Your browser computes a
				cryptographic commitment to your district. Approximate coordinates transit our
				servers briefly (under 5 seconds for typical requests) so we can confirm the
				district mapping is authentic, then are discarded. We do not log raw coordinates.
			</li>
			<li>
				<strong class="text-text-primary">What we persist:</strong> a one-way district
				hash, your account email (for sign-in and anti-sybil), engagement-tier
				counters, the actions you take through the platform, and operational logs
				stripped of identifying address fields.
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
