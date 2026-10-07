/** Stable tsdown projects source-owned public exports to additional npm artifacts. @module */
import type { InlineConfig } from 'tsdown';
import { defineConfig } from 'tsdown';
import { resolve } from 'node:path';

/** Preserve each package's source module structure, external dependencies, and both Node module contracts. */
export function projection(stage: string, entry: Record<string, string>, _root: string): InlineConfig {
	return {
		config: false,
		cwd: stage,
		entry,
		root: resolve(stage, 'src'),
		outDir: resolve(stage, 'dist'),
		format: ['esm', 'cjs'],
		platform: 'node',
		target: 'esnext',
		fixedExtension: true,
		dts: { generator: 'tsc' },
		tsconfig: resolve(stage, 'tsconfig.json'),
		clean: true,
		unbundle: true,
		failOnWarn: true,
		publint: false,
		attw: false,
		deps: {
			neverBundle: [/^@okikio\//, /^@std\//, /^node:/],
		},
	};
}

// Package staging owns the dynamic manifest inventory; invoking the CLI directly is deliberately unsupported.
export default defineConfig(() => {
	throw new Error('Use mise run npm-build or npm-verify so canonical exports are staged before tsdown builds them.');
});
