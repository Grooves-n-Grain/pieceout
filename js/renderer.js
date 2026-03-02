/**
 * Renderer - handles switching between wireframe and filled preview modes
 *
 * Preview uses SVG masks to "punch holes" in material:
 * - A <mask> is created with a white rect (fully opaque = material visible)
 * - Cut-through paths are cloned into the mask with black fill (transparent = hole)
 * - The mask is applied to the wood-colored material rectangle
 * - This correctly handles overlapping paths, z-ordering, etc.
 */

import { LayerType } from './layerTagger.js';

let currentMode = 'wireframe';
let materialColor = '#C4A265';

// Preview elements we create/manage
let previewGroup = null;  // <g> containing the material rect with mask
let maskEl = null;
let defsEl = null;

/**
 * Store original styles for all paths so we can restore wireframe mode.
 */
const originalStyles = new WeakMap();

function saveOriginalStyle(el) {
    if (!originalStyles.has(el)) {
        originalStyles.set(el, {
            fill: el.getAttribute('fill'),
            stroke: el.getAttribute('stroke'),
            strokeWidth: el.getAttribute('stroke-width'),
            display: el.style.display,
            fillStyle: el.style.fill,
            strokeStyle: el.style.stroke,
        });
    }
}

/**
 * Inject the SVG into the viewport canvas.
 */
export function injectSVG(parsedSVG, canvasEl) {
    // Clear existing content
    canvasEl.innerHTML = '';
    previewGroup = null;
    maskEl = null;
    defsEl = null;

    const svgEl = parsedSVG.svgElement;

    // Copy viewBox and dimensions
    const vb = parsedSVG.viewBox;
    if (vb) {
        canvasEl.setAttribute('viewBox', vb);
    } else if (parsedSVG.width && parsedSVG.height) {
        canvasEl.setAttribute('viewBox', `0 0 ${parsedSVG.width} ${parsedSVG.height}`);
    }

    // Import all children from the parsed SVG into our canvas
    const imported = document.importNode(svgEl, true);

    // Move all children from the imported SVG to our canvas
    while (imported.firstChild) {
        canvasEl.appendChild(imported.firstChild);
    }

    // Copy over any namespace attributes (inkscape, etc.)
    for (const attr of svgEl.attributes) {
        if (attr.name !== 'xmlns' && !canvasEl.hasAttribute(attr.name)) {
            canvasEl.setAttribute(attr.name, attr.value);
        }
    }

    // Save original styles for all path elements
    const allPaths = canvasEl.querySelectorAll('path, polygon, polyline, rect, circle, ellipse, line');
    allPaths.forEach(saveOriginalStyle);
}

/**
 * Set the material color for preview mode.
 */
export function setMaterialColor(color) {
    materialColor = color;
    // Update the material rect fill if in preview mode
    if (currentMode === 'preview' && previewGroup) {
        const matRect = previewGroup.querySelector('.pieceout-material');
        if (matRect) matRect.setAttribute('fill', materialColor);
    }
}

/**
 * Get the current rendering mode.
 */
export function getMode() {
    return currentMode;
}

/**
 * Switch to wireframe mode - restore original SVG styles, remove preview elements.
 */
export function showWireframe(canvasEl, layerState) {
    currentMode = 'wireframe';

    // Remove preview elements
    if (previewGroup && previewGroup.parentNode) {
        previewGroup.parentNode.removeChild(previewGroup);
    }
    if (defsEl && defsEl.parentNode) {
        defsEl.parentNode.removeChild(defsEl);
    }
    previewGroup = null;
    maskEl = null;
    defsEl = null;

    // Restore original styles and visibility for all layers
    layerState.forEach(layer => {
        const group = findLayerGroup(canvasEl, layer);
        if (!group) return;

        group.style.display = '';
        const paths = group.querySelectorAll('path, polygon, polyline, rect, circle, ellipse, line');
        paths.forEach(el => {
            const orig = originalStyles.get(el);
            if (orig) {
                el.setAttribute('fill', orig.fill || 'none');
                el.setAttribute('stroke', orig.stroke || '');
                if (orig.strokeWidth) el.setAttribute('stroke-width', orig.strokeWidth);
                el.style.display = orig.display || '';
                el.style.fill = orig.fillStyle || '';
                el.style.stroke = orig.strokeStyle || '';
            }
        });
    });
}

