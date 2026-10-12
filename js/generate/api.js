/** Same-origin calls to PieceOut's Generate server API. */
const BASE = '/api/generate';

// Friendly text for statuses whose body might be missing or unparsable, so a network hiccup
// never surfaces a raw status code. A `detail` in the response body always wins over these.
const STATUS_FALLBACKS = {
    400: 'That request was not valid.',
    403: 'Blocked by the same-origin check.',
    409: 'Another generation is already running. Wait for it to finish, or cancel it, then try again.',
    413: 'That image is too large.',
    502: 'The image provider returned an error.',
    503: 'That provider is not configured yet.',
    504: 'The image provider timed out.',
};

async function request(path, options = {}) {
    let response;
    try {
        response = await fetch(BASE + path, options);
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        throw new Error('Cannot reach the server. Check the connection and try again.');
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
        const detail = typeof body?.detail === 'string' && body.detail.trim() ? body.detail : STATUS_FALLBACKS[response.status];
        throw new Error(detail || `The request failed (${response.status}).`);
    }
    return body;
}

export const getProviders = () => request('/providers');
export const getStyle = () => request('/style');

export function saveStyle(profile) {
    return request('/style', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
    });
}

// `signal` lets the caller cancel mid-request (Cancel button); the server notices the closed
// connection and cancels the provider call on its side.
export function generateImage(payload, signal) {
    return request('/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
    });
}
