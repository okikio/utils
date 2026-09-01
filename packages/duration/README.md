`@okikio/duration`
=================

Purpose
-------

`@okikio/duration` gives shared runtime code one deterministic way to convert and
compare Temporal durations.

Temporal durations such as `PT30S` are straightforward. Calendar durations such
as one month are different because their exact length depends on the date used
for comparison. This package owns one fixed calendar anchor so generic runtime
utilities do not each invent a different answer.

The package does **not** decide whether a duration is valid for a specific
operation. A timer can reject months, a retry policy can require positive time,
and a gateway can clamp JavaScript timer ranges. Those policies stay with the
caller.


Start here
----------

~~~~ts
import * as duration from '@okikio/duration';

const milliseconds = duration.milliseconds({ seconds: 2, milliseconds: 250 });
console.log(milliseconds);
// 2250
~~~~

Expected output:

~~~~text
2250
~~~~

Outcome: code that needs a numeric duration can use one shared Temporal
conversion rule instead of copying a relative-date choice into every package.


Calendar-aware comparison
-------------------------

~~~~ts
import * as duration from '@okikio/duration';

const order = duration.compare({ months: 1 }, { days: 31 });
console.log(order);
// 0
~~~~

Expected output:

~~~~text
0
~~~~

Outcome: both values are compared at the same deterministic calendar anchor, so
all callers agree about ordering even when calendar units are present.


Convenience and the manual equivalent
-------------------------------------

| Convenience | Manual equivalent | Concrete value |
| --- | --- | --- |
| `duration.milliseconds(value)` | call `Temporal.Duration.from(value).total({ unit: 'milliseconds', relativeTo })` with the same fixed `Temporal.PlainDate` everywhere | one deterministic conversion rule across utilities |
| `duration.compare(left, right)` | normalize both inputs and call `Temporal.Duration.compare(left, right, { relativeTo })` with the same fixed relative date | one deterministic ordering rule for calendar-bearing durations |

The underlying object model is still Temporal. The convenience functions only
centralize the relative-date mechanism.

~~~~ts
const relativeTo = Temporal.PlainDate.from('2000-01-01');
const value = Temporal.Duration.from({ months: 1 });
const milliseconds = value.total({ unit: 'milliseconds', relativeTo });

console.log(milliseconds);
// 2678400000
~~~~

Expected output:

~~~~text
2678400000
~~~~

Outcome: this is the lower-level operation that `duration.milliseconds()` keeps
consistent. Use the direct Temporal form when you intentionally need a
*different* calendar anchor because the date itself has domain meaning.


What callers still own
----------------------

A shared conversion must not silently become shared policy. For example:

- context timers can reject years and months;
- queue lease validation can require a positive duration;
- workflow retry code can translate Temporal errors into workflow-specific
  diagnostics;
- gateway runtime code can clamp a converted value to the JavaScript timer
  range.

That separation keeps this package generic.


Source guide
------------

Start with this README, then use the source in this order when you need more
detail:

1. `mod.ts` contains the two runtime operations and the private deterministic
   calendar anchor.
2. `types.ts` defines the accepted Temporal input shape.
3. `mod_test.ts` shows fixed-unit, calendar-unit, negative, and ordering
   behavior as executable examples.

The README is the primary user documentation. It stays close to the public
source instead of maintaining a separate hand-written API reference.
