/** Preserve JSR version authority and retry immutable registry publication through Bumpy. @module */
import { parse } from 'jsr:@std/jsonc@1.0.2';

const root = new URL('../', import.meta.url);
const mode = Deno.args[0];
if (mode === 'sync' || mode === 'check') {
	let count = 0;
	for await (const entry of Deno.readDir(new URL('packages/', root))) {
		if (!entry.isDirectory) continue;
		const directory = new URL(`packages/${entry.name}/`, root);
		const npm = JSON.parse(await Deno.readTextFile(new URL('package.json', directory)));
		const path = new URL('deno.jsonc', directory);
		const text = await Deno.readTextFile(path);
		const jsr = parse(text) as { name: string; version: string };
		if (npm.name !== jsr.name) throw new Error(`${entry.name}: registry package names differ.`);
		if (mode === 'check' && npm.version !== jsr.version) {
			throw new Error(`${entry.name}: npm ${npm.version} differs from JSR ${jsr.version}.`);
		}
		if (mode === 'sync' && npm.version !== jsr.version) {
			const next = text.replace(/("version"\s*:\s*")[^"]+("\s*[,}])/, `$1${npm.version}$2`);
			const verified = parse(next) as { version: string };
			if (verified.version !== npm.version) {
				throw new Error(`${entry.name}: cannot replace one existing JSR version field safely.`);
			}
			await Deno.writeTextFile(path, next);
		}
		count++;
	}
	console.log(`${mode === 'sync' ? 'Synchronized' : 'Checked'} ${count} source-native package versions.`);
} else if (mode === 'published' || mode === 'publish') {
	const npm = JSON.parse(await Deno.readTextFile('package.json')) as { name: string; version: string };
	const jsr = parse(await Deno.readTextFile('deno.jsonc')) as { name: string; version: string };
	if (npm.name !== jsr.name || npm.version !== jsr.version) {
		throw new Error('Refuse publication with registry name or version drift.');
	}
	const response = await fetch(`https://jsr.io/${npm.name}/${npm.version}_meta.json`);
	await response.body?.cancel();
	if (!response.ok && response.status !== 404) throw new Error(`JSR version lookup failed (${response.status}).`);
	if (mode === 'published') {
		if (response.ok) console.log(npm.version);
	} else if (response.ok) console.log(`${npm.name}@${npm.version} already exists on JSR.`);
	else {
		// Bumpy may temporarily replace workspace ranges in package.json. JSR's Deno manifests remain canonical.
		const status = await new Deno.Command(Deno.execPath(), {
			args: ['publish', '--allow-dirty'],
			stdout: 'inherit',
			stderr: 'inherit',
		}).spawn().status;
		if (!status.success) Deno.exit(status.code);
	}
} else throw new Error('Expected sync, check, published, or publish.');
