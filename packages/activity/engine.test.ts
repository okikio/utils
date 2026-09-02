import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as engine from './engine.ts';

describe('@okikio/activity/engine', () => {
	it('defines import-safe engine identity without creating a live provider', () => {
		const Browser = engine.define({ id: 'browser', description: 'Runs browser-affine work.' });
		expect(Browser).toEqual({
			kind: 'activity-engine',
			id: 'browser',
			description: 'Runs browser-affine work.',
		});
		expect(Object.isFrozen(Browser)).toBe(true);
	});

	it('keeps required placement exclusive', () => {
		const Browser = engine.define({ id: 'browser' });
		const Server = engine.define({ id: 'server' });
		expect(engine.oneOf(engine.require(Browser))).toMatchObject({
			choices: [{ mode: 'required', engine: Browser }],
		});
		expect(() => engine.oneOf(engine.require(Browser), engine.allow(Server))).toThrow(
			'A required engine cannot be combined with fallback engine choices.',
		);
	});

	it('preserves authored order while strengthening duplicate exact definitions', () => {
		const Browser = engine.define({ id: 'browser' });
		const Server = engine.define({ id: 'server' });
		const placement = engine.compose(
			engine.allow(Browser),
			engine.prefer(Server),
			engine.prefer(Browser),
		);
		expect(placement.choices).toEqual([
			{ kind: 'activity-engine-choice', mode: 'preferred', engine: Browser },
			{ kind: 'activity-engine-choice', mode: 'preferred', engine: Server },
		]);
	});

	it('documents the normalized placement instead of the authored duplicates', () => {
		const Browser = engine.define({ id: 'browser' });
		const Server = engine.define({ id: 'server' });
		expect(engine.document(engine.oneOf(
			engine.prefer(Browser),
			engine.allow(Server),
		))).toEqual([
			{ engine: 'browser', mode: 'preferred' },
			{ engine: 'server', mode: 'allowed' },
		]);
	});

	it('rejects malformed definitions before they enter placement state', () => {
		expect(() => engine.allow({ kind: 'activity-engine', id: '' } as engine.EngineDefinition)).toThrow();
		expect(() => engine.compose([])).toThrow('Activity placement requires at least one engine.');
	});
});
