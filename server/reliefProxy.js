const http = require('http');
const https = require('https');
const MAX_BODY = 42 * 1024 * 1024;

function proxyRelief(req, res, upstreamUrl) {
    const reply = (status, detail) => {
        if (res.headersSent || res.destroyed) return;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail }));
    };
    if (req.headers.origin) {
        try {
            if (new URL(req.headers.origin).host !== req.headers.host) {
                reply(403, 'Open Relief from this PieceOut workspace.');
                return;
            }
        } catch { reply(403, 'Invalid request origin.'); return; }
    }
    if (Number(req.headers['content-length']) > MAX_BODY) {
        reply(413, 'Upload is too large. Each image must be at most 20 MB.');
        return;
    }
    const target = new URL(upstreamUrl);
    const transport = target.protocol === 'https:' ? https : http;
    const headers = {};
    for (const name of ['content-type', 'content-length', 'accept', 'range']) {
        if (req.headers[name]) headers[name] = req.headers[name];
    }
    const upstream = transport.request({ hostname: target.hostname, port: target.port,
        protocol: target.protocol, path: req.url, method: req.method, headers, timeout: 60000 }, response => {
        if (res.writableEnded) { response.resume(); return; }
        const outgoing = {};
        for (const name of ['content-type', 'content-length', 'content-disposition', 'cache-control', 'content-range', 'accept-ranges']) {
            if (response.headers[name]) outgoing[name] = response.headers[name];
        }
        res.writeHead(response.statusCode, outgoing);
        response.on('error', () => res.destroy());
        response.pipe(res);
    });
    upstream.on('error', () => reply(503, 'The relief service is unavailable. Start it on the server, then reconnect.'));
    upstream.on('timeout', () => upstream.destroy());
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    let size = 0;
    req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY) { req.unpipe(upstream); reply(413, 'Upload is too large.'); upstream.destroy(); req.resume(); }
    });
    req.pipe(upstream);
}
module.exports = { proxyRelief };
