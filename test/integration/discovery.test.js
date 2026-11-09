'use strict';

const assert = require('node:assert/strict');
const { serverOf } = require('../../extension.js');

const TOKEN = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const extensionWith = (exports, isActive = true) => ({ isActive, exports });

describe('serverOf', () => {
    it('finds no server when the extension is missing', () => {
        assert.equal(serverOf(undefined), null);
    });

    it('waits until the extension is active', () => {
        assert.equal(serverOf(extensionWith(undefined, false)), null);
    });

    it('waits until its server has a port', () => {
        assert.equal(serverOf(extensionWith({ csrfToken: TOKEN, port: undefined })), null);
    });

    it('reads the port and csrf token the extension exports', () => {
        assert.deepEqual(
            serverOf(extensionWith({ csrfToken: TOKEN, port: 61330, client: {} })),
            { port: 61330, csrfToken: TOKEN }
        );
    });
});
