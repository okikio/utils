/** Core and Intelligence scenario contracts. Live resources stay outside history. @module */
import * as resource from '@okikio/capability/resource';
import * as failures from '@okikio/result/failure';
import * as workflow from '@okikio/workflow';
import type { StoreType } from '@okikio/storage/workflow/postgres';
import type { Sql } from 'postgres';
import * as schemaCore from '@okikio/schema';

export const IdentitySchema = schemaCore.object({
	scope: schemaCore.refine(
		schemaCore.string(),
		(value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
		'Expected a UUID.',
	),
	source: schemaCore.refine(
		schemaCore.string(),
		(value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
		'Expected a UUID.',
	),
	revision: schemaCore.refine(
		schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
		(value) => value > 0,
		'Expected a positive number.',
	),
	digest: schemaCore.refine(
		schemaCore.string(),
		(value) => new RegExp(/^[0-9a-f]{64}$/).test(value),
		'String does not match the required pattern.',
	),
});
export type IdentityType = schemaCore.Output<typeof IdentitySchema>;
export const BatchInputSchema = schemaCore.extend(IdentitySchema, {
	after: schemaCore.refine(
		schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
		(value) => value >= 0,
		'Expected a nonnegative number.',
	),
});
export const BatchResultSchema = schemaCore.object({
	status: schemaCore.oneOf(['current', 'superseded']),
	after: schemaCore.refine(
		schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
		(value) => value >= 0,
		'Expected a nonnegative number.',
	),
	count: schemaCore.refine(
		schemaCore.refine(
			schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
			(value) => value >= 0,
			'Value is below the minimum.',
		),
		(value) => value <= 1000,
		'Value exceeds the maximum.',
	),
	complete: schemaCore.boolean(),
});
export const SourceResultSchema = schemaCore.object({
	status: schemaCore.oneOf(['verified', 'rejected', 'superseded']),
	rows: schemaCore.refine(
		schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
		(value) => value >= 0,
		'Expected a nonnegative number.',
	),
	next: schemaCore.nullable(schemaCore.guard((value): value is workflow.ReferenceType =>
		((input) => {
			try {
				workflow.ReferenceSchema.parse(input);
				return true;
			} catch {
				return false;
			}
		})(value)
	)),
});
export const ExitResultSchema = schemaCore.object({ recorded: schemaCore.literal(true) });
export const ResearchInputSchema = schemaCore.object({
	scope: schemaCore.refine(
		schemaCore.string(),
		(value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
		'Expected a UUID.',
	),
	research: schemaCore.refine(
		schemaCore.string(),
		(value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
		'Expected a UUID.',
	),
	url: schemaCore.refine(
		schemaCore.refine(schemaCore.string(), (value) => URL.canParse(value), 'Expected an absolute URL.'),
		(value) => value.length <= 2048,
		'Value exceeds the maximum.',
	),
	grant: schemaCore.refine(
		schemaCore.string(),
		(value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
		'Expected a UUID.',
	),
	expiresAt: schemaCore.refine(
		schemaCore.string(),
		(value) => /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value)),
		'Expected an ISO UTC instant.',
	),
});
export const ManifestSchema = schemaCore.object({
	scope: schemaCore.refine(
		schemaCore.string(),
		(value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
		'Expected a UUID.',
	),
	research: schemaCore.refine(
		schemaCore.string(),
		(value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
		'Expected a UUID.',
	),
	digest: schemaCore.refine(
		schemaCore.string(),
		(value) => new RegExp(/^[0-9a-f]{64}$/).test(value),
		'String does not match the required pattern.',
	),
	version: schemaCore.refine(
		schemaCore.string(),
		(value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
		'Expected a UUID.',
	),
});
export const KnowledgeInputSchema = schemaCore.object({
	request: ResearchInputSchema,
	manifest: ManifestSchema,
});
export const KnowledgeResultSchema = schemaCore.object({
	commit: schemaCore.refine(
		schemaCore.string(),
		(value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
		'Expected a UUID.',
	),
});
export const ExpiryResultSchema = schemaCore.object({
	deleted: schemaCore.boolean(),
	nextEligibleAt: schemaCore.nullable(
		schemaCore.refine(
			schemaCore.string(),
			(value) => /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value)),
			'Expected an ISO UTC instant.',
		),
	),
});

export const CaptureUnavailable = failures.define({
	id: 'fixture.capture-unavailable',
	description: 'Capture transport or receiver is temporarily unavailable.',
	data: schemaCore.object({
		status: schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
	}),
});
export const CaptureRejected = failures.define({
	id: 'fixture.capture-rejected',
	description: 'Capture authorization, input or effect identity was rejected.',
	data: schemaCore.object({
		status: schemaCore.refine(schemaCore.number(), Number.isSafeInteger, 'Expected a safe integer.'),
	}),
});
export const Store = resource.define<Pick<StoreType, 'transaction' | 'getReceipt'>>()({
	id: 'fixture.store',
	description: 'Save application writes and receipts after checking current attempt permission.',
});
export const Database = resource.define<{ sql: Sql }>()({
	id: 'fixture.database',
	description: 'Borrow the application database for reads.',
});
export const Provider = resource.define<{
	capture(
		input: schemaCore.Output<typeof ResearchInputSchema>,
		signal: AbortSignal,
	): Promise<schemaCore.Output<typeof ManifestSchema>>;
	check(signal: AbortSignal): Promise<boolean>;
}>()({
	id: 'fixture.provider',
	description: 'Call a capture receiver that returns the same saved capture for a repeated research key.',
});
export const Gate = resource.define<{
	reach(name: string, details: Record<string, string | number>): Promise<void>;
}>()({
	id: 'fixture.gate',
	description: 'Pause at a named test boundary so the parent can kill the worker at that point.',
});

export async function digest(text: string): Promise<string> {
	const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}
