/** Check declaration explanations across real public entrypoints without testing prose wording. @module */
import { fileURLToPath } from 'node:url';
import { diagnostics as parseDiagnostics } from './doc-diagnostics.ts';
import { parse } from '@std/jsonc';

const root = new URL('../packages/', import.meta.url);
const files = new Set<string>();
for await (const entry of Deno.readDir(root)) {
	if (!entry.isDirectory || entry.name === 'utils') continue;
	const directory = new URL(`${entry.name}/`, root);
	const manifest = parse(await Deno.readTextFile(new URL('deno.jsonc', directory))) as {
		readonly exports: Readonly<Record<string, string>>;
	};
	for (const path of Object.values(manifest.exports)) files.add(fileURLToPath(new URL(path, directory)));
}

const result = await new Deno.Command(Deno.execPath(), {
	args: ['doc', '--lint', ...[...files].toSorted()],
	env: { NO_COLOR: '1', FORCE_COLOR: '0' },
	stdout: 'null',
	stderr: 'piped',
}).output();
// Diagnostic codes and source locations are the CLI's contract. The prose
// inside the diagnostic, and the documentation wording, are deliberately free.
const output = new TextDecoder().decode(result.stderr);
const diagnostics = parseDiagnostics(output);
const failures: string[] = [];
const known = new Set(['missing-jsdoc', 'private-type-ref', 'missing-explicit-type']);
const seen = new Set<string>();
let typeDiagnostics = 0;
let externalComments = 0;
for (const diagnostic of diagnostics) {
	const { code, path, line, column, block } = diagnostic;
	if (code === undefined || path === undefined || !known.has(code)) {
		failures.push(block);
		continue;
	}
	const identity = `${code}:${path}:${line}:${column}`;
	if (seen.has(identity)) continue;
	seen.add(identity);
	if (code !== 'missing-jsdoc') {
		typeDiagnostics += 1;
		continue;
	}
	if (path.startsWith(fileURLToPath(root))) failures.push(block);
	else externalComments += 1;
}
if ((!result.success && diagnostics.length === 0) || failures.length > 0) {
	throw new Error(`Public declaration documentation failed:\n${failures.join('\n') || output}`);
}
console.log(`No missing declaration comments across ${files.size} focused public entrypoints.`);
console.log(
	`${typeDiagnostics} renderer type diagnostics and ${externalComments} external dependency comment diagnostics remain outside this comment gate.`,
);
