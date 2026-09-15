/**
 * Run the local TypeScript compiler with the installed Deno type package.
 *
 * TypeScript does not ship Deno's ambient types. The root package declares
 * `@types/deno`, and `tsconfig.json` selects it with `compilerOptions.types`.
 * This wrapper only finds the pinned local compiler on each supported platform.
 *
 * @module
 */
export {};

const root = await Deno.realPath(Deno.args[0] ?? Deno.cwd());
const compiler = Deno.build.os === 'windows'
	? `${root}/node_modules/.bin/tsc.cmd`
	: `${root}/node_modules/.bin/tsc`;
const result = await new Deno.Command(compiler, {
	args: ['--pretty', 'false', '--project', `${root}/tsconfig.json`],
	cwd: root,
	stdout: 'piped',
	stderr: 'piped',
}).output();
await Deno.stdout.write(result.stdout);
await Deno.stderr.write(result.stderr);
if (!result.success) Deno.exit(result.code);
