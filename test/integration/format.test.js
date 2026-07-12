'use strict';

const assert = require('node:assert/strict');
const { CONFIG, colorDot, parseQuotaSummary, formatStatusBar, formatTooltip, formatResetTime } = require('../../extension.js');

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
        assert.equal(colorDot(1), DOT_RED);
        assert.equal(colorDot(THRESHOLDS.RED), DOT_RED);
    });

    it('returns black dot when pct is 0 (empty)', () => {
        assert.equal(colorDot(0), DOT_BLACK);
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

describe('formatResetTime', () => {
    it('returns null when resetTime is missing', () => {
        assert.equal(formatResetTime(null), null);
    });

    it('returns Refreshes soon when time is in the past', () => {
        const past = new Date(Date.now() - 60000).toISOString();
        assert.equal(formatResetTime(past), 'Refreshes soon');
    });

    it('formats days and hours properly', () => {
        const future = new Date(Date.now() + (2 * 24 * 60 * 60 * 1000) + (3 * 60 * 60 * 1000) + 5000).toISOString();
        assert.equal(formatResetTime(future), 'Refreshes in 2 days, 3 hours');
    });

    it('formats hours and minutes properly', () => {
        const future = new Date(Date.now() + (4 * 60 * 60 * 1000) + (15 * 60 * 1000) + 5000).toISOString();
        assert.equal(formatResetTime(future), 'Refreshes in 4 hours, 15 minutes');
    });

    it('formats minutes properly', () => {
        const future = new Date(Date.now() + (45 * 60 * 1000) + 5000).toISOString();
        assert.equal(formatResetTime(future), 'Refreshes in 45 minutes');
    });
});

describe('parseQuotaSummary', () => {
    it('returns empty array when summary is missing', () => {
        assert.deepEqual(parseQuotaSummary(null), []);
        assert.deepEqual(parseQuotaSummary({}), []);
    });

    it('extracts weekly and 5h buckets properly', () => {
        const payload = {
            response: {
                groups: [
                    {
                        displayName: 'Claude',
                        buckets: [
                            { window: '5h', remainingFraction: 0.1 },
                            { window: 'weekly', remainingFraction: 0.5 }
                        ]
                    }
                ]
            }
        };
        const res = parseQuotaSummary(payload);
        assert.equal(res.length, 1);
        assert.equal(res[0].label, 'Claude');
        assert.equal(res[0].shortLabel, 'Claude & GPT');
        assert.equal(res[0].fiveHour.remainingFraction, 0.1);
        assert.equal(res[0].weekly.remainingFraction, 0.5);
    });

    it('tolerates groups with missing buckets', () => {
        const payload = {
            response: {
                groups: [
                    {
                        displayName: 'Gemini',
                        buckets: null
                    }
                ]
            }
        };
        const res = parseQuotaSummary(payload);
        assert.equal(res.length, 1);
        assert.equal(res[0].shortLabel, 'Gemini');
        assert.equal(res[0].fiveHour, null);
        assert.equal(res[0].weekly, null);
    });
});

describe('formatStatusBar', () => {
    it('returns the loading placeholder when planStatus is missing and no groups', () => {
        assert.equal(formatStatusBar({}, []), '$(graph) ARN-Lifebar');
    });

    it('formats percentages with colored dots based on 5-hour limit', () => {
        const userStatus = {
            planStatus: { availablePromptCredits: 100, planInfo: { monthlyPromptCredits: 500 } },
            userTier: { name: 'Premium', availableCredits: [] }
        };
        const parsedGroups = [
            { shortLabel: 'Gemini', fiveHour: { remainingFraction: 0.80 } },
            { shortLabel: 'Claude & GPT', fiveHour: { remainingFraction: 0.15 } },
        ];
        const text = formatStatusBar(userStatus, parsedGroups);
        assert.match(text, /Gemini 80%/);
        assert.match(text, /Claude & GPT 15%/);
        assert.ok(text.includes(DOT_GREEN), 'expected green dot for 80%');
        assert.ok(text.includes(DOT_RED), 'expected red dot for 15%');
    });

    it('appends the GOOGLE_ONE_AI credits suffix when present', () => {
        const userStatus = {
            planStatus: {},
            userTier: {
                availableCredits: [
                    { creditType: 'GOOGLE_ONE_AI', creditAmount: 1500 },
                ],
            }
        };
        assert.match(formatStatusBar(userStatus, []), /1500 credits/);
    });

    it('omits the credits suffix when no GOOGLE_ONE_AI credit entry exists', () => {
        const userStatus = {
            planStatus: {},
            userTier: { availableCredits: [{ creditType: 'OTHER', creditAmount: 99 }] }
        };
        assert.doesNotMatch(formatStatusBar(userStatus, []), /credits/);
    });

    it('falls back to 0% for missing 5h bucket', () => {
        const userStatus = {
            planStatus: {},
            userTier: { availableCredits: [] }
        };
        const parsedGroups = [
            { shortLabel: 'Gemini', fiveHour: null }
        ];
        const text = formatStatusBar(userStatus, parsedGroups);
        assert.match(text, /Gemini 0%/);
    });
});

describe('formatTooltip', () => {
    it('produces a multi-line tooltip with plan + credits + per-model quotas', () => {
        const userStatus = {
            planStatus: {
                availablePromptCredits: 250,
                availableFlowCredits: 80,
                planInfo: { planName: 'Pro', monthlyPromptCredits: 500, monthlyFlowCredits: 100 },
            },
            userTier: { name: 'Pro Tier' }
        };
        const parsedGroups = [
            {
                label: 'Gemini Pro',
                weekly: { remainingFraction: 0.80, resetTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 1000).toISOString() },
                fiveHour: { remainingFraction: 0.50, resetTime: new Date(Date.now() + 120 * 60000 + 1000).toISOString() }
            }
        ];
        
        const tip = formatTooltip(userStatus, parsedGroups);
        assert.match(tip, /Plan: Pro Tier/);
        assert.match(tip, /Prompt credits: 250 \/ 500/);
        assert.match(tip, /Flow credits: 80 \/ 100/);
        assert.match(tip, /- Gemini Pro/);
        assert.match(tip, /Weekly Limit: 80%/);
        assert.match(tip, /Refreshes in 2 days, 0 hours/);
        assert.match(tip, /Five Hour Limit: 50%/);
        assert.match(tip, /Refreshes in 2 hours, 0 minutes/);
        assert.match(tip, /ARN-Lifebar/);
    });

    it('uses ? placeholders when fields are missing', () => {
        const tip = formatTooltip({ planStatus: {}, userTier: {} }, []);
        assert.match(tip, /Plan: \?/);
        assert.match(tip, /Prompt credits: \? \/ \?/);
        assert.match(tip, /Flow credits: \? \/ \?/);
    });
});
