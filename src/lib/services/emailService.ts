/**
 * UNIFIED EMAIL SERVICE - Enhanced Consolidation
 *
 * Single source of truth for email flow management, template resolution,
 * and mailto generation. Eliminates redundant logic across 4+ components
 * while providing comprehensive error handling and flow analytics.
 *
 * Key Features:
 * - Unified email flow analysis (auth → address → email)
 * - Template-aware mailto URL generation
 * - Congressional routing for verified delivery
 * - Comprehensive error handling and validation
 * - Flow analytics and conversion tracking
 */

import type { EmailFlowTemplate } from '$lib/types/template';
import type { HeaderTemplate } from '$lib/types/any-replacements';
import type { EmailServiceUser } from '$lib/types/user';
import { resolveTemplate } from '$lib/utils/templateResolver';
// The stored template vocabulary. Distinct from `EmailFlowResult.deliveryMethod`
// below, which records how one send actually left the machine.
import { isCongressionalDelivery } from '$convex/lib/templateDeliveryMethod';
import { buildAttestation } from '$lib/core/identity/tier-display';
// Confirmation token generation is server-only (HMAC + JWT_SECRET).
// Handled via server endpoint, not client-side mailto generation.

// Re-export the unified User interface for backward compatibility
export type { EmailServiceUser as User } from '$lib/types/user';

/**
 * Email Flow Analysis Result
 *
 * Represents the outcome of analyzing a user's eligibility
 * to send an email using a specific template.
 */
export interface EmailFlowResult {
	/** Whether user authentication is required */
	requiresAuth: boolean;

	/** Whether address collection is required (for congressional routing) */
	requiresAddress?: boolean;

	/** Generated mailto URL if ready to send */
	mailtoUrl?: string;

	/**
	 * Sender-visible copy of the same message `mailtoUrl` carries, produced by
	 * the same assembly — never rebuilt by a surface.
	 */
	messageText?: string;

	/** Next required action in the flow */
	nextAction: 'auth' | 'address' | 'email';

	/**
	 * Whether this message is cryptographically verified via ZK proof.
	 * - true: Sent through CWC with on-chain proof verification
	 * - false: Sent via mailto: without proof (CI-003 labeling)
	 */
	verified?: boolean;

	/**
	 * Delivery method used for analytics tracking.
	 * - 'cwc': Congressional Web Contact (verified path)
	 * - 'mailto': Local email client (unverified path)
	 * - 'email_attested': Mailto with district attestation footer (Tier 2+ verified)
	 */
	deliveryMethod?: 'cwc' | 'mailto' | 'email_attested';

	/** Error details if flow analysis failed */
	error?: {
		code: string;
		message: string;
		details?: unknown;
	};

	/** Analytics metadata for flow tracking */
	analytics?: {
		flowId: string;
		step: string;
		timestamp: number;
		templatePath: string;
	};
}

/**
 * Email Launch Result
 *
 * Represents the outcome of attempting to launch an email client.
 */
export interface EmailLaunchResult {
	/** Whether the launch was successful */
	success: boolean;

	/** Error details if launch failed */
	error?: {
		code: string;
		message: string;
		details?: unknown;
	};

	/** Mailto URL that was launched */
	mailtoUrl?: string;

	/** Analytics metadata */
	analytics?: {
		launchId: string;
		timestamp: number;
		userAgent: string;
	};
}

/**
 * Analyze Email Flow Requirements
 *
 * Determines what steps are needed before a user can send an email
 * using the specified template. Handles authentication, address collection,
 * and template compatibility requirements.
 *
 * @param template - The email template to analyze
 * @param user - Current user context (null for guest users)
 * @returns EmailFlowResult indicating next required action
 *
 * @example
 * ```typescript
 * const flow = analyzeEmailFlow(template, user);
 * if (flow.nextAction === 'auth') {
 *   // Redirect to authentication
 * } else if (flow.nextAction === 'address') {
 *   // Collect user address
 * } else if (flow.nextAction === 'email') {
 *   // Launch email client with flow.mailtoUrl
 * }
 * ```
 */
