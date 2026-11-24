/** What a server target is and what a started one offers. @module */
import pg from 'pg';

/** How clients reach a started target. */
export interface StartedType {
	/** A wire-protocol URL, for targets that accept PostgreSQL connections. */
	readonly url?: string;
	/** HTTP and WebSocket endpoints for Neon's serverless driver, and the connection string it sends to them. */
	readonly neon?: {
		readonly http: string;
		readonly ws: string;
		readonly connection: string;
	};
	/** True for a database inside this process, which only an in-process client can reach. */
	readonly embedded?: boolean;
	/** The target's flavor, so a client can pick its own CockroachDB dialect, as knex does. */
	readonly flavor?: 'cockroach';
	/** The server version string, for the report. */
	readonly version: string;
	stop(): Promise<void>;
}

/** A PostgreSQL-compatible server, pooler or proxy that the suite starts and stops. */
export interface TargetType {
	readonly name: string;
	/** One line for the report: what this target is and how it is configured. */
	readonly about: string;
	readonly kind:
		| 'postgres'
		| 'distribution'
		| 'pooler'
		| 'serverless'
		| 'distributed'
		| 'embedded';
	/** The types module it needs, when not PostgreSQL's. */
	readonly flavor?: 'cockroach';
	/** The images it starts, from `images.ts`, so CI can store them and key results on their digests. */
	readonly images: readonly string[];
	/** How clients reach it once started. Defaults to a wire-protocol URL. */
	readonly reach?: 'url' | 'neon' | 'embedded';
	start(): Promise<StartedType>;
}

/** Wait until a server answers `select version()`, retrying while it starts. Returns the version. */
export async function ready(url: string, timeoutMs = 120_000): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let last: unknown;
	while (Date.now() < deadline) {
		const client = new pg.Client({
			connectionString: url,
			connectionTimeoutMillis: 5000,
		});
		try {
			await client.connect();
			const { rows } = await client.query<{ version: string }>(
				'select version()',
			);
			return rows[0]!.version;
		} catch (error) {
			last = error;
			await new Promise((resolve) => setTimeout(resolve, 1000));
		} finally {
			await client.end().catch(() => {});
		}
	}
	throw new Error(
		`Server at ${new URL(url).host} was not ready: ${(last as Error | undefined)?.message}`,
	);
}
