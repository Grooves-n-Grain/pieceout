// js/trace/overlay.js
/** Raster preview of the working bitmap with island / thin / bridge / contour overlays on the shared canvas. */
import { pathData } from './svg.js';
import { refreshViewBox } from '../viewport.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function bitmapToDataURL(bitmap) {
    // Material (bitmap value 1) always paints dark and cut (0) always paints light, regardless
    // of the source image's own colours - the bitmap is already post-invert by the time it gets
    // here, so this preview stays stable no matter which way "Art is white on black" is set.
    const { width, height, data } = bitmap;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
        const v = data[i] ? 0x11 : 0xf4;
        img.data[i * 4] = v;
        img.data[i * 4 + 1] = v;
        img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
}

function el(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
}

function bboxRect(bbox, cls, extra = {}) {
    return el('rect', {
        x: bbox.x0, y: bbox.y0, width: bbox.x1 - bbox.x0 + 1, height: bbox.y1 - bbox.y0 + 1, class: cls, ...extra,
    });
}

export function renderOverlay(canvas, { bitmap, islands, thin, bridges, shapes, selectedIsland }) {
    const { width: W, height: H } = bitmap;
    canvas.setAttribute('viewBox', `0 0 ${W} ${H}`);
    canvas.removeAttribute('width');
    canvas.removeAttribute('height');
    canvas.innerHTML = '';

    const image = el('image', { href: bitmapToDataURL(bitmap), x: 0, y: 0, width: W, height: H });
    image.setAttribute('style', 'image-rendering: pixelated');
    canvas.appendChild(image);

    const contours = el('g', { id: 'trace-contours' });
    for (const shape of shapes) {
        for (const loop of [shape.outer, ...shape.holes]) contours.appendChild(el('path', { d: pathData(loop, 1), class: 'trace-contour' }));
    }
    canvas.appendChild(contours);

    const thinGroup = el('g', { id: 'trace-thin' });
    for (const t of thin) thinGroup.appendChild(bboxRect(t.bbox, 'trace-thin-mark'));
    canvas.appendChild(thinGroup);

    const bridgeGroup = el('g', { id: 'trace-bridges' });
    for (const op of bridges) {
        if (!op.path) continue;
        bridgeGroup.appendChild(el('polyline', { points: op.path.map(([x, y]) => `${x + 0.5},${y + 0.5}`).join(' '), class: 'trace-bridge' }));
    }
    canvas.appendChild(bridgeGroup);

    const islandGroup = el('g', { id: 'trace-islands-overlay' });
    islands.forEach((island) => {
        const rect = bboxRect(island.bbox, 'trace-island-mark', { 'data-island-number': island.number });
        if (island.number === selectedIsland) rect.setAttribute('stroke-width', '3');
        islandGroup.appendChild(rect);
        const fontSize = Math.max(8, Math.round(W / 80));
        islandGroup.appendChild(el('text', {
            x: island.bbox.x1 + 2, y: island.bbox.y0 + fontSize, class: 'trace-island-label',
            'font-size': fontSize, 'data-island-number': island.number,
        }, String(island.number)));
    });
    canvas.appendChild(islandGroup);

    refreshViewBox();
}
