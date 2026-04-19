<script lang="ts">
	import { fly } from 'svelte/transition';
	import { Users, HelpCircle, Mail, CheckCircle2 } from '@lucide/svelte';
	// import Button from '$lib/components/ui/Button.svelte';

	let {
		template,
		source = 'direct-link',
		onauth,
		onclose: _onclose
	}: {
		template: {
			title: string;
			description: string;
			slug: string;
			deliveryMethod?: string;
			send_count?: number;
		};
		source?: 'social-link' | 'direct-link' | 'share';
		onauth: (provider: string) => void;
		onclose?: () => void;
	} = $props();

	let showDetails = $state(false);

	// Detect template type for customized messaging
	const isCongressional = $derived(template?.deliveryMethod === 'cwc');
	const isDirectOutreach = $derived(template?.deliveryMethod === 'email');

	// Check if user has seen onboarding before
	const _hasSeenOnboarding = $derived.by(() => {
		if (typeof window === 'undefined') return false;
		return localStorage.getItem('commons_has_seen_onboarding') === 'true';
	});

	// Dynamic messaging based on source and template type
	const sourceMessages = $derived(getSourceMessages(isCongressional, isDirectOutreach));

	function getSourceMessages(congressional: boolean, directOutreach: boolean) {
		if (congressional) {
			return {
				'social-link': {
					headline: `You're joining ${template.send_count || 0} others on this`,
					subtext: 'They shared this because groups move decisions.',
					cta: 'Send your message'
				},
				'direct-link': {
					headline: 'They count every message',
					subtext: 'Your district matters to their next vote.',
					cta: 'Speak up'
				},
				share: {
					headline: 'Pressure is building',
					subtext: `Add yours to ${template.send_count || 0} others.`,
					cta: 'Join them'
				}
			};
		} else if (directOutreach) {
			return {
				'social-link': {
					headline: 'Make decision-makers listen',
					subtext: 'Coordinated messages move decisions. Someone shared this.',
					cta: 'Send your message'
				},
				'direct-link': {
					headline: 'Decision-makers need to hear from you',
					subtext: 'Stakeholders move decisions. Speak as one.',
					cta: 'Send your position'
				},
				share: {
					headline: 'Join the pressure',
					subtext: 'Add yours to the growing numbers on this.',
					cta: 'Join them'
				}
			};
		} else {
			return {
				'social-link': {
					headline: 'Coordinated messages drive change',
					subtext: 'Someone shared this. Add your pressure.',
					cta: 'Send your message'
				},
				'direct-link': {
					headline: 'Send your position',
					subtext: 'Numbers create pressure. Add yours.',
					cta: 'Send your position'
				},
				share: {
					headline: 'Shared with you',
					subtext: 'Someone shared this. Join them.',
					cta: 'Join them'
				}
			};
		}
	}

	function getProcessSteps(congressional: boolean, directOutreach: boolean) {
		if (congressional) {
			return [
				{
					icon: Mail,
					title: 'Hits their tracking system',
					desc: 'Goes straight into the official congressional database'
				},
				{
					icon: Users,
					title: 'Gets logged with your district',
					desc: 'They track exactly how many constituents care about each issue'
				},
				{
					icon: CheckCircle2,
					title: 'Moves their decision calculus',
					desc: 'When the numbers shift, so do the votes'
				}
			];
		} else if (directOutreach) {
			return [
				{
					icon: Mail,
					title: 'Direct delivery to decision-makers',
					desc: 'Your message reaches executives, officials, or stakeholders'
				},
				{
					icon: Users,
					title: 'Strengthened by your credentials',
					desc: "Your role and connection amplify your message's impact"
				},
				{
					icon: CheckCircle2,
					title: 'Creates pressure for change',
					desc: 'Decision-makers respond when stakeholders speak up'
				}
			];
		} else {
			return [
				{
					icon: Mail,
					title: 'Direct message delivery',
					desc: 'Your message is sent to the right people'
				},
				{ icon: Users, title: 'Tracked for impact', desc: 'We monitor campaign effectiveness' },
				{ icon: CheckCircle2, title: 'Drives change', desc: 'Collective voices create real impact' }
			];
		}
	}

	const message = $derived(sourceMessages ? sourceMessages[source] : null);

	async function prepareReturn() {
		try {
			await fetch('/auth/prepare', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ returnTo: `/s/${template.slug}` })
			});
		} catch {
			/* Ignore auth preparation errors - continue with authentication */
		}
	}

	import AuthButtons from './AuthButtons.svelte';

	async function handleAuth(provider: string) {
		// Mark user as having seen onboarding
		if (typeof window !== 'undefined') {
			localStorage.setItem('commons_has_seen_onboarding', 'true');
		}

		// Store the template context before redirecting
		if (typeof window !== 'undefined') {
			sessionStorage.setItem(
				'pending_template_action',
				JSON.stringify({
					slug: template.slug,
					action: 'use_template',
					timestamp: Date.now()
				})
			);
		}

		await prepareReturn();
		onauth(provider);
	}

	function toggleDetails() {
		showDetails = !showDetails;
	}
