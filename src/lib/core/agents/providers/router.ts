/**
 * Decision-Maker Router
 *
 * Routes resolution requests to providers by priority.
 * Target type is an open string — providers decide via canResolve().
 *
 * Selection: highest-priority provider whose canResolve() returns true.
 * Fallback: on failure, tries remaining providers in priority order.
 */

import type {
	DecisionMakerProvider,
	ResolveContext,
	DecisionMakerResult,
	ProviderRegistration,
	RouterOptions
} from './types';

// ============================================================================
// Router Implementation
// ============================================================================

export class DecisionMakerRouter {
	private providers: Map<string, ProviderRegistration> = new Map();

	/**
	 * Register a provider with optional priority
	 */
	register(provider: DecisionMakerProvider, priority: number = 10): void {
		const registration: ProviderRegistration = { provider, priority };
		this.providers.set(provider.name, registration);
		console.debug(`[router] Registered provider: ${provider.name} (priority: ${priority})`);
	}

	/**
	 * Select the best provider for a resolution context.
	 *
	 * Priority:
	 * 1. preferredProvider option (if set and can resolve)
	 * 2. Highest-priority registered provider that canResolve
	 */
	private selectProvider(
		context: ResolveContext,
		options?: RouterOptions
	): DecisionMakerProvider | null {
		if (options?.preferredProvider) {
			const registration = this.providers.get(options.preferredProvider);
			if (registration && registration.provider.canResolve(context)) {
				return registration.provider;
			}
		}

		// Walk all providers by descending priority, pick the first that can resolve
		const sorted = Array.from(this.providers.values()).sort(
			(a, b) => b.priority - a.priority
		);

		for (const { provider } of sorted) {
			if (provider.canResolve(context)) {
				return provider;
			}
		}

		return null;
	}

	/**
	 * Resolve decision-makers using the appropriate provider
	 */
	async resolve(
		context: ResolveContext,
		options?: RouterOptions
	): Promise<DecisionMakerResult> {
		const startTime = Date.now();

		console.debug('[router] Resolving decision-makers:', {
			targetType: context.targetType,
			targetEntity: context.targetEntity,
			subjectLine: context.subjectLine.slice(0, 50) + '...'
		});

		const provider = this.selectProvider(context, options);

		if (!provider) {
			const registered = Array.from(this.providers.keys()).join(', ') || '(none)';
			throw new Error(
				`No provider available for target type: ${context.targetType}. Registered providers: ${registered}`
			);
		}

		console.debug(`[router] Selected provider: ${provider.name}`);

		try {
			const result = await this.resolveWithTimeout(provider, context, options?.timeoutMs);
			console.debug(`[router] Resolution successful via ${provider.name} in ${Date.now() - startTime}ms`);
			return result;
		} catch (error) {
			console.error(`[router] Provider ${provider.name} failed:`, error);

			if (options?.allowFallback) {
				return await this.attemptFallback(context, provider, options);
			}

			throw error;
		}
	}

	/**
	 * Attempt resolution with timeout.
	 * Uses AbortController so providers can check signal.aborted and exit cleanly.
	 */
	private async resolveWithTimeout(
		provider: DecisionMakerProvider,
		context: ResolveContext,
		timeoutMs: number = 600_000 // 10 minutes — 4-stage pipeline with parallel chunks runs 120-240s typical
	): Promise<DecisionMakerResult> {
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(new Error(`Resolution timeout after ${timeoutMs}ms`)),
			timeoutMs
		);

		try {
			return await provider.resolve({ ...context, signal: controller.signal });
		} finally {
			clearTimeout(timeout);
		}
	}

	/**
	 * Attempt fallback to other providers (by priority, skipping the one that failed)
	 */
	private async attemptFallback(
		context: ResolveContext,
		failedProvider: DecisionMakerProvider,
		options?: RouterOptions
	): Promise<DecisionMakerResult> {
		console.debug(`[router] Attempting fallback after ${failedProvider.name} failure`);

		const sorted = Array.from(this.providers.values()).sort(
			(a, b) => b.priority - a.priority
		);

		for (const { provider } of sorted) {
			if (provider.name === failedProvider.name || !provider.canResolve(context)) {
				continue;
			}

			console.debug(`[router] Trying fallback provider: ${provider.name}`);

			try {
				const result = await this.resolveWithTimeout(provider, context, options?.timeoutMs);
				console.debug(`[router] Fallback successful via ${provider.name}`);
				return result;
			} catch (error) {
				console.error(`[router] Fallback provider ${provider.name} also failed:`, error);
			}
		}

		throw new Error(
			`All providers failed for target type: ${context.targetType}. Last error from ${failedProvider.name}.`
		);
	}

	/**
	 * Get all registered providers
	 */
	getProviders(): DecisionMakerProvider[] {
		return Array.from(this.providers.values()).map((r) => r.provider);
	}

	/**
	 * Get provider by name
	 */
	getProvider(name: string): DecisionMakerProvider | undefined {
		return this.providers.get(name)?.provider;
	}
}

// ============================================================================
// Singleton Router Instance
// ============================================================================

/** Global router instance */
export const decisionMakerRouter = new DecisionMakerRouter();
