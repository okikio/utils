/** Build declared work requests without starting code during generator construction. @module */

import * as codec from '@okikio/schema/codec';
import * as effects from '@okikio/capability/effect';
import * as schema from '@okikio/schema';
import { identity, IdentitySchema } from './execution.ts';
import type { DefinitionType, InputType, ValueType } from './execution.ts';
import { activity, child, effect } from './instructions.ts';
import type { WorkflowCommandOptions, WorkflowDefinition, WorkflowOperation } from './types.ts';

/** Await a result by default. Background work has an independent lifetime after acceptance. */
export interface TriggerOptions extends WorkflowCommandOptions {
	readonly background?: boolean;
}

/** Same request shape for activities and child workflows, with an explicit background return type. */
export interface Trigger<Allowed extends DefinitionType = DefinitionType> {
	<D extends Allowed>(
		definition: D,
		input: InputType<D>,
		options: TriggerOptions & { readonly background: true },
	): WorkflowOperation<void>;
	<D extends Allowed>(
		definition: D,
		input: InputType<D>,
		options?: TriggerOptions & { readonly background?: false },
	): WorkflowOperation<ValueType<D>>;
}

/** Serializable work accepted by an effect owner. The declaration remains in trusted application code. */
export const TriggerSchema: schema.Reader<
	{ definition: { kind: 'activity' | 'workflow'; id: string; version: string }; input: unknown },
	unknown
> = schema.define((input) => {
	if (!input || typeof input !== 'object' || !('definition' in input) || !('input' in input)) {
		schema.reject('A background trigger requires a definition and input.');
	}
	return { definition: IdentitySchema.parse(input.definition), input: input.input };
});

/** Acceptance is awaited; the requested work's result is not. Explicit owners decide local or durable delivery. */
export const TriggerEffect: effects.EffectDefinition<
	'workflow.trigger',
	codec.Codec<
		schema.Input<typeof TriggerSchema>,
		schema.Output<typeof TriggerSchema>,
		schema.Output<typeof TriggerSchema>,
		schema.Output<typeof TriggerSchema>
	>
> = effects.define({
	id: 'workflow.trigger',
	description: 'Accept background work with an independent completion obligation.',
	value: codec.identity(TriggerSchema),
});

/** Bind requests to the current workflow's declared activities and children. */
export function createTrigger<Owner extends WorkflowDefinition>(
	owner: Owner,
): Trigger<Owner['activities'][number] | Owner['workflows'][number]> {
	return ((definition: DefinitionType, input: unknown, options: TriggerOptions = {}) => {
		const declared = definition.kind === 'activity' ? owner.activities : owner.workflows;
		if (!(declared as readonly DefinitionType[]).includes(definition)) {
			schema.reject(`Workflow ${owner.id} did not declare ${definition.id}.`);
		}
		const { background, ...metadata } = options;
		if (background) return effect(TriggerEffect, { definition: identity(definition), input }, metadata);
		return definition.kind === 'activity' ? activity(definition, input, metadata) : child(definition, input, metadata);
	}) as Trigger<Owner['activities'][number] | Owner['workflows'][number]>;
}
