<script lang="ts">
	import { Send, Landmark, Building2, MapPin, User, Users, Info } from '@lucide/svelte';
	import type { Template } from '$lib/types/template';
	import { extractRecipientEmails } from '$lib/types/templateConfig';
	import SimpleTooltip from '$lib/components/ui/SimpleTooltip.svelte';
	import { z } from 'zod';

	interface Props {
		template: Template;
	}

	const { template }: Props = $props();

	const verifiedSends = $derived(template.send_count || 0);
	const uniqueDistricts = $derived(template.unique_districts || 0);
	const hasEngagement = $derived(verifiedSends > 0 || uniqueDistricts > 0);

	// Calculate recipient count for direct email templates
	const recipientCount = $derived(
		// Use pre-computed recipientEmails from API if available
		template.recipientEmails && Array.isArray(template.recipientEmails)
			? template.recipientEmails.length
			: // Fallback to parsing recipient_config with validation
				(() => {
					const RecipientConfigSchema = z.unknown();
					let recipientConfig = null;

					if (typeof template.recipient_config === 'string') {
						try {
							const parsed = JSON.parse(template.recipient_config);
							const result = RecipientConfigSchema.safeParse(parsed);
							recipientConfig = result.success ? result.data : null;
						} catch (error) {
							console.warn('[MessageMetrics] Failed to parse recipient_config:', error);
						}
					} else {
						const result = RecipientConfigSchema.safeParse(template.recipient_config);
						recipientConfig = result.success ? result.data : null;
					}

					return extractRecipientEmails(recipientConfig).length;
				})()
	);

	// Format numbers with commas, handle undefined/null values
	function formatNumber(num: number | undefined | null): string {
		if (num === undefined || num === null || isNaN(num)) {
			return '0';
		}
		return num.toLocaleString();
	}

	// Determine badge type based on delivery method
	const badgeType = $derived(
		template.deliveryMethod === 'cwc' ? 'certified' : ('direct' as 'certified' | 'direct')
	);

	// For templates with recipients, always show recipient count regardless of delivery method
	const shouldShowRecipients = $derived(recipientCount > 0);

	function getDistrictCoverage(): string {
		if (uniqueDistricts === 0) return '0%';
		return `${Math.round((uniqueDistricts / 435) * 100)}%`;
	}

	const typeMetrics = $derived({
		certified: {
			icon: Landmark,
			tooltip: 'Delivered through Congressional Web Communication system',
			value: `${formatNumber(verifiedSends)} sent`,
			secondaryIcon: shouldShowRecipients ? (recipientCount > 1 ? Users : User) : MapPin,
			secondaryTooltip: shouldShowRecipients
				? 'Total recipient addresses targeted'
				: 'Percentage of congressional districts covered',
			secondaryValue: shouldShowRecipients
				? `${formatNumber(recipientCount)} recipients`
				: `${getDistrictCoverage()} districts covered`
		},
		direct: {
			icon: Building2,
			tooltip: 'Direct email outreach to decision makers',
			value: `${formatNumber(verifiedSends)} sent`,
			secondaryIcon: recipientCount > 1 ? Users : User,
			secondaryTooltip: 'Total recipient addresses targeted',
			secondaryValue: `${formatNumber(recipientCount)} recipients`
		}
	} as const);

	const currentMetric = $derived(typeMetrics[badgeType]);

	// Simple tooltip state
	let hoveredTooltip = $state<'sent' | 'recipients' | null>(null);
</script>

<!-- Pre-launch: Only show metrics when there's real engagement -->
{#if hasEngagement}
	<div class="min-w-0 max-w-full space-y-2 text-sm">
		<div class="flex max-w-fit items-center gap-2 text-slate-500">
			<Send class="h-4 w-4 shrink-0" />
			<span class="min-w-0 flex-1">
				{formatNumber(verifiedSends)} sent
			</span>
			<div class="relative z-50">
				<Info
					class="h-4 w-4 shrink-0 cursor-help text-slate-400"
					onmouseenter={() => (hoveredTooltip = 'sent')}
					onmouseleave={() => (hoveredTooltip = null)}
				/>

				<SimpleTooltip
					content="Total messages sent using this template"
					placement="right"
					show={hoveredTooltip === 'sent'}
				/>
			</div>
		</div>

		<div class="flex max-w-fit items-center gap-2 text-slate-500">
			{#snippet secondaryIconSnippet()}
				{@const SecondaryIconComponent = currentMetric.secondaryIcon}
				<SecondaryIconComponent class="h-4 w-4 shrink-0" />
			{/snippet}
			{@render secondaryIconSnippet()}
			<span class="min-w-0 flex-1">
				{currentMetric.secondaryValue}
			</span>
			<div class="relative z-50">
				<Info
					class="h-4 w-4 shrink-0 cursor-help text-slate-400"
					onmouseenter={() => (hoveredTooltip = 'recipients')}
					onmouseleave={() => (hoveredTooltip = null)}
				/>

				<SimpleTooltip
					content={currentMetric.secondaryTooltip}
					placement="right"
					show={hoveredTooltip === 'recipients'}
				/>
			</div>
		</div>
	</div>
{/if}
