import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  version: process.env.SHOW_ME_VSCODE_VERSION || 'stable',
  files: 'out/test/integration/**/*.test.cjs',
  workspaceFolder: 'test/fixtures/workspace',
  launchArgs: ['--disable-extensions', '--disable-workspace-trust'],
  env: { SHOW_ME_HOME: mkdtempSync(join(tmpdir(), 'sm')) },
  mocha: { ui: 'tdd', timeout: 30000 },
});
