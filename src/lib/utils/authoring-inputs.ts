/**
 * authoring-inputs — derivations from an authoring objective (or a bare
 * subject line) into the topics / voice-sample / raw-input fields the agent
 * endpoints consume, plus the one canonical message-generation payload every
 * authoring surface builds and hashes. Browser-safe: no server imports, no
 * environment reads.
 */

import type { GeoScope } from '$lib/core/agents/types';
import type { TemplateFormData } from '$lib/types/template';

export type AuthoringObjective = TemplateFormData['objective'];

/** Topics for an agent request: AI topics if any survive trimming, else the domain, else none. */
export function buildTopics(objective: Pick<AuthoringObjective, 'topics' | 'domain'>): string[] {
	if (Array.isArray(objective.topics) && objective.topics.length > 0) {
		const valid = objective.topics.filter((t) => t && t.trim());
		if (valid.length > 0) return valid;
	}
	if (objective.domain && objective.domain.trim()) {
		return [objective.domain.toLowerCase().trim()];
	}
	return [];
}

/** Voice sample for an agent request: AI-extracted peak, else raw input, else description. */
export function buildVoiceSample(
	objective: Pick<AuthoringObjective, 'voiceSample' | 'rawInput' | 'description'>
): string {
	return objective.voiceSample || objective.rawInput || objective.description || '';
}

/** Raw operator input for an agent request, falling back to the description. */
export function buildRawInput(
	objective: Pick<AuthoringObjective, 'rawInput' | 'description'>
): string {
	return objective.rawInput || objective.description || '';
}

/** Search topics word-split from a subject line, for surfaces that have no AI topics. */
export function deriveTopicsFromSubject(subjectLine: string): string[] {
	const topics = subjectLine
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 3)
		.slice(0, 4);
	return topics.length > 0 ? topics : [subjectLine.slice(0, 60)];
}

/**
 * The canonical message-generation payload POSTed to
 * /api/agents/stream-message and hashed for job recovery. Transport-only
 * fields (job_id, input_hash, recovery_public_key_jwk, verbose) never belong
 * here: callers add them to the fetch body AFTER hashing, because they select
 * delivery mechanics — not the artifact being composed.
 */
export type MessageGenerationPayload = {
	subject_line: string;
	core_message: string;
	topics: string[];
	decision_makers: Array<{ name: string; title: string; organization: string }>;
	voice_sample: string;
	raw_input: string;
	geographic_scope: GeoScope;
};

/** Named inputs for {@link buildMessageGenerationPayload}, as each surface gathers them. */
export type MessageGenerationInput = {
	subjectLine: string;
	coreMessage: string;
	topics: string[];
	decisionMakers: Array<{ name: string; title: string; organization: string }>;
	voiceSample?: string;
	rawInput?: string;
	geographicScope: GeoScope;
};

/**
 * Build the one message-generation payload. Validates the intent, strips each
 * decision-maker down to the three identity fields, and coerces the optional
 * human-voice fields to '' so the payload always carries the same seven keys —
 * equal intents therefore hash equal on every surface.
 */
export function buildMessageGenerationPayload(
	input: MessageGenerationInput
): MessageGenerationPayload {
	if (!input.subjectLine) {
		throw new Error('Missing subject line');
	}

	if (!input.decisionMakers || input.decisionMakers.length === 0) {
		throw new Error('No decision-makers selected');
	}

	return {
		subject_line: input.subjectLine,
		core_message: input.coreMessage,
		topics: input.topics,
		decision_makers: input.decisionMakers.map((dm) => ({
			name: dm.name,
			title: dm.title,
			organization: dm.organization
		})),
		voice_sample: input.voiceSample ?? '',
		raw_input: input.rawInput ?? '',
		geographic_scope: input.geographicScope
	};
}
