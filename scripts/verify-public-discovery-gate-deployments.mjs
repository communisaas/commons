#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
	PUBLIC_DISCOVERY_GATE_WORKERS,
	verifyPublicDiscoveryGateWorkers
} from './verify-pages-durable-object-binding.mjs';

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		if (
			process.argv.length !== 4 ||
			process.argv[2] !== '--environment' ||
			!['preview', 'production'].includes(process.argv[3])
		) {
			throw new Error(
				'Usage: verify-public-discovery-gate-deployments --environment preview|production'
			);
		}
		const environment = /** @type {'preview'|'production'} */ (process.argv[3]);
		const namespaceIds = await verifyPublicDiscoveryGateWorkers({
			accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
			apiToken: process.env.CLOUDFLARE_API_TOKEN,
			realms: [environment]
		});
		console.log(
			JSON.stringify({
				environment,
				worker: PUBLIC_DISCOVERY_GATE_WORKERS[environment],
				namespaceId: namespaceIds[environment]
			})
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
