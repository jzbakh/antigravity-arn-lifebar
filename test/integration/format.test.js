'use strict';

const assert = require('node:assert/strict');
const { CONFIG, colorDot, parseQuotaSummary, formatStatusBar, formatTooltip, formatResetTime } = require('../../extension.js');
const liveSummary = require('../fixtures/quota-summary.json');

const THRESHOLDS = CONFIG.UI.THRESHOLDS;
const DOT_BLACK = '⚫';
const DOT_RED = '🔴';
const DOT_ORANGE = '🟠';
const DOT_GREEN = '🟢';

const ARGON_GROUP = {
    displayName: 'Gemini 4 Argon',
    description: 'Models within this group: Gemini 4 Argon',
    buckets: [
        { bucketId: 'argon-weekly', displayName: 'Weekly Limit Remaining', window: 'weekly', remainingFraction: 0.9 },
        { bucketId: 'argon-5h', displayName: 'Five Hour Limit Remaining', window: '5h', remainingFraction: 0.6 },
    ],
};

const summaryOf = (groups) => ({ response: { groups } });
const liveGroups = () => structuredClone(liveSummary.response.groups);

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

    it('parses the payload returned by Antigravity IDE 2.5.5', () => {
        const [gemini, thirdParty] = parseQuotaSummary(liveSummary);
        assert.equal(gemini.label, 'Gemini Models');
        assert.equal(gemini.shortLabel, 'Gemini');
        assert.equal(gemini.buckets.length, 2);
        assert.equal(thirdParty.label, 'Claude and GPT models');
        assert.equal(thirdParty.shortLabel, 'Claude & GPT');
    });

    it('tracks a group with its own quota separately', () => {
        const groups = parseQuotaSummary(summaryOf([...liveGroups(), ARGON_GROUP]));
        assert.deepEqual(groups.map(g => g.shortLabel), ['Gemini', 'Claude & GPT', 'Gemini 4 Argon']);
    });

    it('follows the 5-hour window even when the weekly one is lower', () => {
        assert.equal(parseQuotaSummary(liveSummary)[0].gauge.bucketId, 'gemini-5h');

        const [group] = parseQuotaSummary(summaryOf([{
            displayName: 'Gemini Models',
            buckets: [
                { bucketId: 'weekly', window: 'weekly', remainingFraction: 0.22 },
                { bucketId: '5h', window: '5h', remainingFraction: 1 },
            ],
        }]));
        assert.equal(group.gauge.bucketId, '5h');
    });

    it('reports an exhausted weekly window even when the 5-hour one is full', () => {
        const [group] = parseQuotaSummary(summaryOf([{
            displayName: 'Gemini Models',
            buckets: [
                { bucketId: 'weekly', window: 'weekly', remainingFraction: 0 },
                { bucketId: '5h', window: '5h', remainingFraction: 1 },
            ],
        }]));
        assert.equal(group.gauge.bucketId, 'weekly');
    });

    it('falls back to the lowest window when there is no 5-hour one', () => {
        const [group] = parseQuotaSummary(summaryOf([{
            displayName: 'Preview Models',
            buckets: [
                { bucketId: 'weekly', window: 'weekly', remainingFraction: 0.6 },
                { bucketId: 'daily', window: 'daily', remainingFraction: 0.4 },
            ],
        }]));
        assert.equal(group.gauge.bucketId, 'daily');
    });

    it('ignores disabled buckets', () => {
        const [group] = parseQuotaSummary(summaryOf([{
            displayName: 'Gemini Models',
            buckets: [
                { bucketId: 'off', window: '5h', remainingFraction: 0, disabled: true },
                { bucketId: 'on', window: 'weekly', remainingFraction: 0.7 },
            ],
        }]));
        assert.deepEqual(group.buckets.map(b => b.bucketId), ['on']);
        assert.equal(group.gauge.bucketId, 'on');
    });

    it('tolerates groups with missing buckets', () => {
        const [group] = parseQuotaSummary(summaryOf([{ displayName: 'Gemini Models', buckets: null }]));
        assert.deepEqual(group.buckets, []);
        assert.equal(group.gauge, null);
    });
});

