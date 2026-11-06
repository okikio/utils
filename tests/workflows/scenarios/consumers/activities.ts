/** Fixture writes use domain uniqueness, not an exactly-once claim about arbitrary SQL. @module */
import * as activity from '@okikio/activity';
import * as effect from '@okikio/capability/effect';
import * as task from '@okikio/task';
import { Analyze, Clean, Database, Notify, Write } from './contracts.ts';
import type { ActivityContext } from '@okikio/activity';

/** Show the commit-before-ack crash gap. A stable job ID prevents duplicate fixture writes. */
async function save(ctx: ActivityContext<typeof Write | typeof Analyze | typeof Clean | typeof Notify>) {
	const { sql, namespace } = await ctx.get(Database);
	const input = ctx.input;
	await sql`insert into consumer_writes(namespace,job,source,label,batch,pid) values (${namespace},${ctx.jobId},${input.source},${input.label},${input.batch},${Deno.pid}) on conflict(namespace,job) do nothing`;
	await effect.emit(ctx, task.ProgressEffect, { completed: input.batch, message: input.label });
	if (input.gate && (input.label === 'inner' || input.label === 'first')) {
		while (
			!(await sql`select opened from consumer_gates where namespace=${namespace} and name=${input.gate}`)[0]?.opened
		) {
			await ctx.clock.sleep(20, ctx.signal);
		}
	}
	if (
		input.source === 'repair' && input.label === 'inner' &&
		!(await sql`select opened from consumer_gates where namespace=${namespace} and name='repair'`)[0]?.opened
	) throw new Error('Cleanup destination unavailable.');
	return { value: input.batch };
}
export const write = activity.implement(Write, { run: save });
export const analyze = activity.implement(Analyze, { run: save });
export const clean = activity.implement(Clean, { run: save });
export const notify = activity.implement(Notify, { run: save });
