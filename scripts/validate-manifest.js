// Manifest gate shared by the GitLab and GitHub pipelines.

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const REQUIRED_FIELDS = [
    'name', 'displayName', 'description', 'version',
    'publisher', 'license', 'engines', 'main', 'contributes', 'repository', 'icon'
];

const errors = [];

function readJson(relPath) {
    try {
        return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8'));
    } catch (err) {
        errors.push(relPath + ' -- ' + err.message);
        return null;
    }
}

function exists(relPath) {
    return fs.existsSync(path.join(REPO_ROOT, relPath));
}

const pkg = readJson('package.json');

if (pkg) {
    const missing = REQUIRED_FIELDS.filter(key => !pkg[key]);
    if (missing.length) {
        errors.push('package.json is missing required fields: ' + missing.join(', '));
    }

    // Runtime dependencies are forbidden for this extension.
    if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
        errors.push('Runtime dependencies are forbidden: ' + Object.keys(pkg.dependencies).join(', '));
    }

    // Commands declared in contributes must exist.
    const commands = pkg.contributes?.commands ?? [];
    if (commands.length === 0) {
        errors.push('package.json must contribute at least one command');
    }

    // Entry point must exist on disk.
    if (pkg.main && !exists(pkg.main)) {
        errors.push('entry point not found: ' + pkg.main);
    }

    // Icon must exist on disk.
    if (pkg.icon && !exists(pkg.icon)) {
        errors.push('icon not found: ' + pkg.icon);
    }
}

if (errors.length) {
    for (const error of errors) {
        console.error('FAIL ' + error);
    }
    console.error('\n' + errors.length + ' manifest check(s) failed.');
    process.exit(1);
}

console.log('OK   manifest -- required fields, commands, referenced files present');
