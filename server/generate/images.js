// Data URL decode/encode plus magic-byte format sniffing, dependency free.
// Sniffing only checks header bytes (per the generate-tab contract); it does not decode
// the image, so it cannot catch a truncated body that still starts with a valid header.
const SUPPORTED_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const DATA_URL_RE = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function detectMime(buffer) {
    if (!Buffer.isBuffer(buffer)) return null;
    if (buffer.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => buffer[i] === byte)) {
        return 'image/png';
    }
    if (buffer.length >= JPEG_SIGNATURE.length && JPEG_SIGNATURE.every((byte, i) => buffer[i] === byte)) {
        return 'image/jpeg';
    }
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        return 'image/webp';
    }
    return null;
}

// Decodes and validates a data URL. Throws an Error with `.reason` of 'invalid' (malformed
// input), 'bad_format' (not PNG/JPEG/WebP, or bytes do not match the declared type), or
// 'too_large' (over maxBytes decoded) so callers can map to the right HTTP status themselves.
function decodeDataUrl(dataUrl, { maxBytes } = {}) {
    if (typeof dataUrl !== 'string' || !dataUrl) {
        throw Object.assign(new Error('Expected a base64 data URL'), { reason: 'invalid' });
    }
    const match = DATA_URL_RE.exec(dataUrl);
    if (!match) throw Object.assign(new Error('Expected a base64 data URL'), { reason: 'invalid' });
    const declaredMime = match[1].toLowerCase();
    if (!SUPPORTED_MIMES.includes(declaredMime)) {
        throw Object.assign(new Error('Only PNG, JPEG, or WebP images are supported'), { reason: 'bad_format' });
    }
    const base64Body = match[2].replace(/\s+/g, '');
    // Bound the base64 length before decoding so a hostile payload cannot force a huge allocation.
    if (typeof maxBytes === 'number' && base64Body.length > Math.ceil((maxBytes * 4) / 3) + 8) {
        throw Object.assign(new Error('Image is too large'), { reason: 'too_large' });
    }
    let buffer;
    try {
        buffer = Buffer.from(base64Body, 'base64');
    } catch {
        throw Object.assign(new Error('Image contains invalid base64'), { reason: 'invalid' });
    }
    if (!buffer.length) throw Object.assign(new Error('Image is empty'), { reason: 'invalid' });
    if (typeof maxBytes === 'number' && buffer.length > maxBytes) {
        throw Object.assign(new Error('Image is too large'), { reason: 'too_large' });
    }
    const sniffed = detectMime(buffer);
    if (!sniffed) {
        throw Object.assign(new Error('Image content does not match a supported image format'), { reason: 'bad_format' });
    }
    if (sniffed !== declaredMime) {
        throw Object.assign(new Error('Image bytes do not match the declared type'), { reason: 'bad_format' });
    }
    return { buffer, mime: sniffed };
}

function encodeDataUrl(buffer, mime) {
    return `data:${mime};base64,${buffer.toString('base64')}`;
}

module.exports = { decodeDataUrl, encodeDataUrl, detectMime, SUPPORTED_MIMES, EXT_BY_MIME };
