import * as record from './mod.ts';

const source = { port: 4321, name: 'service' } as const;
const keys = record.keys(source);
const first: string | undefined = keys[0];
void first;
const entries = record.entries(source);
const entry: readonly [string, unknown] | undefined = entries[0];
void entry;
const snapshot = record.snapshot(source);
const port: 4321 = snapshot.port;
void port;

interface TypedOptions {
	readonly enabled?: boolean;
	readonly label?: string;
}

function preserveTypedRecord(options: TypedOptions): void {
	record.assert(options);
	const enabled: boolean | undefined = options.enabled;
	const label: string | undefined = options.label;
	void enabled;
	void label;
}

function narrowUnknown(value: unknown): void {
	record.assert(value);
	const narrowed: Readonly<Record<string, unknown>> = value;
	void narrowed;
}

void preserveTypedRecord;
void narrowUnknown;

const hidden = { port: 4321, secret: true };
const narrowed: { port: number } = hidden;
// @ts-expect-error Runtime enumeration can include keys absent from a structural view.
const exhaustive: readonly 'port'[] = record.keys(narrowed);
void exhaustive;
const selected = record.pick(narrowed, ['port']);
const selectedPort: number = selected.port;
void selectedPort;
function readonlyContract(): void {
	const readonlySnapshot = record.snapshot({ value: 1 });
	// @ts-expect-error A frozen snapshot is readonly even when its input was mutable.
	readonlySnapshot.value = 2;
}
void readonlyContract;
