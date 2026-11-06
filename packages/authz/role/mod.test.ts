import { expect } from '@std/expect';
import { describe, it } from 'node:test';

import * as permission from '@okikio/authz/permission';
import * as role from './mod.ts';

const Permissions = permission.catalog('test.permissions', {
	Read: permission.define({ id: 'read' }),
	Write: permission.define({ id: 'write' }),
});

const Roles = role.catalog('test.roles', {
	Admin: role.define({ id: 'admin', permissions: [Permissions.Read, Permissions.Write] }),
	Member: role.define({ id: 'member', permissions: [Permissions.Read] }),
});

describe('role definitions', () => {
	it('retain exact permission identity and catalog IDs', () => {
		expect(role.ids(Roles)).toEqual({ Admin: 'admin', Member: 'member' });
		expect(role.get(Roles, 'admin')).toBe(Roles.Admin);
		expect(role.grants(Roles.Admin, Permissions.Write)).toBe(true);
		expect(role.grants(Roles.Member, Permissions.Write)).toBe(false);
	});

	it('rejects structural permission lookalikes', () => {
		expect(() =>
			role.define({
				id: 'invalid',
				permissions: [{ kind: 'permission', id: 'read' } as never],
			})
		).toThrow(TypeError);
	});
});
