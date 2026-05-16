import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    files: 'integration/**/*.test.js',
    workspaceFolder: '.',
    mocha: {
        ui: 'bdd',
        timeout: 60000,
    },
    extensionDevelopmentPath: '..',
});
