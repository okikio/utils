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
		expect(() => engine.compose([])).toThrow(TypeError);
	});
});

it('reports bounded placement facts with authored fallback, expiry and own affinity checks', () => {
	const primary = engine.define({ id: 'primary' }), fallback = engine.define({ id: 'fallback' });
	const activity = {
		id: 'resize',
		version: '1',
		placement: engine.oneOf(engine.prefer(primary), engine.allow(fallback)),
		affinity: { region: 'east' },
	};
	const base = {
		id: 'registration',
		hostId: 'host',
		engineId: 'primary',
		activities: [{ id: 'resize', version: '1' }],
		capacity: 1,
		active: 0,
		affinity: { region: 'east' },
	};
	const hosts = [{ ...base, id: 'full', active: 1 }, { ...base, id: 'expired', expiresAt: { epochMilliseconds: 10 } }, {
		...base,
		id: 'fallback',
		engineId: 'fallback',
	}];
	const report = engine.inspect(activity, hosts, { now: 10, maximumHosts: 3 });
	expect(report.selected).toBe('fallback');
	expect(report.hosts.map((row) => row.reason)).toEqual(['capacity', 'expired', undefined]);
	expect(report.hosts.map((row) => row.selected)).toEqual([false, false, true]);
	expect(engine.inspect(activity, [base, ...hosts], { now: 10, maximumHosts: 4 }).selected).toBe('primary');
	expect(() => engine.inspect(activity, hosts, { now: 10, maximumHosts: 2 })).toThrow(RangeError);
	expect(
		engine.inspect({ ...activity, affinity: {} }, [{
			id: base.id,
			hostId: base.hostId,
			engineId: base.engineId,
			activities: base.activities,
			capacity: 1,
			active: 0,
		}], { now: 10, maximumHosts: 1 }).hosts[0]?.reason,
	).toBe('affinity');
	expect(Object.isFrozen(report.hosts[0])).toBe(true);
});
