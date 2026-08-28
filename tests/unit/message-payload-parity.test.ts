/**
 * Message-generation payload parity.
 *
 * Both authoring surfaces — the citizen template creator and the org Studio
 * runner — POST to /api/agents/stream-message and hash their payload with
 * computeMessageInputHash for job recovery. These tests pin the contract that
 * makes that safe: one exported payload type and one builder in
 * $lib/utils/authoring-inputs, seven hashed keys with transport-only fields
 * (verbose, job_id, input_hash, recovery_public_key_jwk) kept out of the hash,
 * the operator's own words carried as raw_input on the Studio path, and a
 * citizen payload pinned byte-for-byte to the golden literal below. The
 * citizen geographic_scope shape changed deliberately when scope inference
 * was unified (ISO subdivisions like 'US-CA' and an always-set displayName,
 * matching what the Studio path already sent); the golden pins that unified
 * form, not the pre-unification one.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	buildMessageGenerationPayload,
	buildRawInput,
	buildTopics,
	buildVoiceSample,
	deriveTopicsFromSubject
} from '$lib/utils/authoring-inputs';
import { computeMessageInputHash } from '$lib/core/agents/message-job-recovery';
import { inferGeoScope } from '$lib/core/geo-scope-inference';

const RESOLVER_PATH = 'src/lib/components/template/creator/MessageGenerationResolver.svelte';
const PROCESS_PATH = 'src/lib/core/authoring-process.ts';

const resolverSource = readFileSync(RESOLVER_PATH, 'utf8');
const processSource = readFileSync(PROCESS_PATH, 'utf8');

const SUBJECT = 'Keep the Sacramento night bus running';
const CORE = 'Route 11 night service is being cut.';
const VOICE = 'after closing shift there is no other way home';
const RAW = 'i ride route 11 home after closing shift';
const TOPICS = ['transit', 'night service'];

/** Decision-makers as the citizen surface passes them: already identity-only. */
const mappedDecisionMakers = [
	{
		name: 'Alicia Reyes',
		title: 'Board Chair',
		organization: 'Sacramento Regional Transit District Board'
	}
];

/** The same people as the Studio surface passes them: resolution fields still attached. */
const resolvedDecisionMakers = [
	{
		name: 'Alicia Reyes',
		title: 'Board Chair',
		organization: 'Sacramento Regional Transit District Board',
		email: 'chair@sacrt.example',
		reasoning: 'Chairs the board that votes on the service change.'
	}
];

const fixtureScope = inferGeoScope({ decisionMakers: mappedDecisionMakers }).scope;

const PAYLOAD_KEYS = [
	'core_message',
	'decision_makers',
	'geographic_scope',
	'raw_input',
	'subject_line',
	'topics',
	'voice_sample'
];

