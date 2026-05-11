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

import { SESClient, SendEmailCommand, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

interface BlastRequest {
	credentials: {
		accessKeyId: string;
		secretAccessKey: string;
		sessionToken: string;
	};
	recipients: string[];
	// Per-recipient hashes (1:1 with `recipients`) — `SHA-256(orgId + ":email:" + normalized)`.
	// When supplied alongside `dispatchClaim`, Lambda enforces caller-cohort
	// membership: any recipient whose hash is not in the claim's allowed-hash
	// set is rejected at this layer, even if the caller's STS credentials
	// would otherwise authorize the SES SendEmail. (defense-in-depth).
	recipientHashes?: string[];
	subject: string;
	bodyHtml: string;
	fromEmail: string;
	fromName: string;
	blastId?: string;
	// Per-recipient unsubscribe URLs (1:1 with `recipients`). When present,
	// the Lambda switches from SendEmail to SendRawEmail and injects
	// `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
	// headers per RFC 8058 (Gmail/Yahoo bulk-sender requirement). Vended by
	// the SvelteKit `/api/blast/[blastId]/unsubscribe-tokens` endpoint.
	unsubscribeUrls?: string[];
	// Server-signed `payload.signature` claim binding (orgId, blastId,
	// allowedHashes[], iat, exp). When supplied, Lambda verifies the signature
	// against `BLAST_DISPATCH_SECRET`, checks expiry, and rejects any
	// recipient whose `recipientHashes[i]` is absent from the claim's allowed
	// set. (path B: defense-in-depth on the existing browser-direct
	// flow without re-architecting STS auth).
	dispatchClaim?: string;
}

interface DispatchClaim {
	orgId: string;
	blastId: string;
	allowedHashes: string[];
	iat: number;
	exp: number;
}

function bytesFromBase64Url(s: string): Buffer | null {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
	try {
		return Buffer.from(b64, 'base64');
	} catch {
		return null;
	}
}

// Org-scoped email hash matches `convex/_orgHash.ts:computeOrgScopedEmailHash`
// — `SHA-256(orgId + ":email:" + email.trim().toLowerCase())`. Lambda MUST
// recompute from the supplied email rather than trust the caller's hash,
// otherwise a compromised editor could pair attacker recipients with allowed
// cohort hashes and bypass the cohort enforcement entirely. Any drift
// between this normalization and the Convex-side helper would silently
// invalidate every hash check; keep both in lockstep.
function recipientCohortHash(orgId: string, email: string): string {
	return createHash('sha256')
		.update(orgId + ':email:' + email.trim().toLowerCase())
		.digest('hex');
}

// Verifies against ANY of the supplied secrets so a rotation window where
// SvelteKit and Lambda momentarily hold different active secrets doesn't
// break in-flight blasts. Mirrors `src/lib/server/email/dispatch-claim.ts`
// `verifyDispatchClaim` semantics.
function verifyDispatchClaim(
	claim: string,
	secrets: string[]
): DispatchClaim | null {
	const candidates = secrets.filter((s) => typeof s === 'string' && s.length > 0);
	if (candidates.length === 0 || !claim) return null;
	const [payloadB64, sigB64] = claim.split('.');
	if (!payloadB64 || !sigB64) return null;
	const got = bytesFromBase64Url(sigB64);
	if (!got) return null;
	let signatureMatches = false;
	for (const secret of candidates) {
		const expected = createHmac('sha256', secret).update(payloadB64).digest();
		if (got.length !== expected.length) continue;
		if (timingSafeEqual(got, expected)) {
			signatureMatches = true;
			break;
		}
	}
	if (!signatureMatches) return null;
	const payloadBytes = bytesFromBase64Url(payloadB64);
	if (!payloadBytes) return null;
	let parsed: DispatchClaim;
	try {
		parsed = JSON.parse(payloadBytes.toString('utf-8'));
	} catch {
		return null;
	}
	if (
		typeof parsed.orgId !== 'string' ||
		typeof parsed.blastId !== 'string' ||
		!Array.isArray(parsed.allowedHashes) ||
		typeof parsed.iat !== 'number' ||
		typeof parsed.exp !== 'number'
	) {
		return null;
	}
	if (Date.now() > parsed.exp) return null;
	return parsed;
}

interface RecipientResult {
	email: string;
	status: 'sent' | 'failed';
	messageId?: string;
	error?: string;
	// Server-recomputed cohort hash — the receipt forward MUST use this, NOT
	// the caller-supplied hash (a compromised browser could otherwise corrupt
	// receipts for arbitrary recipient hashes within the blast cap).
	computedHash?: string;
}

// Build a minimal RFC 5322 MIME message with List-Unsubscribe headers.
// Body is base64-encoded so HTML lines can exceed 78 chars without escape
// concerns. CRLF line endings are required by RFC 5322. Defensive: rejects
// any header value containing `\r` or `\n` so a malicious upstream cannot
// inject additional headers via a tampered URL or subject.
function isHeaderSafe(value: string): boolean {
	return !/[\r\n]/.test(value);
}

// RFC 2047 encoded-word for non-ASCII header values. Subjects with emoji or
// accented characters render as raw UTF-8 in many email clients but strict
// MIME parsers treat anything outside printable ASCII (0x20-0x7E) as invalid
// in unstructured header text. Encoded-word format: `=?UTF-8?B?{base64}?=`.
// We apply only when the input contains a non-ASCII byte; ASCII subjects
// pass through unchanged for cleaner inbox previews.
function encodeMimeHeader(value: string): string {
	// eslint-disable-next-line no-control-regex
	if (!/[^\x20-\x7E]/.test(value)) {
		return value;
	}
	const b64 = Buffer.from(value, 'utf-8').toString('base64');
	return `=?UTF-8?B?${b64}?=`;
}

function buildRawMimeMessage(
	from: string,
	to: string,
	subject: string,
	bodyHtml: string,
	unsubscribeUrl: string,
): string | null {
	if (
		!isHeaderSafe(from) ||
		!isHeaderSafe(to) ||
		!isHeaderSafe(subject) ||
		!isHeaderSafe(unsubscribeUrl)
	) {
		return null;
	}
	const CRLF = '\r\n';
	const bodyBase64 = Buffer.from(bodyHtml, 'utf-8').toString('base64');
	// Wrap base64 at 76 chars per RFC 2045.
	const bodyWrapped = bodyBase64.replace(/(.{76})/g, '$1' + CRLF);
	const headers = [
		`From: ${encodeMimeHeader(from)}`,
		`To: ${to}`,
		`Subject: ${encodeMimeHeader(subject)}`,
		`List-Unsubscribe: <${unsubscribeUrl}>`,
		`List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
		`MIME-Version: 1.0`,
		`Content-Type: text/html; charset=UTF-8`,
		`Content-Transfer-Encoding: base64`,
	];
	return headers.join(CRLF) + CRLF + CRLF + bodyWrapped + CRLF;
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

	// Caller-cohort enforcement. Fail-closed: deployments MUST configure
	// BLAST_DISPATCH_SECRET, and every blast call MUST carry a verified
	// dispatch claim. Per-recipient cohort check uses the email-recomputed
	// hash (NOT caller-supplied) so a compromised editor cannot pair attacker
	// recipients with valid cohort hashes.
	// Active + optional rotation-window previous secret. SvelteKit signs
	// only with the active secret; Lambda accepts either so an in-flight
	// claim minted just before SvelteKit's rotation deploy still verifies.
	const dispatchSecret = process.env.BLAST_DISPATCH_SECRET;
	const dispatchSecretPrevious = process.env.BLAST_DISPATCH_SECRET_PREVIOUS;
	if (!dispatchSecret) {
		return {
			statusCode: 503,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				error: 'BLAST_DISPATCH_SECRET not configured — refusing to send'
			})
		};
	}
	if (!body.dispatchClaim) {
		return {
			statusCode: 403,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({ error: 'Dispatch claim required' })
		};
	}
	const dispatchSecrets = dispatchSecretPrevious
		? [dispatchSecret, dispatchSecretPrevious]
		: [dispatchSecret];
	const verifiedClaim = verifyDispatchClaim(body.dispatchClaim, dispatchSecrets);
	if (!verifiedClaim) {
		return {
			statusCode: 403,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({ error: 'Invalid or expired dispatch claim' })
		};
	}
	if (body.blastId && verifiedClaim.blastId !== body.blastId) {
		return {
			statusCode: 403,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({ error: 'Dispatch claim does not match blastId' })
		};
	}
	const allowedHashes = new Set(verifiedClaim.allowedHashes);
	const claimOrgId = verifiedClaim.orgId;

	// Create SES client with the caller's scoped STS credentials
	const ses = new SESClient({
		region: process.env.AWS_REGION || 'us-east-1',
		credentials: {
			accessKeyId: body.credentials.accessKeyId,
			secretAccessKey: body.credentials.secretAccessKey,
			sessionToken: body.credentials.sessionToken
		}
	});

	// Strip control characters from header-interpolated values, including
	// fromEmail — without sanitization, the SendEmail fallback path (line 325)
	// would forward CR/LF to AWS. AWS rejects malformed addresses anyway, but
	// we want to fail fast at our boundary rather than rely on upstream
	// validation. The SendRawEmail path's `isHeaderSafe` check still applies
	// as a second layer.
	const safeFromName = (body.fromName || '').replace(/[\r\n\x00-\x1f\x7f]/g, '');
	const safeSubject = body.subject.replace(/[\r\n\x00-\x1f\x7f]/g, '');
	const safeFromEmail = body.fromEmail.replace(/[\r\n\x00-\x1f\x7f]/g, '');
	if (safeFromEmail !== body.fromEmail) {
		return {
			statusCode: 400,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				error: 'fromEmail contains control characters — refusing to send',
			}),
		};
	}

	const results: RecipientResult[] = [];
	// Build the From header with the display name optionally MIME-encoded
	// (RFC 2047) so emoji/accented characters survive strict-parsing email
	// clients. The address portion is always raw ASCII.
	const fromHeader = safeFromName
		? `${encodeMimeHeader(safeFromName)} <${safeFromEmail}>`
		: safeFromEmail;

	// Per-recipient List-Unsubscribe is enabled when `unsubscribeUrls` is
	// supplied with a 1:1 length match. Otherwise fall back to SendEmail
	// without the header — caller must thread URLs through, but the
	// Lambda still works with older callers that omit them.
	const useRaw =
		Array.isArray(body.unsubscribeUrls) &&
		body.unsubscribeUrls.length === body.recipients.length;

	for (let i = 0; i < body.recipients.length; i++) {
		const recipient = body.recipients[i];

		// Recipient sanitization at the boundary. The SendRawEmail path's
		// `isHeaderSafe(to)` already rejects CR/LF, but the SendEmail fallback
		// path forwards the recipient to AWS without our own validation.
		// Reject control characters here so both paths fail fast at our
		// boundary rather than relying on AWS rejection.
		if (typeof recipient !== 'string' || /[\r\n\x00-\x1f\x7f]/.test(recipient)) {
			results.push({
				email: typeof recipient === 'string' ? recipient.replace(/[\r\n\x00-\x1f\x7f]/g, '?') : '<invalid>',
				status: 'failed',
				error: 'Recipient contains control characters — refusing to send',
			});
			continue;
		}

		// Per-recipient cohort check. Recompute the hash server-side
		// from the recipient email + claim's orgId — using the caller-supplied
		// hash here would let a compromised editor swap recipients while
		// keeping a valid cohort hash and bypass the cohort gate entirely.
		// The same recomputed hash is also threaded into the receipt forward
		// below so Convex never sees a caller-supplied hash for THIS blast.
		const computedHash = recipientCohortHash(claimOrgId, recipient);
		if (!allowedHashes.has(computedHash)) {
			results.push({
				email: recipient,
				status: 'failed',
				error: 'Recipient not in dispatch claim cohort',
				computedHash
			});
			continue;
		}

		try {
			if (useRaw) {
				const unsubscribeUrl = body.unsubscribeUrls![i];
				const raw = buildRawMimeMessage(
					fromHeader,
					recipient,
					safeSubject,
					body.bodyHtml,
					unsubscribeUrl,
				);
				if (raw === null) {
					results.push({
						email: recipient,
						status: 'failed',
						error: 'Header injection rejected (CR/LF in header field)',
						computedHash
					});
					continue;
				}
				const cmd = new SendRawEmailCommand({
					RawMessage: { Data: Buffer.from(raw, 'utf-8') },
				});
				const res = await ses.send(cmd);
				results.push({
					email: recipient,
					status: 'sent',
					messageId: res.MessageId,
					computedHash
				});
			} else {
				const cmd = new SendEmailCommand({
					Source: fromHeader,
					Destination: { ToAddresses: [recipient] },
					Message: {
						Subject: { Data: safeSubject },
						Body: { Html: { Data: body.bodyHtml } }
					}
				});
				const res = await ses.send(cmd);
				results.push({
					email: recipient,
					status: 'sent',
					messageId: res.MessageId,
					computedHash
				});
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Unknown SES error';
			results.push({ email: recipient, status: 'failed', error: message, computedHash });
		}
	}

	// Deeper cure: forward per-recipient receipts to Convex if configured.
	// This is the durable receipt path independent of the browser — if the
	// browser disconnects mid-blast, Lambda still records the outcome.
	// Failures here are logged but do not change the response to the
	// browser (browser-side receipt write remains the optimistic path).
	const convexReceiptsUrl = process.env.CONVEX_RECEIPTS_URL;
	const receiptsSecret = process.env.BLAST_RECEIPTS_SECRET;
	if (convexReceiptsUrl && receiptsSecret && body.blastId) {
		const sentAt = Date.now();
		// Use the Lambda-recomputed `computedHash` from each result — NOT
		// `body.recipientHashes![i]`. The caller-supplied hashes are only
		// used as an authorization-cohort filter (via the dispatch claim);
		// after authorization, the receipt forward must commit the
		// server-trusted hash so a compromised editor can't corrupt
		// per-recipient delivery records by lying about which hash maps
		// to which email. Skip the recipient in the forward entirely if
		// computedHash is missing (hostile control-character recipient
		// rejected at line 322 — no real email was sent for that slot).
		const receipts = results
			.filter((r): r is RecipientResult & { computedHash: string } => Boolean(r.computedHash))
			.map((r) => ({
				recipientEmailHash: r.computedHash,
				sesMessageId: r.status === 'sent' ? r.messageId : undefined,
				status: r.status,
				sentAt,
				error: r.status === 'failed' ? r.error : undefined,
			}));
		try {
			// 15s timeout — Lambda has a 60s wall-clock cap on its own; a
			// hung Convex receipt-write would block the response to the
			// browser for the full 60s. SES has already accepted the email
			// at this point, so a missed receipt is recoverable via the
			// browser-side write path; better to free the Lambda quickly.
			const convexResp = await fetch(convexReceiptsUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${receiptsSecret}`,
				},
				body: JSON.stringify({ blastId: body.blastId, receipts }),
				signal: AbortSignal.timeout(15_000),
			});
			if (!convexResp.ok) {
				const text = await convexResp.text().catch(() => '');
				console.error(
					`[ses-proxy] Convex receipt forward failed: ${convexResp.status} ${text}`,
				);
			}
		} catch (err) {
			console.error('[ses-proxy] Convex receipt forward threw:', err);
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
