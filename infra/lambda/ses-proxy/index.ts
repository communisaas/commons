/**
 * Lambda Function URL — thin SES proxy with CORS.
 *
 * Accepts scoped STS credentials from the client (vended by the SvelteKit
 * ses-token endpoint) and sends emails via SES on the caller's behalf.
 *
 * The Lambda itself has NO IAM SES permissions — it uses the caller-provided
 * credentials, so authorization is enforced by the STS session policy.
 *
 * Deploy as Lambda Function URL (not API Gateway).
 * Runtime: nodejs20.x, architecture: arm64, memory: 128MB, timeout: 60s.
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

interface BlastRequest {
	credentials: {
		accessKeyId: string;
		secretAccessKey: string;
		sessionToken: string;
	};
	recipients: string[];
	subject: string;
	bodyHtml: string;
	fromEmail: string;
	fromName: string;
	blastId?: string;
}

interface RecipientResult {
	email: string;
	status: 'sent' | 'failed';
	messageId?: string;
	error?: string;
}

export async function handler(event: {
	requestContext?: { http?: { method?: string } };
	body?: string;
}) {
	const corsHeaders = {
		'Access-Control-Allow-Origin': 'https://commons.email',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type'
	};

	// Handle CORS preflight
	if (event.requestContext?.http?.method === 'OPTIONS') {
		return { statusCode: 204, headers: corsHeaders };
	}

	if (!event.body) {
		return {
			statusCode: 400,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({ error: 'Request body required' })
		};
	}

	let body: BlastRequest;
	try {
		body = JSON.parse(event.body);
	} catch {
		return {
			statusCode: 400,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({ error: 'Invalid JSON' })
		};
	}

	if (!body.credentials?.accessKeyId || !body.recipients?.length || !body.subject || !body.bodyHtml || !body.fromEmail) {
		return {
			statusCode: 400,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({ error: 'Missing required fields: credentials, recipients, subject, bodyHtml, fromEmail' })
		};
	}

	// Create SES client with the caller's scoped STS credentials
	const ses = new SESClient({
		region: process.env.AWS_REGION || 'us-east-1',
		credentials: {
			accessKeyId: body.credentials.accessKeyId,
			secretAccessKey: body.credentials.secretAccessKey,
			sessionToken: body.credentials.sessionToken
		}
	});

	// Strip control characters from header-interpolated values
	const safeFromName = (body.fromName || '').replace(/[\r\n\x00-\x1f\x7f]/g, '');
	const safeSubject = body.subject.replace(/[\r\n\x00-\x1f\x7f]/g, '');

	const results: RecipientResult[] = [];

	for (const recipient of body.recipients) {
		try {
			const cmd = new SendEmailCommand({
				Source: safeFromName ? `${safeFromName} <${body.fromEmail}>` : body.fromEmail,
				Destination: { ToAddresses: [recipient] },
				Message: {
					Subject: { Data: safeSubject },
					Body: { Html: { Data: body.bodyHtml } }
				}
			});

			const res = await ses.send(cmd);
			results.push({ email: recipient, status: 'sent', messageId: res.MessageId });
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Unknown SES error';
			results.push({ email: recipient, status: 'failed', error: message });
		}
	}

	return {
		statusCode: 200,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			total: body.recipients.length,
			sent: results.filter((r) => r.status === 'sent').length,
			failed: results.filter((r) => r.status === 'failed').length,
			results
		})
	};
}
