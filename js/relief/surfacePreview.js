/** Lazy, local 3D surface preview. Render only on interaction, resize or new data. */
export function initSurfacePreview(host) {
    const stage = host.querySelector('.relief-3d-stage');
    const notice = host.querySelector('[role="status"]');
    let viewer = null, loading = null, request = null, token = 0, wanted = '', loaded = '';

    async function show(url, fitKey) {
        host.hidden = false;
        if (wanted === url) return;
        wanted = url;
        const current = ++token;
        request?.abort();
        if (loaded === url && viewer) { notice.textContent = ''; stage.style.visibility = ''; viewer.resize(); return; }
        notice.textContent = 'Loading 3D surface…';
        stage.style.visibility = 'hidden';
        try {
            loading ||= import('./surfaceViewer.js');
            const { createSurfaceViewer } = await loading;
            if (current !== token) return;
            viewer ||= createSurfaceViewer(stage);
            request = new AbortController();
            const response = await fetch(url, { signal: request.signal });
            if (!response.ok) throw new Error('The 3D surface could not be loaded. Try another view, then retry.');
            const data = await response.json();
            if (current !== token) return;
            viewer.setSurface(data, fitKey);
            loaded = url;
            stage.style.visibility = '';
            notice.textContent = '';
        } catch (error) {
            if (current !== token || error.name === 'AbortError') return;
            wanted = '';
            notice.textContent = error.message;
        }
    }
    function hide() {
        host.hidden = true;
        ++token;
        request?.abort();
        wanted = '';
    }
    host.querySelector('[data-fit]').addEventListener('click', () => viewer?.fit());
    host.querySelector('[data-zoom-in]').addEventListener('click', () => viewer?.zoom(1 / 1.15));
    host.querySelector('[data-zoom-out]').addEventListener('click', () => viewer?.zoom(1.15));
    host.addEventListener('keydown', event => {
        if (event.target.tagName === 'BUTTON') return;
        if (event.key === '0') viewer?.fit();
        else if (event.key === '+' || event.key === '=') viewer?.zoom(1 / 1.15);
        else if (event.key === '-') viewer?.zoom(1.15);
        else return;
        event.preventDefault();
        event.stopPropagation();
    });
    window.addEventListener('pagehide', () => { hide(); viewer?.dispose(); viewer = null; loaded = ''; });
    return { show, hide, zoom(action) {
        if (action === 'fit') viewer?.fit();
        else viewer?.zoom(action === 'in' ? 1 / 1.15 : 1.15);
    } };
}
