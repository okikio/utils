/**
 * Verify that the single-install umbrella adds no meaningful runtime weight.
 *
 * Each case bundles the same public symbol through its focused package and
 * through `@okikio/utils`. The check fails when the umbrella path adds more
 * than a tiny import-wrapper allowance, catching accidental eager barrels or
 * top-level initialization before release.
 */
import { build } from 'tsdown';

const root = new URL('../', import.meta.url);
const rootPath = root.pathname;
const treeShakeCases = [
	{ name: 'result-named', leaf: 'packages/result/mod.ts', umbrella: 'packages/utils/result.ts', source: 'import { ok } from SOURCE; console.log(ok);' },
	{ name: 'result-namespace', leaf: 'packages/result/mod.ts', umbrella: 'packages/utils/result.ts', source: 'import * as value from SOURCE; console.log(value.ok);' },
	{ name: 'http-request', leaf: 'packages/http/request/mod.ts', umbrella: 'packages/utils/http/request.ts', source: 'import { parseQuery } from SOURCE; console.log(parseQuery);' },
	{ name: 'server-router', leaf: 'packages/server/http/mod.ts', umbrella: 'packages/utils/server/http.ts', source: 'import { prepareRoutes } from SOURCE; console.log(prepareRoutes);' },
] as const;

for (const item of treeShakeCases) {
	const leaf = await bundleBytes(`${item.name}-leaf`, source(item.source, item.leaf));
	const umbrella = await bundleBytes(`${item.name}-umbrella`, source(item.source, item.umbrella));
	const overhead = umbrella - leaf;
	if (overhead > 32) throw new Error(`${item.name}: umbrella adds ${overhead} bytes (${umbrella} vs ${leaf}); expected <= 32.`);
	console.log(`${item.name}: leaf=${leaf} umbrella=${umbrella} overhead=${overhead}`);
}

/** Bind one consumer fixture directly to a source entrypoint so the bundle cannot externalize a workspace alias. */
function source(template: string, entry: string): string {
	return template.replace('SOURCE', JSON.stringify(`${rootPath}${entry}`));
}

/** Bundle one disposable consumer and return the emitted JavaScript byte count. */
async function bundleBytes(name: string, source: string): Promise<number> {
	const temp = await Deno.makeTempDir({ prefix: `okikio-${name}-` });
	try {
		const entry = `${temp}/entry.ts`;
		const outDir = `${temp}/dist`;
		await Deno.writeTextFile(entry, source);
		await build({
			config: false,
			cwd: rootPath,
			entry: [entry],
			outDir,
			format: ['esm'],
			platform: 'neutral',
			target: 'esnext',
			dts: false,
			minify: true,
			treeshake: true,
			clean: true,
			deps: { alwaysBundle: [/^@okikio\//] },
			publint: false,
			attw: false,
		});
		let bytes = 0;
		for await (const output of Deno.readDir(outDir)) {
			if (output.isFile && /\.m?js$/u.test(output.name)) bytes += (await Deno.stat(`${outDir}/${output.name}`)).size;
		}
		return bytes;
	} finally {
		await Deno.remove(temp, { recursive: true });
	}
}
