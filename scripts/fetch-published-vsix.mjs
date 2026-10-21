// Downloads the VSIX that was published for a release tag and checks it against
// the digest its host publishes. Writes the file and a dotenv for the release job.
// Usage: node scripts/fetch-published-vsix.mjs v1.2.3

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const tag = process.argv[2] ?? '';
if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`Expected a release tag such as v1.2.3, got "${tag}".`);

const ASSET = 'antigravity-arn-lifebar.vsix';
const version = tag.slice(1);

async function request(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    return res.ok ? res : null;
}

async function download(url) {
    const res = await request(url);
    if (!res) throw new Error(`Download failed: ${url}`);
    return Buffer.from(await res.arrayBuffer());
}

// Open VSX serves every version that reached the stores.
async function fromOpenVsx() {
    const res = await request(`https://open-vsx.org/api/jzbakh/antigravity-arn-lifebar/${version}`);
    if (!res) return null;
    const { files, timestamp } = await res.json();
    const digest = (await download(files.sha256)).toString().trim().split(/\s+/)[0];
    return { url: files.download, digest, releasedAt: timestamp };
}

// Versions that never reached the stores only exist as GitHub release assets.
async function fromGitHub() {
    const res = await request(`https://api.github.com/repos/jzbakh/antigravity-arn-lifebar/releases/tags/${tag}`);
    if (!res) return null;
    const release = await res.json();
    const asset = release.assets.find(a => a.name === ASSET);
    if (!asset?.digest) return null;
    return { url: asset.browser_download_url, digest: asset.digest.replace(/^sha256:/, ''), releasedAt: release.published_at };
}

const published = (await fromOpenVsx()) ?? (await fromGitHub());
if (!published) throw new Error(`No published VSIX found for ${tag}.`);

const vsix = await download(published.url);
const actual = createHash('sha256').update(vsix).digest('hex');
if (actual !== published.digest) throw new Error(`Digest mismatch for ${published.url}: expected ${published.digest}, got ${actual}.`);

const releasedAt = new Date(published.releasedAt).toISOString().replace(/\.\d{3}Z$/, 'Z');
writeFileSync(ASSET, vsix);
writeFileSync('release.env', `RELEASED_AT=${releasedAt}\nFETCH_JOB_ID=${process.env.CI_JOB_ID ?? ''}\n`);
console.log(`${tag}: ${published.url}\nsha256 ${actual}, released ${releasedAt}`);
