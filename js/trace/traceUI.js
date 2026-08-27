// js/trace/traceUI.js
/**
 * Trace tab controller: image in, thresholded bitmap, replayable edits,
 * trace pipeline, raster or vector view on the shared canvas, export.
 */
import { imageToBitmap } from './raster.js';
import { applyOps } from './bridge.js';
import { tracePipeline, shapesToSVG } from './svg.js';
import { renderOverlay } from './overlay.js';
import { renderIslandList, renderStats } from './traceSidebar.js';
import { renderParamInputs, renderMessages } from '../layout/layoutForm.js';
import { downloadText } from '../layout/download.js';
import { parseSVG } from '../svgParser.js';
import { injectSVG, showPreview } from '../renderer.js';
import { createLayerState } from '../layerTagger.js';
import { setInitialView, refreshViewBox } from '../viewport.js';
import { fmt } from '../layout/svgWriter.js';

const MAX_SIDE = 4000;
const DEBOUNCE_MS = 80;

const IMAGE_PARAMS = [
    { key: 'threshold', label: 'Threshold', default: 128, min: 1, max: 254, step: 1, unit: '', integer: true },
    { key: 'invert', label: 'Invert (white stays)', default: false, type: 'boolean' },
    { key: 'smoothness', label: 'Smoothness', default: 40, min: 0, max: 100, step: 5, unit: '%', integer: true },
    { key: 'minSpeck', label: 'Min speck size', default: 12, min: 0, max: 200, step: 1, unit: 'px', integer: true },
];
const CHECK_PARAMS = [
    { key: 'kerfMm', label: 'Kerf / bit', default: 0.3, min: 0, max: 10, step: 0.05, unit: 'mm' },
    { key: 'bridgeMm', label: 'Bridge width', default: 1.5, min: 0.2, max: 10, step: 0.1, unit: 'mm' },
];
const SIZE_PARAMS = [
    { key: 'widthMm', label: 'Width', default: 100, min: 5, max: 2000, step: 1, unit: 'mm' },
    { key: 'includeOutline', label: 'Include outline', default: true, type: 'boolean' },
];
const ALL_PARAMS = [...IMAGE_PARAMS, ...CHECK_PARAMS, ...SIZE_PARAMS];

function defaults() {
    return Object.fromEntries(ALL_PARAMS.map(p => [p.key, p.default]));
}

