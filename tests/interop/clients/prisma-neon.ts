/** The `prisma-neon` client. @module */
import { neonDriver } from './shared/neon.ts';
import { prisma } from './shared/prisma.ts';
import { type ClientType } from './types.ts';

export const client: ClientType = {
	name: 'prisma-neon',
	about: 'Prisma 7 with `@prisma/adapter-neon` over WebSockets, through `$queryRawUnsafe`.',
	reach: 'neon',
	runtime: 'node',
	async open(started) {
		const { connection } = await neonDriver(started);
		const { PrismaNeon } = await import('@prisma/adapter-neon');
		return await prisma(new PrismaNeon({ connectionString: connection }));
	},
};
