/**
 * Scorecard Recompute Cron Endpoint
 *
 * SCHEDULE: Daily at 03:00 UTC via GitHub Actions
 *
 * Delegates to the scorecard-compute endpoint logic.
 * This endpoint exists as an alias for backwards compatibility.
 *
 * AUTHENTICATION:
 * - Requires CRON_SECRET environment variable (fail-closed)
 * - Pass as Bearer token: Authorization: Bearer <CRON_SECRET>
 */

export { GET } from '../scorecard-compute/+server';
