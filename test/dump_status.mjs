import https from 'node:https';
import { exec } from 'node:child_process';
import util from 'node:util';

const execAsync = util.promisify(exec);

async function discover() {
    const winScript = `
    $ProgressPreference = 'SilentlyContinue';
    $results = @();
    $p = Get-Process | Where-Object { $_.Name -like "*language_server*" };
    foreach ($proc in $p) {
        try {
            $f_id = $proc.Id;
            $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$f_id").CommandLine;
            if ($cmd -match '--csrf_token\\s+([a-f0-9-]+)') {
                $token = $matches[1];
                $netstatLines = netstat -ano | Select-String "LISTENING" | Select-String "$f_id";
                foreach ($mLine in $netstatLines) {
                    if ($mLine.Line.Trim() -match ":(\\d+).+LISTENING\\s+$f_id") {
                        $results += @{ Token = $token; Port = [int]$matches[1] }
                    }
                }
            }
        } catch { }
    }
    if ($results.Count -eq 0) { "[]" } else { $results | ConvertTo-Json -Compress }
    `;
    const base64Script = Buffer.from(winScript, 'utf16le').toString('base64');
    const { stdout } = await execAsync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${base64Script}`);
    const jsonMatch = stdout.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    let candidates = JSON.parse(jsonMatch[0]);
    candidates = Array.isArray(candidates) ? candidates : [candidates];
    return candidates[0]; // Take the first one
}

async function run() {
    const ls = await discover();
    if (!ls) {
        console.log("No language server found.");
        return;
    }
    console.log(`Found LS on port ${ls.Port}`);
    
    const options = {
        hostname: '127.0.0.1',
        port: ls.Port,
        path: `/exa.language_server_pb.LanguageServerService/GetUserStatus`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Connect-Protocol-Version': '1',
            'x-codeium-csrf-token': ls.Token,
        },
        rejectUnauthorized: false,
    };

    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            const body = JSON.parse(data);
            console.log(JSON.stringify(body.userStatus.cascadeModelConfigData.clientModelConfigs, null, 2));
        });
    });
    req.write('{}');
    req.end();
}

run().catch(console.error);
