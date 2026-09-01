import * as record from './mod.ts';

const source = { port: 4321, name: 'service' } as const;
const keys = record.keys(source);
const first: 'port' | 'name' | undefined = keys[0];
void first;
const entries = record.entries(source);
const entry: readonly ['port', 4321] | readonly ['name', 'service'] | undefined = entries[0];
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
