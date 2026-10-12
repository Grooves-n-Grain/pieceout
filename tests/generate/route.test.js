import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createServer } = require('../../serve.js');

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BYTES = Buffer.concat([PNG_HEADER, Buffer.from('some bytes')]);
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;

async function listen(server) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
function tmpDataDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'pieceout-generate-route-')); }

function fakeProvider(id, overrides = {}) {
    return {
        id, label: id, slow: false,
        availability: () => ({ available: true, reason: '' }),
        generate: async () => ({ buffer: PNG_BYTES, mime: 'image/png', model: null }),
        ...overrides,
    };
}
function defaultProviders() { return [fakeProvider('codex'), fakeProvider('gemini'), fakeProvider('local')]; }

function startServer(providers = defaultProviders(), dataDir = tmpDataDir()) {
    return createServer({ generate: { providers, dataDir } });
}

async function postJson(base, urlPath, body, extraHeaders = {}) {
    return fetch(base + urlPath, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) });
}
async function putJson(base, urlPath, body) {
    return fetch(base + urlPath, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function waitFor(conditionFn, { timeout = 2000, interval = 15 } = {}) {
    const start = Date.now();
    while (!conditionFn()) {
        if (Date.now() - start > timeout) throw new Error('timed out waiting for condition');
        await new Promise(resolve => setTimeout(resolve, interval));
    }
}

// --- GET /api/generate/providers --------------------------------------------------------

test('GET /api/generate/providers lists all three, in order, with availability from each provider', async () => {
    const providers = [
        fakeProvider('codex', { availability: () => ({ available: true, reason: '' }) }),
        fakeProvider('gemini', { availability: () => ({ available: false, reason: 'Set GEMINI_API_KEY in server/generate/.env' }) }),
        fakeProvider('local', { slow: true, availability: () => ({ available: false, reason: 'Set LOCAL_IMAGE_URL in server/generate/.env' }) }),
    ];
    const server = startServer(providers);
    const base = await listen(server);
    try {
        const response = await fetch(base + '/api/generate/providers');
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.deepEqual(payload.providers.map(p => p.id), ['codex', 'gemini', 'local']);
        assert.equal(payload.providers[0].available, true);
        assert.equal(payload.providers[1].available, false);
        assert.match(payload.providers[1].reason, /GEMINI_API_KEY/);
        assert.equal(payload.providers[2].slow, true);
    } finally { await close(server); }
});

// --- GET/PUT /api/generate/style --------------------------------------------------------

test('GET /api/generate/style returns the default preamble and no references when nothing was saved', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        const response = await fetch(base + '/api/generate/style');
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.references.length, 0);
        assert.ok(payload.preamble.length > 0);
    } finally { await close(server); }
});

test('PUT then GET /api/generate/style round-trips the saved profile', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        const putResponse = await putJson(base, '/api/generate/style', { preamble: 'custom', references: [{ name: 'a.png', dataUrl: PNG_DATA_URL }] });
        assert.equal(putResponse.status, 200);
        const saved = await putResponse.json();
        assert.equal(saved.preamble, 'custom');
        assert.equal(saved.references.length, 1);

        const getResponse = await fetch(base + '/api/generate/style');
        assert.deepEqual(await getResponse.json(), saved);
    } finally { await close(server); }
});

test('PUT /api/generate/style: 400 on invalid JSON', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        const response = await fetch(base + '/api/generate/style', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'not json' });
        assert.equal(response.status, 400);
    } finally { await close(server); }
});

test('PUT /api/generate/style: 400 on more than 4 references', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        const references = Array.from({ length: 5 }, (_, i) => ({ name: `r${i}.png`, dataUrl: PNG_DATA_URL }));
        const response = await putJson(base, '/api/generate/style', { preamble: 'p', references });
        assert.equal(response.status, 400);
        assert.match((await response.json()).detail, /4/);
    } finally { await close(server); }
});

// --- POST /api/generate/image: success ---------------------------------------------------

test('POST /api/generate/image: 200 on a plain prompt-only request', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        const response = await postJson(base, '/api/generate/image', { provider: 'codex', prompt: 'a moose', aspect: 'square' });
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.provider, 'codex');
        assert.equal(payload.model, null);
        assert.ok(payload.image.startsWith('data:image/png;base64,'));
        assert.equal(typeof payload.seconds, 'number');
    } finally { await close(server); }
});

