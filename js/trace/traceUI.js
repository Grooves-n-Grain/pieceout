// js/trace/traceUI.js
/**
 * Trace tab controller: image in, thresholded bitmap, replayable edits,
 * trace pipeline, raster or vector view on the shared canvas, export.
 */
import { imageToBitmap } from './raster.js';
import { applyOps, bridgeIslandTo } from './bridge.js';
import { labelComponents } from './components.js';
import { tracePipeline, shapesToSVG } from './svg.js';
import { renderOverlay } from './overlay.js';
import { createNumbering, seedKey, bulkTargets } from './islandNumbers.js';
import { removeSmallIslands } from './sizeRule.js';
import { renderIslandList, renderStats } from './traceSidebar.js';
import { renderIslandPopover, positionPopover } from './islandPopover.js';
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
    { key: 'invert', label: 'Art is white on black', default: false, type: 'boolean' },
    { key: 'smoothness', label: 'Smoothness', default: 40, min: 0, max: 100, step: 5, unit: '%', integer: true },
    { key: 'minSpeck', label: 'Min speck size', default: 12, min: 0, max: 200, step: 1, unit: 'px', integer: true },
];
const CHECK_PARAMS = [
    { key: 'kerfMm', label: 'Kerf / bit', default: 0.3, min: 0, max: 10, step: 0.05, unit: 'mm' },
    { key: 'bridgeMm', label: 'Bridge width', default: 1.5, min: 0.2, max: 10, step: 0.1, unit: 'mm' },
    { key: 'minIslandMm2', label: 'Delete islands under', default: 0, min: 0, max: 10000, step: 0.5, unit: 'mm2' },
];
const SIZE_PARAMS = [
    { key: 'widthMm', label: 'Width', default: 100, min: 5, max: 2000, step: 1, unit: 'mm' },
    { key: 'includeOutline', label: 'Include outline', default: true, type: 'boolean' },
];
const ALL_PARAMS = [...IMAGE_PARAMS, ...CHECK_PARAMS, ...SIZE_PARAMS];

function defaults() {
    return Object.fromEntries(ALL_PARAMS.map(p => [p.key, p.default]));
}

