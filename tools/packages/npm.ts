/** Build and test the additional npm projection without changing canonical JSR manifests. @module */
import { fileURLToPath } from 'node:url';
import * as source from './npm/source.ts';
import * as build from './npm/build.ts';
import { inspect } from './npm/inspect.ts';
import { pack } from './npm/pack.ts';
import { consumer } from './npm/consumer.ts';

/** CLI composition owns arguments and one source snapshot; imported stages remain inert until called. */
const root = fileURLToPath(new URL('../../', import.meta.url));
const mode = process.argv[2] ?? 'build';
if (!['build', 'check', 'consumer', 'pack', 'verify', 'member'].includes(mode)) {
	throw new Error(`Unknown npm operation ${mode}.`);
}
const workspace = await source.get(root);
const requested = mode === 'build' ? process.argv.slice(3) : [];
if (requested.length) {
	throw new TypeError('Select package builds with native pnpm filtering; the root build owns all artifacts.');
}
if (mode === 'build' || mode === 'verify') await build.all(workspace, fileURLToPath(import.meta.url));
if (mode === 'member') await build.member(workspace, process.argv[3]);
if (['check', 'pack', 'consumer', 'verify'].includes(mode)) await inspect(workspace);
if (['pack', 'consumer', 'verify'].includes(mode)) await pack(workspace);
if (['consumer', 'verify'].includes(mode)) await consumer(workspace);
