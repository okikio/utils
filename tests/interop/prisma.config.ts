/** `prisma generate` needs a configuration; the suite passes the real URL to each client it opens. */
import { defineConfig } from 'prisma/config';

export default defineConfig({
	schema: 'prisma/schema.prisma',
	datasource: { url: 'postgres://localhost/unused' },
});
