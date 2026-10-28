// Bundles the extension (and, with --tests, the integration tests) with esbuild.
import { build } from 'esbuild';

const production = process.argv.includes('--production');
const shared = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], sourcemap: !production, logLevel: 'info' };

await build({ ...shared, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', minify: production });
if (process.argv.includes('--tests')) {
  await build({ ...shared, entryPoints: ['test/integration/*.test.ts'], outdir: 'out/test/integration', outExtension: { '.js': '.cjs' } });
}
