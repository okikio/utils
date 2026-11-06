/** Literal native-host observations, independently checked in http-native.test.ts. @module */

// Bun 1.4.2 does not implement these Fetch metadata details like Node/Deno/browser hosts.
// Keep the differences visible instead of normalizing candidate results into standards compliance.
const bun = 'Bun' in globalThis;

export const nativeRequestMetadata = {
	textHeader: bun ? '' : 'text/plain;charset=utf-8',
	bytesBlobType: bun ? 'text/plain;charset=utf-8' : '',
	jsonBlobType: bun ? 'application/json;charset=utf-8' : 'application/json',
	textFileType: bun ? 'text/plain;charset=utf-8' : 'text/plain',
	integrity: bun ? '' : 'sha256-test',
	referrer: bun ? '' : 'http://example.com/',
	postReferrerPolicy: bun ? '' : 'origin',
	getReferrerPolicy: bun ? '' : 'no-referrer',
} as const;
