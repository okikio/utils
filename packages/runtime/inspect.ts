/** Read host identity and available API shapes without loading adapters or acquiring resources. @module */
import type { Host } from './mod.ts';

/** A snapshot of evidence, not permission to perform a later operation. */
export interface InspectionType {
	/** Detected host identity. An unfamiliar embedding remains unknown. */
	readonly host: Host | 'unknown';
	/** Package adapter coverage. A true entry does not mean the operation is permitted or configured. */
	readonly adapters: Readonly<{ file: boolean; process: boolean; worker: boolean; portReservation: boolean }>;
	/** Web API constructors visible now. Node Worker support belongs to the explicit adapter. */
	readonly features: Readonly<{ worker: boolean; streams: boolean; crypto: boolean }>;
	/** This portable inspection does not query host permission state. Use the Deno inspector when needed. */
	readonly permissions: 'unqueried';
}

/**
 * Inspect only API and runtime identity evidence. No file access, permission query/request, child,
 * Worker or listener is created. Host globals can be replaced by an embedding; this is diagnostic
 * data rather than a security boundary. Permissions and operation success can change after inspection.
 */
export function inspect(): InspectionType {
	const globals = globalThis as typeof globalThis & {
		Deno?: { version?: { deno?: unknown } };
		Bun?: { version?: unknown };
		process?: { versions?: { node?: unknown } };
	};
	const host: InspectionType['host'] = typeof globals.Deno?.version?.deno === 'string'
		? 'deno'
		: typeof globals.Bun?.version === 'string'
		? 'bun'
		: typeof globals.process?.versions?.node === 'string'
		? 'node'
		: typeof navigator !== 'undefined'
		? 'browser'
		: 'unknown';
	return Object.freeze({
		host,
		adapters: Object.freeze({
			file: host === 'deno',
			process: host === 'deno' || host === 'node',
			worker: host !== 'unknown',
			portReservation: host === 'deno',
		}),
		features: Object.freeze({
			worker: typeof Worker === 'function',
			streams: typeof ReadableStream === 'function' && typeof WritableStream === 'function',
			crypto: typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function',
		}),
		permissions: 'unqueried',
	});
}
