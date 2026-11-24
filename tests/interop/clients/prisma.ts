/** The `prisma` client. @module */
import { prisma } from './shared/prisma.ts';
import { type ClientType, urlOf } from './types.ts';

export const client: ClientType = {
	name: 'prisma',
	about: 'Prisma 7 with `@prisma/adapter-pg`, through `$queryRawUnsafe`.',
	reach: 'url',
	runtime: 'node',
	async open(started) {
		const { PrismaPg } = await import('@prisma/adapter-pg');
		return await prisma(new PrismaPg({ connectionString: urlOf(started) }));
	},
};
