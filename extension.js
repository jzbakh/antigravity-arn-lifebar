const vscode = require('vscode');
const http = require('http');

const CONFIG = {
    POLLING: {
        MIN_INTERVAL_MS: 5000,
        // Google's extension can start its server minutes after the window: check at least once a minute.
        MAX_INTERVAL_MS: 60000,
    },
    TIMEOUTS: {
        RPC_MS: 8000,
    },
    ANTIGRAVITY_EXTENSION_ID: 'google.google-antigravity',
    UI: {
        THRESHOLDS: {
            RED: 24,
            ORANGE: 50,
        },
    },
};

function colorDot(pct) {
    if (pct === 0) return '⚫';
    if (pct <= CONFIG.UI.THRESHOLDS.RED) return '🔴';
    if (pct <= CONFIG.UI.THRESHOLDS.ORANGE) return '🟠';
    return '🟢';
}

function formatResetTime(resetTimeStr) {
    if (!resetTimeStr) return null;
    const resetTime = new Date(resetTimeStr);
    const now = new Date();
    const diffMs = resetTime - now;
    if (diffMs <= 0) return 'Refreshes soon';

    const diffMins = Math.floor(diffMs / 60000);
    const days = Math.floor(diffMins / (24 * 60));
    const hours = Math.floor((diffMins % (24 * 60)) / 60);
    const mins = diffMins % 60;

    if (days > 0) {
        return `Refreshes in ${days} day${days > 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`;
    } else if (hours > 0) {
        return `Refreshes in ${hours} hour${hours !== 1 ? 's' : ''}, ${mins} minute${mins !== 1 ? 's' : ''}`;
    } else {
        return `Refreshes in ${mins} minute${mins !== 1 ? 's' : ''}`;
    }
}

// Same rule as the IDE: a bucket without remainingFraction counts as 0%.
function remainingPct(bucket) {
    return Math.round((bucket.remainingFraction ?? 0) * 100);
}

function compactLabel(displayName) {
    return displayName.replace(/\s+models?$/i, '').replace(/\s+and\s+/gi, ' & ');
}

// "Models within this group: Gemini Flash, Gemini Pro" → ['Gemini Flash', 'Gemini Pro'].
function groupModels(description) {
    const list = description?.match(/^Models within this group:\s*(.+)$/)?.[1];
    return list ? list.split(/,\s*/) : [];
}

// Name a group by the models it covers ("Flash & Pro"), or by its own name
// without family and version ("Gemini 4 Argon" → "Argon").
function shortLabelOf(group) {
    const models = groupModels(group.description);
    const family = models[0]?.split(' ')[0];
    if (models.length > 1 && models.every(m => m.startsWith(`${family} `))) {
        return models.map(m => m.slice(family.length + 1)).join(' & ');
    }
    return compactLabel(group.displayName || '').replace(/^\S+ \d+(\.\d+)* (?=\S)/, '');
}

// Third-party groups come last; their bucket ids start with 3p-.
function isThirdParty(group) {
    return (group.buckets || []).some(b => b.bucketId?.startsWith('3p-'));
}

function bucketLabel(bucket, groupLabel) {
    const label = (bucket.displayName || bucket.window || 'Limit').replace(/\s+remaining$/i, '');
    return label.startsWith(`${groupLabel} `) ? label.slice(groupLabel.length + 1) : label;
}

// Report the 5-hour window, or 0% as soon as any window is exhausted.
function pickGauge(buckets) {
    const lowest = buckets.reduce((min, b) => (!min || remainingPct(b) < remainingPct(min) ? b : min), null);
    if (!lowest || remainingPct(lowest) === 0) return lowest;
    return buckets.find(b => b.window === '5h') ?? lowest;
}

function parseQuotaSummary(quotaSummary) {
    const groups = quotaSummary?.response?.groups || [];

    return [...groups].sort((a, b) => isThirdParty(a) - isThirdParty(b)).map((group) => {
        const label = group.displayName || '';
        const buckets = (group.buckets || []).filter(b => !b.disabled);

        return { label, shortLabel: shortLabelOf(group), description: group.description, buckets, gauge: pickGauge(buckets) };
    });
}

function formatStatusBar(userStatus, parsedGroups) {
    const parts = parsedGroups
        .filter(group => group.gauge)
        .map((group) => {
            const pct = remainingPct(group.gauge);
            return `  ${group.shortLabel} ${pct}% ${colorDot(pct)} `;
        });

    const googleCredits = userStatus?.userTier?.availableCredits?.find(c => c.creditType === 'GOOGLE_ONE_AI');
    if (googleCredits) parts.push(`  ${googleCredits.creditAmount} credits  `);

    return parts.length ? `|${parts.join('|')}|` : '$(graph) ARN-Lifebar';
}

function formatTooltip(userStatus, parsedGroups) {
    const plan = userStatus?.planStatus;
    const tier = userStatus?.userTier;

    const lines = [];
    if (plan || tier) {
        lines.push(`Plan: ${tier?.name ?? plan?.planInfo?.planName ?? '?'}`);

        const googleCredits = tier?.availableCredits?.find(c => c.creditType === 'GOOGLE_ONE_AI');
        if (googleCredits) {
            lines.push(`Google One AI credits: ${googleCredits.creditAmount}`);
        }
        lines.push('');
    }

    lines.push('Model quotas:');

    if (parsedGroups.length === 0) {
        lines.push('  No quota information available.');
    }

    for (const group of parsedGroups) {
        const models = groupModels(group.description);
        lines.push(`- ${group.label}${models.length ? ` (${models.join(', ')})` : ''}`);

        for (const bucket of group.buckets) {
            const pct = remainingPct(bucket);
            const reset = pct < 100 && formatResetTime(bucket.resetTime);
            lines.push(`   ${bucketLabel(bucket, group.label)}: ${pct}%${reset ? ` (${reset})` : ''}`);
        }
        lines.push('');
    }

    lines.push('ARN-Lifebar');
    return lines.join('\n');
}

