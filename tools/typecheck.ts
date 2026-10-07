/**
 * Run the local TypeScript compiler with the installed Deno type package.
 *
 * TypeScript does not ship Deno's ambient types. The root package declares
 * `@types/deno`, and `tsconfig.json` selects it with `compilerOptions.types`.
 * This wrapper invokes the pinned TypeScript 7 CLI alias explicitly. TypeScript 6 provides the supported
 * declaration-emission API required by tsdown; it does not own the source type gate.
 *
 * @module
 */
export {};

const root = await Deno.realPath(Deno.args[0] ?? Deno.cwd());
const compiler = `${root}/node_modules/typescript-native/bin/tsc`;
const result = await new Deno.Command('node', {
	args: [compiler, '--pretty', 'false', '--project', `${root}/tsconfig.json`],
	cwd: root,
	stdout: 'piped',
	stderr: 'piped',
}).output();
await Deno.stdout.write(result.stdout);
await Deno.stderr.write(result.stderr);
if (!result.success) Deno.exit(result.code);
