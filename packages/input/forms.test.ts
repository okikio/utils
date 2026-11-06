import { describe, it } from 'node:test';
import { expect } from '@std/expect';
import * as schema from '@okikio/schema';
import * as forms from './forms.ts';
const bounds = { maximumFields: 4, maximumIssues: 4, maximumPathLength: 4, maximumMessageCodeUnits: 64 };
describe('explicit form evidence without control mutation', () => {
	it('maps nested/repeated control names exactly and keeps form-wide/unmapped errors', () => {
		const validation = {
			issues: [{ message: 'Required', path: ['people', 0, 'name'] }, {
				message: 'Literal dotted key',
				path: ['people.0.name'],
			}, { message: 'Form-wide' }],
		};
		const report = forms.issues(validation, [{ name: 'person-name', path: ['people', 0, 'name'] }, {
			name: 'same-logical-control',
			path: ['people', 0, 'name'],
		}, { name: 'literal', path: ['people.0.name'] }], bounds);
		expect(report.fields['person-name']?.[0]?.message).toBe('Required');
		expect(report.fields['same-logical-control']).toEqual(report.fields['person-name']);
		expect(report.fields.literal?.[0]?.message).toBe('Literal dotted key');
		expect(report.unmapped.map((issue) => issue.message)).toEqual(['Form-wide']);
		expect(report.capped).toBe(false);
	});
	it('does not match a shortened path prefix, records caps and preserves existing validation truncation', async () => {
		const result = forms.issues({ issues: [{ message: 'too long', path: ['a', 'b'] }, { message: 'ignored' }] }, [{
			name: 'a',
			path: ['a'],
		}], { ...bounds, maximumIssues: 1, maximumPathLength: 1, maximumMessageCodeUnits: 3 });
		expect(result.fields.a).toEqual([]);
		expect(result.unmapped[0]).toEqual({ message: 'too', path: ['a'], truncated: true });
		expect(result.capped).toBe(true);
		const native = await schema.validate(schema.object({ count: schema.number() }), { count: 'bad' });
		expect(forms.issues(native, [{ name: 'count', path: ['count'] }], bounds).fields.count).toHaveLength(1);
		expect(forms.issues({ issues: [], truncated: true }, [], bounds).capped).toBe(true);
	});
	it('compares repeated occurrences and borrowed File-like values with an explicit application policy', () => {
		const file = Object.freeze({
			name: 'photo',
			size: 7,
			arrayBuffer() {
				throw new Error('Must not read file body');
			},
		});
		const current = [['tags', 'b'], ['tags', 'a'], ['upload', file]] as const;
		const defaults = [['upload', file], ['tags', 'b'], ['tags', 'a']] as const;
		const policy = { maximumEntries: 3, equal: Object.is, order: 'per-field' as const };
		expect(forms.dirty<unknown>(current, defaults, policy)).toEqual({ dirty: false, fields: [], orderChanged: true });
		expect(forms.dirty<unknown>(current, defaults, { ...policy, order: 'entries' }).dirty).toBe(true);
		expect(forms.dirty<unknown>(current, [['tags', 'a'], ['tags', 'b'], ['upload', file]], policy).fields).toEqual([
			'tags',
		]);
		expect(() => forms.dirty(current, defaults, { ...policy, maximumEntries: 2 })).toThrow(RangeError);
	});
});