export function initTrace({ canvas, getPanels, onSendToPreview }) {
    const $ = (id) => document.getElementById(id);
    const imageList = $('group-trace-image').querySelector('.param-list');
    const checkList = $('group-trace-checks').querySelector('.param-list');
    const sizeList = $('group-trace-size').querySelector('.param-list');
    const panelSelect = $('trace-panel-select');
    const islandsEl = $('trace-islands');
    const islandCountEl = $('trace-island-count');
    const messagesEl = $('trace-messages');
    const statsEl = $('trace-stats');
    const fileInput = $('trace-file-input');
    const btnOpen = $('btn-trace-open');
    const btnBridgeAll = $('btn-bridge-all');
    const btnUndo = $('btn-trace-undo');
    const btnVector = $('btn-trace-vector');
    const btnExport = $('btn-trace-export');
    const btnSend = $('btn-trace-send');

    const state = {
        imageData: null, name: 'image', params: defaults(), panelName: '', ops: [],
        base: null, edited: null, result: null, scale: 1, view: 'raster', selectedIsland: -1,
        timingMs: 0, messages: [], regenerateMessages: [], panelMissing: false, fitted: false,
    };
    let timer = null;
    // The shared viewport module (viewport.js) is one global singleton with no notion of
    // "which tab last owned it": Layout's own show() unconditionally re-fits it to its sheet
    // every time it's shown, and Preview does the same whenever an SVG is loaded there. A
    // detour through either tab overwrites the pan/zoom Trace had, and there is no way to
    // recover Trace's exact prior view afterwards - but a MutationObserver on the canvas's
    // viewBox lets Trace tell "I changed this" (while `mode-trace` is the active body class,
    // covering both its own re-renders and the user's manual zoom/pan while on this tab) apart
    // from "something else changed this" (mutations while another tab is active), so it can at
    // least fall back to a correct full-image fit instead of showing a nonsensical crop sized
    // for whatever the other tab was displaying.
    let needsRefit = false;
    let lastOwnViewBox = null;
    const viewBoxObserver = new MutationObserver(() => {
        const current = canvas.getAttribute('viewBox');
        if (document.body.classList.contains('mode-trace')) {
            lastOwnViewBox = current;
        } else if (lastOwnViewBox !== null && current !== lastOwnViewBox) {
            needsRefit = true;
        }
    });
    viewBoxObserver.observe(canvas, { attributes: true, attributeFilter: ['viewBox'] });

    function selectedPanel() {
        return state.panelName ? getPanels().find(p => p.name === state.panelName) : null;
    }

    function computeScale() {
        const W = state.imageData.width, H = state.imageData.height;
        const panel = selectedPanel();
        if (panel) return Math.min(panel.safeArea.width / W, panel.safeArea.height / H);
        return state.params.widthMm / W;
    }

    function exportSvg(scale) {
        const r = state.result;
        return shapesToSVG({
            shapes: r.shapes, widthPx: state.edited.width, heightPx: state.edited.height, scale,
            includeOutline: state.params.includeOutline, islands: r.islands, thin: r.thin,
        });
    }

    function renderCanvas() {
        if (!state.result) return;
        if (state.view === 'raster') {
            renderOverlay(canvas, {
                bitmap: state.result.bitmap, islands: state.result.islands, thin: state.result.thin,
                bridges: state.ops.filter(o => o.kind === 'bridge'), shapes: state.result.shapes,
                selectedIsland: state.selectedIsland,
            });
        } else {
            const parsed = parseSVG(exportSvg(1));
            injectSVG(parsed, canvas);
            showPreview(canvas, createLayerState(parsed.layers), '#1a1a2e');
            // injectSVG overwrote the viewBox from the SVG's own dimensions; re-apply the
            // current zoom/pan instead of losing it, matching layoutUI.js's showSheet().
            refreshViewBox();
        }
        btnVector.textContent = state.view === 'raster' ? 'Vector' : 'Raster';
    }

    function renderSidebar() {
        const r = state.result;
        renderIslandList(islandsEl, islandCountEl, r ? r.islands : [], state.scale, {
            selected: state.selectedIsland,
            onSelect: (i) => { state.selectedIsland = i; renderCanvas(); renderSidebar(); },
            onBridge: (island) => pushOp({ kind: 'bridge', seed: island.seed, widthPx: bridgePx() }),
            onDelete: (island) => pushOp({ kind: 'delete', seed: island.seed }),
        });
        const msgs = [...state.messages, ...state.regenerateMessages];
        if (r && r.islands.length) msgs.push({ level: 'warn', field: 'islands', message: `${r.islands.length} island(s) will fall out unless bridged.` });
        if (state.panelMissing) msgs.push({ level: 'warn', field: 'panel', message: 'The selected Layout panel no longer exists; using width instead.' });
        if (state.params.bridgeMm < state.params.kerfMm) msgs.push({ level: 'warn', field: 'bridgeMm', message: 'Bridge is narrower than the kerf; it may burn away.' });
        renderMessages(messagesEl, msgs, { islands: 'Islands', bridgeMm: 'Bridge width', file: 'File', panel: 'Panel', trace: 'Trace' });
        renderStats(statsEl, r ? {
            width: state.edited.width, height: state.edited.height, contours: r.contours.length,
            segments: r.shapes.reduce((n, s) => n + s.outer.length + s.holes.reduce((m, h) => m + h.length, 0), 0),
            timingMs: state.timingMs, thinCount: r.thin.length,
        } : {});
        const ready = Boolean(r);
        btnExport.disabled = btnSend.disabled = btnVector.disabled = !ready;
        btnBridgeAll.disabled = !ready || !r.islands.length;
        btnUndo.disabled = !state.ops.length;
    }

    function bridgePx() {
        return Math.max(1, Math.round(state.params.bridgeMm / state.scale));
    }

    function regenerate() {
        if (!state.imageData) { renderSidebar(); return; }
        state.regenerateMessages = [];
        const t0 = performance.now();
        try {
            state.scale = computeScale();
            const tolerancePx = 0.5 + 2 * (state.params.smoothness / 100);
            const kerfPx = state.params.kerfMm / state.scale;
            state.base = imageToBitmap(state.imageData, { threshold: state.params.threshold, invert: state.params.invert });
            const replay = applyOps(state.base, state.ops);
            state.ops = replay.ops;
            // Only 'unreachable' is a genuine failure worth telling the user about; 'merged'
            // and 'gone' mean the op is a no-op now (already part of the body, or its island
            // no longer exists), not something that needs fixing.
            const unreachable = replay.dropped.filter(d => d.reason === 'unreachable').length;
            if (unreachable) {
                state.regenerateMessages.push({ level: 'warn', field: 'islands', message: `${unreachable} island${unreachable === 1 ? '' : 's'} could not be bridged: no path to the body.` });
            }
            state.edited = replay.bitmap;
            state.result = tracePipeline(state.edited, { tolerancePx, kerfPx, minSpeckPx: state.params.minSpeck });
            state.timingMs = performance.now() - t0;
            if (state.selectedIsland >= state.result.islands.length) state.selectedIsland = -1;
        } catch (err) {
            // Keep whatever state.result/edited already held (from the last successful run)
            // visible rather than clearing them, so a bad parameter doesn't blank the canvas.
            state.regenerateMessages.push({ level: 'error', field: 'trace', message: err.message });
        }
        renderCanvas();
        renderSidebar();
    }

    function scheduleRegenerate() {
        clearTimeout(timer);
        timer = setTimeout(regenerate, DEBOUNCE_MS);
    }

    function pushOp(op) {
        state.ops.push(op);
        state.selectedIsland = -1;
        regenerate();
    }

    function renderForm() {
        const onChange = (key, value) => {
            state.params[key] = value;
            // Bridge/delete op seeds are bitmap-pixel coordinates keyed to which side of the
            // threshold is "black"; flipping invert makes every existing seed meaningless.
            if (key === 'invert') state.ops = [];
            scheduleRegenerate();
        };
        renderParamInputs(imageList, IMAGE_PARAMS, state.params, onChange);
        renderParamInputs(checkList, CHECK_PARAMS, state.params, onChange);
        renderParamInputs(sizeList, SIZE_PARAMS, state.params, onChange);
    }

    function refreshPanelSelect() {
        const panels = getPanels();
        panelSelect.innerHTML = '<option value="">None</option>';
        for (const p of panels) {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = `${p.name} (${fmt(p.safeArea.width)} x ${fmt(p.safeArea.height)} mm)`;
            panelSelect.appendChild(opt);
        }
        if (state.panelName && !panels.some(p => p.name === state.panelName)) {
            state.panelName = '';
            state.panelMissing = true;
        }
        panelSelect.value = state.panelName;
        const widthInput = document.getElementById('param-widthMm');
        if (widthInput) widthInput.disabled = Boolean(state.panelName);
    }

    async function loadFile(file) {
        state.messages = [];
        state.fitted = false;
        if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) {
            state.messages.push({ level: 'error', field: 'file', message: 'Drop a PNG, JPG, or WebP image.' });
            renderSidebar();
            return;
        }
        let bitmap;
        try {
            bitmap = await createImageBitmap(file);
        } catch (err) {
            state.messages.push({ level: 'error', field: 'file', message: `Could not decode ${file.name}: ${err.message}` });
            renderSidebar();
            return;
        }
        let { width, height } = bitmap;
        const longest = Math.max(width, height);
        if (longest > MAX_SIDE) {
            const k = MAX_SIDE / longest;
            width = Math.round(width * k);
            height = Math.round(height * k);
            state.messages.push({ level: 'warn', field: 'file', message: `Downscaled to ${MAX_SIDE} px on the long side.` });
        }
        const off = document.createElement('canvas');
        off.width = width;
        off.height = height;
        const ctx = off.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close?.();
        state.imageData = ctx.getImageData(0, 0, width, height);
        state.name = file.name;
        state.ops = [];
        state.selectedIsland = -1;
        state.view = 'raster';
        regenerate();
        setInitialView({ x: 0, y: 0, width, height });
        state.fitted = true;
    }

    btnOpen.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); fileInput.value = ''; });
    panelSelect.addEventListener('change', () => {
        state.panelName = panelSelect.value;
        state.panelMissing = false;
        const widthInput = document.getElementById('param-widthMm');
        if (widthInput) widthInput.disabled = Boolean(state.panelName);
        regenerate();
    });
    btnBridgeAll.addEventListener('click', () => {
        if (!state.result) return;
        for (const island of state.result.islands) state.ops.push({ kind: 'bridge', seed: island.seed, widthPx: bridgePx() });
        state.selectedIsland = -1;
        regenerate();
    });
    btnUndo.addEventListener('click', () => { state.ops.pop(); regenerate(); });
    btnVector.addEventListener('click', () => toggleView());
    btnExport.addEventListener('click', () => {
        if (!state.result) return;
        downloadText(state.name.replace(/\.[^.]+$/, '') + '-trace.svg', exportSvg(state.scale));
    });
    btnSend.addEventListener('click', () => { if (state.result) onSendToPreview(exportSvg(state.scale)); });

    function toggleView() {
        if (!state.result) return;
        state.view = state.view === 'raster' ? 'vector' : 'raster';
        renderCanvas();
    }

    renderForm();
    renderSidebar();

    return {
        show() {
            refreshPanelSelect();
            if (state.result) {
                // This never re-fits the view on its own - that happens exactly once per
                // image, in loadFile - except in the one case where the viewBoxObserver above
                // caught another tab changing the shared viewport since Trace last touched it:
                // there is no Trace zoom left to preserve there, and showing whatever the
                // other tab left behind would be a nonsensical crop.
                if (needsRefit) {
                    setInitialView({ x: 0, y: 0, width: state.edited.width, height: state.edited.height });
                    needsRefit = false;
                }
                // A Layout edit may also have changed the selected panel's safe area, so only
                // pay for a full regenerate() when a panel is actually driving the scale;
                // otherwise just repaint what's already computed.
                if (state.panelName) regenerate();
                else { renderCanvas(); renderSidebar(); }
            } else {
                canvas.innerHTML = '';
            }
        },
        loadFile,
        toggleView,
    };
}
