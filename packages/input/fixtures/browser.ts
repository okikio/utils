/** Native browser checks used by the external browser runner, with no browser emulation layer. */
import { clipboard, commands, files, forms, keys, pointer, text } from '../mod.ts';
import * as codec from '@okikio/schema/codec';

/** Fail at the browser operation that violated its ownership contract. */
function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}

/** Exercise real DOM targets, shadow paths, editable modes, native event types and iframe realms. */
export async function verify(): Promise<readonly string[]> {
	const checks: string[] = [];
	const area = document.createElement('section');
	document.body.append(area);
	let calls = 0;
	const command = commands.define({
		id: 'next',
		label: 'Next',
		invoke(event: KeyboardEvent) {
			assert(event instanceof KeyboardEvent, 'Native event type was lost.');
			calls++;
		},
	});
	const stop = keys.listen(window, [{ run: command.invoke, key: 'j' }]);
	const press = (target: EventTarget, key = 'j'): KeyboardEvent => {
		const event = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true });
		target.dispatchEvent(event);
		return event;
	};
	try {
		assert(press(area).defaultPrevented && calls === 1, 'Native shortcut did not claim its key.');
		checks.push('native KeyboardEvent inference and dispatch');
		for (const mode of ['', 'plaintext-only', 'true']) {
			const editor = document.createElement('div');
			editor.setAttribute('contenteditable', mode);
			area.append(editor);
			assert(!press(editor).defaultPrevented, `Editable ${mode} lost native ownership.`);
			editor.remove();
		}
		checks.push('contenteditable empty, plaintext-only and true');
		const host = document.createElement('div');
		area.append(host);
		const shadow = host.attachShadow({ mode: 'open' });
		const input = document.createElement('input');
		shadow.append(input);
		assert(!press(input).defaultPrevented, 'Shadow input lost native ownership.');
		checks.push('composed shadow DOM editing path');
		const frame = document.createElement('iframe');
		area.append(frame);
		await new Promise<void>((resolve) => {
			if (frame.contentDocument?.readyState === 'complete') resolve();
			else frame.addEventListener('load', () => resolve(), { once: true });
		});
		const childWindow = frame.contentWindow, childDocument = frame.contentDocument;
		assert(childWindow && childDocument, 'Iframe was unavailable.');
		const childEditor = childDocument.createElement('input');
		childDocument.body.append(childEditor);
		const childStop = keys.listen(childWindow, [{ run: command.invoke, key: 'j' }]);
		try {
			assert(!press(childEditor).defaultPrevented, 'Cross-realm editor lost native ownership.');
		} finally {
			childStop();
		}
		checks.push('iframe element realm');
		stop();
		assert(!press(area).defaultPrevented, 'Disposed keyboard binding remained attached.');
		checks.push('native listener teardown');
		const form = document.createElement('form');
		form.innerHTML = '<input name="tag" value="one"><input name="tag" value="two">';
		area.append(form);
		const defaults = forms.read(form);
		assert(defaults.length === 2, 'Native repeated controls were lost.');
		const file = new File(['body'], 'sample.txt', { type: 'text/plain' });
		const entries = [...defaults, ['upload', file] as const];
		const changed = forms.dirty(entries, entries, { maximumEntries: 3, order: 'per-field', equal: Object.is });
		assert(!changed.dirty && entries[2]![1] === file, 'Dirty comparison changed a borrowed File.');
		checks.push('native repeated form controls and borrowed File comparison');
		const contract = keys.remapping(['next'], {
			maximumCommands: 1,
			maximumBindings: 1,
			maximumTextCodeUnits: 64,
			maximumComparisons: 0,
		});
		const saved = await codec.read(contract, { version: 1, bindings: [{ command: 'next', sequence: [{ key: 'n' }] }] });
		const remappedStop = keys.listen(
			window,
			saved.bindings.map(({ command: id, ...binding }) => {
				assert(id === command.id, 'Remapping resolved an unknown command.');
				return { ...binding, run: command.invoke };
			}),
		);
		try {
			const before = calls;
			assert(press(area, 'n').defaultPrevented && calls === before + 1, 'Validated remapping did not dispatch.');
		} finally {
			remappedStop();
		}
		assert(!press(area, 'n').defaultPrevented, 'Remapped listener survived disposal.');
		checks.push('persisted remapping native dispatch and teardown');
		{
			const wheel = new WheelEvent('wheel', { deltaMode: 1, deltaY: 2 });
			assert(
				pointer.wheel(wheel, { unit: 'pixels', lineHeight: 18, pageWidth: 800, pageHeight: 600 }).y === 36,
				'Native wheel conversion lost line geometry.',
			);
			const editor = document.createElement('textarea');
			const shadow = document.createElement('div');
			area.append(shadow);
			shadow.attachShadow({ mode: 'open' }).append(editor);
			editor.value = 'a😀b';
			editor.focus();
			let edits = 0;
			const textStop = text.listen(editor, () => {
				edits++;
			});
			try {
				const options = { composing: false, selection: 'select' as const, maximumLength: 16 };
				assert(text.edit(editor, { start: 1, end: 3 }, 'xy', options).status === 'edited', 'Native text edit failed.');
				assert(
					editor.value === 'axyb' && editor.selectionStart === 1 && editor.selectionEnd === 3,
					'Native selection policy was lost.',
				);
				assert(edits === 0, 'setRangeText fabricated an input event.');
				editor.dispatchEvent(new CompositionEvent('compositionstart'));
				assert(
					text.edit(editor, { start: 0, end: 1 }, '', { ...options, composing: true }).status === 'blocked',
					'Composition guard mutated a live editor.',
				);
				editor.dispatchEvent(new CompositionEvent('compositionend'));
			} finally {
				textStop();
			}
			const file = new File(['abc'], 'native.txt');
			const walked = await Array.fromAsync(
				files.walk([{ name: file.name, kind: 'file' as const }], {
					children: () => [],
					async file() {
						return file;
					},
				}, { maximumDepth: 0, maximumEntries: 1, maximumFiles: 1, maximumBytes: 3 }),
			);
			assert(
				walked[0]?.file === file && walked[0]?.path === 'native.txt',
				'Directory adapter lost native File identity.',
			);
			if (typeof ClipboardItem !== 'undefined') {
				const item = new ClipboardItem({ 'text/plain': new Blob(['hello'], { type: 'text/plain' }) });
				assert(
					clipboard.select([item], { preferredTypes: ['text/plain'], maximumItems: 1, maximumTypes: 1 })[0]?.item ===
						item,
					'Native clipboard MIME selection lost identity.',
				);
			}
			checks.push('native wheel, shadow text selection/composition, File metadata and ClipboardItem selection');
		}
		return checks;
	} finally {
		stop();
		area.remove();
	}
}

/** Expose a real capture target for the browser runner's mouse/touch interaction. */
export function installPointer(): { readonly events: string[]; readonly panel: HTMLDivElement; dispose(): void } {
	const panel = document.createElement('div');
	panel.id = 'input-pointer-check';
	panel.style.cssText = 'width:240px;height:120px;margin:20px;background:#ddd;touch-action:none';
	document.body.append(panel);
	const events: string[] = [];
	const stop = pointer.listen(panel, {
		capture: true,
		start: ({ event }) => {
			assert(event instanceof PointerEvent, 'PointerEvent type was lost.');
			events.push('start');
		},
		move: ({ x }) => events.push(`move:${x}`),
		end: () => events.push('end'),
		cancel: (_, reason) => events.push(`cancel:${reason}`),
	});
	return {
		events,
		panel,
		dispose() {
			stop();
			panel.remove();
		},
	};
}
