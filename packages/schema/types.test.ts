import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';
import * as schema from './mod.ts';

/** A validator whose accepted input and parsed output intentionally differ. */
declare const PortSchema: StandardSchemaV1<string, number>;
/** JSON conversion can advertise distinct types without exposing any validator. */
declare const PortDocument: StandardJSONSchemaV1<string, number>;

/** Compile-time consumer examples prove Standard Schema output inference remains exact. */
function schemaTypes(): void {
	const parsed: Promise<number> = schema.parse(PortSchema, '8787');
	const validated: Promise<schema.ValidationResult<number>> = schema.validate(PortSchema, '8787');
	void parsed;
	void validated;

	// parse() and validate() must expose the validator output, not its input type.
	// @ts-expect-error The parsed output is number, not string.
	const wrong: Promise<string> = schema.parse(PortSchema, '8787');
	void wrong;

	// @ts-expect-error validate() must retain number in its successful result.
	const wrongValidation: Promise<schema.ValidationResult<string>> = schema.validate(PortSchema, '8787');
	void wrongValidation;
}

void schemaTypes;

/** Native readers retain direct protocol assignability while opaque readers keep validation only. */
function projectionTypes(): void {
	const native: StandardJSONSchemaV1<string, string> = schema.string();
	const typedInput: schema.Input<typeof PortDocument> = '8787';
	const typedOutput: schema.Output<typeof PortDocument> = 8787;
	const document = schema.jsonSchema(PortDocument);
	void native;
	void typedInput;
	void typedOutput;
	void document;
	// @ts-expect-error JSON conversion does not confer Standard Schema validation.
	void schema.parse(PortDocument, '8787');
	// @ts-expect-error An arbitrary synchronous callback has no JSON converter.
	const unsupported: StandardJSONSchemaV1 = schema.define((value) => value);
	void unsupported;
}
void projectionTypes;

/** Owned authoring preserves exact output and deliberate asynchronous contracts. */
function ownedTypes(): void {
	const ObjectSchema = schema.object({ id: schema.string(), count: schema.optional(schema.number()) });
	const input: schema.Input<typeof ObjectSchema> = { id: 'a' };
	const output: schema.Output<typeof ObjectSchema> = ObjectSchema.parse(input);
	const count: number | undefined = output.count;
	void count;
	const ExtendedSchema = schema.extend(ObjectSchema, { id: schema.number() });
	const id: number = ExtendedSchema.parse({ id: 3 }).id;
	void id;
	// @ts-expect-error Last-field-wins extension makes id a number, not string or never.
	const wrongId: string = ExtendedSchema.parse({ id: 3 }).id;
	void wrongId;
	const DictionarySchema = schema.record(schema.oneOf(['a', 'b']), schema.number());
	const partial: number | undefined = DictionarySchema.parse({}).a;
	void partial;
	// @ts-expect-error A finite dictionary does not imply all possible keys are present.
	const complete: number = DictionarySchema.parse({}).a;
	void complete;
	const ExternalSchema = schema.object({ id: schema.string() }, { unknownKeys: 'preserve' });
	const externalInput: schema.Input<typeof ExternalSchema> = { id: 'a', future: true };
	const PreservedSchema = schema.extend(ExternalSchema, { id: schema.number() });
	const future: unknown = PreservedSchema.parse({ id: 3, future: true }).future;
	const preservedId: number = PreservedSchema.parse({ id: 3 }).id;
	void externalInput;
	void future;
	void preservedId;
	// @ts-expect-error Preserving undeclared keys must not widen a declared field.
	const wrongPreserved: string = PreservedSchema.parse({ id: 3 }).id;
	void wrongPreserved;
	const StrippedSchema = schema.object({ id: schema.string() }, { unknownKeys: 'strip' });
	const stripInput: schema.Input<typeof StrippedSchema> = { id: 'a', future: true };
	void stripInput;
	// @ts-expect-error A stripping schema accepts extra input without retaining it in output.
	const removed = StrippedSchema.parse({ id: 'a', future: true }).future;
	void removed;
	const StrictSchema = schema.extend(ExternalSchema, {}, { unknownKeys: 'reject' });
	// @ts-expect-error Replacing preserve with reject removes the unknown output index signature.
	const noLongerPreserved = StrictSchema.parse({ id: 'a' }).future;
	void noLongerPreserved;
	// @ts-expect-error Synchronous readers must reject async callbacks statically.
	schema.define(async () => 1);
	// @ts-expect-error A callback returning a union with Promise is still asynchronous.
	schema.define((): number | Promise<number> => 1);
	// @ts-expect-error Synchronous transformations cannot return a Promise.
	schema.transform(schema.string(), async (value) => value.length);
	const asynchronous: Promise<number> = schema.defineAsync(async () => 1).parse(null);
	void asynchronous;
}
void ownedTypes;

interface Payload {
	readonly id: string;
}

/** Named interfaces need no artificial index signature to enter a permissive object schema. */
function interfaceInputs(payload: Payload): void {
	const Strip = schema.object({ id: schema.string() }, { unknownKeys: 'strip' });
	const Preserve = schema.object({ id: schema.string() }, { unknownKeys: 'preserve' });
	const strip: schema.Input<typeof Strip> = payload;
	const preserve: schema.Input<typeof Preserve> = payload;
	const extra: schema.Input<typeof Strip> = { id: 'a', extra: true };
	void strip;
	void preserve;
	void extra;
	// @ts-expect-error Permissive extra keys never change a declared field's type.
	const wrong: schema.Input<typeof Strip> = { id: 1, extra: true };
	void wrong;
	const Strict = schema.object({ id: schema.string() });
	// @ts-expect-error The authored reject policy still rejects unknown literal keys.
	const strictExtra: schema.Input<typeof Strict> = { id: 'a', extra: true };
	void strictExtra;
}
void interfaceInputs;

/** Optional settings cannot promise that a non-default policy will be present at runtime. */
function optionalPolicies(): void {
	const options: schema.ObjectOptions<'preserve'> = {};
	const OptionalPolicy = schema.object({ id: schema.string() }, options);
	const possible: readonly schema.ObjectPolicy<typeof OptionalPolicy>[] = ['reject', 'preserve'];
	void possible;
	// @ts-expect-error Optional preservation does not guarantee an unknown-field output index signature.
	const unknown = OptionalPolicy.parse({ id: 'a' }).future;
	void unknown;
	// @ts-expect-error Strip was neither configured nor the fallback.
	const impossible: schema.ObjectPolicy<typeof OptionalPolicy> = 'strip';
	void impossible;
	const Preserve = schema.object({ id: schema.string() }, { unknownKeys: 'preserve' });
	const replacement: schema.ObjectOptions<'strip'> = {};
	const Extended = schema.extend(Preserve, { name: schema.string() }, replacement);
	const inherited: readonly schema.ObjectPolicy<typeof Extended>[] = ['preserve', 'strip'];
	void inherited;
	// @ts-expect-error An omitted replacement inherits preserve, not reject.
	const wrongDefault: schema.ObjectPolicy<typeof Extended> = 'reject';
	void wrongDefault;
	const Default = schema.object({ id: schema.string() }, {});
	const Undefined = schema.object({ id: schema.string() }, undefined);
	const defaults: readonly [schema.ObjectPolicy<typeof Default>, schema.ObjectPolicy<typeof Undefined>] = [
		'reject',
		'reject',
	];
	void defaults;
}
void optionalPolicies;
