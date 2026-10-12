import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const codex = require('../../server/generate/providers/codex.js');

// --- buildArgv: pure argv construction -------------------------------------------------

test('buildArgv: base flags, order, and the trailing "-" for stdin', () => {
    const argv = codex.buildArgv({ cliPath: '/bin/codex', instructionsPath: '/tmp/instructions.md', effort: 'low', model: undefined, referencePaths: [] });
    assert.equal(argv[0], '/bin/codex');
    assert.deepEqual(argv.slice(1, 11), ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral',
        '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '--color', 'never']);
    assert.equal(argv[argv.length - 1], '-');
});

test('buildArgv: one --image flag per reference path, right after the base flags', () => {
    const argv = codex.buildArgv({ cliPath: '/bin/codex', instructionsPath: '/tmp/i.md', effort: 'low', referencePaths: ['/tmp/a.png', '/tmp/b.png'] });
    const imageIdx = argv.indexOf('--json') + 3; // after --json --color never
    assert.deepEqual(argv.slice(imageIdx, imageIdx + 4), ['--image', '/tmp/a.png', '--image', '/tmp/b.png']);
});

test('buildArgv: -c settings appear in the exact documented order, each JSON-encoded', () => {
    const argv = codex.buildArgv({ cliPath: '/bin/codex', instructionsPath: '/tmp/i.md', effort: 'medium', referencePaths: [] });
    const cValues = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === '-c') cValues.push(argv[i + 1]);
    const expectedKeysInOrder = [
        'forced_login_method', 'approval_policy', 'model_instructions_file', 'model_reasoning_effort',
        'project_doc_max_bytes', 'web_search', 'history.persistence',
        'features.skip_host_skill_discovery', 'features.image_generation',
        'features.shell_tool', 'features.unified_exec', 'features.apply_patch_freeform', 'features.apps',
        'features.plugins', 'features.remote_plugin', 'features.hooks', 'features.memories',
        'features.multi_agent', 'features.browser_use', 'features.computer_use', 'features.js_repl',
        'features.code_mode', 'features.view_image', 'features.skill_search', 'features.shell_snapshot',
    ];
    assert.deepEqual(cValues.map(v => v.split('=')[0]), expectedKeysInOrder);
    assert.equal(cValues.find(v => v.startsWith('forced_login_method=')), 'forced_login_method="chatgpt"');
    assert.equal(cValues.find(v => v.startsWith('approval_policy=')), 'approval_policy="never"');
    assert.equal(cValues.find(v => v.startsWith('model_reasoning_effort=')), 'model_reasoning_effort="medium"');
    assert.equal(cValues.find(v => v.startsWith('project_doc_max_bytes=')), 'project_doc_max_bytes=0');
    assert.equal(cValues.find(v => v.startsWith('features.image_generation=')), 'features.image_generation=true');
    assert.equal(cValues.find(v => v.startsWith('features.shell_tool=')), 'features.shell_tool=false');
});

test('buildArgv: --model appears only when a model override is given, right before the trailing "-"', () => {
    const withoutModel = codex.buildArgv({ cliPath: '/bin/codex', instructionsPath: '/tmp/i.md', effort: 'low', referencePaths: [] });
    assert.ok(!withoutModel.includes('--model'));

    const withModel = codex.buildArgv({ cliPath: '/bin/codex', instructionsPath: '/tmp/i.md', effort: 'low', model: 'gpt-image-1', referencePaths: [] });
    const modelIdx = withModel.indexOf('--model');
    assert.equal(withModel[modelIdx + 1], 'gpt-image-1');
    assert.equal(withModel[modelIdx + 2], '-');
    assert.equal(withModel[withModel.length - 1], '-');
});

test('buildArgv: rejects an invalid CODEX_EFFORT', () => {
    assert.throws(() => codex.buildArgv({ cliPath: '/bin/codex', instructionsPath: '/tmp/i.md', effort: 'extreme', referencePaths: [] }),
        err => { assert.equal(err.status, 503); return true; });
});

test('buildArgv: accepts every documented effort level', () => {
    for (const effort of codex.EFFORTS) {
        assert.doesNotThrow(() => codex.buildArgv({ cliPath: '/bin/codex', instructionsPath: '/tmp/i.md', effort, referencePaths: [] }));
    }
});

// --- parseEvents: JSONL parsing --------------------------------------------------------

function jsonl(events) { return events.map(e => JSON.stringify(e)).join('\n') + '\n'; }

test('parseEvents: a turn.failed event fails the whole request', () => {
    const output = jsonl([{ type: 'thread.started', thread_id: 'x' }, { type: 'turn.failed' }]);
    assert.throws(() => codex.parseEvents(output), err => { assert.equal(err.status, 502); return true; });
});

