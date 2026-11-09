const vscode = require('vscode');
const http = require('http');

const CONFIG = {
    POLLING: {
        MIN_INTERVAL_MS: 5000,
        MAX_INTERVAL_MS: 600000,
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
    if (pct === null || pct === 0) return '⚫';
    if (pct <= CONFIG.UI.THRESHOLDS.RED) return '🔴';
    if (pct <= CONFIG.UI.THRESHOLDS.ORANGE) return '🟠';
    return '🟢';
}

function formatResetTime(resetTimeStr) {
    if (!resetTimeStr) return null;
    const resetTime = new Date(resetTimeStr);
    const now = new Date();
    const diffMs = resetTime - now;
    if (diffMs <= 0) return "Refreshes soon";

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

function parseQuotaSummary(quotaSummary) {
    const groups = quotaSummary?.response?.groups || [];
    const parsed = [];

    for (const group of groups) {
        let weekly = null;
        let fiveHour = null;

        for (const b of (group.buckets || [])) {
            if (b.window === 'weekly') weekly = b;
            if (b.window === '5h') fiveHour = b;
        }

        let label = group.displayName || '';
        let shortLabel = label;
        if (label.toLowerCase().includes('gemini')) shortLabel = 'Gemini';
        else if (label.toLowerCase().includes('claude')) shortLabel = 'Claude & GPT';

        parsed.push({
            label,
            shortLabel,
            weekly,
            fiveHour
        });
    }
    return parsed;
}

function formatStatusBar(userStatus, parsedGroups) {
    const plan = userStatus?.planStatus;
    const tier = userStatus?.userTier;
    if (!plan && parsedGroups.length === 0) return '$(graph) ARN-Lifebar';

    const fmtPct = (bucket) => {
        if (!bucket || bucket.remainingFraction === undefined || bucket.remainingFraction === null) return '0%';
        return `${Math.round(bucket.remainingFraction * 100)}%`;
    };

    const getPctNum = (bucket) => {
        if (!bucket || bucket.remainingFraction === undefined || bucket.remainingFraction === null) return 0;
        return Math.round(bucket.remainingFraction * 100);
    };

    let textParts = [];
    for (const group of parsedGroups) {
        const pctStr = fmtPct(group.fiveHour);
        const pctNum = getPctNum(group.fiveHour);
        textParts.push(`  ${group.shortLabel} ${pctStr} ${colorDot(pctNum)} `);
    }

    const googleCredits = tier?.availableCredits?.find(c => c.creditType === 'GOOGLE_ONE_AI');
    const aiCredits = googleCredits ? googleCredits.creditAmount : null;

    let text = `|` + textParts.join('|');
    if (aiCredits !== null) text += `|  ${aiCredits} credits  `;
    text += `|`;

    return text;
}

function formatTooltip(userStatus, parsedGroups) {
    const plan = userStatus?.planStatus;
    const tier = userStatus?.userTier;

    const lines = [];
    if (plan || tier) {
        lines.push(`Plan: ${tier?.name ?? plan?.planInfo?.planName ?? '?'}`);
        lines.push(`Prompt credits: ${plan?.availablePromptCredits ?? '?'} / ${plan?.planInfo?.monthlyPromptCredits ?? '?'}`);
        lines.push(`Flow credits: ${plan?.availableFlowCredits ?? '?'} / ${plan?.planInfo?.monthlyFlowCredits ?? '?'}`);

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

    const fmtPct = (bucket) => {
        if (!bucket || bucket.remainingFraction === undefined || bucket.remainingFraction === null) return '0%';
        return `${Math.round(bucket.remainingFraction * 100)}%`;
    };

    for (const group of parsedGroups) {
        lines.push(`- ${group.label}`);

        if (group.weekly) {
            let wkText = `   Weekly Limit: ${fmtPct(group.weekly)}`;
            const resetWk = formatResetTime(group.weekly.resetTime);
            if (resetWk) wkText += ` (${resetWk})`;
            lines.push(wkText);
        }
        if (group.fiveHour) {
            let fhText = `   Five Hour Limit: ${fmtPct(group.fiveHour)}`;
            const resetFh = formatResetTime(group.fiveHour.resetTime);
            if (resetFh) fhText += ` (${resetFh})`;
            lines.push(fhText);
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

class LifebarController {
    constructor(context) {
        this.context = context;
        this.server = null;
        this.pollTimer = null;
        this.currentPollInterval = CONFIG.POLLING.MIN_INTERVAL_MS;

        this.outputChannel = vscode.window.createOutputChannel("ARN-Lifebar");
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);

        this.statusBarItem.text = '$(graph) ARN-Lifebar...';
        this.statusBarItem.tooltip = 'Loading quotas...';

        this.context.subscriptions.push(this.outputChannel, this.statusBarItem);
        this.log("Controller initialized.");
    }

    log(msg, error = null) {
        if (!this.outputChannel) return;
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
                this.currentPollInterval = Math.min(this.currentPollInterval * 2, CONFIG.POLLING.MAX_INTERVAL_MS);
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
                this.currentPollInterval = Math.min(this.currentPollInterval * 2, CONFIG.POLLING.MAX_INTERVAL_MS);
            }
        } catch (e) {
            this.server = null;
            this.statusBarItem.text = '$(graph) ARN-Lifebar — error';
            this.currentPollInterval = Math.min(this.currentPollInterval * 2, CONFIG.POLLING.MAX_INTERVAL_MS);
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
        this.log("Manual refresh triggered by user.");
        this.server = null;
        this.currentPollInterval = CONFIG.POLLING.MIN_INTERVAL_MS;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollLoop();
    }

    dispose() {
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.log("Controller disposed.");
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
module.exports = { activate, deactivate, CONFIG, colorDot, parseQuotaSummary, formatStatusBar, formatTooltip, formatResetTime, serverOf };
