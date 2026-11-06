# Collect values without losing their meaning

Input supplies collection rules and ownership. Your application chooses which data to accept and what to do with it.
Start with a native text input or form when those controls express the interaction. They already support focus, keyboard
editing, assistive technology, mobile keyboards and browser autofill.

## Preview one contact import from a real form

The form keeps native editing, focus and file selection. Save a local `contacts.csv` containing
`Name,Email` and a following row `Ada,ada@example.com`. Type an import label, select both tags, choose that file and
submit. The status should show the label, `1 contacts` and both tags. A file larger than 64 KiB or more than 100 data
rows reports an error instead of showing a partial successful preview. This preview reads a bounded complete file;
use CSV's streaming API when even that retained text would be too large.

Prepare the checkout from its root with `mise trust`, `mise install` and `mise run prepare -- --kind deps` after reviewing
`mise.toml`. Save the HTML as `contact-import.html` and TypeScript as `contact-import.ts`.

```html
<!doctype html>
<meta charset="utf-8">
<title>Import contacts</title>
<form id="import">
 <label>Import label <input id="label" name="label" required value="Contacts"></label>
 <label><input type="checkbox" name="tags" value="customers" checked> Customers</label>
 <label><input type="checkbox" name="tags" value="newsletter"> Newsletter</label>
 <label>CSV file <input type="file" name="report" accept=".csv" required></label>
 <button>Preview contacts</button>
</form>
<p id="preview" role="status"></p>
<script type="module" src="./contact-import.js"></script>
```

```ts support=contact-import.ts
import * as text from '@okikio/input/text';
import * as forms from '@okikio/input/forms';
import * as files from '@okikio/input/files';
import * as csv from '@okikio/format/csv';
const form = document.querySelector<HTMLFormElement>('#import')!;
const label = document.querySelector<HTMLInputElement>('#label')!;
const preview = document.querySelector<HTMLElement>('#preview')!;
const screen = new AbortController();
const stopText = text.listen(label, ({ value }) => {
	preview.textContent = `Ready to import ${value}`;
});
// Read a bounded selection, then check ownership again after the asynchronous file read.
const stopForm = forms.listen(form, async ({ entries }) => {
	const values = forms.object(entries, { multiple: ['tags'] });
	const report = entries.find(([name]) => name === 'report')?.[1];
	if (!(report instanceof File) || report.size === 0) throw new Error('Choose a nonempty CSV file.');
	const selected = files.from([report], { accept: ['.csv'], maxCount: 1, maxBytes: 64 * 1024 });
	const contents = await selected[0]!.text();
	// The screen may have closed during File.text(). Do not publish a preview into its retired view.
	if (screen.signal.aborted) return;
	const parsed = csv.parse(contents, { headerRow: 1, maximumCharacters: 64 * 1024, maximumRows: 100 });
	preview.textContent = `${String(values.label)}: ${parsed.rows.length} contacts; tags ${JSON.stringify(values.tags)}`;
}, {
	preventDefault: true,
	maxEntries: 16,
	signal: screen.signal,
	onError: (error) => {
		preview.textContent = error instanceof Error ? error.message : 'Import failed';
	},
});
function close(): void {
	screen.abort();
	stopForm();
	stopText();
}
window.addEventListener('pagehide', close, { once: true });
```

The browser loads the `.js` file named by the HTML script tag. The bundle command turns the TypeScript module and its
imports into that JavaScript file. The local HTTP server then serves the HTML and JavaScript to your browser.
Run these commands from the repository root:

```sh
mise exec -- deno bundle --platform browser contact-import.ts -o contact-import.js
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/contact-import.html`. Keep the server terminal open; stop it with Ctrl+C when finished.
After TypeScript edits, rebuild the bundle and refresh the browser. The HTTP server serves this checkout locally; do not
expose it on a public address. The module owns its listeners and releases them on page exit. In an application, call its
teardown when removing the screen instead. The browser interaction is separate from the portable example checks below.

## Observe text after composition commits

