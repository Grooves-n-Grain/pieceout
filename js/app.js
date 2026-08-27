/**
 * PieceOut - CNC Cut Preview Tool
 * Main application entry point
 */

import { parseSVG, getSVGBounds } from './svgParser.js';
import {
    LayerType, createLayerState, renderLayerList,
    nextLayerType, saveLayerPreferences, loadLayerPreferences,
} from './layerTagger.js';
import {
    injectSVG, showWireframe, showPreview, getMode,
    setMaterialColor, exportPNG,
} from './renderer.js';
import {
    initViewport, setInitialView, zoomIn, zoomOut, zoomFit, getView, setView,
} from './viewport.js';
import { initLayout } from './layout/layoutUI.js';
import { initTrace } from './trace/traceUI.js';

// --- State ---
let parsedSVG = null;
let layerState = [];
let currentView = 'wireframe'; // 'wireframe' | 'preview'

// --- DOM refs ---
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const canvas = document.getElementById('svg-canvas');
const viewport = document.getElementById('viewport');
const layerListEl = document.getElementById('layer-list');

let activeTab = 'preview'; // 'preview' | 'layout' | 'trace'
const tabViews = {}; // per-tab saved pan/zoom, keyed by tab name
const tabButtons = document.querySelectorAll('.tab-btn');

const btnWireframe = document.getElementById('btn-wireframe');
const btnPreview = document.getElementById('btn-preview');
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomFit = document.getElementById('btn-zoom-fit');
const btnExportPNG = document.getElementById('btn-export-png');
const bgSelect = document.getElementById('bg-select');
const materialColorInput = document.getElementById('material-color');
const btnLegend = document.getElementById('btn-legend');
const btnLegendClose = document.getElementById('btn-legend-close');
const legendEl = document.getElementById('legend');

const btnAllCut = document.getElementById('btn-all-cut');
const btnAllIgnore = document.getElementById('btn-all-ignore');
const btnClearTags = document.getElementById('btn-clear-tags');

// --- File drop handling ---

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
});

// Drag events on the entire viewport container
const container = document.getElementById('viewport-container');

container.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (activeTab !== 'preview') return;
    e.stopPropagation();
    dropZone.classList.add('drag-over');
    if (!dropZone.classList.contains('visible')) {
        dropZone.classList.add('visible');
    }
});

container.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (activeTab !== 'preview') return;
    dropZone.classList.remove('drag-over');
    if (parsedSVG) {
        dropZone.classList.remove('visible');
    }
});

container.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');

    const file = e.dataTransfer?.files[0];
    if (activeTab === 'trace') {
        if (file) trace.loadFile(file);
        return;
    }
    if (activeTab === 'layout') return;

    if (file && file.name.endsWith('.svg')) {
        loadFile(file);
    }
});

// --- File loading ---

function loadFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            loadSVGContent(e.target.result);
        } catch (err) {
            console.error('Error loading SVG:', err);
            alert('Error loading SVG: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function loadSVGContent(svgText) {
    // Mutates the shared viewport via setInitialView below, so callers must switch to Preview
    // first: mutate the viewport only while the owning tab is active.
    parsedSVG = parseSVG(svgText);

    // Hide drop zone
    dropZone.classList.remove('visible');

    // Inject SVG into canvas
    injectSVG(parsedSVG, canvas);

    // Set up layers
    layerState = createLayerState(parsedSVG.layers);
    loadLayerPreferences(layerState);

    // Render layer sidebar
    updateLayerList();

    // Set viewport — pass canvas for accurate content bounds via getBBox()
    const bounds = getSVGBounds(parsedSVG, canvas);
    setInitialView(bounds);
    // A newly loaded SVG always gets this fresh fit; discard any stale saved Preview view so
    // it can never be restored over the new content on some later tab switch. The user's next
    // zoom is captured normally when they leave Preview again.
    delete tabViews.preview;

    // Apply current view mode
    applyView();
}

// --- View mode switching ---

function applyView() {
    if (!parsedSVG) return;

    const bgColor = getBackgroundColor();

    if (currentView === 'wireframe') {
        showWireframe(canvas, layerState);
        btnWireframe.classList.add('active');
        btnPreview.classList.remove('active');
    } else {
        showPreview(canvas, layerState, bgColor);
        btnPreview.classList.add('active');
        btnWireframe.classList.remove('active');
    }
}

function getBackgroundColor() {
    const bg = bgSelect.value;
    switch (bg) {
        case 'dark': return '#1a1a2e';
        case 'light': return '#f0f0f0';
        case 'checkerboard': return '#1a1a1a';
        default: return '#1a1a2e';
    }
}

// --- Tabs ---

function setTab(tab) {
    // Remember the tab we're leaving's own pan/zoom before switching away from it - the
    // canvas and its viewBox are shared by all three tabs, so without this every switch would
    // silently lose whatever view the previous tab had.
    if (activeTab !== tab) tabViews[activeTab] = getView();
    activeTab = tab;
    document.body.classList.toggle('mode-preview', tab === 'preview');
    document.body.classList.toggle('mode-layout', tab === 'layout');
    document.body.classList.toggle('mode-trace', tab === 'trace');
    tabButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));

    if (tab === 'preview') {
        if (parsedSVG) {
            injectSVG(parsedSVG, canvas);
            const bounds = getSVGBounds(parsedSVG, canvas);
            setInitialView(bounds);
            applyView();
        } else {
            canvas.innerHTML = '';
            dropZone.classList.add('visible');
        }
    } else if (tab === 'layout') {
        layout.show();
    } else {
        trace.show();
    }

    // Restore this tab's own view over whatever it just fitted to on entry (a first-ever
    // visit has nothing saved yet, so its own fit stands).
    if (tabViews[tab]) setView(tabViews[tab]);
}

