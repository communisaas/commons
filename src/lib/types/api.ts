/**
 * API TYPES - Eliminate 'any' pollution in API handlers
 */

// Analytics Event Types
export interface AnalyticsEventCreate {
	name: string;
	event_type: 'pageview' | 'interaction' | 'conversion' | 'funnel' | 'campaign';
	template_id?: string;
	user_id?: string;
	session_id: string;
	funnel_step?: number;
	experiment_id?: string;
	properties?: Record<string, unknown>;
	timestamp?: string;
}

export interface EnrichedAnalyticsEvent extends AnalyticsEventCreate {
	id: string;
	computed_metrics: Record<string, unknown>;
	created_at: Date;
}

// Template Update Data
export interface TemplateUpdateData {
	title?: string;
	description?: string;
	message_body?: string;
	category?: string;
	recipient_config?: unknown;
	delivery_config?: unknown;
}

// Address Update Request
export interface AddressUpdateRequest {
	address: string;
}

// Address Update Response
export interface AddressUpdateResponse {
	success: boolean;
	user: {
		street: string;
		city: string;
		state: string;
		zip: string;
	};
}

// Profile Update Request
export interface ProfileUpdateRequest {
	role: string;
	connection: string;
}

// API Response Base
export interface ApiResponse<T = Record<string, unknown>> {
	success: boolean;
	data?: T;
	error?: string;
	timestamp: string;
}
