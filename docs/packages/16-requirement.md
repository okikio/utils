# Requirement

A requirement records a condition that must hold before work begins, such as an upload size rule or account feature.
Recording the condition does not run it. An **interpreter** is an application callback that understands that kind of rule;
`apply()` calls it and waits for success before the protected operation continues.

The upload example below declares the rule, supplies the evaluator and checks actual bytes. Replacing the evaluator is
how another host can apply its own policy. A declaration with no effective evaluator is not an access control system.

Start with the [package example](../../packages/capability/requirement/README.md) for the smallest declaration and
evaluator. The complete upload below shows where that check belongs in an application.

## Admit a three-byte upload

Try a three-byte input against a 1,024-byte limit. The application supplies the callback that performs the check.
After the [checkout setup](../../README.md#run-a-complete-example-from-this-checkout), save this as `check-upload.ts`
and run `mise exec -- deno run check-upload.ts`.

```ts runnable=check-upload.ts
import * as context from '@okikio/context';
import * as requirement from '@okikio/capability/requirement';

// The rule and request data exist before runtime enforcement.
const Size = Object.freeze({ kind: 'upload-rule', id: 'upload.maximum-bytes', maximum: 1024 });
const NeedsSmallUpload = requirement.define({ family: 'upload', action: 'require', definition: Size });
const bytes = new Uint8Array([1, 2, 3]);

// Attach the interpreter to this operation without creating a second lifetime.
await using owner = context.create({ id: 'upload' });
const ctx = requirement.scope(owner, {
	interpreters: {
		upload: {
			/** Check only the exact declared upload rule against this request's bytes. */
			async apply(_ctx, entries) {
				for (const entry of entries) {
					// A matching ID is insufficient: interpret only the canonical rule object.
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

The input is within the limit, so execution reaches the print statement. Try replacing the three-byte array with
`new Uint8Array(1025)`: the check throws before the upload could continue.

## Trace declaration, binding and enforcement

`Size` records the maximum number of bytes. `define` names that rule in the upload family. Neither checks a
file. `scope` gives this operation the function that can check rules for that family. `apply` calls it.

The example checks the byte array it already has. In a service, check the exact bytes you will read or use
a length from a source you trust.

Replace the three-byte input with `new Uint8Array(1025)`. `apply` rejects with `The upload is too large.` before
the program prints success. Wait for `apply` to finish before writing any bytes.

Now omit the `upload` interpreter. The check rejects by default because it has no function to apply the rule.
A test can set `unknown: 'ignore'` to skip missing interpreters. That setting skips the check, so it cannot
tell you that an upload is allowed.

For permissions the roles are the same: the declaration names a permission, the application supplies a checker, and the active call evaluates the target. A declaration alone grants no access and does not choose a role system, relationship graph or remote authorization service.

Suppose a picture-download operation declares ReadPicture and uses a resource that can open picture storage. The host
can inspect that contract before it knows which picture the request names. After resolving photo-1, the operation asks
the application checker about that actual target before borrowing or returning protected data.

```text
Declare ReadPicture → retain it in the reachable operation/resource contract
                    → resolve target photo-1 → activate check → application interpreter decides
```

The arrows show when metadata becomes a real decision. They do not authenticate the caller or supply the picture
policy; the application must provide both. The upload example uses the same separation for a byte-size rule.

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
