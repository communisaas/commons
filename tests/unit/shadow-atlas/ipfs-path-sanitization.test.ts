/**
 * Tests for IPFS path segment sanitization.
 *
 * All IPFS fetch paths interpolate country, parentKey, and districtCode
 * into URLs. sanitizePathSegment rejects strings containing '..' or '/'
 * to prevent path traversal within the IPFS DAG.
 */

import { describe, it, expect } from 'vitest';
import { sanitizePathSegment } from '$lib/core/shadow-atlas/ipfs-store';

describe('sanitizePathSegment', () => {
	// Valid segments
	it('should accept a simple country code', () => {
		expect(sanitizePathSegment('US')).toBe('US');
	});

	it('should accept an H3 cell index', () => {
		expect(sanitizePathSegment('832a30fffffffff')).toBe('832a30fffffffff');
	});

	it('should accept a district code with hyphen', () => {
		expect(sanitizePathSegment('CA-12')).toBe('CA-12');
	});

	it('should accept a dotted segment without traversal', () => {
		expect(sanitizePathSegment('v1.2')).toBe('v1.2');
	});

	// Traversal attacks
	it('should reject double-dot traversal', () => {
		expect(() => sanitizePathSegment('..')).toThrow('illegal characters');
	});

	it('should reject traversal embedded in path', () => {
		expect(() => sanitizePathSegment('US/../secrets')).toThrow('illegal characters');
	});

	it('should reject forward slash', () => {
		expect(() => sanitizePathSegment('US/manifest.json')).toThrow('illegal characters');
	});

	it('should reject backslash', () => {
		expect(() => sanitizePathSegment('US\\manifest.json')).toThrow('illegal characters');
	});

	it('should reject double-dot at start', () => {
		expect(() => sanitizePathSegment('../etc/passwd')).toThrow('illegal characters');
	});

	it('should reject double-dot at end', () => {
		expect(() => sanitizePathSegment('US/..')).toThrow('illegal characters');
	});

	// Empty / non-string
	it('should reject empty string', () => {
		expect(() => sanitizePathSegment('')).toThrow('non-empty string');
	});

	it('should reject null', () => {
		expect(() => sanitizePathSegment(null as unknown as string)).toThrow('non-empty string');
	});

	it('should reject undefined', () => {
		expect(() => sanitizePathSegment(undefined as unknown as string)).toThrow('non-empty string');
	});

	it('should reject number', () => {
		expect(() => sanitizePathSegment(42 as unknown as string)).toThrow('non-empty string');
	});
});
