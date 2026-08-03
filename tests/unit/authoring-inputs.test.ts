/**
 * Unit Tests — Authoring Input Derivations
 *
 * Golden table for the shared objective→agent-input helpers: topic selection
 * with domain fallback, voice-sample and raw-input precedence chains, and the
 * subject-line topic word-split used by surfaces that have no AI topics.
 */

import { describe, it, expect } from 'vitest';
import {
	buildTopics,
	buildVoiceSample,
	buildRawInput,
	deriveTopicsFromSubject
} from '$lib/utils/authoring-inputs';

describe('buildTopics', () => {
	it('returns non-blank AI topics unchanged', () => {
		expect(buildTopics({ topics: ['transit funding', 'bus lanes'], domain: 'Transportation' })).toEqual([
			'transit funding',
			'bus lanes'
		]);
	});

	it('drops blank and whitespace-only entries while keeping valid ones', () => {
		expect(buildTopics({ topics: ['', '  ', 'zoning reform'], domain: 'Housing' })).toEqual([
			'zoning reform'
		]);
	});

	it('falls through to the domain when every topic entry is blank', () => {
		expect(buildTopics({ topics: ['', '   '], domain: ' Housing Policy ' })).toEqual([
			'housing policy'
		]);
	});

	it('returns the lowercased, trimmed domain when topics are absent', () => {
		expect(buildTopics({ domain: 'School Facilities' })).toEqual(['school facilities']);
	});

	it('returns the lowercased, trimmed domain when topics are an empty array', () => {
		expect(buildTopics({ topics: [], domain: ' Parking ' })).toEqual(['parking']);
	});

	it('returns an empty array when there are neither topics nor a domain', () => {
		expect(buildTopics({ domain: '' })).toEqual([]);
		expect(buildTopics({ topics: [], domain: '   ' })).toEqual([]);
	});
});

describe('buildVoiceSample', () => {
	it('prefers the AI-extracted voiceSample', () => {
		expect(
			buildVoiceSample({ voiceSample: 'peak', rawInput: 'raw', description: 'desc' })
		).toBe('peak');
	});

	it('falls back to rawInput when voiceSample is empty', () => {
		expect(buildVoiceSample({ voiceSample: '', rawInput: 'raw', description: 'desc' })).toBe(
			'raw'
		);
	});

	it('falls back to description when voiceSample and rawInput are empty', () => {
		expect(buildVoiceSample({ voiceSample: '', rawInput: '', description: 'desc' })).toBe('desc');
	});

	it('returns an empty string when every rung is empty', () => {
		expect(buildVoiceSample({ voiceSample: '', rawInput: '', description: '' })).toBe('');
	});
});

describe('buildRawInput', () => {
	it('prefers rawInput', () => {
		expect(buildRawInput({ rawInput: 'raw', description: 'desc' })).toBe('raw');
	});

	it('falls back to description when rawInput is empty', () => {
		expect(buildRawInput({ rawInput: '', description: 'desc' })).toBe('desc');
	});

	it('returns an empty string when both rungs are empty', () => {
		expect(buildRawInput({ rawInput: '', description: '' })).toBe('');
	});
});

describe('deriveTopicsFromSubject', () => {
	it('lowercases, splits on non-alphanumeric runs, drops short tokens, and caps at 4', () => {
		// Six qualifying words (pfas, chemicals, municipal, water, supply, systems)
		// must yield exactly the first 4.
		expect(deriveTopicsFromSubject('Ban PFAS Chemicals in Municipal Water-Supply Systems Now!!')).toEqual([
			'pfas',
			'chemicals',
			'municipal',
			'water'
		]);
	});

	it('drops tokens of length 3 or less', () => {
		expect(deriveTopicsFromSubject('End the ban on tiny homes')).toEqual(['tiny', 'homes']);
	});

	it('falls back to the raw subject line when no token survives the length filter', () => {
		expect(deriveTopicsFromSubject('Fix the bus now')).toEqual(['Fix the bus now']);
	});

	it('truncates the no-survivor fallback at 60 characters', () => {
		const subject = 'no way to say so '.repeat(5); // 85 chars, no token longer than 3
		const [fallback] = deriveTopicsFromSubject(subject);
		expect(fallback).toBe(subject.slice(0, 60));
		expect(fallback).toHaveLength(60);
	});
});

describe('idempotence', () => {
	it('returns deep-equal output when each helper is called twice with the same input', () => {
		const objective = {
			topics: ['transit funding', ''],
			domain: 'Transportation',
			voiceSample: 'peak',
			rawInput: 'raw',
			description: 'desc'
		};
		expect(buildTopics(objective)).toEqual(buildTopics(objective));
		expect(buildVoiceSample(objective)).toEqual(buildVoiceSample(objective));
		expect(buildRawInput(objective)).toEqual(buildRawInput(objective));
		expect(deriveTopicsFromSubject('Ban PFAS Chemicals Everywhere')).toEqual(
			deriveTopicsFromSubject('Ban PFAS Chemicals Everywhere')
		);
	});
});