test('parseEvents: a bare error event fails the whole request', () => {
    const output = jsonl([{ type: 'error', message: 'boom' }]);
    assert.throws(() => codex.parseEvents(output), err => { assert.equal(err.status, 502); return true; });
});

test('parseEvents: missing turn.completed fails even with no explicit error event', () => {
    const output = jsonl([{ type: 'thread.started', thread_id: 'x' }, { type: 'item.completed' }]);
    assert.throws(() => codex.parseEvents(output), err => { assert.equal(err.status, 502); return true; });
});

test('parseEvents: accepts a clean stream and ignores blank lines', () => {
    const output = '\n' + jsonl([{ type: 'thread.started', thread_id: 'x' }, { type: 'turn.completed' }]) + '\n';
    const events = codex.parseEvents(output);
    assert.equal(events.length, 2);
});

test('parseEvents: invalid JSON in the stream is a 502, not a crash', () => {
    assert.throws(() => codex.parseEvents('not json at all\n'), err => { assert.equal(err.status, 502); return true; });
});

// --- readOutput: filesystem contract ----------------------------------------------------

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'pieceout-codex-out-')); }
const THREAD_ID = '12345678-1234-1234-1234-123456789abc';
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function completedOutput(threadIds) {
    const events = threadIds.map(id => ({ type: 'thread.started', thread_id: id }));
    events.push({ type: 'turn.completed', usage: {} });
    return jsonl(events);
}

test('readOutput: reads the single image out of generated_images/<thread_id>/', async () => {
    const root = tempRoot();
    const dir = path.join(root, THREAD_ID);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'out.png'), PNG_BYTES);
    const raster = await codex.readOutput(completedOutput([THREAD_ID]), root);
    assert.equal(raster.mime, 'image/png');
    assert.ok(raster.buffer.equals(PNG_BYTES));
});

test('readOutput: rejects a non-UUID thread id', async () => {
    const root = tempRoot();
    await assert.rejects(codex.readOutput(completedOutput(['not-a-uuid']), root), err => { assert.equal(err.status, 502); return true; });
});

test('readOutput: rejects when two thread.started events appear', async () => {
    const root = tempRoot();
    const output = completedOutput([THREAD_ID, '87654321-4321-4321-4321-cba987654321']);
    await assert.rejects(codex.readOutput(output, root), err => { assert.equal(err.status, 502); return true; });
});

test('readOutput: rejects a symlinked thread directory', async () => {
    const root = tempRoot();
    const realDir = path.join(root, 'real-target');
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, 'out.png'), PNG_BYTES);
    fs.symlinkSync(realDir, path.join(root, THREAD_ID));
    await assert.rejects(codex.readOutput(completedOutput([THREAD_ID]), root), err => { assert.equal(err.status, 502); return true; });
});

test('readOutput: rejects a directory containing two images', async () => {
    const root = tempRoot();
    const dir = path.join(root, THREAD_ID);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'a.png'), PNG_BYTES);
    fs.writeFileSync(path.join(dir, 'b.png'), PNG_BYTES);
    await assert.rejects(codex.readOutput(completedOutput([THREAD_ID]), root), err => { assert.equal(err.status, 502); return true; });
});

test('readOutput: rejects a missing thread directory', async () => {
    const root = tempRoot();
    await assert.rejects(codex.readOutput(completedOutput([THREAD_ID]), root), err => { assert.equal(err.status, 502); return true; });
});

test('readOutput: rejects a file whose bytes are not a supported image format', async () => {
    const root = tempRoot();
    const dir = path.join(root, THREAD_ID);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'out.png'), Buffer.from('not actually an image'));
    await assert.rejects(codex.readOutput(completedOutput([THREAD_ID]), root), err => { assert.equal(err.status, 502); return true; });
});

// --- availability / resolveBinary --------------------------------------------------------

test('availability: reports unavailable with a helpful reason when CODEX_CLI_PATH does not exist', () => {
    const result = codex.availability({ CODEX_CLI_PATH: '/definitely/not/a/real/path/codex' });
    assert.equal(result.available, false);
    assert.match(result.reason, /Codex CLI/);
});

test('availability: reports available when CODEX_CLI_PATH points at a real file', () => {
    const root = tempRoot();
    const fakeBinary = path.join(root, 'codex');
    fs.writeFileSync(fakeBinary, '#!/bin/sh\n');
    fs.chmodSync(fakeBinary, 0o755);
    const result = codex.availability({ CODEX_CLI_PATH: fakeBinary });
    assert.equal(result.available, true);
});
