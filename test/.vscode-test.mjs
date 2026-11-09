import { defineConfig } from '@vscode/test-cli';
import * as os from 'node:os';
import * as path from 'node:path';

export default defineConfig({
    files: 'integration/**/*.test.js',
    workspaceFolder: '.',
    mocha: {
        ui: 'bdd',
        timeout: 60000,
    },
    // The second extension stands in for Google's Antigravity extension.
    extensionDevelopmentPath: ['..', 'fixtures/google-antigravity'],
    launchArgs: [
        '--user-data-dir', path.join(os.tmpdir(), 'arn-test-data')
    ]
});
