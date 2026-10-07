/**
 * Parse configuration once into typed values and keep secret values out of diagnostics. Reading process.env throughout an application spreads defaults, coercion and validation across unrelated code.
 *
 * Start with a record source for reproducible tests, then merge an explicit runtime source and overrides at the executable root. Use secret() for credentials so documentation and diagnostics redact them. Zod, Valibot and Standard Schema adapters are optional imports; the generic configuration core does not choose a validator or read environment variables until a source is used.
 *
 * @example
 * ```ts
 * import * as env from '@okikio/env/zod';
 * import { z } from 'zod';
 * const Service = env.define({ PORT: z.coerce.number().int().min(1).max(65535).default(8787).describe('TCP port used by the service.') });
 * const values = Service.parseSync(env.record({ PORT: '4321' }));
 * console.log(values.PORT + 1);
 * ```
 *
 * @module
 */
export {
	blank,
	compose,
	define,
	env,
	environment,
	EnvironmentError,
	example,
	isSource,
	manifest,
	merge,
	record,
	requirement,
	requirementReport,
	secret,
	select,
	variable,
} from './standard.ts';
export type {
	ComposeEnvironmentFields,
	EnvironmentDefinition,
	EnvironmentField,
	EnvironmentFieldKind,
	EnvironmentFieldMetadata,
	EnvironmentFieldMetadataInput,
	EnvironmentFields,
	EnvironmentIssue,
	EnvironmentManifest,
	EnvironmentManifestField,
	EnvironmentParseResult,
	EnvironmentRecord,
	EnvironmentRequirement,
	EnvironmentRequirementField,
	EnvironmentRequirementReason,
	EnvironmentRequirementReportField,
	EnvironmentSource,
	EnvironmentSourceInput,
	InferEnvironment,
	InferEnvironmentField,
	InferEnvironmentFields,
} from './standard.ts';
