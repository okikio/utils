/** Compile and run explicitly marked, complete README examples through public package exports. */
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

export interface ExampleType {
	readonly filename: string;
	readonly source: string;
	readonly runnable: boolean;
	readonly output?: string;
}

/** Read fenced code as data; prose, headings, punctuation and fence choice are not test contracts. */
export function examples(markdown: string): readonly ExampleType[] {
	const lines = markdown.split(/\r?\n/u);
	const values: Array<{ filename: string; source: string; runnable: boolean; output?: string }> = [];
	let last: typeof values[number] | undefined;
	for (let index = 0; index < lines.length; index += 1) {
		const opening = /^(\x60{3,}|~{3,})\s*([A-Za-z][\w+-]*)(?:\s+(.*))?$/u.exec(lines[index]!);
		if (opening === null) continue;
		const fence = opening[1]!;
		const language = opening[2]!;
		const metadata = opening[3] ?? '';
		const body: string[] = [];
		const closing = new RegExp(`^${fence[0]}{${fence.length},}\\s*$`, 'u');
		while (++index < lines.length && !closing.test(lines[index]!)) body.push(lines[index]!);
		if (index === lines.length) throw new TypeError('Unclosed example fence.');
		if (language === 'text' && metadata === 'output' && last !== undefined) {
			last.output = body.join('\n').trim();
			continue;
		}
		const role = /^(runnable|support)(?:=([\w.-]+\.ts))?$/u.exec(metadata);
		if ((language !== 'ts' && language !== 'typescript') || role === null) continue;
		const filename = role[2] ?? `example-${values.length + 1}.ts`;
		if (filename.startsWith('.') || filename.includes('..')) {
			throw new TypeError('Example filenames must be local basenames.');
		}
		last = { filename, source: body.join('\n'), runnable: role[1] === 'runnable' };
		values.push(last);
	}
	return values;
}

/** Find package guides and the two public guides that teach complete compositions. */
export async function readmes(): Promise<readonly URL[]> {
	const root = new URL('../packages/', import.meta.url);
	const values: URL[] = [new URL('../README.md', import.meta.url), new URL('../docs/composition.md', import.meta.url)];
	async function visit(directory: URL): Promise<void> {
		for await (const entry of Deno.readDir(directory)) {
			if (entry.isDirectory && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
				await visit(new URL(`${entry.name}/`, directory));
			} else if (entry.isFile && entry.name === 'README.md') values.push(new URL(entry.name, directory));
		}
	}
	await visit(root);
	return values.toSorted((left, right) => left.href.localeCompare(right.href));
}

/**
 * Validate authored examples in fresh modules and release every temporary file.
 *
 * Keeping the temporary module inside its owning package gives it the package's
 * real dependency and export resolution. Only the process example receives run
 * permission; these examples need no network or environment access. A generous
 * timeout diagnoses a stuck example and is not a performance acceptance limit.
 */
export async function checkExamples(paths?: readonly URL[]): Promise<number> {
	let count = 0;
	const failures: unknown[] = [];
	for (const path of paths ?? await readmes()) {
		if (import.meta.main) console.log(`Checking ${path.pathname}`);
		const values = examples(await Deno.readTextFile(path));
		if (!values.some((value) => value.runnable)) throw new Error(`${path.pathname} has no complete runnable example.`);
		const directory = await Deno.makeTempDir({ dir: fileURLToPath(new URL('./', path)), prefix: '.example-' });
		try {
			const filenames = new Set<string>();
			for (const value of values) {
				if (filenames.has(value.filename)) throw new Error(`${path.pathname} repeats ${value.filename}.`);
				filenames.add(value.filename);
				await Deno.writeTextFile(`${directory}/${value.filename}`, `${value.source}\n`);
			}
			await command(['check', ...values.map((value) => `${directory}/${value.filename}`)], path);
			for (const value of values.filter((value) => value.runnable)) {
				const permissions = path.pathname.endsWith('/process/README.md')
					? ['--allow-run']
					: path.pathname.endsWith('/worker/README.md')
					? ['--allow-read']
					: [];
				// Terminal colors describe presentation, not the example's returned values.
				// A caller's FORCE_COLOR must not turn a correct numeric result into a failure.
				const output = stripVTControlCharacters(
					await command(['run', ...permissions, `${directory}/${value.filename}`], path),
				);
				if (value.output !== undefined && output.trim() !== value.output.trim()) {
					throw new Error(
						`${path.pathname} ${value.filename}: expected output ${JSON.stringify(value.output)}, received ${
							JSON.stringify(output.trim())
						}.`,
					);
				}
				count += 1;
			}
		} catch (error) {
			failures.push(error);
		} finally {
			await Deno.remove(directory, { recursive: true });
		}
	}
	if (failures.length > 0) throw new AggregateError(failures, `${failures.length} README examples failed.`);
	return count;
}

/** Fail on runtime errors and join termination before returning from a timeout. */
async function command(args: readonly string[], path: URL): Promise<string> {
	const child = new Deno.Command(Deno.execPath(), { args: [...args], stdout: 'piped', stderr: 'piped' }).spawn();
	const timeout = setTimeout(() => child.kill('SIGKILL'), 60_000);
	try {
		const output = await child.output();
		if (!output.success) {
			throw new Error(`${path.pathname}: deno ${args[0]} failed:\n${new TextDecoder().decode(output.stderr)}`);
		}
		return new TextDecoder().decode(output.stdout);
	} finally {
		clearTimeout(timeout);
	}
}

if (import.meta.main) console.log(`${await checkExamples()} complete README examples compiled and ran.`);
