import { clipboard, files, forms, gestures, keys, pointer } from './mod.ts';
import type { ListenerTarget } from './types.ts';

/** Real browser callbacks must retain complete native types, independently of mock-host support. */
function nativeTypes(window: Window, panel: HTMLDivElement): void {
	keys.listen(window, [{
		key: 'j',
		run(event) {
			const keyboard: KeyboardEvent = event;
			const location: number = event.location;
			void keyboard;
			void location;
			// @ts-expect-error Native keyboard values do not contain pointer identity.
			void event.pointerId;
		},
	}]);
	pointer.listen(panel, {
		move({ event }) {
			const native: PointerEvent = event;
			void native.pressure;
		},
	});
	gestures.swipe(panel, ({ event }) => {
		const native: PointerEvent = event;
		void native.pressure;
	});
}

/** A small listener host requires no Window/Element cast and no fabricated DOM implementation. */
function mockTypes(target: ListenerTarget): void {
	keys.listen(target, [{
		key: 'j',
		run(event) {
			const key: string = event.key;
			void key;
			// @ts-expect-error A mock contract does not invent full browser metadata.
			void event.location;
		},
	}]);
	pointer.listen(target, {
		move({ event }) {
			const id: number = event.pointerId;
			void id;
		},
	});
}

/** Native SVG, form files, and clipboard payloads must not narrow to the minimal mock contracts. */
function otherNativeTypes(svg: SVGSVGElement, form: HTMLFormElement, fileInput: HTMLInputElement): void {
	pointer.listen(svg, {
		move({ event }) {
			const native: PointerEvent = event;
			void native.pressure;
		},
	});
	keys.listen(svg, [{
		key: 'x',
		run(event) {
			const native: KeyboardEvent = event;
			void native.location;
		},
	}]);
	for (const [, value] of forms.read(form)) if (typeof value !== 'string') void value.arrayBuffer();
	forms.listen(form, ({ entries, event }) => {
		const native: SubmitEvent = event;
		void native.submitter;
		for (const [, value] of entries) if (typeof value !== 'string') void value.stream();
	});
	files.listen(fileInput, ({ files, event }) => {
		const native: Event = event;
		void native;
		for (const file of files) void file.arrayBuffer();
	});
	clipboard.listen(svg, ({ event }) => {
		const native: ClipboardEvent = event;
		void native.clipboardData;
	});
}
void nativeTypes;
void mockTypes;
void otherNativeTypes;
