/**
 * Template Resolution Engine
 *
 * Resolves template placeholders (e.g. [Name], [Representative]) with user
 * context and congressional representative data, then builds mailto URLs.
 */

import type { Template, EmailFlowTemplate } from '$lib/types/template';
import type { HeaderTemplate } from '$lib/types/any-replacements';
import type { EmailServiceUser } from '$lib/types/user';
import { recipientEmailsFromConfig } from '$lib/types/template';
// The sender-fill placeholder decision lives under convex/lib so the CWC send
// path and these mailto lanes resolve from one table rather than two.
import {
	manualFillReplacements,
	resolvePlaceholders,
	type TemplateReplacements
} from '$convex/lib/messagePlaceholders';
// One vocabulary for the stored delivery method, so "is this congressional?"
// cannot be answered differently here than at the send or the schema boundary.
import {
	isCongressionalDelivery,
	isTemplateDeliveryMethod
} from '$convex/lib/templateDeliveryMethod';

export type { TemplateReplacements };

// Enhanced interface with better type safety
export interface ResolvedTemplate {
	subject: string;
	body: string;
	recipients: string[];
	isCongressional: boolean;
	routingEmail?: string;
}

// Type guard for template replacements
export function isValidReplacements(obj: unknown): obj is TemplateReplacements {
	if (typeof obj !== 'object' || obj === null) return false;
	return Object.values(obj).every((value) => typeof value === 'string' || value === null);
}

// Type guards for template validation
export function isValidTemplate(template: unknown): template is EmailFlowTemplate {
	if (typeof template !== 'object' || template === null) return false;
	const t = template as Record<string, unknown>;

	return (
		typeof t.id === 'string' &&
		typeof t.title === 'string' &&
		isTemplateDeliveryMethod(t.deliveryMethod) &&
		(typeof t.message_body === 'string' || typeof t.preview === 'string')
	);
}

export function isValidEmailServiceUser(user: unknown): user is EmailServiceUser {
	if (typeof user !== 'object' || user === null) return false;
	const u = user as Record<string, unknown>;

	return (
		typeof u.id === 'string' &&
		// Email may be null when PII is client-side decrypted (cypherpunk architecture)
		(typeof u.email === 'string' || u.email === null || u.email === undefined) &&
		(u.name === undefined || u.name === null || typeof u.name === 'string')
	);
}

// Type for _representative objects with stronger typing
import type { Representative } from '$lib/core/legislative/types';

/**
 * Derive chamber from a DecisionMaker title string.
 * Returns 'senate' if title contains Senator/Senate, 'house' otherwise.
 */
function deriveChamber(rep: Record<string, unknown>): string {
	if (typeof rep.chamber === 'string' && rep.chamber.trim() !== '') return rep.chamber;
	if (typeof rep.title === 'string') {
		const t = rep.title.toLowerCase();
		if (t.includes('senator') || t.includes('senate')) return 'senate';
	}
	return 'house';
}

// Type guard for a single representative (supports DecisionMaker shapes)
function isValidRepresentative(rep: unknown): rep is Representative {
	if (typeof rep !== 'object' || rep === null) return false;
	const r = rep as Record<string, unknown>;

	// Must have a name
	if (typeof r.name !== 'string' || r.name.trim() === '') return false;

	// Must have party (can be empty string for non-partisan DMs)
	if (typeof r.party !== 'string') return false;

	// Chamber can come from `chamber` field or be derived from `title`
	const hasChamber = typeof r.chamber === 'string' && r.chamber.trim() !== '';
	const hasTitle = typeof r.title === 'string' && r.title.trim() !== '';
	if (!hasChamber && !hasTitle) return false;

	// State can come from `state` or `jurisdiction` (DM shape)
	const hasState = typeof r.state === 'string';
	const hasJurisdiction = typeof r.jurisdiction === 'string';
	if (!hasState && !hasJurisdiction) return false;

	// District: required for legacy, optional for DM
	if (typeof r.district !== 'string' && typeof r.district !== 'undefined') return false;

	return true;
}