export function analyzeEmailFlow(
	template: EmailFlowTemplate | HeaderTemplate,
	user: EmailServiceUser | null,
	options?: {
		trustTier?: number;
		personalConnection?: string;
		/** Forwarded verbatim — see `generateMailtoUrl`, which owns the semantics. */
		attestation?: { districtCode?: string | null };
	}
): EmailFlowResult {
	try {
		// Generate analytics metadata
		const analytics = {
			flowId: generateFlowId(),
			step: 'analyze',
			timestamp: Date.now(),
			templatePath: `${template.slug || template.id}`
		};

		// Validate template
		if (!template || !template.id) {
			return {
				requiresAuth: false,
				nextAction: 'email' as const,
				error: {
					code: 'INVALID_TEMPLATE',
					message: 'Template is missing or invalid',
					details: { templateId: template?.id }
				},
				analytics
			};
		}

		// Guests can access ALL templates — congressional goes through mailto relay
		const isCongressional = isCongressionalDelivery(template.deliveryMethod);
		if (!user) {
			// Guests proceed to mailto generation for all templates.
			// Congressional templates use congress@commons.email relay.
		}

		// Enforce address gating for authenticated users on congressional delivery.
		// CWC requires a complete street address in every constituent submission — tier
		// (district verification) is orthogonal: identity tier gates who can send, the
		// plaintext street is what the House/Senate mail systems demand. No bypass.
		// Guests bypass the gate — they use the mailto relay with no CWC XML stamp.
		const trustTier = options?.trustTier ?? 0;
		const hasCompleteAddress = user
			? Boolean(user.street && user.city && user.state && user.zip)
			: false;

		if (user && isCongressional && !hasCompleteAddress) {
			return {
				requiresAuth: false,
				requiresAddress: true,
				nextAction: 'address',
				analytics: { ...analytics, step: 'require_address' }
			};
		}

		// Ready to send email
		const mailtoResult = generateMailtoUrl(template, user, {
			trustTier,
			personalConnection: options?.personalConnection,
			attestation: options?.attestation
		});
		if (mailtoResult.error) {
			return {
				requiresAuth: false,
				nextAction: 'email',
				error: mailtoResult.error,
				analytics: { ...analytics, step: 'mailto_generation_failed' }
			};
		}

		// mailtoResult.url is guaranteed to exist when there's no error
		if (!mailtoResult.url) {
			return {
				requiresAuth: false,
				nextAction: 'email',
				error: {
					code: 'MAILTO_URL_MISSING',
					message: 'Mailto URL generation succeeded but URL is missing',
					details: { templateId: template.id }
				},
				analytics: { ...analytics, step: 'mailto_url_missing' }
			};
		}

		// Tier 2+ on congressional templates get attested delivery method
		const isDistrictVerified = trustTier >= 2;
		const deliveryMethod = (isCongressional && isDistrictVerified)
			? 'email_attested' as const
			: 'mailto' as const;

		return {
			requiresAuth: false,
			requiresAddress: false,
			mailtoUrl: mailtoResult.url,
			messageText: mailtoResult.messageText,
			nextAction: 'email',
			verified: isDistrictVerified,
			deliveryMethod,
			analytics: { ...analytics, step: 'ready_to_send' }
		};
	} catch (error) {
		return {
			requiresAuth: false,
			nextAction: 'email',
			error: {
				code: 'FLOW_ANALYSIS_ERROR',
				message: 'Unknown error analyzing email flow',
				details: { originalError: 'Unknown error' }
			}
		};
	}
}

/**
 * Mailto URL Generation Result
 */
interface MailtoUrlResult {
	url?: string;
	/** Sender-visible copy of the same message the URL carries. */
	messageText?: string;
	error?: {
		code: string;
		message: string;
		details?: unknown;
	};
}

/** Project the shared assembly result onto this function's legacy result shape. */
function toMailtoUrlResult(assembly: MailtoAssembly): MailtoUrlResult {
	return assembly.ok
		? { url: assembly.url, messageText: assembly.messageText }
		: { error: { code: assembly.code, message: assembly.message } };
}

/**
 * Encode one mailbox for the path portion of a mailto URI.
 *
 * The final `@` is the addr-spec separator and remains literal. Encoding the
 * local and domain components independently prevents mailbox data from
 * introducing URI headers while still handling quoted local parts that contain
 * their own `@` characters.
 */
export function encodeMailboxForMailto(mailbox: string): string {
	const separatorIndex = mailbox.lastIndexOf('@');
	if (separatorIndex === -1) return encodeURIComponent(mailbox);

	const localPart = mailbox.slice(0, separatorIndex);
	const domainPart = mailbox.slice(separatorIndex + 1);
	return `${encodeURIComponent(localPart)}@${encodeURIComponent(domainPart)}`;
}

/**
 * The practical ceiling on a `mailto:` handoff. One limit for every lane — a
 * per-lane copy is a per-lane behavior the moment one of them drifts.
 */
export const MAILTO_URL_MAX_LENGTH = 8000;

