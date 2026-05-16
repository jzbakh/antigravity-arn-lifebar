'use strict';

const assert = require('node:assert/strict');
const { CONFIG, colorDot, getModelGroups, formatStatusBar, formatTooltip } = require('../../extension.js');

const THRESHOLDS = CONFIG.UI.THRESHOLDS;
const DOT_BLACK = '⚫';
const DOT_RED = '🔴';
const DOT_ORANGE = '🟠';
const DOT_GREEN = '🟢';

describe('colorDot', () => {
    it('returns black dot when pct is null', () => {
        assert.equal(colorDot(null), DOT_BLACK);
    });

    it('returns red dot at and below RED threshold', () => {
        assert.equal(colorDot(0), DOT_RED);
        assert.equal(colorDot(1), DOT_RED);
        assert.equal(colorDot(THRESHOLDS.RED), DOT_RED);
    });

    it('returns orange dot above RED and up to ORANGE threshold', () => {
        assert.equal(colorDot(THRESHOLDS.RED + 1), DOT_ORANGE);
        assert.equal(colorDot(THRESHOLDS.ORANGE), DOT_ORANGE);
    });

    it('returns green dot above ORANGE threshold', () => {
        assert.equal(colorDot(THRESHOLDS.ORANGE + 1), DOT_GREEN);
        assert.equal(colorDot(100), DOT_GREEN);
    });
});

describe('getModelGroups', () => {
    it('returns nulls for an empty models array', () => {
        assert.deepEqual(getModelGroups([]), { gPro: null, gFlash: null, other: null });
    });

    it('classifies Gemini Pro / Flash / Other by label keywords', () => {
        const models = [
            { label: 'Gemini 2.5 Pro', quotaInfo: { remainingFraction: 0.75 } },
            { label: 'Gemini 2.0 Flash', quotaInfo: { remainingFraction: 0.30 } },
            { label: 'Claude Sonnet 4', quotaInfo: { remainingFraction: 0.10 } },
        ];
        assert.deepEqual(getModelGroups(models), { gPro: 75, gFlash: 30, other: 10 });
    });

    it('keeps the first occurrence in each bucket (no overwrite)', () => {
        const models = [
            { label: 'Gemini Pro A', quotaInfo: { remainingFraction: 0.90 } },
            { label: 'Gemini Pro B', quotaInfo: { remainingFraction: 0.10 } },
        ];
        assert.equal(getModelGroups(models).gPro, 90);
    });

    it('returns null pct when quotaInfo.remainingFraction is missing', () => {
        const models = [{ label: 'Gemini Pro', quotaInfo: {} }];
        assert.equal(getModelGroups(models).gPro, null);
    });

    it('tolerates missing label without throwing', () => {
        const models = [{ quotaInfo: { remainingFraction: 0.5 } }];
        assert.equal(getModelGroups(models).other, 50);
    });

    it('rounds percentages to nearest integer', () => {
        const models = [{ label: 'Gemini Pro', quotaInfo: { remainingFraction: 0.876 } }];
        assert.equal(getModelGroups(models).gPro, 88);
    });
});

describe('formatStatusBar', () => {
    it('returns the loading placeholder when planStatus is missing', () => {
        assert.equal(formatStatusBar({}), '$(graph) ARN-Lifebar');
    });

    it('formats Pro / Flash / Other percentages with colored dots', () => {
        const userStatus = {
            planStatus: { availablePromptCredits: 100, planInfo: { monthlyPromptCredits: 500 } },
            userTier: { name: 'Premium', availableCredits: [] },
            cascadeModelConfigData: {
                clientModelConfigs: [
                    { label: 'Gemini 2.5 Pro', quotaInfo: { remainingFraction: 0.80 } },
                    { label: 'Gemini 2.0 Flash', quotaInfo: { remainingFraction: 0.40 } },
                    { label: 'Claude Sonnet', quotaInfo: { remainingFraction: 0.15 } },
                ],
            },
        };
        const text = formatStatusBar(userStatus);
        assert.match(text, /Pro 80%/);
        assert.match(text, /Flash 40%/);
        assert.match(text, /Other 15%/);
        assert.ok(text.includes(DOT_GREEN), 'expected green dot for 80%');
        assert.ok(text.includes(DOT_ORANGE), 'expected orange dot for 40%');
        assert.ok(text.includes(DOT_RED), 'expected red dot for 15%');
    });

    it('appends the GOOGLE_ONE_AI credits suffix when present', () => {
        const userStatus = {
            planStatus: {},
            userTier: {
                availableCredits: [
                    { creditType: 'GOOGLE_ONE_AI', creditAmount: 1500 },
                ],
            },
            cascadeModelConfigData: { clientModelConfigs: [] },
        };
        assert.match(formatStatusBar(userStatus), /1500 credits/);
    });

    it('omits the credits suffix when no GOOGLE_ONE_AI credit entry exists', () => {
        const userStatus = {
            planStatus: {},
            userTier: { availableCredits: [{ creditType: 'OTHER', creditAmount: 99 }] },
            cascadeModelConfigData: { clientModelConfigs: [] },
        };
        assert.doesNotMatch(formatStatusBar(userStatus), /credits/);
    });

    it('falls back to 0% for missing model buckets', () => {
        const userStatus = {
            planStatus: {},
            userTier: { availableCredits: [] },
            cascadeModelConfigData: { clientModelConfigs: [] },
        };
        const text = formatStatusBar(userStatus);
        assert.match(text, /Pro 0%/);
        assert.match(text, /Flash 0%/);
        assert.match(text, /Other 0%/);
    });
});

describe('formatTooltip', () => {
    it('produces a multi-line tooltip with plan + credits + per-model quota', () => {
        const userStatus = {
            planStatus: {
                availablePromptCredits: 250,
                availableFlowCredits: 80,
                planInfo: { planName: 'Pro', monthlyPromptCredits: 500, monthlyFlowCredits: 100 },
            },
            userTier: { name: 'Pro Tier' },
            cascadeModelConfigData: {
                clientModelConfigs: [
                    { label: 'Gemini Pro', quotaInfo: { remainingFraction: 0.5 } },
                ],
            },
        };
        const tip = formatTooltip(userStatus);
        assert.match(tip, /Plan: Pro Tier/);
        assert.match(tip, /Prompt credits: 250 \/ 500/);
        assert.match(tip, /Flow credits: 80 \/ 100/);
        assert.match(tip, /Gemini Pro: 50%/);
        assert.match(tip, /ARN-Lifebar \| Click to open Settings/);
    });

    it('uses ? placeholders when fields are missing', () => {
        const tip = formatTooltip({ planStatus: {}, userTier: {}, cascadeModelConfigData: {} });
        assert.match(tip, /Plan: \?/);
        assert.match(tip, /Prompt credits: \? \/ \?/);
        assert.match(tip, /Flow credits: \? \/ \?/);
    });
});
