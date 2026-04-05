/**
 * Perceptual Decision-Maker Presentation
 *
 * Maps computational substrate (recipient_config) to perceptual representation
 * Optimized for peripheral scanning + recognition over categorization
 *
 * Principle: Show power topology directly, don't force categorization
 */

import type { Template, DisplayRecipientConfig, TargetPresentation } from '$lib/types/template';

interface UserContext {
	district?: string;
	location?: string;
	city?: string;
	state?: string;
}

/**
 * Derives perceptual representation from template recipient config
 *
 * Eye-tracking optimized:
 * - Congressional: ~200ms recognition ("Your 3 representatives")
 * - Named decision-makers: ~150ms recognition ("Mayor Breed")
 * - Multi-level: ~300ms (vertical stack, maintains semantic colors)
 * - Generic: ~250ms (shows count + location)
 *
 * @param template - Template with recipient_config
 * @param userContext - User's geographic context for personalization
 * @returns Visual presentation optimized for scanning
 */
export function deriveTargetPresentation(
	template: Template,
	userContext?: UserContext
): TargetPresentation {
	const config = parseRecipientConfig(template.recipient_config);

	const hasCongressional = template.deliveryMethod === 'cwc' || config?.cwcRouting;
	const hasLocalDecisionMakers = config?.decisionMakers && config.decisionMakers.length > 0;

	// Multi-Level Coordination: Both congressional AND local decision-makers
	// Peripheral detection: 2+ rows = broader coordination scope
	// Each level maintains its semantic color (federal=blue, local=green)
	if (hasCongressional && hasLocalDecisionMakers) {
		const targets = [];

		// Federal level
		targets.push({
			primary: 'Your 3 representatives',
			secondary: null,
			icon: 'Capitol' as const,
			emphasis: 'federal' as const
		});

		// Local level — show roles, not names
		const dms = config.decisionMakers || [];
		const primaryRole = dms[0]?.role || dms[0]?.shortName || dms[0]?.name || 'Decision-maker';
		const remaining = dms.length - 1;

		targets.push({
			primary: primaryRole,
			secondary: remaining > 0 ? `+${remaining} more` : null,
			icon: 'Building' as const,
			emphasis: 'local' as const
		});

		return {
			type: 'multi-level',
			targets,
			coordinationContext: config.location?.city || userContext?.district || userContext?.state
		};
	}

	// Single-Level Congressional: Personal + Systemic
	// "Your 3 representatives" conveys:
	//   - Personal relevance ("Your")
	//   - Systemic routing (count is automatic)
	//   - No need to specify names (district-based)
	if (hasCongressional) {
		return {
			type: 'district-based',
			primary: 'Your 3 representatives',
			secondary: null,
			icon: 'Capitol',
			coordinationContext: userContext?.district || userContext?.state,
			emphasis: 'federal'
		};
	}

	// Single-Level Local: Role-forward
	// "Mayor" communicates power topology; names are secondary
	if (hasLocalDecisionMakers) {
		const dms = config.decisionMakers || [];
		const primaryRole = dms[0]?.role || dms[0]?.shortName || dms[0]?.name || 'Decision-maker';
		const remaining = dms.length - 1;

		return {
			type: 'location-specific',
			primary: primaryRole,
			secondary: remaining > 0 ? `+${remaining} more` : null,
			icon: 'Building',
			coordinationContext: config.location?.city || config.location?.jurisdiction,
			emphasis: 'local'
		};
	}

	// Fallback: Show reach without categorization
	// Better to be vague than to force incorrect category
	const emailCount = config?.emails?.length || 0;

	// Try to extract location from config or template
	const locationContext =
		config?.location?.city ||
		config?.location?.jurisdiction ||
		template.specific_locations?.[0] ||
		userContext?.city;

	if (emailCount > 0) {
		return {
			type: 'location-specific',
			primary: emailCount === 1 ? '1 decision-maker' : `${emailCount} decision-makers`,
			secondary: null,
			icon: 'Users',
			coordinationContext: locationContext,
			emphasis: 'neutral'
		};
	}

	// Absolute fallback: No specific target info
	return {
		type: 'universal',
		primary: 'Direct delivery',
		secondary: null,
		icon: 'Mail',
		coordinationContext: locationContext,
		emphasis: 'neutral'
	};
}

/**
 * Parse recipient_config from unknown JSON into the display-layer shape.
 */
export function parseRecipientConfig(recipientConfig: unknown): DisplayRecipientConfig | null {
	if (!recipientConfig || typeof recipientConfig !== 'object') {
		return null;
	}

	const config = recipientConfig as Record<string, unknown>;

	// Handle new perceptual format
	if ('reach' in config || 'decisionMakers' in config) {
		return config as unknown as DisplayRecipientConfig;
	}

	// Handle legacy format - try to extract what we can
	const emails = Array.isArray(config.emails) ? (config.emails as string[]) : undefined;
	const cwcRouting = typeof config.cwcRouting === 'boolean' ? config.cwcRouting : false;

	// Check for target_type (old format)
	const targetType = typeof config.target_type === 'string' ? config.target_type : undefined;

	// Infer reach from legacy data
	let reach: 'district-based' | 'location-specific' | 'universal' = 'universal';
	if (cwcRouting || targetType === 'congressional') {
		reach = 'district-based';
	} else if (emails && emails.length > 0) {
		reach = 'location-specific';
	}

	return {
		reach,
		emails,
		cwcRouting
	};
}

/**
 * Extract coordination context for display
 * Shows location where coordination is happening
 *
 * @param template - Template with metrics
 * @param targetInfo - Derived target presentation
 * @returns Formatted coordination string
 */
export function formatCoordinationContext(
	template: Template,
	targetInfo: TargetPresentation
): string {
	const count = template.send_count || 0;

	if (count === 0) {
		// Multi-level uses coordinationContext from the union type
		const context = targetInfo.coordinationContext;
		return context ? `in ${context}` : 'Be the first';
	}

	const baseText = `${count.toLocaleString()} sent`;

	// Multi-level uses coordinationContext from the union type
	const context = targetInfo.coordinationContext;
	if (context) {
		return `${baseText} in ${context}`;
	}

	return baseText;
}
