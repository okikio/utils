/**
 * Turn user input into checked values and observable interactions through explicit host capabilities.
 *
 * Use forms to read repeated fields and validate their values. Select interaction modules for pointer,
 * keyboard, or file input, and feedback modules for optional host responses. The application decides what
 * accepted input changes and which browser capabilities it makes available.
 *
 * @module
 */
/** Named actions with ordinary typed input/output, reusable across independent input sources. */
export * as commands from './commands.ts';
/** Callback-first keyboard scopes and bounded sequences with explicit listener ownership. */
export * as keys from './keys.ts';
/** One accepted native pointer contact with capture, displacement and terminal cleanup. */
export * as pointer from './pointer.ts';
/** Drag, swipe, hold, scale and rotation measured as geometry rather than navigation policy. */
export * as gestures from './gestures.ts';
/** Committed text edits from native fields or small reader hosts, with optional Observable composition. */
export * as text from './text.ts';
/** Successful-control snapshots, lossless entries and explicit owned-schema validation. */
export * as forms from './forms.ts';
/** Bounded borrowed file selections from controls, native pickers and drop targets. */
export * as files from './files.ts';
/** Explicit clipboard reads/writes and synchronous user-paste snapshots. */
export * as clipboard from './clipboard.ts';
/** Detached control values and independently owned frame-polling observation. */
export * as gamepad from './gamepad.ts';
/** Optional tactile, audible, visual and accessible cues with honest host capabilities. */
export * as feedback from './feedback.ts';
export { editing } from './targets.ts';
export type { Command } from './commands.ts';
export type * from './types.ts';