describe('cross-surface payload parity', () => {
	it('yields equal payloads and identical hashes for one intent built through either surface shape', async () => {
		// Citizen-shaped: identity-only decision-makers, gathering-order inputs.
		const citizenBuilt = buildMessageGenerationPayload({
			subjectLine: SUBJECT,
			coreMessage: CORE,
			topics: TOPICS,
			decisionMakers: mappedDecisionMakers,
			voiceSample: VOICE,
			rawInput: RAW,
			geographicScope: fixtureScope
		});

		// Studio-shaped: resolution fields still attached, inputs declared in a
		// different property order.
		const studioBuilt = buildMessageGenerationPayload({
			geographicScope: fixtureScope,
			rawInput: RAW,
			voiceSample: VOICE,
			decisionMakers: resolvedDecisionMakers,
			topics: TOPICS,
			coreMessage: CORE,
			subjectLine: SUBJECT
		});

		expect(studioBuilt).toEqual(citizenBuilt);

		const citizenHash = await computeMessageInputHash(citizenBuilt);
		const studioHash = await computeMessageInputHash(studioBuilt);
		expect(citizenHash).toBe(studioHash);
	});

	it('hashes independently of key order but diverges the moment verbose enters the payload', async () => {
		const payload = buildMessageGenerationPayload({
			subjectLine: SUBJECT,
			coreMessage: CORE,
			topics: TOPICS,
			decisionMakers: mappedDecisionMakers,
			voiceSample: VOICE,
			rawInput: RAW,
			geographicScope: fixtureScope
		});
		const hash = await computeMessageInputHash(payload);

		const reordered = {
			geographic_scope: payload.geographic_scope,
			raw_input: payload.raw_input,
			voice_sample: payload.voice_sample,
			decision_makers: payload.decision_makers,
			topics: payload.topics,
			core_message: payload.core_message,
			subject_line: payload.subject_line
		};
		expect(await computeMessageInputHash(reordered)).toBe(hash);

		expect(await computeMessageInputHash({ ...payload, verbose: true })).not.toBe(hash);
	});

	it('always emits exactly the seven payload keys, never verbose, even when voice fields are absent', () => {
		const withVoice = buildMessageGenerationPayload({
			subjectLine: SUBJECT,
			coreMessage: CORE,
			topics: TOPICS,
			decisionMakers: mappedDecisionMakers,
			voiceSample: VOICE,
			rawInput: RAW,
			geographicScope: fixtureScope
		});
		const withoutVoice = buildMessageGenerationPayload({
			subjectLine: SUBJECT,
			coreMessage: CORE,
			topics: TOPICS,
			decisionMakers: mappedDecisionMakers,
			geographicScope: fixtureScope
		});

		expect(Object.keys(withVoice).sort()).toEqual(PAYLOAD_KEYS);
		expect(Object.keys(withoutVoice).sort()).toEqual(PAYLOAD_KEYS);
		expect(withoutVoice.voice_sample).toBe('');
		expect(withoutVoice.raw_input).toBe('');
		expect('verbose' in withVoice).toBe(false);
		expect(
			withVoice.decision_makers.map((dm) => Object.keys(dm).sort())
		).toEqual([['name', 'organization', 'title']]);
	});

	it('carries the operator’s own words on a Studio-shaped build: raw_input = core message, voice_sample empty', () => {
		const studioPayload = buildMessageGenerationPayload({
			subjectLine: SUBJECT,
			coreMessage: CORE,
			topics: deriveTopicsFromSubject(SUBJECT),
			decisionMakers: resolvedDecisionMakers,
			voiceSample: '',
			rawInput: CORE,
			geographicScope: fixtureScope
		});

		expect(CORE.length).toBeGreaterThan(0);
		expect(studioPayload.raw_input).toBe(CORE);
		expect(studioPayload.voice_sample).toBe('');
	});

	it('reproduces the golden citizen payload for a frozen objective, field for field', () => {
		const objective = {
			title: SUBJECT,
			description: CORE,
			rawInput: RAW,
			voiceSample: VOICE,
			topics: TOPICS,
			domain: 'transportation'
		};

		// The citizen surface's exact gathering: title, description-first core
		// message chain, shared topic/voice helpers, identity-mapped
		// decision-makers, shared scope inference.
		const citizenPayload = buildMessageGenerationPayload({
			subjectLine: objective.title,
			coreMessage: objective.description || objective.rawInput || objective.title,
			topics: buildTopics(objective),
			decisionMakers: mappedDecisionMakers,
			voiceSample: buildVoiceSample(objective),
			rawInput: buildRawInput(objective),
			geographicScope: inferGeoScope({ decisionMakers: mappedDecisionMakers }).scope
		});

		expect(citizenPayload).toEqual({
			subject_line: 'Keep the Sacramento night bus running',
			core_message: 'Route 11 night service is being cut.',
			topics: ['transit', 'night service'],
			decision_makers: [
				{
					name: 'Alicia Reyes',
					title: 'Board Chair',
					organization: 'Sacramento Regional Transit District Board'
				}
			],
			voice_sample: 'after closing shift there is no other way home',
			raw_input: 'i ride route 11 home after closing shift',
			geographic_scope: { type: 'nationwide', country: 'US', displayName: 'United States' }
		});
	});

	it('rejects an incomplete intent with the exact surface error strings', () => {
		expect(() =>
			buildMessageGenerationPayload({
				subjectLine: '',
				coreMessage: CORE,
				topics: TOPICS,
				decisionMakers: mappedDecisionMakers,
				geographicScope: fixtureScope
			})
		).toThrow(/^Missing subject line$/);

		expect(() =>
			buildMessageGenerationPayload({
				subjectLine: SUBJECT,
				coreMessage: CORE,
				topics: TOPICS,
				decisionMakers: [],
				geographicScope: fixtureScope
			})
		).toThrow(/^No decision-makers selected$/);
	});
});

describe('surface source binding', () => {
	it('both surfaces import and call the one shared builder', () => {
		for (const source of [resolverSource, processSource]) {
			expect(source).toContain("from '$lib/utils/authoring-inputs'");
			expect(source).toContain('buildMessageGenerationPayload(');
		}
	});

	it('neither surface keeps a local payload type or hand-built voice fields', () => {
		for (const source of [resolverSource, processSource]) {
			expect(source).not.toContain('type MessageGenerationPayload = {');
			expect(source).not.toContain('voice_sample:');
			expect(source).not.toContain('raw_input:');
		}
	});

	it('Studio carries verbose only in its two fetch bodies, never in the hashed payload', () => {
		// Two transport sites: the decision-maker stream and the message stream.
		expect(processSource.split('verbose: true').length - 1).toBe(2);
		// The type-member form of the old local payload type is gone.
		expect(processSource).not.toContain('verbose: true;');
		// verbose no longer rides next to the payload's geographic scope.
		expect(processSource).not.toMatch(/geographic_scope[\s\S]{0,80}verbose/);
	});
});
