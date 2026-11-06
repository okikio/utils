/** Explicit locale formatting without installing globals or inventing human parsing. @module */
import { from } from './units.ts';
import type { DurationInput, RoundOptions } from './types.ts';

/** Formatting policy is explicit so host locale and missing Intl support never silently decide output. */
export interface FormatOptionsType {
	/** Required BCP 47 locale or ordered fallback locales; an empty locale list rejects. */
	readonly locale: string | readonly string[];
	/** Intl duration style. @default 'short' */
	readonly style?: 'long' | 'short' | 'narrow' | 'digital';
	/** ISO is an explicit machine-readable fallback; reject refuses missing host support. */
	readonly fallback: 'iso' | 'reject';
	/** Optional Temporal rounding; calendar rounding needs its own relativeTo. */
	readonly rounding?: RoundOptions;
}

/** An explicitly selected locale formatter that can be reused across many values. */
export interface Formatter {
	/** Host Intl formatting or the explicitly selected ISO fallback. */
	readonly mode: 'intl' | 'iso';
	/** Format one duration; invalid values and rounding policies reject. */
	format(value: DurationInput): string;
}

/** The host has no Intl.DurationFormat and ISO fallback was not selected. */
export class DurationFormatUnsupportedError extends Error {
	constructor() {
		super('This host does not provide Intl.DurationFormat.');
		this.name = 'DurationFormatUnsupportedError';
	}
}

/** The minimal host contract keeps newer Intl types independent of the compiler's lib version. */
interface NativeFormatter {
	format(value: Temporal.DurationLikeObject): string;
}

/**
 * Capture an explicit locale, fallback, and optional rounding policy for reuse.
 * Missing Intl.DurationFormat selects ISO text only when fallback is `iso`;
 * invalid locales and options still throw. Nothing is installed on Intl or globalThis.
 */
export function create(options: FormatOptionsType): Formatter {
	const locales = typeof options.locale === 'string' ? [options.locale] : [...options.locale];
	if (locales.length === 0 || locales.some((locale) => typeof locale !== 'string' || locale.length === 0)) {
		throw new RangeError('Duration formatting requires at least one explicit locale.');
	}
	const canonical = Intl.getCanonicalLocales(locales);
	const style = options.style ?? 'short';
	if (!['long', 'short', 'narrow', 'digital'].includes(style) || !['iso', 'reject'].includes(options.fallback)) {
		throw new TypeError('Invalid duration formatting style or fallback.');
	}
	const Constructor = (Intl as unknown as {
		DurationFormat?: new (locales: string[], options: { style: string }) => NativeFormatter;
	}).DurationFormat;
	if (typeof Constructor !== 'function' && options.fallback === 'reject') throw new DurationFormatUnsupportedError();
	const formatter = typeof Constructor === 'function' ? new Constructor(canonical, { style }) : undefined;
	// Copy rounding fields once; later edits to the options object cannot change this formatter's policy.
	const rounding = options.rounding === undefined ? undefined : { ...options.rounding };
	return Object.freeze({
		mode: formatter === undefined ? 'iso' as const : 'intl' as const,
		format(value: DurationInput): string {
			const parsed = from(value);
			const rounded = rounding === undefined ? parsed : parsed.round(rounding);
			return formatter === undefined ? rounded.toString() : formatter.format(rounded);
		},
	});
}

/** Format once; use create() to avoid repeated locale-formatter construction in a hot path. */
export function format(value: DurationInput, options: FormatOptionsType): string {
	return create(options).format(value);
}
