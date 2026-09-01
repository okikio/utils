import * as z from 'zod';

import * as capacity from './mod.ts';

const count = capacity.unit('count', { description: 'Discrete items.' });
const countField = capacity.field(z.number().int().nonnegative(), count, {
	description: 'A non-negative count.',
});

type HostValues = Readonly<{ cores: number; threads: number }>;
const HostConstraint = capacity.constraint<HostValues, typeof count>({
	id: 'threads-per-core',
	description: 'Threads must fit within cores.',
	unit: count,
	used: (value) => value.threads,
	maximum: (value) => value.cores * 2,
});

const Host = capacity.define({
	cores: countField,
	threads: countField,
}, { constraints: [HostConstraint] });

const checked = await capacity.check(Host, { cores: 4, threads: 8 });
const cores: number = checked.value.cores;
const threads: number = checked.value.threads;
void cores;
void threads;

const MissingThreads = capacity.define({ cores: countField });

// A constraint may only be attached when its value contract is satisfied by the definition.
// @ts-expect-error MissingThreads does not provide the `threads` field required by HostConstraint.
capacity.define({ cores: countField }, { constraints: [HostConstraint] });

// Composing a smaller definition preserves constraints that can consume the larger value.
const Combined = capacity.compose(MissingThreads, Host);
const combined = await capacity.check(Combined, { cores: 4, threads: 6 });
const combinedThreads: number = combined.value.threads;
void combinedThreads;
