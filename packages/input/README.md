# Input

Collect text, forms, files and clipboard values; bind keyboard actions; measure pointer gestures; and observe gamepad
controls. Feedback is a separate family for optional haptics, sound, visual cues and accessible status. Each operation
receives the target or host capability it actually uses. You can use one subpath without creating a command catalog,
Context, Task or application runtime.

For Deno, Node, and Bun execution, see [run a portable example](../../docs/05-runtime.md#run-a-portable-example-in-your-own-project). Host-specific adapters keep their native runtime requirements.

A browser **event** says something happened, such as a submit or edit. The application's useful input is the value at
that moment: a name, a file or a movement. Input snapshots that value and reports it through your callback. Your callback
owns any later save or request. Removing the input listener stops future notifications; it does not automatically cancel
a request that callback already started.

## Read a form without losing repeated values

Form controls produce strings and files. Choose conversions explicitly with `@okikio/schema`. This example runs with
standard FormData in Deno, Node, Bun or a browser. It retains both tags, converts the age, and deliberately selects only
the fields in the application's schema.

These examples use the current experimental source checkout, not an assumed registry release. From the `utils`
repository root, review `mise.toml`, run `mise trust`, then `mise install` and `mise run prepare -- --kind deps`.
Save the following module as `input-form.ts` and run `mise exec -- deno run input-form.ts`.
[Checkout prerequisites](../../README.md#work-on-the-repository) explain installing Mise.

```ts runnable=input-form.ts
import { forms } from '@okikio/input';
import * as schema from '@okikio/schema';

const ProfileSchema = schema.object({
	name: schema.string({ minLength: 1 }),
	age: schema.coerce.number({ integer: true, minimum: 0 }),
	tags: schema.array(schema.string()),
}, { unknownKeys: 'strip' });
// Browser form fields arrive as text. Repeated tags remain separate entries.
const values = new FormData();
values.append('name', 'Ada');
values.append('age', '37');
values.append('tags', 'writer');
values.append('tags', 'engineer');

// Declare the repeated field explicitly; validation converts age and checks the resulting object.
const checked = await forms.validate(ProfileSchema, values, { multiple: ['tags'] });
if (checked.issues) throw new Error(checked.issues.map(({ message }) => message).join('; '));
console.log(`${checked.value.name}: ${checked.value.age}; ${checked.value.tags.join(', ')}`);
```

```text output
Ada: 37; writer, engineer
```

`forms.read(form, { submitter })` uses a native form's successful-control rules and preserves File methods. A FormData
or ordered entry iterable works without a DOM. `forms.object()` exposes the projection separately. Repeated scalar names
become arrays by default; `duplicates: 'reject'` rejects them. Empty strings remain present. File bodies are not read,
and validation does not silently turn every unknown value into text.

## Choose a family

| Import                    | Useful on its own                                                           | How it composes                                            |
| ------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `@okikio/input/text`      | Read a text value or observe committed IME edits                            | Feed an Observable, state cell, or search function         |
| `@okikio/input/forms`     | Snapshot successful controls and validate an explicit projection            | Use owned Schema and submit through ordinary fetch         |
| `@okikio/input/files`     | Collect a file control, picker result or drop with count/byte/type policies | Keep native File objects for Streams or Format readers     |
| `@okikio/input/clipboard` | Read/write text or rich items; snapshot a user paste                        | Reuse files and existing parsers after explicit acceptance |
| `@okikio/input/commands`  | Define a named action with typed application input and output               | Reuse it from menus, keys, gamepads or another source      |
| `@okikio/input/keys`      | Attach direct callback shortcuts, scopes and sequences                      | An optional command supplies shared action identity        |
| `@okikio/input/pointer`   | Own one accepted contact and its native event                               | Build custom manipulation without losing pen metadata      |
| `@okikio/input/gestures`  | Recognize drag, swipe, hold, pinch and rotation geometry                    | Map physical direction or scale into application behavior  |
| `@okikio/input/gamepad`   | Read detached control snapshots or own a frame-polling loop                 | Update state or invoke the same application commands       |
| `@okikio/input/feedback`  | Announce status, play optional cues, or reuse a finite multimodal cue        | Keep business success independent of hardware availability |

The root groups these same operations: `import { text } from '@okikio/input'` and
`import * as text from '@okikio/input/text'` both provide `text.read`, `text.listen` and `text.observe`. The grouping
adds no registration or global input owner.

## Attach and release a real interaction

A shortcut can be a callback. This reusable mount function installs a single keyboard owner and returns the teardown
function that a component should call when it leaves the screen. It does not dispose the binding before the user can
interact.

```ts support=input-navigation.ts
import * as keys from '@okikio/input/keys';

export function mountNavigation(scope: Window, select: (offset: number) => void): () => void {
	const stop = keys.listen(scope, [
		{ key: 'j', run: () => select(1) },
		{ key: 'k', run: () => select(-1) },
		{ key: 'g g', run: () => select(0) },
	]);
	return () => stop();
}
```

Bindings ignore held-key repeats, IME composition, editable controls and already claimed events by default. A logical
`key` follows the current keyboard layout; `code` identifies a physical location. Modifiers are exact. Sequences have at
most eight strokes and one timer; duplicate/prefix collisions at the same scope and priority reject before setup. Use
`enabled` to leave an unavailable action unclaimed. A `run` callback can return a Promise; supply `onError` for
application error reporting and pass cancellation into any async operation it starts.

All listener handles are callable, expose `closed`, and support `Symbol.dispose`. An optional AbortSignal removes the
owned listeners and timers. Imported modules install no listeners or polling loops. The target stays borrowed.

Feedback owns only the resources it creates: oscillator and gain nodes, one animation, or the current actuator cue.
Dispose runs their cleanup in reverse registration order and still attempts earlier releases after a later one fails. An
operation or cancellation failure remains exact when cleanup succeeds. If both fail, `SuppressedError.error` holds the
cleanup failure and `suppressed` holds the earlier failure, including `null` or `undefined`.

Haptic cancellation joins the actuator's reset promise before settling. A later cue on the same actuator also waits for
that reset, even if an intervening waiter was cancelled. Audio contexts, destination nodes, DOM targets, and actuator
objects remain borrowed. A cleanup timeout would allow a new cue to race unfinished hardware work, so these lifetimes
join the actual host cleanup.

## Browser types and small hosts

Native HTML and SVG targets keep their full KeyboardEvent, PointerEvent, ClipboardEvent and File types. Minimal hosts
provide listener registration and the fields needed by the selected operation. They do not need to invent Window,
Element or a document. Input does not inject DOM declarations into Node or Worker projects. Source options never require
a mock to implement the browser's listener `signal` option.

File pickers and async clipboard operations may need user activation or permission. Denial preserves the host's error.
Abort stops result delivery, but cannot promise to dismiss a native picker or undo a clipboard write. Pointer capture,
native scrolling, screen-reader semantics and optional hardware behavior have distinct contracts; the guides show where
each is owned.

## Continue with a complete task

- [Collect text, forms, files and clipboard values](../../docs/input/01-collection.md)
- [Bind actions and interpret gestures or gamepads](../../docs/input/02-interaction.md)
- [Provide optional feedback](../../docs/input/03-feedback.md)
- [Compose observation and screen lifetimes](../../docs/input/04-observation.md)

The focused tests exercise structural hosts, IME updates, repeated fields, File identity, picker cancellation, clipboard
denial, gesture geometry, gamepad polling and teardown. Browser checks exercise actual DOM forms, SVG, shadow/iframe
targets, pointer capture, clipboard data, Web Animations and AudioContext. Hardware feedback still needs the
corresponding device; a mock or browser automation result does not prove a motor, speaker or lamp produced output.

## Reuse one action from several controls

A command can be called from a form, menu, or shortcut. Defining it does not register listeners or choose a renderer.
This local program exercises the same invocation that a UI binding would call.

```ts runnable=rename-command.ts
import { define, enabled, run } from '@okikio/input/commands';

const Rename = define({
	id: 'document.rename',
	label: 'Rename document',
	enabled: (title: string) => title.trim().length > 0,
	invoke: (title: string) => title.trim(),
});
console.log(enabled(Rename, '   '));
console.log(run(Rename, '  Draft  '));
```

```text output
false
Draft
```

Eligibility is an application predicate and is checked again by `run()`. Invoking a disabled command throws
`CommandDisabledError`; UI disabled styling alone does not enforce the rule. The application still owns authorization,
saving the title, and showing any failure. See the [search recipe](../../docs/recipes/02-search.md) for an asynchronous
command connected to saved state.

## Reuse an action across different controls

An editor shortcut, a multi-select form, and a pointer gesture collect different input. A reusable Command lets several
of those inputs request the same application operation.

Select only the host family needed. Commands connect intent to work; Context can own a screen lifetime; Feedback adds
optional responses without owning the operation result.

Browser permission and device availability can differ. Dispose listeners at the real UI lifetime and never infer a
successful business action from sound, vibration, or an event.

## Choose an entry point

Use the table to find a focused import for the job you need. Contract links open the exact public source, including its
options and types.

| Import                    | Use it to                                                                         | Exact contract             |
| ------------------------- | --------------------------------------------------------------------------------- | -------------------------- |
| `@okikio/input`           | Use the package entry shown in the complete examples above.                       | [Contract](./mod.ts)       |
| `@okikio/input/keys`      | Match keyboard input and own listener disposal.                                   | [Contract](./keys.ts)      |
| `@okikio/input/gestures`  | Recognize gestures with explicit cancellation and listener ownership.             | [Contract](./gestures.ts)  |
| `@okikio/input/text`      | Observe and edit text while respecting composition and selection.                 | [Contract](./text.ts)      |
| `@okikio/input/forms`     | Collect and validate forms without losing repeated values.                        | [Contract](./forms.ts)     |
| `@okikio/input/files`     | Read selected files through explicit limits and host capabilities.                | [Contract](./files.ts)     |
| `@okikio/input/clipboard` | Read or write clipboard data through a supplied host capability.                  | [Contract](./clipboard.ts) |
| `@okikio/input/gamepad`   | Observe controller input under an explicitly owned polling lifetime.              | [Contract](./gamepad.ts)   |
| `@okikio/input/feedback`  | Request optional visual, sound, or haptic feedback through supplied capabilities. | [Contract](./feedback.ts)  |
| `@okikio/input/commands`  | Declare reusable commands and coordinate their invocation.                        | [Contract](./commands.ts)  |
| `@okikio/input/pointer`   | Observe pointer input with explicit capture and cleanup behavior.                 | [Contract](./pointer.ts)   |
| `@okikio/input/types`     | Import public types for this capability; this entry does not start work.          | [Contract](./types.ts)     |

## Inspect forms and discover commands

`forms.issues(validation, fieldMap, bounds)` maps exact schema paths to explicitly named controls. A path
`['people', 0, 'name']` differs from `['people.0.name']`. Several control names may share one path. Form-wide, unknown
and shortened paths remain in `unmapped`; `capped` tells the UI when its report is incomplete. Supply maximum fields,
issues, path length and message code units. The application owns message redaction and focus.

`forms.dirty(current, defaults, { maximumEntries, order: 'per-field', equal: Object.is })` compares repeated occurrences
in order without reading File bodies. Use `order: 'entries'` when cross-field entry order matters. Supply another
equality function when File metadata, rather than identity, defines your defaults. Both lists are snapshotted before
comparisons. No control, default or submission is changed.

`commands.inspect(commands.values(catalog), { maximumItems, maximumTextCodeUnits })` creates callback-free metadata.
Dynamic eligibility is `unknown` unless the caller supplies an ID-based availability snapshot.
`commands.search(metadata, query, { maximumItems, maximumTextCodeUnits, maximumResults,
maximumQueryCodeUnits, includeDisabled })`
matches every case-insensitive literal token in authored order. This snapshot is discovery evidence; `commands.run()`
still checks actual eligibility.

## Persist shortcut choices

```ts
import * as keys from '@okikio/input/keys';
import * as codec from '@okikio/schema/codec';

const contract = keys.remapping(['document.save'], {
	maximumCommands: 1,
	maximumBindings: 4,
	maximumTextCodeUnits: 128,
	maximumComparisons: 6,
});
const saved = await codec.read(contract, {
	version: 1,
	bindings: [{ command: 'document.save', sequence: [{ key: 's', mod: true }] }],
});
// Resolve saved command IDs against the application's commands before keys.listen().
console.log(saved.bindings[0]?.command);
```

The identity codec rejects unknown commands, callback fields, invalid modifiers and proven same-scope, same-priority
equal or prefix collisions in either direction. An insufficient pair-comparison budget rejects validation rather than
accepting unchecked bindings. `keys.conflicts(bindings, bounds)` reports indices and whether its report was capped.
Key-versus-code overlap is a possible layout conflict, not a proven collision; remapping validation permits it.
Inspection never attaches listeners or invokes commands. The application owns storage, ID resolution and listener
disposal.

## Measure form and command collection

The focused benchmarks measure form values, key bindings and command discovery at configured scales. The benchmark
compares against direct FormData/native lookup references. Synthetic input does not establish browser user-activation or
device latency.

From the repository root, run the package's tests and untimed benchmark checks before collecting timings:

```sh
deno task --cwd=packages/input test
deno task --cwd=packages/input bench:check
deno task --cwd=packages/input bench
```

These commands use package-owned fixtures and development dependencies. The
[benchmark protocol](../../docs/benchmarks/01-running.md#choose-a-comparison-that-answers-the-question) explains fair
comparisons, raw report collection and the limits of local measurements.

## Use the additional focused operations

The focused entries also provide explicit transforms and host operations:

| Entry                     | Operation                                       | Ownership and limits                                                                                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@okikio/input/pointer`   | `wheel`, `samples`, `velocity`                  | Native units remain visible unless line/page CSS-pixel geometry is supplied. Coalesced samples keep host time order; equal timestamps are valid. Velocity uses endpoint displacement per millisecond with a scan bound. No animation or capture is acquired.                     |
| `@okikio/input/text`      | `edit`                                          | Native `setRangeText` capability, UTF-16 ranges, surrogate boundary rejection, explicit resulting-length budget, composition state and selection policy. Returns edited/blocked/unsupported. No synthetic events, focus or undo stack. Grapheme selection belongs to the editor. |
| `@okikio/input/files`     | `walk`                                          | Injected children/file adapter, lazy DFS, literal relative names, collision/cycle rejection and explicit entry/depth/file/declared-byte bounds. File bodies remain unread and borrowed.                                                                                          |
| `@okikio/input/clipboard` | `select`, `attempt`                             | Bounded lowercase MIME preference, original item identity, zero Blob reads during selection. One explicit rich read reports read/unsupported/denied/failed, preserving the host error. No permission retry.                                                                      |
| `@okikio/input/gamepad`   | `deadzone`, `calibrate`, `map`, `observeMapped` | Caller-authored extrema and action bindings, explicit missing-control policy and bounds. Use raw `read(..., { deadzone: 0 })` before calibration. Mapped Observables reuse the existing cold polling lifetime.                                                                   |

For directory walks, already yielded files remain partial output if a later entry fails. Abort stops delivery and
observes late host settlement; it cannot cancel operating-system enumeration or metadata requests. `onCleanup` receives
the actual iterator-release promise, which may remain pending for an uncooperative host. Early return requests every
active ancestor's release. Keep literal path components intact when mapping them to a storage API; that API still owns
filesystem containment and symlink policy.

Gamepad `observeMapped` uses `@okikio/observables` through the existing Input adapter. Each subscriber owns one polling
loop; unsubscribe cancels its scheduled frame. Values are synchronous projections, with no replay buffer or second task
engine. Empty device lists represent disconnection; physical-device permissions remain host-owned. Profile calibration
and named mapping do not persist devices.

## Try the focused operations as actual tasks

The operation table above is a reference. Use the complete programs when choosing one for an application:

| Task | Complete example | What the example establishes |
| --- | --- | --- |
| Replace selected text in a contact note | [Native textarea edit](../../docs/input/01-collection.md#edit-a-selected-contact-note-without-splitting-text) | Actual markup, selection, composition tracking, result budget, error display and listener removal. |
| Choose plain text from a rich contact card | [Clipboard metadata then one body read](../../docs/input/01-collection.md#choose-rich-clipboard-content-before-reading-it) | Selection order and no eager Blob reads; the local item does not test browser permissions. |
| Admit a folder of contact exports | [Bounded directory walk](../../docs/input/01-collection.md#walk-contact-exports-with-explicit-directory-budgets) | Lazy adapter traversal and independent entry/depth/file/byte limits, not native picker access. |
| Move through reports with real keys | [Browser navigation](../../docs/packages/13-input.md) | Focused markup, mounted bindings and teardown. |

These examples retain native capabilities rather than introducing an application input runtime. Applications decide
when user intent authorizes access and how selected data becomes saved state.

## Map a calibrated controller to a named action

Run `controller-action.ts` with `mise exec -- deno run controller-action.ts`. This uses a detached local snapshot to
teach the transform; it does not poll or test a physical gamepad.

```ts runnable=controller-action.ts
import * as gamepad from '@okikio/input/gamepad';
const raw = { id: 'local-controller', index: 0, mapping: '', axes: [0.6], buttons: [] };
const calibrated = gamepad.calibrate(raw, [{ minimum: -1, center: 0, maximum: 1, deadzone: 0.2 }], {
	maximumControls: 1,
});
const actions = gamepad.map(calibrated, [{ name: 'pan', kind: 'axis', index: 0 }], {
	maximumBindings: 1,
	missing: 'reject',
});
console.log(actions.pan?.toFixed(2));
```

```text output
0.50
```

Noise within 0.2 becomes zero; the remaining range is rescaled, so raw 0.6 becomes 0.5. An unknown axis rejects under
`missing: 'reject'`; select `'zero'` only when that fallback is intentional. In a real controller screen, read with
`deadzone: 0` before calibration to avoid applying noise removal twice. `observeMapped()` borrows the host and frame
scheduler, each subscriber owns a polling loop, and unsubscribing cancels that loop. Empty snapshots mean disconnect;
the application decides whether to pause navigation. Profiles do not identify or persist devices automatically.
