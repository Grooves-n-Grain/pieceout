// A self-hosted, OpenAI-compatible image server (e.g. stable-diffusion.cpp behind llama-swap).
// Genuinely slow: real runs take 7 to 15 minutes, so this gets a much longer timeout than the
// hosted providers.
const { detectMime, EXT_BY_MIME } = require('../images.js');

const TIMEOUT_MS = 25 * 60 * 1000;
const SIZE_BY_ASPECT = { portrait: '1024x1536', landscape: '1536x1024', square: '1024x1024' };

function availability(config) {
    if (!config.LOCAL_IMAGE_URL) return { available: false, reason: 'Set LOCAL_IMAGE_URL in server/generate/.env' };
    return { available: true, reason: '' };
}

function buildRequest({ base, prompt, images, size, model }) {
    if (images.length) {
        const form = new FormData();
        form.set('model', model || '');
        form.set('prompt', prompt);
        form.set('n', '1');
        form.set('size', size);
        form.set('response_format', 'b64_json');
        images.forEach((image, i) => {
            const ext = EXT_BY_MIME[image.mime] || 'png';
            form.append('image[]', new Blob([image.buffer], { type: image.mime }), `image-${i}.${ext}`);
        });
        return { url: `${base}/v1/images/edits`, init: { method: 'POST', body: form } };
    }
    return {
        url: `${base}/v1/images/generations`,
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: model || '', prompt, n: 1, size, response_format: 'b64_json' }),
        },
    };
}

async function generate({ prompt, images, aspect, config, signal }) {
    if (!config.LOCAL_IMAGE_URL) {
        throw Object.assign(new Error('The local image server is not configured.'), { status: 503 });
    }
    const base = config.LOCAL_IMAGE_URL.replace(/\/+$/, '');
    const size = SIZE_BY_ASPECT[aspect] || SIZE_BY_ASPECT.square;
    const { url, init } = buildRequest({ base, prompt, images, size, model: config.LOCAL_IMAGE_MODEL });

    const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response;
    try {
        response = await fetch(url, { ...init, signal: combinedSignal });
    } catch {
        if (signal && signal.aborted) throw Object.assign(new Error('Generation was cancelled.'), { status: 499, aborted: true });
        if (timeoutSignal.aborted) throw Object.assign(new Error(`The local image server did not respond within ${TIMEOUT_MS / 60000} minutes.`), { status: 504 });
        throw Object.assign(new Error('Could not reach the local image server.'), { status: 502 });
    }

    if (!response.ok) throw Object.assign(new Error('The local image server returned an error.'), { status: 502 });

    let payload;
    try { payload = await response.json(); }
    catch { throw Object.assign(new Error('The local image server returned an unreadable response.'), { status: 502 }); }

    const b64 = payload && payload.data && payload.data[0] && payload.data[0].b64_json;
    if (!b64) throw Object.assign(new Error('The local image server did not return an image.'), { status: 502 });

    const buffer = Buffer.from(b64, 'base64');
    const mime = detectMime(buffer);
    if (!mime) throw Object.assign(new Error('The local image server returned an unsupported image format.'), { status: 502 });
    return { buffer, mime, model: config.LOCAL_IMAGE_MODEL || null };
}

module.exports = { id: 'local', label: 'Local model (slow)', slow: true, availability, generate, buildRequest };
