import { describe, expect, it, vi } from 'vitest';
import {
	PUBLIC_RECIPIENT_PROVENANCE_TTL_MS,
	PUBLIC_RECIPIENT_PROVENANCE_VERSION,
	issuePublicRecipientProvenance,
	normalizePublicRecipientProvenanceClaims,
	verifyPublicRecipientProvenance
} from '../../../convex/lib/publicRecipientProvenance';
import { publicRecipientIntentCount } from '../../../convex/lib/publicTemplateDiscoverySource';

const ACTIVE_SECRET = 'active-public-recipient-secret-32-bytes-minimum';
const PREVIOUS_SECRET = 'previous-public-recipient-secret-32-bytes-minimum';
const USER_ID = 'users:author-1';
const NOW = 1_800_000_000_000;

function groundedRecipient() {
	return {
		name: '  Ada   Lovelace ',
		title: 'Director',
		organization: 'Agency',
		email: ' Ada@Agency.GOV ',
		emailSource: 'https://agency.gov/contact',
		isAiResolved: true,
		emailGrounded: true,
		publicEmailGrounding: {
			version: 1,
			method: 'page-read',
			source: 'https://agency.gov/contact'
		},
		roleCategory: 'executes',
		personalPrompt: 'private authoring prompt'
	};
}

async function attestRow(row: Record<string, unknown>, secret = ACTIVE_SECRET) {
	const publicRecipientProvenance = await issuePublicRecipientProvenance(row, USER_ID, secret, NOW);
	expect(publicRecipientProvenance).not.toBeNull();
	return { ...row, publicRecipientProvenance: publicRecipientProvenance! };
}

async function attestedRecipient(secret = ACTIVE_SECRET) {
	return attestRow(groundedRecipient(), secret);
}

