/** Relief controller: saved jobs, settings and raster previews on the shared viewport. */
import * as api from './api.js';
import { setInitialView } from '../viewport.js';

const STORE = 'pieceout-relief-job';
const BUSY = new Set(['queued', 'depth_inference', 'relief_processing']);
const STAGES = { queued: 'Waiting for the relief worker…', depth_inference: 'Generating depth… The first run also loads the model.',
    relief_processing: 'Preparing your recessed relief…', complete: 'Relief ready. Check the carving area, then export for Aspire.' };
const VIEWS = { depth: 'depth_preview.png', mask: 'mask_preview.png', shaded: 'shaded_preview.png', heightmap: 'relief_preview.png' };
const NS = 'http://www.w3.org/2000/svg';

export function initRelief({ canvas, isActive }) {
    const $ = id => document.getElementById(id);
    const form = $('relief-settings');
    const status = $('relief-status');
    const sourceInput = $('relief-file');
    const maskInput = $('relief-mask');
    const generate = $('relief-generate');
    const reconnect = $('relief-reconnect');
    const view = $('relief-view');
    const controls = [...form.querySelectorAll('input')];
    const downloads = [$('relief-download'), $('relief-metadata')];
    const readings = controls.filter(input => input.type === 'range').map(input => {
        const output = document.createElement('output');
        output.htmlFor = input.id;
        input.before(output);
        return [input, output];
    });
    let source = null, mask = null, sourceURL = '', width = 0, height = 0;
    let job = null, connected = false, busy = false, dirty = false, needsFit = true;
    let maskDirty = false, selection = 0;
    let epoch = 0, polling = null, debounce = null, checking = false;

    function remember(id) { try { if (id) localStorage.setItem(STORE, id); else localStorage.removeItem(STORE); } catch {} }
    function saved() { try { return localStorage.getItem(STORE); } catch { return null; } }
    function message(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
    function settings() { return Object.fromEntries(controls.map(input => [input.name, Number(input.value)])); }
    function fillSettings(values) { controls.forEach(input => { if (values[input.name] !== undefined) input.value = values[input.name]; }); }
    function valid() {
        if (!form.reportValidity()) return false;
        const values = settings();
        if (values.near_percentile >= values.far_percentile) { message('Near clip must be below far clip.', true); return false; }
        return true;
    }
    function updateControls() {
        readings.forEach(([input, output]) => { output.value = input.value; });
        generate.disabled = !source || !connected || busy;
        controls.forEach(input => { input.disabled = busy; });
        maskInput.disabled = busy || !source;
        $('relief-clear-mask').disabled = busy || !mask;
        reconnect.hidden = connected;
        $('relief-progress').hidden = !busy;
        downloads.forEach(link => {
            const available = job?.status === 'complete' && job.version > 0 && !busy && !dirty && !maskDirty;
            link.setAttribute('aria-disabled', String(!available));
            if (available) link.href = api.fileURL(job.id, job.version, link.dataset.file);
            else link.removeAttribute('href');
        });
        $('relief-size').textContent = width ? `${settings().width_mm} × ${(settings().width_mm * height / width).toFixed(1)} mm · aspect ratio preserved` : 'Height follows the image proportions.';
        $('relief-empty').hidden = Boolean(sourceURL || job);
        for (const option of view.options) option.disabled = option.value !== 'source' && !(job?.version > 0);
    }
    function render() {
        updateControls();
        if (!isActive()) return;
        let url = sourceURL;
        if (job) {
            url = api.fileURL(job.id, 0, 'source.png');
            if (job.version && view.value !== 'source') url = api.fileURL(job.id, job.version, VIEWS[view.value]);
        }
        canvas.replaceChildren();
        if (!url) return;
        const image = document.createElementNS(NS, 'image');
        image.setAttribute('href', url);
        image.setAttribute('width', width);
        image.setAttribute('height', height);
        canvas.appendChild(image);
        if (needsFit) {
            setInitialView({ x: 0, y: 0, width, height });
            needsFit = false;
        }
    }
    async function poll(token) {
        if (token !== epoch || !job) return;
        try {
            const next = await api.getJob(job.id);
            if (token !== epoch) return;
            job = next;
            busy = BUSY.has(next.status);
            connected = true;
            message(next.error || STAGES[next.status] || next.status, next.status === 'error');
            if (next.status === 'complete') dirty = false;
            render();
            if (busy) polling = setTimeout(() => poll(token), 1000);
        } catch (error) {
            if (token !== epoch) return;
            connected = false;
            busy = false;
            message(error.message, true);
            updateControls();
        }
    }
    async function connect() {
        if (checking) return;
        checking = true;
        const token = epoch;
        try {
            await api.health();
            if (token !== epoch) return;
            connected = true;
            if (!job && !source && saved()) {
                try {
                    const restored = await api.getJob(saved());
                    if (token !== epoch) return;
                    job = restored;
                    width = job.width; height = job.height;
                    fillSettings(job.settings);
                    $('relief-source-name').textContent = 'Restored your last image';
                } catch { remember(null); }
            }
            if (job) { clearTimeout(polling); await poll(token); }
            else message('Open an image to make a recessed carving.');
        } catch (error) {
            if (token === epoch) { connected = false; message(error.message, true); }
        } finally { checking = false; updateControls(); }
    }
    async function loadFile(file) {
        if (file.size > 20 * 1024 * 1024) { message('Choose an image smaller than 20 MB.', true); return; }
        const token = ++selection;
        const url = URL.createObjectURL(file);
        try {
            const image = new Image();
            image.src = url;
            await image.decode();
            if (token !== selection) { URL.revokeObjectURL(url); return; }
            if (image.naturalWidth * image.naturalHeight > 16000000 || Math.min(image.naturalWidth, image.naturalHeight) < 2) throw new Error('Choose an image between 2 × 2 and 16 million pixels.');
            ++epoch;
            clearTimeout(polling); clearTimeout(debounce);
            if (sourceURL) URL.revokeObjectURL(sourceURL);
            sourceURL = url; source = file; mask = null; job = null; busy = false; dirty = false; maskDirty = false;
            width = image.naturalWidth; height = image.naturalHeight;
            maskInput.value = ''; remember(null); needsFit = true;
            $('relief-source-name').textContent = file.name;
            message(connected ? 'Image ready. Generate depth to begin.' : 'Image ready. Reconnect to the relief service to generate depth.');
            render();
        } catch (error) { URL.revokeObjectURL(url); message(error.message || 'This image could not be opened.', true); }
    }
    async function submit() {
        if (!source || busy || !valid()) return;
        const token = ++epoch;
        clearTimeout(polling); clearTimeout(debounce);
        busy = true; dirty = true;
        message('Uploading image…'); updateControls();
        try {
            const created = await api.createJob(source, mask, settings());
            if (token !== epoch) return;
            job = created; maskDirty = false; remember(job.id);
            width = job.width; height = job.height; needsFit = true;
            view.value = 'shaded';
            await poll(token);
        } catch (error) {
            if (token === epoch) { busy = false; message(error.message, true); updateControls(); }
        }
    }
    async function adjust() {
        if (!job?.has_depth || busy || !valid()) return;
        if (maskDirty) { message('Generate depth to apply the selected carving mask.'); return; }
        const token = epoch;
        busy = true; updateControls(); message('Updating relief from saved depth…');
        try {
            const next = await api.reprocess(job.id, settings());
            if (token !== epoch) return;
            job = next;
            await poll(token);
        } catch (error) {
            if (token === epoch) { busy = false; message(error.message, true); updateControls(); }
        }
    }
    form.addEventListener('input', () => {
        dirty = Boolean(job); updateControls();
        clearTimeout(debounce);
        if (job?.has_depth) debounce = setTimeout(adjust, 450);
    });
    generate.addEventListener('click', submit);
    reconnect.addEventListener('click', connect);
    $('relief-open').addEventListener('click', () => sourceInput.click());
    $('relief-empty-open').addEventListener('click', () => sourceInput.click());
    sourceInput.addEventListener('change', () => { if (sourceInput.files[0]) loadFile(sourceInput.files[0]); sourceInput.value = ''; });
    maskInput.addEventListener('change', () => {
        mask = maskInput.files[0] || null;
        maskDirty = true;
        dirty = Boolean(job);
        message(mask ? 'Mask selected. Generate depth to use it. White allows carving; black protects the face.' : 'Mask removed.');
        updateControls();
    });
    $('relief-clear-mask').addEventListener('click', () => { mask = null; maskInput.value = ''; maskDirty = true; dirty = Boolean(job); message('Mask removed. Generate depth to update the carving area.'); updateControls(); });
    view.addEventListener('change', render);
    return { loadFile, show() { needsFit = true; render(); if (!connected && !checking) connect(); } };
}
