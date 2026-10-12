import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const gemini = require('../../server/generate/providers/gemini.js');
const local = require('../../server/generate/providers/local.js');

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BYTES = Buffer.concat([PNG_HEADER, Buffer.from('image bytes')]);

function stubFetch(handler) {
    const original = global.fetch;
    global.fetch = handler;
    return () => { global.fetch = original; };
}

// --- Gemini --------------------------------------------------------------------------

test('gemini.availability reflects only whether GEMINI_API_KEY is set (no network)', () => {
    assert.equal(gemini.availability({}).available, false);
    assert.equal(gemini.availability({ GEMINI_API_KEY: 'k' }).available, true);
});

test('gemini.generate: parses a successful response into buffer/mime/model', async () => {
    let seenUrl, seenInit;
    const restore = stubFetch(async (url, init) => {
        seenUrl = url; seenInit = init;
        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_BYTES.toString('base64') } }] } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    try {
        const result = await gemini.generate({
            prompt: 'a moose', images: [], aspect: 'square',
            config: { GEMINI_API_KEY: 'secret-key', GEMINI_IMAGE_MODEL: 'gemini-test-model' },
            signal: undefined,
        });
        assert.equal(result.mime, 'image/png');
        assert.ok(result.buffer.equals(PNG_BYTES));
        assert.equal(result.model, 'gemini-test-model');
        assert.ok(String(seenUrl).includes('gemini-test-model'));
        assert.equal(seenInit.headers['x-goog-api-key'], 'secret-key');
        const body = JSON.parse(seenInit.body);
        assert.equal(body.generationConfig.imageConfig.aspectRatio, '1:1');
    } finally { restore(); }
});

test('gemini.generate: maps 401/403 to a key/access hint, 429 to a usage-limit hint, both as 502', async () => {
    for (const [status, pattern] of [[401, /key and model access/], [403, /key and model access/], [429, /usage limit/]]) {
        const restore = stubFetch(async () => new Response('{}', { status }));
        try {
            await assert.rejects(
                gemini.generate({ prompt: 'p', images: [], aspect: 'square', config: { GEMINI_API_KEY: 'k' }, signal: undefined }),
                err => { assert.equal(err.status, 502); assert.match(err.message, pattern); return true; },
            );
        } finally { restore(); }
    }
});

test('gemini.generate: rejects when the response has no image part', async () => {
    const restore = stubFetch(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'sorry' }] } }] }), { status: 200 }));
    try {
        await assert.rejects(
            gemini.generate({ prompt: 'p', images: [], aspect: 'square', config: { GEMINI_API_KEY: 'k' }, signal: undefined }),
            err => { assert.equal(err.status, 502); return true; },
        );
    } finally { restore(); }
});

test('gemini.generate: an already-aborted signal surfaces as a cancellation, not a generic 502', async () => {
    const restore = stubFetch(async (url, init) => {
        if (init.signal && init.signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
        return new Response('{}', { status: 200 });
    });
    try {
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(
            gemini.generate({ prompt: 'p', images: [], aspect: 'square', config: { GEMINI_API_KEY: 'k' }, signal: controller.signal }),
            err => { assert.equal(err.aborted, true); return true; },
        );
    } finally { restore(); }
});

// --- Local -----------------------------------------------------------------------------

test('local.availability reflects only whether LOCAL_IMAGE_URL is set (no network)', () => {
    assert.equal(local.availability({}).available, false);
    assert.equal(local.availability({ LOCAL_IMAGE_URL: 'http://x' }).available, true);
});

test('local.generate: no images -> POST /v1/images/generations with JSON body', async () => {
    let seenUrl, seenInit;
    const restore = stubFetch(async (url, init) => {
        seenUrl = url; seenInit = init;
        return new Response(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString('base64') }] }), { status: 200 });
    });
    try {
        const result = await local.generate({
            prompt: 'a moose', images: [], aspect: 'landscape',
            config: { LOCAL_IMAGE_URL: 'http://127.0.0.1:7744/', LOCAL_IMAGE_MODEL: 'sd-model' },
            signal: undefined,
        });
        assert.equal(seenUrl, 'http://127.0.0.1:7744/v1/images/generations');
        const body = JSON.parse(seenInit.body);
        assert.equal(body.size, '1536x1024');
        assert.equal(body.model, 'sd-model');
        assert.equal(body.response_format, 'b64_json');
        assert.ok(result.buffer.equals(PNG_BYTES));
        assert.equal(result.model, 'sd-model');
    } finally { restore(); }
});

test('local.generate: with images -> POST /v1/images/edits as multipart with one image[] per image', async () => {
    let seenUrl, seenInit;
    const restore = stubFetch(async (url, init) => {
        seenUrl = url; seenInit = init;
        return new Response(JSON.stringify({ data: [{ b64_json: PNG_BYTES.toString('base64') }] }), { status: 200 });
    });
    try {
        await local.generate({
            prompt: 'edit', images: [{ buffer: PNG_BYTES, mime: 'image/png' }, { buffer: PNG_BYTES, mime: 'image/png' }],
            aspect: 'portrait', config: { LOCAL_IMAGE_URL: 'http://127.0.0.1:7744' }, signal: undefined,
        });
        assert.equal(seenUrl, 'http://127.0.0.1:7744/v1/images/edits');
        assert.ok(seenInit.body instanceof FormData);
        const imageParts = seenInit.body.getAll('image[]');
        assert.equal(imageParts.length, 2);
        assert.equal(seenInit.body.get('size'), '1024x1536');
    } finally { restore(); }
});

test('local.generate: a non-ok response is a 502', async () => {
    const restore = stubFetch(async () => new Response('server error', { status: 500 }));
    try {
        await assert.rejects(
            local.generate({ prompt: 'p', images: [], aspect: 'square', config: { LOCAL_IMAGE_URL: 'http://x' }, signal: undefined }),
            err => { assert.equal(err.status, 502); return true; },
        );
    } finally { restore(); }
});

test('local.generate: a missing b64_json field is a 502, not a crash', async () => {
    const restore = stubFetch(async () => new Response(JSON.stringify({ data: [{}] }), { status: 200 }));
    try {
        await assert.rejects(
            local.generate({ prompt: 'p', images: [], aspect: 'square', config: { LOCAL_IMAGE_URL: 'http://x' }, signal: undefined }),
            err => { assert.equal(err.status, 502); return true; },
        );
    } finally { restore(); }
});
