/**
 * Template Configuration Types
 *
 * Type definitions for template configuration, metrics, and delivery.
 */

// CORE CONFIG TYPES - Minimal atomic units
export interface RecipientConfig {
	emails: string[];
}

export interface DeliveryConfig {
	timing: 'immediate' | 'scheduled';
	followUp: boolean;
	cwcEnabled?: boolean; // Congressional delivery toggle
}

export interface CwcConfig {
	enabled: boolean;
	routing_code?: string;
	priority?: 'normal' | 'high' | 'urgent';
	tracking_enabled?: boolean;
	office_codes?: string[]; // Specific congressional offices
}

// COMPLETE METRICS TYPE SYSTEM - All JSON fields typed
export interface TemplateMetrics {
	sent: number;
	opened: number; // Deprecated - not trackable for direct email
	clicked: number; // For direct: recipient count; for congressional: not used
	responded: number; // For congressional: delivery confirmations; for direct: not used

	// Congressional-specific metrics
	districts_covered?: number;
	total_districts?: number;
	district_coverage_percent?: number;

	// AI/Analytics metrics from schema
	personalization_rate?: number;
	effectiveness_score?: number; // ML-derived
	cascade_depth?: number; // User activation chain length
	viral_coefficient?: number; // Sharing rate

	// Funnel tracking metrics
	onboarding_starts?: number; // Users who started onboarding
	onboarding_completes?: number; // Users who completed onboarding
	auth_completions?: number; // Users who completed authentication
	shares?: number; // Template shares
}

export interface TypedTemplate {
	id: string;
	slug?: string;
	title: string;
	description: string;
	domain: string;
	type: string;
	deliveryMethod: 'email' | 'certified';
	subject?: string;
	message_body: string;
	preview: string;
	is_public: boolean;

	delivery_config: DeliveryConfig;
	recipient_config: RecipientConfig;
	cwc_config?: CwcConfig;
	metrics: TemplateMetrics;

	campaign_id?: string;
	status: 'draft' | 'active' | 'archived';
	createdAt: Date;
	updatedAt: Date;
	userId?: string;
}

/**
 * Type Guards for Runtime Validation
 */
export function isValidRecipientConfig(obj: unknown): obj is RecipientConfig {
	if (!obj || typeof obj !== 'object' || obj === null) return false;

	const record = obj as Record<string, unknown>;
	return (
		'emails' in record &&
		Array.isArray(record.emails) &&
		record.emails.length > 0 &&
		record.emails.every((email: unknown) => typeof email === 'string')
	);
}

export function isValidDeliveryConfig(obj: unknown): obj is DeliveryConfig {
	if (!obj || typeof obj !== 'object' || obj === null) return false;

	const record = obj as Record<string, unknown>;
	return (
		'timing' in record &&
		typeof record.timing === 'string' &&
		['immediate', 'scheduled'].includes(record.timing) &&
		'followUp' in record &&
		typeof record.followUp === 'boolean'
	);
}

/**
 * Safe Type Extraction Functions - Replace the 'as any' pattern
 */
export function extractRecipientEmails(recipient_config: unknown): string[] {
	if (isValidRecipientConfig(recipient_config)) {
		return recipient_config.emails;
	}

	// Fallback: extract emails from decisionMakers array when top-level emails is absent
	if (recipient_config && typeof recipient_config === 'object' && recipient_config !== null) {
		const config = recipient_config as Record<string, unknown>;
		if (Array.isArray(config.decisionMakers)) {
			const emails = config.decisionMakers
				.map((dm: unknown) => {
					if (dm && typeof dm === 'object' && dm !== null && 'email' in dm) {
						return (dm as Record<string, unknown>).email;
					}
					return null;
				})
				.filter((e): e is string => typeof e === 'string' && e.length > 0 && e.includes('@'));
			if (emails.length > 0) return emails;
		}
	}

	return [];
}

export function extractDeliveryConfig(delivery_config: unknown): DeliveryConfig {
	if (isValidDeliveryConfig(delivery_config)) {
		return delivery_config;
	}
	return {
		timing: 'immediate',
		followUp: false
	};
}

export function extractTemplateMetrics(metrics: unknown): TemplateMetrics {
	if (isValidTemplateMetrics(metrics)) {
		return metrics;
	}
	// Default metrics if invalid/null
	return {
		sent: 0,
		opened: 0,
		clicked: 0,
		responded: 0
	};
}

function isValidTemplateMetrics(obj: unknown): obj is TemplateMetrics {
	return (
		obj !== null &&
		typeof obj === 'object' &&
		'sent' in obj &&
		typeof (obj as Record<string, unknown>).sent === 'number'
	);
}

