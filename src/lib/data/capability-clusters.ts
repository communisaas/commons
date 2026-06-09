export const CAPABILITY_CLUSTER_LABELS = {
	'C-verification': 'verification',
	'C-reach': 'reach',
	'C-composability': 'composability',
	'C-agentic': 'agentic systems',
	'C-quality-signaling': 'quality signaling',
	'C-accountability': 'accountability',
	'C-coordination-integrity': 'coordination integrity',
	'C-reader-side': 'reader-side UX',
	'C-data-sovereignty': 'data sovereignty'
} as const;

export type CapabilityClusterId = keyof typeof CAPABILITY_CLUSTER_LABELS;

export const CAPABILITY_CLUSTER_IDS = Object.keys(
	CAPABILITY_CLUSTER_LABELS
) as CapabilityClusterId[];

const CAPABILITY_CLUSTER_ALIASES: Record<string, CapabilityClusterId> = {
	'c-verification': 'C-verification',
	verification: 'C-verification',
	'c-reach': 'C-reach',
	reach: 'C-reach',
	'c-composability': 'C-composability',
	composability: 'C-composability',
	'c-agentic': 'C-agentic',
	agentic: 'C-agentic',
	'agentic systems': 'C-agentic',
	'c-quality-signaling': 'C-quality-signaling',
	quality: 'C-quality-signaling',
	'quality signaling': 'C-quality-signaling',
	'c-accountability': 'C-accountability',
	accountability: 'C-accountability',
	'c-coordination-integrity': 'C-coordination-integrity',
	'coordination integrity': 'C-coordination-integrity',
	'c-reader-side': 'C-reader-side',
	'reader-side': 'C-reader-side',
	'reader-side ux': 'C-reader-side',
	'reader side': 'C-reader-side',
	'reader side ux': 'C-reader-side',
	'c-data-sovereignty': 'C-data-sovereignty',
	'data sovereignty': 'C-data-sovereignty'
};

function normalizeCapabilityClusterToken(token: string): string {
	return token.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function resolveCapabilityClusterId(token: string): CapabilityClusterId | null {
	return CAPABILITY_CLUSTER_ALIASES[normalizeCapabilityClusterToken(token)] ?? null;
}

export function capabilityClusterLabel(token: string): string {
	const trimmed = token.trim();
	const clusterId = resolveCapabilityClusterId(trimmed);
	if (clusterId) return CAPABILITY_CLUSTER_LABELS[clusterId];
	return `invalid cluster: ${trimmed || 'empty'}`;
}

export function formatCapabilityClusters(value: string): string {
	return value.split('/').map(capabilityClusterLabel).filter(Boolean).join(' / ');
}

export function parseCapabilityClusterIds(value: string): CapabilityClusterId[] {
	const ids = value
		.split('/')
		.map(resolveCapabilityClusterId)
		.filter((id): id is CapabilityClusterId => Boolean(id));
	return Array.from(new Set(ids));
}
