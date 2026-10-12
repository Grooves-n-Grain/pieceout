// Loads server/generate/.env (gitignored) with util.parseEnv. Real process.env always wins
// over the file, and every key has a documented default (see .env.example).
const fs = require('fs');
const path = require('path');
const { parseEnv } = require('util');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ENV_PATH = path.join(__dirname, '.env');

const DEFAULTS = {
    GEMINI_IMAGE_MODEL: 'gemini-3.1-flash-image',
    CODEX_EFFORT: 'low',
    GENERATE_DATA_DIR: 'data/generate',
};

const KEYS = [
    'GEMINI_API_KEY', 'GEMINI_IMAGE_MODEL',
    'CODEX_CLI_PATH', 'CODEX_MODEL', 'CODEX_EFFORT',
    'LOCAL_IMAGE_URL', 'LOCAL_IMAGE_MODEL',
    'GENERATE_DATA_DIR',
];

// root: base directory a relative GENERATE_DATA_DIR resolves against (defaults to the repo root).
// env: source for process-env-style overrides (defaults to the real process.env).
// envPath: the .env file to read (defaults to server/generate/.env); a test-only seam so
// precedence can be exercised against a fixture file without touching the real, gitignored .env.
function loadConfig({ root = REPO_ROOT, env = process.env, envPath = ENV_PATH } = {}) {
    let fileValues = {};
    try {
        fileValues = parseEnv(fs.readFileSync(envPath, 'utf8'));
    } catch {
        // No .env file is fine; every key falls back to process.env or a documented default.
    }

    const values = {};
    for (const key of KEYS) {
        const fromEnv = env[key];
        const fromFile = fileValues[key];
        if (fromEnv !== undefined) values[key] = fromEnv;
        else if (fromFile !== undefined) values[key] = fromFile;
        else values[key] = DEFAULTS[key] || '';
    }

    const dataDirRaw = values.GENERATE_DATA_DIR || DEFAULTS.GENERATE_DATA_DIR;
    values.dataDir = path.isAbsolute(dataDirRaw) ? dataDirRaw : path.join(root, dataDirRaw);
    return values;
}

module.exports = { loadConfig, DEFAULTS, KEYS };
