/** Immutable message definitions and an explicit validator used by service runtime contracts. @module */
import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as response from '@okikio/http/response';

/**
 * Run the supplied validator through the public Standard Schema boundary.
 * Converting thrown validation failures into issues lets runtime tests exercise
 * the same admission path as an application schema, without testing a schema library.
 */
export function schema<Output>(
	validate: (value: unknown) => Output,
): StandardSchemaV1<unknown, Output> {
	return Object.freeze({
		'~standard': Object.freeze({
			version: 1,
			vendor: 'test',
			/** Preserve valid values and expose ordinary validation failures as issues. */
			validate(value: unknown) {
				try {
					return { value: validate(value) };
				} catch (error) {
					return { issues: [{ message: error instanceof Error ? error.message : String(error) }] };
				}
			},
		}),
	});
}

/** A small body contract; missing fields must fail rather than becoming a type cast. */
export const MessageSchema = schema<{ readonly message: string }>((value) => {
	if (typeof value !== 'object' || value === null || typeof (value as { message?: unknown }).message !== 'string') {
		throw new TypeError('Expected a message object.');
	}
	return Object.freeze({ message: (value as { message: string }).message });
});

/** Shared immutable response identity. Each scenario still creates and disposes its own runtime. */
export const Message = response.ok(MessageSchema, {
	id: 'runtime:message',
	description: 'Runtime test response.',
});
