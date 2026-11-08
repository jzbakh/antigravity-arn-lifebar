'use strict';

const assert = require('node:assert/strict');
const { SUPPORT_PROMPT, minorVersion, shouldPromptSupport, supportLinks } = require('../../extension.js');

const stateWith = (entries) => ({ get: (key) => entries[key] });
const targetsOf = (links) => links.map(({ label, url }) => [label, new URL(url).host]);

describe('minorVersion', () => {
    it('keeps major and minor only', () => {
        assert.equal(minorVersion('1.3.0'), '1.3');
        assert.equal(minorVersion('2.10.7'), '2.10');
    });
});

describe('shouldPromptSupport', () => {
    it('prompts when nothing is stored yet', () => {
        assert.equal(shouldPromptSupport(stateWith({}), '1.3.0'), true);
    });

    it('skips patch releases of an already prompted minor version', () => {
        assert.equal(shouldPromptSupport(stateWith({ [SUPPORT_PROMPT.STATE_KEY]: '1.3' }), '1.3.2'), false);
    });

    it('prompts again on the next minor version', () => {
        assert.equal(shouldPromptSupport(stateWith({ [SUPPORT_PROMPT.STATE_KEY]: '1.3' }), '1.4.0'), true);
    });
});

describe('supportLinks', () => {
    it('offers a GitHub star and a Marketplace review in VS Code', () => {
        assert.deepEqual(targetsOf(supportLinks('Visual Studio Code')), [
            ['⭐ Drop GitHub Star', 'github.com'],
            ['🚀 Rate on Marketplace', 'marketplace.visualstudio.com'],
        ]);
    });

    it('offers an Open VSX review in other editors', () => {
        assert.deepEqual(targetsOf(supportLinks('Antigravity IDE')), [
            ['⭐ Drop GitHub Star', 'github.com'],
            ['🚀 Rate on Open VSX', 'open-vsx.org'],
        ]);
    });
});
