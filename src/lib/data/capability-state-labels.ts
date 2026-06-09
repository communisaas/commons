export type OperatorCapabilityState = 'live' | 'partial' | 'draft-only' | 'gated' | 'testnet';

export type OperatorCapabilityStateCounts = Partial<Record<OperatorCapabilityState, number>>;

export type OperatorCapabilityActionLabelOptions = {
	appendReadyArrow?: boolean;
};

export type OperatorCapabilityStateRatioSegment = {
	value: number;
	color: string;
	label: string;
};

const OPERATOR_CAPABILITY_STATE_COLORS: Record<OperatorCapabilityState, string> = {
	live: 'var(--coord-verified, #10b981)',
	partial: 'var(--coord-route-solid, #3bc4b8)',
	'draft-only': 'oklch(0.75 0.13 82)',
	gated: 'oklch(0.55 0.02 60)',
	testnet: 'oklch(0.65 0.1 245)'
};

export function operatorCapabilityStateLabel(state: OperatorCapabilityState): string {
	switch (state) {
		case 'live':
			return 'armed';
		case 'partial':
			return 'bounded';
		case 'draft-only':
			return 'draft only';
		case 'gated':
			return 'not armed';
		case 'testnet':
			return 'testnet';
	}
}

export function operatorCapabilityStateVerbLabel(state: OperatorCapabilityState): string {
	switch (state) {
		case 'live':
			return 'execute / open';
		case 'partial':
			return 'read / open';
		case 'draft-only':
			return 'draft / shape';
		case 'gated':
		case 'testnet':
			return 'context / read';
	}
}

export function operatorCapabilityActionNeedsStatePrefix(action: string): boolean {
	return !action.startsWith('context / ') && !action.startsWith('draft / ');
}

export function operatorCapabilityActionLabel(
	state: OperatorCapabilityState | null | undefined,
	action: string,
	options: OperatorCapabilityActionLabelOptions = {}
): string {
	const trimmedAction = action.trim();
	if (!operatorCapabilityActionNeedsStatePrefix(trimmedAction)) return trimmedAction;
	if (state === 'gated' || state === 'testnet') return `context / ${trimmedAction}`;
	if (state === 'draft-only') return `draft / ${trimmedAction}`;
	if (options.appendReadyArrow && !trimmedAction.endsWith('->')) return `${trimmedAction} ->`;
	return trimmedAction;
}

export function operatorCapabilityStateRatioSegments(
	counts: OperatorCapabilityStateCounts,
	options: {
		includeTestnet?: boolean;
		colors?: Partial<Record<OperatorCapabilityState, string>>;
		labelSuffix?: string;
	} = {}
): OperatorCapabilityStateRatioSegment[] {
	const states: OperatorCapabilityState[] = options.includeTestnet
		? ['live', 'partial', 'draft-only', 'gated', 'testnet']
		: ['live', 'partial', 'draft-only', 'gated'];

	return states.map((state) => {
		const label = operatorCapabilityStateLabel(state);
		return {
			value: counts[state] ?? 0,
			color: options.colors?.[state] ?? OPERATOR_CAPABILITY_STATE_COLORS[state],
			label: options.labelSuffix ? `${label}${options.labelSuffix}` : label
		};
	});
}
