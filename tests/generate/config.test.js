import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadConfig, DEFAULTS } = require('../../server/generate/config.js');

// Never point envPath at the real server/generate/.env: it must stay absent (see CLAUDE.md
// "do not create the real server/generate/.env"). Every test below uses its own temp fixture.
function withEnvFile(contents, run) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pieceout-generate-config-'));
    const envPath = path.join(dir, '.env');
    if (contents !== null) fs.writeFileSync(envPath, contents);
    try { return run(envPath); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('missing .env file falls back to defaults for every documented key', () => {
    withEnvFile(null, envPath => {
        const config = loadConfig({ env: {}, envPath, root: '/repo' });
        assert.equal(config.GEMINI_API_KEY, '');
        assert.equal(config.GEMINI_IMAGE_MODEL, DEFAULTS.GEMINI_IMAGE_MODEL);
        assert.equal(config.CODEX_CLI_PATH, '');
        assert.equal(config.CODEX_MODEL, '');
        assert.equal(config.CODEX_EFFORT, DEFAULTS.CODEX_EFFORT);
        assert.equal(config.LOCAL_IMAGE_URL, '');
        assert.equal(config.LOCAL_IMAGE_MODEL, '');
        assert.equal(config.dataDir, path.join('/repo', DEFAULTS.GENERATE_DATA_DIR));
    });
});

test('.env file values are used when process.env has nothing for that key', () => {
    withEnvFile('GEMINI_API_KEY=file-key\nCODEX_EFFORT=high\n', envPath => {
        const config = loadConfig({ env: {}, envPath, root: '/repo' });
        assert.equal(config.GEMINI_API_KEY, 'file-key');
        assert.equal(config.CODEX_EFFORT, 'high');
    });
});

test('process.env wins over the .env file for the same key', () => {
    withEnvFile('GEMINI_API_KEY=file-key\nCODEX_EFFORT=high\n', envPath => {
        const config = loadConfig({ env: { GEMINI_API_KEY: 'env-key' }, envPath, root: '/repo' });
        assert.equal(config.GEMINI_API_KEY, 'env-key');
        assert.equal(config.CODEX_EFFORT, 'high'); // untouched key still comes from the file
    });
});

test('an absolute GENERATE_DATA_DIR is used as-is; a relative one resolves against root', () => {
    withEnvFile(null, envPath => {
        const relative = loadConfig({ env: { GENERATE_DATA_DIR: 'somewhere/else' }, envPath, root: '/repo' });
        assert.equal(relative.dataDir, path.join('/repo', 'somewhere/else'));
        const absolute = loadConfig({ env: { GENERATE_DATA_DIR: '/abs/data' }, envPath, root: '/repo' });
        assert.equal(absolute.dataDir, '/abs/data');
    });
});

test('an unrelated key in the .env file or process.env is ignored, not surfaced', () => {
    withEnvFile('SOME_UNRELATED_KEY=x\n', envPath => {
        const config = loadConfig({ env: { ANOTHER_UNRELATED: 'y' }, envPath, root: '/repo' });
        assert.equal(config.SOME_UNRELATED_KEY, undefined);
        assert.equal(config.ANOTHER_UNRELATED, undefined);
    });
});