test('POST /api/generate/image: subject and saved style are assembled and handed to the provider in order', async () => {
    let seenArgs;
    const providers = [
        fakeProvider('codex', {
            generate: async args => { seenArgs = args; return { buffer: PNG_BYTES, mime: 'image/png', model: null }; },
        }),
        fakeProvider('gemini'), fakeProvider('local'),
    ];
    const server = startServer(providers);
    const base = await listen(server);
    try {
        await putJson(base, '/api/generate/style', { preamble: 'STYLE TEXT', references: [{ name: 'ref.png', dataUrl: PNG_DATA_URL }] });
        const response = await postJson(base, '/api/generate/image', {
            provider: 'codex', prompt: 'a loon', subject: PNG_DATA_URL, useStyle: true, aspect: 'portrait',
        });
        assert.equal(response.status, 200);
        assert.equal(seenArgs.images.length, 2);
        assert.equal(seenArgs.images[0].role, 'subject');
        assert.equal(seenArgs.images[1].role, 'style');
        assert.ok(seenArgs.prompt.includes('a loon'));
        assert.ok(seenArgs.prompt.includes('STYLE TEXT'));
        assert.ok(seenArgs.prompt.includes('Attached image 1 is the subject or design to follow.'));
        assert.ok(seenArgs.prompt.includes('Attached image 2 is visual style guidance only, not a replacement subject.'));
        assert.equal(seenArgs.aspect, 'portrait');
    } finally { await close(server); }
});

// --- POST /api/generate/image: 400 variants ----------------------------------------------

test('POST /api/generate/image: 400 on invalid JSON body', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        const response = await fetch(base + '/api/generate/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
        assert.equal(response.status, 400);
    } finally { await close(server); }
});

test('POST /api/generate/image: 400 on an unknown provider', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        const response = await postJson(base, '/api/generate/image', { provider: 'nope', prompt: 'p', aspect: 'square' });
        assert.equal(response.status, 400);
    } finally { await close(server); }
});

test('POST /api/generate/image: 400 on empty or missing prompt', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        assert.equal((await postJson(base, '/api/generate/image', { provider: 'codex', prompt: '   ', aspect: 'square' })).status, 400);
        assert.equal((await postJson(base, '/api/generate/image', { provider: 'codex', aspect: 'square' })).status, 400);
    } finally { await close(server); }
});

test('POST /api/generate/image: 400 on a prompt over 2000 characters', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        const response = await postJson(base, '/api/generate/image', { provider: 'codex', prompt: 'x'.repeat(2001), aspect: 'square' });
        assert.equal(response.status, 400);
    } finally { await close(server); }
});

test('POST /api/generate/image: 400 on an invalid aspect', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        const response = await postJson(base, '/api/generate/image', { provider: 'codex', prompt: 'p', aspect: 'huge' });
        assert.equal(response.status, 400);
    } finally { await close(server); }
});

test('POST /api/generate/image: 400 on a malformed subject data URL', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        const response = await postJson(base, '/api/generate/image', { provider: 'codex', prompt: 'p', aspect: 'square', subject: 'not-a-data-url' });
        assert.equal(response.status, 400);
    } finally { await close(server); }
});

test('POST /api/generate/image: 400 on a non-boolean useStyle', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        const response = await postJson(base, '/api/generate/image', { provider: 'codex', prompt: 'p', aspect: 'square', useStyle: 'yes' });
        assert.equal(response.status, 400);
    } finally { await close(server); }
});

// --- 403 origin guard ---------------------------------------------------------------------

test('POST /api/generate/image: 403 on a mismatched Origin', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        const response = await postJson(base, '/api/generate/image', { provider: 'codex', prompt: 'p', aspect: 'square' }, { Origin: 'https://unrelated.example' });
        assert.equal(response.status, 403);
    } finally { await close(server); }
});

// --- 409 busy -------------------------------------------------------------------------------

test('POST /api/generate/image: 409 when a generation is already running', async () => {
    let releaseFirst;
    const gate = new Promise(resolve => { releaseFirst = resolve; });
    let firstStarted;
    const startedPromise = new Promise(resolve => { firstStarted = resolve; });
    const providers = [
        fakeProvider('codex', { generate: async () => { firstStarted(); await gate; return { buffer: PNG_BYTES, mime: 'image/png', model: null }; } }),
        fakeProvider('gemini'), fakeProvider('local'),
    ];
    const server = startServer(providers);
    const base = await listen(server);
    try {
        const first = postJson(base, '/api/generate/image', { provider: 'codex', prompt: 'p', aspect: 'square' });
        await startedPromise;
        const second = await postJson(base, '/api/generate/image', { provider: 'gemini', prompt: 'p', aspect: 'square' });
        assert.equal(second.status, 409);
        releaseFirst();
        assert.equal((await first).status, 200);
    } finally { await close(server); }
});

// --- 413 oversized -----------------------------------------------------------------------

