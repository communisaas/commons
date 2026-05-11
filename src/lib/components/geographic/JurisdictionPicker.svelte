<script lang="ts">
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';

	let {
		value,
		country,
		onchange
	}: {
		value: string | null;
		country: string;
		onchange: (jurisdiction: string) => void;
	} = $props();

	interface JurisdictionGroup {
		label: string;
		items: Array<{ value: string; label: string }>;
	}

	const usLabels = getJurisdictionLabels();

	const US_GROUPS: JurisdictionGroup[] = [
		{
			label: 'Federal',
			items: [
				{ value: 'congressional', label: usLabels.districtType },
				{ value: 'federal-senate', label: 'U.S. Senate' }
			]
		},
		{
			label: 'State',
			items: [
				{ value: 'state-senate', label: 'State Senate' },
				{ value: 'state-house', label: 'State House' }
			]
		},
		{
			label: 'Local',
			items: [
				{ value: 'county', label: 'County' },
				{ value: 'city', label: 'City / Municipality' },
				{ value: 'city-council', label: 'City Council Ward' },
				{ value: 'township', label: 'Township' },
				{ value: 'precinct', label: 'Precinct' }
			]
		},
		{
			label: 'Education',
			items: [
				{ value: 'unified-school', label: 'Unified School District' },
				{ value: 'elementary-school', label: 'Elementary School District' },
				{ value: 'secondary-school', label: 'Secondary School District' },
				{ value: 'community-college', label: 'Community College District' }
			]
		},
		{
			label: 'Special',
			items: [
				{ value: 'water', label: 'Water District' },
				{ value: 'fire', label: 'Fire District' },
				{ value: 'transit', label: 'Transit District' },
				{ value: 'hospital', label: 'Hospital District' },
				{ value: 'library', label: 'Library District' },
				{ value: 'park', label: 'Park District' },
				{ value: 'conservation', label: 'Conservation District' },
				{ value: 'utility', label: 'Utility District' },
				{ value: 'judicial', label: 'Judicial District' }
			]
		}
	];

	const GB_GROUPS: JurisdictionGroup[] = [
		{
			label: 'United Kingdom',
			items: [
				{ value: 'uk-constituency', label: 'Parliamentary Constituency' },
				{ value: 'uk-council', label: 'Local Council' }
			]
		}
	];

	const CA_GROUPS: JurisdictionGroup[] = [
		{
			label: 'Canada',
			items: [{ value: 'ca-riding', label: 'Federal Riding' }]
		}
	];

	const AU_GROUPS: JurisdictionGroup[] = [
		{
			label: 'Australia',
			items: [{ value: 'au-electorate', label: 'Federal Electorate' }]
		}
	];

	const groups = $derived(
		country === 'GB'
			? GB_GROUPS
			: country === 'CA'
				? CA_GROUPS
				: country === 'AU'
					? AU_GROUPS
					: US_GROUPS
	);
</script>

<select
	class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors"
	value={value ?? ''}
	onchange={(e) => onchange((e.target as HTMLSelectElement).value)}
>
	<option value="">Select jurisdiction...</option>
	{#each groups as group}
		<optgroup label={group.label}>
			{#each group.items as item}
				<option value={item.value} selected={value === item.value}>{item.label}</option>
			{/each}
		</optgroup>
	{/each}
</select>
