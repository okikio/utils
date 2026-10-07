/** Qualify browser conditional exports with a real bundle and Web Stream round trip. */
import { build } from 'tsdown';
import { parseSync } from 'oxc-parser';

const root = new URL('../', import.meta.url);
const temporary = await Deno.makeTempDir({ prefix: 'okikio-consumer-' });
try {
	const source = `
		import ${JSON.stringify(new URL('packages/dispose/polyfill.ts', root).pathname)};
		import * as csv from ${JSON.stringify(new URL('packages/csv/mod.ts', root).pathname)};
		import { cell } from ${JSON.stringify(new URL('packages/csv/write.ts', root).pathname)};
		const expected = ['雪,quote"', 'line\\nbreak', ''];
		const text = 'one,two,three\\n' + expected.map(cell).join(',') + '\\n';
		const bytes = new TextEncoder().encode(text);
		const stream = new ReadableStream({ start(controller) {
			for (const value of bytes) controller.enqueue(new Uint8Array([value]));
			controller.close();
		} });
		await using document = await csv.parseStream(stream, { headerRow: 1 });
		const rows = await Array.fromAsync(document.rows);
		if (rows.length !== 1 || !rows[0].values.every((value, index) => value === expected[index])) throw new Error('Browser CSV round trip corrupted cells');
		console.log('Browser conditional CSV bundle preserved Unicode, quotes, newlines and split bytes.');
	`;
	const entry = `${temporary}/entry.ts`;
	const outDir = `${temporary}/dist`;
	await Deno.writeTextFile(entry, source);
	await build({
		config: false,
		cwd: root.pathname,
		entry: [entry],
		outDir,
		format: ['esm'],
		platform: 'browser',
		target: 'esnext',
		dts: false,
		treeshake: true,
		clean: true,
		publint: false,
		attw: false,
		deps: { alwaysBundle: [/^@okikio\//] },
	});
	const files: string[] = [];
	for await (const file of Deno.readDir(outDir)) {
		if (!file.isFile || !/\.m?js$/u.test(file.name)) continue;
		const path = `${outDir}/${file.name}`;
		files.push(path);
		const result = parseSync(path, await Deno.readTextFile(path));
		for (const statement of result.program.body) {
			if (statement.type === 'ImportDeclaration' && !statement.source.value.startsWith('.')) {
				throw new Error(`Browser consumer retained external runtime import ${statement.source.value}.`);
			}
		}
	}
	const bundledEntry = files.find((path) => /\/entry\.m?js$/u.test(path));
	if (bundledEntry === undefined) throw new Error('Consumer bundle did not emit its entry.');
	// A native Node Web API host exercises the browser-selected parser build.
	// It proves that conditional bundle's behavior, not a deployed browser UI.
	const status = await new Deno.Command('node', { args: [bundledEntry], stdout: 'inherit', stderr: 'inherit' }).spawn()
		.status;
	if (!status.success) throw new Error(`Browser conditional consumer failed with exit ${status.code}.`);
} finally {
	await Deno.remove(temporary, { recursive: true });
}