/**
 * Ordered content zones of an outgoing message.
 *
 * Order is the contract: body → rule → (metadata, attestation). Which lane fills
 * which zone is the caller's decision; how the zones become a message is this
 * module's.
 *
 * There is deliberately no zone for the sender's personal connection: that text
 * belongs at the author's placeholder inside the body, which the resolver owns.
 * A zone here would be a second, positionally-wrong carriage for the same input.
 */
export interface MailtoZones {
	body: string;
	/** Routing lines the inbound mail relay parses, e.g. `[Template: …]` / `[From: …]`. */
	metadata?: string;
	/** Verification text produced by the shared attestation builder — never composed here. */
	attestation?: string;
}

export interface MailtoAssemblyInput {
	recipients: string[];
	subject: string;
	zones: MailtoZones;
}

/**
 * A discriminated result, so an unhandled failure is a compile error at every
 * call site rather than a silent dead click.
 */
export type MailtoAssembly =
	| { ok: true; url: string; messageText: string }
	| {
			ok: false;
			code: 'NO_RECIPIENTS' | 'EMPTY_MESSAGE' | 'URL_TOO_LONG';
			message: string;
			messageText: string;
	  };

/**
 * Assemble one outgoing message.
 *
 * The URL the recipient receives and the text the sender is shown come from a
 * single construction here. Rebuilding either one anywhere else re-opens the
 * drift this function exists to close.
 */
