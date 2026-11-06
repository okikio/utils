/** Compile and run explicitly marked, complete README examples through public package exports. */
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

/** One authored module and, when supplied, its expected standard output. */
export interface ExampleType {
	/** Local basename shared by support imports, never an arbitrary filesystem path. */
	readonly filename: string;
	/** Complete source between the fences, including comments that teach the example. */
	readonly source: string;
	/** Support modules are checked with the entry but are not launched independently. */
	readonly runnable: boolean;
	/** Optional exact output after terminal color removal and surrounding whitespace trimming. */
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

/** Find package quick starts and runnable examples in maintained root guides. */
export async function readmes(): Promise<readonly URL[]> {
	const root = new URL('../../packages/', import.meta.url);
	const values: URL[] = [new URL('../../README.md', import.meta.url)];
	async function visit(directory: URL, guides = false): Promise<void> {
		for await (const entry of Deno.readDir(directory)) {
			if (
				entry.isDirectory && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'history'
			) {
				await visit(new URL(`${entry.name}/`, directory), guides);
			} else if (entry.isFile && entry.name.endsWith('.md')) {
				const path = new URL(entry.name, directory);
				// Package how-tos can live beside a focused subpath without inventing another README directory.
				// Every README remains mandatory; other authored pages join the same proof when marked runnable.
				if (
					(!guides && entry.name === 'README.md') ||
					examples(await Deno.readTextFile(path)).some((value) => value.runnable)
				) values.push(path);
			}
		}
	}
	await visit(root);
	await visit(new URL('../../docs/', import.meta.url), true);
	return values.toSorted((left, right) => left.href.localeCompare(right.href));
}

/**
 * Validate authored examples in fresh modules and retain the exact modules and subprocess results.
 *
 * Temporary modules live under the repository's .tmp directory. The owning
 * package's explicit Deno configuration preserves its real dependency resolution
 * even though the files are outside that package. Process examples may start native
 * children; thread examples may read their worker modules. PostgreSQL constructor
 * examples may read the named driver defaults, but open no connection. All other
 * examples run without those extra permissions, network, or environment access.
 * The 60-second timeout diagnoses a stuck example, not acceptable performance.
 */
export async function checkExamples(paths?: readonly URL[]): Promise<number> {
	let count = 0;
	const failures: unknown[] = [];
	const temporary = new URL('../../.tmp/examples/', import.meta.url);
	await Deno.mkdir(temporary, { recursive: true });
	for (const path of paths ?? await readmes()) {
		if (import.meta.main) console.log(`Checking ${path.pathname}`);
		const values = examples(await Deno.readTextFile(path));
		if (!values.some((value) => value.runnable)) throw new Error(`${path.pathname} has no complete runnable example.`);
		const directory = await Deno.makeTempDir({ dir: fileURLToPath(temporary), prefix: 'example-' });
		const config = configuration(path);
		try {
			const filenames = new Set<string>();
			for (const value of values) {
				if (filenames.has(value.filename)) throw new Error(`${path.pathname} repeats ${value.filename}.`);
				filenames.add(value.filename);
				await Deno.writeTextFile(`${directory}/${value.filename}`, `${value.source}\n`);
			}
			await command(['check', '--config', config, ...values.map((value) => `${directory}/${value.filename}`)], path);
			for (const value of values.filter((value) => value.runnable)) {
				const permissions = (path.pathname.endsWith('/process/README.md') || path.pathname.endsWith('/docs/process.md'))
					? ['--allow-run']
					: (path.pathname.endsWith('/worker/thread/README.md') ||
							path.pathname.endsWith('/packages/worker/README.md') ||
							path.pathname.endsWith('/docs/worker.md'))
					? ['--allow-read']
					: (path.pathname.endsWith('/storage/workflow/postgres/README.md') ||
							path.pathname.endsWith('/storage/README.md'))
					? [
						// Postgres.js 4 reads these defaults at construction, even with an explicit URL.
						'--allow-env=PGPORT,PGMIN,PGQUEUE_TIMEOUT,PGSCHEDULER,PGINFER,PGSLOT,PGCHANNEL_BINDING,PGCHANNELBINDING,PGMAX,PGSSL,PGSSLNEGOTIATION,PGIDLE_TIMEOUT,PGCONNECT_TIMEOUT,PGMAX_LIFETIME,PGMAX_PIPELINE,PGBACKOFF,PGKEEP_ALIVE,PGPREPARE,PGDEBUG,PGFETCH_TYPES,PGPUBLICATIONS,PGTARGET_SESSION_ATTRS,PGAPPNAME,PGTARGETSESSIONATTRS',
					]
					: [];
				// Terminal colors describe presentation, not the example's returned values.
				// A caller's FORCE_COLOR must not turn a correct numeric result into a failure.
				const output = stripVTControlCharacters(
					await command(['run', '--config', config, ...permissions, `${directory}/${value.filename}`], path),
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
		}
		// Keep generated files after success and failure so a reader can reproduce
		// the exact checked snippet without reconstructing it from console output.
		await Deno.writeTextFile(`${directory}/source.json`, JSON.stringify({ document: path.href }, null, 2) + '\n');
	}
	if (failures.length > 0) throw new AggregateError(failures, `${failures.length} README examples failed.`);
	return count;
}

/** Select the package's existing configuration without copying or changing its import map. */
function configuration(path: URL): string {
	const packages = new URL('../../packages/', import.meta.url);
	if (path.href.startsWith(packages.href)) {
		const name = path.href.slice(packages.href.length).split('/')[0]!;
		return fileURLToPath(new URL(`${name}/deno.jsonc`, packages));
	}
	return fileURLToPath(new URL('../../deno.jsonc', import.meta.url));
}

/** Fail on runtime errors and join termination before returning from a timeout. */
async function command(args: readonly string[], path: URL): Promise<string> {
	const child = new Deno.Command(Deno.execPath(), { args: [...args], stdout: 'piped', stderr: 'piped' }).spawn();
	const timeout = setTimeout(() => child.kill('SIGKILL'), 60_000);
	try {
		const output = await child.output();
		// A later failed example must not replace an earlier command's diagnostics.
		const commands = new URL('../../.tmp/examples/commands/', import.meta.url);
		await Deno.mkdir(commands, { recursive: true });
		const evidence = await Deno.makeTempDir({ dir: fileURLToPath(commands), prefix: 'command-' });
		await Deno.writeFile(`${evidence}/stdout.log`, output.stdout);
		await Deno.writeFile(`${evidence}/stderr.log`, output.stderr);
		await Deno.writeTextFile(
			`${evidence}/result.json`,
			JSON.stringify(
				{
					document: path.href,
					args,
					code: output.code,
					signal: output.signal,
				},
				null,
				2,
			) + '\n',
		);
		if (!output.success) {
			throw new Error(`${path.pathname}: deno ${args[0]} failed:\n${new TextDecoder().decode(output.stderr)}`);
		}
		return new TextDecoder().decode(output.stdout);
	} finally {
		clearTimeout(timeout);
	}
}

if (import.meta.main) console.log(`${await checkExamples()} complete README examples compiled and ran.`);
