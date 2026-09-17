/** Relief controller: saved jobs, settings and raster previews on the shared viewport. */
import * as api from './api.js';
import { loadImagePreview } from './imagePreview.js';
import { initNumberSliders } from './numberSliders.js';
import { initSurfacePreview } from './surfacePreview.js';
import { setInitialView } from '../viewport.js';
import { UNITS, getUnits, onUnitsChange, toDisplay, fromDisplay, formatDisplay, displayUnit, displayStep } from '../units.js';

const STORE = 'pieceout-relief-job';
const BUSY = new Set(['queued', 'depth_inference', 'relief_processing']);
const STAGES = { queued: 'Waiting for the relief worker…', depth_inference: 'Generating depth… The first run also loads the model.',
    relief_processing: 'Preparing your relief…', complete: 'Relief ready. Check the carving area, then export for Aspire.' };
const VIEWS = { depth: 'depth_preview.png', mask: 'mask_preview.png', shaded: 'shaded_preview.png', heightmap: 'relief_preview.png' };
const NS = 'http://www.w3.org/2000/svg';

// The two mm-space number inputs (width_mm, depth_mm) that need converting for display; their
// mm min/max/slider-max/slider-step baselines match what's authored directly into index.html,
// since that markup is static (not schema-rendered like the Layout/Trace forms).
const RELIEF_MM_FIELDS = {
    width_mm: { id: 'relief-width', min: 0.1, max: 10000, sliderMax: 500, sliderStep: 0.1 },
    depth_mm: { id: 'relief-depth', min: 0.01, max: 100, sliderMax: 25, sliderStep: 0.01 },
};

function roundedDisplay(mm, units) {
    const v = toDisplay(mm, 'mm', units);
    return units === UNITS.IN ? Math.round(v * 1000) / 1000 : v;
}

