/**
 * Rejects declarations that annotate a variable before `Object.freeze()` can infer
 * the value's exact members.
 *
 * Keep the contract on the object expression instead:
 *
 * ~~~~ typescript
 * const policy = Object.freeze({ type: 'retry', attempts: 3 } satisfies RetryPolicy);
 * ~~~~
 *
 * This form checks the public contract and retains the inferred value type.
 */
const root = new URL('../packages/', import.meta.url);
const pattern = /\b(?:const|let)\s+[A-Za-z_$][\w$]*\s*:\s*[^=;\n]+?=\s*Object\.freeze\s*\(/g;
const failures: string[] = [];

for await (const entry of walk(root)) {
	if (!entry.pathname.endsWith('.ts') && !entry.pathname.endsWith('.tsx')) continue;
	const source = await Deno.readTextFile(entry);
	for (const match of source.matchAll(pattern)) {
		const line = source.slice(0, match.index).split('\n').length;
		failures.push(`${relative(entry)}:${line}`);
	}
}

if (failures.length > 0) {
	console.error('Put the type contract inside Object.freeze() with `satisfies`:');
	for (const failure of failures) console.error(`  ${failure}`);
	Deno.exit(1);
}

console.log('Object.freeze inference check passed.');

async function* walk(directory: URL): AsyncGenerator<URL> {
	for await (const entry of Deno.readDir(directory)) {
		const value = new URL(entry.name, directory.href.endsWith('/') ? directory : new URL(`${directory.href}/`));
		if (entry.isDirectory) {
			yield* walk(new URL(`${value.href}/`));
			continue;
		}
		if (entry.isFile) yield value;
	}
}

function relative(value: URL): string {
	return decodeURIComponent(value.pathname.slice(new URL('../', import.meta.url).pathname.length));
}
