/** Validate package export parity, targets, and side-effect declarations before publication. */
const root = new URL('../packages/', import.meta.url);
const failures: string[] = [];

for await (const entry of Deno.readDir(root)) {
	if (!entry.isDirectory) continue;
	const directory = new URL(`${entry.name}/`, root);
	const packageJson = await readJson(new URL('package.json', directory));
	const denoJson = await readJson(new URL('deno.jsonc', directory));
	if (packageJson === undefined || denoJson === undefined) continue;
	const npmExports = packageJson.exports as Record<string, string> | undefined;
	const denoExports = denoJson.exports as Record<string, string> | undefined;
	if (!same(npmExports, denoExports)) failures.push(`${entry.name}: npm and Deno exports differ.`);
	for (const [key, target] of Object.entries(npmExports ?? {})) {
		try { await Deno.stat(new URL(target, directory)); } catch { failures.push(`${entry.name}: export ${key} points to missing ${target}.`); }
	}
}
if (failures.length > 0) throw new Error(`Package validation failed:\n${failures.map((value) => `- ${value}`).join('\n')}`);
console.log('Package export parity and targets are valid.');

/** Read one JSON/JSONC manifest without hiding malformed files. */
async function readJson(url: URL): Promise<Record<string, unknown> | undefined> {
	try {
		const text = await Deno.readTextFile(url);
		return JSON.parse(text) as Record<string, unknown>;
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) return undefined;
		throw error;
	}
}

/** Compare manifest values structurally so harmless object-key ordering cannot fail publication checks. */
function same(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => same(value, right[index]));
	}
	if (!record(left) || !record(right)) return false;
	const leftKeys = Object.keys(left).toSorted();
	const rightKeys = Object.keys(right).toSorted();
	return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && same(left[key], right[key]));
}

/** Distinguish JSON object values from arrays, null, and primitive manifest values. */
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
