// tests/generateUI.test.js
// Pure logic from js/generate/params.js, plus js/generate/api.js's error mapping against a
// stubbed global fetch. generateUI.js itself is DOM-driven and not covered here (no browser
// in this test runner); see the report for what that leaves unverified.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    STORAGE_KEY, PROMPT_MAX, PREAMBLE_MAX, SUBJECT_MAX_BYTES, REFERENCE_MAX_BYTES, MAX_REFERENCES,
    ASPECT_OPTIONS, GENERATE_FIELDS, defaultPersisted, validatePrompt, validatePreamble,
    isAllowedImageType, isWithinSize, formatElapsed, dataURLMimeType, timestampName, dataURLToFile,
} from '../js/generate/params.js';

// --- params.js: schema ---

test('STORAGE_KEY and limits match the contract', () => {
    assert.equal(STORAGE_KEY, 'pieceout-generate');
    assert.equal(PROMPT_MAX, 2000);
    assert.equal(PREAMBLE_MAX, 4000);
    assert.equal(SUBJECT_MAX_BYTES, 20 * 1024 * 1024);
    assert.equal(REFERENCE_MAX_BYTES, 8 * 1024 * 1024);
    assert.equal(MAX_REFERENCES, 4);
});

test('ASPECT_OPTIONS covers the three API values', () => {
    assert.deepEqual(ASPECT_OPTIONS.map(o => o.value), ['portrait', 'landscape', 'square']);
    for (const opt of ASPECT_OPTIONS) assert.ok(opt.label.length > 0);
});

test('GENERATE_FIELDS every entry has key, label and help', () => {
    assert.ok(GENERATE_FIELDS.length > 0);
    for (const field of GENERATE_FIELDS) {
        assert.equal(typeof field.key, 'string');
        assert.equal(typeof field.label, 'string');
        assert.equal(typeof field.help, 'string');
        assert.ok(field.help.trim().length > 0, `${field.key} help is blank`);
    }
});

test('defaultPersisted shape', () => {
    assert.deepEqual(defaultPersisted(), { provider: '', prompt: '', aspect: 'portrait', useStyle: true });
});

// --- validatePrompt / validatePreamble ---

test('validatePrompt rejects empty or whitespace-only text', () => {
    assert.equal(validatePrompt('').valid, false);
    assert.equal(validatePrompt('   ').valid, false);
});

test('validatePrompt accepts trimmed text within the limit', () => {
    const result = validatePrompt('  a moose in a lake  ');
    assert.equal(result.valid, true);
    assert.equal(result.error, '');
});

test('validatePrompt rejects text over PROMPT_MAX after trimming', () => {
    const result = validatePrompt('a'.repeat(PROMPT_MAX + 1));
    assert.equal(result.valid, false);
    assert.match(result.error, /too long/);
});

test('validatePrompt accepts exactly PROMPT_MAX characters', () => {
    assert.equal(validatePrompt('a'.repeat(PROMPT_MAX)).valid, true);
});

test('validatePreamble accepts an empty preamble', () => {
    assert.equal(validatePreamble('').valid, true);
});

test('validatePreamble rejects text over PREAMBLE_MAX', () => {
    assert.equal(validatePreamble('a'.repeat(PREAMBLE_MAX + 1)).valid, false);
});

// --- file checks ---

test('isAllowedImageType accepts png/jpeg/webp and rejects others', () => {
    assert.equal(isAllowedImageType({ type: 'image/png' }), true);
    assert.equal(isAllowedImageType({ type: 'image/jpeg' }), true);
    assert.equal(isAllowedImageType({ type: 'image/webp' }), true);
    assert.equal(isAllowedImageType({ type: 'image/gif' }), false);
    assert.equal(isAllowedImageType({ type: '' }), false);
    assert.equal(isAllowedImageType(null), false);
});

test('isWithinSize compares against the byte limit inclusively', () => {
    assert.equal(isWithinSize({ size: 100 }, 100), true);
    assert.equal(isWithinSize({ size: 101 }, 100), false);
    assert.equal(isWithinSize({}, 100), false);
});

// --- formatElapsed ---

test('formatElapsed formats whole seconds as M:SS', () => {
    assert.equal(formatElapsed(0), '0:00');
    assert.equal(formatElapsed(5), '0:05');
    assert.equal(formatElapsed(65), '1:05');
    assert.equal(formatElapsed(723), '12:03');
});

test('formatElapsed floors fractional seconds and clamps negatives to zero', () => {
    assert.equal(formatElapsed(5.9), '0:05');
    assert.equal(formatElapsed(-3), '0:00');
});

// --- data URL helpers ---

