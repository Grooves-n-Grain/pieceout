/** Same-origin calls to PieceOut's optional relief service. */
const BASE = '/api/relief';

async function request(path, options = {}) {
    let response;
    try {
        response = await fetch(BASE + path, { ...options, signal: AbortSignal.timeout(60000) });
    } catch {
        throw new Error('Cannot reach the relief service. Check the connection, then reconnect.');
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'The relief request failed. Try again.');
    return body;
}

export const health = () => request('/health');
export const getJob = id => request(`/jobs/${encodeURIComponent(id)}`);
export function createJob(image, mask, settings) {
    const data = new FormData();
    data.append('image', image);
    if (mask) data.append('mask', mask);
    data.append('settings', JSON.stringify(settings));
    return request('/jobs', { method: 'POST', body: data });
}
export const reprocess = (id, settings) => request(`/jobs/${encodeURIComponent(id)}/relief`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
});
export const fileURL = (id, version, name) => `${BASE}/jobs/${encodeURIComponent(id)}/files/${version}/${encodeURIComponent(name)}`;
