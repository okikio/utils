/** Test browser conditional exports with a real bundle and Web Stream round trip. */
import { build } from 'tsdown';
import { parseSync } from 'oxc-parser';

const root = new URL('../../', import.meta.url);
const scratch = new URL('.tmp/consumers/', root);
await Deno.mkdir(scratch, { recursive: true });
const temporary = await Deno.makeTempDir({ dir: scratch.pathname, prefix: 'browser-' });
try {
	const source = `
		import ${JSON.stringify(new URL('packages/dispose/polyfill.ts', root).pathname)};
		import * as csv from ${JSON.stringify(new URL('packages/format/csv/mod.ts', root).pathname)};
		import { cell } from ${JSON.stringify(new URL('packages/format/csv/write.ts', root).pathname)};
        import { sha256 } from ${JSON.stringify(new URL('packages/hash/mod.ts', root).pathname)};
        import { create as createHash } from ${JSON.stringify(new URL('packages/hash/sync.ts', root).pathname)};
        import { read as hashStream } from ${JSON.stringify(new URL('packages/hash/stream.ts', root).pathname)};
        import { hex } from ${JSON.stringify(new URL('packages/hash/encoding.ts', root).pathname)};
        import { v7, timestamp } from ${JSON.stringify(new URL('packages/hash/uuid.ts', root).pathname)};
        import { sign, verify } from ${JSON.stringify(new URL('packages/hash/hmac/mod.ts', root).pathname)};
        import { blake3 } from ${JSON.stringify(new URL('packages/hash/blake.ts', root).pathname)};
        import { sha3_256 } from ${JSON.stringify(new URL('packages/hash/sha3.ts', root).pathname)};
        const hashInput = new TextEncoder().encode('abc');
        if (hex(createHash().update(hashInput).digest()) !== await sha256('abc')) throw new Error('Browser SHA-2 mismatch');
        const hashSource = new ReadableStream({start(controller){controller.enqueue(hashInput);controller.close();}});
        if (hex(await hashStream('sha256',hashSource,{maximumBytes:3})) !== await sha256('abc')) throw new Error('Browser stream hash mismatch');
        const secret = new Uint8Array([1,2,3]);
        if (!await verify('sha256',secret,hashInput,await sign('sha256',secret,hashInput))) throw new Error('Browser HMAC mismatch');
        if (timestamp(v7(123)) !== 123 || blake3('')[0] !== 175 || sha3_256('').length !== 32) throw new Error('Browser optional hash mismatch');
        console.log('Browser-selected Hash bundle preserved native, incremental, streaming, HMAC, UUID and optional hash behavior.');

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
