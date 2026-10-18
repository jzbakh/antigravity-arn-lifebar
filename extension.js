const vscode = require('vscode');
const https = require('https');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

const CONFIG = {
    POLLING: {
        MIN_INTERVAL_MS: 5000,
        MAX_INTERVAL_MS: 600000,
    },
    TIMEOUTS: {
        RPC_MS: 8000,
        EXEC_MS: 5000,
    },
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

// Same rule as the IDE: a bucket without remainingFraction counts as 0%.
function remainingPct(bucket) {
    return Math.round((bucket.remainingFraction ?? 0) * 100);
}

function compactLabel(displayName) {
    return displayName.replace(/\s+models?$/i, '').replace(/\s+and\s+/gi, ' & ');
}

function bucketLabel(bucket) {
    return (bucket.displayName || bucket.window || 'Limit').replace(/\s+remaining$/i, '');
}

// Report the 5-hour window, or 0% as soon as any window is exhausted.
function pickGauge(buckets) {
    const lowest = buckets.reduce((min, b) => (!min || remainingPct(b) < remainingPct(min) ? b : min), null);
    if (!lowest || remainingPct(lowest) === 0) return lowest;
    return buckets.find(b => b.window === '5h') ?? lowest;
}

function parseQuotaSummary(quotaSummary) {
    const groups = quotaSummary?.response?.groups || [];

    return groups.map((group) => {
        const label = group.displayName || '';
        const buckets = (group.buckets || []).filter(b => !b.disabled);

        return { label, shortLabel: compactLabel(label), description: group.description, buckets, gauge: pickGauge(buckets) };
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

    for (const group of parsedGroups) {
        lines.push(`- ${group.label}`);
        if (group.description) lines.push(`   ${group.description}`);

        for (const bucket of group.buckets) {
            const reset = formatResetTime(bucket.resetTime);
            lines.push(`   ${bucketLabel(bucket)}: ${remainingPct(bucket)}%${reset ? ` (${reset})` : ''}`);
        }
        lines.push('');
    }

    lines.push('ARN-Lifebar');
    return lines.join('\n');
}

class LifebarController {
    constructor(context) {
        this.context = context;
        this.lsConnection = null;
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

    lsPost(port, csrfToken, method, body) {
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
                rejectUnauthorized: false,
            };

            const req = https.request(options, (res) => {
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

    async discoverLsConnection() {
        const isWin = process.platform === 'win32';

        if (isWin) {
            try {
                const winScript = `
$ProgressPreference = 'SilentlyContinue';
$results = @();
$p = Get-Process | Where-Object { $_.Name -like "*language_server*" };
foreach ($proc in $p) {
    try {
        $f_id = $proc.Id;
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=\${f_id}").CommandLine;
        if ($cmd -match '--csrf_token\\s+([a-f0-9-]+)') {
            $token = $matches[1];
            $netstatLines = netstat -ano | Select-String "LISTENING" | Select-String "\${f_id}";
            foreach ($mLine in $netstatLines) {
                if ($mLine.Line.Trim() -match ":(\\d+).+LISTENING\\s+\${f_id}") {
                    $results += @{ Token = $token; Port = [int]$matches[1] }
                }
            }
        }
    } catch { }
}
if ($results.Count -eq 0) { "[]" } else { $results | ConvertTo-Json -Compress }
                `;

                // Base64 + EncodedCommand bypasses ExecutionPolicy without touching disk.
                const base64Script = Buffer.from(winScript, 'utf16le').toString('base64');
                const { stdout } = await execAsync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${base64Script}`, { timeout: CONFIG.TIMEOUTS.RPC_MS });

                const jsonMatch = stdout.match(/\[[\s\S]*\]/);
                if (!jsonMatch) return null;

                let candidates = [];
                try {
                    candidates = JSON.parse(jsonMatch[0]);
                } catch (parseError) {
                    this.log("Windows JSON parsing anomaly", parseError);
                    return null;
                }

                const list = Array.isArray(candidates) ? candidates : [candidates];

                for (const cand of list) {
                    if (!cand.Port || !cand.Token) continue;
                    try {
                        const res = await this.lsPost(cand.Port, cand.Token, 'GetUserStatus', {});
                        if (res && res.status === 200) {
                            this.log(`Discovered LS on port ${cand.Port}`);
                            return { port: cand.Port, csrfToken: cand.Token };
                        }
                    } catch { continue; }
                }
            } catch (e) {
                this.log("PowerShell discovery execution failed", e);
            }
        } else {
            // macOS / Linux: ps → csrf token, then fall through lsof → ss → netstat for ports.
            try {
                const { stdout: psOut } = await execAsync('ps -axww -o pid,command', { encoding: 'utf8', timeout: CONFIG.TIMEOUTS.EXEC_MS });
                const lines = psOut.split('\n');
                const lsLines = lines.filter(l => l.includes('language_server') && l.includes('--csrf_token'));

                for (const line of lsLines) {
                    const match = line.trim().match(/^(\d+)\s+(.+)$/);
                    if (!match) continue;

                    // pidNum is interpolated into a shell command — must be a clean integer.
                    const pidNum = parseInt(match[1], 10);
                    if (Number.isNaN(pidNum) || pidNum <= 0) continue;

                    const cmd = match[2];
                    const csrfMatch = cmd.match(/--csrf_token\s+([a-f0-9-]{36})/);
                    if (!csrfMatch) continue;
                    const token = csrfMatch[1];

                    const ports = new Set();
                    const execOpts = { encoding: 'utf8', timeout: CONFIG.TIMEOUTS.EXEC_MS };

                    try {
                        const { stdout: lsofOut } = await execAsync(`lsof -nP -iTCP -sTCP:LISTEN -p ${pidNum}`, execOpts);
                        const portMatches = lsofOut.match(/:(\d+)\s+\(LISTEN\)/g);
                        if (portMatches) portMatches.forEach(m => { const p = m.match(/:(\d+)/); if (p) ports.add(parseInt(p[1], 10)); });
                    } catch { }

                    if (ports.size === 0) {
                        try {
                            const { stdout: ssOut } = await execAsync('ss -lntp', execOpts);
                            const ssLines = ssOut.split('\n').filter(l => l.includes(`pid=${pidNum}`));
                            for (const ssLine of ssLines) {
                                const portMatch = ssLine.match(/:(\d+)\s+/);
                                if (portMatch) ports.add(parseInt(portMatch[1], 10));
                            }
                        } catch { }
                    }

                    if (ports.size === 0) {
                        try {
                            const { stdout: netstatOut } = await execAsync('netstat -lntp', execOpts);
                            const netstatLines = netstatOut.split('\n').filter(l => l.includes(`${pidNum}/`));
                            for (const nsLine of netstatLines) {
                                const portMatch = nsLine.match(/:(\d+)\s+/);
                                if (portMatch) ports.add(parseInt(portMatch[1], 10));
                            }
                        } catch { }
                    }

                    for (const port of ports) {
                        try {
                            const res = await this.lsPost(port, token, 'GetUserStatus', {});
                            if (res && res.status === 200) {
                                this.log(`Discovered Unix LS on port ${port} (PID: ${pidNum})`);
                                return { port, csrfToken: token };
                            }
                        } catch { continue; }
                    }
                }
            } catch (e) {
                this.log("Unix discovery engine fault", e);
            }
        }
        return null;
    }

    async refreshQuotas() {
        if (!this.lsConnection) {
            this.lsConnection = await this.discoverLsConnection();
            if (!this.lsConnection) {
                this.statusBarItem.text = '$(graph) ARN-Lifebar — LS not found';
                this.currentPollInterval = Math.min(this.currentPollInterval * 2, CONFIG.POLLING.MAX_INTERVAL_MS);
                this.log(`LS not found. Backing off polling to ${this.currentPollInterval / 1000}s`);
                return;
            }
        }
        try {
            const [statusRes, quotaRes] = await Promise.all([
                this.lsPost(this.lsConnection.port, this.lsConnection.csrfToken, 'GetUserStatus', {}),
                this.lsPost(this.lsConnection.port, this.lsConnection.csrfToken, 'RetrieveUserQuotaSummary', {})
            ]);

            if (statusRes.status === 200 && quotaRes.status === 200 && statusRes.body?.userStatus) {
                const us = statusRes.body.userStatus;
                const parsedGroups = parseQuotaSummary(quotaRes.body);

                this.statusBarItem.text = formatStatusBar(us, parsedGroups);
                this.statusBarItem.tooltip = formatTooltip(us, parsedGroups);
                this.currentPollInterval = CONFIG.POLLING.MIN_INTERVAL_MS;
            } else {
                this.log(`Unexpected API response status: GetUserStatus=${statusRes.status}, RetrieveUserQuotaSummary=${quotaRes.status}`);
                this.lsConnection = null;
                this.currentPollInterval = Math.min(this.currentPollInterval * 2, CONFIG.POLLING.MAX_INTERVAL_MS);
            }
        } catch (e) {
            this.lsConnection = null;
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
        this.lsConnection = null;
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
module.exports = { activate, deactivate, CONFIG, colorDot, parseQuotaSummary, formatStatusBar, formatTooltip, formatResetTime };