</script>

{#if !template}
	<!-- Fallback if template is not available -->
	<div class="p-6 text-center">
		<p class="text-slate-600">Loading...</p>
	</div>
{:else}
	<div class="p-6">
		<!-- Header -->
		<div class="mb-6 text-center">
			<h2 class="mb-2 text-xl font-bold text-slate-900">
				{message?.headline || 'Send your position'}
			</h2>
			<p class="text-sm text-slate-600">
				{#if isCongressional}
					Your message goes directly to Congress
				{:else if isDirectOutreach}
					Your message reaches decision-makers
				{:else}
					Your message gets delivered with impact
				{/if}
			</p>
		</div>

		<!-- Template Preview Card -->
		<div
			class="mb-6 rounded-lg border border-slate-200 bg-emerald-50 p-4"
		>
			<h3 class="mb-1 text-sm font-semibold text-slate-900">
				{template.title}
			</h3>
			<p class="mb-3 line-clamp-2 text-xs text-slate-600">
				{template.description}
			</p>

			<!-- Social Proof -->
			<div class="flex items-center gap-3 text-xs text-slate-500">
				<div class="flex items-center gap-1">
					<Users class="h-3 w-3" />
					<span>{(template.send_count || 0).toLocaleString()} sent</span>
				</div>
				{#if (template.send_count || 0) > 100}
					<span class="font-medium text-blue-600">📈 Growing momentum</span>
				{:else if (template.send_count || 0) > 50}
					<span class="font-medium text-green-600">🎯 Building pressure</span>
				{:else}
					<span class="font-medium text-amber-600">🚀 Early adopter</span>
				{/if}
			</div>
		</div>

		<!-- OAuth Buttons -->
		<div class="mb-4">
			<AuthButtons onAuth={handleAuth} />
		</div>

		<!-- How it works toggle -->
		<div class="mb-4">
			<button
				onclick={toggleDetails}
				class="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100"
			>
				<HelpCircle class="h-4 w-4" />
				How does this work?
			</button>

			{#if showDetails}
				<div
					class="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
					in:fly={{ y: -10, duration: 200 }}
					out:fly={{ y: -10, duration: 200 }}
				>
					<div class="space-y-3">
						{#each getProcessSteps(isCongressional, isDirectOutreach) as step, _i}
							{@const IconComponent = step.icon}
							<div class="flex items-start gap-3">
								<div
									class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100"
								>
									<IconComponent class="h-3 w-3 text-blue-600" />
								</div>
								<div>
									<p class="text-sm font-medium text-slate-900">{step.title}</p>
									<p class="text-xs text-slate-600">{step.desc}</p>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Privacy Notice -->
		<p class="text-center text-xs text-slate-500">
			By signing up, you agree to our terms and privacy policy.
		</p>
	</div>
{/if}
