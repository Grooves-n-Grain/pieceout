// Google Gemini image generation over the public REST API.
const { detectMime } = require('../images.js');

const TIMEOUT_MS = 180000;
const ASPECT_RATIOS = { portrait: '2:3', landscape: '3:2', square: '1:1' };
const DEFAULT_MODEL = 'gemini-3.1-flash-image';

function availability(config) {
    if (!config.GEMINI_API_KEY) return { available: false, reason: 'Set GEMINI_API_KEY in server/generate/.env' };
    return { available: true, reason: '' };
}

async function generate({ prompt, images, aspect, config, signal }) {
    if (!config.GEMINI_API_KEY) {
        throw Object.assign(new Error('Gemini is not configured on the server.'), { status: 503 });
    }
    const model = config.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const parts = [{ text: prompt }];
    for (const image of images) {
        parts.push({ inlineData: { mimeType: image.mime, data: image.buffer.toString('base64') } });
    }
    const body = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: ASPECT_RATIOS[aspect] || ASPECT_RATIOS.square },
        },
    };

    const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.GEMINI_API_KEY },
            body: JSON.stringify(body),
            signal: combinedSignal,
        });
    } catch {
        if (signal && signal.aborted) throw Object.assign(new Error('Generation was cancelled.'), { status: 499, aborted: true });
        if (timeoutSignal.aborted) throw Object.assign(new Error(`Gemini did not respond within ${TIMEOUT_MS / 1000} seconds.`), { status: 504 });
        throw Object.assign(new Error('Could not reach Gemini.'), { status: 502 });
    }

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw Object.assign(new Error('Gemini rejected the request; check the Gemini API key and model access.'), { status: 502 });
        }
        if (response.status === 429) {
            throw Object.assign(new Error('Gemini usage limit reached, try later.'), { status: 502 });
        }
        throw Object.assign(new Error('Gemini returned an error.'), { status: 502 });
    }

    let payload;
    try { payload = await response.json(); }
    catch { throw Object.assign(new Error('Gemini returned an unreadable response.'), { status: 502 }); }

    const candidateParts = payload && payload.candidates && payload.candidates[0]
        && payload.candidates[0].content && payload.candidates[0].content.parts || [];
    const imageParts = candidateParts.filter(part => part && part.inlineData && part.inlineData.data);
    if (imageParts.length !== 1) {
        throw Object.assign(new Error('Gemini did not return exactly one image.'), { status: 502 });
    }

    const buffer = Buffer.from(imageParts[0].inlineData.data, 'base64');
    const mime = detectMime(buffer);
    if (!mime) throw Object.assign(new Error('Gemini returned an unsupported image format.'), { status: 502 });
    return { buffer, mime, model };
}

module.exports = { id: 'gemini', label: 'Gemini', slow: false, availability, generate };
