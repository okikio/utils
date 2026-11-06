/** Public cue authoring keeps hardware and cancellation outside retained configuration. @module */
import { create, CueSchema, define } from './feedback.ts';
import type { CueResult, CueType } from './feedback.ts';

const loaded: CueType = CueSchema.parse({ message: 'Saved' });
const cue = define(loaded);
const player = create({ status: { announce(_message: string) {} } });
const pending: Promise<CueResult> = player.play(cue, { volume: 0.5, reducedMotion: true });
void pending;

// @ts-expect-error A cue borrows no cancellation signal; cancellation belongs to each playback.
define({ tone: { signal: new AbortController().signal } });
// @ts-expect-error A custom oscillator needs PeriodicWave and is outside finite tone presets.
define({ tone: { wave: 'custom' } });
// @ts-expect-error The preference is an amplitude ratio, not a textual volume name.
void player.play(cue, { volume: 'quiet' });
