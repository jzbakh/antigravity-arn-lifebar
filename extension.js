const vscode = require('vscode');
const https = require('https');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

const CONFIG = {
    POLLING: {
        MIN_INTERVAL_MS: 60000,
        MAX_INTERVAL_MS: 600000,
    },
    TIMEOUTS: {
        RPC_MS: 8000,
        EXEC_MS: 5000,
    },
    UI: {
        THRESHOLDS: {
            RED: 26,
            ORANGE: 51,
        },
    },
};

function colorDot(pct) {
    if (pct === null) return '⚫';
    if (pct <= CONFIG.UI.THRESHOLDS.RED) return '🔴';
    if (pct <= CONFIG.UI.THRESHOLDS.ORANGE) return '🟠';
    return '🟢';
}

function getModelGroups(models) {
    let gPro = null, gFlash = null, other = null;
    for (const m of models) {
        const label = (m.label || '').toLowerCase();
        const pct = m.quotaInfo?.remainingFraction !== undefined
            ? Math.round(m.quotaInfo.remainingFraction * 100)
            : null;
        if (label.includes('gemini') && label.includes('pro')) {
            if (gPro === null) gPro = pct;
        } else if (label.includes('gemini') && label.includes('flash')) {
            if (gFlash === null) gFlash = pct;
        } else {
            if (other === null) other = pct;
        }
    }
    return { gPro, gFlash, other };
}

function formatStatusBar(userStatus) {
    const plan = userStatus.planStatus;
    const tier = userStatus.userTier;
    if (!plan) return '$(graph) ARN-Lifebar';

    const models = userStatus.cascadeModelConfigData?.clientModelConfigs ?? [];
    const { gPro, gFlash, other } = getModelGroups(models);
    const fmtPct = (pct) => pct !== null ? `${pct}%` : '0%';

    const googleCredits = tier?.availableCredits?.find(c => c.creditType === 'GOOGLE_ONE_AI');
    const aiCredits = googleCredits ? googleCredits.creditAmount : null;

    let text = `|  Pro ${fmtPct(gPro)} ${colorDot(gPro)} |  Flash ${fmtPct(gFlash)} ${colorDot(gFlash)} |  Other ${fmtPct(other)} ${colorDot(other)}`;
    if (aiCredits !== null) text += ` |  ${aiCredits} credits  |`;

    return text;
}

function formatTooltip(userStatus) {
    const plan = userStatus.planStatus;
    const tier = userStatus.userTier;
    const models = userStatus.cascadeModelConfigData?.clientModelConfigs ?? [];

    const lines = [
        `Plan: ${tier?.name ?? plan?.planInfo?.planName ?? '?'}`,
        `Prompt credits: ${plan?.availablePromptCredits ?? '?'} / ${plan?.planInfo?.monthlyPromptCredits ?? '?'}`,
        `Flow credits: ${plan?.availableFlowCredits ?? '?'} / ${plan?.planInfo?.monthlyFlowCredits ?? '?'}`,
        '',
        'Model quotas:',
    ];

    for (const m of models) {
        const pct = m.quotaInfo?.remainingFraction !== undefined
            ? `${Math.round(m.quotaInfo.remainingFraction * 100)}%`
            : '0%';
        lines.push(`  ${m.label}: ${pct}`);
    }
    lines.push('', 'ARN-Lifebar | Click to open Settings');
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

        this.statusBarItem.command = 'antigravity-arn-lifebar.openSettings';
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
            const res = await this.lsPost(this.lsConnection.port, this.lsConnection.csrfToken, 'GetUserStatus', {});
            if (res.status === 200 && res.body?.userStatus) {
                const us = res.body.userStatus;
                this.statusBarItem.text = formatStatusBar(us);
                this.statusBarItem.tooltip = formatTooltip(us);
                this.currentPollInterval = CONFIG.POLLING.MIN_INTERVAL_MS;
            } else {
                this.log(`Unexpected API response status: ${res.status}`);
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
module.exports = { activate, deactivate, CONFIG, colorDot, getModelGroups, formatStatusBar, formatTooltip };
