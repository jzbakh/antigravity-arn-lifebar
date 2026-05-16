'use strict';

const assert = require('node:assert/strict');
const vscode = require('vscode');

const EXTENSION_ID = 'jzbakh.antigravity-arn-lifebar';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('Extension integration', () => {
    let ext;

    before(async function () {
        this.timeout(30000);
        ext = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(ext, `extension ${EXTENSION_ID} should be discoverable`);
        await ext.activate();
        assert.equal(ext.isActive, true, 'extension should be active after activate()');
    });

    it('is loaded from the development path under test', () => {
        assert.match(
            ext.extensionPath.replace(/\\/g, '/'),
            /antigravity-arn-lifebar/,
            `extensionPath should resolve to the project root, got: ${ext.extensionPath}`
        );
    });

    it('declares the expected manifest contributions', () => {
        const pkg = ext.packageJSON;
        assert.equal(pkg.name, 'antigravity-arn-lifebar');
        assert.equal(pkg.publisher, 'jzbakh');
        assert.equal(pkg.main, './extension.js');
        const cmdTitles = (pkg.contributes?.commands ?? []).map((c) => c.command);
        assert.ok(cmdTitles.includes('antigravity-arn-lifebar.openSettings'));
        assert.ok(cmdTitles.includes('antigravity-arn-lifebar.refresh'));
    });

    it('registers both commands at runtime', async () => {
        const cmds = await vscode.commands.getCommands(true);
        assert.ok(cmds.includes('antigravity-arn-lifebar.openSettings'));
        assert.ok(cmds.includes('antigravity-arn-lifebar.refresh'));
    });

    it('executes the refresh command without throwing', async () => {
        await assert.doesNotReject(
            vscode.commands.executeCommand('antigravity-arn-lifebar.refresh'),
            'refresh command should run without throwing in a test environment'
        );
    });

    it('keeps the controller alive through one polling cycle', async function () {
        this.timeout(15000);
        // 8s covers one full LS discovery + back-off attempt on the slowest CI runner.
        await wait(8000);
        assert.equal(ext.isActive, true, 'extension should still be active after a polling cycle');
    });
});