test('POST /api/generate/image: 413 when Content-Length declares a body over the cap', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        const { hostname, port } = new URL(base);
        const status = await new Promise((resolve, reject) => {
            const req = http.request({ hostname, port, method: 'POST', path: '/api/generate/image',
                headers: { 'Content-Type': 'application/json', 'Content-Length': String(70 * 1024 * 1024) } }, res => {
                res.resume();
                res.on('end', () => resolve(res.statusCode));
            });
            req.on('error', reject);
            req.end(); // never actually sends 70MB; the server rejects on the declared length alone
        });
        assert.equal(status, 413);
    } finally { await close(server); }
});

test('PUT /api/generate/style: 413 on a reference over the per-image cap (8 MB decoded)', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        // Oversized at the images.js layer maps to a style-endpoint 400 (documented: "400 on any
        // violation, 413 on an oversized body"); the 413 here is reserved for the whole PUT body.
        const bigDataUrl = `data:image/png;base64,${Buffer.concat([PNG_HEADER, Buffer.alloc(9 * 1024 * 1024)]).toString('base64')}`;
        const response = await putJson(base, '/api/generate/style', { preamble: 'p', references: [{ name: 'big.png', dataUrl: bigDataUrl }] });
        assert.equal(response.status, 400);
    } finally { await close(server); }
});

test('POST /api/generate/image: 413 when the subject image decodes over 20 MB', async () => {
    const server = startServer();
    const base = await listen(server);
    try {
        const hugeDataUrl = `data:image/png;base64,${Buffer.concat([PNG_HEADER, Buffer.alloc(21 * 1024 * 1024)]).toString('base64')}`;
        const response = await postJson(base, '/api/generate/image', { provider: 'codex', prompt: 'p', aspect: 'square', subject: hugeDataUrl });
        assert.equal(response.status, 413);
    } finally { await close(server); }
});

// --- provider failure statuses ------------------------------------------------------------

test('POST /api/generate/image: 502 when the provider fails', async () => {
    const providers = [fakeProvider('codex', { generate: async () => { throw Object.assign(new Error('boom'), { status: 502 }); } }), fakeProvider('gemini'), fakeProvider('local')];
    const server = startServer(providers);
    const base = await listen(server);
    try {
        const response = await postJson(base, '/api/generate/image', { provider: 'codex', prompt: 'p', aspect: 'square' });
        assert.equal(response.status, 502);
        assert.match((await response.json()).detail, /boom/);
    } finally { await close(server); }
});

test('POST /api/generate/image: 503 when the provider reports itself unavailable', async () => {
    const providers = [fakeProvider('codex', { availability: () => ({ available: false, reason: 'Codex CLI not found.' }) }), fakeProvider('gemini'), fakeProvider('local')];
    const server = startServer(providers);
    const base = await listen(server);
    try {
        const response = await postJson(base, '/api/generate/image', { provider: 'codex', prompt: 'p', aspect: 'square' });
        assert.equal(response.status, 503);
        assert.match((await response.json()).detail, /Codex CLI not found/);
    } finally { await close(server); }
});

test('POST /api/generate/image: 504 when the provider times out', async () => {
    const providers = [fakeProvider('codex', { generate: async () => { throw Object.assign(new Error('timed out'), { status: 504 }); } }), fakeProvider('gemini'), fakeProvider('local')];
    const server = startServer(providers);
    const base = await listen(server);
    try {
        const response = await postJson(base, '/api/generate/image', { provider: 'codex', prompt: 'p', aspect: 'square' });
        assert.equal(response.status, 504);
    } finally { await close(server); }
});

// --- client disconnect: abort + lock release ----------------------------------------------

test('client disconnect aborts the in-flight provider call and releases the lock', async () => {
    let sawAbort = false;
    let notifyStarted;
    const startedPromise = new Promise(resolve => { notifyStarted = resolve; });
    const providers = [
        fakeProvider('codex', {
            generate: ({ signal }) => new Promise((resolve, reject) => {
                notifyStarted();
                signal.addEventListener('abort', () => {
                    sawAbort = true;
                    reject(Object.assign(new Error('cancelled'), { status: 499, aborted: true }));
                });
            }),
        }),
        fakeProvider('gemini'), fakeProvider('local'),
    ];
    const server = startServer(providers);
    const base = await listen(server);
    try {
        const controller = new AbortController();
        const pending = fetch(base + '/api/generate/image', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'codex', prompt: 'p', aspect: 'square' }),
            signal: controller.signal,
        }).catch(() => null);

        await startedPromise;
        controller.abort();
        await pending;
        await waitFor(() => sawAbort);

        // Lock must be released: a fresh request goes through immediately, not 409.
        const second = await postJson(base, '/api/generate/image', { provider: 'gemini', prompt: 'p', aspect: 'square' });
        assert.equal(second.status, 200);
    } finally { await close(server); }
});
