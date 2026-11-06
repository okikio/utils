import type { ListenerOptions, ListenerTarget } from '../types.ts';

/** Minimal host records exact listener ownership without DOM globals or listener signal support. */
export class Surface implements ListenerTarget {
	readonly listeners = new Map<string, Set<(event: unknown) => void>>();
	readonly captures: number[] = [];
	readonly releases: number[] = [];
	addEventListener(type: string, listener: (event: unknown) => void, _options?: boolean | ListenerOptions): void {
		const group = this.listeners.get(type) ?? new Set();
		group.add(listener);
		this.listeners.set(type, group);
	}
	removeEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.get(type)?.delete(listener);
	}
	setPointerCapture(id: number): void {
		this.captures.push(id);
	}
	releasePointerCapture(id: number): void {
		this.releases.push(id);
	}
	emit(type: string, fields: Record<string, unknown> = {}) {
		const event = {
			type,
			defaultPrevented: false,
			preventDefault() {
				this.defaultPrevented = true;
			},
			...fields,
		};
		for (const listener of this.listeners.get(type) ?? []) listener(event);
		return event;
	}
	point(type: string, x: number, y = 0, pointerId = 1) {
		return this.emit(type, { pointerId, clientX: x, clientY: y });
	}
	get size(): number {
		return [...this.listeners.values()].reduce((sum, group) => sum + group.size, 0);
	}
}
