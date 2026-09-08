import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createServer } = require('../serve.js');

async function listen(server) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

test('static frontend works while backend and internal files are inaccessible', async () => {
    const server = createServer({ reliefUrl: 'http://127.0.0.1:1' });
    const base = await listen(server);
    try {
        assert.equal((await fetch(base + '/')).status, 200);
        assert.equal((await fetch(base + '/js/app.js?v=1')).status, 200);
        for (const path of ['/services/relief/relief/api.py', '/.git/config', '/serve.js', '/docs/design/cnc-relief-ai-codex-brief.md', '/js/%2e%2e/serve.js']) {
            assert.equal((await fetch(base + path)).status, 404, path);
        }
        const offline = await fetch(base + '/api/relief/health');
        assert.equal(offline.status, 503);
        assert.match((await offline.json()).detail, /relief service/i);
    } finally { await close(server); }
});

test('relief proxy preserves request body and response type/status', async () => {
    const backend = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => { res.writeHead(202, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ body, path: req.url })); });
    });
    const upstream = await listen(backend);
    const server = createServer({ reliefUrl: upstream });
    const base = await listen(server);
    try {
        const response = await fetch(base + '/api/relief/jobs', { method: 'POST', body: 'image bytes' });
        assert.equal(response.status, 202);
        assert.deepEqual(await response.json(), { body: 'image bytes', path: '/api/relief/jobs' });
        const rejected = await fetch(base + '/api/relief/jobs', { method: 'POST', headers: { Origin: 'https://unrelated.example' }, body: 'x' });
        assert.equal(rejected.status, 403);
    } finally { await close(server); await close(backend); }
});
