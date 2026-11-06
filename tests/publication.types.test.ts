/** Public declarations must retain concrete fields, literals, defaults and callable shapes after JSR extraction. @module */
import * as schema from '@okikio/schema';
import * as codec from '@okikio/schema/codec';
import { DateSchema, InstantSchema } from '@okikio/schema/time';
import * as status from '@okikio/http/response/status';
import { SnapshotSchema } from '@okikio/context/state';
import { PolicySchema, ReferenceSchema } from '@okikio/capability/resource/session';
import { IdentitySchema, OutcomeSchema } from '@okikio/workflow/execution';
import { noop } from '@okikio/telemetry';

/** These consumer expressions are checked, never executed: no database, timer or listener is opened. */
function publicationTypes(): void {
	// Optional authoring defaults become required output values after validation.
	const input: schema.Input<typeof PolicySchema> = { leaseMs: 30, idleMs: 30, borrowMs: 30 };
	const borrows: number = PolicySchema.parse(input).maximumBorrows;
	// @ts-expect-error A defaulted output is required even when its input is optional.
	const missing: schema.Output<typeof PolicySchema> = input;

	// ObjectReader metadata must survive annotation so callers can select fields.
	const SelectedSchema = schema.pick(ReferenceSchema, ['owner']);
	const generation: number = SelectedSchema.parse(null).owner.generation;
	// @ts-expect-error Selecting owner must not retain an unrelated reference ID.
	const removed = SelectedSchema.parse(null).id;
	const format: 1 = SnapshotSchema.parse(null).format;
	// @ts-expect-error The envelope revision is the literal 1, not any number.
	const wrongRevision: schema.Output<typeof SnapshotSchema>['format'] = 2;

	// Status families stay closed unions rather than widening to number.
	const success: schema.Output<typeof status.success> = 201;
	const contentless: schema.Output<typeof status.contentless> = 204;
	// @ts-expect-error A client error is not a successful status.
	const wrongSuccess: schema.Output<typeof status.success> = 404;
	// @ts-expect-error An ordinary body response is not contentless.
	const wrongBody: schema.Output<typeof status.contentless> = 200;

	// Codecs retain both directions, including their application-specific values.
	const date: Promise<Date> = codec.read(DateSchema, '2024-02-29T12:00:00.000Z');
	const text: codec.DecodeInput<typeof InstantSchema> = '2024-02-29T12:00:00.000000000Z';
	// @ts-expect-error Timestamp wire input is text, not epoch milliseconds.
	const wrongWire: codec.DecodeInput<typeof InstantSchema> = 0;

	// Saved workflow discriminants still narrow the payload visible to a caller.
	const kind: 'activity' | 'workflow' = IdentitySchema.parse(null).kind;
	const outcome = OutcomeSchema.parse(null);
	if (outcome.type === 'failure') {
		const id: string = outcome.id;
		void id;
	}
	// @ts-expect-error A workflow kind is a closed union.
	const wrongKind: schema.Output<typeof IdentitySchema>['kind'] = 'thread';

	// A generic Reporter annotation would incorrectly require an event argument here.
	const ignored: void = noop.report();
	void [
		borrows,
		missing,
		generation,
		removed,
		format,
		wrongRevision,
		success,
		contentless,
		wrongSuccess,
		wrongBody,
		date,
		text,
		wrongWire,
		kind,
		wrongKind,
		ignored,
	];
}

void publicationTypes;
