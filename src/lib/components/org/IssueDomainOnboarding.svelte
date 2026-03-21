<script lang="ts">
	let {
		orgSlug,
		onComplete,
		onSkip
	}: {
		orgSlug: string;
		onComplete?: () => void;
		onSkip?: () => void;
	} = $props();

	const MAX_ONBOARDING = 10;

	let inputValue = $state('');
	let domains = $state<string[]>([]);
	let saving = $state(false);
	let errorMsg = $state('');

	const canAdd = $derived(inputValue.trim().length > 0 && domains.length < MAX_ONBOARDING);

	function addDomain(): void {
		const label = inputValue.trim();
		if (!label || domains.length >= MAX_ONBOARDING) return;
		if (label.length > 100) {
			errorMsg = 'Label must be 100 characters or fewer.';
			return;
		}
		if (domains.includes(label)) {
			errorMsg = 'Already added.';
			return;
		}
		domains = [...domains, label];
		inputValue = '';
		errorMsg = '';
	}

	function removeDomain(index: number): void {
		domains = domains.filter((_, i) => i !== index);
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			addDomain();
		}
	}

	async function save(): Promise<void> {
		if (domains.length === 0) {
			onSkip?.();
			return;
		}

		saving = true;
		errorMsg = '';

		try {
			// Create each domain via the existing endpoint
			for (const label of domains) {
				const res = await fetch(`/api/org/${orgSlug}/issue-domains`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ label })
				});

				if (!res.ok && res.status !== 409) {
					const data = await res.json().catch(() => null);
					errorMsg = data?.message || `Failed to save "${label}".`;
					return;
				}
				// 409 = duplicate, skip silently
			}

			// Score existing bills against the new domains
			fetch(`/api/org/${orgSlug}/issue-domains/rescore`, { method: 'POST' }).catch(() => {
				// Fire-and-forget — don't block onboarding
			});

			onComplete?.();
		} catch {
			errorMsg = 'Network error. Please try again.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="ido">
	<p class="ido__question">What issues does your organization work on?</p>
	<p class="ido__hint">
		Type an issue area and press Enter. We'll match you with relevant legislation automatically.
		<span class="ido__limit">{domains.length}/{MAX_ONBOARDING}</span>
	</p>

	<div class="ido__input-row">
		<input
			type="text"
			class="ido__input"
			placeholder="e.g. clean water, school safety, transit equity"
			bind:value={inputValue}
			onkeydown={handleKeydown}
			maxlength="100"
			disabled={saving}
		/>
		<button
			class="ido__add-btn"
			disabled={!canAdd || saving}
			onclick={addDomain}
		>
			Add
		</button>
	</div>

	{#if domains.length > 0}
		<div class="ido__pills">
			{#each domains as label, i}
				<span class="ido__pill">
					{label}
					<button
						class="ido__pill-remove"
						onclick={() => removeDomain(i)}
						disabled={saving}
						aria-label="Remove {label}"
					>
						<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
							<path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z"/>
						</svg>
					</button>
				</span>
			{/each}
		</div>
	{/if}

	{#if errorMsg}
		<p class="ido__error">{errorMsg}</p>
	{/if}

	<div class="ido__actions">
		<button class="ido__skip" onclick={onSkip} disabled={saving}>
			Skip for now
		</button>
		<button class="ido__save" onclick={save} disabled={saving || domains.length === 0}>
			{saving ? 'Saving...' : 'Save & continue'}
		</button>
	</div>
</div>

<style>
	.ido {
		padding: 0.75rem;
		border-radius: 8px;
		background: white;
		border: 1px solid oklch(0.92 0.01 250);
	}

	.ido__question {
		font-size: 0.8125rem;
		font-weight: 600;
		color: oklch(0.25 0.03 250);
		margin: 0 0 0.25rem;
	}

	.ido__hint {
		font-size: 0.6875rem;
		color: oklch(0.55 0.01 250);
		margin: 0 0 0.625rem;
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.ido__limit {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-size: 0.625rem;
		color: oklch(0.5 0.02 250);
	}

	.ido__input-row {
		display: flex;
		gap: 0.375rem;
	}

	.ido__input {
		flex: 1;
		padding: 0.5rem 0.625rem;
		border-radius: 6px;
		border: 1px solid oklch(0.88 0.02 250);
		background: white;
		font-size: 0.8125rem;
		color: oklch(0.2 0.02 250);
		outline: none;
		transition: border-color 150ms ease-out;
	}

	.ido__input:focus {
		border-color: oklch(0.65 0.1 180);
	}

	.ido__input::placeholder {
		color: oklch(0.7 0.01 250);
	}

	.ido__add-btn {
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		border: 1px solid oklch(0.85 0.06 180 / 0.5);
		background: oklch(0.97 0.01 180 / 0.3);
		color: oklch(0.35 0.08 180);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 150ms ease-out;
	}

	.ido__add-btn:hover:not(:disabled) {
		background: oklch(0.94 0.03 180);
	}

	.ido__add-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.ido__pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-top: 0.5rem;
	}

	.ido__pill {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		border-radius: 99px;
		background: oklch(0.94 0.04 180);
		color: oklch(0.3 0.08 180);
		font-size: 0.75rem;
		font-weight: 500;
	}

	.ido__pill-remove {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		color: oklch(0.5 0.06 180);
		transition: color 100ms ease-out;
	}

	.ido__pill-remove:hover {
		color: oklch(0.3 0.1 25);
	}

	.ido__error {
		font-size: 0.75rem;
		color: oklch(0.5 0.15 25);
		margin: 0.375rem 0 0;
	}

	.ido__actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.625rem;
	}

	.ido__skip {
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: oklch(0.5 0.02 250);
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
	}

	.ido__skip:hover {
		color: oklch(0.3 0.02 250);
	}

	.ido__save {
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		border: none;
		background: oklch(0.35 0.08 180);
		color: white;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 150ms ease-out;
	}

	.ido__save:hover:not(:disabled) {
		background: oklch(0.3 0.1 180);
	}

	.ido__save:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
