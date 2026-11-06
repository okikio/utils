/** Reuse one actual browser cookie jar across actions; close each temporary page before the next action. */
import { chromium } from 'playwright';
import type { BrowserContext } from 'playwright';
import { AsyncDisposableStack } from '@okikio/dispose';
import * as resource from '@okikio/capability/resource';
import * as session from '@okikio/capability/resource/session';

/** Run without an external website. The two actions share real Chromium cookies and separate pages. */
export async function readProfile(): Promise<string> {
	await using application = new AsyncDisposableStack();
	const browser = application.adopt(await chromium.launch(), (value) => value.close());

	// A browser context is an isolated cookie jar. Its definition names the value later actions borrow.
	const Profile = resource.define<BrowserContext>()({
		id: 'browser.profile',
		description: 'Retain one browser login.',
	});
	const ProfileLive = resource.implement(Profile, {
		async create({ ctx }) {
			// Adopt immediately: a later acquisition failure must still close this new browser context.
			return ctx.adopt(await browser.newContext(), (value) => value.close());
		},
	});
	// This scope retains browser contexts between actions. Local defaults own renewal, bounds and cleanup.
	await using profiles = await session.open(ProfileLive);
	const reference = await profiles.create();

	await profiles.use(reference, async (profile, action) => {
		const page = await profile.newPage();
		action.defer(() => page.close());
		await page.setContent('<h1>Account sign-in</h1>');
		// A real sign-in would set this cookie through its HTTP response. No credentials or network are needed here.
		await profile.addCookies([{ name: 'account', value: 'Ada', url: 'https://example.invalid/' }]);
	});

	const account = await profiles.use(reference, async (profile, action) => {
		const page = await profile.newPage();
		action.defer(() => page.close());
		await page.setContent('<h1>Account report</h1>');
		const cookie = (await profile.cookies('https://example.invalid/')).find((value) => value.name === 'account');
		if (!cookie) throw new Error('The second action did not retain the login.');
		return cookie.value;
	});

	// Close joins both resource and temporary-page cleanup. The reference cannot reopen this login.
	await profiles.close(reference);
	return account;
}

if (import.meta.main) console.log(await readProfile());
