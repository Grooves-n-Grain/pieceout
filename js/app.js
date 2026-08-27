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
    initViewport, setInitialView, zoomIn, zoomOut, zoomFit,
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

let activeTab = 'preview'; // 'preview' | 'layout'
const tabButtons = document.querySelectorAll('.tab-btn');

const btnWireframe = document.getElementById('btn-wireframe');
const btnPreview = document.getElementById('btn-preview');
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomFit = document.getElementById('btn-zoom-fit');
const btnExportPNG = document.getElementById('btn-export-png');
const bgSelect = document.getElementById('bg-select');
const materialColorInput = document.getElementById('material-color');

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

bgSelect.addEventListener('change', () => {
    viewport.className = '';
    switch (bgSelect.value) {
        case 'light': viewport.classList.add('bg-light'); break;
        case 'checkerboard': viewport.classList.add('bg-checkerboard'); break;
    }
    if (currentView === 'preview') {
        applyView();
    }
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

const layout = initLayout({
    canvas,
    onSendToPreview: (svgText) => {
        loadSVGContent(svgText);
        setTab('preview');
    },
});

const trace = initTrace({
    canvas,
    getPanels: () => layout.getPanels(),
    onSendToPreview: (svgText) => {
        loadSVGContent(svgText);
        setTab('preview');
    },
});

setTab('preview');
