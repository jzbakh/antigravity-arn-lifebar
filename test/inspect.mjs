// Opens the cached test VS Code with the extension loaded; window stays open for manual inspection.

import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = resolve(here, '..');

console.log('Resolving cached VS Code…');
const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');

console.log(`Launching: ${vscodeExecutablePath}`);
console.log(`Extension dev path: ${extensionDevelopmentPath}`);
console.log('Close the window when done.');

const child = spawn(
    vscodeExecutablePath,
    [
        `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
        '--disable-extensions',
        '--new-window',
        '--user-data-dir', resolve(here, '.vscode-test', 'inspect-user-data'),
        '--extensions-dir', resolve(here, '.vscode-test', 'inspect-extensions'),
    ],
    { stdio: 'inherit', detached: true }
);

child.unref();
