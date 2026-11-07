# Check whether an account can export CSV

A plan can include CSV export while a member still lacks access to a particular dataset. Entitlement checks feature
availability; Permission checks the actor's action on a target. The application supplies purchased-plan data and policy.
Declaring the Export feature does not contact billing or make an export available.

An **interpreter** is the application adapter that translates a declared feature into an account decision. In this
example it maps `export.csv` to allow for one policy and deny for another. The requirement machinery calls that adapter;
it cannot infer purchased features from the feature name.

## Allow one plan and reject another

From the `utils` checkout root, review `mise.toml` and run `mise trust`, `mise install`, and `mise run prepare -- --kind deps`.
Save the complete block as `export-feature.ts` and run `mise exec -- deno run export-feature.ts`. No server or database is needed.

```ts runnable=export-feature.ts
import * as entitlement from '@okikio/authz/entitlement';
import * as requirement from '@okikio/capability/requirement';
import * as context from '@okikio/context';


// Name the feature independently of any account or subscription plan.
const Export = entitlement.define({ id: 'export.csv' });

// The policy view borrows this operation's cancellation and cleanup lifetime.
await using owner = context.create({ id: 'export' });
const ctx = requirement.scope(owner, {
	interpreters: {
		entitlement: entitlement.interpreter({
			maximumChecks: 20,
			async check(_ctx, definitions) {
				// Replace this example decision with the account's actual feature lookup.
				return definitions.map(() => ({ allowed: true as const }));
			},
		}),
	},
});

// Do not produce the export until the account policy accepts the feature.
await requirement.apply(ctx, [entitlement.require(Export)]);
console.log('Export feature accepted');

// A second account policy refuses the same declared feature.
const denied = requirement.scope(owner, {
	interpreters: {
		entitlement: entitlement.interpreter({
			maximumChecks: 20,
			async check(_ctx, definitions) {
				return definitions.map(() => ({ allowed: false as const }));
			},
		}),
	},
});
try {
	await requirement.apply(denied, [entitlement.require(Export)]);
} catch (error) {
	if (!(error instanceof entitlement.EntitlementDeniedError)) throw error;
	console.log('Plan does not include CSV export');
}
```

```text output
Export feature accepted
Plan does not include CSV export
```

The first interpreter supplies one allow decision per feature. The second supplies deny. `requirement.apply()` awaits
the chosen interpreter before export work can begin. A provider fault is a fault, not a plan denial. Both requirement
views borrow the same owner's cancellation/cleanup lifetime. Production creates the checker from trusted account data.

The following extensions belong below that complete program and reuse its exact Export declaration. Catalogs help
select features for reporting; requirements attach those same identities to a service or resource contract.

## Group features for a report

Group related definitions when callers need selection by key. This continues the first example's `Export` definition:

```ts
export const Features = entitlement.catalog('features', {
	ExportCsv: Export,
	BulkImport: entitlement.define({ id: 'import.bulk' }),
});

export const ExportFeatures = entitlement.select(Features, ['ExportCsv']);
```

## Contribute a requirement

`entitlement.require()` converts one entitlement definition into a generic `@okikio/capability/requirement` value:

```ts
const required = entitlement.require(Export);
console.log(requirement.document(required)[0]?.definition);
```

A service, resource, or another definition can retain that requirement. The host's requirement interpreter decides how
it is enforced. This package never queries billing or persistence by itself.

## Larger composition

```ts
const Reporting = entitlement.catalog('reporting', {
	ExportCsv: entitlement.define({ id: 'report.export.csv' }),
	History: entitlement.define({ id: 'report.history' }),
	Evidence: entitlement.define({ id: 'report.evidence' }),
});

const RequiredForAnalyst = entitlement.compose(
	entitlement.select(Reporting, ['History', 'Evidence']),
);

const requirements = RequiredForAnalyst.map(entitlement.require);
console.log(requirement.document(requirements).map((entry) => entry.definition).join(','));
```

The definitions remain plain immutable metadata. Product policy can change without changing the utility.

## Convenience and the manual equivalent

| Convenience                            | Manual equivalent                                                               | Concrete value                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `entitlement.define()`                 | freeze a stable capability ID/description object and validate identity yourself | provider-neutral capability identity                                 |
| `catalog()` / `select()` / `compose()` | build and validate capability maps/subsets manually                             | the same catalog semantics as other definition utilities             |
| `entitlement.require()`                | construct the corresponding generic requirement record by hand                  | capability metadata composes with the shared requirement interpreter |

A manual implementation would need frozen metadata, a trusted identity registry, a catalog, and requirement records.
Within this API, use `define()` to register identity. A lookalike frozen object is not an accepted definition.
`@okikio/authz/entitlement` standardizes those shapes so identity, selection, and composition behave like the other
definition utilities.

## Source guide

The paths below are relative to the [package directory](../../packages/authz/entitlement).

1. `definition.ts` defines trusted feature metadata, catalogs, and requirements.
2. `mod.ts` adds the checker interpreter and policy errors.
3. `types.ts` defines the immutable values.
4. `mod.test.ts` is the executable behavior reference.

Read the [public source](../../packages/authz/entitlement/mod.ts) for the complete exported contracts and field
descriptions.

The checker receives one ordered batch. It must return one decision per definition. A denial raises
`EntitlementDeniedError`. A malformed decision raises `EntitlementDecisionError`. A batch larger than `maximumChecks`
fails before policy runs. Checker errors remain errors, rather than becoming denials.

Use exact imported definitions. A record with the same ID cannot acquire definition identity. Use
`@okikio/authz/entitlement/definition` for static declarations without importing checker execution. `requirements()`
projects an authored catalog into requirements. `ids()` preserves the catalog's literal keys and IDs. Billing owns plan
definitions, purchased features, pricing, data queries, and the checker implementation.
