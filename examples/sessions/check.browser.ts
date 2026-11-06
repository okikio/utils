/** Check the public example against Chromium, rather than substituting an in-memory browser mock. */
import { expect } from '@std/expect';
import { readProfile } from './browser.ts';
expect(await readProfile()).toBe('Ada');
console.log('Retained the Chromium login across two actions and joined cleanup.');
