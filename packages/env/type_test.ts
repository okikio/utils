import type { StandardSchemaV1 } from '@standard-schema/spec';

import * as env from './mod.ts';

/** Small synchronous Standard Schema fixture used only to exercise public inference. */
function schema<Input, Output>(validate: (input: Input) => Output): StandardSchemaV1<Input, Output> {
	return {
		'~standard': {
			version: 1,
			vendor: 'utils-env-type-test',
			validate(value) {
				return { value: validate(value as Input) };
			},
		},
	};
}

const Port = env.variable(schema<string | undefined, number>((value) => Number(value ?? '8787')), {
	description: 'Listener port.',
});
const Name = env.variable(schema<string | undefined, string>((value) => value ?? 'service'), {
	description: 'Service name.',
});

const NetworkEnvironment = env.environment({ PORT: Port });
const IdentityEnvironment = env.environment({ NAME: Name });
const ServiceEnvironment = env.compose(NetworkEnvironment, IdentityEnvironment);

const direct = NetworkEnvironment.parseSync({ PORT: '4321' });
const directPort: number = direct.PORT;
void directPort;
// @ts-expect-error PORT is schema output `number`, not the raw environment string.
const directPortString: string = direct.PORT;
void directPortString;

const composed = ServiceEnvironment.parseSync({ PORT: '4321', NAME: 'catalog' });
const composedPort: number = composed.PORT;
const composedName: string = composed.NAME;
void composedPort;
void composedName;
// @ts-expect-error Composition retains both exact output types.
const composedNameNumber: number = composed.NAME;
void composedNameNumber;

const exactPortField: typeof Port = ServiceEnvironment.fields.PORT;
const exactNameField: typeof Name = ServiceEnvironment.fields.NAME;
void exactPortField;
void exactNameField;