describe('formatStatusBar', () => {
    it('returns the placeholder when there is nothing to show', () => {
        assert.equal(formatStatusBar({}, []), '$(graph) ARN-Lifebar');
    });

    it('shows the 5-hour window of each group', () => {
        assert.equal(
            formatStatusBar({}, parseQuotaSummary(liveSummary)),
            `|  Gemini 13% ${DOT_RED} |  Claude & GPT 100% ${DOT_GREEN} |`
        );
    });

    it('shows 0% once the weekly window is exhausted', () => {
        const groups = parseQuotaSummary(summaryOf([{
            displayName: 'Gemini Models',
            buckets: [
                { window: 'weekly', remainingFraction: 0 },
                { window: '5h', remainingFraction: 1 },
            ],
        }]));
        assert.equal(formatStatusBar({}, groups), `|  Gemini 0% ${DOT_BLACK} |`);
    });

    it('gives a group with its own quota a dedicated entry', () => {
        const text = formatStatusBar({}, parseQuotaSummary(summaryOf([...liveGroups(), ARGON_GROUP])));
        assert.match(text, /Gemini 13%/);
        assert.match(text, /Gemini 4 Argon 60%/);
    });

    it('treats a bucket without remainingFraction as exhausted', () => {
        const groups = parseQuotaSummary(summaryOf([{ displayName: 'Gemini Models', buckets: [{ window: '5h' }] }]));
        assert.equal(formatStatusBar({}, groups), `|  Gemini 0% ${DOT_BLACK} |`);
    });

    it('hides groups without quota buckets', () => {
        const groups = parseQuotaSummary(summaryOf([{ displayName: 'Gemini Models', buckets: [] }]));
        assert.equal(formatStatusBar({}, groups), '$(graph) ARN-Lifebar');
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
});

describe('formatTooltip', () => {
    it('produces a multi-line tooltip with plan, credits and per-group limits', () => {
        const userStatus = {
            planStatus: {
                availablePromptCredits: 250,
                availableFlowCredits: 80,
                planInfo: { planName: 'Pro', monthlyPromptCredits: 500, monthlyFlowCredits: 100 },
            },
            userTier: { name: 'Pro Tier' }
        };
        const groups = parseQuotaSummary(summaryOf([{
            displayName: 'Gemini Models',
            description: 'Models within this group: Gemini Flash, Gemini Pro',
            buckets: [
                {
                    displayName: 'Weekly Limit Remaining',
                    window: 'weekly',
                    remainingFraction: 0.80,
                    resetTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 1000).toISOString(),
                },
                {
                    displayName: 'Five Hour Limit Remaining',
                    window: '5h',
                    remainingFraction: 0.50,
                    resetTime: new Date(Date.now() + 120 * 60000 + 1000).toISOString(),
                },
            ],
        }]));

        const tip = formatTooltip(userStatus, groups);
        assert.match(tip, /Plan: Pro Tier/);
        assert.match(tip, /Prompt credits: 250 \/ 500/);
        assert.match(tip, /Flow credits: 80 \/ 100/);
        assert.match(tip, /- Gemini Models/);
        assert.match(tip, /Models within this group: Gemini Flash, Gemini Pro/);
        assert.match(tip, /Weekly Limit: 80% \(Refreshes in 2 days, 0 hours\)/);
        assert.match(tip, /Five Hour Limit: 50% \(Refreshes in 2 hours, 0 minutes\)/);
        assert.match(tip, /ARN-Lifebar/);
    });

    it('lists limits the API introduces under their own names', () => {
        const groups = parseQuotaSummary(summaryOf([{
            displayName: 'Gemini 4 Argon',
            buckets: [{ displayName: 'Daily Limit Remaining', window: 'daily', remainingFraction: 0.4 }],
        }]));
        assert.match(formatTooltip({}, groups), /- Gemini 4 Argon\n {3}Daily Limit: 40%/);
    });

    it('uses ? placeholders when fields are missing', () => {
        const tip = formatTooltip({ planStatus: {}, userTier: {} }, []);
        assert.match(tip, /Plan: \?/);
        assert.match(tip, /Prompt credits: \? \/ \?/);
        assert.match(tip, /Flow credits: \? \/ \?/);
    });
});
