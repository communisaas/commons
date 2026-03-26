// CONVEX: No DB dependency — no migration needed
import { supportedIACAStates } from '$lib/core/identity/iaca-roots';

export function load() {
	return {
		supportedStates: supportedIACAStates(),
	};
}
