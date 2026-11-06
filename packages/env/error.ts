import type { EnvironmentIssue } from './types.ts';

/**
 * Error raised when environment composition or validation fails.
 *
 * The message includes one line per issue for logs and startup diagnostics.
 * `issues` retains the same failures as structured data so callers do not need
 * to parse that message when presenting or classifying configuration errors.
 */
export class EnvironmentError extends Error {
	/** Stable native error name for environment-validation failures. */
	override readonly name = 'EnvironmentError';
	/** Normalized field and composition failures associated with this error. */
	readonly issues: readonly EnvironmentIssue[];

	/** Copy structured issues and render their already-redacted messages for startup logs. */
	constructor(message: string, issues: readonly EnvironmentIssue[]) {
		const details = issues.map((issue) => `${issue.key}: ${issue.message}`);
		super(details.length > 0 ? `${message}\n${details.join('\n')}` : message);
		this.issues = [...issues];
	}
}

/** A validator implementation failed; this is distinct from rejected configuration data. */
export class EnvironmentValidatorError extends Error {
	/** Authored environment field whose validator failed. */
	readonly key: string;
	/** Secret validators deliberately omit their possibly secret-bearing cause. */
	constructor(key: string, cause?: unknown) {
		super('Environment validator failed for ' + JSON.stringify(key) + '.', cause === undefined ? undefined : { cause });
		this.name = 'EnvironmentValidatorError';
		this.key = key;
	}
}
