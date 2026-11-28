/** Isolated third-party probes: never import a candidate into production or the checks owner. @module */
import process from 'node:process';

const [moduleUrl, scenario] = process.argv.slice(2);
if (moduleUrl === undefined || scenario === undefined) throw new TypeError('Expected candidate URL and scenario.');

/** Only the focused dotenv export is admitted into this probe. */
interface DotenvType {
	parse(text: string): Record<string, string>;
}
/** Multipart entries own their body reader independently of the outer entry iterator. */
interface PartType {
	name: string;
	filename?: string;
	value: ReadableStream<Uint8Array>;
}
/** Match the actual inspected STD constructor; no nonexistent limit options are invented. */
interface MultipartType {
	FormDataDecoderStream: new (
		contentType: string,
		source: ReadableStream<Uint8Array>,
	) => { readable: ReadableStream<PartType> };
}

let stage: 'import' | 'probe' = 'import';
// Keep blocked protocol waits alive until the parent watchdog kills and joins this process.
const keepAlive = setInterval(() => {}, 1000);
try {
	let result: unknown;
	if (scenario.startsWith('dotenv')) {
		const candidate = await import(moduleUrl) as DotenvType;
		stage = 'probe';
		if (scenario === 'dotenv-basic') {
			const parsed = candidate.parse('A=one\nB="two\\nthree"\nexport C=\'literal $A\'\nA=last\n__proto__=inert\n');
			result = {
				grammar: parsed.A === 'last' && parsed.B === 'two\nthree' && parsed.C === 'literal $A',
				inert: Object.getPrototypeOf(parsed) === null && Object.hasOwn(parsed, '__proto__'),
			};
		} else if (scenario === 'dotenv-missing' || scenario === 'dotenv-ambient') {
			const parsed = candidate.parse('A=$UTILS_TEST_SECRET');
			result = { ambientRead: parsed.A === 'host-secret' };
		} else if (scenario === 'dotenv-cycle') result = candidate.parse('A=$B\nB=$A');
		else if (scenario === 'dotenv-large') {
			result = { acceptedBytes: candidate.parse('A=' + 'x'.repeat(1024 * 1024)).A?.length };
		} else throw new TypeError('Unknown dotenv scenario.');
	} else {
		const candidate = await import(moduleUrl) as MultipartType;
		stage = 'probe';
		const encoder = new TextEncoder();
		const fixture = '--q\r\nContent-Disposition: form-data; name="field"\r\n\r\nhello\r\n--q--\r\n';
		/** A pull-driven finite source preserves every selected chunk boundary. */
		const source = function (text: string, split: number): ReadableStream<Uint8Array> {
			const bytes = encoder.encode(text);
			let position = 0;
			return new ReadableStream({
				pull(controller) {
					if (position === bytes.length) {
						controller.close();
						return;
					}
					const end = position === 0 ? Math.min(split, bytes.length) : bytes.length;
					controller.enqueue(bytes.slice(position, end));
					position = end;
				},
			}, { highWaterMark: 0 });
		};
		/** Always consume each part before requesting another; this is the candidate's required protocol. */
		const decode = async function (
			text: string,
			split = encoder.encode(text).length,
		): Promise<readonly { name: string; value: string }[]> {
			const output: { name: string; value: string }[] = [];
			for await (
				const entry of new candidate.FormDataDecoderStream('multipart/form-data; boundary=q', source(text, split))
					.readable
			) output.push({ name: entry.name, value: await new Response(entry.value).text() });
			return output;
		};
		if (scenario === 'multipart-splits') {
			let splits = 0;
			for (let split = 1; split < encoder.encode(fixture).length; split++) {
				const decoded = await decode(fixture, split);
				if (decoded.length !== 1 || decoded[0]?.name !== 'field' || decoded[0]?.value !== 'hello') {
					throw new Error('Split oracle failed.');
				}
				splits++;
			}
			result = { splits };
		} else if (scenario === 'multipart-lowercase') {
			result = {
				accepted: (await decode(fixture.replace('Content-Disposition', 'content-disposition')))[0]?.value === 'hello',
			};
		} else if (scenario === 'multipart-quoted') {
			result = { exactName: (await decode(fixture.replace('name="field"', 'name="a=b"')))[0]?.name === 'a=b' };
		} else if (scenario === 'multipart-prefix') {
			result = {
				exactBody:
					(await decode(fixture.replace('hello', 'hello\r\n--qX\r\nworld')))[0]?.value === 'hello\r\n--qX\r\nworld',
			};
		} else if (scenario === 'multipart-truncated') {
			result = { accepted: (await decode(fixture.slice(0, fixture.indexOf('hello') + 5))).length > 0 };
		} else if (scenario === 'multipart-large') {
			result = { acceptedBytes: (await decode(fixture.replace('hello', 'x'.repeat(1024 * 1024))))[0]?.value.length };
		} else if (scenario === 'multipart-abandon' || scenario === 'multipart-cancel') {
			let supplied = false;
			let cancelled = 0;
			const input = new ReadableStream<Uint8Array>({
				pull(controller) {
					if (!supplied) {
						supplied = true;
						controller.enqueue(encoder.encode(fixture));
					}
				},
				cancel() {
					cancelled++;
				},
			}, { highWaterMark: 0 });
			const outer = new candidate.FormDataDecoderStream('multipart/form-data; boundary=q', input).readable.getReader();
			const first = await outer.read();
			if (scenario === 'multipart-cancel') await first.value?.value.cancel('part skipped');
			await outer.cancel('outer abandoned');
			outer.releaseLock();
			for (let turn = 0; turn < 10; turn++) await Promise.resolve();
			result = { sourceCancelled: cancelled > 0, sourceLocked: input.locked };
		} else throw new TypeError('Unknown multipart scenario.');
	}
	console.log(JSON.stringify({ status: 'returned', result }));
} catch (error) {
	// Candidate diagnostics can contain supplied secrets. Only classify the error here.
	console.log(
		JSON.stringify({ status: 'threw', stage, errorName: error instanceof Error ? error.name : typeof error }),
	);
} finally {
	clearInterval(keepAlive);
}
