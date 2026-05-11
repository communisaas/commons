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
		const sendCount = (template.send_count || 0).toLocaleString();
		if (congressional) {
			return {
				'social-link': {
					headline: `${sendCount} people have sent this template`,
					subtext: 'You can review the message before sending.',
					cta: 'Send your message'
				},
				'direct-link': {
					headline: 'Your message will be sent to your district office',
					subtext:
						`${labels.legislativeBody} offices log constituent messages by district. Outcomes are not promised.`,
					cta: 'Send your message'
				},
				share: {
					headline: `${sendCount} people have sent this template`,
					subtext: 'You can review the message before sending.',
					cta: 'Send your message'
				}
			};
		} else if (directOutreach) {
			return {
				'social-link': {
					headline: 'Send your message to the decision-maker',
					subtext: 'They receive it directly. You can review the message before sending.',
					cta: 'Send your message'
				},
				'direct-link': {
					headline: 'Send your position to the decision-maker',
					subtext: 'They receive it directly. Outcomes are not promised.',
					cta: 'Send your position'
				},
				share: {
					headline: `${sendCount} people have sent this template`,
					subtext: 'You can review the message before sending.',
					cta: 'Send your message'
				}
			};
		} else {
			return {
				'social-link': {
					headline: 'Send your message',
					subtext: 'Someone shared this template with you. You can review it before sending.',
					cta: 'Send your message'
				},
				'direct-link': {
					headline: 'Send your position',
					subtext: `${sendCount} people have sent this template. You can review it before sending.`,
					cta: 'Send your position'
				},
				share: {
					headline: 'Shared with you',
					subtext: 'You can review this template before sending.',
					cta: 'Send your message'
				}
			};
		}
	}

	function getProcessSteps(congressional: boolean, directOutreach: boolean) {
		if (congressional) {
			return [
				{
					icon: Mail,
					title: `Sent through the official ${labels.legislativeAdjective} system`,
					desc: 'Your message is delivered via Communicating with Congress (CWC).'
				},
				{
					icon: Users,
					title: 'Recorded in the office constituent log',
					desc: `${labels.legislativeBody} offices log messages by district and issue.`
				},
				{
					icon: CheckCircle2,
					title: 'Receipt added to the public record',
					desc: 'A delivery receipt is recorded. Outcomes are not promised.'
				}
			];
		} else if (directOutreach) {
			return [
				{
					icon: Mail,
					title: 'Sent by email to the decision-maker',
					desc: 'Your message is delivered to the address on file for the recipient.'
				},
				{
					icon: Users,
					title: 'Your verified identity is attached',
					desc: 'Your role and verification tier are included so the recipient can read context.'
				},
				{
					icon: CheckCircle2,
					title: 'Receipt added to the public record',
					desc: 'A delivery receipt is recorded. The recipient may or may not reply.'
				}
			];
		} else {
			return [
				{
					icon: Mail,
					title: 'Sent by email to the listed recipient',
					desc: 'Your message is delivered to the address configured for this template.'
				},
				{
					icon: Users,
					title: 'Recorded in the public log',
					desc: 'The send count is incremented; your identity tier is attached.'
				},
				{
					icon: CheckCircle2,
					title: 'Receipt added to the public record',
					desc: 'A delivery receipt is recorded. Outcomes are not promised.'
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
				{message?.headline || 'Send your position'}
			</h2>
			<p class="text-sm text-slate-600">
				{#if isCongressional}
					Your message is sent to your district office through the official {labels.legislativeAdjective} system.
				{:else if isDirectOutreach}
					Your message is sent by email to the decision-maker.
				{:else}
					Your message is sent by email and a receipt is recorded.
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

			<!-- Send count (factual) -->
			<div class="flex items-center gap-3 text-xs text-slate-500">
				<div class="flex items-center gap-1">
					<Users class="h-3 w-3" />
					<span>{(template.send_count || 0).toLocaleString()} sent</span>
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
