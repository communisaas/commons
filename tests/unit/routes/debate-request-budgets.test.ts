import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('debate launch request budgets', () => {
	const bodyRoutes = [
		'src/routes/api/debates/[debateId]/claim/+server.ts',
		'src/routes/api/debates/[debateId]/commit/+server.ts',
		'src/routes/api/debates/[debateId]/reveal/+server.ts',
		'src/routes/api/debates/[debateId]/governance-resolve/+server.ts',
		'src/routes/api/debates/[debateId]/settle/+server.ts'
	];

	it.each(bodyRoutes)('%s uses a streaming bounded JSON read', (path) => {
		const route = source(path);
		expect(route).toContain("from '$lib/server/bounded-json'");
		expect(route).toMatch(/readBoundedJson\(request,\s*[A-Z_]+\)/);
		expect(route).not.toContain('request.json(');
	});

	it('proof-bearing routes enforce exact field cardinality and byte envelopes', () => {
		const claim = source(bodyRoutes[0]);
		expect(claim).toContain('isBytes32(nullifierHex)');
		expect(claim).toContain('positionPublicInputs.length !== 5');
		expect(claim).toContain('isBoundedHexBytes(positionProof)');

		const commit = source(bodyRoutes[1]);
		expect(commit).toContain('isBytes32(commitHash)');
		expect(commit).toContain('isThreeTreePublicInputs(publicInputs)');
		expect(commit).toContain('VALID_THREE_TREE_DEPTHS');

		const reveal = source(bodyRoutes[2]);
		expect(reveal).toContain('isBytes32(nonce)');
		expect(reveal).toContain('debateWeightPublicInputs.length !== 2');
		expect(reveal).toContain('debateWeightPublicInputs.every(isBytes32)');
	});

	it('every route-originated status transition supplies an expected-state CAS', () => {
		for (const path of [
			'src/routes/api/debates/[debateId]/appeal/+server.ts',
			'src/routes/api/debates/[debateId]/evaluate/+server.ts',
			'src/routes/api/debates/[debateId]/governance-resolve/+server.ts',
			'src/routes/api/debates/[debateId]/resolve/+server.ts',
			'src/routes/api/debates/[debateId]/settle/+server.ts'
		]) {
			const route = source(path);
			const calls = route.split('api.debates.updateStatus').length - 1;
			const expectedStates = route.split('expectedStatus:').length - 1;
			expect(expectedStates, path).toBe(calls);
		}
	});
});
