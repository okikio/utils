/** A child pauses at real filesystem boundaries so its parent can simulate process death, not power loss. */
import { write } from '../file.ts';

const [path, phase] = Deno.args;
if (path === undefined) throw new TypeError('Expected an owned fixture path.');
/** Publish a checkpoint only after the preceding real host operations completed. */
async function pause(): Promise<never> {
	await Deno.stdout.write(new TextEncoder().encode('ready\n'));
	return await new Promise<never>(() => {});
}
const originalSync = Deno.FsFile.prototype.sync;
Deno.FsFile.prototype.sync = async function (): Promise<void> {
	if (phase === 'before-sync') await pause();
	await originalSync.call(this);
};
const originalRename = Deno.rename;
Deno.rename = async (from: string | URL, to: string | URL): Promise<void> => {
	if (phase === 'before-publish') await pause();
	await originalRename(from, to);
	if (phase === 'after-publish') await pause();
};
await write(path, 'new-complete', { durability: 'file' });
