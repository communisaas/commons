type MessageGenerationRuntimeEnv = {
	GEMINI_API_KEY?: string;
	EXA_API_KEY?: string;
	FIRECRAWL_API_KEY?: string;
};

export type MessageGenerationReadiness = {
	ready: boolean;
	modelProviderConfigured: boolean;
	sourceSearchConfigured: boolean;
	sourceFetchConfigured: boolean;
	missing: string[];
	dependency: string;
	message: string;
};

export const MESSAGE_GENERATION_DEPENDENCY =
	'model provider, source discovery, and page-read evaluation';

function formatMessageGenerationMissing(missing: string[]): string {
	const labels = missing.map((item) => {
		if (item === 'GEMINI_API_KEY') return 'model provider';
		if (item === 'EXA_API_KEY') return 'source discovery';
		if (item === 'FIRECRAWL_API_KEY') return 'page-read evaluation';
		return item;
	});
	return labels.length > 0 ? labels.join(', ') : 'authoring dependencies';
}

export function getMessageGenerationReadiness(
	env: MessageGenerationRuntimeEnv
): MessageGenerationReadiness {
	const modelProviderConfigured = Boolean(env.GEMINI_API_KEY);
	const sourceSearchConfigured = Boolean(env.EXA_API_KEY);
	const sourceFetchConfigured = Boolean(env.FIRECRAWL_API_KEY);
	const missing: string[] = [];

	if (!modelProviderConfigured) missing.push('GEMINI_API_KEY');
	if (!sourceSearchConfigured) missing.push('EXA_API_KEY');
	if (!sourceFetchConfigured) missing.push('FIRECRAWL_API_KEY');

	const ready = missing.length === 0;

	return {
		ready,
		modelProviderConfigured,
		sourceSearchConfigured,
		sourceFetchConfigured,
		missing,
		dependency: MESSAGE_GENERATION_DEPENDENCY,
		message: ready
			? 'Grounded authoring is ready; prompt review, rate limits, source evaluation, and route-local errors still bound each run.'
			: `Grounded authoring is dependency-bound; configure ${formatMessageGenerationMissing(
					missing
				)} before claiming authoring streams.`
	};
}
