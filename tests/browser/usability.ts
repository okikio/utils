/** Real browser consumer flows for collected values, shared state and optional feedback. @module */
import { clipboard, commands, feedback, files, forms, gestures, text } from '@okikio/input';
import * as context from '@okikio/context';
import * as schema from '@okikio/schema';
import { ms } from '@okikio/duration';

/** Fail at the observed consumer contract instead of inspecting implementation details. */
function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

/** Verify native FormData successful controls, repeated fields, File identities and selected submitter. */
async function submittedValues(area: HTMLElement): Promise<string[]> {
	const form = document.createElement('form');
	form.innerHTML = '<input name="title" value="Field notes"><input name="tag" value="research">' +
		'<input name="tag" value="draft"><input name="omitted" disabled value="hidden">' +
		'<input type="checkbox" name="unchecked" value="no"><input type="file" name="attachment">' +
		'<button name="action" value="save">Save</button>';
	area.append(form);
	const control = form.querySelector<HTMLInputElement>('input[type=file]')!;
	const button = form.querySelector('button')!;
	const transfer = new DataTransfer();
	const file = new File(['one,two\n'], 'table.csv', { type: 'text/csv' });
	transfer.items.add(file);
	control.files = transfer.files;
	const collected = forms.read(form, { submitter: button });
	assert(collected.filter(([name]) => name === 'tag').length === 2, 'Repeated form entries were lost.');
	assert(
		!collected.some(([name]) => name === 'omitted' || name === 'unchecked'),
		'Native successful-control rules were replaced.',
	);
	assert(
		collected.some(([name, value]) => name === 'action' && value === 'save'),
		'The selected submitter was omitted.',
	);
	const attached = collected.find(([name]) => name === 'attachment')?.[1];
	assert(attached instanceof File && await attached.text() === 'one,two\n', 'The form lost its native File.');
	let submitted: SubmitEvent | undefined;
	using _submit = forms.listen(form, ({ event, entries }) => {
		submitted = event;
		assert(
			entries.some(([name, value]) => name === 'action' && value === 'save'),
			'Submission lost its native submitter.',
		);
	}, { preventDefault: true });
	form.requestSubmit(button);
	assert(
		submitted instanceof SubmitEvent && submitted.submitter === button && submitted.defaultPrevented,
		'Native submission was not delivered with explicit default ownership.',
	);
	let selected: readonly File[] = [];
	using _files = files.listen(control, ({ files: values, event }) => {
		assert(event instanceof Event, 'File collection replaced its original Event.');
		selected = values;
	}, { accept: ['.csv'], maxCount: 1, maxBytes: 128 });
	control.dispatchEvent(new Event('change', { bubbles: true }));
	assert(selected[0] === file, 'File selection copied or replaced a borrowed File.');
	return [
		'native form controls, repeated values, submitter and File bodies',
		'file-control selection preserves native File identity',
	];
}

/** One committed edit drives a typed command and a read-only observable progress view. */
async function editing(area: HTMLElement): Promise<string[]> {
	const editor = document.createElement('textarea');
	area.append(editor);
	await using operation = context.create({ id: 'browser-edit' });
	using state = context.state.create({ title: '' });
	const reader = context.view(operation, { draft: state.reader });
	const observations: string[] = [];
	using _observe = reader.draft.changes.subscribe(({ value }) => observations.push(value.title));
	const Rename = commands.define({ id: 'rename', label: 'Rename', invoke: (title: string) => state.set({ title }) });
	using binding = text.listen(editor, ({ value, event }) => {
		assert(event instanceof Event, 'Native text editing lost its source event.');
		commands.run(Rename, value);
	}, { signal: operation.signal });
	editor.dispatchEvent(new CompositionEvent('compositionstart'));
	editor.value = 'n';
	editor.dispatchEvent(new InputEvent('input', { data: 'n', isComposing: true }));
	assert(observations.length === 0, 'Intermediate composition was committed by default.');
	editor.value = 'ñ';
	editor.dispatchEvent(new CompositionEvent('compositionend', { data: 'ñ' }));
	editor.dispatchEvent(new InputEvent('input', { data: 'ñ', isComposing: false }));
	assert(JSON.stringify(observations) === '["ñ"]', 'Composition completion and final input were duplicated.');
	context.cancel(operation, 'panel closed');
	editor.value = 'too late';
	editor.dispatchEvent(new InputEvent('input', { data: 'too late' }));
	assert(binding.closed && reader.draft.get().title === 'ñ', 'Canceled editing changed shared state.');
	return [
		'native composition events produce one committed change',
		'text command and Context observable state share cancellation',
	];
}

/** Snapshot the native event data store synchronously, without interpreting HTML. */
function pastedValues(area: HTMLElement): string[] {
	const transfer = new DataTransfer();
	transfer.setData('text/plain', 'Pasted text');
	transfer.setData('text/html', '<b>Untrusted source</b>');
	const attachment = new File(['pasted'], 'paste.txt', { type: 'text/plain' });
	transfer.items.add(attachment);
	let observed = false;
	using _paste = clipboard.listen(area, (value) => {
		assert(value.event instanceof ClipboardEvent, 'Paste lost its native event.');
		assert(
			value.text === 'Pasted text' && value.html === '<b>Untrusted source</b>',
			'Clipboard values were interpreted or discarded.',
		);
		assert(value.files[0] === attachment, 'Clipboard attachment identity changed.');
		observed = true;
	}, { preventDefault: true });
	const event = new ClipboardEvent('paste', { clipboardData: transfer, cancelable: true });
	area.dispatchEvent(event);
	assert(observed && event.defaultPrevented, 'Native paste callback did not own its explicitly selected default.');
	return ['native ClipboardEvent snapshots text, source HTML and borrowed files'];
}