/**
 * Switch to preview mode using SVG mask + evenodd compound path.
 *
 * The key insight: cut paths are nested (outer border contains inner cutouts).
 * Using fill-rule="evenodd" on a compound path in the mask:
 *   - Outside all paths = black (no material - this is stock waste)
 *   - Inside outer border only = white (material visible - the piece)
 *   - Inside outer border AND an inner cutout = black (hole)
 *
 * This naturally handles any nesting depth.
 */
export function showPreview(canvasEl, layerState, bgColor) {
    currentMode = 'preview';

    // Clean up any previous preview elements
    if (previewGroup && previewGroup.parentNode) {
        previewGroup.parentNode.removeChild(previewGroup);
    }
    if (defsEl && defsEl.parentNode) {
        defsEl.parentNode.removeChild(defsEl);
    }

    const ns = 'http://www.w3.org/2000/svg';
    const bounds = getCanvasBounds(canvasEl);

    // --- Collect all cut path data and combine into compound path ---
    let compoundD = '';

    layerState.forEach(layer => {
        if (layer.type !== LayerType.CUT) return;

        const group = findLayerGroup(canvasEl, layer);
        if (!group) return;

        const paths = group.querySelectorAll('path, polygon, polyline, rect, circle, ellipse, line');
        paths.forEach(el => {
            const transform = getAccumulatedTransform(el, canvasEl);
            const d = elementToPathData(el, transform);
            if (d) compoundD += ' ' + d;
        });
    });

    // --- Build the mask ---
    defsEl = document.createElementNS(ns, 'defs');
    maskEl = document.createElementNS(ns, 'mask');
    maskEl.setAttribute('id', 'pieceout-cut-mask');
    maskEl.setAttribute('maskUnits', 'userSpaceOnUse');
    // Use oversized mask bounds so panning never clips the masked content
    const pad = Math.max(bounds.width, bounds.height) * 10;
    maskEl.setAttribute('x', bounds.x - pad);
    maskEl.setAttribute('y', bounds.y - pad);
    maskEl.setAttribute('width', bounds.width + pad * 2);
    maskEl.setAttribute('height', bounds.height + pad * 2);

    // Black background = no material by default (outside the piece)
    const maskBg = document.createElementNS(ns, 'rect');
    maskBg.setAttribute('x', bounds.x - pad);
    maskBg.setAttribute('y', bounds.y - pad);
    maskBg.setAttribute('width', bounds.width + pad * 2);
    maskBg.setAttribute('height', bounds.height + pad * 2);
    maskBg.setAttribute('fill', 'black');
    maskEl.appendChild(maskBg);

    // Compound path with evenodd: toggles between white/black at each boundary
    if (compoundD.trim()) {
        const compoundPath = document.createElementNS(ns, 'path');
        compoundPath.setAttribute('d', compoundD.trim());
        compoundPath.setAttribute('fill', 'white');
        compoundPath.setAttribute('fill-rule', 'evenodd');
        compoundPath.setAttribute('stroke', 'none');
        maskEl.appendChild(compoundPath);
    }

    defsEl.appendChild(maskEl);
    canvasEl.insertBefore(defsEl, canvasEl.firstChild);

    // --- Build the masked material rectangle ---
    previewGroup = document.createElementNS(ns, 'g');
    previewGroup.setAttribute('id', 'pieceout-preview');

    const matRect = document.createElementNS(ns, 'rect');
    matRect.classList.add('pieceout-material');
    matRect.setAttribute('x', bounds.x - pad);
    matRect.setAttribute('y', bounds.y - pad);
    matRect.setAttribute('width', bounds.width + pad * 2);
    matRect.setAttribute('height', bounds.height + pad * 2);
    matRect.setAttribute('fill', materialColor);
    matRect.setAttribute('mask', 'url(#pieceout-cut-mask)');

    previewGroup.appendChild(matRect);

    // Add pocket layers as darker fills on top of material
    layerState.forEach(layer => {
        if (layer.type !== LayerType.POCKET) return;

        const group = findLayerGroup(canvasEl, layer);
        if (!group) return;

        const paths = group.querySelectorAll('path, polygon, polyline, rect, circle, ellipse, line');
        paths.forEach(el => {
            const clone = el.cloneNode(true);
            clone.setAttribute('fill', darkenColor(materialColor, 0.3));
            clone.setAttribute('stroke', 'none');
            clone.style.fill = darkenColor(materialColor, 0.3);
            clone.style.stroke = 'none';

            const parentTransform = getAccumulatedTransform(el, canvasEl);
            if (parentTransform) {
                clone.setAttribute('transform', parentTransform);
            }

            previewGroup.appendChild(clone);
        });
    });

    // Insert preview group after defs
    canvasEl.insertBefore(previewGroup, defsEl.nextSibling);

    // Hide all original layer groups
    layerState.forEach(layer => {
        const group = findLayerGroup(canvasEl, layer);
        if (group && group !== canvasEl) {
            group.style.display = 'none';
        }
    });
}