test('dataURLMimeType reads the mime type out of a data URL', () => {
    assert.equal(dataURLMimeType('data:image/png;base64,AAAA'), 'image/png');
    assert.equal(dataURLMimeType('data:image/jpeg;base64,AAAA'), 'image/jpeg');
    assert.equal(dataURLMimeType('not a data url'), '');
});

test('timestampName formats a Date as generated-YYYYMMDD-HHMMSS', () => {
    const date = new Date(2026, 8, 20, 7, 5, 9); // 2026-09-20 07:05:09 local
    assert.equal(timestampName(date), 'generated-20260920-070509');
});

test('dataURLToFile round-trips bytes and mime type through a File', () => {
    const original = 'hello world';
    const b64 = Buffer.from(original, 'utf8').toString('base64');
    const file = dataURLToFile(`data:image/png;base64,${b64}`, 'test.png');
    assert.ok(file instanceof File);
    assert.equal(file.name, 'test.png');
    assert.equal(file.type, 'image/png');
    assert.equal(file.size, original.length);
});

test('dataURLToFile throws on a non-data-URL string', () => {
    assert.throws(() => dataURLToFile('https://example.com/image.png', 'x.png'));
});

// --- api.js: error mapping against a stubbed global fetch ---

const { getProviders, getStyle, saveStyle, generateImage } = await import('../js/generate/api.js');

let originalFetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

function jsonResponse(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    };
}

test('getProviders resolves with the parsed body on success', async () => {
    let calledPath;
    global.fetch = async (path) => { calledPath = path; return jsonResponse(200, { providers: [{ id: 'codex' }] }); };
    const body = await getProviders();
    assert.equal(calledPath, '/api/generate/providers');
    assert.deepEqual(body, { providers: [{ id: 'codex' }] });
});

test('api error uses the {detail} body when present', async () => {
    global.fetch = async () => jsonResponse(400, { detail: 'Prompt is required.' });
    await assert.rejects(getStyle(), (err) => {
        assert.equal(err.message, 'Prompt is required.'); // getStyle is a GET but reuses request()
        return true;
    });
});

test('409 without a usable detail falls back to a friendly "already running" message', async () => {
    global.fetch = async () => jsonResponse(409, null);
    await assert.rejects(generateImage({ provider: 'codex', prompt: 'x' }), (err) => {
        assert.match(err.message, /already running/);
        return true;
    });
});

test('409 with a blank detail string still falls back to the friendly message', async () => {
    global.fetch = async () => jsonResponse(409, { detail: '   ' });
    await assert.rejects(generateImage({ provider: 'codex', prompt: 'x' }), (err) => {
        assert.match(err.message, /already running/);
        return true;
    });
});

test('a network failure (fetch throws) becomes a friendly connection message, not a crash', async () => {
    global.fetch = async () => { throw new TypeError('fetch failed'); };
    await assert.rejects(getProviders(), (err) => {
        assert.match(err.message, /Cannot reach the server/);
        return true;
    });
});

test('an AbortError from fetch passes through unwrapped so Cancel can detect it', async () => {
    global.fetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
    await assert.rejects(generateImage({ provider: 'codex', prompt: 'x' }, new AbortController().signal), (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
    });
});

test('an unmapped error status with no body falls back to a generic message, not a crash', async () => {
    global.fetch = async () => jsonResponse(500, null);
    await assert.rejects(getProviders(), (err) => {
        assert.match(err.message, /request failed \(500\)/);
        return true;
    });
});

test('generateImage POSTs JSON with the abort signal attached', async () => {
    let seen;
    global.fetch = async (path, options) => { seen = { path, options }; return jsonResponse(200, { image: 'data:image/png;base64,AA', provider: 'codex', model: null, seconds: 1.2 }); };
    const signal = new AbortController().signal;
    const payload = { provider: 'codex', prompt: 'a moose', subject: null, useStyle: true, aspect: 'portrait' };
    const body = await generateImage(payload, signal);
    assert.equal(seen.path, '/api/generate/image');
    assert.equal(seen.options.method, 'POST');
    assert.equal(seen.options.signal, signal);
    assert.deepEqual(JSON.parse(seen.options.body), payload);
    assert.equal(body.provider, 'codex');
});

test('saveStyle PUTs JSON to /style', async () => {
    let seen;
    global.fetch = async (path, options) => { seen = { path, options }; return jsonResponse(200, { preamble: 'p', references: [] }); };
    const profile = { preamble: 'p', references: [{ name: 'a.png', dataUrl: 'data:image/png;base64,AA' }] };
    await saveStyle(profile);
    assert.equal(seen.path, '/api/generate/style');
    assert.equal(seen.options.method, 'PUT');
    assert.deepEqual(JSON.parse(seen.options.body), profile);
});