/** The test browser grants clipboard permission explicitly; native Blob values stay unwrapped. */
async function clipboardAccess(): Promise<string[]> {
	const source = 'Utility clipboard consumer';
	await clipboard.write(navigator.clipboard, source);
	assert(
		await clipboard.read(navigator.clipboard) === source,
		'Native asynchronous clipboard text did not round-trip.',
	);
	const items = await clipboard.readItems(navigator.clipboard);
	const item = items.find((value) => value.types.includes('text/plain'));
	assert(
		item !== undefined && await (await item.getType('text/plain')).text() === source,
		'Rich clipboard items lost their native MIME/Blob contract.',
	);
	return ['permission-granted native clipboard text and rich Blob reads'];
}

/** Exercise SVG contact geometry using actual PointerEvent objects; hardware gesture delivery is a separate concern. */
function geometricInput(area: HTMLElement): string[] {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	area.append(svg);
	const samples: Array<{ scale: number; rotation: number }> = [];
	using _transform = gestures.transform(svg, (value) => {
		assert(value.event instanceof PointerEvent, 'SVG transform lost its native pointer event.');
		if (value.phase === 'move') samples.push(value);
	});
	const event = (type: string, id: number, x: number, y: number) =>
		svg.dispatchEvent(
			new PointerEvent(type, {
				pointerId: id,
				pointerType: 'touch',
				clientX: x,
				clientY: y,
				pressure: 0.5,
				bubbles: true,
			}),
		);
	event('pointerdown', 1, 0, 0);
	event('pointerdown', 2, 10, 0);
	event('pointermove', 2, 0, 20);
	event('pointerup', 2, 0, 20);
	assert(
		samples.some((sample) => sample.scale === 2 && sample.rotation === 90),
		'Pinch scale and rotation were not geometric.',
	);
	return ['native SVG pointer geometry carries scale and rotation'];
}

/** Native animations release their effect and live-region updates preserve application ownership. */
async function visualFeedback(area: HTMLElement): Promise<string[]> {
	const panel = document.createElement('div');
	panel.style.filter = 'contrast(1.2)';
	panel.textContent = 'Ready';
	area.append(panel);
	const played = await feedback.brightness(panel, 1.1, { duration: ms(1), reducedMotion: false });
	assert(
		played.status === 'completed' && panel.getAnimations().length === 0,
		'Completed native animation retained its effect.',
	);
	assert(panel.style.filter === 'contrast(1.2)', 'Feedback overwrote pre-existing inline styling.');
	const controller = new AbortController();
	const playing = feedback.rotate(panel, 8, { duration: ms(1000), signal: controller.signal, reducedMotion: false });
	const settled = Promise.allSettled([playing]);
	controller.abort(null);
	const [canceled] = await settled;
	assert(
		canceled.status === 'rejected' && canceled.reason === null && panel.getAnimations().length === 0,
		'Native animation cancellation lost its reason or resource.',
	);
	const reduced = await feedback.light(panel, { reducedMotion: true });
	assert(
		reduced.status === 'unavailable' && reduced.reason === 'reduced-motion' && panel.getAnimations().length === 0,
		'Reduced motion allocated an animation.',
	);
	const status = feedback.announcer(panel);
	status.announce('<b>Saved</b>');
	assert(
		panel.textContent === '<b>Saved</b>' && panel.children.length === 0,
		'A live-region message was parsed as markup.',
	);
	status.dispose();
	assert(
		panel.textContent?.toString() === 'Ready' && !panel.hasAttribute('aria-live'),
		'Live-region ownership was not restored.',
	);
	return [
		'real Web Animation completion, cancellation and restored styling',
		'reduced-motion outcome and native plain-text live region',
	];
}

/** After the runner's real mouse interaction, the browser permits application-owned AudioContext activation. */
async function audioFeedback(): Promise<string[]> {
	const audio = new AudioContext();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			audio.resume(),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => reject(new Error('Native audio activation did not settle.')), 5000);
			}),
		]);
		const outcome = await feedback.tone(audio, { duration: ms(20), gain: 0.001, signal: AbortSignal.timeout(5000) });
		assert(
			outcome.status === 'completed' && audio.state === 'running',
			'Audio cue did not complete or closed its borrowed context.',
		);
		return ['native AudioContext scheduled source ends without closing its borrowed context'];
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
		await audio.close();
	}
}

/** Run complete native consumer flows against either source or installed package imports. */
export async function verify(): Promise<readonly string[]> {
	const area = document.createElement('section');
	document.body.append(area);
	try {
		const result = await forms.validate(schema.object({ name: schema.string() }), [['name', 'Ada']]);
		assert(!result.issues && result.value.name === 'Ada', 'Input and Schema do not share their validation contract.');
		return [
			...await submittedValues(area),
			...await editing(area),
			...pastedValues(area),
			...geometricInput(area),
			...await clipboardAccess(),
			...await visualFeedback(area),
			...await audioFeedback(),
		];
	} finally {
		area.remove();
	}
}
