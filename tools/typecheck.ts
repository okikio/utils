/**
 * Run the local TypeScript compiler with the current Deno runtime declarations.
 *
 * TypeScript does not ship Deno's ambient types. The declaration file is
 * generated in a temporary directory for this process, so repository source and
 * package artifacts remain independent from the machine that runs this check.
 *
 * @module
 */
const root = await Deno.realPath(Deno.args[0] ?? Deno.cwd());
const temporary = await Deno.makeTempDir({ prefix: 'okikio-utils-types-' });

try {
	const types = await new Deno.Command(Deno.execPath(), {
		args: ['types'],
		stdout: 'piped',
		stderr: 'piped',
	}).output();
	if (!types.success) {
		await Deno.stderr.write(types.stderr);
		throw new Error('Could not generate Deno runtime declarations for TypeScript.');
	}

	const typeRoot = `${temporary}/types`;
	await Deno.mkdir(`${typeRoot}/deno`, { recursive: true });
	await Deno.writeFile(`${typeRoot}/deno/index.d.ts`, types.stdout);
	await Deno.writeTextFile(`${temporary}/tsconfig.json`, JSON.stringify({
		extends: `${root}/tsconfig.json`,
		compilerOptions: {
			typeRoots: [typeRoot, `${root}/node_modules/@types`],
		},
	}, null, '\t'));

	const compiler = Deno.build.os === 'windows'
		? `${root}/node_modules/.bin/tsc.cmd`
		: `${root}/node_modules/.bin/tsc`;
	const result = await new Deno.Command(compiler, {
		args: ['--pretty', 'false', '--project', `${temporary}/tsconfig.json`],
		cwd: root,
		stdout: 'piped',
		stderr: 'piped',
	}).output();
	await Deno.stdout.write(result.stdout);
	await Deno.stderr.write(result.stderr);
	if (!result.success) Deno.exit(result.code);
} finally {
	await Deno.remove(temporary, { recursive: true });
}
