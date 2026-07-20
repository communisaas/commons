import { describe, expect, it } from 'vitest';
import * as nodeProtocol from '../../../src/lib/server/public-discovery-bootstrap-protocol.mjs';
import * as runtimeProtocol from '$lib/server/public-discovery-bootstrap-runtime';

describe('runtime-neutral public-discovery bootstrap protocol', () => {
	it('keeps Node orchestration and Worker runtime on one exact primitive contract', () => {
		expect(nodeProtocol).toMatchObject({
			PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER:
				'x-commons-public-discovery-bootstrap-boundary',
			PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL: 'v1',
			PUBLIC_DISCOVERY_BOOTSTRAP_COMPLETION_PATH: '/complete-bootstrap',
			PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_PATH: '/control-bootstrap-authority',
			PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_HEADER: 'x-public-discovery-generation',
			PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER: 'x-public-discovery-bootstrap-lease',
			PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS: 60 * 60 * 1000,
			PUBLIC_DISCOVERY_BOOTSTRAP_PATH: '/api/internal/public-discovery-manifest-refresh',
			PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER:
				'x-public-discovery-bootstrap-provenance',
			PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE: 'public-discovery-corpus-bootstrap',
			PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE: 'deploy-seed'
		});
		for (const [name, value] of Object.entries(nodeProtocol)) {
			expect(runtimeProtocol[name as keyof typeof runtimeProtocol]).toBe(value);
		}
	});
});
