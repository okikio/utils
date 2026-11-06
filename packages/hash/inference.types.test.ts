/** Public output selection and streaming ownership must remain visible in inference. */
import { digest } from './digest.ts';
import { digest as sync } from './sync.ts';
import { read } from './stream.ts';
import { create } from './blake.ts';

const bytes: Promise<Uint8Array> = digest('sha256', 'abc');
const hex: Promise<string> = digest('sha256', 'abc', 'hex');
const raw: Uint8Array = sync('sha384', 'abc');
const encoded: string = sync('sha512', 'abc', 'base64url');
void [bytes, hex, raw, encoded];
// @ts-expect-error Encoded output is text, not byte storage.
const wrong: Uint8Array = sync('sha256', 'abc', 'hex');
void wrong;
const source = new ReadableStream<Uint8Array>();
void read(() => create(), source, { maximumBytes: 10 });
// @ts-expect-error Every streaming operation needs an explicit byte bound.
void read('sha256', source, {});
// @ts-expect-error Legacy digest names are not part of the portable SHA-2 contract.
void digest('md5', 'abc');