// Google's Antigravity extension, built into Antigravity IDE 2.6+ and available for other
// editors, exports the port and csrf token of its local server once that server is up.
function serverOf(extension) {
    const api = extension?.isActive ? extension.exports : undefined;
    return api?.port && api.csrfToken ? { port: api.port, csrfToken: api.csrfToken } : null;
}

function backoff(interval) {
    return Math.min(interval * 2, CONFIG.POLLING.MAX_INTERVAL_MS);
}

class LifebarController {
    constructor(context) {
        this.context = context;
        this.server = null;
        this.pollTimer = null;
        this.currentPollInterval = CONFIG.POLLING.MIN_INTERVAL_MS;

        this.outputChannel = vscode.window.createOutputChannel('ARN-Lifebar');
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);

        this.statusBarItem.text = '$(graph) ARN-Lifebar...';
        this.statusBarItem.tooltip = 'Loading quotas...';

        this.context.subscriptions.push(this.outputChannel, this.statusBarItem);
        this.log('Controller initialized.');
    }

    log(msg, error = null) {
        const time = new Date().toLocaleTimeString();
        const errorStr = error ? ` | Err: ${error.message}` : '';
        this.outputChannel.appendLine(`[${time}] ${msg}${errorStr}`);
    }

    rpc(port, csrfToken, method, body) {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify(body);
            const options = {
                hostname: '127.0.0.1',
                port,
                path: `/exa.language_server_pb.LanguageServerService/${method}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Connect-Protocol-Version': '1',
                    'x-codeium-csrf-token': csrfToken,
                    'Content-Length': Buffer.byteLength(payload),
                },
            };

            const req = http.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                    catch { resolve({ status: res.statusCode, body: data }); }
                });
            });

            req.on('error', (err) => {
                this.log(`RPC Request Failed (${method})`, err);
                reject(err);
            });

            req.setTimeout(CONFIG.TIMEOUTS.RPC_MS, () => {
                req.destroy();
                const err = new Error(`Timeout (${CONFIG.TIMEOUTS.RPC_MS}ms) on ${method}`);
                this.log('RPC Timeout', err);
                reject(err);
            });

            req.write(payload);
            req.end();
        });
    }

    async refreshQuotas() {
        if (!this.server) {
            this.server = serverOf(vscode.extensions.getExtension(CONFIG.ANTIGRAVITY_EXTENSION_ID));
            if (!this.server) {
                this.statusBarItem.text = '$(graph) ARN-Lifebar — waiting for Antigravity';
                this.statusBarItem.tooltip = 'Quotas appear as soon as Antigravity starts in this window.';
                this.currentPollInterval = backoff(this.currentPollInterval);
                this.log(`Antigravity not found. Retrying in ${this.currentPollInterval / 1000}s`);
                return;
            }
            this.log(`Found Antigravity on port ${this.server.port}`);
        }
        try {
            const [statusRes, quotaRes] = await Promise.all([
                this.rpc(this.server.port, this.server.csrfToken, 'GetUserStatus', {}),
                this.rpc(this.server.port, this.server.csrfToken, 'RetrieveUserQuotaSummary', {})
            ]);

            if (statusRes.status === 200 && quotaRes.status === 200 && statusRes.body?.userStatus) {
                const { userStatus } = statusRes.body;
                const parsedGroups = parseQuotaSummary(quotaRes.body);

                this.statusBarItem.text = formatStatusBar(userStatus, parsedGroups);
                this.statusBarItem.tooltip = formatTooltip(userStatus, parsedGroups);
                this.currentPollInterval = CONFIG.POLLING.MIN_INTERVAL_MS;
            } else {
                this.log(`Unexpected API response status: GetUserStatus=${statusRes.status}, RetrieveUserQuotaSummary=${quotaRes.status}`);
                this.server = null;
                this.currentPollInterval = backoff(this.currentPollInterval);
            }
        } catch {
            this.server = null;
            this.statusBarItem.text = '$(graph) ARN-Lifebar — error';
            this.currentPollInterval = backoff(this.currentPollInterval);
        }
    }

    pollLoop() {
        this.refreshQuotas().finally(() => {
            this.pollTimer = setTimeout(() => this.pollLoop(), this.currentPollInterval);
        });
    }

    start() {
        this.statusBarItem.show();
        this.pollLoop();
    }

    forceRefresh() {
        this.log('Manual refresh triggered by user.');
        this.server = null;
        this.currentPollInterval = CONFIG.POLLING.MIN_INTERVAL_MS;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollLoop();
    }

    dispose() {
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.log('Controller disposed.');
    }
}

let lifebarController = null;

function activate(context) {
    lifebarController = new LifebarController(context);

    context.subscriptions.push(vscode.commands.registerCommand('antigravity-arn-lifebar.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openAntigravitySettings');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('antigravity-arn-lifebar.refresh', () => {
        if (lifebarController) lifebarController.forceRefresh();
    }));

    lifebarController.start();
}

function deactivate() {
    if (lifebarController) {
        lifebarController.dispose();
        lifebarController = null;
    }
}

// Exposed for unit tests — not part of the public extension API.
module.exports = { activate, deactivate, CONFIG, colorDot, parseQuotaSummary, formatStatusBar, formatTooltip, formatResetTime, serverOf, backoff };
