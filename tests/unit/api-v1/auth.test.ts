import { describe, it, expect } from 'vitest';
import { requireScope, type ApiKeyContext } from '$lib/server/api-v1/auth';
import type { Id } from '../../../convex/_generated/dataModel';

function makeContext(scopes: string[]): ApiKeyContext {
	return {
		orgId: 'org_test123' as Id<'organizations'>,
		keyId: 'key_test123' as Id<'apiKeys'>,
		scopes,
		planSlug: 'inactive'
	};
}

describe('requireScope', () => {
	it('should allow read scope when key has read', () => {
		const result = requireScope(makeContext(['read']), 'read');
		expect(result).toBeNull();
	});

	it('should allow read scope when key has write (write implies read)', () => {
		const result = requireScope(makeContext(['write']), 'read');
		expect(result).toBeNull();
	});

	it('should allow read scope when key has both read and write', () => {
		const result = requireScope(makeContext(['read', 'write']), 'read');
		expect(result).toBeNull();
	});

	it('should allow write scope when key has write', () => {
		const result = requireScope(makeContext(['write']), 'write');
		expect(result).toBeNull();
	});

	it('should allow write scope when key has both read and write', () => {
		const result = requireScope(makeContext(['read', 'write']), 'write');
		expect(result).toBeNull();
	});

	it('should deny write scope when key only has read', () => {
		const result = requireScope(makeContext(['read']), 'write');
		expect(result).toBeInstanceOf(Response);
		expect(result!.status).toBe(403);
	});

	it('should deny read scope when key has no scopes', () => {
		const result = requireScope(makeContext([]), 'read');
		expect(result).toBeInstanceOf(Response);
		expect(result!.status).toBe(403);
	});

	it('should deny write scope when key has no scopes', () => {
		const result = requireScope(makeContext([]), 'write');
		expect(result).toBeInstanceOf(Response);
		expect(result!.status).toBe(403);
	});

	it('should return error response with correct body structure', async () => {
		const result = requireScope(makeContext(['read']), 'write');
		expect(result).not.toBeNull();
		const body = await result!.json();
		expect(body).toEqual({
			data: null,
			error: {
				code: 'FORBIDDEN',
				message: "API key does not have the 'write' scope"
			}
		});
	});
});