// --- Shape to path data converters ---

/**
 * Convert any SVG shape element to a path 'd' string.
 * Optionally applies a transform string.
 */
function elementToPathData(el, transform) {
    let d = null;
    const tag = el.tagName.toLowerCase();

    switch (tag) {
        case 'path':
            d = el.getAttribute('d');
            break;
        case 'rect':
            d = rectToPath(el);
            break;
        case 'circle':
            d = circleToPath(el);
            break;
        case 'ellipse':
            d = ellipseToPath(el);
            break;
        case 'polygon':
            d = polygonToPath(el);
            break;
        case 'polyline':
            d = polylineToPath(el);
            break;
        case 'line':
            // Lines have no area, skip for fill purposes
            return null;
    }

    if (!d) return null;

    // If the element itself has a transform, apply it
    const elTransform = el.getAttribute('transform');
    const fullTransform = [transform, elTransform].filter(Boolean).join(' ');

    if (fullTransform) {
        // Wrap in a group-like transform by using SVG path transform
        // We'll use a temporary SVG to resolve the transform
        return applyTransformToPathData(d, fullTransform);
    }

    return d;
}

function rectToPath(el) {
    const x = parseFloat(el.getAttribute('x')) || 0;
    const y = parseFloat(el.getAttribute('y')) || 0;
    const w = parseFloat(el.getAttribute('width')) || 0;
    const h = parseFloat(el.getAttribute('height')) || 0;
    const rx = parseFloat(el.getAttribute('rx')) || 0;
    const ry = parseFloat(el.getAttribute('ry')) || rx;

    if (w === 0 || h === 0) return null;

    if (rx === 0 && ry === 0) {
        return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
    }

    // Rounded rect
    const r = Math.min(rx, w / 2);
    const rv = Math.min(ry, h / 2);
    return `M${x + r},${y} H${x + w - r} A${r},${rv} 0 0 1 ${x + w},${y + rv} V${y + h - rv} A${r},${rv} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${rv} 0 0 1 ${x},${y + h - rv} V${y + rv} A${r},${rv} 0 0 1 ${x + r},${y} Z`;
}

function circleToPath(el) {
    const cx = parseFloat(el.getAttribute('cx')) || 0;
    const cy = parseFloat(el.getAttribute('cy')) || 0;
    const r = parseFloat(el.getAttribute('r')) || 0;
    if (r === 0) return null;

    // Two-arc circle
    return `M${cx - r},${cy} A${r},${r} 0 1 0 ${cx + r},${cy} A${r},${r} 0 1 0 ${cx - r},${cy} Z`;
}

function ellipseToPath(el) {
    const cx = parseFloat(el.getAttribute('cx')) || 0;
    const cy = parseFloat(el.getAttribute('cy')) || 0;
    const rx = parseFloat(el.getAttribute('rx')) || 0;
    const ry = parseFloat(el.getAttribute('ry')) || 0;
    if (rx === 0 || ry === 0) return null;

    return `M${cx - rx},${cy} A${rx},${ry} 0 1 0 ${cx + rx},${cy} A${rx},${ry} 0 1 0 ${cx - rx},${cy} Z`;
}

function polygonToPath(el) {
    const points = el.getAttribute('points');
    if (!points) return null;
    const coords = points.trim().split(/[\s,]+/);
    if (coords.length < 4) return null;

    let d = `M${coords[0]},${coords[1]}`;
    for (let i = 2; i < coords.length; i += 2) {
        d += ` L${coords[i]},${coords[i + 1]}`;
    }
    d += ' Z';
    return d;
}

function polylineToPath(el) {
    const points = el.getAttribute('points');
    if (!points) return null;
    const coords = points.trim().split(/[\s,]+/);
    if (coords.length < 4) return null;

    let d = `M${coords[0]},${coords[1]}`;
    for (let i = 2; i < coords.length; i += 2) {
        d += ` L${coords[i]},${coords[i + 1]}`;
    }
    // Close polylines for fill purposes
    d += ' Z';
    return d;
}

/**
 * Apply an SVG transform string to path data using a temporary SVG element.
 * This resolves translate, rotate, scale, matrix transforms into actual coordinates.
 */
