import * as resource from './mod.ts';

const Store = resource.define<{ readonly ready: true }>()({
	id: 'type-test.store',
	description: 'Store used to verify implementation-set inference.',
});
const StoreLive = resource.implement(Store, {
	create: () => ({ ready: true as const }),
});

const set = resource.implementations(StoreLive, StoreLive);

// Deduplication preserves the exact implementation union without promising the
// input tuple length. The second repeated reference may not exist at runtime.
type IsTuple<Value extends readonly unknown[]> = number extends Value['length'] ? false : true;
type AssertFalse<Value extends false> = Value;
type ImplementationSetIsNotTuple = AssertFalse<IsTuple<typeof set.implementations>>;

const implementation: typeof StoreLive = set.implementations[0]!;
void implementation;

const implementationSetIsNotTuple: ImplementationSetIsNotTuple = false;
void implementationSetIsNotTuple;
