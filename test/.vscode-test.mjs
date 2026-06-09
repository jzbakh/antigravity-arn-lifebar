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
    extensionDevelopmentPath: '..',
    launchArgs: [
        '--user-data-dir', path.join(os.tmpdir(), 'arn-test-data')
    ]
});
