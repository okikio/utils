/** The outbox's stable error type, shared by its modules. @module */
/** Stable contract violations; SQL connection/commit failures remain native and can have uncertain outcomes. */
export class OutboxError extends Error {
	/** Stable failure classification; do not parse the diagnostic message. */
	readonly code: 'conflict' | 'capacity' | 'policy' | 'stale';
	constructor(code: OutboxError['code']) {
		super(`Transactional outbox ${code}.`);
		this.name = 'OutboxError';
		this.code = code;
	}
}
