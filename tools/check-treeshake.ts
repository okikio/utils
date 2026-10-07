/**
 * Qualify selective public imports by retained modules and executed consumer behavior.
 *
 * Equivalent focused and umbrella consumers must retain the same focused module
 * graph. Bundle byte counts are informational: harmless minifier or wrapper
 * changes do not constitute a failed capability contract.
 * @module
 */
import { build } from 'tsdown';
import { fileURLToPath } from 'node:url';

const rootPath = fileURLToPath(new URL('../', import.meta.url));
const treeShakeCases = [
	{
		name: 'result-named',
		leaf: 'packages/result/mod.ts',
		umbrella: 'packages/utils/result.ts',
		owner: 'packages/result/',
		source:
			"import { ok } from SOURCE; const value = ok(42); if (!value.ok || value.value !== 42 || !Object.isFrozen(value)) throw new Error('success wrapper changed');",
	},
	{
		name: 'result-namespace',
		leaf: 'packages/result/mod.ts',
		umbrella: 'packages/utils/result.ts',
		owner: 'packages/result/',
		source:
			"import * as result from SOURCE; const reason = {}; const value = result.fail(reason); if (value.ok || value.failure !== reason || !Object.isFrozen(value)) throw new Error('failure wrapper changed'); if (result.getOr(value, 42) !== 42) throw new Error('fallback changed');",
	},
	{
		name: 'http-request',
		leaf: 'packages/http/request/mod.ts',
		umbrella: 'packages/utils/http/request.ts',
		owner: 'packages/http/request/',
		source:
			"import { parseQuery } from SOURCE; const value = parseQuery('?tag=a&tag=b&flag&empty=', { bareQueryParameters: 'flag' }); if (!Array.isArray(value.tag) || value.tag.length !== 2 || value.tag[0] !== 'a' || value.tag[1] !== 'b' || value.flag !== 'true' || value.empty !== '') throw new Error('wire query changed'); if (!Object.isFrozen(value) || !Object.isFrozen(value.tag)) throw new Error('query ownership changed');",
	},
	{
		name: 'server-router',
		leaf: 'packages/server/http/mod.ts',
		umbrella: 'packages/utils/server/http.ts',
		owner: 'packages/server/http/',
		source:
			"import { prepareRoutes, matchRoute } from SOURCE; const plan = prepareRoutes([{ kind: 'route', method: 'GET', path: '/items/:id' }, { kind: 'route', method: 'GET', path: '/items/new' }]); if (matchRoute(plan, 'GET', '/items/new') !== 'GET /items/new' || matchRoute(plan, 'HEAD', '/items/7') !== 'GET /items/:id' || matchRoute(plan, 'POST', '/items/7') !== undefined) throw new Error('route selection changed'); if (!Object.isFrozen(plan) || !Object.isFrozen(plan.routes)) throw new Error('route plan ownership changed');",
	},
] as const;

/** Provenance survives valid constant folding even when a module contributes no final bytes. */
export interface GraphType {
	readonly origins: readonly string[];
	readonly modules: readonly string[];
}

/** Check retained modules against the counterpart's provenance, permitting the selected bridge. */
export function graphProblems(
	focused: GraphType,
	umbrella: GraphType,
	bridge: string,
	owner: string,
): readonly string[] {
	const errors: string[] = [];
	if (!focused.origins.some((file) => file.startsWith(owner))) {
		errors.push('The focused capability has no bundle provenance.');
	}
	if (!umbrella.origins.some((file) => file.startsWith(owner))) {
		errors.push('The umbrella capability has no bundle provenance.');
	}
	const focusedOrigins = new Set(focused.origins);
	const umbrellaOrigins = new Set(umbrella.origins);
	for (const file of focused.modules) {
		if (!umbrellaOrigins.has(file)) errors.push(`Umbrella omitted focused module ${file}.`);
	}
	for (const file of umbrella.modules) {
		if (file !== bridge && !focusedOrigins.has(file)) errors.push(`Umbrella retained unrelated module ${file}.`);
	}
	return errors;
}

/** Bundle and execute one disposable consumer; return only actual retained workspace modules and informational bytes. */
async function bundle(
	name: string,
	template: string,
	entrypoint: string,
): Promise<GraphType & Readonly<{ bytes: number }>> {
	const temp = await Deno.makeTempDir({ prefix: `okikio-${name}-` });
	try {
		const entry = `${temp}/entry.ts`;
		const outDir = `${temp}/dist`;
		await Deno.writeTextFile(entry, template.replace('SOURCE', JSON.stringify(`${rootPath}${entrypoint}`)));
		const results = await build({
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
		try {
			const chunks = results.flatMap((result) => result.chunks.filter((chunk) => chunk.type === 'chunk'));
			const entries = chunks.filter((chunk) => chunk.isEntry);
			if (entries.length !== 1) throw new Error(`${name}: the selective consumer has no unique executable entry.`);
			const provenance = chunks.flatMap((chunk) => Object.entries(chunk.modules));
			const select = (files: readonly string[]): readonly string[] =>
				[
					...new Set(
						files.map((file) => file.replaceAll('\\', '/'))
							.filter((file) => file.startsWith(`${rootPath}packages/`)).map((file) => file.slice(rootPath.length)),
					),
				].toSorted();
			const origins = select(provenance.map(([file]) => file));
			const modules = select(provenance.filter(([, module]) => module.renderedLength > 0).map(([file]) => file));
			const child = await new Deno.Command('node', {
				args: [`${outDir}/${entries[0]!.fileName}`],
				stdout: 'piped',
				stderr: 'piped',
			}).output();
			if (!child.success) {
				throw new Error(`${name}: bundled consumer failed.\n${new TextDecoder().decode(child.stderr)}`);
			}
			return {
				bytes: chunks.reduce((total, chunk) => total + new TextEncoder().encode(chunk.code).byteLength, 0),
				modules,
				origins,
			};
		} finally {
			for (const result of results) await result[Symbol.asyncDispose]();
		}
	} finally {
		await Deno.remove(temp, { recursive: true });
	}
}

if (import.meta.main) {
	for (const item of treeShakeCases) {
		const focused = await bundle(`${item.name}-focused`, item.source, item.leaf);
		const umbrella = await bundle(`${item.name}-umbrella`, item.source, item.umbrella);
		const errors = graphProblems(focused, umbrella, item.umbrella, item.owner);
		if (errors.length > 0) throw new Error(`${item.name}:\n${errors.join('\n')}`);
		console.log(JSON.stringify({ name: item.name, focused, umbrella, overheadBytes: umbrella.bytes - focused.bytes }));
	}
}