export function assembleMailto(input: MailtoAssemblyInput): MailtoAssembly {
	const blocks: string[] = [];
	const body = input.zones.body.trim();
	if (body) blocks.push(body);

	const footerLines: string[] = [];
	for (const line of [input.zones.metadata, input.zones.attestation]) {
		const trimmed = line?.trim();
		if (trimmed) footerLines.push(trimmed);
	}
	if (footerLines.length > 0) {
		blocks.push('---');
		blocks.push(footerLines.join('\n'));
	}

	const bodyText = blocks.join('\n\n');
	const subject = input.subject.trim();

	// The sender-visible string, built once. Every failure below still carries it:
	// a blocked send must still be able to show what it would have sent.
	const messageText = subject ? `Subject: ${subject}\n\n${bodyText}` : bodyText;

	const recipients = input.recipients.filter((recipient) => recipient && recipient.trim());
	if (recipients.length === 0) {
		return {
			ok: false,
			code: 'NO_RECIPIENTS',
			message: 'No recipient address available for this message.',
			messageText
		};
	}

	if (bodyText === '' && subject === '') {
		return {
			ok: false,
			code: 'EMPTY_MESSAGE',
			message: 'This message has no subject and no body.',
			messageText
		};
	}

	// Each mailbox is encoded independently while the comma separator stays
	// literal, so stored address data can never inject `?bcc=`, `&body=`, or a
	// fragment into the URI's header section.
	const url = `mailto:${recipients.map(encodeMailboxForMailto).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;

	if (url.length > MAILTO_URL_MAX_LENGTH) {
		return {
			ok: false,
			code: 'URL_TOO_LONG',
			message:
				'This message is too long to hand off to an email app. Shorten it, or copy it and paste it into your mail client.',
			messageText
		};
	}

	return { ok: true, url, messageText };
}

/**
 * Generate Mailto URL for Template
 *
 * Creates a properly formatted mailto URL with resolved template content.
 * Handles both congressional routing and direct recipient delivery.
 *
 * @param template - The email template to generate URL for
 * @param user - User context for template personalization
 * @param options - Lane inputs: sender tier, the sender's own words, and whether
 *   this lane attests (see `options.attestation`)
 * @returns MailtoUrlResult with URL or error details
 *
 * @example
 * ```typescript
 * const result = generateMailtoUrl(template, user);
 * if (result.error) {
 *   console.error('Failed to generate mailto:', result.error.message);
 * } else {
 *   window.location.href = result.url;
 * }
 * ```
 */
export function generateMailtoUrl(
	template: EmailFlowTemplate | HeaderTemplate,
	user: EmailServiceUser | null,
	options?: {
		trustTier?: number;
		personalConnection?: string;
		/**
		 * Whether this lane attests, and with what canonical district.
		 *
		 * Passing this object is the CALLER stating that its surface showed the
		 * sender the proof footer; what the footer then says is the shared
		 * composer's decision, never the caller's. Omitting it keeps the direct
		 * lane silent, so a surface that renders no footer never emits a
		 * verification claim the sender was not shown.
		 *
		 * `districtCode` must be a canonical district code the caller already
		 * holds. `EmailServiceUser` declares none, and the ephemeral delivery
		 * address is a different value in a different format — a district is
		 * claimed only when it is passed, never synthesized here.
		 */
		attestation?: { districtCode?: string | null };
	}
): MailtoUrlResult {
	try {
		// Resolve template with user context. The sender's own words are handed to
		// the resolver, which is the only place that knows where the author put them.
		const resolved = resolveTemplate(template, user, {
			personalConnection: options?.personalConnection
		});

		// Validate resolved content
		if (!resolved.subject && !resolved.body) {
			return {
				error: {
					code: 'EMPTY_TEMPLATE',
					message: 'Template resolved to empty subject and body',
					details: { templateId: template.id }
				}
			};
		}

		const trustTier = options?.trustTier ?? 0;

		// Proof footer — what the recipient sees, composed ONCE for every lane. The
		// shared composer owns every tier phrase, so this line is byte-identical to
		// the one the sender read in the preview and to the class /v/[hash] shows.
		// `verification_method` is read off the field `EmailServiceUser` actually
		// declares: reading it un-cast makes a future rename a typecheck error
		// instead of a silent collapse to the generic label. The district code is
		// whatever the caller passed and nothing else — a lane holding no canonical
		// code claims none rather than inventing a second source.
		const attestation = buildAttestation({
			trustTier,
			method: user?.verification_method ?? null,
			districtCode: options?.attestation?.districtCode ?? null,
			credentialHash: user?.credentialHash ?? null
		});

		// Congressional routing takes precedence
		if (resolved.isCongressional && resolved.routingEmail) {
			return toMailtoUrlResult(
				assembleMailto({
					// congress@commons.email is the certified-delivery relay.
					recipients: ['congress@commons.email'],
					subject: resolved.subject || template.title || '',
					zones: {
						body: resolved.body,
						// Routing lines the inbound relay parses — each on its own line.
						metadata:
							`[Template: ${template.slug || template.id}]\n` +
							`[From: ${user?.email || 'Guest'}]`,
						attestation: attestation.block ?? undefined
					}
				})
			);
		}

		// Direct recipient delivery. The footer rides the same rule separator the
		// relay lane uses and carries the same composer block — but only for a lane
		// that opted in, because a surface showing the sender no footer must not put
		// a verification claim about them in front of a recipient.
		return toMailtoUrlResult(
			assembleMailto({
				recipients: resolved.recipients,
				subject: resolved.subject,
				zones: {
					body: resolved.body,
					attestation: options?.attestation ? (attestation.block ?? undefined) : undefined
				}
			})
		);
	} catch (error) {
		return {
			error: {
				code: 'MAILTO_GENERATION_ERROR',
				message: error instanceof Error ? error.message : 'Unknown error generating mailto URL',
				details: { originalError: error instanceof Error ? error.message : 'Unknown error' }
			}
		};
	}
}

// =============================================================================
// ADVANCED EMAIL FLOW FUNCTIONS
// =============================================================================

/**
 * Validate Email Flow Compatibility
 *
 * Performs comprehensive validation of template and user compatibility
 * before attempting email flow analysis.
 *
 * @param template - Template to validate
 * @param user - User context to validate
 * @returns Validation result with detailed error information
 */
export function validateEmailFlow(
	template: EmailFlowTemplate,
	user: EmailServiceUser | null
): { isValid: boolean; errors: Array<{ code: string; message: string; field?: string }> } {
	const errors: Array<{ code: string; message: string; field?: string }> = [];

	// Template validation
	const templateValidation = validateTemplate(template);
	if (!templateValidation.isValid) {
		templateValidation.errors.forEach((_error) => {
			errors.push({
				code: 'INVALID_TEMPLATE',
				message: _error,
				field: 'template'
			});
		});
	}

	// User validation for congressional templates
	if (isCongressionalDelivery(template.deliveryMethod) && user) {
		if (!user.street)
			errors.push({
				code: 'MISSING_STREET',
				message: 'Street address required for congressional delivery',
				field: 'user.street'
			});
		if (!user.city)
			errors.push({
				code: 'MISSING_CITY',
				message: 'City required for congressional delivery',
				field: 'user.city'
			});
		if (!user.state)
			errors.push({
				code: 'MISSING_STATE',
				message: 'State required for congressional delivery',
				field: 'user.state'
			});
		if (!user.zip)
			errors.push({
				code: 'MISSING_ZIP',
				message: 'ZIP code required for congressional delivery',
				field: 'user.zip'
			});
	}

	return {
		isValid: errors.length === 0,
		errors
	};
}

/**
 * Get Email Flow Analytics
 *
 * Provides detailed analytics about the current email flow state.
 * Useful for debugging and conversion optimization.
 */
export function getEmailFlowAnalytics(
	template: EmailFlowTemplate,
	user: EmailServiceUser | null
): {
	flowStage: string;
	blockers: string[];
	metadata: Record<string, unknown>;
} {
	const blockers: string[] = [];
	let flowStage = 'unknown';

	if (!user) {
		flowStage = 'guest_send';
		// Guests are valid mailto senders — no blocker
	} else if (
		isCongressionalDelivery(template.deliveryMethod) &&
		!(user.street && user.city && user.state && user.zip)
	) {
		flowStage = 'address_collection_required';
		blockers.push('incomplete_address');
	} else {
		flowStage = 'ready_to_send';
	}

	const validation = validateEmailFlow(template, user);
	if (!validation.isValid) {
		blockers.push(...validation.errors.map((e) => e.code));
	}

	return {
		flowStage,
		blockers,
		metadata: {
			templateId: template.id,
			deliveryMethod: template.deliveryMethod,
			userHasAddress: user ? Boolean(user.street && user.city && user.state && user.zip) : false,
			userIsAuthenticated: Boolean(user),
			timestamp: Date.now()
		}
	};
}

/**
 * Launch Email Client
 *
 * Reliably opens the user's default email client with the provided mailto URL.
 * Includes error handling, analytics tracking, and optional page redirection.
 *
 * @param mailtoUrl - The mailto URL to launch
 * @param options - Launch configuration options
 * @returns EmailLaunchResult indicating success or failure
 *
 * @example
 * ```typescript
 * const result = launchEmail(mailtoUrl, {
 *   redirectUrl: '/success',
 *   redirectDelay: 1000
 * });
 *
 * if (!result.success) {
 *   console.error('Email launch failed:', result.error?.message);
 * }
 * ```
 */
export function launchEmail(
	mailtoUrl: string,
	options?: {
		redirectUrl?: string;
		redirectDelay?: number;
		analytics?: boolean;
	}
): EmailLaunchResult {
	try {
		// Validate inputs
		if (!mailtoUrl || !mailtoUrl.startsWith('mailto:')) {
			return {
				success: false,
				error: {
					code: 'INVALID_MAILTO_URL',
					message: 'Invalid or missing mailto URL',
					details: { providedUrl: mailtoUrl }
				}
			};
		}

		// Generate analytics metadata if enabled
		const analytics =
			options?.analytics !== false
				? {
						launchId: generateLaunchId(),
						timestamp: Date.now(),
						userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
					}
				: undefined;

		// Create temporary anchor element for reliable email client launch
		// This method works consistently across all browsers and platforms
		const mailLink = document.createElement('a');
		mailLink.href = mailtoUrl;
		mailLink.style.display = 'none';

		// Add to DOM temporarily (required for some browsers)
		document.body.appendChild(mailLink);
		mailLink.click();

		// Clean up
		setTimeout(() => {
			try {
				document.body.removeChild(mailLink);
			} catch (error) {
				// Ignore cleanup errors
			}
		}, 100);

		// Handle optional page redirection
		if (options?.redirectUrl) {
			const delay = options.redirectDelay ?? 500;
			const redirectTarget = options.redirectUrl;
			setTimeout(() => {
				try {
					window.location.href = redirectTarget;
				} catch (error) {
					console.warn('Failed to redirect after email launch:', error);
				}
			}, delay);
		}

		// VOTER Protocol certification now handled by mail server after email is sent
		// This ensures certification only happens for actually delivered messages

		return {
			success: true,
			mailtoUrl,
			analytics
		};
	} catch (error) {
		return {
			success: false,
			error: {
				code: 'EMAIL_LAUNCH_ERROR',
				message: error instanceof Error ? error.message : 'Unknown error',
				details: { originalError: error }
			}
		};
	}
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate unique flow ID for analytics tracking
 */
function generateFlowId(): string {
	return `flow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate unique launch ID for analytics tracking
 */
function generateLaunchId(): string {
	return `launch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Validate email address format
 */
function _isValidEmail(email: string): boolean {
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	return emailRegex.test(email);
}

/**
 * Validate template has required fields
 */
function validateTemplate(template: EmailFlowTemplate): { isValid: boolean; errors: string[] } {
	const errors: string[] = [];

	if (!template.id) {
		errors.push('Template missing required id field');
	}

	if (!template.title && !template.subject) {
		errors.push('Template missing both title and subject');
	}

	if (!template.preview && !template.message_body) {
		errors.push('Template missing both preview and message_body');
	}

	return {
		isValid: errors.length === 0,
		errors
	};
}
