'use strict';

const assert = require('node:assert/strict');
const { CONFIG, colorDot, parseQuotaSummary, formatStatusBar, formatTooltip, formatResetTime } = require('../../extension.js');
const usedSummary = require('../fixtures/quota-summary.json');
const argonSummary = require('../fixtures/quota-summary-argon.json');

const THRESHOLDS = CONFIG.UI.THRESHOLDS;
const DOT_BLACK = '⚫';
const DOT_RED = '🔴';
const DOT_ORANGE = '🟠';
const DOT_GREEN = '🟢';

const summaryOf = (groups) => ({ response: { groups } });

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

    it('parses each group with its windows', () => {
        const [gemini, thirdParty] = parseQuotaSummary(usedSummary);
        assert.equal(gemini.label, 'Gemini Models');
        assert.equal(gemini.shortLabel, 'Flash & Pro');
        assert.equal(gemini.buckets.length, 2);
        assert.equal(thirdParty.label, 'Claude and GPT models');
        assert.equal(thirdParty.shortLabel, 'Claude & GPT');
    });

    it('tracks a group with its own quota separately', () => {
        const groups = parseQuotaSummary(argonSummary);
        assert.deepEqual(groups.map(g => g.shortLabel), ['Flash & Pro', 'Argon', 'Claude & GPT']);
    });

    it('lists third-party groups after Google ones', () => {
        assert.deepEqual(
            parseQuotaSummary(argonSummary).map(g => g.label),
            ['Gemini Models', 'Gemini 4 Argon', 'Claude and GPT models']
        );
    });

    it('names a group by its own name when its models span families', () => {
        const [group] = parseQuotaSummary(summaryOf([{
            displayName: 'Claude and GPT models',
            description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS',
            buckets: [],
        }]));
        assert.equal(group.shortLabel, 'Claude & GPT');
    });

    it('follows the 5-hour window even when the weekly one is lower', () => {
        assert.equal(parseQuotaSummary(usedSummary)[0].gauge.bucketId, 'gemini-5h');

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
            formatStatusBar({}, parseQuotaSummary(usedSummary)),
            `|  Flash & Pro 13% ${DOT_RED} |  Claude & GPT 100% ${DOT_GREEN} |`
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
        assert.equal(
            formatStatusBar({}, parseQuotaSummary(argonSummary)),
            `|  Flash & Pro 100% ${DOT_GREEN} |  Argon 100% ${DOT_GREEN} |  Claude & GPT 100% ${DOT_GREEN} |`
        );
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
    it('produces a multi-line tooltip with the plan and per-group limits', () => {
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
        assert.doesNotMatch(tip, /Prompt credits|Flow credits/);
        assert.match(tip, /- Gemini Models \(Gemini Flash, Gemini Pro\)\n/);
        assert.match(tip, /Weekly Limit: 80% \(Refreshes in 2 days, 0 hours\)/);
        assert.match(tip, /Five Hour Limit: 50% \(Refreshes in 2 hours, 0 minutes\)/);
        assert.match(tip, /ARN-Lifebar/);
    });

    it('lists limits the API introduces under their own names', () => {
        const groups = parseQuotaSummary(summaryOf([{
            displayName: 'Preview Models',
            buckets: [{ displayName: 'Daily Limit Remaining', window: 'daily', remainingFraction: 0.4 }],
        }]));
        assert.match(formatTooltip({}, groups), /- Preview Models\n {3}Daily Limit: 40%/);
    });

    it('names each group with its models without repeating it on its limits', () => {
        const tip = formatTooltip({}, parseQuotaSummary(argonSummary));
        assert.match(tip, /- Gemini Models \(Gemini Flash, Gemini Pro\)\n/);
        assert.match(tip, /- Gemini 4 Argon\n {3}Weekly Limit: 100%\n/);
        assert.match(tip, /- Claude and GPT models \(Claude Opus, Claude Sonnet, GPT-OSS\)\n/);
        assert.doesNotMatch(tip, /For paid Pro plans/);
    });

    it('shows the refresh time only once a limit is in use', () => {
        const resetTime = new Date(Date.now() + 60 * 60000 + 1000).toISOString();
        const groups = parseQuotaSummary(summaryOf([{
            displayName: 'Gemini Models',
            buckets: [
                { displayName: 'Weekly Limit Remaining', window: 'weekly', remainingFraction: 1, resetTime },
                { displayName: 'Five Hour Limit Remaining', window: '5h', remainingFraction: 0.5, resetTime },
            ],
        }]));
        const tip = formatTooltip({}, groups);
        assert.match(tip, /Weekly Limit: 100%\n/);
        assert.match(tip, /Five Hour Limit: 50% \(Refreshes in 1 hour, 0 minutes\)/);
    });

    it('uses a ? placeholder when the plan name is missing', () => {
        assert.match(formatTooltip({ planStatus: {}, userTier: {} }, []), /Plan: \?/);
    });
});
