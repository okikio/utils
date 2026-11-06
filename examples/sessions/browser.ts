/** Reuse one actual browser cookie jar across actions; close each temporary page before the next action. */
import { chromium } from 'playwright';
import type { BrowserContext } from 'playwright';
import { AsyncDisposableStack } from '@okikio/dispose';
import * as resource from '@okikio/capability/resource';
import * as session from '@okikio/capability/resource/session';
import { openWebsite } from './website.ts';

/** Sign in on one page, then read the account on another page through the same retained browser context. */
export async function readProfile(): Promise<string> {
	await using website = await openWebsite();
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
		// A new context starts signed out. Launching Chromium alone does not establish a login.
		const before = await page.goto(`${website.url}/account`);
		if (before?.status() !== 401) throw new Error('A fresh profile should start signed out.');
		await page.goto(`${website.url}/login`);
		await page.getByRole('button', { name: 'Sign in as Ada' }).click();
		await page.waitForURL(`${website.url}/account`);
		// The website's response set a cookie. Closing this page leaves it in the context.
	});

	const account = await profiles.use(reference, async (profile, action) => {
		const page = await profile.newPage();
		action.defer(() => page.close());
		const response = await page.goto(`${website.url}/account`);
		if (response?.status() !== 200) throw new Error('The second action did not retain the login.');
		// Read what the page displays, rather than reading a cookie directly.
		return await page.getByRole('heading').innerText();
	});

	// Close joins both resource and temporary-page cleanup. The reference cannot reopen this login.
	await profiles.close(reference);
	return account;
}

if (import.meta.main) console.log(await readProfile());
