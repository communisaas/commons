// Simple ID generator for tests
let idCounter = 1000;
const snowflake = () => (++idCounter).toString();

export interface FactoryOptions<T> {
	overrides?: Partial<T>;
	count?: number;
}

/**
 * Base factory class for creating test data
 */
abstract class Factory<T> {
	abstract build(options?: FactoryOptions<T>): T;

	buildList(count: number, options?: FactoryOptions<T>): T[] {
		return Array.from({ length: count }, () => this.build(options));
	}

	/**
	 * Create factory with custom defaults
	 */
	withDefaults(defaults: Partial<T>): Factory<T> {
		const originalBuild = this.build.bind(this);
		this.build = (options?: FactoryOptions<T>) => ({
			...originalBuild(options),
			...defaults,
			...(options?.overrides || {})
		});
		return this;
	}
}

/**
 * User factory - Updated for consolidated schema
 */
export interface UserFactoryData {
	id: string;
	name: string;
	email: string;
	avatar?: string;
	createdAt: Date;
	updatedAt: Date;

	// Consolidated address fields
	street?: string;
	city?: string;
	state?: string;
	zip?: string;
	congressional_district?: string;
	phone?: string;
	address?: string; // Legacy field for backward compatibility

	// Verification status
	is_verified?: boolean;
	verification_method?: string;
	verified_at?: Date;

	// VOTER Protocol blockchain identity
	wallet_address?: string;
	district_hash?: string;
	trust_score?: number;
	reputation_tier?: string;

	// Profile fields
	role?: string;
	organization?: string;
	location?: string;
	connection?: string;
	profile_completed_at?: Date;
	profile_visibility?: string;
}

export class UserFactory extends Factory<UserFactoryData> {
	build(options?: FactoryOptions<UserFactoryData>): UserFactoryData {
		const id = snowflake().toString();
		const baseUser = {
			id,
			name: `Test User ${id.slice(-4)}`,
			email: `user${id.slice(-4)}@test.com`,
			avatar: undefined,
			createdAt: new Date(),
			updatedAt: new Date(),

			// Consolidated address fields
			street: '123 Main Street',
			city: 'San Francisco',
			state: 'CA',
			zip: '94102',
			congressional_district: 'CA-12',
			phone: '+1-555-123-4567',

			// Verification status
			is_verified: false,
			verification_method: undefined,
			verified_at: undefined,

			// VOTER Protocol blockchain identity
			wallet_address: undefined,
			district_hash: undefined,
			trust_score: 0,
			reputation_tier: 'novice',

			// Profile fields
			role: undefined,
			organization: undefined,
			location: undefined,
			connection: undefined,
			profile_completed_at: undefined,
			profile_visibility: 'private'
		};

		return {
			...baseUser,
			...(options?.overrides || {})
		};
	}
}

/**
 * Template factory - Updated for consolidated schema
 */
export interface TemplateFactoryData {
	id: string;
	slug: string;
	title: string;
	description: string;
	category: string;
	type: string;
	deliveryMethod: string;
	subject?: string;
	preview: string;
	message_body: string;
	delivery_config: unknown;
	cwc_config?: unknown;
	recipient_config: unknown;
	metrics: unknown;
	campaign_id?: string;
	status: string;
	is_public: boolean;

	// Perceptual encoding properties
	coordinationScale: number;
	isNew: boolean;

	// Usage tracking
	send_count: number;
	last_sent_at?: Date;

	// Geographic scope
	applicable_countries: string[];
	jurisdiction_level?: string;
	specific_locations: string[];

	// Consolidated verification fields
	verification_status: string;
	severity_level?: number;
	original_content?: object;
	correction_log?: object;
	corrected_subject?: string;
	corrected_body?: string;
	grammar_score?: number;
	clarity_score?: number;
	completeness_score?: number;
	quality_score?: number;
	agent_votes?: object;
	consensus_score?: number;
	reputation_delta?: number;
	reputation_applied: boolean;
	reviewed_at?: Date;

	createdAt: Date;
	updatedAt: Date;
	userId?: string;
}

export class TemplateFactory extends Factory<TemplateFactoryData> {
	build(options?: FactoryOptions<TemplateFactoryData>): TemplateFactoryData {
		const id = snowflake().toString();
		const slug = `test-template-${id.slice(-4)}`;
		const baseTemplate = {
			id,
			slug,
			title: `Test Template ${id.slice(-4)}`,
			description: 'A test template for integration testing',
			category: 'advocacy',
			type: 'congressional',
			deliveryMethod: 'cwc',
			subject: 'Important Legislative Issue',
			preview: 'I am writing to you about an important issue...',
			message_body:
				'Dear [representative.title],\n\nI am writing to you about [issue]. [Personal Connection]\n\nSincerely,\n[user.name]',
			delivery_config: { method: 'cwc', target: 'congress' },
			cwc_config: { house: true, senate: true },
			recipient_config: { auto_lookup: true },
			metrics: { opens: 0, clicks: 0, responses: 0 },
			campaign_id: undefined,
			status: 'draft',
			is_public: true,

			// Perceptual encoding properties
			coordinationScale: 0.0,
			isNew: true,

			// Usage tracking
			send_count: 0,
			last_sent_at: undefined,

			// Geographic scope
			applicable_countries: ['US'],
			jurisdiction_level: 'federal',
			specific_locations: [],

			// Consolidated verification fields
			verification_status: 'pending',
			severity_level: undefined,
			original_content: undefined,
			correction_log: undefined,
			corrected_subject: undefined,
			corrected_body: undefined,
			grammar_score: undefined,
			clarity_score: undefined,
			completeness_score: undefined,
			quality_score: undefined,
			agent_votes: undefined,
			consensus_score: undefined,
			reputation_delta: undefined,
			reputation_applied: false,
			reviewed_at: undefined,

			createdAt: new Date(),
			updatedAt: new Date(),
			userId: undefined
		};

		return {
			...baseTemplate,
			...(options?.overrides || {})
		};
	}
}

// Export factory instances for easy use
export const userFactory = new UserFactory();
export const templateFactory = new TemplateFactory();
