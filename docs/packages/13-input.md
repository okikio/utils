# Collect input and own interactions

A person reading a list of reports can choose the next report with a button or a key. The selection should change only
when the person interacts with that list. The tutorial below builds that behavior with a keyboard listener on one
panel. A second example shows how to test what the action does without a browser.

For a different task, start with the [package quick start](../../packages/input/README.md). Read
[collection](../input/01-collection.md) for values such as form fields and files,
[interaction](../input/02-interaction.md) for actions from keys and other devices,
[feedback](../input/03-feedback.md) for showing a response, and [observation](../input/04-observation.md) for keeping
the display and its subscriptions in sync.

## Choose a report with a keyboard scope

Click the report panel, then press `j` to select Report 2 and `k` to return to Report 1. The example listens on that
panel, so typing elsewhere keeps its usual behavior. The app decides what each report means and stops the selection
at the first or last report.

Prepare the checkout from its root with `mise trust`, `mise install` and `mise run prepare -- --kind deps` after reviewing
`mise.toml`. Save the HTML as `report-navigation.html` and TypeScript as `report-navigation.ts`.

```html
<!doctype html>
<meta charset="utf-8">
<title>Choose a report</title>
<section id="reports" tabindex="0" aria-label="Report list">
  <p>Focus here, then press j or k.</p>
</section>
<p id="selected" role="status">Report 1</p>
<script type="module" src="report-navigation.js"></script>
```

```ts support=report-navigation.ts
import * as keys from '@okikio/input/keys';
const panel = document.querySelector<HTMLElement>('#reports')!;
const status = document.querySelector<HTMLElement>('#selected')!;
let index = 0;
/** Move within the three report choices; repeated keys must not leave that range. */
function select(amount: number): void {
	index = Math.max(0, Math.min(2, index + amount));
	status.textContent = `Report ${index + 1}`;
}

// Each offset moves relative to the current choice: +1 next, -1 previous.
const stop = keys.listen(panel, [
	{ key: 'j', run: () => select(1) },
	{ key: 'k', run: () => select(-1) },
]);
panel.focus();

// Teardown removes these listeners; a component should also stop when it unmounts.
window.addEventListener('pagehide', () => stop(), { once: true });
```

The browser loads the `.js` file named by the HTML script tag. The bundle command turns the TypeScript module and its
imports into that JavaScript file. The local HTTP server then serves the HTML and JavaScript to your browser.
Run these commands from the repository root:

```sh
mise exec -- deno bundle --platform browser report-navigation.ts -o report-navigation.js
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/report-navigation.html`. The status starts at Report 1. Focus the panel, press `j` twice,
and check for Report 3. A third press should leave it there. Move focus away from the panel and press `k`; the report
should stay at 3. Keep the server terminal open during the exercise, then stop it with Ctrl+C.
After TypeScript edits, rebuild the bundle and refresh the browser. The HTTP server serves this checkout locally; do not
expose it on a public address. The module owns its listeners and releases them on page exit. In an application, call its
teardown when removing the screen instead. The browser interaction is separate from the portable example checks below.

Importing `keys` does not install listeners. Calling `keys.listen` copies the supplied bindings and converts their keys
to lowercase. A binding can match one key or a sequence
of up to eight strokes. The third argument configures timeout, cancellation and active scopes. Editing controls and
visible dialogs keep their native keyboard behavior. Command IDs and labels remain caller-owned.

Swipes use pointer events across mouse, touch and pen and report physical direction. Native interruption cancels them.
The application owns touch-action and the meaning of a direction. Drag, hold and two-contact scale/rotation have
separate operations in the same gestures family. No global gesture arbitration runs across unrelated owners. Dispose
before removing the scope.

The unit suite uses small structural hosts and native DOM type fixtures for gesture ownership. The browser fixture
exercises native events, shadow DOM, editable modes and iframe realms. It does not establish browser rendering,
accessibility or device-specific touch behavior; test those in the consuming UI.

## Check command meaning without a browser

This portable check exercises the same selected-index rule; it does not prove keyboard dispatch or rendered focus.

After the [checkout setup](../../README.md#work-on-the-repository), run `mise run prepare -- --kind deps` from the root.
Save the next complete TypeScript block as
`report-selection.ts` at that root, then run `mise exec -- deno run report-selection.ts`.

```ts runnable=report-selection.ts
let index = 0;
const select = (amount: number) => {
	index = Math.max(0, Math.min(2, index + amount));
};
select(1);
console.log(`Report ${index + 1}`);
select(-1);
console.log(`Report ${index + 1}`);
```

```text output
Report 2
Report 1
```

## Without this utility

Attach keyboard and pointer listeners to a chosen scope. Track sequence state and elapsed time. Respect native
cancellation and reject gestures that belong to editing controls or another widget. Keep the exact listener functions so
teardown removes them. The utility supplies these rules; the application still owns command meaning, focus,
accessibility, and device checks.
