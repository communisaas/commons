/** Conservative maximum lifecycle concentration for a send reserved today. */
export const PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS = 9;
/** Remaining retry/DLQ concentration which can cross the first UTC boundary. */
export const PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS = 8;
/** A 24-hour DLQ's final pull/delete concentration across the second boundary. */
export const PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS = 2;
/** Deterministic admission projection per realm; not an actual Queue-operation guarantee. */
export const PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX = 2_500;
/** Empty-ledger cardinality ceiling implied by the current-day operation charge. */
export const PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX = Math.floor(
	PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX /
		PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS
);