// Type guard for representatives array with enhanced validation
function isValidRepresentativesArray(reps: unknown): reps is Representative[] {
	if (!Array.isArray(reps)) return false;
	return reps.length > 0 && reps.every(isValidRepresentative);
}

/**
 * BLOCK VARIABLE RESOLUTION - The Core Engine
 *
 * This function represents the synthesis of:
 * - Reactive state management (Svelte 5 runes)
 * - Real-time context injection
 * - Congressional district resolution
 * - Template personalization at message-send time
 *
 * Unlike traditional MVC where the View is passive, here the View
 * is a living, breathing transformation of Model data that resolves
 * block variables with actual user context AT THE MOMENT OF INTERACTION.
 */
export function resolveTemplate(
	template: EmailFlowTemplate | HeaderTemplate,
	user: EmailServiceUser | null,
	options: { preserveVariables?: boolean; personalConnection?: string } = {}
): ResolvedTemplate {
	// Input validation
	if (!isValidTemplate(template)) {
		console.error('Template validation failed:', template);
		throw new Error('Invalid template provided to resolveTemplate');
	}

	if (user !== null && !isValidEmailServiceUser(user)) {
		console.error('User validation failed:', user);
		throw new Error('Invalid user provided to resolveTemplate');
	}

	// Debug user and template info
	console.debug('Template resolution started:', {
		templateId: template.id,
		templateTitle: template.title,
		deliveryMethod: template.deliveryMethod,
		userId: user?.id,
		userName: user?.name,
		userRepresentatives: user?.representatives?.length || 0,
		hasUserAddress: !!(user?.street && user?.city && user?.state && user?.zip)
	});
	// Get the base message content - prefer message_body over preview
	const baseMessage = template.message_body || template.preview || '';

	// Initialize resolution context
	const subjectHasPlaceholders =
		typeof template.title === 'string' && /\[.+?\]/.test(template.title);
	let resolvedSubject = template.title || '';
	let resolvedBody = baseMessage;

	if (user) {
		// User context resolution - real name, real _address, real representatives
		const userName = user.name || '';
		const userAddress = buildUserAddress(user);

		// Block variable resolution with actual data
		const replacements: TemplateReplacements = {};

		// Only add replacements if we have data OR if we're not preserving variables
		if (!options.preserveVariables || userName) {
			replacements['[Name]'] = userName; // allow empty string to preserve punctuation
			replacements['[Your Name]'] = userName;
		}

		// For address fields, only replace if we have complete data
		if (user.street && user.city && user.state && user.zip) {
			replacements['[Address]'] = userAddress;
			replacements['[Your Address]'] = userAddress;
		} else if (!options.preserveVariables) {
			// Only remove if not preserving for preview
			replacements['[Address]'] = null;
			replacements['[Your Address]'] = null;
		}

		// Individual address components
		if (user.city || !options.preserveVariables) {
			replacements['[City]'] = user.city || null;
		}
		if (user.state || !options.preserveVariables) {
			replacements['[State]'] = user.state || null;
		}
		if (user.zip || !options.preserveVariables) {
			replacements['[ZIP]'] = user.zip || null;
			replacements['[Zip Code]'] = user.zip || null;
		}

		// Congressional _representative resolution with type safety
		if (user.representatives && isValidRepresentativesArray(user.representatives)) {
			// Primary _representative (House member or first in list)
			// deriveChamber handles both legacy `chamber` field and DM `title` field
			const primaryRep =
				user.representatives.find((r) => deriveChamber(r as unknown as Record<string, unknown>) === 'house') || user.representatives[0];
			if (primaryRep) {
				replacements['[Representative Name]'] = primaryRep.name;
				replacements['[Rep Name]'] = primaryRep.name;
				replacements['[Representative]'] = `Rep. ${primaryRep.name}`;
			} else {
				replacements['[Representative Name]'] = null;
				replacements['[Rep Name]'] = null;
				replacements['[Representative]'] = null;
			}

			// Senate representatives
			const senators = user.representatives.filter((r) => deriveChamber(r as unknown as Record<string, unknown>) === 'senate');
			if (senators.length > 0) {
				replacements['[Senator Name]'] = senators[0].name;
				replacements['[Senator]'] = `Sen. ${senators[0].name}`;
			} else {
				replacements['[Senator Name]'] = null;
				replacements['[Senator]'] = null;
			}
			if (senators.length > 1) {
				replacements['[Senior Senator]'] = `Sen. ${senators[0].name}`;
				replacements['[Junior Senator]'] = `Sen. ${senators[1].name}`;
			} else {
				replacements['[Senior Senator]'] = null;
				replacements['[Junior Senator]'] = null;
			}
		} else {
			// No _representative data - use generic labels where appropriate
			replacements['[Representative Name]'] = 'Representative';
			replacements['[Rep Name]'] = 'Representative';
			replacements['[Representative]'] = 'Representative';
			replacements['[Senator Name]'] = 'Senator';
			replacements['[Senator]'] = 'Senator';
			replacements['[Senior Senator]'] = 'Senior Senator';
			replacements['[Junior Senator]'] = 'Junior Senator';
		}

		// Handle manual-fill placeholders based on preserveVariables option
		// In preview mode, keep them as placeholders for interactive buttons
		// In send mode, they carry the sender's words or they go
		if (options.preserveVariables) {
			// Keep placeholders for preview - don't add them to replacements
			// This way they won't be removed or replaced
		} else {
			Object.assign(replacements, manualFillReplacements(options.personalConnection));
		}

		// Apply all replacements to subject and body
		resolvedSubject = resolvePlaceholders(resolvedSubject, replacements);
		resolvedBody = resolvePlaceholders(resolvedBody, replacements);
	} else {
		// Non-authenticated user - preserve placeholders but make them instructional
		resolvedBody = resolvedBody
			.replace(/\[Name\]/g, '[Your Name]')
			.replace(/\[Address\]/g, '[Your Address]')
			.replace(/\[Representative Name\]/g, "[Your Representative's Name]");

		// The manual-fill family is NOT instructional copy — it is the author's slot
		// for the sender's own words. On the send path a guest gets the same handling
		// an authenticated sender gets, or a real official receives bracket text.
		if (!options.preserveVariables) {
			const manualFill = manualFillReplacements(options.personalConnection);
			resolvedSubject = resolvePlaceholders(resolvedSubject, manualFill);
			resolvedBody = resolvePlaceholders(resolvedBody, manualFill);
		}
	}

	// Determine delivery method and routing
	const isCongressional = isCongressionalDelivery(template.deliveryMethod);

	// Extract recipient emails from recipient_config (JSON object or string)
	const recipients = recipientEmailsFromConfig(template.recipient_config);

	let routingEmail: string | undefined;
	if (isCongressional) {
		// Congressional routing via CWC API, include anon when user is null
		const userPart = user?.id ?? 'anon';
		routingEmail = `congress+${template.id}-${userPart}@commons.email`;
	}

	return {
		subject: resolvedSubject,
		body: resolvedBody,
		recipients,
		isCongressional,
		routingEmail
	};
}

/**
 * Build complete user address string with type safety
 */
function buildUserAddress(user: EmailServiceUser): string {
	// Input validation
	if (!user || typeof user !== 'object') {
		return '';
	}

	// Only return address if ALL parts are present and valid
	if (
		typeof user.street === 'string' &&
		user.street.trim() !== '' &&
		typeof user.city === 'string' &&
		user.city.trim() !== '' &&
		typeof user.state === 'string' &&
		user.state.trim() !== '' &&
		typeof user.zip === 'string' &&
		user.zip.trim() !== ''
	) {
		return `${user.street.trim()}, ${user.city.trim()}, ${user.state.trim()} ${user.zip.trim()}`;
	}
	return ''; // Return empty if incomplete - will be removed from template
}