describe('public recipient provenance', () => {
	it('counts current and legacy recipient-intent shapes without compatibility double-counting', () => {
		expect(
			publicRecipientIntentCount({
				decisionMakers: [{ email: 'one@example.test' }, { email: 'two@example.test' }],
				customRecipients: [{ email: 'three@example.test' }],
				recipientEmails: [
					'one@example.test',
					'two@example.test',
					'three@example.test'
				],
				emails: ['one@example.test', 'two@example.test', 'three@example.test']
			})
		).toBe(3);
		expect(
			publicRecipientIntentCount({
				recipients: [{ type: 'congressional' }, { email: 'direct@example.test' }]
			})
		).toBe(2);
	});

	it('returns only canonical signed public claims', async () => {
		const verified = await verifyPublicRecipientProvenance(
			await attestedRecipient(),
			USER_ID,
			[ACTIVE_SECRET],
			NOW
		);

		expect(verified).toEqual({
			email: 'ada@agency.gov',
			emailSource: 'https://agency.gov/contact',
			name: 'Ada Lovelace',
			title: 'Director',
			organization: 'Agency',
			roleCategory: 'executes'
		});
		expect(verified).not.toHaveProperty('personalPrompt');
	});

	it('excludes accountability copy and model rank from normalized claims and the signature preimage', async () => {
		const recipient = groundedRecipient();
		const withExcludedFields = {
			...recipient,
			accountabilityOpener: 'Please account for the published decision.',
			relevanceRank: 1
		};
		const [proofWithoutExcludedFields, proofWithExcludedFields] = await Promise.all([
			issuePublicRecipientProvenance(recipient, USER_ID, ACTIVE_SECRET, NOW),
			issuePublicRecipientProvenance(withExcludedFields, USER_ID, ACTIVE_SECRET, NOW)
		]);

		expect(proofWithExcludedFields?.signature).toBe(proofWithoutExcludedFields?.signature);
		const normalized = normalizePublicRecipientProvenanceClaims(withExcludedFields);
		expect(normalized).not.toHaveProperty('accountabilityOpener');
		expect(normalized).not.toHaveProperty('relevanceRank');
	});

	it('rejects forgeable client flags without a server proof', async () => {
		expect(
			await verifyPublicRecipientProvenance(
				groundedRecipient(),
				USER_ID,
				[ACTIVE_SECRET],
				NOW
			)
		).toBeNull();
	});

	it.each([
		['email', 'other@agency.gov'],
		['emailSource', 'https://agency.gov/other'],
		['name', 'Other Person'],
		['title', 'Deputy Director'],
		['organization', 'Other Agency'],
		['roleCategory', 'shapes']
	] as const)('rejects tampering with signed %s', async (field, value) => {
		const recipient = await attestedRecipient();
		const tampered = { ...recipient, [field]: value };
		expect(
			await verifyPublicRecipientProvenance(tampered, USER_ID, [ACTIVE_SECRET], NOW)
		).toBeNull();
	});

	it('binds the proof to the author and expiry window', async () => {
		const recipient = await attestedRecipient();
		expect(
			await verifyPublicRecipientProvenance(recipient, 'users:other', [ACTIVE_SECRET], NOW)
		).toBeNull();
		expect(
			await verifyPublicRecipientProvenance(
				recipient,
				USER_ID,
				[ACTIVE_SECRET],
				NOW + PUBLIC_RECIPIENT_PROVENANCE_TTL_MS + 60_001
			)
		).toBeNull();
	});

	it('accepts the previous secret during rotation', async () => {
		const recipient = await attestedRecipient(PREVIOUS_SECRET);
		expect(
			await verifyPublicRecipientProvenance(
				recipient,
				USER_ID,
				[ACTIVE_SECRET, PREVIOUS_SECRET],
				NOW
			)
		).not.toBeNull();
	});

	it('refuses non-HTTPS sources, credentials, or fragments', async () => {
		for (const emailSource of [
			'http://agency.gov/contact',
			'https://user:pass@agency.gov/contact',
			'https://agency.gov/contact#ada'
		]) {
			expect(
				await issuePublicRecipientProvenance(
					{
						...groundedRecipient(),
						emailSource,
						publicEmailGrounding: {
							version: 1,
							method: 'page-read',
							source: emailSource
						}
					},
					USER_ID,
					ACTIVE_SECRET,
					NOW
				)
			).toBeNull();
		}
	});

	it('round-trips a query-string source byte-identically', async () => {
		const emailSource = 'https://agency.gov/contact?dept=planning&view=staff';
		const recipient = {
			...groundedRecipient(),
			emailSource,
			publicEmailGrounding: {
				version: 1,
				method: 'page-read',
				source: emailSource
			}
		};
		const publicRecipientProvenance = await issuePublicRecipientProvenance(
			recipient,
			USER_ID,
			ACTIVE_SECRET,
			NOW
		);
		expect(publicRecipientProvenance).not.toBeNull();

		const claims = await verifyPublicRecipientProvenance(
			{ ...recipient, publicRecipientProvenance: publicRecipientProvenance! },
			USER_ID,
			[ACTIVE_SECRET],
			NOW
		);
		expect(claims?.emailSource).toBe(emailSource);
	});

	describe('the attestation is a closed shape', () => {
		it.each([
			['a reach term this issuer no longer writes', { reaches: 'seat' }],
			['a label this issuer no longer writes', { reachesLabel: 'Office of the County Clerk' }],
			['a term this issuer has never written', { seatRoute: true }]
		])('refuses an attestation with %s stapled onto it', async (_name, stapled) => {
			// The key ALLOWLIST, not a check on any named key: an attestation whose key
			// set is not a subset of what the issuer emits is refused whatever the extra
			// key is called. Stripping it instead would MAC cleanly while handing the
			// reader an object saying more than the issuer asserted.
			//
			// `reaches` is in this table for a reason: a per-recipient seat judgment was
			// signed into this preimage for a while and has been removed, so a stored
			// attestation minted under that shape must now be REFUSED rather than
			// silently verified against the narrower preimage it no longer matches.
			const attested = await attestedRecipient();
			expect(
				await verifyPublicRecipientProvenance(
					{
						...attested,
						publicRecipientProvenance: { ...attested.publicRecipientProvenance, ...stapled }
					},
					USER_ID,
					[ACTIVE_SECRET],
					NOW
				)
			).toBeNull();
		});

		it('reads nothing off the row — only the attestation decides', async () => {
			// The producer still mints `emailReachesClaim` / `emailReachesLabel` on the
			// row. Neither is signed, published or read by any policy, so an author who
			// edits them changes nothing about what verifies.
			const attested = await attestedRecipient();
			const verified = await verifyPublicRecipientProvenance(
				{ ...attested, emailReachesClaim: 'seat', emailReachesLabel: 'Office of the Mayor' },
				USER_ID,
				[ACTIVE_SECRET],
				NOW
			);
			expect(verified).not.toBeNull();
			expect(verified).not.toHaveProperty('reaches');
			expect(verified).not.toHaveProperty('reachesLabel');
			expect(JSON.stringify(attested.publicRecipientProvenance)).not.toContain('Office of the');
		});

		it('refuses a predecessor-version attestation on the version check, before any MAC work', async () => {
			// Back at 2, and PROVEN back rather than renamed: `canonicalPayload`'s
			// element list is byte-identical to the v2 shape this constant last named.
			expect(PUBLIC_RECIPIENT_PROVENANCE_VERSION).toBe(2);
			const attested = await attestedRecipient();
			const verifySpy = vi.spyOn(crypto.subtle, 'verify');
			try {
				for (const version of [3, 4]) {
					expect(
						await verifyPublicRecipientProvenance(
							{
								...attested,
								publicRecipientProvenance: { ...attested.publicRecipientProvenance, version }
							},
							USER_ID,
							[ACTIVE_SECRET],
							NOW
						)
					).toBeNull();
				}
				expect(verifySpy).not.toHaveBeenCalled();
			} finally {
				verifySpy.mockRestore();
			}
		});
	});

	it('refuses stale cache hits and unbound grounding markers', async () => {
		const recipient = groundedRecipient();
		const { publicEmailGrounding: _grounding, ...withoutFreshGrounding } = recipient;

		expect(
			await issuePublicRecipientProvenance(
				{ ...withoutFreshGrounding, cacheHit: true },
				USER_ID,
				ACTIVE_SECRET,
				NOW
			)
		).toBeNull();
		expect(
			await issuePublicRecipientProvenance(
				{
					...recipient,
					publicEmailGrounding: {
						version: 1,
						method: 'page-read',
						source: 'https://agency.gov/other-contact'
					}
				},
				USER_ID,
				ACTIVE_SECRET,
				NOW
			)
		).toBeNull();
	});
});
