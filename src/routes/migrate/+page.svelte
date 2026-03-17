<svelte:head>
	<title>Migrate to Commons</title>
	<meta name="description" content="Bring your supporters, campaigns, and data to Commons. Import from Action Network or CSV in minutes." />
	<meta property="og:title" content="Migrate to Commons" />
	<meta property="og:description" content="Bring your supporters, campaigns, and data to Commons. Import from Action Network or CSV in minutes." />
</svelte:head>

<div class="mx-auto max-w-3xl space-y-16">
	<!-- Hero -->
	<header class="space-y-6 text-center pt-8">
		<p class="text-[10px] font-mono uppercase tracking-wider text-text-quaternary">Migration</p>
		<h1 class="text-4xl font-bold text-text-primary leading-tight">
			Your supporters. Your proof.<br />No lock-in.
		</h1>
		<p class="text-base text-text-secondary leading-relaxed max-w-xl mx-auto">
			Commons builds verification-backed proof of public sentiment &mdash; not just petition counts.
			Bring your existing supporter base and start generating reports that decision-makers trust.
		</p>
	</header>

	<!-- How it works -->
	<section class="space-y-6 border-t border-surface-border pt-10">
		<h2 class="text-lg font-semibold text-text-primary text-center">How it works</h2>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
			<div class="rounded-lg border border-surface-border bg-surface-overlay p-6 space-y-3 text-center">
				<div class="text-2xl font-mono text-text-quaternary">1</div>
				<h3 class="text-sm font-semibold text-text-primary">Connect</h3>
				<p class="text-xs text-text-secondary leading-relaxed">
					Enter your Action Network API key in your org settings. Commons connects read-only &mdash; nothing in AN is modified.
				</p>
			</div>
			<div class="rounded-lg border border-surface-border bg-surface-overlay p-6 space-y-3 text-center">
				<div class="text-2xl font-mono text-text-quaternary">2</div>
				<h3 class="text-sm font-semibold text-text-primary">Sync</h3>
				<p class="text-xs text-text-secondary leading-relaxed">
					Commons imports your supporters, preserving names, emails, addresses, and tags. No data is lost.
				</p>
			</div>
			<div class="rounded-lg border border-surface-border bg-surface-overlay p-6 space-y-3 text-center">
				<div class="text-2xl font-mono text-text-quaternary">3</div>
				<h3 class="text-sm font-semibold text-text-primary">Run in parallel</h3>
				<p class="text-xs text-text-secondary leading-relaxed">
					Keep using Action Network while your team gets comfortable with Commons. Both platforms work side by side.
				</p>
			</div>
			<div class="rounded-lg border border-surface-border bg-surface-overlay p-6 space-y-3 text-center">
				<div class="text-2xl font-mono text-text-quaternary">4</div>
				<h3 class="text-sm font-semibold text-text-primary">Cut over</h3>
				<p class="text-xs text-text-secondary leading-relaxed">
					When you're ready, switch your campaigns to Commons. Supporters verify their identity, and your proof reports start building.
				</p>
			</div>
		</div>
	</section>

	<!-- Feature comparison -->
	<section class="space-y-6 border-t border-surface-border pt-10">
		<h2 class="text-lg font-semibold text-text-primary text-center">Feature comparison</h2>
		<div class="overflow-hidden rounded-lg border border-surface-border">
			<table class="w-full text-sm">
				<thead>
					<tr class="bg-surface-overlay text-text-tertiary text-left">
						<th class="px-4 py-3 font-medium">Feature</th>
						<th class="px-4 py-3 font-medium text-center">Action Network</th>
						<th class="px-4 py-3 font-medium text-center">Commons</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-surface-border">
					<tr>
						<td class="px-4 py-3 text-text-secondary">Identity verification</td>
						<td class="px-4 py-3 text-center text-text-quaternary">None</td>
						<td class="px-4 py-3 text-center text-text-primary">5-tier verified identity (mDL)</td>
					</tr>
					<tr>
						<td class="px-4 py-3 text-text-secondary">Proof reports</td>
						<td class="px-4 py-3 text-center text-text-quaternary">Petition counts</td>
						<td class="px-4 py-3 text-center text-text-primary">Integrity-scored, auditable</td>
					</tr>
					<tr>
						<td class="px-4 py-3 text-text-secondary">Real-time verification</td>
						<td class="px-4 py-3 text-center text-text-quaternary">No</td>
						<td class="px-4 py-3 text-center text-text-primary">Live verification pipeline</td>
					</tr>
					<tr>
						<td class="px-4 py-3 text-text-secondary">Privacy (differential privacy)</td>
						<td class="px-4 py-3 text-center text-text-quaternary">No</td>
						<td class="px-4 py-3 text-center text-text-primary">DP noise layers, k-anonymity</td>
					</tr>
					<tr>
						<td class="px-4 py-3 text-text-secondary">Geographic resolution</td>
						<td class="px-4 py-3 text-center text-text-quaternary">Zip code</td>
						<td class="px-4 py-3 text-center text-text-primary">Legislative district</td>
					</tr>
					<tr>
						<td class="px-4 py-3 text-text-secondary">Pricing transparency</td>
						<td class="px-4 py-3 text-center text-text-quaternary">Tiered, opaque</td>
						<td class="px-4 py-3 text-center text-text-primary">Usage-based, visible</td>
					</tr>
					<tr>
						<td class="px-4 py-3 text-text-secondary">Data portability</td>
						<td class="px-4 py-3 text-center text-text-quaternary">CSV export</td>
						<td class="px-4 py-3 text-center text-text-primary">CSV export + API</td>
					</tr>
				</tbody>
			</table>
		</div>
	</section>

	<!-- FAQ -->
	<section class="space-y-6 border-t border-surface-border pt-10">
		<h2 class="text-lg font-semibold text-text-primary text-center">Frequently asked questions</h2>
		<div class="space-y-6">
			<div class="space-y-2">
				<h3 class="text-sm font-semibold text-text-primary">Can I run both platforms at the same time?</h3>
				<p class="text-sm text-text-secondary leading-relaxed">
					Yes. The Action Network sync is read-only &mdash; it copies your data without modifying anything in AN. You can run both platforms in parallel for as long as you need.
				</p>
			</div>
			<div class="space-y-2">
				<h3 class="text-sm font-semibold text-text-primary">Will I lose any data?</h3>
				<p class="text-sm text-text-secondary leading-relaxed">
					No. The importer preserves supporter names, email addresses, physical addresses, and tags. If you use CSV import, any column can be mapped to a Commons field.
				</p>
			</div>
			<div class="space-y-2">
				<h3 class="text-sm font-semibold text-text-primary">How long does a sync take?</h3>
				<p class="text-sm text-text-secondary leading-relaxed">
					Most imports complete in under a minute. Large lists (50,000+ supporters) may take a few minutes depending on the Action Network API rate limits.
				</p>
			</div>
			<div class="space-y-2">
				<h3 class="text-sm font-semibold text-text-primary">What happens to my Action Network account?</h3>
				<p class="text-sm text-text-secondary leading-relaxed">
					Nothing changes. Your AN account, campaigns, and data remain exactly as they are. Commons only reads from your AN API key &mdash; it never writes or deletes.
				</p>
			</div>
			<div class="space-y-2">
				<h3 class="text-sm font-semibold text-text-primary">Is there a free tier?</h3>
				<p class="text-sm text-text-secondary leading-relaxed">
					Yes. You can create an org, import supporters, and run campaigns at no cost. Usage-based pricing applies only when you need proof report delivery at scale.
				</p>
			</div>
		</div>
	</section>

	<!-- CSV universal import -->
	<section class="border-t border-surface-border pt-10">
		<div class="rounded-lg border border-surface-border bg-surface-overlay p-8 text-center space-y-3">
			<h2 class="text-lg font-semibold text-text-primary">Not on Action Network?</h2>
			<p class="text-sm text-text-secondary leading-relaxed max-w-lg mx-auto">
				CSV import works with any platform. Export your supporter list from whatever tool you use today, map the columns, and import. Names, emails, addresses, tags &mdash; all preserved.
			</p>
		</div>
	</section>

	<!-- CTA -->
	<section class="border-t border-surface-border pt-10 pb-12 text-center space-y-4">
		<h2 class="text-xl font-semibold text-text-primary">Ready to get started?</h2>
		<p class="text-sm text-text-secondary">Create your org in under a minute. Import your supporters right after.</p>
		<a
			href="/org/new"
			class="inline-block rounded-lg bg-white px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90"
		>
			Start your free org
		</a>
	</section>

	<footer class="border-t border-surface-border pt-8 pb-12 text-center">
		<p class="text-xs text-text-quaternary">
			commons.email &mdash; verification-backed civic coordination
		</p>
	</footer>
</div>