`text.listen()` reads the initial value but emits only changes. The default ignores intermediate IME text and emits the
committed value once, including when a final `input` follows `compositionend`. Set `composition: 'include'` when a
preview needs intermediate text; each change reports `composing`.

This mount function works with a native text field. Returning teardown keeps the binding alive for the component's
actual lifetime.

```ts support=text-search.ts
import * as text from '@okikio/input/text';

export function mountSearch(field: HTMLInputElement, show: (value: string) => void): () => void {
	const stop = text.listen(field, ({ value, inputType }) => {
		show(value);
		if (inputType === 'insertFromPaste') field.dataset.lastEdit = 'paste';
	});
	return () => stop();
}
```

`text.read(field)` reads its current string. Assigning `.value` programmatically does not manufacture a user edit. For a
custom editor, supply `read: (editor) => editor.getText()` while the editor exposes listener methods. Input will not
guess a rich editor's internal document. `event: 'change'` uses the native commit event rather than every live edit.

Keyboard shortcuts are separate from text editing. Speech, paste, autofill, IME and accessibility tools can change text
without expressing it as one keydown per character. This distinction follows
[Input Events](https://www.w3.org/TR/input-events-2/).

## Preserve form entries before choosing a schema

`forms.read(form, { submitter })` returns ordered `[name, value]` entries from the native FormData algorithm. Disabled
controls and unchecked boxes follow browser submission semantics. A named submit button contributes its value. The same
function accepts an existing FormData or an entry iterable. A structural form implements `read(submitter)` and listener
methods. Native form iteration yields controls, so the adapter deliberately selects FormData before treating an object
as an entry iterable. See
[HTML form submission](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html).

Use `forms.object(entries, { multiple: ['tags'] })` when a validator expects an object. That policy produces an array
for `tags` even if one value is present, and an empty array if the field is absent. Other duplicate names become arrays
by default. Select `duplicates: 'reject'`, `'first'` or `'last'` only when that is the application's intended rule.
Special names such as `__proto__` remain own data properties and cannot alter an object's prototype.

`forms.validate(ProfileSchema, source, options)` applies that projection and returns Schema's existing `{ value }` or
`{ issues }` result. It does not create a competing issue format. Owned schemas can coerce numbers deliberately and
select `unknownKeys: 'preserve'` or `'strip'` for evolving external data. Input retains the File object yielded by the
source; it never silently reads or stringifies it. A host may allocate a fresh File wrapper when its FormData is read.
The [package quick start](../../packages/input/README.md) is a complete executable example.

When listening to a real form, opt into preventing native submission if JavaScript will perform the save:

```ts support=form-submit.ts
import * as forms from '@okikio/input/forms';

export function mountForm(
	form: HTMLFormElement,
	save: (entries: readonly forms.Entry<string | File>[], signal: AbortSignal) => Promise<void>,
	report: (error: unknown) => void,
): () => void {
	const screen = new AbortController();
	const stop = forms.listen(form, ({ entries }) => save(entries, screen.signal), {
		signal: screen.signal,
		preventDefault: true,
		onError: report,
	});
	return () => {
		screen.abort();
		stop();
	};
}
```

While the returned save Promise is pending, another submit is ignored by default and no queue grows. Set
`pending: 'allow'` to admit overlapping submissions deliberately. Aborting the binding releases its listener; the save
receives that same signal because an ordinary Promise is not automatically cancellable. `maxEntries` defaults to 4096,
including repeated names. Exceeding it rejects the snapshot before the callback receives partial entries.

## Accept files from controls, drops or an explicit picker

`files.from(fileList, options)` checks metadata and copies only the list of references. Native File methods such as
`arrayBuffer`, `stream` and `text` remain available. `files.listen(fileInput, callback, options)` supplies the same
selection on `change`; `files.drop(target, callback, options)` snapshots a file drop before its native data store
becomes protected. A drop callback receives `{ files, event }`; optional `hover(active)` feedback is released once on
drop, leave, abort or disposal. Non-file drags remain unclaimed. Drag store timing follows
[HTML drag and drop](https://html.spec.whatwg.org/multipage/dnd.html).

```ts runnable=input-file-policy.ts
import * as files from '@okikio/input/files';

const report = new File(['name\nAda\n'], 'report.csv', { type: 'text/csv' });
const selected = files.from([report], { accept: ['.csv'], maxCount: 2, maxBytes: 1024 });
console.log(selected[0] === report);
console.log(await selected[0]!.text());
```

```text output
true
name
Ada
```

Defaults are 128 files and 256 MiB of metadata-reported total size. An unacceptable file rejects the complete selection
with `SelectionError`; `reason` is `count`, `bytes` or `type`. `accept` supports MIME types, MIME families and
extensions. It is a convenience policy, not proof of file contents. No body is read during collection.

`await files.pick(window, options)` preserves native File types and uses the optional `showOpenFilePicker` capability
where available. Call it from the user action that authorizes a picker. Browsers without that method receive a TypeError
and can use a normal file control and `files.listen`; the package does not create a hidden dialog fallback. The signal
can stop waiting and reject late delivery. It cannot guarantee dismissal of the operating-system picker. User
cancellation or denial retains the host's original error.

This browser module can be called by an application's file-selection button. The regular Window type is sufficient; the
result retains File content methods without a cast or a global declaration for the optional picker API.

```ts support=file-picker.ts
import * as files from '@okikio/input/files';

export async function selectReports(signal: AbortSignal): Promise<readonly File[]> {
	return await files.pick(window, { multiple: true, accept: ['.csv'], maxCount: 4, signal });
}
```

## Clipboard operations and paste are different sources

`clipboard.read(navigator.clipboard)` reads text. `readItems()` keeps rich native ClipboardItems so the application can
choose a MIME type with `getType()`. `write()` accepts text or caller-created items. These functions always return
Promises, including unsupported-host and pre-aborted failures. They preserve permission-denial objects and do not
silently fall back to deprecated selection tricks. A signal stops waiting; it cannot undo an accepted write.

`clipboard.listen(target, callback)` instead observes the user's paste event. It copies `text`, `html` and file
references during dispatch. You may await work in the callback without reading an expired DataTransfer afterward. Native
insertion stays enabled unless `preventDefault: true` explicitly transfers insertion to the application. Copied HTML is
untrusted source and is not parsed or inserted by Input. Native ClipboardEvent and File types remain available to native
target consumers. The [Clipboard specification](https://www.w3.org/TR/clipboard-apis/) explains why event-based and
asynchronous clipboard access have different authorization and timing.

Next: [actions, gestures and gamepads](./02-interaction.md), or [observation and cleanup](./04-observation.md).

## Edit a selected contact note without splitting text

Select `Ada` in the textarea and click the button. The note becomes `Hello Grace` and the status says
`edited: Hello Grace`. A native selection uses UTF-16 positions; this operation rejects a range that splits a Unicode
surrogate pair and a result longer than 100 code units. An active composition is blocked. It does not synthesize input
or change events, claim browser undo behavior, or select user-perceived grapheme clusters for you.

Prepare the checkout from its root with `mise trust`, `mise install` and `mise run prepare -- --kind deps` after reviewing
`mise.toml`. Save the HTML as `contact-edit.html` and TypeScript as `contact-edit.ts`.

```html
<!doctype html>
<meta charset="utf-8">
<title>Edit contact note</title>
<label>Note <textarea id="note">Hello Ada</textarea></label>
<button id="insert">Replace selected text with contact name</button>
<p id="status" role="status"></p>
<script type="module" src="contact-edit.js"></script>
```

```ts support=contact-edit.ts
import * as text from '@okikio/input/text';
const note = document.querySelector<HTMLTextAreaElement>('#note')!;
const button = document.querySelector<HTMLButtonElement>('#insert')!;
const status = document.querySelector<HTMLElement>('#status')!;
let composing = false;
const start = () => {
	composing = true;
};
const end = () => {
	composing = false;
};
function insert(): void {
	try {
		const result = text.edit(note, { start: note.selectionStart, end: note.selectionEnd }, 'Grace', {
			composing,
			selection: 'select',
			maximumLength: 100,
		});
		status.textContent = `${result.status}: ${note.value}`;
	} catch (error) {
		status.textContent = error instanceof Error ? error.message : 'Edit failed';
	}
}
note.addEventListener('compositionstart', start);
note.addEventListener('compositionend', end);
button.addEventListener('click', insert);
function close(): void {
	note.removeEventListener('compositionstart', start);
	note.removeEventListener('compositionend', end);
	button.removeEventListener('click', insert);
}
window.addEventListener('pagehide', close, { once: true });
```

Bundle and serve those files from the repository root:

```sh
mise exec -- deno bundle --platform browser contact-edit.ts -o contact-edit.js
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/contact-edit.html`. Keep the server terminal open; stop it with Ctrl+C when finished.
After TypeScript edits, rebuild the bundle and refresh the browser. The HTTP server serves this checkout locally; do not
expose it on a public address. The module owns its listeners and releases them on page exit. In an application, call its
teardown when removing the screen instead. The browser interaction is separate from the portable example checks below.

## Choose rich clipboard content before reading it

A pasted contact card may offer HTML and plain text. Choose the allowed representation before reading any Blob.
This complete metadata example runs as `clipboard-choice.ts` with `mise exec -- deno run clipboard-choice.ts`.
It supplies a local item, not a browser permission or user-activation claim.

```ts runnable=clipboard-choice.ts
import * as clipboard from '@okikio/input/clipboard';
let reads = 0;
const item = {
	types: ['text/html', 'text/plain'],
	async getType(type: string) {
		reads++;
		return new Blob([type === 'text/plain' ? 'Ada,ada@example.com' : '<b>Ada</b>'], { type });
	},
};
const selected = clipboard.select([item], { preferredTypes: ['text/plain'], maximumItems: 1, maximumTypes: 2 });
console.log(selected[0]?.type, reads);
const choice = selected[0]!;
console.log(await (await choice.item.getType(choice.type)).text(), reads);
```

```text output
text/plain 0
Ada,ada@example.com 1
```

Selection preserves the borrowed item identity and reads no body. Reading its chosen representation is a separate,
explicit action. A real browser calls `clipboard.attempt(navigator.clipboard, { maximumItems: 1 })` directly in a
user-initiated event, then handles `read`, `unsupported`, `denied` or `failed` before selection. It never retries a
permission denial automatically. Bounds on metadata do not bound a returned Blob's contents; inspect `blob.size` before
materializing text and pass it to a bounded stream parser for large content.

## Walk contact exports with explicit directory budgets

Directory access differs between browsers and operating systems, so the walker accepts an injected adapter. This
portable program demonstrates the actual walker with a supplied tree. It opens no picker and reads no file body. Save
as `contact-directory.ts` and run `mise exec -- deno run contact-directory.ts`.

```ts runnable=contact-directory.ts
import * as files from '@okikio/input/files';
interface Entry {
	name: string;
	kind: 'directory' | 'file';
	children?: Entry[];
}
const root: Entry = { name: 'contacts', kind: 'directory', children: [{ name: 'customers.csv', kind: 'file' }] };
let metadataReads = 0;
for await (
	const found of files.walk([root], {
		children: (entry) => entry.children ?? [],
		file: async (entry) => {
			metadataReads++;
			return new File(['Name,Email\nAda,ada@example.com\n'], entry.name);
		},
	}, { maximumDepth: 1, maximumEntries: 2, maximumFiles: 1, maximumBytes: 1024 })
) {
	console.log(found.path, found.file.name);
}
console.log('Metadata reads:', metadataReads);
```

```text output
contacts/customers.csv customers.csv
Metadata reads: 1
```

A directory counts toward `maximumEntries` even when empty. Lower that bound to 1 and traversal rejects rather than
silently truncating. Already yielded files remain partial output after a later failure. A real adapter maps native
handle enumeration to `children` and `getFile()` to `file`; the host still owns permissions, handles and containment.
Early loop exit requests release of every active ancestor iterator. An uncooperative host can keep cleanup pending;
retain `onCleanup`'s actual Promise when the owner must join it. A literal relative name is not authorization to write
under an arbitrary destination directory.