export function initRelief({ canvas, isActive }) {
    const $ = id => document.getElementById(id);
    const form = $('relief-settings');
    const status = $('relief-status');
    const sourceInput = $('relief-file');
    const maskInput = $('relief-mask');
    const generate = $('relief-generate');
    const reconnect = $('relief-reconnect');
    const view = $('relief-view');
    const controls = [...form.querySelectorAll('input, select')];
    const preview3D = initSurfacePreview($('relief-3d'));
    const updateNumberSliders = initNumberSliders(form);
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
    // Tracks whichever units the width/depth inputs are currently displayed in, so a units
    // change can convert the typed value from its old display units to the new ones - getUnits()
    // itself already reports the new value by the time the onUnitsChange listener runs.
    let reliefUnits = UNITS.MM;

    function remember(id) { try { if (id) localStorage.setItem(STORE, id); else localStorage.removeItem(STORE); } catch {} }
    function saved() { try { return localStorage.getItem(STORE); } catch { return null; } }
    function message(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
    function settings() {
        const units = getUnits();
        return Object.fromEntries(controls.map(input => {
            if (input.tagName === 'SELECT') return [input.name, input.value];
            const raw = Number(input.value);
            return [input.name, RELIEF_MM_FIELDS[input.name] ? fromDisplay(raw, 'mm', units) : raw];
        }));
    }
    // Values coming in here (a restored/reprocessed job's settings) are always mm; the two
    // fields that display in the active units need converting on the way into the input.
    function fillSettings(values) {
        const units = getUnits();
        controls.forEach(input => {
            if (values[input.name] === undefined) return;
            input.value = RELIEF_MM_FIELDS[input.name] ? formatDisplay(values[input.name], 'mm', units) : values[input.name];
        });
    }
    // Rewrites the width/depth inputs' value, min/max, slider range and unit label into the
    // newly active display units, converting the currently-typed value from whatever units were
    // active a moment ago (not getUnits(), which already reports the new one by the time this
    // listener runs).
    function applyReliefUnits(newUnits) {
        for (const spec of Object.values(RELIEF_MM_FIELDS)) {
            const input = $(spec.id);
            if (!input) continue;
            const raw = parseFloat(input.value);
            const mm = Number.isFinite(raw) ? fromDisplay(raw, 'mm', reliefUnits) : spec.min;
            input.value = formatDisplay(mm, 'mm', newUnits);
            input.min = String(roundedDisplay(spec.min, newUnits));
            input.max = String(roundedDisplay(spec.max, newUnits));
            input.dataset.sliderMax = String(roundedDisplay(spec.sliderMax, newUnits));
            input.dataset.sliderStep = String(displayStep(spec.sliderStep, 'mm', newUnits));
            const row = input.closest('.param-row');
            const unitSpan = row?.querySelector('.unit');
            if (unitSpan) unitSpan.textContent = displayUnit('mm', newUnits);
            // initNumberSliders() only reads min/max/dataset.sliderStep once, at construction,
            // to build the companion range input - keep that slider in sync by hand here too.
            const slider = $(`${spec.id}-slider`);
            if (slider) {
                slider.min = input.min;
                slider.max = input.dataset.sliderMax;
                slider.step = input.dataset.sliderStep;
                if (input.labels?.[0] && unitSpan) {
                    slider.setAttribute('aria-label', `${input.labels[0].textContent} (${unitSpan.textContent})`);
                }
            }
        }
        reliefUnits = newUnits;
        updateNumberSliders();
        updateControls();
    }
    function valid() {
        if (!form.reportValidity()) return false;
        const values = settings();
        if (values.near_percentile >= values.far_percentile) { message('Near clip must be below far clip.', true); return false; }
        return true;
    }
    // Mirrors the old plain-mm text (unrounded width, one-decimal height) for mm; inches use
    // formatDisplay's usual 3-decimal, trimmed rounding for both.
    function sizeText() {
        const units = getUnits();
        const wMm = settings().width_mm;
        const hMm = wMm * height / width;
        if (units !== UNITS.IN) return `${wMm} × ${hMm.toFixed(1)} mm · aspect ratio preserved`;
        return `${formatDisplay(wMm, 'mm', units)} × ${formatDisplay(hMm, 'mm', units)} in · aspect ratio preserved`;
    }
    function updateControls() {
        readings.forEach(([input, output]) => { output.value = input.value; });
        generate.disabled = !source || !connected || busy;
        controls.forEach(input => { input.disabled = busy; });
        updateNumberSliders();
        const raised = $('relief-mode').value === 'raised';
        $('relief-mode-help').textContent = raised
            ? 'Near features stay high above a carved pocket. Protected areas stay at the stock face. Increase Background limit to include more surrounding material in the pocket.'
            : 'Near features become deeper impressions. Protected areas stay at the stock face.';
        $('relief-engine-status').textContent = job?.fallback_reason || (job?.device
            ? `${job.engine === 'patchfusion-vitb' ? 'PatchFusion' : 'Depth Anything V2 Small'} · ${job.device === 'cuda' ? 'GPU' : 'CPU'}`
            : 'GPU preferred · CPU fallback if CUDA is unavailable or memory is insufficient.');
        $('relief-preview-note').textContent = dirty || busy ? 'Showing the last completed relief while settings update.' : '';
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
        $('relief-size').textContent = width ? sizeText() : 'Height follows the image proportions.';
        $('relief-empty').hidden = Boolean(sourceURL || job);
        for (const option of view.options) option.disabled = option.value !== 'source' && !(job?.version > 0);
    }
    function render() {
        updateControls();
        if (!isActive()) return;
        if (view.value === '3d' && job?.version) {
            preview3D.show(api.fileURL(job.id, job.version, 'surface_preview.json'), job.id);
            return;
        }
        preview3D.hide();
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
            else message('Open an image to make a relief carving.');
        } catch (error) {
            if (token === epoch) { connected = false; message(error.message, true); }
        } finally { checking = false; updateControls(); }
    }
    async function loadFile(file) {
        const token = ++selection;
        message('Opening image…');
        try {
            const { url, width: imageWidth, height: imageHeight } = await loadImagePreview(file);
            if (token !== selection) { URL.revokeObjectURL(url); return; }
            ++epoch;
            clearTimeout(polling); clearTimeout(debounce);
            if (sourceURL) URL.revokeObjectURL(sourceURL);
            sourceURL = url; source = file; mask = null; job = null; busy = false; dirty = false; maskDirty = false;
            width = imageWidth; height = imageHeight;
            maskInput.value = ''; remember(null); needsFit = true;
            $('relief-source-name').textContent = file.name;
            message(connected ? 'Image ready. Generate depth to begin.' : 'Image ready. Reconnect to the relief service to generate depth.');
            render();
        } catch (error) { if (token === selection) message(error.message || 'This image could not be opened.', true); }
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
        busy = true; updateControls();
        message(settings().depth_model !== (job.depth_model || 'patchfusion-vitb')
            ? 'Switching depth model… Cached results are reused when available.' : 'Updating relief from saved depth…');
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

    onUnitsChange(applyReliefUnits);
    applyReliefUnits(getUnits());

    return { loadFile, hide() { preview3D.hide(); },
        zoom(action) {
            if (view.value !== '3d' || !job?.version) return false;
            preview3D.zoom(action);
            return true;
        },
        show() { needsFit = true; render(); if (!connected && !checking) connect(); } };
}
