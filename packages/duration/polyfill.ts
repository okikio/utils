// temporal.ts

import { Temporal as PolyfillTemporal } from "@js-temporal/polyfill";

/**
 * Uses the runtime Temporal implementation when available and falls back to
 * the reference-compatible implementation on runtimes that do not provide it.
 */
export const Temporal: typeof PolyfillTemporal =
  (globalThis as { Temporal?: typeof PolyfillTemporal }).Temporal ??
  PolyfillTemporal;