tabButtons.forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));

btnWireframe.addEventListener('click', () => {
    currentView = 'wireframe';
    applyView();
});

btnPreview.addEventListener('click', () => {
    currentView = 'preview';
    applyView();
});

// --- Zoom controls ---

btnZoomIn.addEventListener('click', zoomIn);
btnZoomOut.addEventListener('click', zoomOut);
btnZoomFit.addEventListener('click', zoomFit);

// --- Background toggle ---

function applyBackground() {
    viewport.className = '';
    switch (bgSelect.value) {
        case 'light': viewport.classList.add('bg-light'); break;
        case 'checkerboard': viewport.classList.add('bg-checkerboard'); break;
    }
    if (currentView === 'preview') {
        applyView();
    }
}

bgSelect.addEventListener('change', applyBackground);

// --- Legend ---

btnLegend.addEventListener('click', () => {
    legendEl.hidden = !legendEl.hidden;
});

btnLegendClose.addEventListener('click', () => {
    legendEl.hidden = true;
});

// --- Material color ---

materialColorInput.addEventListener('input', (e) => {
    setMaterialColor(e.target.value);
    if (currentView === 'preview') {
        applyView();
    }
});

// --- Layer interactions ---

function updateLayerList() {
    renderLayerList(layerListEl, layerState, (index) => {
        layerState[index].type = nextLayerType(layerState[index].type);
        saveLayerPreferences(layerState);
        updateLayerList();
        applyView();
    });
}

btnAllCut.addEventListener('click', () => {
    layerState.forEach(l => l.type = LayerType.CUT);
    saveLayerPreferences(layerState);
    updateLayerList();
    applyView();
});

btnAllIgnore.addEventListener('click', () => {
    layerState.forEach(l => l.type = LayerType.IGNORE);
    saveLayerPreferences(layerState);
    updateLayerList();
    applyView();
});

btnClearTags.addEventListener('click', () => {
    // Re-run auto detection
    layerState = createLayerState(parsedSVG.layers);
    saveLayerPreferences(layerState);
    updateLayerList();
    applyView();
});

// --- PNG export ---

btnExportPNG.addEventListener('click', () => {
    if (!parsedSVG) return;
    exportPNG(canvas);
});

// --- Keyboard shortcuts ---

document.addEventListener('keydown', (e) => {
    // Don't capture if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    switch (e.key.toLowerCase()) {
        case 'escape':
            if (!legendEl.hidden) legendEl.hidden = true;
            break;
        case 'w':
            if (activeTab !== 'preview') break;
            currentView = 'wireframe';
            applyView();
            break;
        case 'f':
            if (activeTab !== 'preview') break;
            currentView = 'preview';
            applyView();
            break;
        case '=':
        case '+':
            zoomIn();
            break;
        case '-':
            zoomOut();
            break;
        case '0':
            zoomFit();
            break;
        case 'v':
            if (activeTab !== 'trace') break;
            trace.toggleView();
            break;
    }
});

// --- Startup ---

initViewport(canvas);

// Switch tabs first: loadSVGContent mutates the shared viewport, and it must do so while
// Preview is already the active tab (see the comment on loadSVGContent).
function sendToPreview(svgText) {
    setTab('preview');
    loadSVGContent(svgText);
}

const layout = initLayout({
    canvas,
    onSendToPreview: sendToPreview,
});

const trace = initTrace({
    canvas,
    getPanels: () => layout.getPanels(),
    onSendToPreview: sendToPreview,
    getBackground: getBackgroundColor,
});

// The browser restores #bg-select's value on reload but never fires its change event, so
// apply it explicitly before the first tab render.
applyBackground();
setTab('preview');
