/**
 * Environment definitions, raw-value sources, and deterministic projections.
 *
 * Import the package as a namespace so its compact verbs remain explicit at the
 * call site:
 *
 * ```ts
 * import * as env from '@okikio/env';
 *
 * const values = Definition.parseSync(env.merge(env.env, overrides));
 * ```
 *
 * Use `@okikio/env/zod` or `@okikio/env/valibot` when schemas should contribute
 * their native metadata automatically.
 */
export {
	blank,
	compose,
	define,
	environment,
	requirement,
	secret,
	variable,
	EnvironmentError,
	example,
	manifest,
	requirementReport,
	env,
	isSource,
	merge,
	record,
	select,
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
