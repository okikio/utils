# Requirement

A requirement records a condition that must hold before work begins, such as an upload size rule or account feature.
Recording the condition does not run it. An **interpreter** is an application callback that understands that kind of rule;
`apply()` calls it and waits for success before the protected operation continues.

The upload example below declares the rule, supplies the evaluator and checks actual bytes. Replacing the evaluator is
how another host can apply its own policy. A declaration with no effective evaluator is not an access control system.

Start with the [package example](../../packages/capability/requirement/README.md) for the smallest declaration and
evaluator. The complete upload below shows where that check belongs in an application.

## Run a complete task

Check an upload rule through an application-supplied evaluator. This program supplies its own local input and uses
public workspace imports. After `mise run prepare -- --kind deps`, save it as `example.ts` at the checkout root and run
`mise exec -- deno run example.ts`.

```ts runnable=complete-task.ts
import * as context from '@okikio/context';
import * as requirement from '@okikio/capability/requirement';
const Size = Object.freeze({ kind: 'upload-rule', id: 'upload.maximum-bytes', maximum: 1024 });
const NeedsSmallUpload = requirement.define({ family: 'upload', action: 'require', definition: Size });
const bytes = new Uint8Array([1, 2, 3]);
await using owner = context.create({ id: 'upload' });
const ctx = requirement.scope(owner, {
	interpreters: {
		upload: {
			/** Check only the exact declared upload rule against this request's bytes. */
			async apply(_ctx, entries) {
				for (const entry of entries) {
					if (entry.definition !== Size) throw new Error('Unknown upload rule.');
					if (bytes.byteLength > Size.maximum) throw new Error('The upload is too large.');
				}
			},
		},
	},
});
// Applying the requirement invokes the interpreter. A declaration alone does not check the upload.
await requirement.apply(ctx, [NeedsSmallUpload]);
console.log(`Upload admitted: ${bytes.byteLength} bytes`);
```

Expected output:

```text output
Upload admitted: 3 bytes
```

Compare the output before changing the input. The remaining sections explain the options and limits; the
[package example](../../packages/capability/requirement/README.md) also places this operation among adjacent
capabilities.

## Trace declaration, binding and enforcement

`Size` is ordinary frozen metadata: the maximum allowed upload size. `define` wraps that metadata in an upload-family declaration. Neither operation measures or rejects an upload. `scope` binds this family's evaluator to the borrowed operation lifetime. Only `apply` runs that evaluator. Here it closes over the admitted byte array; an actual service must bind the rule to the exact bytes or trusted length it will consume.

To see a rejection, replace the three-byte input with `new Uint8Array(1025)` and catch the call to `apply`. It rejects with `The upload is too large.` before the success line. Perform the write only after that Promise resolves. To see the other failure, omit the `upload` interpreter: applying an active family without an interpreter rejects by default. A test host can explicitly select `unknown: 'ignore'`, but that bypass is a policy decision, not permission enforcement.

For permissions the roles are the same: the declaration names a permission, the application supplies a checker, and the active call evaluates the target. A declaration alone grants no access and does not choose a role system, relationship graph or remote authorization service.

## Direct, reachable, and active requirements

The compiler keeps three states separate:

- **direct**: the exact service, endpoint, operation, middleware, workflow, or resource declares the requirement for the
  current work.
- **reachable**: a declared dependency can activate the requirement later.
- **active**: runtime work has reached the point where the interpreter must evaluate the requirement.

This distinction supports object and graph authorization. An endpoint can declare that `AccountPermissions.Read` is
reachable before the account ID exists. After the handler resolves the concrete account, it can activate the declared
permission with that target. The compiler can still prove that the permission family is part of the service contract
before traffic starts.

## What belongs here

Requirements are appropriate for rules that answer whether work is allowed or which policy state applies. Examples
include:

- permissions
- entitlements
- quotas
- consent
- compliance rules
- feature eligibility
- organization or tenant admission rules

A requirement is not the right mechanism for every cross-cutting service feature. Metrics and logs are observations.
Usage and meter records are declared effects when their announcement needs durable ownership. Retries and rate limits
are resilience policies. Live graph clients and stores are resources.

This separation keeps each extension family honest about its runtime semantics.
