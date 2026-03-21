import { db } from '$lib/core/db';

/**
 * OAUTH-BASED API SECURITY - Use Our Existing Login System
 *
 * No API keys, no additional auth tokens - just OAuth sessions
 */

interface SessionValidation {
	valid: boolean;
	user_id?: string;
	user_email?: string;
	session_expires?: Date;
	error?: string;
}

/**
 * Validate OAuth session from cookie/header
 */
export async function validateOAuthSession(request: Request): Promise<SessionValidation> {
	try {
		// Extract session ID from cookie (SvelteKit auth pattern)
		const cookies = request.headers.get('cookie');
		if (!cookies) {
			return { valid: false, error: 'No session cookie' };
		}

		// Parse session ID from cookies (adjust based on your auth setup)
		const sessionMatch = cookies.match(/(?:^|;\s*)auth-session=([^;]+)/);
		if (!sessionMatch) {
			return { valid: false, error: 'No auth session found' };
		}

		const sessionId = sessionMatch[1];

		// Validate session in database
		const session = await db.session.findUnique({
			where: { id: sessionId },
			include: {
				user: {
					select: {
						id: true,
						email: true,
						name: true
					}
				}
			}
		});

		if (!session) {
			return { valid: false, error: 'Invalid session' };
		}

		if (session.expiresAt < new Date()) {
			return { valid: false, error: 'Session expired' };
		}

		return {
			valid: true,
			user_id: session.userId,
			user_email: session.user.email,
			session_expires: session.expiresAt
		};
	} catch {
		return { valid: false, error: 'Session validation failed' };
	}
}

/**
 * Check if user can access specific analytics endpoints
 */
export async function checkAnalyticsPermission(
	user_id: string,
	endpoint: string
): Promise<{ allowed: boolean; reason?: string }> {
	try {
		// Get user info
		const user = await db.user.findUnique({
			where: { id: user_id },
			include: {
				templates: {
					select: { id: true }
				},
				campaigns: {
					select: { id: true }
				}
			}
		});

		if (!user) {
			return { allowed: false, reason: 'User not found' };
		}

		// Permission logic based on user activity
		const hasTemplates = user.templates.length > 0;
		const hasCampaigns = user.campaigns.length > 0;
		const isActiveUser = hasTemplates || hasCampaigns;

		switch (endpoint) {
			case 'sheaf-fusion':
				// Only allow active users (either created templates or sent campaigns)
				return {
					allowed: isActiveUser,
					reason: isActiveUser ? undefined : 'Must be active user to access data fusion'
				};

			case 'test-clustering':
				// Allow all logged-in users
				return { allowed: true };

			case 'create-test-data': {
				// Check if user is developer/admin (has many templates)
				const isDeveloper = user.templates.length > 5;
				return {
					allowed: isDeveloper,
					reason: isDeveloper ? undefined : 'Admin access required'
				};
			}

			default:
				return { allowed: false, reason: 'Unknown endpoint' };
		}
	} catch {
		return { allowed: false, reason: 'Permission check failed' };
	}
}

/**
 * Rate limits by endpoint for authenticated users
 */
export const OAUTH_RATE_LIMITS: Record<string, number> = {
	'sheaf-fusion': 5, // Medium computation - 5/minute
	'test-clustering': 10, // Light computation - 10/minute
	'create-test-data': 1 // Admin only - 1/minute
};

/**
 * Log analytics usage for user
 */
export async function logAnalyticsUsage(
	_user_id: string,
	_endpoint: string,
	_success: boolean,
	_computation_time_ms?: number
): Promise<void> {
	try {
		// Could track usage stats in database
		// await db.analytics_usage.create({
		//   data: {
		//     user_id,
		//     endpoint,
		//     success,
		//     _computation_time_ms,
		//     timestamp: new Date()
		//   }
		// });
	} catch {
		/* Ignore analytics logging errors - function is currently a placeholder */
	}
}
