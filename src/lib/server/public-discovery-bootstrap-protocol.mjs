/**
 * Runtime-neutral bootstrap protocol primitives. Node release tooling and the
 * Pages/Worker TypeScript boundaries import this one module so security-
 * sensitive paths, headers, and lifetime limits cannot drift independently.
 */
export const PUBLIC_DISCOVERY_BOOTSTRAP_PATH = '/api/internal/public-discovery-manifest-refresh';
export const PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_PATH = '/control-bootstrap-authority';
export const PUBLIC_DISCOVERY_BOOTSTRAP_COMPLETION_PATH = '/complete-bootstrap';
export const PUBLIC_DISCOVERY_BOOTSTRAP_PURPOSE = 'public-discovery-corpus-bootstrap';
export const PUBLIC_DISCOVERY_BOOTSTRAP_SEED_PURPOSE = 'deploy-seed';
export const PUBLIC_DISCOVERY_BOOTSTRAP_PROVENANCE_HEADER =
	'x-public-discovery-bootstrap-provenance';
export const PUBLIC_DISCOVERY_BOOTSTRAP_LEASE_HEADER = 'x-public-discovery-bootstrap-lease';
export const PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_HEADER =
	'x-commons-public-discovery-bootstrap-boundary';
export const PUBLIC_DISCOVERY_BOOTSTRAP_BOUNDARY_PROTOCOL = 'v1';
export const PUBLIC_DISCOVERY_BOOTSTRAP_GENERATION_HEADER = 'x-public-discovery-generation';
export const PUBLIC_DISCOVERY_BOOTSTRAP_MAXIMUM_AUTHORITY_MS = 60 * 60 * 1000;
