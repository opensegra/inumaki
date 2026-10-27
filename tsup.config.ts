import { defineConfig } from 'tsup';

export default defineConfig({
	entry: { index: 'src/index.ts' },
	format: ['esm'],
	// tsup's dts step injects `baseUrl`, which TypeScript 6 rejects as deprecated
	dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
	clean: true,
	target: 'node22',
	platform: 'node',
	sourcemap: true
});
