import { json, error } from '@sveltejs/kit';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

/**
 * Vend scoped STS credentials for client-direct SES sends.
 *
 * Returns temporary credentials that only allow ses:SendEmail
 * from the org's verified FromAddress (slug@commons.email).
 *
 * Rate limited: 1 token per org per 5 minutes.
 * Token lifetime: 15 minutes (900 seconds — STS minimum).
 *
 * Env vars required:
 *   SES_SEND_ROLE_ARN — IAM role ARN that the SvelteKit server assumes
 *   AWS_REGION — SES region (default us-east-1)
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — server credentials to call AssumeRole
 */

const ROLE_HIERARCHY: Record<string, number> = { member: 0, editor: 1, owner: 2 };
const TOKEN_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// In-memory rate limit: orgId -> last issued timestamp
const lastIssuedMap = new Map<string, number>();

export const POST: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Authentication required');

	// Verify user is editor+ on this org via Convex
	const orgContext = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
	if (!orgContext) throw error(404, 'Organization not found');

	const roleLevel = ROLE_HIERARCHY[orgContext.membership.role] ?? -1;
	if (roleLevel < ROLE_HIERARCHY.editor) {
		throw error(403, 'Editor role or higher required');
	}

	const orgId = orgContext.org._id;

	// Rate limit: 1 token per org per 5 minutes
	const lastIssued = lastIssuedMap.get(orgId);
	if (lastIssued && Date.now() - lastIssued < TOKEN_COOLDOWN_MS) {
		const retryAfter = Math.ceil((TOKEN_COOLDOWN_MS - (Date.now() - lastIssued)) / 1000);
		throw error(429, `Token already issued recently. Retry after ${retryAfter}s`);
	}

	const roleArn = env.SES_SEND_ROLE_ARN;
	if (!roleArn) throw error(500, 'SES_SEND_ROLE_ARN not configured');

	const sts = new STSClient({
		region: env.AWS_REGION ?? 'us-east-1',
		credentials: {
			accessKeyId: env.AWS_ACCESS_KEY_ID!,
			secretAccessKey: env.AWS_SECRET_ACCESS_KEY!
		}
	});

	const sessionPolicy = JSON.stringify({
		Version: '2012-10-17',
		Statement: [
			{
				Effect: 'Allow',
				Action: ['ses:SendEmail', 'ses:SendRawEmail'],
				Resource: '*',
				Condition: {
					StringEquals: {
						'ses:FromAddress': `${params.slug}@commons.email`
					}
				}
			}
		]
	});

	const command = new AssumeRoleCommand({
		RoleArn: roleArn,
		RoleSessionName: `blast-${orgId}-${Date.now()}`,
		DurationSeconds: 900, // 15 min — STS minimum
		Policy: sessionPolicy
	});

	try {
		const response = await sts.send(command);
		const creds = response.Credentials;
		if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
			throw new Error('STS returned incomplete credentials');
		}

		// Mark token as issued for rate limiting
		lastIssuedMap.set(orgId, Date.now());

		return json({
			accessKeyId: creds.AccessKeyId,
			secretAccessKey: creds.SecretAccessKey,
			sessionToken: creds.SessionToken,
			expiration: creds.Expiration?.toISOString()
		});
	} catch (err) {
		if (err instanceof Error && 'status' in err) throw err; // re-throw SvelteKit errors
		const message = err instanceof Error ? err.message : 'STS AssumeRole failed';
		throw error(500, message);
	}
};