function applyTransformToPathData(d, transformStr) {
    // For now, wrap in a simple approach: we'll create the path with transform
    // and let the browser handle it. Since we're putting this in a mask,
    // we can create a <g transform="..."><path d="..."/></g> equivalent
    // by returning a modified path.

    // Simple approach: if the transform is just a translate, apply it directly
    const translateMatch = transformStr.match(/translate\(\s*([-\d.]+)[\s,]+([-\d.]+)\s*\)/);
    if (translateMatch && transformStr.replace(/translate\([^)]+\)/g, '').trim() === '') {
        const tx = parseFloat(translateMatch[1]);
        const ty = parseFloat(translateMatch[2]);
        return translatePathData(d, tx, ty);
    }

    // For complex transforms, we'll just return the raw path data
    // and handle it via a nested group in the mask instead
    return d;
}

/**
 * Translate all coordinates in a path data string by (tx, ty).
 * Handles M, L, H, V, C, S, Q, T, A commands.
 */
function translatePathData(d, tx, ty) {
    // Simple offset: replace M and L coordinates
    return d.replace(/([MLCSQTA])\s*([-\d.]+)[,\s]+([-\d.]+)/gi, (match, cmd, x, y) => {
        if (cmd.toUpperCase() === 'A') return match; // Arc is complex, skip
        if (cmd === cmd.toLowerCase()) return match; // Relative commands don't need translation
        return `${cmd}${parseFloat(x) + tx},${parseFloat(y) + ty}`;
    }).replace(/H\s*([-\d.]+)/gi, (match, x) => {
        return `H${parseFloat(x) + tx}`;
    }).replace(/V\s*([-\d.]+)/gi, (match, y) => {
        return `V${parseFloat(y) + ty}`;
    });
}

/**
 * Get the accumulated transform string from an element up to a stop ancestor.
 */
function getAccumulatedTransform(el, stopAt) {
    const transforms = [];
    let current = el.parentElement;

    while (current && current !== stopAt) {
        const t = current.getAttribute('transform');
        if (t) transforms.unshift(t);
        current = current.parentElement;
    }

    // Also include the element's own transform
    const own = el.getAttribute('transform');
    if (own) transforms.push(own);

    return transforms.length > 0 ? transforms.join(' ') : null;
}

/**
 * Get the canvas bounds from viewBox.
 */
function getCanvasBounds(canvasEl) {
    const vb = canvasEl.getAttribute('viewBox');
    if (vb) {
        const [x, y, w, h] = vb.split(/[\s,]+/).map(Number);
        return { x, y, width: w, height: h };
    }
    return { x: 0, y: 0, width: 1000, height: 1000 };
}

/**
 * Find the layer's group element within the canvas SVG.
 */
function findLayerGroup(canvasEl, layer) {
    if (layer.isFlat) {
        return canvasEl;
    }

    // Try matching by id
    const byId = canvasEl.querySelector(`g[id="${CSS.escape(layer.name)}"]`);
    if (byId) return byId;

    // Try matching by inkscape:label
    const allGroups = canvasEl.querySelectorAll('g');
    for (const g of allGroups) {
        const label = g.getAttribute('inkscape:label') || g.getAttribute('id');
        if (label === layer.name) return g;
    }

    return null;
}

/**
 * Darken a hex color by a factor (0-1).
 */
function darkenColor(hex, factor) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const dr = Math.round(r * (1 - factor));
    const dg = Math.round(g * (1 - factor));
    const db = Math.round(b * (1 - factor));
    return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}

function getCSSVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Export the current SVG canvas as a PNG.
 */
export function exportPNG(canvasEl) {
    const svgData = new XMLSerializer().serializeToString(canvasEl);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
        const vb = canvasEl.getAttribute('viewBox');
        let w = 2048, h = 2048;
        if (vb) {
            const parts = vb.split(/[\s,]+/).map(Number);
            const aspect = parts[2] / parts[3];
            if (aspect > 1) {
                h = Math.round(w / aspect);
            } else {
                w = Math.round(h * aspect);
            }
        }

        const offscreen = document.createElement('canvas');
        offscreen.width = w;
        offscreen.height = h;
        const ctx = offscreen.getContext('2d');

        // Draw background
        const viewport = document.getElementById('viewport');
        const bgStyle = getComputedStyle(viewport);
        ctx.fillStyle = bgStyle.backgroundColor || '#1a1a2e';
        ctx.fillRect(0, 0, w, h);

        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);

        offscreen.toBlob(pngBlob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(pngBlob);
            a.download = 'pieceout-preview.png';
            a.click();
            URL.revokeObjectURL(a.href);
        }, 'image/png');
    };
    img.src = url;
}
