import { expect } from '@std/expect';
import { describe, it } from 'node:test';
import { permission, role } from '@okikio/authz';
import * as permissions from '@okikio/authz/permission';
import * as roles from '@okikio/authz/role';
import * as declarations from '@okikio/authz/permission/definition';

describe('authorization package entry points', () => {
	it('keeps exact permission and role identities across root and focused imports', () => {
		const Read = declarations.define({ id: 'dataset.read' });
		const Editor = role.define({ id: 'editor', permissions: [Read] });
		expect(permission.is(Read)).toBe(true);
		expect(permissions.is(Read)).toBe(true);
		expect(roles.is(Editor)).toBe(true);
		expect(roles.grants(Editor, Read)).toBe(true);
		expect(role.grants(Editor, permissions.define({ id: 'dataset.read' }))).toBe(false);
	});
});
