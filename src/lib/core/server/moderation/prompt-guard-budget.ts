/**
 * Prompt Guard 2's reviewed input window. Inputs longer than this limit are
 * classified by their leading window so provider work stays bounded while
 * preserving caller truncation semantics.
 */
export const PROMPT_GUARD_MAX_CHARACTERS = 2_000;

export function boundPromptGuardInput(content: string): string {
	return content.slice(0, PROMPT_GUARD_MAX_CHARACTERS);
}
