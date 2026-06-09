<script lang="ts">
	import { PLATFORM_EXPORT_PROFILES } from '$lib/data/platform-export-profiles';

	const platformProfileCount = PLATFORM_EXPORT_PROFILES.length;
	const platformExamples = PLATFORM_EXPORT_PROFILES.map((profile) => profile.label).join(', ');
</script>

<svelte:head>
	<title>Migrate to Commons</title>
	<meta
		name="description"
		content="Bring supporters from platform CSV exports into Commons and preserve source custody for verification-backed campaigns."
	/>
	<meta property="og:title" content="Migrate to Commons" />
	<meta
		property="og:description"
		content="Bring supporters from platform CSV exports into Commons and preserve source custody for verification-backed campaigns."
	/>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-16">
	<!-- Hero -->
	<header class="space-y-6 pt-8 text-center">
		<p class="text-text-quaternary font-mono text-[10px] tracking-wider uppercase">Portability</p>
		<h1 class="text-text-primary text-4xl leading-tight font-bold">
			Your supporters. Your proof.<br />No lock-in.
		</h1>
		<p class="text-text-secondary mx-auto max-w-xl text-base leading-relaxed">
			Commons turns existing supporter exports into a People ledger with source custody,
			reachability, and verification weight. Direct platform sync remains gated until credential
			custody and sync-proof gates are armed.
		</p>
	</header>

	<!-- How it works -->
	<section class="border-surface-border space-y-6 border-t pt-10">
		<h2 class="text-text-primary text-center text-lg font-semibold">How it works</h2>
		<div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
			<div
				class="border-surface-border bg-surface-overlay space-y-3 rounded-lg border p-6 text-center"
			>
				<div class="text-text-quaternary font-mono text-2xl">1</div>
				<h3 class="text-text-primary text-sm font-semibold">Export</h3>
				<p class="text-text-secondary text-xs leading-relaxed">
					Export a supporter CSV from the tool your org already uses. Commons recognizes
					{platformProfileCount} common platform profiles plus generic CSV.
				</p>
			</div>
			<div
				class="border-surface-border bg-surface-overlay space-y-3 rounded-lg border p-6 text-center"
			>
				<div class="text-text-quaternary font-mono text-2xl">2</div>
				<h3 class="text-text-primary text-sm font-semibold">Recognize</h3>
				<p class="text-text-secondary text-xs leading-relaxed">
					Known headers identify the export profile, then email, name, postal code, phone, country,
					tags, and consent fields map into Commons.
				</p>
			</div>
			<div
				class="border-surface-border bg-surface-overlay space-y-3 rounded-lg border p-6 text-center"
			>
				<div class="text-text-quaternary font-mono text-2xl">3</div>
				<h3 class="text-text-primary text-sm font-semibold">Preserve</h3>
				<p class="text-text-secondary text-xs leading-relaxed">
					Imported rows keep source custody in the People ledger, so list history becomes context
					instead of disappearing during intake.
				</p>
			</div>
			<div
				class="border-surface-border bg-surface-overlay space-y-3 rounded-lg border p-6 text-center"
			>
				<div class="text-text-quaternary font-mono text-2xl">4</div>
				<h3 class="text-text-primary text-sm font-semibold">Activate</h3>
				<p class="text-text-secondary text-xs leading-relaxed">
					People can verify identity and address over time; campaigns then assemble proof packets
					from reachable people, not anonymous petition volume.
				</p>
			</div>
		</div>
	</section>

	<!-- Capability boundary -->
	<section class="border-surface-border space-y-6 border-t pt-10">
		<h2 class="text-text-primary text-center text-lg font-semibold">Capability boundary</h2>
		<div class="border-surface-border overflow-hidden rounded-lg border">
			<table class="w-full text-sm">
				<thead>
					<tr class="bg-surface-overlay text-text-tertiary text-left">
						<th class="px-4 py-3 font-medium">Capability</th>
						<th class="px-4 py-3 text-center font-medium">Incumbent exports</th>
						<th class="px-4 py-3 text-center font-medium">Commons intake</th>
					</tr>
				</thead>
				<tbody class="divide-surface-border divide-y">
					<tr>
						<td class="text-text-secondary px-4 py-3">Source recognition</td>
						<td class="text-text-quaternary px-4 py-3 text-center">Vendor-specific headers</td>
						<td class="text-text-primary px-4 py-3 text-center"
							>{platformProfileCount} recognized CSV profiles</td
						>
					</tr>
					<tr>
						<td class="text-text-secondary px-4 py-3">People record</td>
						<td class="text-text-quaternary px-4 py-3 text-center">Names, emails, tags</td>
						<td class="text-text-primary px-4 py-3 text-center">Reach fields plus source custody</td
						>
					</tr>
					<tr>
						<td class="text-text-secondary px-4 py-3">District signal</td>
						<td class="text-text-quaternary px-4 py-3 text-center">Often ZIP or self-report</td>
						<td class="text-text-primary px-4 py-3 text-center"
							>Postal and district matching on import</td
						>
					</tr>
					<tr>
						<td class="text-text-secondary px-4 py-3">Verification lift</td>
						<td class="text-text-quaternary px-4 py-3 text-center">List membership</td>
						<td class="text-text-primary px-4 py-3 text-center"
							>Identity and address verification over time</td
						>
					</tr>
					<tr>
						<td class="text-text-secondary px-4 py-3">Direct sync</td>
						<td class="text-text-quaternary px-4 py-3 text-center">Per-vendor adapters</td>
						<td class="text-text-primary px-4 py-3 text-center"
							>Not armed until custody and sync-proof gates pass</td
						>
					</tr>
					<tr>
						<td class="text-text-secondary px-4 py-3">Campaign output</td>
						<td class="text-text-quaternary px-4 py-3 text-center">Counts and messages</td>
						<td class="text-text-primary px-4 py-3 text-center"
							>Proof packets with integrity context</td
						>
					</tr>
				</tbody>
			</table>
		</div>
	</section>

	<!-- FAQ -->
	<section class="border-surface-border space-y-6 border-t pt-10">
		<h2 class="text-text-primary text-center text-lg font-semibold">Frequently asked questions</h2>
		<div class="space-y-6">
			<div class="space-y-2">
				<h3 class="text-text-primary text-sm font-semibold">Can we keep our current platform?</h3>
				<p class="text-text-secondary text-sm leading-relaxed">
					Yes. CSV export intake does not require changing your current vendor. Direct API sync is
					not armed yet, so Commons does not claim live vendor-to-vendor mirroring.
				</p>
			</div>
			<div class="space-y-2">
				<h3 class="text-text-primary text-sm font-semibold">Will I lose any data?</h3>
				<p class="text-text-secondary text-sm leading-relaxed">
					The importer preserves mapped supporter names, email addresses, postal addresses, phones,
					countries, tags, consent fields, and detected source profile where present. Unmapped
					columns can be reviewed during import.
				</p>
			</div>
			<div class="space-y-2">
				<h3 class="text-text-primary text-sm font-semibold">Which exports are recognized?</h3>
				<p class="text-text-secondary text-sm leading-relaxed">
					Commons recognizes {platformExamples}. Generic CSV still works when the export does not
					match a known profile.
				</p>
			</div>
			<div class="space-y-2">
				<h3 class="text-text-primary text-sm font-semibold">What about platform APIs?</h3>
				<p class="text-text-secondary text-sm leading-relaxed">
					Credential custody and platform-format sync proof are tracked as gated capabilities. The
					current live path is CSV export intake.
				</p>
			</div>
			<div class="space-y-2">
				<h3 class="text-text-primary text-sm font-semibold">Is there a free tier?</h3>
				<p class="text-text-secondary text-sm leading-relaxed">
					Yes. You can create an org, import supporters, and run campaigns at no cost. Usage-based
					pricing applies only when you need proof report delivery at scale.
				</p>
			</div>
		</div>
	</section>

	<!-- CSV universal import -->
	<section class="border-surface-border border-t pt-10">
		<div
			class="border-surface-border bg-surface-overlay space-y-3 rounded-lg border p-8 text-center"
		>
			<h2 class="text-text-primary text-lg font-semibold">Any export can become source custody</h2>
			<p class="text-text-secondary mx-auto max-w-lg text-sm leading-relaxed">
				Export your supporter list from the tool you use today, map the columns, and import. Known
				profiles accelerate mapping; unknown CSVs still enter through the same People ledger path.
			</p>
		</div>
	</section>

	<!-- CTA -->
	<section class="border-surface-border space-y-4 border-t pt-10 pb-12 text-center">
		<h2 class="text-text-primary text-xl font-semibold">Ready to get started?</h2>
		<p class="text-text-secondary text-sm">
			Create your org in under a minute. Import your supporters right after.
		</p>
		<a
			href="/org/new"
			class="inline-block rounded-lg bg-white px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90"
		>
			Start your free org
		</a>
	</section>

	<footer class="border-surface-border border-t pt-8 pb-12 text-center">
		<p class="text-text-quaternary text-xs">
			commons.email &mdash; verification-backed civic coordination
		</p>
	</footer>
</div>
