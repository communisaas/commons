/**
 * Prompt Guard 2's reviewed input window. No caller may silently truncate past
 * this boundary: either the complete untrusted prompt surface is classified or
 * the request is rejected before any paid provider work.
 */
export const PROMPT_GUARD_MAX_CHARACTERS = 2_000;

export class PromptGuardInputTooLongError extends Error {
	constructor() {
		super(`Prompt-guard input must be ≤${PROMPT_GUARD_MAX_CHARACTERS} characters`);
		this.name = 'PromptGuardInputTooLongError';
	}
}

export function assertPromptGuardInputBudget(content: string): void {
	if (content.length > PROMPT_GUARD_MAX_CHARACTERS) {
		throw new PromptGuardInputTooLongError();
	}
}
