import { deepStrictEqual, equal } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nativeRequestMetadata } from '#fixtures/hono-contracts/native.ts';

describe('native Fetch observations used by HTTP comparison fixtures', () => {
	it('keeps host body metadata differences explicit', async () => {
		const textRequest = new Request('http://localhost', { method: 'POST', body: 'hello' });
		const textHeader = (textRequest.headers.get('content-type') ?? '').toLowerCase();
		await textRequest.arrayBuffer();
		const byteRequest = new Request('http://localhost', { method: 'POST', body: new Uint8Array([104, 105]) });
		const bytesBlobType = (await byteRequest.blob()).type;
		const byteResponse = new Response(new Uint8Array([104, 105]));
		equal((await byteResponse.blob()).type, nativeRequestMetadata.bytesBlobType);
		const blobRequest = new Request('http://localhost', {
			method: 'POST',
			body: new Blob(['{}'], { type: 'application/json' }),
		});
		const jsonBlobType = (await blobRequest.blob()).type;
		const form = new FormData();
		form.append('file', new File(['hello'], 't.txt', { type: 'text/plain' }));
		const formRequest = new Request('http://localhost', { method: 'POST', body: form });
		const file = (await formRequest.formData()).get('file');
		if (!(file instanceof File)) throw new Error('Native multipart must preserve the file.');
		deepStrictEqual({ textHeader, bytesBlobType, jsonBlobType, textFileType: file.type }, {
			textHeader: nativeRequestMetadata.textHeader,
			bytesBlobType: nativeRequestMetadata.bytesBlobType,
			jsonBlobType: nativeRequestMetadata.jsonBlobType,
			textFileType: nativeRequestMetadata.textFileType,
		});
	});

	it('records metadata unavailable at native construction before testing cloning', async () => {
		const raw = new Request('http://localhost', {
			method: 'POST',
			body: '{}',
			integrity: 'sha256-test',
			referrer: 'http://example.com',
			referrerPolicy: 'origin',
		});
		const copy = raw.clone();
		for (const request of [raw, copy]) {
			deepStrictEqual({
				integrity: request.integrity,
				referrer: request.referrer,
				referrerPolicy: request.referrerPolicy,
			}, {
				integrity: nativeRequestMetadata.integrity,
				referrer: nativeRequestMetadata.referrer,
				referrerPolicy: nativeRequestMetadata.postReferrerPolicy,
			});
		}
		await Promise.all([raw.arrayBuffer(), copy.arrayBuffer()]);
		const get = new Request('http://localhost', { referrerPolicy: 'no-referrer' });
		equal(get.referrerPolicy, nativeRequestMetadata.getReferrerPolicy);
		equal(get.clone().referrerPolicy, nativeRequestMetadata.getReferrerPolicy);
	});
});
