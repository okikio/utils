/** Raw SQL through a Prisma 7 client with any driver adapter, shared by the Prisma clients. @module */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CompiledType, Executor, IsolationType } from '@okikio/sql/postgres';
import { port } from '../types.ts';

/** Files read at run time that imports alone do not show: the schema the client is generated from. */
export const inputs: readonly string[] = ['../../prisma/schema.prisma', '../../prisma.config.ts'];

/** npm packages the generated client loads, which no import here shows. */
export const packages: readonly string[] = ['@prisma/client'];

type Rows = readonly Record<string, unknown>[];

/** Generate the Prisma client once; it only exists to run raw SQL. */
function prismaClient(): Promise<
	{ PrismaClient: new (options: unknown) => unknown }
> {
	const root = new URL('../../', import.meta.url);
	if (!existsSync(new URL('.prisma/client.ts', root))) {
		execFileSync(process.execPath, [
			'node_modules/prisma/build/index.js',
			'generate',
		], {
			cwd: fileURLToPath(root),
			stdio: 'ignore',
		});
	}
	return import(new URL('.prisma/client.ts', root).href);
}

const prismaLevels: Readonly<Record<IsolationType, string>> = {
	'read committed': 'ReadCommitted',
	'repeatable read': 'RepeatableRead',
	serializable: 'Serializable',
};

/** Raw SQL through a Prisma client with any driver adapter. */
export async function prisma(adapter: unknown) {
	const { PrismaClient } = await prismaClient();
	type Raw = {
		$queryRawUnsafe(text: string, ...values: unknown[]): Promise<Rows>;
	};
	type Client = Raw & {
		$transaction<T>(
			work: (tx: Raw) => Promise<T>,
			options?: { isolationLevel?: string },
		): Promise<T>;
		$disconnect(): Promise<void>;
	};
	const client = new PrismaClient({ adapter }) as Client;
	const run = (target: Raw) => (query: CompiledType) => target.$queryRawUnsafe(query.text, ...query.values);
	const db = port(
		run(client),
		(work, options) =>
			client.$transaction(
				(tx) => work({ run: run(tx) } as Executor),
				options?.isolation ? { isolationLevel: prismaLevels[options.isolation] } : undefined,
			),
	);
	return { db, close: () => client.$disconnect() };
}
