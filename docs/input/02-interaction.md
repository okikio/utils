# Connect an interaction to an application action

An action has application meaning: save this draft, select this row, or turn to the next page. A key, click, swipe or
gamepad supplies a way to request it. Keep the action's input independent from the device event when several sources
need to share it.

## Begin with a callback; name an action when reuse helps

`keys.listen(window, [{ key: 'j', run: () => select(1) }])` is a complete binding. A command is optional. When a menu,
keyboard and gesture share an action, `commands.define()` gives it a stable ID, label, eligibility predicate and typed
input/output. It acquires no resources.

After the [checkout setup](../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`input-command.ts` at that root, then run `mise exec -- deno run input-command.ts`.

```ts runnable=input-command.ts
import * as commands from '@okikio/input/commands';

const Move = commands.define({
	id: 'move',
	label: 'Move selection',
	enabled: (offset: number) => offset !== 0,
	invoke: (offset: number) => `Moved ${offset}`,
});
console.log(commands.enabled(Move, 0));
console.log(commands.run(Move, 1));
```

```text output
false
Moved 1
```

The first line is `false`: moving by zero is disabled. The second line is the action’s result when it receives a
nonzero offset. The device does not decide whether a move is allowed.

`run()` checks eligibility and throws `CommandDisabledError` before invoking a disabled action. Otherwise it returns the
action's exact result, including an unchanged Promise. A binding can use `enabled: () => commands.enabled(Move, 1)` to
leave the native event unclaimed, then `run: () => commands.run(Move, 1)`. `commands.catalog(name, entries)` is an
optional named collection for menu/palette discovery; it is not required to run an action.

The next options distinguish the character a user types from the physical key they press. For example, the same key
position can produce a different letter on another keyboard layout. A **modifier** is a held key such as Shift or Ctrl.
A **scope** is the application's named set of currently relevant shortcuts, such as a dialog or editor; it is not a
permission grant. Choose these policies so typing in a form does not accidentally trigger an application action.

## Keyboard rules are explicit

| Setting             | Meaning and default                                                              |
| ------------------- | -------------------------------------------------------------------------------- |
| `key`               | Logical character/name after the user's layout; spelling is case-normalized      |
| `code`              | Physical key location such as `KeyQ`; case-sensitive                             |
| `mod`               | Require Ctrl or Meta; use explicit `control`/`meta` when the distinction matters |
| `alt`, `shift`      | Exact states; omitted modifiers must be released                                 |
| `repeat`            | Held-key repeats are ignored unless true                                         |
| `editable`          | Editing targets keep their native behavior unless true                           |
| `scope`, `scopes()` | Ordered active scopes; default is global                                         |
| `priority`          | Larger values win inside one scope; default is zero                              |
| `sequenceMs`        | Time between strokes, default 900 ms; range 1 to 60000 ms                        |
| `capacity`          | Maximum authored bindings per owner; default 1024                                |

Use a string such as `'g g'` or an explicit `sequence` array for up to eight strokes. Focus changes, text composition and
timeout clear partial sequences. Composition is the provisional text entered through an input method, such as choosing
a character before committing it; a shortcut should not steal that interaction. Equal-priority duplicate or prefix shortcuts in the same scope reject before listeners
are installed. A physical code and logical key can identify the same event on some layouts; use different priorities if
that choice matters. Visible dialogs suppress global shortcuts. A selected modal scope can remain active, and small
hosts can supply `modal()` explicitly.

## Use native controls for activation and geometry for manipulation

Use a native button's `click` for ordinary activation so keyboard and assistive-technology users receive the same
action. Dragging, drawing and canvas manipulation need geometry. `pointer.listen()` retains a native PointerEvent,
including pen pressure, while reporting `clientX`/`clientY`, displacement `x`/`y`, and elapsed milliseconds. The
low-level listener owns one contact and releases capture before its terminal callback.

`gestures.drag()` reports `start`, `move`, `end` or `cancel`, with named `position`, `delta`, `distance`, `elapsed` and
average `velocity` in CSS pixels per millisecond. Its default four-pixel threshold leaves small clicks unannounced.
`swipe()` reports physical `left`, `right`, `up` or `down`; the application maps that direction to navigation. `press()`
reports one held contact after 500 ms unless movement exceeds ten pixels. `transform()` combines two contacts into
midpoint translation, relative scale and continuous accumulated rotation in degrees.

```ts support=canvas-gestures.ts
import * as gestures from '@okikio/input/gestures';
import { ms } from '@okikio/duration';

/** Borrow a mounted SVG surface; its screen must call the returned stop function on unmount. */
export function mountCanvas(surface: SVGSVGElement, draw: (scale: number, rotation: number) => void): () => void {
	const stop = gestures.transform(surface, ({ phase, scale, rotation }) => {
		// Start establishes the geometry; moves update it. End/cancel must not draw a new frame.
		if (phase === 'start' || phase === 'move') {
			draw(scale, rotation);
		}
	}, { capture: true });

	// Remove this recognizer's listeners and active gesture when the canvas leaves the screen.
	return () => stop();
}

export function mountHold(surface: HTMLElement, showMenu: () => void): () => void {
	return gestures.press(surface, showMenu, { duration: ms(450) });
}
```

Duration constructors select native Temporal or a local implementation without installing a global. Numeric gesture
durations mean milliseconds. Native cancellation, loss of capture and disposal end a session. An extra pointer cancels
single-contact recognizers. A transform tracks at most two contacts and cancels on an extra contact. Coincident contacts
establish a transform only after there is a nonzero separation.

Set CSS `touch-action` for the area where you recognize gestures. Pointer capture keeps sending events to the same
target. The browser can still pan the page. Configure `preventDefault` separately if you need it. By default, the
recognizers leave browser behavior alone and ignore gestures that start on an interactive control. For a custom
control, supply keyboard and accessibility behavior before setting `interactive: true`. [Pointer Events](https://www.w3.org/TR/pointerevents4/) defines these distinct policies.

## Read a gamepad or own one polling loop

`gamepad.read(navigator)` returns detached connected-device snapshots. Each contains ID/index, mapping, axes and button
values. Browser timestamp changes alone do not count as control changes. The default axis deadzone is 0.1; remaining
values are rescaled to keep the full range. Defaults inspect at most sixteen slots and sixty-four axes/buttons per
device. Raise those explicit limits if an intended device requires it.

```ts support=gamepad-controller.ts
import * as gamepad from '@okikio/input/gamepad';

export function mountController(show: (horizontal: number) => void): () => void {
	const stop = gamepad.watch(navigator, window, (devices) => {
		show(devices[0]?.axes[0] ?? 0);
	});
	return () => stop();
}
```

The host supplies `getGamepads`; the frame scheduler supplies `requestAnimationFrame` and `cancelAnimationFrame`. Tests
can provide both without a browser. A watcher emits its initial snapshot, then changed controls by default. Disconnect
produces a smaller or empty snapshot. It retains only current/previous snapshots and one scheduled frame. Abort or
teardown cancels that frame. `everyFrame: true` changes delivery policy explicitly. A source read failure stops polling
and reaches `onError`. Hardware haptics are a separate [feedback operation](./03-feedback.md), using a borrowed native
actuator rather than placing device-control methods on copied snapshots.
