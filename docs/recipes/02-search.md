# Reuse a search action and restore its input

A user searches for a person, leaves the screen, and returns to the same saved search text. Several UI controls can
invoke one command. Query owns the allowed search grammar, Commands owns the reusable action, Context owns state
observation, and Storage supplies an explicitly chosen snapshot slot.

This program uses a local array as its provider and a memory store as its backing slot. It exercises the actual command
and stored-state APIs without pretending to render a browser screen.

## Run the saved-search workflow

At the checkout root, review `mise.toml`, run `mise trust`, `mise install` and `mise run prepare -- --kind deps`. Save the complete
program below as `search.ts` and run `mise exec -- deno run search.ts`; it needs no network or filesystem permissions.
Follow four steps: parse the permitted name filter, search the local people, save the exact URL, then reopen that saved
URL under a new owner. `await` waits for an asynchronous step before the next one. `using` closes the result cell and
`await using` joins each saved-state owner's cleanup. Neither deletes the memory store, which is why reopening works.

```ts runnable=search.ts
import * as query from '@okikio/query';
import * as schema from '@okikio/schema';
import * as commands from '@okikio/input/commands';
import * as state from '@okikio/context/state';
import { memory } from '@okikio/storage/state';

const Search = query.define({
	fields: { name: query.field(schema.string()) },
	filters: { name: [query.eq] },
	pagination: query.offset({ defaultLimit: 10, maximumLimit: 20 }),
});
const people = ['Ada', 'Grace', 'Linus'];
const store = memory();
using results = state.create<readonly string[]>([]);
{
	await using draft = await state.open({
		store,
		contract: 'people.search.v1',
		value: schema.string(),
		initial: () => '',
	});
	const SearchPeople = commands.define({
		id: 'people.search',
		label: 'Search people',
		async invoke(url: string) {
			const request = await Search.parse(new URL(url));
			if (request.pagination.kind !== 'offset') throw new Error('This provider needs offset pagination.');
			const value = query.conjunction(request.filter)?.[0]?.value;
			// This provider deliberately implements only the declared name equality filter.
			const matches = people.filter((name) => value === undefined || name === value)
				.slice(request.pagination.offset, request.pagination.offset + request.pagination.limit);
			await draft.set(url);
			results.set(matches);
			return matches;
		},
	});
	console.log((await commands.run(SearchPeople, 'https://example.test/people?filter[name]=Ada')).join(', '));
	console.log(results.reader.get().length);
}
await using restored = await state.open({ store, contract: 'people.search.v1', value: schema.string() });
console.log(new URL(restored.reader.get()).searchParams.get('filter[name]'));
```

```text output
Ada
1
Ada
```

The first line is the command result. The second reads the result cell exposed to a renderer. The third proves that
another owner can reload the saved URL from the same memory slot. Disposing the first draft does not delete that slot.

## What the screen would connect

A form submit, menu action, or keyboard binding can call the same command and await its result. Give the renderer only
`results.reader`; keep the cell's mutation and disposal with the screen owner. Commands creates no global shortcut,
listener, or UI on import.

```mermaid
flowchart LR
    Control[Form or shortcut] --> Command[One Search command]
    Command --> Query[Validate allowed query]
    Query --> Provider[Application searches local people]
    Provider --> Result[Publish result cell]
    Command --> Draft[Save search URL]
    Draft --> Slot[Explicit Storage slot]
    Slot --> Reopen[Next owner restores input]
```

This shows the intended UI connections around the executable command. Browser event binding and rendering are
deliberately outside the local program. The cell reports results; it does not become the authority for authorizing a
search.

## Adapt the workflow deliberately

| Requirement                                         | Change                                                                          | Ownership or failure consequence                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Preserve input after page reload                    | Select `storage/state/web` and supply Storage plus a writer policy.             | The application chooses the key, retention, and coordination; memory alone is insufficient. |
| Query a server                                      | Replace the local array provider and pass cancellation into fetch.              | Query validation does not grant access or translate automatically to SQL.                   |
| Handle unsupported filters                          | Catch `QueryValidationError` and show its issues.                               | Do not turn a rejected query into an unrestricted search.                                   |
| Prevent an old slow search replacing a newer result | Add cancellation or an application revision check before saving and publishing. | Commands does not serialize or cancel overlapping invocations automatically.                |
| Save succeeds but result publication fails          | Reconcile the saved draft and visible state explicitly.                         | Saving the draft and publishing results are not one transaction.                            |

Change the filter from Ada to Grace and both the result and restored input change. Change the field name to an
undeclared field and parsing rejects before either save or publication. The local provider applies exactly the declared
equality filter and offset page; a production provider must preserve every enabled operation.

See [Query](../../packages/query/README.md), [Input commands](../../packages/input/README.md#choose-an-entry-point), and
[stored state](../context/03-stored-state.md) for focused options and conflict recovery.
