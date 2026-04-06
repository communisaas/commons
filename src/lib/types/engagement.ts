/**
 * Engagement data types — coordination metrics by district.
 *
 * Used by the inline coordination weight display on the template page
 * and by engagement aggregation queries.
 */

export interface DistrictEngagement {
	district_code: string;
	support: number;
	oppose: number;
	total: number;
	support_percent: number;
	is_user_district: boolean;
}

export interface EngagementAggregate {
	total_districts: number;
	total_positions: number;
	total_support: number;
	total_oppose: number;
}

export interface EngagementData {
	template_id: string;
	districts: DistrictEngagement[];
	aggregate: EngagementAggregate;
}
