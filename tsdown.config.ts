import { defineConfig } from 'tsdown';

/**
 * Build every public source module as a first-class neutral ESM entry.
 *
 * Unbundled output preserves package and subpath ownership so downstream bundlers
 * can remove unused modules instead of first unpacking one library bundle.
 * Tests, benchmarks, and fixtures remain source-only.
 */
export default defineConfig({
	entry: ['**/*.ts', '!**/*.test.ts', '!**/*.bench.ts', '!fixtures/**/*.ts'],
	outDir: 'dist',
	format: ['esm'],
	target: 'esnext',
	platform: 'neutral',
	dts: true,
	clean: true,
	unbundle: true,
	failOnWarn: true,
	publint: 'ci-only',
	attw: 'ci-only',
	deps: { neverBundle: [/^node:/] },
	outputOptions(outputOptions) {
		outputOptions.postBanner = (chunk) => {
			if (!chunk.isEntry) return '';
			const dtsPath = `./${chunk.fileName.replace(/\.js$/, '.d.ts').split('/').at(-1)}`;
			return `/* @ts-self-types="${dtsPath}" */`;
		};
		return outputOptions;
	},
	workspace: { include: ['packages/*'] },
});
