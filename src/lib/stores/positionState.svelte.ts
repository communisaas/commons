/**
 * Position State — Power Landscape (Cycle 38)
 *
 * Manages position registration for template detail page.
 * Tracks stance, registration status, count signal, and delivery state.
 */

interface PositionCount {
	support: number;
	oppose: number;
	districts: number;
}

type RegistrationState = 'idle' | 'registering' | 'registered';

function createPositionState() {
	let stance = $state<'support' | 'oppose' | null>(null);
	let registrationState = $state<RegistrationState>('idle');
	let registrationId = $state<string | null>(null);
	let count = $state<PositionCount>({ support: 0, oppose: 0, districts: 0 });
	let templateId = $state<string | null>(null);

	return {
		get stance() {
			return stance;
		},
		get registrationState() {
			return registrationState;
		},
		get registrationId() {
			return registrationId;
		},
		get count() {
			return count;
		},
		get templateId() {
			return templateId;
		},
		get totalCount() {
			return count.support + count.oppose;
		},
		get isRegistered() {
			return registrationState === 'registered';
		},

		/** Initialize for a template. Seed with SSR data or fetch from API. */
		async init(id: string, initialCount?: PositionCount): Promise<void> {
			// Reset if switching templates
			if (templateId !== id) {
				stance = null;
				registrationState = 'idle';
				registrationId = null;
			}
			templateId = id;

			// Use SSR-provided counts if available (avoids redundant API call)
			if (initialCount) {
				count = initialCount;
				return;
			}

			try {
				const res = await fetch(`/api/positions/count/${id}`);
				if (res.ok) {
					count = await res.json();
				}
			} catch (err) {
				console.error('[positionState] Failed to load count:', err);
			}
		},

		/** Register a position. Returns true on success. */
		async register(
			selectedStance: 'support' | 'oppose'
		): Promise<boolean> {
			if (!templateId || registrationState === 'registering') return false;

			stance = selectedStance;
			registrationState = 'registering';

			try {
				const res = await fetch('/api/positions/register', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						templateId,
						stance: selectedStance
					})
				});

				if (!res.ok) {
					const err = await res.json().catch(() => ({ error: 'Registration failed' }));
					console.error('[positionState] Registration failed:', err);
					registrationState = 'idle';
					stance = null;
					return false;
				}

				const result = await res.json();
				registrationId = result.registrationId;
				count = result.count;
				registrationState = 'registered';
				return true;
			} catch (err) {
				console.error('[positionState] Registration error:', err);
				registrationState = 'idle';
				stance = null;
				return false;
			}
		},

		/** Update count (e.g., from server push or polling). */
		setCount(newCount: PositionCount): void {
			count = newCount;
		},

		/** Reset state (on unmount or template switch). */
		reset(): void {
			stance = null;
			registrationState = 'idle';
			registrationId = null;
			count = { support: 0, oppose: 0, districts: 0 };
			templateId = null;
		},

		/** Restore from server-side existing registration (no API call). */
		restore(id: string, existingStance: 'support' | 'oppose', existingId: string, existingCount: PositionCount): void {
			templateId = id;
			stance = existingStance;
			registrationId = existingId;
			registrationState = 'registered';
			count = existingCount;
		}
	};
}

export const positionState = createPositionState();
