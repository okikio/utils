/** The shape of one compatibility case. @module */
import type { ContextType } from './check.ts';
import type { TablesType } from './schema.ts';

/** One behavior every client and server should share. Cases run in order and may read what earlier cases wrote. */
export interface CaseType {
	readonly name: string;
	/** Cases whose effects this one reads. When one did not pass, this case is reported as blocked, not run. */
	readonly after?: readonly string[];
	run(context: ContextType & { readonly t: TablesType }): Promise<void>;
}
