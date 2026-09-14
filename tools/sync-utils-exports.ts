/** Synchronize deep `@okikio/utils` exports with every focused package export. */
const root = new URL('../', import.meta.url);
const packages = new URL('packages/', root);
const utils = new URL('packages/utils/', root);

interface PackageManifestType {
	name?: string;
	exports?: Record<string, string>;
	sideEffects?: false | string[];
	[key: string]: unknown;
}

const packageManifest = await readJson(new URL('package.json', utils));
const denoManifest = await readJson(new URL('deno.jsonc', utils));
const exports: Record<string, string> = { '.': './mod.ts', './all': './all.ts' };
const sideEffects: string[] = [];

for await (const entry of Deno.readDir(packages)) {
	if (!entry.isDirectory || entry.name === 'utils') continue;
	const directory = new URL(`${entry.name}/`, packages);
	const manifest = await readJson(new URL('package.json', directory));
	if (!manifest.name?.startsWith('@okikio/')) continue;
	const short = manifest.name.slice('@okikio/'.length);
	for (const [key, target] of Object.entries(manifest.exports ?? {})) {
		if (key === './package.json') continue;
		const suffix = key === '.' ? '' : key.slice(1);
		const umbrella = `./${short}${suffix}`;
		const relative = `${short}${suffix}.ts`;
		const output = new URL(relative, utils);
		await Deno.mkdir(new URL('./', output), { recursive: true });
		const source = `${manifest.name}${suffix}`;
		const sideEffect = Array.isArray(manifest.sideEffects) && manifest.sideEffects.includes(target);
		await Deno.writeTextFile(output, sideEffect
			? `/** Explicit side-effect bridge to the module owned by \`${source}\`. @module */\nimport '${source}';\nexport {};\n`
			: `/** Focused single-install re-export of \`${source}\`. @module */\nexport * from '${source}';\n`);
		exports[umbrella] = `./${relative}`;
		if (sideEffect) sideEffects.push(`./${relative}`);
	}
}
const ordered = Object.fromEntries(Object.entries(exports).sort(([left], [right]) => {
	const rank = (value: string) => value === '.' ? 0 : value === './all' ? 1 : 2;
	return rank(left) - rank(right) || left.localeCompare(right);
}));
packageManifest.exports = ordered;
packageManifest.sideEffects = sideEffects.length === 0 ? false : sideEffects;
denoManifest.exports = ordered;
await Deno.writeTextFile(new URL('package.json', utils), `${JSON.stringify(packageManifest, null, '\t')}\n`);
await Deno.writeTextFile(new URL('deno.jsonc', utils), `${JSON.stringify(denoManifest, null, '\t')}\n`);

/** Read a required package manifest. */
async function readJson(url: URL): Promise<PackageManifestType> {
	return JSON.parse(await Deno.readTextFile(url)) as PackageManifestType;
}