export function initTrace({ canvas, getPanels, onSendToPreview, getBackground }) {
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
    const btnDeleteAll = $('btn-delete-all');
    const btnUndo = $('btn-trace-undo');
    const btnVector = $('btn-trace-vector');
    const btnExport = $('btn-trace-export');
    const btnSend = $('btn-trace-send');
    const bridgeHintEl = $('trace-bridge-hint');
    const popoverEl = $('trace-island-popover');
    const viewportContainerEl = $('viewport-container');
    const DEFAULT_HINT = bridgeHintEl.textContent;

    const state = {
        imageData: null, name: 'image', params: defaults(), panelName: '', ops: [],
        base: null, edited: null, result: null, scale: 1, view: 'raster', selectedIsland: -1,
        timingMs: 0, messages: [], regenerateMessages: [], panelMissing: false, bridgeClampPx: null,
        numbering: createNumbering(), kept: new Set(), popover: null, placing: null,
    };
    let timer = null;

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
            blackTouchesBorder: r.blackTouchesBorder,
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
            showPreview(canvas, createLayerState(parsed.layers), getBackground());
            // injectSVG overwrote the viewBox from the SVG's own dimensions; re-apply the
            // current zoom/pan instead of losing it, matching layoutUI.js's showSheet().
            refreshViewBox();
        }
        btnVector.textContent = state.view === 'raster' ? 'Vector' : 'Raster';
    }

    // anchorEl is the DOM element the popover should be anchored next to (a sidebar row or the
    // canvas mark that was clicked); omitted when the selection changes for some other reason,
    // in which case any open popover no longer applies to anything and is closed.
    function selectIsland(number, anchorEl) {
        state.selectedIsland = number;
        renderCanvas();
        renderSidebar();
        if (!anchorEl) { closePopover(); return; }
        const island = state.result && state.result.islands.find((i) => i.number === number);
        if (island) openPopover(island, anchorEl);
    }

    function renderHint() {
        bridgeHintEl.textContent = state.placing
            ? `Click the material to place the bridge for island ${state.placing.number} (Esc to cancel).`
            : DEFAULT_HINT;
    }

    function renderSidebar() {
        const r = state.result;
        renderIslandList(islandsEl, islandCountEl, r ? r.islands : [], state.scale, {
            selected: state.selectedIsland,
            onSelect: (island, row) => selectIsland(island.number, row),
            onBridge: (island) => pushOp({ kind: 'bridge', seed: island.seed, widthPx: bridgePx() }),
            onDelete: (island) => pushOp({ kind: 'delete', seed: island.seed }),
            onKeep: (island) => toggleKeep(island),
        });
        renderHint();
        const msgs = [...state.messages, ...state.regenerateMessages];
        if (r && r.islands.length) {
            const targets = bulkTargets(r.islands);
            const keptCount = r.islands.length - targets.length;
            if (targets.length) {
                const suffix = keptCount ? ` (${keptCount} kept)` : '';
                msgs.push({ level: 'warn', field: 'islands', message: `${targets.length} island(s) will fall out unless bridged.${suffix}` });
            }
        }
        // Islands are now sorted by number, not size, so find the largest by area explicitly.
        // If it outweighs the whole body, the threshold or invert setting is almost certainly
        // backwards (black and white got swapped) rather than there being a genuinely huge
        // island to bridge.
        if (r && r.islands.length) {
            const largest = r.islands.reduce((a, b) => (b.area > a.area ? b : a));
            if (largest.area > r.bodyArea) {
                msgs.push({ level: 'warn', field: 'islands', message: `Island ${largest.number} is bigger than the body; check the threshold or invert.` });
            }
        }
        if (state.panelMissing) msgs.push({ level: 'warn', field: 'panel', message: 'The selected Layout panel no longer exists; using width instead.' });
        if (state.params.bridgeMm < state.params.kerfMm) msgs.push({ level: 'warn', field: 'bridgeMm', message: 'Bridge is narrower than the kerf; it may burn away.' });
        if (state.bridgeClampPx) msgs.push({ level: 'warn', field: 'bridgeMm', message: `Bridge width clamped to ${state.bridgeClampPx} px for this image.` });
        if (r && r.blackTouchesBorder) msgs.push({ level: 'warn', field: 'outline', message: 'Black touches the image edge; edge segments may cut twice. Add a white margin for a clean outline.' });
        renderMessages(messagesEl, msgs, { islands: 'Islands', bridgeMm: 'Bridge width', file: 'File', panel: 'Panel', trace: 'Trace', outline: 'Outline' });
        renderStats(statsEl, r ? {
            width: state.edited.width, height: state.edited.height, contours: r.contours.length,
            segments: r.shapes.reduce((n, s) => n + s.outer.length + s.holes.reduce((m, h) => m + h.length, 0), 0),
            timingMs: state.timingMs, thinCount: r.thin.length,
        } : {});
        const ready = Boolean(r);
        btnExport.disabled = btnSend.disabled = btnVector.disabled = !ready;
        btnBridgeAll.disabled = btnDeleteAll.disabled = !ready || !bulkTargets(r.islands).length;
        btnUndo.disabled = !state.ops.length;
    }

    // Flips whether an island is kept as a separate piece rather than bridged/deleted. Kept
    // islands are annotated straight onto state.result.islands so the list and overlay pick it
    // up immediately; a full regenerate is only needed when the size rule is active, since kept
    // changes what that rule would otherwise remove. Either way, an open popover for this (or
    // any) island is refreshed afterwards rather than closed - see the note on regenerate().
    function toggleKeep(island) {
        const key = seedKey(island.seed);
        if (state.kept.has(key)) state.kept.delete(key);
        else state.kept.add(key);
        if (state.params.minIslandMm2 > 0) { regenerate({ keepPopover: true }); return; }
        if (state.result) {
            state.result.islands = state.result.islands.map((isl) => ({ ...isl, kept: state.kept.has(seedKey(isl.seed)) }));
        }
        renderCanvas();
        renderSidebar();
        syncPopover();
    }

    // bridgePxFor generalises the old fixed-width bridgePx() to any mm value, so the popover's
    // own width field can differ from the global Bridge width setting. Both share the same cap:
    // a bridge wider than the image itself is nonsensical and can make stampDisc do needless
    // work, so it's clamped to a quarter of the shorter side and the user is told why their
    // requested width didn't take effect.
    function bridgePxFor(mm) {
        const cap = Math.max(1, Math.round(Math.min(state.edited.width, state.edited.height) / 4));
        const px = Math.max(1, Math.round(mm / state.scale));
        if (px > cap) { state.bridgeClampPx = cap; return cap; }
        state.bridgeClampPx = null;
        return px;
    }

    function bridgePx() {
        return bridgePxFor(state.params.bridgeMm);
    }

    // --- Island popover: bridge/place/delete/keep for whichever island was last selected ---

    function positionPopoverNow() {
        if (!state.popover) return;
        const anchorRect = state.popover.anchorEl.getBoundingClientRect();
        const viewportRect = viewportContainerEl.getBoundingClientRect();
        positionPopover(popoverEl, anchorRect, viewportRect);
    }

    function renderPopoverContents(island) {
        const mm2 = island.area * state.scale * state.scale;
        renderIslandPopover(popoverEl, { ...island, mm2 }, {
            bridgeMm: state.params.bridgeMm,
            kept: Boolean(island.kept),
            onBridge: (widthMm) => pushOp({ kind: 'bridge', seed: island.seed, widthPx: bridgePxFor(widthMm) }),
            onPlace: (widthMm) => startPlacing(island, widthMm),
            onDelete: () => pushOp({ kind: 'delete', seed: island.seed }),
            onKeep: () => toggleKeep(island),
            onClose: () => closePopover(),
        });
    }

    // Re-reads the popover's island from the latest state.result (its data - area, kept flag,
    // even whether it still exists - can change out from under an open popover after a
    // regenerate) and re-renders and repositions it in place, or closes it if the island is gone.
    function syncPopover() {
        if (!state.popover) return;
        const island = state.result && state.result.islands.find((i) => i.number === state.popover.number);
        if (!island) { closePopover(); return; }
        renderPopoverContents(island);
        positionPopoverNow();
    }

    function openPopover(island, anchorEl) {
        state.popover = { number: island.number, anchorEl };
        popoverEl.hidden = false;
        syncPopover();
    }

    function closePopover() {
        if (!state.popover) return;
        state.popover = null;
        popoverEl.hidden = true;
        popoverEl.innerHTML = '';
    }

    function startPlacing(island, widthMm) {
        state.placing = { number: island.number, widthPx: bridgePxFor(widthMm) };
        closePopover();
        renderSidebar();
    }

    function setBusyButtons(disabled) {
        for (const btn of [btnBridgeAll, btnDeleteAll, btnUndo, btnVector, btnExport, btnSend, ...islandsEl.querySelectorAll('button')]) {
            btn.disabled = disabled;
        }
    }

    function runPipeline() {
        state.regenerateMessages = [];
        const t0 = performance.now();
        try {
            state.scale = computeScale();
            const tolerancePx = 0.5 + 2 * (state.params.smoothness / 100);
            const kerfPx = state.params.kerfMm / state.scale;
            state.base = imageToBitmap(state.imageData, { threshold: state.params.threshold, invert: state.params.invert });
            const replay = applyOps(state.base, state.ops, state.params.minSpeck);
            state.ops = replay.ops;
            // Only 'unreachable' is a genuine failure worth telling the user about; 'merged'
            // and 'gone' mean the op is a no-op now (already part of the body, or its island
            // no longer exists), not something that needs fixing.
            const unreachable = replay.dropped.filter(d => d.reason === 'unreachable').length;
            if (unreachable) {
                state.regenerateMessages.push({ level: 'warn', field: 'islands', message: `${unreachable} island${unreachable === 1 ? '' : 's'} could not be bridged: no path to the body.` });
            }
            // A targeted bridge whose click point stopped being reachable (a threshold change,
            // typically) still gets bridged via the nearest-gap fallback rather than dropped -
            // but the user asked for a specific spot and didn't get it, so say so.
            if (replay.fellBack) {
                state.regenerateMessages.push({ level: 'warn', field: 'islands', message: `${replay.fellBack} placed bridge${replay.fellBack === 1 ? '' : 's'} could not reach their target after the change and used the nearest gap instead.` });
            }
            state.edited = replay.bitmap;
            // The clamp depends on the image size and current scale, both of which can have
            // just changed (new image, new width, new panel); recompute it here so a stale
            // clamp warning from a previous image doesn't linger, and a newly-needed one shows.
            bridgePx();
            // Size rule runs after ops replay so an island the user already bridged is body and
            // exempt for free, one they already deleted is gone anyway, and a kept island is
            // exempt by key - none of that needs special-casing here.
            const minAreaPx = state.params.minIslandMm2 > 0 ? state.params.minIslandMm2 / (state.scale * state.scale) : 0;
            const sized = removeSmallIslands(state.edited, { minAreaPx, minSpeckPx: state.params.minSpeck, keptKeys: state.kept });
            state.edited = sized.bitmap;
            if (sized.removed > 0) {
                state.regenerateMessages.push({
                    level: 'info', field: 'islands',
                    message: `${sized.removed} island${sized.removed === 1 ? '' : 's'} under ${state.params.minIslandMm2} mm2 removed by the size rule.`,
                });
            }
            state.result = tracePipeline(state.edited, { tolerancePx, kerfPx, minSpeckPx: state.params.minSpeck });
            // Numbering keys islands by seed, same as the kept set, so annotate kept status here
            // once numbers are stable rather than threading it through the pipeline itself. Keys
            // are never pruned when their island disappears (a threshold nudge may bring it back
            // with the same seed), matching how numbering itself never retires a key either.
            state.result.islands = state.numbering.assign(state.result.islands)
                .map((island) => ({ ...island, kept: state.kept.has(seedKey(island.seed)) }));
            state.timingMs = performance.now() - t0;
            if (!state.result.islands.some(i => i.number === state.selectedIsland)) state.selectedIsland = -1;
        } catch (err) {
            // Keep whatever state.result/edited already held (from the last successful run)
            // visible rather than clearing them, so a bad parameter doesn't blank the canvas.
            state.regenerateMessages.push({ level: 'error', field: 'trace', message: err.message });
        } finally {
            // Render before dropping the busy state/re-enabling buttons, so a click that lands
            // right after this finally runs never races the paint that's still in flight.
            renderCanvas();
            document.body.classList.remove('trace-busy');
            setBusyButtons(false);
            renderSidebar();
            // A no-op unless keepPopover asked to keep the popover open through this
            // regenerate (see toggleKeep) - in every other case it was already closed
            // synchronously below, before the pipeline even ran.
            syncPopover();
        }
    }

    // keepPopover exists for exactly one caller (toggleKeep with the size rule active): flipping
    // "kept" can change what the size rule removes, which needs a real regenerate, but the user
    // is still looking at that island's popover and didn't ask to close it. Every other call site
    // closes the popover and cancels any pending "place bridge" click immediately, since a
    // regenerate can change island numbers, areas, or positions out from under them.
    function regenerate({ keepPopover = false } = {}) {
        if (!keepPopover) closePopover();
        state.placing = null;
        if (!state.imageData) { renderSidebar(); return; }
        document.body.classList.add('trace-busy');
        setBusyButtons(true);
        // The pipeline is synchronous and can block the main thread for a while on a large or
        // busy image; deferring it one tick lets the wait cursor and disabled buttons actually
        // paint first, instead of only appearing after the blocking work is already done.
        setTimeout(runPipeline, 0);
    }

    function scheduleRegenerate() {
        clearTimeout(timer);
        timer = setTimeout(regenerate, DEBOUNCE_MS);
    }

    function pushOp(op) {
        state.ops.push(op);
        // An explicit bridge or delete on an island wins over a prior keep: there's no point
        // keeping an island the user just told the pipeline to bridge or remove.
        state.kept.delete(seedKey(op.seed));
        state.selectedIsland = -1;
        regenerate();
    }

    // Shows a warning next to the islands list without waiting on a regenerate; replaces any
    // earlier copy of the same message instead of piling up duplicates from repeated bad clicks.
    function pushClickWarning(message) {
        state.regenerateMessages = state.regenerateMessages.filter((m) => m.message !== message);
        state.regenerateMessages.push({ level: 'warn', field: 'islands', message });
        renderSidebar();
    }

    // Converts a client (viewport pixel) coordinate to a bitmap pixel coordinate via the
    // canvas's own screen CTM, so this works whatever the current pan/zoom is.
    function clientToPixel(clientX, clientY) {
        const ctm = canvas.getScreenCTM();
        if (!ctm) return null;
        const pt = canvas.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const p = pt.matrixTransform(ctm.inverse());
        return [Math.floor(p.x), Math.floor(p.y)];
    }

    // islandNumber/widthPx are passed explicitly rather than read from state so the same
    // function serves both entry points: Shift+click (the currently selected island, the global
    // Bridge width) and a "Place bridge" click while state.placing is active (a specific island
    // and a width the user typed into its popover).
    function placeBridgeAt([x, y], islandNumber, widthPx) {
        const island = state.result.islands.find((i) => i.number === islandNumber);
        if (!island) return;
        const verb = state.placing ? 'Click' : 'Shift+click';
        const bm = state.edited;
        const inBounds = x >= 0 && y >= 0 && x < bm.width && y < bm.height;
        if (!inBounds || bm.data[y * bm.width + x] !== 1) {
            pushClickWarning(`${verb} on the material to place the bridge.`);
            return;
        }
        const a = labelComponents(bm, 1, state.params.minSpeck);
        if (!a.body[a.labels[y * bm.width + x]]) {
            pushClickWarning(`${verb} on the material to place the bridge.`);
            return;
        }
        // The click landed on body, but that alone doesn't mean this island can actually reach
        // it - a wall of other islands can seal it off entirely. Try the real bridge here, on
        // the same analysis, before committing to the op: a click with no open path across white
        // should place nothing, not silently redirect to wherever the nearest gap happens to be.
        const islandId = a.labels[island.seed[1] * bm.width + island.seed[0]];
        if (!bridgeIslandTo(bm, a, islandId, [x, y], widthPx)) {
            pushClickWarning(`No open path from island ${island.number} to that point. ${verb} a spot the island can reach across white.`);
            return;
        }
        pushOp({ kind: 'bridge', seed: island.seed, widthPx, target: [x, y] });
    }

    // Plain clicks select the island under the pointer, place a bridge while state.placing is
    // active (see "Place bridge" in the island popover), or - failing both - do nothing.
    // Shift+click places a targeted bridge from the currently selected island to the clicked
    // point using the global Bridge width, same as before "Place bridge" existed. Guarded so
    // this never fires outside the Trace tab or its raster view (the canvas is shared with
    // Preview/Layout, and vector view's viewBox is in mm, not bitmap pixels) and never treats
    // the mouseup at the end of a pan drag as a click (viewport.js owns panning; it does not
    // stop this 'click' from firing, so a moved-since-mousedown check is needed here to tell the
    // two apart).
    let mouseDownPos = null;
    canvas.addEventListener('mousedown', (e) => { mouseDownPos = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('click', (e) => {
        if (!document.body.classList.contains('mode-trace')) return;
        if (state.view !== 'raster' || !state.result) return;
        const start = mouseDownPos;
        mouseDownPos = null;
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 3) return;

        if (state.placing) {
            const px = clientToPixel(e.clientX, e.clientY);
            if (px) placeBridgeAt(px, state.placing.number, state.placing.widthPx);
            return;
        }
        if (e.shiftKey) {
            if (state.selectedIsland < 0) return;
            const px = clientToPixel(e.clientX, e.clientY);
            if (px) placeBridgeAt(px, state.selectedIsland, bridgePx());
            return;
        }
        const hit = e.target.closest && e.target.closest('[data-island-number]');
        if (hit) selectIsland(Number(hit.dataset.islandNumber), hit);
    });

    // Closes the popover on a click anywhere else - a mousedown listener rather than 'click' so
    // it runs before the click handler above opens a new popover for a different island. Ignored
    // whenever the popover is already hidden, so this costs nothing outside the Trace tab.
    document.addEventListener('mousedown', (e) => {
        if (popoverEl.hidden || popoverEl.contains(e.target)) return;
        closePopover();
    });

    // The popover is positioned from the anchor's live screen rect; a wheel zoom/pan changes
    // that rect without going through regenerate(), so it needs its own close here.
    canvas.parentElement.addEventListener('wheel', () => {
        if (document.body.classList.contains('mode-trace')) closePopover();
    });

    function onParamChange(key, value) {
        state.params[key] = value;
        // Bridge/delete op seeds are bitmap-pixel coordinates keyed to which side of the
        // threshold is "black"; flipping invert makes every existing seed meaningless. The
        // island numbering and kept set are keyed to seeds too, so reset them or old numbers/
        // kept flags could resurface on unrelated islands once the ops that anchored them
        // are gone.
        if (key === 'invert') {
            state.ops = [];
            state.numbering = createNumbering();
            state.kept = new Set();
        }
        scheduleRegenerate();
    }

    function renderSizeGroup() {
        renderParamInputs(sizeList, SIZE_PARAMS, state.params, onParamChange);
        const widthInput = document.getElementById('param-widthMm');
        if (widthInput) widthInput.disabled = Boolean(state.panelName);
    }

    function renderForm() {
        renderParamInputs(imageList, IMAGE_PARAMS, state.params, onParamChange);
        renderParamInputs(checkList, CHECK_PARAMS, state.params, onParamChange);
        renderSizeGroup();
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
        let changed = false;
        if (state.panelName && !panels.some(p => p.name === state.panelName)) {
            state.panelName = '';
            state.panelMissing = true;
            changed = true;
        } else {
            // Nothing vanished this time (either no panel was selected, or the selected one
            // still exists) - the warning from a previous vanish no longer applies.
            state.panelMissing = false;
        }
        panelSelect.value = state.panelName;
        const widthInput = document.getElementById('param-widthMm');
        if (widthInput) widthInput.disabled = Boolean(state.panelName);
        return changed;
    }

    async function loadFile(file) {
        state.messages = [];
        state.panelMissing = false;
        state.bridgeClampPx = null;
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
        state.numbering = createNumbering();
        state.kept = new Set();
        state.view = 'raster';
        regenerate();
        setInitialView({ x: 0, y: 0, width, height });
    }

    btnOpen.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); fileInput.value = ''; });
    panelSelect.addEventListener('change', () => {
        state.panelName = panelSelect.value;
        state.panelMissing = false;
        // No centring in v1 (spec amended by the controller): selecting a panel turns the
        // outline checkbox off, since the Layout part already supplies its own outline;
        // selecting None back leaves the checkbox exactly as the user last set it.
        if (state.panelName) state.params.includeOutline = false;
        renderSizeGroup();
        regenerate();
    });
    btnBridgeAll.addEventListener('click', () => {
        if (!state.result) return;
        for (const island of bulkTargets(state.result.islands)) state.ops.push({ kind: 'bridge', seed: island.seed, widthPx: bridgePx() });
        state.selectedIsland = -1;
        regenerate();
    });
    btnDeleteAll.addEventListener('click', () => {
        if (!state.result) return;
        for (const island of bulkTargets(state.result.islands)) state.ops.push({ kind: 'delete', seed: island.seed });
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
        closePopover();
        renderCanvas();
    }

    renderForm();
    renderSidebar();

    return {
        show() {
            // The popover is anchored to a specific DOM element from whichever tab we're
            // leaving; it can't usefully follow us to this one.
            closePopover();
            const changed = refreshPanelSelect();
            // app.js now owns remembering and restoring each tab's own pan/zoom across a tab
            // switch (see setTab in app.js), so this never calls setInitialView itself - that
            // happens exactly once per image, in loadFile. A panel may have changed its safe
            // area since we were last shown, so only pay for a full regenerate() when a panel
            // is actually driving the scale (state.panelName) or just stopped driving it
            // (changed, from refreshPanelSelect clearing a vanished panel) - either way the
            // scale may now be stale and must be recomputed; otherwise just repaint what's
            // already computed.
            if (state.result && (state.panelName || changed)) regenerate();
            else if (state.result) { renderCanvas(); renderSidebar(); }
            else { canvas.innerHTML = ''; renderSidebar(); }
        },
        loadFile,
        toggleView,
        clearSelection() {
            let changed = false;
            if (state.selectedIsland >= 0) { state.selectedIsland = -1; changed = true; }
            if (state.placing) { state.placing = null; changed = true; }
            if (state.popover) { closePopover(); changed = true; }
            if (!changed) return;
            renderCanvas();
            renderSidebar();
        },
    };
}
