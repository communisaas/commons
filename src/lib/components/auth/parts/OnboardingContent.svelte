<script lang="ts">
	import { fly } from 'svelte/transition';
	import { Users, HelpCircle, Mail, CheckCircle2 } from '@lucide/svelte';
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';
	// import Button from '$lib/components/ui/Button.svelte';

	const labels = getJurisdictionLabels();

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
		const confirmedCount = template.send_count || 0;
		const confirmationHeadline =
			confirmedCount > 0
				? `${confirmedCount.toLocaleString()} routes confirmed on this action page`
				: 'Review this action page';
		if (congressional) {
			return {
				'social-link': {
					headline: confirmationHeadline,
					subtext: 'Review the message and confirm your representative route before any send claim.',
					cta: 'Review route'
				},
				'direct-link': {
					headline: 'Confirm your route to your district office',
					subtext:
						`${labels.legislativeBody} offices log constituent messages by district. Commons checks the route first; outcomes are not promised.`,
					cta: 'Review route'
				},
				share: {
					headline: confirmationHeadline,
					subtext: 'Review the message and confirm your representative route before any send claim.',
					cta: 'Review route'
				}
			};
		} else if (directOutreach) {
			return {
				'social-link': {
					headline: 'Confirm your route to the decision-maker',
					subtext: 'Review the message before any email handoff is recorded.',
					cta: 'Review route'
				},
				'direct-link': {
					headline: 'Confirm your position route',
					subtext: 'Commons opens the decision-maker path; outcomes are not promised.',
					cta: 'Review route'
				},
				share: {
					headline: confirmationHeadline,
					subtext: 'Review the message before any email handoff is recorded.',
					cta: 'Review route'
				}
			};
		} else {
			return {
				'social-link': {
					headline: 'Confirm your route',
					subtext: 'Someone shared this action page with you. Review it before confirmation.',
					cta: 'Review route'
				},
				'direct-link': {
					headline: 'Confirm your position route',
					subtext:
						confirmedCount > 0
							? `${confirmedCount.toLocaleString()} routes confirmed on this action page. Review before confirming your own route.`
							: 'Review this action page before confirming your own route.',
					cta: 'Review route'
				},
				share: {
					headline: 'Shared with you',
					subtext: 'Review this action page before confirming your route.',
					cta: 'Review route'
				}
			};
		}
	}

	function getProcessSteps(congressional: boolean, directOutreach: boolean) {
		if (congressional) {
			return [
				{
					icon: Mail,
					title: 'Representative route is resolved',
					desc: `Commons checks the ${labels.legislativeAdjective} district path before any delivery route opens.`
				},
				{
					icon: Users,
					title: 'Message is reviewed before handoff',
					desc: `${labels.legislativeBody} offices log messages by district and issue after delivery. Outcomes are not promised.`
				},
				{
					icon: CheckCircle2,
					title: 'Proof waits for route completion',
					desc: 'A receipt is recorded once your message is actually delivered.'
				}
			];
		} else if (directOutreach) {
			return [
				{
					icon: Mail,
					title: 'Decision-maker route opens',
					desc: 'Commons prepares the addressed email path before the handoff.'
				},
				{
					icon: Users,
					title: 'Verified context can be attached',
					desc: 'Your role and verification tier can travel with the message where available.'
				},
				{
					icon: CheckCircle2,
					title: 'Handoff record follows completion',
					desc: 'The route can record a handoff; the recipient may or may not reply.'
				}
			];
		} else {
			return [
				{
					icon: Mail,
					title: 'Configured recipient route opens',
					desc: 'Commons prepares the configured delivery path before confirmation.'
				},
				{
					icon: Users,
					title: 'Confirmation is recorded',
					desc: 'The route count advances only after confirmation, with your identity tier where available.'
				},
				{
					icon: CheckCircle2,
					title: 'Receipt waits for completion',
					desc: 'A receipt is recorded once your message is actually delivered.'
				}
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
				{message?.headline || 'Confirm your route'}
			</h2>
			<p class="text-sm text-slate-600">
				{#if isCongressional}
					Your district route is checked before the official {labels.legislativeAdjective} delivery path opens.
				{:else if isDirectOutreach}
					Your message is reviewed before the decision-maker handoff opens.
				{:else}
					Review the action page before confirmation or receipt claims are recorded.
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

			<!-- Route confirmation count (factual) -->
			<div class="flex items-center gap-3 text-xs text-slate-500">
				<div class="flex items-center gap-1">
					<Users class="h-3 w-3" />
					<span>{(template.send_count || 0).toLocaleString()} confirmed</span>
				</div>
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

		<!-- Privacy Notice (F-1.2: pending F-4.4 — full terms/privacy pages not
		     yet written; pointing to /about/integrity as the canonical
		     disclosure until they ship) -->
		<p class="text-center text-xs text-slate-500">
			By signing up, you accept Commons' data practices as described in our
			<a href="/about/integrity" class="underline hover:text-slate-700">integrity
			and limitations</a> page &mdash; full Terms of Service and Privacy Policy
			documents are forthcoming.
		</p>
	</div>
{/if}
