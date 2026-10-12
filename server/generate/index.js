// Route handler for /api/generate/*. Owns the single cross-provider in-flight lock and
// client-disconnect cancellation; everything else (config, prompt assembly, image codec,
// style persistence, provider calls) is delegated to the other server/generate modules.
const { loadConfig } = require('./config.js');
const { buildPrompt, DEFAULT_PREAMBLE } = require('./prompt.js');
const imageCodec = require('./images.js');
const styleStore = require('./styleStore.js');
const codexProvider = require('./providers/codex.js');
const geminiProvider = require('./providers/gemini.js');
const localProvider = require('./providers/local.js');

const MAX_IMAGE_BODY = 64 * 1024 * 1024;
const MAX_STYLE_BODY = 48 * 1024 * 1024;
const MAX_SUBJECT_BYTES = 20 * 1024 * 1024;
const MAX_PROMPT_CHARS = 2000;
const ASPECTS = ['portrait', 'landscape', 'square'];

function reply(res, status, body) {
    if (res.headersSent || res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

// Reads the body up to maxBytes, checking both Content-Length and the actual streamed size
// (a client can lie about or omit Content-Length). Replies 413 and returns null on overflow;
// the caller must then return without replying again.
function readBoundedBody(req, res, maxBytes) {
    return new Promise(resolve => {
        const declaredLength = Number(req.headers['content-length']);
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
            reply(res, 413, { detail: 'Request body is too large.' });
            req.resume();
            resolve(null);
            return;
        }
        const chunks = [];
        let size = 0;
        let finished = false;
        const finish = value => { if (finished) return; finished = true; resolve(value); };
        req.on('data', chunk => {
            if (finished) return;
            size += chunk.length;
            if (size > maxBytes) {
                reply(res, 413, { detail: 'Request body is too large.' });
                req.destroy();
                finish(null);
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => finish(Buffer.concat(chunks)));
        req.on('error', () => { reply(res, 400, { detail: 'Error reading request body.' }); finish(null); });
        req.on('aborted', () => finish(null));
    });
}

function parseJsonBody(raw) {
    try { return { body: JSON.parse(raw.toString('utf8')) }; }
    catch { return { error: 'Request body must be valid JSON.' }; }
}

// Factory so every createServer() call (and every test) gets a fresh, independent lock.
function createGenerateHandler({ providers: providerOverrides, dataDir: dataDirOverride, env } = {}) {
    const config = loadConfig({ env: env || process.env });
    if (dataDirOverride) config.dataDir = dataDirOverride;
    const providers = providerOverrides || [codexProvider, geminiProvider, localProvider];
    let busy = false;

    function checkOrigin(req) {
        if (!req.headers.origin) return true;
        try { return new URL(req.headers.origin).host === req.headers.host; }
        catch { return false; }
    }

    function handleProviders(req, res) {
        reply(res, 200, {
            providers: providers.map(provider => {
                const info = provider.availability(config);
                return { id: provider.id, label: provider.label, available: !!info.available, reason: info.reason || '', slow: !!provider.slow };
            }),
        });
    }

    async function handleGetStyle(req, res) {
        const profile = await styleStore.getStyle(config.dataDir, DEFAULT_PREAMBLE);
        reply(res, 200, profile);
    }

    async function handlePutStyle(req, res) {
        const raw = await readBoundedBody(req, res, MAX_STYLE_BODY);
        if (raw === null) return;
        const parsed = parseJsonBody(raw);
        if (parsed.error) return reply(res, 400, { detail: parsed.error });
        try {
            const saved = await styleStore.putStyle(config.dataDir, parsed.body, DEFAULT_PREAMBLE);
            reply(res, 200, saved);
        } catch (err) {
            reply(res, (err && err.status) || 400, { detail: (err && err.message) || 'Invalid style profile.' });
        }
    }

    async function handlePostImage(req, res) {
        if (busy) {
            reply(res, 409, { detail: 'Another generation is already running on this server.' });
            req.resume();
            return;
        }
        busy = true;
        const controller = new AbortController();
        let responded = false;
        const onClose = () => { if (!responded) controller.abort(); };
        res.on('close', onClose);

        try {
            const raw = await readBoundedBody(req, res, MAX_IMAGE_BODY);
            if (raw === null) { responded = true; return; }
            const parsed = parseJsonBody(raw);
            if (parsed.error) { responded = true; reply(res, 400, { detail: parsed.error }); return; }
            const body = parsed.body;
            if (!body || typeof body !== 'object') { responded = true; reply(res, 400, { detail: 'Request body must be a JSON object.' }); return; }

            const provider = providers.find(p => p.id === body.provider);
            if (!provider) { responded = true; reply(res, 400, { detail: 'provider must be one of codex, gemini, local.' }); return; }

            if (typeof body.prompt !== 'string') { responded = true; reply(res, 400, { detail: 'prompt is required.' }); return; }
            const prompt = body.prompt.trim();
            if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
                responded = true;
                reply(res, 400, { detail: `prompt must be 1 to ${MAX_PROMPT_CHARS} characters.` });
                return;
            }

            if (!ASPECTS.includes(body.aspect)) {
                responded = true;
                reply(res, 400, { detail: 'aspect must be portrait, landscape, or square.' });
                return;
            }
            const aspect = body.aspect;

            let useStyle = false;
            if (body.useStyle !== undefined) {
                if (typeof body.useStyle !== 'boolean') { responded = true; reply(res, 400, { detail: 'useStyle must be a boolean.' }); return; }
                useStyle = body.useStyle;
            }

            const images = [];
            if (body.subject !== undefined && body.subject !== null) {
                if (typeof body.subject !== 'string') { responded = true; reply(res, 400, { detail: 'subject must be a data URL string or null.' }); return; }
                let decoded;
                try {
                    decoded = imageCodec.decodeDataUrl(body.subject, { maxBytes: MAX_SUBJECT_BYTES });
                } catch (err) {
                    responded = true;
                    reply(res, err.reason === 'too_large' ? 413 : 400, { detail: err.message });
                    return;
                }
                images.push({ buffer: decoded.buffer, mime: decoded.mime, role: 'subject' });
            }

            const availability = provider.availability(config);
            if (!availability.available) {
                responded = true;
                reply(res, 503, { detail: availability.reason || `${provider.id} is not configured on the server.` });
                return;
            }

            let referenceCount = 0;
            if (useStyle) {
                const references = await styleStore.getReferenceBuffers(config.dataDir, DEFAULT_PREAMBLE);
                for (const reference of references) images.push({ buffer: reference.buffer, mime: reference.mime, role: 'style' });
                referenceCount = references.length;
            }
            const preamble = useStyle ? await styleStore.readPreamble(config.dataDir, DEFAULT_PREAMBLE) : '';
            const assembledPrompt = buildPrompt({
                prompt, hasSubject: images.some(image => image.role === 'subject'),
                useStyle, preamble, aspect, referenceCount,
            });

            const startedAt = Date.now();
            const result = await provider.generate({ prompt: assembledPrompt, images, aspect, config, signal: controller.signal });
            responded = true;
            reply(res, 200, {
                image: imageCodec.encodeDataUrl(result.buffer, result.mime),
                provider: provider.id,
                model: result.model === undefined ? null : result.model,
                seconds: Math.round((Date.now() - startedAt) / 100) / 10,
            });
        } catch (err) {
            responded = true;
            // The client gets only the safe message. Raw provider output stays in the server log,
            // which is the one place it is useful for diagnosing a failed login or a CLI change.
            if (!(err && err.aborted)) console.error('[generate]', (err && err.message) || err, (err && err.detail) ? `\n${err.detail}` : '');
            reply(res, (err && err.status) || 502, { detail: (err && err.message) || 'Image generation failed.' });
        } finally {
            res.off('close', onClose);
            busy = false;
        }
    }

    return async function handleGenerateRequest(req, res) {
        if (!checkOrigin(req)) { reply(res, 403, { detail: 'Open Generate from this PieceOut workspace.' }); return; }
        let pathname;
        try { pathname = new URL(req.url, 'http://localhost').pathname; }
        catch { reply(res, 400, { detail: 'Invalid request URL.' }); return; }

        try {
            if (pathname === '/api/generate/providers' && req.method === 'GET') return handleProviders(req, res);
            if (pathname === '/api/generate/style' && req.method === 'GET') return await handleGetStyle(req, res);
            if (pathname === '/api/generate/style' && req.method === 'PUT') return await handlePutStyle(req, res);
            if (pathname === '/api/generate/image' && req.method === 'POST') return await handlePostImage(req, res);
            reply(res, 404, { detail: 'Not found.' });
        } catch (err) {
            reply(res, 500, { detail: 'Unexpected server error.' });
        }
    };
}

module.exports = { createGenerateHandler };
