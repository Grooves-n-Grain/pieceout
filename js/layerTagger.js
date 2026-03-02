/**
 * Layer Tagger - auto-detects layer types and builds the sidebar UI
 */

// Layer types
export const LayerType = {
    CUT: 'cut',
    POCKET: 'pocket',
    IGNORE: 'ignore',
};

// Keywords that suggest a layer is a cut-through
const CUT_KEYWORDS = [
    'profile', 'cut', 'through', 'outline', 'cutout', 'cut-out',
    'contour', 'outside', 'border', 'perimeter', 'laser',
];

const POCKET_KEYWORDS = [
    'pocket', 'engrave', 'carve', 'vcarve', 'v-carve', 'texture', 'relief',
];

/**
 * Auto-detect layer type based on name.
 */
export function detectLayerType(layerName) {
    const lower = layerName.toLowerCase();

    for (const kw of CUT_KEYWORDS) {
        if (lower.includes(kw)) return LayerType.CUT;
    }
    for (const kw of POCKET_KEYWORDS) {
        if (lower.includes(kw)) return LayerType.POCKET;
    }

    // Default: if only one layer, assume it's a cut layer
    return LayerType.IGNORE;
}

/**
 * Cycle to the next layer type.
 */
export function nextLayerType(current) {
    const cycle = [LayerType.CUT, LayerType.POCKET, LayerType.IGNORE];
    const idx = cycle.indexOf(current);
    return cycle[(idx + 1) % cycle.length];
}

/**
 * Create the layer tagger state from parsed layers.
 */
export function createLayerState(layers) {
    const state = layers.map(layer => ({
        ...layer,
        type: layers.length === 1 ? LayerType.CUT : detectLayerType(layer.name),
    }));
    return state;
}

/**
 * Render the layer list in the sidebar.
 */
export function renderLayerList(container, layerState, onLayerClick) {
    container.innerHTML = '';

    if (layerState.length === 0) {
        container.innerHTML = '<p class="hint">Drop an SVG to see layers</p>';
        return;
    }

    layerState.forEach((layer, index) => {
        const item = document.createElement('div');
        item.className = 'layer-item';
        item.dataset.index = index;

        item.innerHTML = `
            <div class="layer-tag ${layer.type}"></div>
            <span class="layer-name" title="${layer.name}">${layer.name}</span>
            <span class="layer-count">${layer.pathCount}</span>
            <span class="layer-type ${layer.type}">${layer.type}</span>
        `;

        item.addEventListener('click', () => {
            onLayerClick(index);
        });

        container.appendChild(item);
    });
}

/**
 * Save layer tag preferences to localStorage.
 */
export function saveLayerPreferences(layerState) {
    const prefs = {};
    layerState.forEach(l => {
        prefs[l.name] = l.type;
    });
    try {
        localStorage.setItem('pieceout-layer-prefs', JSON.stringify(prefs));
    } catch (e) {
        // localStorage not available, silently ignore
    }
}

/**
 * Load and apply saved layer preferences.
 */
export function loadLayerPreferences(layerState) {
    try {
        const saved = JSON.parse(localStorage.getItem('pieceout-layer-prefs') || '{}');
        layerState.forEach(layer => {
            if (saved[layer.name]) {
                layer.type = saved[layer.name];
            }
        });
    } catch (e) {
        // Ignore parse errors
    }
}
